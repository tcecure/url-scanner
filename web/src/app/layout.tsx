import type { Metadata } from 'next';
import './globals.css';

// Every document is rendered per request so the CSP nonce minted in
// middleware reaches Next's bootstrap scripts; a prerendered page carries no
// nonce and its scripts are refused.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'External Exposure Snapshot | TCecure',
  description:
    'A free, limited review of what your business exposes publicly on the internet, performed and reviewed by TCecure.',
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="masthead">
          <div className="masthead-inner">
            <a href="https://tcecure.com" aria-label="TCecure">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand/tcecure-logo-white.png" alt="TCecure" />
            </a>
          </div>
        </header>
        {children}
        <footer>
          <div className="wrap">
            <p>
              The External Exposure Snapshot is a TCecure service. It is a limited review of
              information your organization already publishes to the internet. It is not a
              penetration test, a comprehensive vulnerability assessment, or a compliance
              certification, and it is performed only with your written authorization.
            </p>
            <p>
              <a href="/privacy">Privacy notice</a> &middot;{' '}
              <a href="https://tcecure.com">tcecure.com</a> &middot; &copy; {new Date().getFullYear()} TCecure
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
