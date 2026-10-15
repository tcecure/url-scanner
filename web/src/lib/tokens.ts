import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Tokens are shown once and stored only as a hash, so a database copy or a
 * backup cannot be used to open someone's status page or briefing.
 */
export function newToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function tokensMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** The verification value a customer publishes to prove they control the site. */
export function siteVerificationSecret(): string {
  return randomBytes(24).toString('hex');
}
