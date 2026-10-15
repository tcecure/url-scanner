import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { cookies } from 'next/headers';

import { one, query } from '@/lib/db';
import { hashToken, newToken } from '@/lib/tokens';

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

const SESSION_COOKIE = 'tce_staff';
const SESSION_HOURS = 8;

/** scrypt with a per-user salt, stored as `scrypt$<salt>$<key>`. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function passwordMatches(password: string, stored: string): Promise<boolean> {
  const [scheme, salt, key] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !key) return false;
  const expected = Buffer.from(key, 'base64');
  const actual = await scrypt(password, Buffer.from(salt, 'base64'), expected.length);
  return timingSafeEqual(expected, actual);
}

export type StaffUser = { id: string; email: string; full_name: string; role: string };

export async function signIn(email: string, password: string): Promise<StaffUser | null> {
  const user = await one<StaffUser & { password_hash: string }>(
    `SELECT id, email, full_name, role, password_hash
       FROM staff_users WHERE email = $1 AND disabled_at IS NULL`,
    [email.trim().toLowerCase()],
  );
  // Hash regardless, so a missing account and a wrong password take the same time.
  const reference = user?.password_hash ?? (await hashPassword(randomBytes(16).toString('hex')));
  const ok = await passwordMatches(password, reference);
  if (!user || !ok) return null;

  const token = newToken();
  await query(
    `INSERT INTO staff_sessions (staff_user_id, token_hash, expires_at)
          VALUES ($1, $2, now() + make_interval(hours => $3))`,
    [user.id, hashToken(token), SESSION_HOURS],
  );
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_HOURS * 3600,
  });
  return { id: user.id, email: user.email, full_name: user.full_name, role: user.role };
}

export async function currentStaff(): Promise<StaffUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const user = await one<StaffUser>(
    `UPDATE staff_sessions s
        SET last_seen_at = now()
       FROM staff_users u
      WHERE s.staff_user_id = u.id
        AND s.token_hash = $1
        AND s.expires_at > now()
        AND u.disabled_at IS NULL
  RETURNING u.id, u.email, u.full_name, u.role`,
    [hashToken(token)],
  );
  return user;
}

export async function signOut(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await query(`DELETE FROM staff_sessions WHERE token_hash = $1`, [hashToken(token)]);
  jar.delete(SESSION_COOKIE);
}
