import RequestForm from '@/components/RequestForm';

export default function LandingPage() {
  return (
    <>
      <section className="hero">
        <div className="wrap">
          <p className="eyebrow">TCecure</p>
          <h1>Free External Exposure Snapshot</h1>
          <p>
            See what your business looks like from the outside. A TCecure analyst reviews what your
            website and email domain already publish, then sends you a short briefing in plain
            language — what was observed, what it means, and what to do about it.
          </p>
          <p>
            No software to install, nothing to open on your network, and no charge.
          </p>
        </div>
      </section>

      <main>
        <div className="wrap">
          <div className="grid">
            <div className="card">
              <h2>What we look at</h2>
              <ul>
                <li>Public DNS records for your domain</li>
                <li>Email protection: SPF and DMARC policy</li>
                <li>Whether your site is reachable over HTTPS, and how it redirects</li>
                <li>Your certificate: who issued it, what it covers, when it expires</li>
                <li>A set of security headers on your home page</li>
              </ul>
              <p className="hint">
                Every observation is recorded with the evidence behind it and the time it was made.
              </p>
            </div>
            <div className="card">
              <h2>What we do not do</h2>
              <ul>
                <li>No penetration testing and no exploitation</li>
                <li>No port scanning and no password guessing</li>
                <li>No logging in, and no access to anything private</li>
                <li>No crawling past your home page</li>
              </ul>
              <p className="hint">
                The review only reads what any visitor to your site can already see.
              </p>
            </div>
            <div className="card">
              <h2>How it works</h2>
              <ol className="steps" style={{ listStyle: 'none' }}>
                <li><span className="step-no">1</span><span>You submit the form and confirm your email address.</span></li>
                <li><span className="step-no">2</span><span>You prove you control the website, with a DNS record or a file.</span></li>
                <li><span className="step-no">3</span><span>The review runs — it takes a couple of minutes.</span></li>
                <li><span className="step-no">4</span><span>A TCecure analyst reviews the findings before anything is sent.</span></li>
                <li><span className="step-no">5</span><span>You get a private briefing link by email.</span></li>
              </ol>
            </div>
          </div>

          <div className="card" id="request">
            <h2>Request your snapshot</h2>
            <p className="hint">
              Only someone authorized to speak for the business should submit this request.
              Findings are never published and are shared only with you.
            </p>
            <RequestForm />
          </div>
        </div>
      </main>
    </>
  );
}
