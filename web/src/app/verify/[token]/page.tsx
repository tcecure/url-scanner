import Link from 'next/link';

import { verifyEmail } from '@/lib/requests';

export const dynamic = 'force-dynamic';

export default async function VerifyPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { outcome } = await verifyEmail(token);

  return (
    <main>
      <div className="wrap">
        <div className="card">
          {outcome === 'verified' ? (
            <>
              <h2>Email confirmed</h2>
              <p>
                Thank you. The next step is proving you control the website, so that no review ever
                runs against a site on someone else&apos;s say-so. Return to the status page from the
                link you were given when you submitted the request to see how.
              </p>
              <p className="notice">
                Can&apos;t find your status link? Reply to the confirmation email and a TCecure
                reviewer will send it again.
              </p>
            </>
          ) : outcome === 'expired' ? (
            <>
              <h2>That link has expired</h2>
              <p>
                Confirmation links are short-lived. Submit the form again and a new one will be sent
                to the same address.
              </p>
              <p>
                <Link className="button" href="/#request">
                  Start again
                </Link>
              </p>
            </>
          ) : (
            <>
              <h2>That link is not valid</h2>
              <p>
                It may have been copied incompletely, or the request may have been removed. Submitting
                the form again will send a fresh link.
              </p>
              <p>
                <Link className="button" href="/#request">
                  Start again
                </Link>
              </p>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
