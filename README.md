# TCecure External Exposure Snapshot

A free, authorization-gated snapshot of what a business already publishes to the
public internet, offered by TCecure at `scan.tcecure.com`. A prospect asks for a
review of their own website; the service confirms the request came from them,
runs a short fixed list of public observations, and a TCecure reviewer approves
the briefing before anything is delivered. The form is deliberately low
friction: the requester submits once and is never asked to change DNS, publish a
file or give TCecure access to anything.

It is **not** a penetration test and not a vulnerability scanner. There is no
crawling, no port scanning, no exploitation and no authenticated testing, and
findings are never shown publicly.

## What it observes

| Area | Observation |
|---|---|
| DNS | Public records for the domain |
| Email | SPF policy, DMARC policy |
| HTTPS | Whether the site answers on 443, and how HTTP redirects to it |
| Certificate | Validity, hostname match, expiry |
| HTTP headers | A fixed set of security headers, and software version disclosure |

Every finding records what was observed, when it was observed, the evidence
behind it, and — separately — what TCecure recommends. An absent control is
reported as absent, never as a proven vulnerability.

## How a request proceeds

1. The prospect submits their business, website, name and work email, ticks the
   authorization box, and optionally opts in to marketing contact.
2. They confirm the email address from a link. That is the last thing asked of
   them.
3. A confirmed work email on the domain being reviewed carries the
   authorization given on the form, and the snapshot is queued. Anything else —
   an address on another domain — is unclear: the request is held, a reviewer is
   alerted, and nothing is observed until that reviewer records the basis on
   which the business authorized the review.
4. The worker runs the observations above, bounded in time, size and redirects.
5. A reviewer reads the briefing, approves it, and delivery goes out as a
   private expiring link from a TCecure address. Nothing is sent before that.

## Layout

```
web/      Next.js (TypeScript, App Router): public flow + staff review UI
worker/   Python worker: the only component that contacts the public internet
db/       Forward-only SQL migrations
ops/      VM provisioning, nftables, nginx vhost
docs/     Install, operations, security model, runbook
```

## Running it

See [docs/install.md](docs/install.md) for a deployment and
[docs/development.md](docs/development.md) for local work. Operational
procedures — migrations, backup, restore, update, rollback — are in
[docs/operations.md](docs/operations.md), and the isolation and abuse controls
are described in [docs/security.md](docs/security.md).
