# Security model

The service accepts a hostname from an anonymous member of the public and then
makes requests to it. That is a server-side request forgery primitive by
construction, so the controls below are the product, not decoration. They are
enforced twice: in application code, and again in the worker VM's own firewall.

## What a target may be

A target is accepted only if it is an ordinary public website:

- A DNS hostname. IP literals are refused outright, in every notation —
  dotted-quad, decimal (`2130706433`), hexadecimal (`0x7f000001`), octal-ish
  (`0177.0.0.1`) and short forms (`127.1`).
- Scheme `http` or `https`. Nothing else, and no credentials in the URL.
- Port 80 or 443 only.
- Not `localhost`, not an internal suffix (`.local`, `.internal`, `.lan`,
  `.home.arpa`, the lab's own domains), and not a single-label name.
- A registrable domain with a valid public suffix. A leading `www.` is stripped,
  because SPF and DMARC are published on the domain rather than its alias and
  the site check follows the redirect in either direction.

## What an address may be

Name resolution happens at connection time, against public resolvers — the
lab's own resolvers are deliberately not used, since they answer for internal
names. Every resolved address is checked, and the request proceeds only if
*all* of them are public unicast. Refused: loopback, RFC1918, link-local
(including 169.254.169.254 and the whole of fe80::/10), CGNAT, multicast,
reserved, unspecified, IPv4-mapped and IPv6 unique-local.

The connection is then **pinned** to a validated address, so the name cannot
resolve to something else between the check and the connection — DNS rebinding
has no window to work in. The `Host` header and TLS SNI keep the original
hostname so the request is still correct from the site's point of view.

Every redirect is revalidated from scratch, as a new target: scheme, port,
hostname, resolution, address class, pinning. A redirect to `http://169.254.169.254/`
is refused exactly as the original submission would have been. Redirects are
capped at a fixed count, and non-HTTP(S) redirect targets are not followed.

## Bounds

Responses are read up to a byte ceiling and then truncated; connect and read
timeouts are fixed; the worker runs a small fixed number of jobs concurrently;
each job has a wall-clock timeout and at most three attempts. Only the home page
is fetched — there is no crawl, no link following, no asset discovery.

No active scanning tool is used or shipped: no ZAP, no Nuclei, no port scanning,
no brute force, no authenticated checks.

## Authorization

An observation runs only after both are true: the email address is confirmed,
and control of the website is proven by a DNS TXT record or a file under
`/.well-known/`. A reviewer may instead record that authorization was
established through sales, which is written to the audit trail with the
reviewer's identity and a required written basis. There is no path that reaches
a customer's website without one of those three.

The verification secret is per-request and random. The web tier never makes the
probe itself — it queues an `authorization_probe` job, so the only process with
an outbound path remains the worker.

## Abuse controls

Rate limits are enforced in the database, per submitter IP per hour, per email
address per day and per domain per week, plus a separate limit on authorization
probes. The form carries a honeypot field and a minimum completion time, so the
cheapest bots are refused without a limit being consumed. Submitter IPs are
stored only as a salted hash.

## Privacy and disclosure

Findings are never displayed publicly and never indexed: staff pages and the
briefing preview are `no-store` and `noindex`, and the customer's copy is a
private link that expires. Unknown and expired links get the same generic
response, so a link cannot be probed for existence. Every state change —
submission, confirmation, verification, manual approval, preview, approval,
delivery, purge — is recorded in the audit trail.
