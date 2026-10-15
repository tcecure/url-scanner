import { config } from '@/lib/config';
import { PRIVACY_VERSION } from '@/lib/requests';

export const metadata = { title: 'Privacy notice | TCecure External Exposure Snapshot' };

export default function PrivacyPage() {
  return (
    <main>
      <div className="wrap">
        <div className="card">
          <h1>Privacy notice</h1>
          <p className="hint">Version {PRIVACY_VERSION}</p>

          <h2>What this service collects</h2>
          <p>
            When you request an External Exposure Snapshot, TCecure records your business name, the
            website address you entered, your name and your work email address. We also record whether
            you gave the optional marketing consent, the version of this notice you were shown, a
            one-way hash of the network address you submitted from, and your browser&apos;s user agent
            string. The network address is stored as a hash — not in readable form — and exists only to
            limit abuse of a free service.
          </p>

          <h2>What the review itself collects</h2>
          <p>
            The review reads information your organization already publishes: DNS records for your
            domain, the response from your home page over http and https, the response headers on that
            page, and your TLS certificate. Each observation is stored with the evidence it came from
            and the time it was made. Nothing private is accessed, no account is used, and no part of
            your site beyond the home page is requested.
          </p>

          <h2>Who sees it</h2>
          <p>
            Your findings are seen by TCecure reviewers and by you. They are never published, never
            shown on this website, and are not shared with any third party. The briefing is delivered to
            the work email address you confirmed, or through a private link that stops working after{' '}
            {config.reportLinkTtlHours()} hours.
          </p>

          <h2>How long it is kept</h2>
          <p>
            Requests, findings and briefings are deleted {config.retentionDays()} days after the request
            is made. Audit records of actions taken on a request are kept longer, without the contents
            of the briefing, because they are what lets us show a review was authorized.
          </p>

          <h2>Deleting your information</h2>
          <p>
            You can ask for everything relating to your request to be deleted at any time, before or
            after delivery, by replying to any message from this service or writing to{' '}
            <a href="mailto:privacy@tcecure.com">privacy@tcecure.com</a>. We delete it and confirm.
          </p>

          <h2>Authorization</h2>
          <p>
            No review runs until you confirm your email address and either prove control of the website
            or have your authorization confirmed by a TCecure reviewer. Your authorization statement,
            the method used and the time it was established are recorded with the request.
          </p>

          <h2>Marketing</h2>
          <p>
            The marketing consent on the form is separate and optional. Declining it has no effect on
            your snapshot. If you give it, TCecure may contact you about assessment services, and you
            can withdraw it at any time by replying to any message.
          </p>
        </div>
      </div>
    </main>
  );
}
