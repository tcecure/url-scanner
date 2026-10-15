# Operations

All commands run from `/opt/tcescan` on the relevant VM.

## Migrations

Migrations are forward-only SQL files in `db/migrations`, applied in filename
order and recorded in `schema_migrations`. Each runs in its own transaction and
is rolled back on failure, so a failed migration leaves the database on the last
good one.

```
docker compose run --rm migrate
```

There is no down-migration. To reverse a schema change, write a new migration
that reverses it; see [rollback](#rollback).

## Backup

The database holds requests, findings, rendered briefings, the audit trail and
staff accounts. Everything else is rebuildable from the repository.

```
docker compose exec -T db pg_dump -U tcescan -Fc tcescan > /var/backups/tcescan-$(date +%F).dump
```

Run it nightly from cron on the web VM and keep 14 days. Dumps contain customer
contact details and briefing content: store them with the same care as the
database, and prune them on the same retention clock as the data itself.

Proxmox-level backups of VM120 cover the volume as well, but a logical dump is
what a restore should normally use.

## Restore

```
docker compose stop web
docker compose exec -T db dropdb -U tcescan tcescan
docker compose exec -T db createdb -U tcescan tcescan
docker compose exec -T db pg_restore -U tcescan -d tcescan < /var/backups/tcescan-YYYY-MM-DD.dump
docker compose run --rm migrate      # applies anything newer than the dump
docker compose start web
```

Stop the worker first if it is running, so no job claims a row mid-restore.

## Update

```
git pull
docker compose up -d --build        # web VM: migrate runs before web restarts
docker compose -f docker-compose.worker.yml up -d --build   # worker VM
```

Update the web tier first when a migration is additive, and the worker first
when a migration removes something the old worker still reads. The queue is
durable, so a worker restart only delays jobs.

## Rollback

```
git checkout <previous-tag>
docker compose up -d --build
```

Image rollback is safe on its own. A rollback that crosses a migration is not:
the old code may not understand the new schema. Decide which case applies before
rolling back, and if the migration must go too, write and apply a reversing
migration rather than restoring a dump, unless data was lost.

## Retention and deletion

Requests, findings, briefings and outbox rows are deleted `RETENTION_DAYS` after
the request completes. A reviewer can also purge a single request immediately
from its detail page, which removes the customer's data and leaves only the
audit record that a purge happened.

## Verifying a deployment

Use a TCecure-owned domain, never a third party's:

1. Submit the form at the staging or public URL.
2. Confirm the email. With `MAIL_TRANSPORT=log`, read the link out of the
   outbox: `docker compose exec -T db psql -U tcescan -c "select to_address, subject, body_text from email_outbox order by id desc limit 1"`.
3. Publish the TXT record the status page shows, or let a reviewer record
   authorization manually.
4. Watch the worker pick up the probe and then the snapshot.
5. Preview the briefing from the staff detail page, approve it, and confirm the
   private link resolves once and is refused after it expires.

## Protected staging

Until `scan.tcecure.com` resolves publicly, the edge vhost listens on the
staging name with a self-signed certificate and `allow`/`deny` limited to lab
addresses. The service is otherwise identical, which is deliberate: the launch
step is a DNS record and a certificate, not a configuration change.

## Monitoring

- `docker compose ps` — `migrate` should show `exited (0)`, everything else
  `healthy`.
- Jobs stuck in `claimed`: a worker died mid-job. Rows are reclaimed after the
  job timeout; three failed attempts mark the job `failed` and leave the request
  visible in the staff queue.
- `email_outbox` rows in `failed`: SMTP rejected the message. The body is still
  stored, so a reviewer can re-send after the transport is fixed.
- Requests sitting in `awaiting_review` are the reviewer's queue, not a fault.
