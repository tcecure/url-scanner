import { notFound } from 'next/navigation';

import AuthorizationCheck from '@/components/AuthorizationCheck';
import { config } from '@/lib/config';
import { byStatusToken } from '@/lib/requests';
import { emailMatchesTarget } from '@/lib/target';

export const dynamic = 'force-dynamic';

const STAGES: Record<string, { label: string; blurb: string }> = {
  awaiting_email_verification: {
    label: 'Waiting on your email confirmation',
    blurb: 'We sent a confirmation link to your work email. Open it to continue.',
  },
  awaiting_authorization: {
    label: 'Waiting on website verification',
    blurb: 'Publish one of the two values below so we can confirm you control the site.',
  },
  queued: { label: 'Queued', blurb: 'Your review is in the queue and starts shortly.' },
  running: { label: 'Review in progress', blurb: 'We are observing your public records now.' },
  awaiting_review: {
    label: 'With a TCecure analyst',
    blurb: 'The observations are in and an analyst is reviewing them before anything is sent.',
  },
  delivered: {
    label: 'Briefing sent',
    blurb: 'Check your work email for the private link to your briefing.',
  },
  rejected: {
    label: 'Closed',
    blurb: 'A TCecure reviewer closed this request. Reply to your confirmation email with any questions.',
  },
  failed: {
    label: 'Could not be completed',
    blurb: 'Something prevented the review from finishing. A TCecure reviewer has been notified.',
  },
  expired: { label: 'Expired', blurb: 'This request has passed its retention window.' },
};

export default async function StatusPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const request = await byStatusToken(token);
  if (!request) notFound();

  const stage = STAGES[request.status] ?? { label: request.status, blurb: '' };
  const needsStaff = !emailMatchesTarget(request.contact_email, request.target_domain);
  const dnsName = `${config.siteVerificationDnsName()}.${request.target_domain}`;
  const dnsValue = `${config.siteVerificationDnsName()}=${request.verification_secret}`;

  return (
    <main>
      <div className="wrap">
        <div className="card">
          <p className="pill">{stage.label}</p>
          <h2 style={{ marginBottom: 4 }}>{request.business_name}</h2>
          <p className="hint mono">{request.target_domain}</p>
          <p>{stage.blurb}</p>
          <p className="hint">
            Keep this page bookmarked — it is the only place this request&apos;s progress is shown, and
            the address itself is what identifies it.
          </p>
        </div>

        <div className="card">
          <h2>Progress</h2>
          <ul className="steps">
            <li>
              <span className="step-no">1</span>
              <span>
                Request received{' '}
                <span className="pill pill-done">done</span>
              </span>
            </li>
            <li>
              <span className="step-no">2</span>
              <span>
                Email address confirmed{' '}
                {request.email_verified_at ? (
                  <span className="pill pill-done">done</span>
                ) : (
                  <span className="pill pill-wait">waiting on you</span>
                )}
              </span>
            </li>
            <li>
              <span className="step-no">3</span>
              <span>
                Website control verified{' '}
                {request.authorized_at ? (
                  <span className="pill pill-done">
                    {request.authorized_method === 'staff_approval' ? 'approved by TCecure' : 'done'}
                  </span>
                ) : (
                  <span className="pill pill-wait">{needsStaff ? 'with TCecure' : 'waiting on you'}</span>
                )}
              </span>
            </li>
            <li>
              <span className="step-no">4</span>
              <span>
                Public review{' '}
                {['awaiting_review', 'delivered'].includes(request.status) ? (
                  <span className="pill pill-done">done</span>
                ) : (
                  <span className="pill">{request.status === 'running' ? 'in progress' : 'not started'}</span>
                )}
              </span>
            </li>
            <li>
              <span className="step-no">5</span>
              <span>
                Analyst review and delivery{' '}
                {request.status === 'delivered' ? (
                  <span className="pill pill-done">sent</span>
                ) : (
                  <span className="pill">pending</span>
                )}
              </span>
            </li>
          </ul>
        </div>

        {request.email_verified_at && !request.authorized_at ? (
          needsStaff ? (
            <div className="card">
              <h2>A TCecure reviewer is confirming your authorization</h2>
              <p>
                Your email address is not on <span className="mono">{request.target_domain}</span>, so we
                do not assume it speaks for the business. A TCecure reviewer will confirm the
                authorization with you directly before the review runs. Nothing happens to your site in
                the meantime.
              </p>
              <p className="hint">
                If you do control the domain, you can also publish either value below and the review
                proceeds without waiting for us.
              </p>
              <VerificationInstructions dnsName={dnsName} dnsValue={dnsValue} secret={request.verification_secret} />
              <AuthorizationCheck statusToken={token} />
            </div>
          ) : (
            <div className="card">
              <h2>Prove you control the website</h2>
              <p>
                Choose whichever is easier. Once it is live, use the button below — we look for it, and
                the review starts on its own.
              </p>
              <VerificationInstructions dnsName={dnsName} dnsValue={dnsValue} secret={request.verification_secret} />
              <AuthorizationCheck statusToken={token} />
            </div>
          )
        ) : null}

        <div className="card">
          <h2>What you will receive</h2>
          <p>
            A short briefing listing what was observed about your public records, each with the evidence
            and the time it was seen, and separately what TCecure recommends you consider. It is a
            limited public review — not a penetration test or a comprehensive vulnerability assessment.
            Findings are never published.
          </p>
        </div>
      </div>
    </main>
  );
}

function VerificationInstructions({
  dnsName,
  dnsValue,
  secret,
}: {
  dnsName: string;
  dnsValue: string;
  secret: string;
}) {
  return (
    <>
      <h3>Option 1 — a DNS TXT record</h3>
      <p className="hint">Add this at your DNS provider. It can be removed once verification completes.</p>
      <pre>{`Type:  TXT
Name:  ${dnsName}
Value: ${dnsValue}`}</pre>

      <h3>Option 2 — a file on your website</h3>
      <p className="hint">
        Publish a text file at this path containing only the value. Either http or https is fine.
      </p>
      <pre>{`Path:     ${config.siteVerificationPath()}
Contents: ${secret}`}</pre>
    </>
  );
}
