import { config } from '@/lib/config';
import { PRIVACY_VERSION } from '@/lib/requests';

export const metadata = { title: 'Privacy notice | TCecure External Exposure Snapshot' };

const MAIN_POLICY = 'https://staging.beeconnect.agency/wp-content/uploads/2024/01/TCecure-Privacy-Policy.pdf';

export default function PrivacyPage() {
  return (
    <main>
      <div className="wrap">
        <div className="card">
          <h1>Privacy notice</h1>
          <p className="hint">Version {PRIVACY_VERSION}</p>

          <p>
            TCecure, LLC wants you to be familiar with how we collect, use, and disclose information.
            This notice describes our practices in connection with information collected through the
            External Exposure Snapshot at{' '}
            <span className="mono">{new URL(config.publicBaseUrl()).host}</span> (the
            &ldquo;Service&rdquo;). It sits alongside, and does not replace, the{' '}
            <a href={MAIN_POLICY}>TCecure Privacy Policy</a>, which covers{' '}
            <a href="https://tcecure.com">tcecure.com</a> and our other services. Where this notice
            is silent, that policy applies.
          </p>

          <h2>Personal Information</h2>
          <p>
            &ldquo;Personal Information&rdquo; is information that identifies you as an individual or
            relates to an identifiable individual. The Personal Information we collect is what you
            type into the request form and nothing else:
          </p>
          <ul>
            <li>Business name</li>
            <li>Website address to be reviewed</li>
            <li>Your name</li>
            <li>Your work email address</li>
            <li>Your authorization statement, and whether you consented to marketing contact</li>
          </ul>
          <p>
            The Service does not ask for a postal address, a telephone number or payment card
            information, and there is nothing to pay.
          </p>

          <h3>Use of Personal Information</h3>
          <ul>
            <li>To confirm your email address, which is the only step we need from you.</li>
            <li>
              To decide whether the review is authorized. A confirmed address on the domain being
              reviewed carries the authorization you gave on the form; any other address is held for
              a TCecure reviewer to confirm with the business before anything is observed.
            </li>
            <li>To carry out the review you asked for and prepare the briefing.</li>
            <li>To send you the briefing and to answer you about your request.</li>
            <li>To limit abuse of a free service.</li>
            <li>
              To contact you about TCecure assessment services, only if you gave the optional
              marketing consent.
            </li>
          </ul>

          <h3>Disclosure of Personal Information</h3>
          <p>
            Your information and your findings are seen by TCecure reviewers and by you. They are
            never published, never shown on this website, and are not sold or shared with any third
            party for that party&apos;s own purposes. Your Personal Information may be disclosed to
            our service providers, who provide services such as infrastructure hosting and email
            delivery; the Service uses no advertising, analytics or data-enrichment providers. We may
            also use and disclose Personal Information as described under &ldquo;Other Uses and
            Disclosures&rdquo; in the <a href={MAIN_POLICY}>TCecure Privacy Policy</a> — for example
            to comply with applicable law or to protect our rights, privacy, safety or property.
          </p>

          <h2>What the review observes</h2>
          <p>
            The review reads what the domain you named already publishes to anyone: its DNS records,
            including SPF and DMARC; the response and response headers from its home page over http
            and https; and its TLS certificate. Each observation is stored with the evidence it came
            from and the time it was made.
          </p>
          <p>
            The Service never asks you to change your DNS, publish a file, or give TCecure any access
            to your website, and it is not a penetration test: nothing private is accessed, no
            account or password is used, no port scan is run, and no part of your site beyond the
            home page is requested.
          </p>

          <h2>Report delivery</h2>
          <p>
            No findings are released until a TCecure analyst has reviewed them. Once approved, the
            briefing is delivered to the work email address you confirmed, as a private link that
            stops working after {config.reportLinkTtlHours()} hours. Links that are unknown or
            expired are refused without saying which.
          </p>

          <h2>Other Information</h2>
          <p>
            &ldquo;Other Information&rdquo; is information that does not reveal your specific
            identity. From a request we keep a one-way salted hash of the network address you
            submitted from — not the address itself — your browser&apos;s user agent string, the
            version of this notice you were shown, and the times at which each step happened. The
            hash and the user agent exist to limit abuse.
          </p>
          <p>
            The customer pages of the Service set no cookies and use no pixel tags, analytics or
            similar technologies, so there is nothing here to opt out of. The staff pages, which are
            not public, set one session cookie for signed-in TCecure reviewers.
          </p>

          <h2>Service providers</h2>
          <p>
            The Service runs on infrastructure operated for TCecure by DigitalRCC, its training
            affiliate, and the database is not shared with any other application. Its TLS certificate
            comes from Let&apos;s Encrypt, which receives only the hostname of this site. Mail is sent
            through TCecure&apos;s email provider; while no sending identity is configured, messages
            are recorded in the database and nothing is sent at all.
          </p>

          <h2>Security</h2>
          <p>
            We seek to use reasonable organizational, technical, and administrative measures designed
            to protect Personal Information within our organization. The component that contacts
            websites runs on a separate, network-isolated machine that cannot reach anything else,
            submitted addresses are validated before any connection is made, briefings are private
            and expiring, and every action taken on a request is recorded. No information
            transmission or storage system can be guaranteed to be fully secure; if you believe your
            interaction with us is no longer secure, please contact us as set out below.
          </p>

          <h2>Retention, backups and deletion</h2>
          <p>
            Requests, findings, briefings and the email sent about them are deleted{' '}
            {config.retentionDays()} days after the request completes. The audit record of what was
            done to a request — the action, who took it, including the address that was confirmed,
            and when — is kept longer without the contents of the briefing, because it is what lets
            us show a review was authorized.
          </p>
          <p>
            The database is backed up nightly to the same machine. Backups are restricted to
            administrators and deleted after 14 days, which is deliberately shorter than the
            retention period above: a deletion is applied to the live database at once, and any copy
            of it in a backup ages out rather than being edited.
          </p>
          <p>
            You can ask for everything relating to your request to be deleted at any time, before or
            after delivery, by replying to any message from the Service or writing to{' '}
            <a href="mailto:privacy@tcecure.com">privacy@tcecure.com</a>. We delete it and confirm.
          </p>

          <h2>Choices and access</h2>
          <p>
            The marketing consent on the form is separate and optional. Declining it has no effect on
            your snapshot, and you can withdraw it at any time by replying to any message from us or
            using the unsubscribe mechanism in marketing email. You can also ask us what we hold
            about your request, or ask for it to be deleted, at the address above.
          </p>

          <h2>Use of the Service by minors</h2>
          <p>
            The Service is directed to businesses and is not directed to individuals under the age of
            thirteen, and we do not knowingly collect Personal Information from such individuals.
          </p>

          <h2>Jurisdictional issues</h2>
          <p>
            The Service is controlled and operated by us from the United States and is not intended
            to subject us to the laws or jurisdiction of any state, country, or territory other than
            that of the United States.
          </p>

          <h2>Updates to this notice</h2>
          <p>
            We may change this notice. The version shown at the top of this page changes with it, and
            the version you were shown is recorded with your request. Any change becomes effective
            when it is posted here.
          </p>

          <h2>Contact us</h2>
          <p>
            Questions about this notice, or about a request you made, go to{' '}
            <a href="mailto:privacy@tcecure.com">privacy@tcecure.com</a>.
          </p>
        </div>
      </div>
    </main>
  );
}
