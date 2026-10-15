# Installation

Two VMs on pve2, deliberately separated: the web tier faces the lab's existing
nginx edge, and the worker — the only component that makes outbound requests to
customer websites — sits on its own network with no route to anything else in the
lab.

| | Web | Worker |
|---|---|---|
| VM | 120 `tce-scan-web-01` | 121 `tce-scan-worker-01` |
| Network | vmbr0, 192.168.1.120/24 | vmbr60, 192.168.60.10/24 |
| Runs | Next.js, PostgreSQL | Python worker |
| Inbound | 3000 from the nginx edge only | none |
| Outbound | none required | 80/443 to public addresses, 53 to the configured resolvers, 5432 to the web VM |

## 1. Provision

```
ops/provision-web.sh      # creates VM120 from the Ubuntu cloud template
ops/provision-worker.sh   # creates VM121 and its isolated bridge
```

Both scripts are idempotent, create nothing that already exists, and never touch
an existing VM. Read them before running: they print every `qm` command they
will issue and stop on the first failure.

## 2. Configure

On each VM:

```
git clone https://github.com/tcecure/url-scanner.git /opt/tcescan
cd /opt/tcescan
cp .env.example .env
```

Fill in `.env`. At minimum:

- `POSTGRES_PASSWORD` and a matching `DATABASE_URL` (web VM: `@db:5432`; worker
  VM: `@192.168.1.120:5432`).
- `IP_HASH_SALT` — `openssl rand -hex 32`. Changing it later makes existing
  hashed submitter addresses uncomparable, which is acceptable but noted.
- `DB_BIND=192.168.60.1` on the web VM so PostgreSQL is reachable from the
  worker network and nowhere else. Never `0.0.0.0`.
- `MAIL_TRANSPORT`. Leave as `log` until a TCecure sending identity exists;
  messages are still written to `email_outbox` so the flow is complete and
  auditable, but nothing leaves the network.

No secret belongs in the repository, in a report, or in a log line. The mail
password is read from the environment only.

## 3. Start

Web VM:

```
docker compose up -d --build
```

This runs the migrations (a one-shot `migrate` service that must exit cleanly
before `web` starts) and then the application on 127.0.0.1:3000.

Worker VM:

```
docker compose -f docker-compose.worker.yml up -d --build
```

## 4. Create a reviewer

```
docker compose run --rm -e STAFF_PASSWORD='…' migrate \
  npm run staff -- add reviewer@tcecure.com "Reviewer Name" reviewer
```

The password is read from the environment, never from the command line, so it
stays out of shell history and the process list. Only `@tcecure.com` addresses
are accepted.

## 5. Edge

Install `ops/nginx/scan.tcecure.com.conf` on the existing edge host
(192.168.1.55), then:

```
nginx -t && systemctl reload nginx
certbot --nginx -d scan.tcecure.com
```

Certbot needs `scan.tcecure.com` to resolve publicly first. Until the DNS record
exists, the vhost serves the staging name with a self-signed certificate and an
allow-list of lab addresses — see [operations.md](operations.md).

## 6. Confirm

```
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/      # 200
docker compose logs --tail 20 web
docker compose -f docker-compose.worker.yml logs --tail 20 worker     # "queue empty"
```

Then walk one request through end to end against a TCecure-owned domain, as
described in [operations.md](operations.md#verifying-a-deployment). Never point
the service at a domain TCecure does not own or has not been authorized for.
