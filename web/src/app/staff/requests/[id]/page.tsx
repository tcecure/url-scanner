import { notFound, redirect } from 'next/navigation';

import {
  approveAndDeliverAction,
  approveAuthorizationAction,
  purgeRequestAction,
  rejectRequestAction,
} from '@/app/staff/actions';
import { one, query } from '@/lib/db';
import { currentStaff } from '@/lib/staff';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Request | TCecure', robots: { index: false, follow: false } };

type Request = {
  id: string;
  business_name: string;
  website_input: string;
  target_domain: string;
  contact_name: string;
  contact_email: string;
  status: string;
  marketing_consent: boolean;
  email_verified_at: Date | null;
  authorized_at: Date | null;
  authorized_method: string | null;
  authorized_by: string | null;
  privacy_version: string;
  created_at: Date;
};

type Finding = {
  check_id: string;
  category: string;
  title: string;
  outcome: string;
  severity_hint: string;
  summary: string;
  recommendation: string | null;
  evidence: Record<string, unknown>;
  observed_at: Date;
};

export default async function StaffRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const staff = await currentStaff();
  if (!staff) redirect('/staff/login');

  const request = await one<Request>(
    `SELECT id, business_name, website_input, target_domain, contact_name, contact_email,
            status::text AS status, marketing_consent, email_verified_at, authorized_at,
            authorized_method::text AS authorized_method, authorized_by, privacy_version, created_at
       FROM requests WHERE id = $1 AND deleted_at IS NULL`,
    [id],
  );
  if (!request) notFound();

  const report = await one<{ status: string; reviewer_notes: string | null; reviewed_by: string | null }>(
    `SELECT status::text AS status, reviewer_notes, reviewed_by FROM reports WHERE request_id = $1`,
    [id],
  );
  const findings = await query<Finding>(
    `SELECT check_id, category, title, outcome, severity_hint, summary, recommendation, evidence,
            observed_at
       FROM findings WHERE request_id = $1 ORDER BY category, check_id`,
    [id],
  );
  const trail = await query<{ actor: string; action: string; created_at: Date }>(
    `SELECT actor, action, created_at FROM audit_log WHERE request_id = $1 ORDER BY id DESC LIMIT 40`,
    [id],
  );

  const reviewable = report && ['draft', 'pending_review'].includes(report.status);

  return (
    <main>
      <div className="wrap">
        <div className="card">
          <p>
            <a href="/staff">← Review queue</a>
          </p>
          <h1 style={{ fontSize: '1.4rem', marginBottom: 2 }}>{request.business_name}</h1>
          <p className="mono hint">{request.target_domain}</p>
          <table>
            <tbody>
              <tr>
                <th>Contact</th>
                <td>
                  {request.contact_name} &lt;{request.contact_email}&gt;
                </td>
              </tr>
              <tr>
                <th>As entered</th>
                <td className="mono">{request.website_input}</td>
              </tr>
              <tr>
                <th>Stage</th>
                <td>{request.status.replace(/_/g, ' ')}</td>
              </tr>
              <tr>
                <th>Email confirmed</th>
                <td>{request.email_verified_at ? new Date(request.email_verified_at).toISOString() : 'no'}</td>
              </tr>
              <tr>
                <th>Authorization</th>
                <td>
                  {request.authorized_at
                    ? `${request.authorized_method} at ${new Date(request.authorized_at).toISOString()}${
                        request.authorized_by ? ` by ${request.authorized_by}` : ''
                      }`
                    : 'not established'}
                </td>
              </tr>
              <tr>
                <th>Marketing consent</th>
                <td>{request.marketing_consent ? 'given' : 'declined'}</td>
              </tr>
              <tr>
                <th>Privacy notice</th>
                <td>{request.privacy_version}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {!request.authorized_at && request.email_verified_at ? (
          <div className="card">
            <h2>Confirm the authorization with the business</h2>
            <p className="hint">
              The confirmed address is not on the domain being reviewed, so this request is held.
              Use this only where you have the authorization in hand — a signed engagement, an email
              from the business, or a call you can attest to. Record what it was; this is the record
              that the review was permitted.
            </p>
            <form action={approveAuthorizationAction}>
              <input type="hidden" name="requestId" value={request.id} />
              <label htmlFor="basis">Basis for authorization</label>
              <textarea id="basis" name="basis" rows={3} required minLength={10} />
              <p style={{ marginTop: 16 }}>
                <button type="submit">Authorize and queue the review</button>
              </p>
            </form>
          </div>
        ) : null}

        <div className="card">
          <h2>Observations ({findings.length})</h2>
          {findings.length === 0 ? (
            <p className="hint">No findings recorded yet.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Check</th>
                  <th>Outcome</th>
                  <th>Observed</th>
                  <th>Recommendation</th>
                </tr>
              </thead>
              <tbody>
                {findings.map((finding) => (
                  <tr key={finding.check_id}>
                    <td>
                      <strong>{finding.title}</strong>
                      <div className="hint mono">{finding.check_id}</div>
                    </td>
                    <td>
                      <span className="pill">{finding.outcome}</span>
                      <div className="hint">{finding.severity_hint}</div>
                    </td>
                    <td>
                      {finding.summary}
                      <details>
                        <summary className="hint">Evidence</summary>
                        <pre>{JSON.stringify(finding.evidence, null, 2)}</pre>
                        <p className="hint">{new Date(finding.observed_at).toISOString()}</p>
                      </details>
                    </td>
                    <td>{finding.recommendation ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {report ? (
          <div className="card">
            <h2>Briefing</h2>
            <p>
              Status: <span className="pill">{report.status}</span>
              {report.reviewed_by ? <span className="hint"> reviewed by {report.reviewed_by}</span> : null}
            </p>
            <p>
              <a className="button-quiet button" href={`/staff/requests/${request.id}/preview`} target="_blank">
                Preview the briefing
              </a>
            </p>
            {reviewable ? (
              <>
                <form action={approveAndDeliverAction}>
                  <input type="hidden" name="requestId" value={request.id} />
                  <label htmlFor="notes">Reviewer summary (appears in the briefing)</label>
                  <textarea id="notes" name="notes" rows={4} />
                  <p className="hint">
                    Approving mints a private expiring link and queues the email to{' '}
                    {request.contact_email}. Nothing else sends it.
                  </p>
                  <p style={{ marginTop: 16 }}>
                    <button type="submit">Approve and deliver</button>
                  </p>
                </form>
                <form action={rejectRequestAction} style={{ marginTop: 28 }}>
                  <input type="hidden" name="requestId" value={request.id} />
                  <label htmlFor="reason">Close without delivering</label>
                  <textarea id="reason" name="reason" rows={2} placeholder="Reason, for the record" />
                  <p style={{ marginTop: 16 }}>
                    <button type="submit" className="button-quiet">
                      Close this request
                    </button>
                  </p>
                </form>
              </>
            ) : (
              <p className="hint">
                {report.reviewer_notes ? `Reviewer summary: ${report.reviewer_notes}` : 'No reviewer summary.'}
              </p>
            )}
          </div>
        ) : null}

        <div className="card">
          <h2>Audit trail</h2>
          <table>
            <tbody>
              {trail.map((entry, index) => (
                <tr key={index}>
                  <td className="hint">{new Date(entry.created_at).toISOString()}</td>
                  <td className="mono">{entry.action}</td>
                  <td>{entry.actor}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card">
          <h2>Delete at the customer&apos;s request</h2>
          <p className="hint">
            Removes the briefing, the findings and the contact details, and revokes every link. The
            audit trail of actions taken is kept, without report contents.
          </p>
          <form action={purgeRequestAction}>
            <input type="hidden" name="requestId" value={request.id} />
            <button type="submit" className="button-quiet">
              Delete this request&apos;s data
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
