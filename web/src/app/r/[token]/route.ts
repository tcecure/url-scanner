import { audit } from '@/lib/audit';
import { one, query } from '@/lib/db';
import { hashToken } from '@/lib/tokens';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Row = { request_id: string; html: string; expired: boolean; status: string };

const GONE = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>Link unavailable | TCecure</title>
<style>body{font-family:-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;background:#f5f6fa;color:#16181d;margin:0}
.band{background:#282973;color:#fff;padding:18px 20px;font-weight:700}
.card{max-width:640px;margin:28px auto;background:#fff;border:1px solid #dfe2ea;border-radius:10px;padding:24px}</style>
</head><body><div class="band">TCecure</div><div class="card">
<h2>This link is no longer available</h2>
<p>Briefing links expire so a forwarded message cannot be read indefinitely. Reply to the email it
arrived in and a TCecure reviewer will issue a fresh one.</p>
</div></body></html>`;

/**
 * Private delivery of an approved briefing.
 *
 * The briefing is already a complete, self-contained document, so it is served
 * as-is rather than embedded in the marketing site. An expired, revoked or
 * unapproved report is indistinguishable from an unknown link.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const tokenHash = hashToken(token);
  const row = await one<Row>(
    `SELECT r.request_id, r.html, r.status::text AS status, t.expires_at < now() AS expired
       FROM tokens t
       JOIN reports r ON r.request_id = t.request_id
      WHERE t.purpose = 'report_link' AND t.token_hash = $1 AND t.revoked_at IS NULL`,
    [tokenHash],
  );

  const headers = {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store, private',
    'x-robots-tag': 'noindex, nofollow',
    'referrer-policy': 'no-referrer',
    // A self-contained document with no scripts of its own.
    'content-security-policy':
      "default-src 'none'; img-src data:; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'",
  };

  if (!row || row.expired || !['approved', 'delivered'].includes(row.status)) {
    await audit('report.link_rejected', {
      requestId: row?.request_id ?? null,
      detail: { reason: !row ? 'unknown' : row.expired ? 'expired' : 'not_approved' },
    });
    return new Response(GONE, { status: 404, headers });
  }

  await query(`UPDATE tokens SET used_at = coalesce(used_at, now()) WHERE token_hash = $1`, [tokenHash]);
  await audit('report.viewed', { requestId: row.request_id, actor: 'recipient' });
  return new Response(row.html, { status: 200, headers });
}
