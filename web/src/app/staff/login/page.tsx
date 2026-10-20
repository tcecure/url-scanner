import { redirect } from 'next/navigation';

import { loginAction } from '@/app/staff/actions';
import { currentStaff } from '@/lib/staff';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Reviewer sign in | TCecure', robots: { index: false, follow: false } };

export default async function StaffLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  if (await currentStaff()) redirect('/staff');

  async function submit(form: FormData) {
    'use server';
    const error = await loginAction(null, form);
    if (error) redirect(`/staff/login?error=1`);
  }

  return (
    <main>
      <div className="wrap" style={{ maxWidth: 440 }}>
        <div className="card">
          <h1 style={{ fontSize: '1.3rem' }}>Reviewer sign in</h1>
          <p className="hint">TCecure staff only. All actions on a request are recorded.</p>
          {error ? (
            <p className="error" role="alert">
              Those credentials were not accepted.
            </p>
          ) : null}
          <form action={submit}>
            <label htmlFor="email">Email</label>
            <input id="email" name="email" type="email" required autoComplete="username" />
            <label htmlFor="password">Password</label>
            <input id="password" name="password" type="password" required autoComplete="current-password" />
            <p style={{ marginTop: 20 }}>
              <button type="submit">Sign in</button>
            </p>
          </form>
        </div>
      </div>
    </main>
  );
}
