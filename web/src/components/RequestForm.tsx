'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

type FieldErrors = { field?: string; message: string };

export default function RequestForm() {
  const router = useRouter();
  const loadedAt = useRef<number>(Date.now());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<FieldErrors | null>(null);

  useEffect(() => {
    loadedAt.current = Date.now();
  }, []);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch('/api/requests', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          businessName: form.get('businessName'),
          website: form.get('website'),
          contactName: form.get('contactName'),
          contactEmail: form.get('contactEmail'),
          authorization: form.get('authorization') === 'on',
          marketingConsent: form.get('marketingConsent') === 'on',
          company_website: form.get('company_website') ?? '',
          formLoadedAt: loadedAt.current,
        }),
      });
      const payload = (await response.json()) as { statusToken?: string; message?: string; field?: string };
      if (!response.ok) {
        setError({ message: payload.message ?? 'Something went wrong. Try again.', field: payload.field });
        setSubmitting(false);
        return;
      }
      router.push(`/status/${payload.statusToken}`);
    } catch {
      setError({ message: 'The request could not be sent. Check your connection and try again.' });
      setSubmitting(false);
    }
  }

  const errorFor = (field: string) =>
    error?.field === field ? <p className="field-error">{error.message}</p> : null;

  return (
    <form onSubmit={onSubmit} noValidate>
      {error && !error.field ? (
        <p className="error" role="alert">
          {error.message}
        </p>
      ) : null}

      <label htmlFor="businessName">Business name</label>
      <input id="businessName" name="businessName" type="text" required autoComplete="organization" />
      {errorFor('businessName')}

      <label htmlFor="website">Website</label>
      <input
        id="website"
        name="website"
        type="text"
        inputMode="url"
        placeholder="example.com"
        required
        autoComplete="url"
      />
      <p className="hint">Your public domain name. IP addresses and internal names cannot be reviewed.</p>
      {errorFor('website')}

      <label htmlFor="contactName">Your name</label>
      <input id="contactName" name="contactName" type="text" required autoComplete="name" />
      {errorFor('contactName')}

      <label htmlFor="contactEmail">Work email</label>
      <input id="contactEmail" name="contactEmail" type="email" required autoComplete="email" />
      <p className="hint">We send the confirmation link and the briefing here.</p>
      {errorFor('contactEmail')}

      {/* Left empty by people, filled in by automated submitters. */}
      <div className="visually-hidden" aria-hidden="true">
        <label htmlFor="company_website">Company website</label>
        <input id="company_website" name="company_website" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      <div className="checkbox">
        <input id="authorization" name="authorization" type="checkbox" required />
        <label htmlFor="authorization">
          <span>
            I am authorized to request this review on behalf of this business, and I authorize
            TCecure to observe its public internet presence as described above.
          </span>
        </label>
      </div>
      {errorFor('authorization')}

      <div className="checkbox">
        <input id="marketingConsent" name="marketingConsent" type="checkbox" />
        <label htmlFor="marketingConsent">
          <span>
            Optional: TCecure may contact me about assessment services. This is separate from the
            authorization above and is not required to receive the snapshot.
          </span>
        </label>
      </div>

      <p className="hint">
        Submitting shares your name, work email, business name and website with TCecure. See the{' '}
        <a href="/privacy">privacy notice</a> for how long it is kept and how to have it deleted.
      </p>

      <p style={{ marginTop: 20 }}>
        <button type="submit" disabled={submitting}>
          {submitting ? 'Submitting…' : 'Request my snapshot'}
        </button>
      </p>
    </form>
  );
}
