'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';

import { audit } from '@/lib/audit';
import { withReviewerSummary } from '@/lib/briefing';
import { config } from '@/lib/config';
import { one, query, transaction } from '@/lib/db';
import { enqueueMail, snapshotReadyBody } from '@/lib/mail';
import { currentStaff, signIn, signOut } from '@/lib/staff';
import { hashToken, newToken } from '@/lib/tokens';

async function requireStaff() {
  const staff = await currentStaff();
  if (!staff) redirect('/staff/login');
  return staff;
}

export async function loginAction(_prev: string | null, form: FormData): Promise<string | null> {
  const email = String(form.get('email') ?? '');
  const password = String(form.get('password') ?? '');
  const staff = await signIn(email, password);
  if (!staff) {
    await audit('staff.login_failed', { actor: email.toLowerCase(), detail: {} });
    return 'Those credentials were not accepted.';
  }
  await audit('staff.login', { actor: staff.email });
  redirect('/staff');
}

export async function logoutAction(): Promise<void> {
  const staff = await currentStaff();
  if (staff) await audit('staff.logout', { actor: staff.email });
  await signOut();
  redirect('/staff/login');
}

/** Confirm, as a reviewer, that authorization was established outside the portal. */
export async function approveAuthorizationAction(form: FormData): Promise<void> {
  const staff = await requireStaff();
  const requestId = String(form.get('requestId'));
  const basis = String(form.get('basis') ?? '').trim();
  if (basis.length < 10) return;

  await query(
    `UPDATE requests
        SET authorized_at = now(),
            authorized_method = 'staff_approval',
            authorized_by = $2,
            authorization_evidence = jsonb_build_object('basis', $3::text, 'recorded_at', now()),
            status = CASE WHEN status = 'awaiting_authorization' THEN 'queued'::request_status ELSE status END,
            updated_at = now()
      WHERE id = $1 AND email_verified_at IS NOT NULL AND authorized_at IS NULL`,
    [requestId, staff.email, basis],
  );
  await query(
    `INSERT INTO jobs (request_id, kind, status)
          SELECT $1, 'snapshot', 'queued'
           WHERE EXISTS (SELECT 1 FROM requests WHERE id = $1 AND authorized_at IS NOT NULL)
             AND NOT EXISTS (SELECT 1 FROM jobs WHERE request_id = $1 AND kind = 'snapshot')`,
    [requestId],
  );
  await audit('authorization.staff_approved', { actor: staff.email, requestId, detail: { basis } });
  revalidatePath(`/staff/requests/${requestId}`);
}

export async function rejectRequestAction(form: FormData): Promise<void> {
  const staff = await requireStaff();
  const requestId = String(form.get('requestId'));
  const reason = String(form.get('reason') ?? '').trim();

  await transaction(async (client) => {
    await client.query(`UPDATE requests SET status = 'rejected', updated_at = now() WHERE id = $1`, [requestId]);
    await client.query(
      `UPDATE reports SET status = 'rejected', reviewer_notes = $2, reviewed_by = $3, reviewed_at = now(),
                          updated_at = now()
         WHERE request_id = $1`,
      [requestId, reason, staff.email],
    );
    await client.query(
      `UPDATE jobs SET status = 'cancelled', finished_at = now(), updated_at = now()
        WHERE request_id = $1 AND status IN ('queued', 'running')`,
      [requestId],
    );
  });
  await audit('request.rejected', { actor: staff.email, requestId, detail: { reason } });
  revalidatePath(`/staff/requests/${requestId}`);
}

/**
 * Approve a briefing and deliver it.
 *
 * Nothing reaches a customer before this runs: the worker leaves every report in
 * `pending_review`, and delivery mints the single-use private link here.
 */
export async function approveAndDeliverAction(form: FormData): Promise<void> {
  const staff = await requireStaff();
  const requestId = String(form.get('requestId'));
  const notes = String(form.get('notes') ?? '').trim();

  const request = await one<{ contact_name: string; contact_email: string; business_name: string }>(
    `SELECT contact_name, contact_email, business_name FROM requests WHERE id = $1 AND deleted_at IS NULL`,
    [requestId],
  );
  const report = await one<{ id: string; status: string; html: string }>(
    `SELECT id, status::text AS status, html FROM reports WHERE request_id = $1`,
    [requestId],
  );
  if (!request || !report || !['draft', 'pending_review'].includes(report.status)) return;

  const linkToken = newToken();
  const hours = config.reportLinkTtlHours();

  await transaction(async (client) => {
    // The worker's PDF predates the review, so it would contradict the
    // delivered briefing once the reviewer's summary is written in.
    await client.query(
      `UPDATE reports
          SET status = 'approved', reviewer_notes = $2, reviewed_by = $3, reviewed_at = now(),
              html = $4, pdf = NULL, updated_at = now()
        WHERE request_id = $1`,
      [requestId, notes || null, staff.email, withReviewerSummary(report.html, notes)],
    );
    await client.query(
      `UPDATE tokens SET revoked_at = now()
        WHERE request_id = $1 AND purpose = 'report_link' AND revoked_at IS NULL AND used_at IS NULL`,
      [requestId],
    );
    await client.query(
      `INSERT INTO tokens (request_id, purpose, token_hash, expires_at)
            VALUES ($1, 'report_link', $2, now() + make_interval(hours => $3))`,
      [requestId, hashToken(linkToken), hours],
    );
  });

  await enqueueMail({
    requestId,
    kind: 'snapshot_ready',
    to: request.contact_email,
    subject: `Your TCecure External Exposure Snapshot for ${request.business_name}`,
    body: snapshotReadyBody(
      request.contact_name,
      request.business_name,
      `${config.publicBaseUrl()}/r/${linkToken}`,
      hours,
    ),
  });

  await query(
    `UPDATE reports SET status = 'delivered', delivered_at = now(), delivery_method = 'private_link',
                        updated_at = now()
      WHERE request_id = $1`,
    [requestId],
  );
  await query(`UPDATE requests SET status = 'delivered', updated_at = now() WHERE id = $1`, [requestId]);
  await audit('report.approved_and_delivered', {
    actor: staff.email,
    requestId,
    detail: { expiresInHours: hours, hasNotes: Boolean(notes) },
  });
  revalidatePath(`/staff/requests/${requestId}`);
}

/** Honour a deletion request: the briefing, findings and mail go, the audit trail stays. */
export async function purgeRequestAction(form: FormData): Promise<void> {
  const staff = await requireStaff();
  const requestId = String(form.get('requestId'));

  await transaction(async (client) => {
    await client.query(`DELETE FROM reports WHERE request_id = $1`, [requestId]);
    await client.query(`DELETE FROM findings WHERE request_id = $1`, [requestId]);
    await client.query(`DELETE FROM email_outbox WHERE request_id = $1`, [requestId]);
    await client.query(`UPDATE tokens SET revoked_at = now() WHERE request_id = $1`, [requestId]);
    await client.query(
      `UPDATE requests
          SET deleted_at = now(), status = 'expired', business_name = 'deleted at request',
              website_input = '', contact_name = 'deleted at request', contact_email = '',
              user_agent = NULL, updated_at = now()
        WHERE id = $1`,
      [requestId],
    );
  });
  await audit('request.purged', { actor: staff.email, requestId });
  redirect('/staff');
}
