import Link from 'next/link';

import { verifyEmail } from '@/lib/requests';

export const dynamic = 'force-dynamic';

export default async function VerifyPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { outcome, held } = await verifyEmail(token);

  return (
    <main>
      <div className="wrap">
        <div className="card">
          {outcome === 'verified' ? (
            <>
              <h2>Email confirmed</h2>
              {held ? (
                <p>
                  Thank you. Your address is not on the domain you asked us to review, so a TCecure
                  reviewer will confirm the authorization with the business before anything runs.
                  There is nothing further for you to do — no DNS record, no file, and no change to
                  your website.
                </p>
              ) : (
                <p>
                  Thank you — that was the last thing we needed. Your review is queued and takes a
                  couple of minutes; a TCecure analyst then reviews the findings before you are sent
                  a private briefing link. Nothing is needed from you in the meantime.
                </p>
              )}
              <p className="notice">
                Your status page shows the progress. Can&apos;t find the link? Reply to the
                confirmation email and a TCecure reviewer will send it again.
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
