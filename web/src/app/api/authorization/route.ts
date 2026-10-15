import { NextResponse } from 'next/server';

import { byStatusToken, queueAuthorizationProbe } from '@/lib/requests';
import { clientIp, consume } from '@/lib/rate-limit';
import { hashIp } from '@/lib/audit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { statusToken?: string } | null;
  if (!body?.statusToken) {
    return NextResponse.json({ message: 'Malformed request.' }, { status: 400 });
  }

  // A verification probe is an outbound request, so it is rate limited in its own right.
  const limited = await consume('authz-probe', hashIp(clientIp(request.headers)), 10, 600);
  if (!limited.allowed) {
    return NextResponse.json(
      { message: 'Too many checks. Wait a few minutes and try again.' },
      { status: 429, headers: { 'retry-after': String(limited.retryAfterSeconds ?? 60) } },
    );
  }

  const found = await byStatusToken(body.statusToken);
  if (!found) return NextResponse.json({ message: 'Unknown request.' }, { status: 404 });
  if (!found.email_verified_at) {
    return NextResponse.json({ message: 'Confirm your email address first.' }, { status: 409 });
  }
  if (found.authorized_at) return NextResponse.json({ queued: false, authorized: true });

  const queued = await queueAuthorizationProbe(found.id);
  return NextResponse.json({ queued, authorized: false });
}
