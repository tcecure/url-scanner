import { redirect } from 'next/navigation';

import { logoutAction } from '@/app/staff/actions';
import { query } from '@/lib/db';
import { currentStaff } from '@/lib/staff';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Review queue | TCecure', robots: { index: false, follow: false } };

type Row = {
  id: string;
  business_name: string;
  target_domain: string;
  contact_email: string;
  status: string;
  authorized_method: string | null;
  authorized_at: Date | null;
  email_verified_at: Date | null;
  created_at: Date;
  report_status: string | null;
  finding_count: number;
};

const WAITING_ON_US = new Set(['awaiting_review']);

export default async function StaffQueuePage() {
  const staff = await currentStaff();
  if (!staff) redirect('/staff/login');

  const rows = await query<Row>(
    `SELECT r.id, r.business_name, r.target_domain, r.contact_email, r.status::text AS status,
            r.authorized_method::text AS authorized_method, r.authorized_at, r.email_verified_at,
            r.created_at, rep.status::text AS report_status,
            (SELECT count(*)::int FROM findings f WHERE f.request_id = r.id) AS finding_count
       FROM requests r
  LEFT JOIN reports rep ON rep.request_id = r.id
      WHERE r.deleted_at IS NULL
   ORDER BY (r.status = 'awaiting_review') DESC, r.created_at DESC
      LIMIT 200`,
  );

  const needingReview = rows.filter((row) => WAITING_ON_US.has(row.status)).length;
  const needingApproval = rows.filter(
    (row) => row.status === 'awaiting_authorization' && row.email_verified_at,
  ).length;

  return (
    <main>
      <div className="wrap">
        <div className="card" style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
          <div>
            <h1 style={{ fontSize: '1.3rem', margin: 0 }}>Review queue</h1>
            <p className="hint" style={{ margin: 0 }}>
              Signed in as {staff.full_name} ({staff.role})
            </p>
          </div>
          <form action={logoutAction}>
            <button type="submit" className="button-quiet">
              Sign out
            </button>
          </form>
        </div>

        <div className="card">
          <p>
            <strong>{needingReview}</strong> briefing{needingReview === 1 ? '' : 's'} awaiting your
            review, <strong>{needingApproval}</strong> awaiting an authorization decision. Nothing is
            delivered to a customer until a reviewer approves it here.
          </p>
        </div>

        <div className="card">
          <table>
            <thead>
              <tr>
                <th>Business</th>
                <th>Domain</th>
                <th>Stage</th>
                <th>Authorization</th>
                <th>Findings</th>
                <th>Requested</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <a href={`/staff/requests/${row.id}`}>{row.business_name}</a>
                    <div className="hint">{row.contact_email}</div>
                  </td>
                  <td className="mono">{row.target_domain}</td>
                  <td>
                    <span className={`pill ${WAITING_ON_US.has(row.status) ? 'pill-wait' : ''}`}>
                      {row.status.replace(/_/g, ' ')}
                    </span>
                    {row.report_status ? <div className="hint">report: {row.report_status}</div> : null}
                  </td>
                  <td>
                    {row.authorized_at ? (
                      <span className="pill pill-done">{row.authorized_method?.replace(/_/g, ' ')}</span>
                    ) : row.email_verified_at ? (
                      <span className="pill pill-wait">unverified</span>
                    ) : (
                      <span className="pill">email unconfirmed</span>
                    )}
                  </td>
                  <td>{row.finding_count || '—'}</td>
                  <td className="hint">{new Date(row.created_at).toISOString().slice(0, 16).replace('T', ' ')}</td>
                </tr>
              ))}
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6}>No requests yet.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
