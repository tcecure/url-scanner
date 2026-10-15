import { audit } from '@/lib/audit';
import { one } from '@/lib/db';
import { currentStaff } from '@/lib/staff';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** The reviewer's view of the briefing exactly as the customer would receive it. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const staff = await currentStaff();
  if (!staff) return new Response('Not found', { status: 404 });

  const row = await one<{ html: string }>(`SELECT html FROM reports WHERE request_id = $1`, [id]);
  if (!row) return new Response('Not found', { status: 404 });

  await audit('report.previewed', { actor: staff.email, requestId: id });
  return new Response(row.html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store, private',
      'x-robots-tag': 'noindex, nofollow',
    },
  });
}
