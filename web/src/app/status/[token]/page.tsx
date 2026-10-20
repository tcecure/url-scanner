import { notFound } from 'next/navigation';

import { byStatusToken } from '@/lib/requests';

export const dynamic = 'force-dynamic';

const STAGES: Record<string, { label: string; blurb: string }> = {
  awaiting_email_verification: {
    label: 'Waiting on your email confirmation',
    blurb: 'We sent a confirmation link to your work email. Open it and the review begins.',
  },
  awaiting_authorization: {
    label: 'With a TCecure reviewer',
    blurb: 'A TCecure reviewer is confirming the authorization for this request before anything runs.',
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
  const heldForStaff =
    request.status === 'awaiting_authorization' && Boolean(request.email_verified_at) && !request.authorized_at;

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
                Request received <span className="pill pill-done">done</span>
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
                Public review{' '}
                {['awaiting_review', 'delivered'].includes(request.status) ? (
                  <span className="pill pill-done">done</span>
                ) : (
                  <span className="pill">{request.status === 'running' ? 'in progress' : 'not started'}</span>
                )}
              </span>
            </li>
            <li>
              <span className="step-no">4</span>
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
          <p className="hint">Nothing else is needed from you — there is no DNS record or file to publish.</p>
        </div>

        {heldForStaff ? (
          <div className="card">
            <h2>A TCecure reviewer is confirming your authorization</h2>
            <p>
              Your email address is not on <span className="mono">{request.target_domain}</span>, so the
              authorization for this request is not clear enough to act on. A TCecure reviewer will
              confirm it with the business directly before the review runs. Nothing happens to your site
              in the meantime, and there is nothing for you to publish or change.
            </p>
            <p className="hint">
              If this is urgent, reply to your confirmation email and say who at the business authorized
              the review.
            </p>
          </div>
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
