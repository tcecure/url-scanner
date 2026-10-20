import { NextResponse } from 'next/server';

import { createRequest } from '@/lib/requests';
import { clientIp } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: 'Malformed request.' }, { status: 400 });
  }

  const outcome = await createRequest(body, {
    ip: clientIp(request.headers),
    userAgent: request.headers.get('user-agent') ?? '',
  });

  if (!outcome.ok) {
    return NextResponse.json({ message: outcome.message, field: outcome.field }, { status: outcome.status });
  }
  return NextResponse.json(
    { statusToken: outcome.statusToken, requiresStaffApproval: outcome.requiresStaffApproval },
    { status: 201 },
  );
}
