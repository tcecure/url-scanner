/**
 * Create or re-password a TCecure reviewer account.
 *
 * Usage: npm run staff -- add "reviewer@tcecure.com" "Full Name" reviewer
 *        npm run staff -- password "reviewer@tcecure.com"
 *
 * The password is read from STAFF_PASSWORD or prompted for, never passed as an
 * argument, so it stays out of shell history and process listings.
 */
import { createInterface } from 'node:readline/promises';

import { query } from '../src/lib/db';
import { hashPassword } from '../src/lib/staff';

async function readPassword(): Promise<string> {
  const fromEnv = process.env.STAFF_PASSWORD;
  if (fromEnv) return fromEnv;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const value = await rl.question('Password: ');
  rl.close();
  return value;
}

async function main() {
  const [command, email, fullName, role] = process.argv.slice(2);
  if (!command || !email) {
    throw new Error('usage: staff add <email> <full name> [role] | staff password <email>');
  }
  if (!/^[^@\s]+@tcecure\.com$/i.test(email)) {
    throw new Error('reviewer accounts must be @tcecure.com addresses');
  }

  const password = await readPassword();
  if (password.length < 14) throw new Error('use a password of at least 14 characters');
  const hash = await hashPassword(password);

  if (command === 'add') {
    if (!fullName) throw new Error('a full name is required');
    await query(
      `INSERT INTO staff_users (email, full_name, role, password_hash)
            VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO UPDATE
          SET full_name = excluded.full_name, role = excluded.role,
              password_hash = excluded.password_hash, disabled_at = NULL`,
      [email.toLowerCase(), fullName, role ?? 'reviewer', hash],
    );
    process.stdout.write(`reviewer ${email} ready\n`);
  } else if (command === 'password') {
    const rows = await query(`UPDATE staff_users SET password_hash = $2 WHERE email = $1 RETURNING id`, [
      email.toLowerCase(),
      hash,
    ]);
    if (rows.length === 0) throw new Error(`no such reviewer: ${email}`);
    process.stdout.write(`password updated for ${email}\n`);
  } else {
    throw new Error(`unknown command: ${command}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
