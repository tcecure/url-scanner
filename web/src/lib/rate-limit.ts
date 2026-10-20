import { query } from '@/lib/db';

export type Decision = { allowed: boolean; reason?: string; retryAfterSeconds?: number };

/**
 * Fixed-window counters kept in Postgres.
 *
 * The web tier runs as a single container today, but the limits must survive a
 * restart and a second replica, so they are not held in memory.
 */
export async function consume(
  scope: string,
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<Decision> {
  const bucket = `${scope}:${key.toLowerCase()}`;
  const rows = await query<{ count: number; window_start: Date }>(
    `INSERT INTO rate_limits (bucket, window_start, count)
          VALUES ($1, to_timestamp(floor(extract(epoch from now()) / $2::bigint) * $2::bigint), 1)
     ON CONFLICT (bucket, window_start)
       DO UPDATE SET count = rate_limits.count + 1
       RETURNING count, window_start`,
    [bucket, windowSeconds],
  );
  const row = rows[0];
  if (!row) return { allowed: true };
  if (row.count <= limit) return { allowed: true };

  const elapsed = (Date.now() - new Date(row.window_start).getTime()) / 1000;
  return {
    allowed: false,
    reason: `${scope} limit reached`,
    retryAfterSeconds: Math.max(1, Math.ceil(windowSeconds - elapsed)),
  };
}

/** Best-effort client address; the edge proxy is the only trusted hop. */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  return headers.get('x-real-ip')?.trim() || 'unknown';
}
