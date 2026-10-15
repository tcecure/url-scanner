import { createHash } from 'node:crypto';
import { query } from '@/lib/db';

/** Append-only record of who did what to a request. Never holds a token or a secret. */
export async function audit(
  action: string,
  options: { actor?: string; requestId?: string | null; detail?: Record<string, unknown> } = {},
): Promise<void> {
  await query(
    `INSERT INTO audit_log (request_id, actor, action, detail) VALUES ($1, $2, $3, $4::jsonb)`,
    [options.requestId ?? null, options.actor ?? 'system', action, JSON.stringify(options.detail ?? {})],
  );
}

/**
 * Submitter addresses are kept as a keyed hash: enough to rate-limit and to
 * investigate abuse, without retaining a visitor's IP in clear text.
 */
export function hashIp(ip: string): string {
  const salt = process.env.IP_HASH_SALT ?? '';
  return createHash('sha256').update(`${salt}:${ip}`, 'utf8').digest('hex');
}
