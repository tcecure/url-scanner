import { z } from 'zod';

import { config } from '@/lib/config';
import { audit, hashIp } from '@/lib/audit';
import { one, query, transaction } from '@/lib/db';
import { enqueueMail, verifyEmailBody } from '@/lib/mail';
import { consume } from '@/lib/rate-limit';
import { hashToken, newToken, siteVerificationSecret } from '@/lib/tokens';
import { TargetRejected, emailMatchesTarget, isConsumerMailbox, normalizeDomain } from '@/lib/target';

export const PRIVACY_VERSION = '2026-10-01';

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
  // Email domain matching the target is the ordinary case; anyone else is routed
  // to a TCecure reviewer, who confirms the authorization came through sales.
  const requiresStaffApproval = !emailMatchesTarget(data.contactEmail, domain);

  const requestId = await transaction(async (client) => {
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO requests (business_name, website_input, target_domain, contact_name, contact_email,
                             status, authorization_confirmed, marketing_consent, verification_secret,
                             status_token_hash, privacy_version, source_ip_hash, user_agent, delete_after)
            VALUES ($1, $2, $3, $4, $5, 'awaiting_email_verification', true, $6, $7, $8, $9, $10, $11,
                    now() + make_interval(days => $12))
         RETURNING id`,
      [
        data.businessName,
        data.website,
        domain,
        data.contactName,
        data.contactEmail,
        data.marketingConsent,
        siteVerificationSecret(),
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
  verification_secret: string;
  created_at: Date;
};

export async function byStatusToken(token: string): Promise<RequestRow | null> {
  return one<RequestRow>(
    `SELECT id, business_name, target_domain, contact_name, contact_email, status, email_verified_at,
            authorized_at, authorized_method, verification_secret, created_at
       FROM requests
      WHERE status_token_hash = $1 AND deleted_at IS NULL`,
    [hashToken(token)],
  );
}

/** Consume an email verification link. Idempotent for a second click on the same link. */
export async function verifyEmail(token: string): Promise<{ statusToken?: string; outcome: string }> {
  const row = await one<{ request_id: string; used_at: Date | null; expired: boolean }>(
    `SELECT request_id, used_at, expires_at < now() AS expired
       FROM tokens
      WHERE purpose = 'email_verification' AND token_hash = $1 AND revoked_at IS NULL`,
    [hashToken(token)],
  );
  if (!row) return { outcome: 'unknown' };
  if (row.expired && !row.used_at) return { outcome: 'expired' };

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
  });
  await audit('request.email_verified', { requestId: row.request_id });
  return { outcome: 'verified' };
}

/**
 * Ask the worker to look for the published verification value. The check itself
 * never runs in the web tier, which has no business making outbound requests.
 */
export async function queueAuthorizationProbe(requestId: string): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `INSERT INTO jobs (request_id, kind, status)
          SELECT $1, 'authorization_probe', 'queued'
           WHERE EXISTS (SELECT 1 FROM requests
                          WHERE id = $1 AND email_verified_at IS NOT NULL AND authorized_at IS NULL)
             AND NOT EXISTS (SELECT 1 FROM jobs
                              WHERE request_id = $1 AND kind = 'authorization_probe'
                                AND status IN ('queued', 'running'))
       RETURNING id`,
    [requestId],
  );
  if (rows.length) await audit('authorization.probe_queued', { requestId });
  return rows.length > 0;
}
