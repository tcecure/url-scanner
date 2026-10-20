import { z } from 'zod';

import { config } from '@/lib/config';
import { audit, hashIp } from '@/lib/audit';
import { one, query, transaction } from '@/lib/db';
import { enqueueMail, staffAuthorizationBody, verifyEmailBody } from '@/lib/mail';
import { consume } from '@/lib/rate-limit';
import { hashToken, newToken } from '@/lib/tokens';
import { TargetRejected, emailMatchesTarget, isConsumerMailbox, normalizeDomain } from '@/lib/target';

export const PRIVACY_VERSION = '2026-10-20';

export const submissionSchema = z.object({
  businessName: z.string().trim().min(2, 'Enter your business name.').max(200),
  website: z.string().trim().min(3, 'Enter your website address.').max(300),
  contactName: z.string().trim().min(2, 'Enter your name.').max(120),
  contactEmail: z.string().trim().toLowerCase().email('Enter a valid work email address.').max(200),
  authorization: z.literal(true, {
    errorMap: () => ({ message: 'Authorization is required before any review can run.' }),
  }),
  marketingConsent: z.boolean().default(false),
  // Honeypot and timing fields: a human leaves one empty and takes a few seconds.
  company_website: z.string().max(0, 'Submission rejected.').optional().default(''),
  formLoadedAt: z.coerce.number().int().nonnegative().optional(),
});

export type Submission = z.infer<typeof submissionSchema>;

export type SubmissionOutcome =
  | { ok: true; statusToken: string; requiresStaffApproval: boolean }
  | { ok: false; status: number; message: string; field?: string };

export async function createRequest(
  input: unknown,
  context: { ip: string; userAgent: string },
): Promise<SubmissionOutcome> {
  const parsed = submissionSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, status: 400, message: issue.message, field: String(issue.path[0] ?? '') };
  }
  const data = parsed.data;

  if (data.company_website) {
    await audit('submission.rejected.bot', { detail: { reason: 'honeypot' } });
    return { ok: false, status: 400, message: 'Submission rejected.' };
  }
  if (data.formLoadedAt) {
    const seconds = (Date.now() - data.formLoadedAt) / 1000;
    if (seconds < config.minFormSeconds()) {
      await audit('submission.rejected.bot', { detail: { reason: 'too_fast', seconds } });
      return { ok: false, status: 429, message: 'Please take a moment and submit the form again.' };
    }
  }

  let domain: string;
  try {
    domain = normalizeDomain(data.website);
  } catch (error) {
    if (error instanceof TargetRejected) {
      return { ok: false, status: 400, message: error.message, field: 'website' };
    }
    throw error;
  }

  if (isConsumerMailbox(data.contactEmail)) {
    return {
      ok: false,
      status: 400,
      field: 'contactEmail',
      message: 'Use your work email address so we can confirm who authorized the review.',
    };
  }

  const byIp = await consume('ip', hashIp(context.ip), config.maxRequestsPerIpPerHour(), 3600);
  if (!byIp.allowed) {
    return { ok: false, status: 429, message: 'Too many requests from this network. Try again later.' };
  }
  const byEmail = await consume('email', data.contactEmail, config.maxRequestsPerEmailPerDay(), 86_400);
  if (!byEmail.allowed) {
    return { ok: false, status: 429, message: 'This address has already submitted several requests today.' };
  }
  const byDomain = await consume('domain', domain, config.maxRequestsPerDomainPerWeek(), 604_800);
  if (!byDomain.allowed) {
    return {
      ok: false,
      status: 429,
      message: 'A snapshot for this website was requested recently. Contact TCecure if you need another.',
    };
  }

  const statusToken = newToken();
  const verifyToken = newToken();
  // A work email on the domain is the ordinary case and the review proceeds on
  // the submitter's authorization statement. Anything else is unclear, and is
  // held for a TCecure reviewer to confirm with the business.
  const requiresStaffApproval = !emailMatchesTarget(data.contactEmail, domain);

  const requestId = await transaction(async (client) => {
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO requests (business_name, website_input, target_domain, contact_name, contact_email,
                             status, authorization_confirmed, marketing_consent,
                             status_token_hash, privacy_version, source_ip_hash, user_agent, delete_after)
            VALUES ($1, $2, $3, $4, $5, 'awaiting_email_verification', true, $6, $7, $8, $9, $10,
                    now() + make_interval(days => $11))
         RETURNING id`,
      [
        data.businessName,
        data.website,
        domain,
        data.contactName,
        data.contactEmail,
        data.marketingConsent,
        hashToken(statusToken),
        PRIVACY_VERSION,
        hashIp(context.ip),
        context.userAgent.slice(0, 300),
        config.retentionDays(),
      ],
    );
    const id = inserted.rows[0].id;
    await client.query(
      `INSERT INTO tokens (request_id, purpose, token_hash, expires_at)
            VALUES ($1, 'email_verification', $2, now() + make_interval(hours => $3))`,
      [id, hashToken(verifyToken), config.verifyTokenTtlHours()],
    );
    return id;
  });

  await enqueueMail({
    requestId,
    kind: 'verify_email',
    to: data.contactEmail,
    subject: 'Confirm your TCecure External Exposure Snapshot request',
    body: verifyEmailBody(
      data.contactName,
      data.businessName,
      `${config.publicBaseUrl()}/verify/${verifyToken}`,
    ),
  });
  await audit('request.created', {
    actor: data.contactEmail,
    requestId,
    detail: { domain, requiresStaffApproval, marketingConsent: data.marketingConsent },
  });

  return { ok: true, statusToken, requiresStaffApproval };
}

export type RequestRow = {
  id: string;
  business_name: string;
  target_domain: string;
  contact_name: string;
  contact_email: string;
  status: string;
  email_verified_at: Date | null;
  authorized_at: Date | null;
  authorized_method: string | null;
  created_at: Date;
};

export async function byStatusToken(token: string): Promise<RequestRow | null> {
  return one<RequestRow>(
    `SELECT id, business_name, target_domain, contact_name, contact_email, status, email_verified_at,
            authorized_at, authorized_method, created_at
       FROM requests
      WHERE status_token_hash = $1 AND deleted_at IS NULL`,
    [hashToken(token)],
  );
}

/**
 * Consume an email verification link. Idempotent for a second click on the same link.
 *
 * Confirming the address is the last thing the requester is asked to do. A
 * confirmed work email on the domain being reviewed carries the authorization
 * statement from the form and the snapshot is queued; anything else leaves the
 * request unauthorized and waiting on a TCecure reviewer.
 */
export async function verifyEmail(token: string): Promise<{ outcome: string; held?: boolean }> {
  const row = await one<{ request_id: string; used_at: Date | null; expired: boolean }>(
    `SELECT request_id, used_at, expires_at < now() AS expired
       FROM tokens
      WHERE purpose = 'email_verification' AND token_hash = $1 AND revoked_at IS NULL`,
    [hashToken(token)],
  );
  if (!row) return { outcome: 'unknown' };
  if (row.expired && !row.used_at) return { outcome: 'expired' };

  const request = await one<{ contact_email: string; target_domain: string; business_name: string }>(
    `SELECT contact_email, target_domain, business_name FROM requests WHERE id = $1`,
    [row.request_id],
  );
  if (!request) return { outcome: 'unknown' };
  const selfService = emailMatchesTarget(request.contact_email, request.target_domain);
  // A second click on the same link shows the same page, but must not write the
  // audit trail again or alert a reviewer twice about one request.
  const firstUse = !row.used_at;

  await transaction(async (client) => {
    await client.query(`UPDATE tokens SET used_at = coalesce(used_at, now()) WHERE token_hash = $1`, [
      hashToken(token),
    ]);
    await client.query(
      `UPDATE requests
          SET email_verified_at = coalesce(email_verified_at, now()),
              status = CASE WHEN status = 'awaiting_email_verification' THEN 'awaiting_authorization'::request_status
                            ELSE status END,
              updated_at = now()
        WHERE id = $1`,
      [row.request_id],
    );
    if (selfService) {
      await client.query(
        `UPDATE requests
            SET authorized_at = coalesce(authorized_at, now()),
                authorized_method = coalesce(authorized_method, 'contact_confirmation'),
                authorized_by = coalesce(authorized_by, contact_email),
                authorization_evidence = coalesce(
                  authorization_evidence,
                  jsonb_build_object(
                    'basis', 'authorization statement accepted on the request form',
                    'contact_email_domain', split_part(contact_email, '@', 2),
                    'target_domain', target_domain,
                    'confirmed_at', now()
                  )),
                status = CASE WHEN status = 'awaiting_authorization' THEN 'queued'::request_status
                              ELSE status END,
                updated_at = now()
          WHERE id = $1 AND email_verified_at IS NOT NULL`,
        [row.request_id],
      );
      await client.query(
        `INSERT INTO jobs (request_id, kind, status)
              SELECT $1, 'snapshot', 'queued'
               WHERE EXISTS (SELECT 1 FROM requests WHERE id = $1 AND authorized_at IS NOT NULL)
                 AND NOT EXISTS (SELECT 1 FROM jobs WHERE request_id = $1 AND kind = 'snapshot')`,
        [row.request_id],
      );
    }
  });

  if (!firstUse) return { outcome: 'verified', held: !selfService };

  await audit('request.email_verified', { requestId: row.request_id });
  if (selfService) {
    await audit('authorization.recorded', {
      actor: request.contact_email,
      requestId: row.request_id,
      detail: { method: 'contact_confirmation' },
    });
    return { outcome: 'verified', held: false };
  }

  await audit('authorization.held_for_staff', { requestId: row.request_id });
  await enqueueMail({
    requestId: row.request_id,
    kind: 'reviewer_alert',
    to: config.reviewerInbox(),
    subject: `Authorization to confirm: ${request.business_name} (${request.target_domain})`,
    body: staffAuthorizationBody(
      request.business_name,
      request.target_domain,
      request.contact_email,
      `${config.publicBaseUrl()}/staff`,
    ),
  });
  return { outcome: 'verified', held: true };
}
