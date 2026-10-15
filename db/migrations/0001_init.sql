-- TCecure External Exposure Snapshot — initial schema
-- The migration runner owns the transaction and the schema_migrations ledger.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE request_status AS ENUM (
    'awaiting_email_verification',
    'awaiting_authorization',
    'queued',
    'running',
    'awaiting_review',
    'delivered',
    'rejected',
    'failed',
    'expired'
);

CREATE TYPE authorization_method AS ENUM ('dns_txt', 'well_known', 'staff_approval');

CREATE TABLE requests (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_name           text NOT NULL,
    website_input           text NOT NULL,
    target_domain           text NOT NULL,
    contact_name            text NOT NULL,
    contact_email           text NOT NULL,
    status                  request_status NOT NULL DEFAULT 'awaiting_email_verification',
    authorization_confirmed boolean NOT NULL DEFAULT false,
    marketing_consent       boolean NOT NULL DEFAULT false,
    email_verified_at       timestamptz,
    authorized_at           timestamptz,
    authorized_method       authorization_method,
    authorized_by           text,
    authorization_evidence  jsonb,
    verification_secret     text NOT NULL,
    status_token_hash       text NOT NULL UNIQUE,
    privacy_version         text NOT NULL,
    source_ip_hash          text,
    user_agent              text,
    delete_after            timestamptz NOT NULL,
    deleted_at              timestamptz,
    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX requests_status_idx ON requests (status);
CREATE INDEX requests_domain_idx ON requests (target_domain);
CREATE INDEX requests_email_idx ON requests (lower(contact_email));
CREATE INDEX requests_delete_after_idx ON requests (delete_after) WHERE deleted_at IS NULL;

-- Single-use, hashed tokens for email verification and private report links.
CREATE TABLE tokens (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id  uuid NOT NULL REFERENCES requests (id) ON DELETE CASCADE,
    purpose     text NOT NULL CHECK (purpose IN ('email_verification', 'report_link')),
    token_hash  text NOT NULL UNIQUE,
    expires_at  timestamptz NOT NULL,
    used_at     timestamptz,
    revoked_at  timestamptz,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX tokens_request_idx ON tokens (request_id, purpose);

CREATE TYPE job_status AS ENUM ('queued', 'running', 'succeeded', 'failed', 'cancelled');

CREATE TABLE jobs (
    id              bigserial PRIMARY KEY,
    request_id      uuid NOT NULL REFERENCES requests (id) ON DELETE CASCADE,
    kind            text NOT NULL CHECK (kind IN ('snapshot', 'authorization_probe')),
    status          job_status NOT NULL DEFAULT 'queued',
    attempts        integer NOT NULL DEFAULT 0,
    max_attempts    integer NOT NULL DEFAULT 3,
    run_after       timestamptz NOT NULL DEFAULT now(),
    -- A claim expires so a worker that dies mid-check releases its job instead
    -- of stranding it in 'running'.
    timeout_seconds integer NOT NULL DEFAULT 120,
    claimed_by      text,
    claimed_at      timestamptz,
    claim_expires_at timestamptz,
    started_at      timestamptz,
    finished_at     timestamptz,
    error           text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX jobs_claim_idx ON jobs (status, run_after) WHERE status = 'queued';
CREATE INDEX jobs_stale_claim_idx ON jobs (claim_expires_at) WHERE status = 'running';
CREATE INDEX jobs_request_idx ON jobs (request_id);

-- A finding is one observation. Observations are facts with evidence; the
-- recommendation text is advice derived from them and is kept separate.
CREATE TABLE findings (
    id              bigserial PRIMARY KEY,
    request_id      uuid NOT NULL REFERENCES requests (id) ON DELETE CASCADE,
    job_id          bigint REFERENCES jobs (id) ON DELETE SET NULL,
    check_id        text NOT NULL,
    category        text NOT NULL,
    title           text NOT NULL,
    outcome         text NOT NULL CHECK (outcome IN ('observed', 'absent', 'error', 'not_applicable')),
    severity_hint   text NOT NULL CHECK (severity_hint IN ('informational', 'consider', 'attention')),
    summary         text NOT NULL,
    recommendation  text,
    evidence        jsonb NOT NULL,
    observed_at     timestamptz NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX findings_request_idx ON findings (request_id, check_id);

CREATE TYPE report_status AS ENUM ('draft', 'pending_review', 'approved', 'rejected', 'delivered');

CREATE TABLE reports (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id      uuid NOT NULL UNIQUE REFERENCES requests (id) ON DELETE CASCADE,
    job_id          bigint REFERENCES jobs (id) ON DELETE SET NULL,
    status          report_status NOT NULL DEFAULT 'draft',
    html            text NOT NULL,
    pdf             bytea,
    reviewer_notes  text,
    reviewed_by     text,
    reviewed_at     timestamptz,
    delivered_at    timestamptz,
    delivery_method text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX reports_request_idx ON reports (request_id);
CREATE INDEX reports_status_idx ON reports (status);

CREATE TABLE staff_users (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email           text NOT NULL UNIQUE,
    full_name       text NOT NULL,
    password_hash   text NOT NULL,
    role            text NOT NULL DEFAULT 'reviewer' CHECK (role IN ('reviewer', 'admin')),
    disabled_at     timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE staff_sessions (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    staff_user_id   uuid NOT NULL REFERENCES staff_users (id) ON DELETE CASCADE,
    token_hash      text NOT NULL UNIQUE,
    expires_at      timestamptz NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    last_seen_at    timestamptz NOT NULL DEFAULT now()
);

-- Mail is always recorded here; the transport may be SMTP or 'log' while no
-- TCecure sending identity is configured.
CREATE TABLE email_outbox (
    id              bigserial PRIMARY KEY,
    request_id      uuid REFERENCES requests (id) ON DELETE SET NULL,
    to_address      text NOT NULL,
    subject         text NOT NULL,
    body_text       text NOT NULL,
    body_html       text,
    template        text NOT NULL,
    transport       text NOT NULL,
    status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'logged')),
    error           text,
    sent_at         timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX email_outbox_status_idx ON email_outbox (status, created_at);

CREATE TABLE audit_log (
    id          bigserial PRIMARY KEY,
    request_id  uuid REFERENCES requests (id) ON DELETE SET NULL,
    actor       text NOT NULL,
    action      text NOT NULL,
    detail      jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_log_request_idx ON audit_log (request_id, created_at);
CREATE INDEX audit_log_created_idx ON audit_log (created_at);

-- Fixed-window counters for submission and verification abuse control.
CREATE TABLE rate_limits (
    bucket          text NOT NULL,
    window_start    timestamptz NOT NULL,
    count           integer NOT NULL DEFAULT 0,
    PRIMARY KEY (bucket, window_start)
);

CREATE INDEX rate_limits_window_idx ON rate_limits (window_start);


