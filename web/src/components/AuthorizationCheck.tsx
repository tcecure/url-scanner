'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function AuthorizationCheck({ statusToken }: { statusToken: string }) {
  const router = useRouter();
  const [state, setState] = useState<'idle' | 'checking' | 'queued' | 'error'>('idle');

  async function check() {
    setState('checking');
    const response = await fetch('/api/authorization', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ statusToken }),
    });
    if (!response.ok) {
      setState('error');
      return;
    }
    setState('queued');
    // The probe runs on the worker; refreshing picks up the result once it lands.
    setTimeout(() => router.refresh(), 6000);
  }

  return (
    <p style={{ marginTop: 20 }}>
      <button type="button" className="button-quiet" onClick={check} disabled={state === 'checking'}>
        {state === 'checking' ? 'Looking…' : "I've published it — check now"}
      </button>
      {state === 'queued' ? (
        <span className="hint" style={{ display: 'block', marginTop: 8 }}>
          Looking for the record now. DNS changes can take a few minutes to become visible; this page
          updates itself, and you can also come back later.
        </span>
      ) : null}
      {state === 'error' ? (
        <span className="field-error">That check could not be started. Try again in a minute.</span>
      ) : null}
    </p>
  );
}
