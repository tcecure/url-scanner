# Local development

## Web

```
cd web
npm ci
npm run typecheck
npm run lint
npm test
npm run dev            # http://localhost:3000
```

`npm run dev` needs a database. The quickest one:

```
docker compose up -d db
DATABASE_URL=postgres://tcescan:dev@127.0.0.1:5432/tcescan npm run migrate
```

Set `PUBLIC_BASE_URL=http://127.0.0.1:3000` locally. It is the origin written
into the confirmation links, so leaving it at the deployed value sends anyone
following a link out of the local outbox to production.

## Worker

```
cd worker
python3.12 -m venv .venv
.venv/bin/pip install -e ".[dev]"
.venv/bin/ruff check .
.venv/bin/pytest -q
```

The package requires Python 3.12. On an older interpreter the editable install
refuses; tests still run with `PYTHONPATH=. python -m pytest -q`, which is what
CI does not do and a developer should not rely on.

## Tests

The worker suite is where the security model is actually asserted: the SSRF
fixtures cover every refused address class and IP notation, DNS rebinding, mixed
public/private answers, address pinning, redirect revalidation and response
truncation. They bind loopback sockets locally — **no test contacts a third-party
host, and none should ever be added that does.** When a check needs a live
target, use a TCecure-owned domain and say so in the test name.

## Conventions

- Secrets come from the environment. Never from a default, a fixture, or a
  committed file.
- A finding states what was observed and when, with its evidence, and keeps the
  recommendation in a separate field. Absence is reported as absence; nothing in
  this service may claim a site is vulnerable.
- The web tier has no outbound HTTP path. Anything that needs one is a job.
