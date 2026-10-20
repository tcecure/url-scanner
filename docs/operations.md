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

`ops/backup-db.sh` takes the dump. On VM120 it is installed as
`/usr/local/sbin/tcescan-backup-db` and run nightly at 02:15 UTC by
`/etc/cron.d/tcescan-backup`, writing to `/var/backups/tcescan` and deleting
dumps older than `KEEP_DAYS` (14).

```
sudo install -o root -g root -m 0700 ops/backup-db.sh /usr/local/sbin/tcescan-backup-db
sudo COMPOSE_DIR=/opt/tcescan /usr/local/sbin/tcescan-backup-db      # verify once by hand
```

The directory and the dumps are root-only, because a dump holds customer
contact details and briefing content. 14 days is deliberately shorter than
`RETENTION_DAYS`: a deletion request is honoured in the database at once, and
the copy of it in a dump ages out instead of being edited.

There are no Proxmox-level backup jobs for VM120; the logical dump is the only
backup, and it is what a restore should use.

## Restore

```
docker compose stop web
docker compose exec -T db dropdb -U tcescan tcescan
docker compose exec -T db createdb -U tcescan tcescan
docker compose exec -T db pg_restore -U tcescan -d tcescan < /var/backups/tcescan/tcescan-<stamp>.dump
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

Requests, findings, briefings and the mail sent about them are deleted
`RETENTION_DAYS` after the request completes, by the worker's purge pass. A
reviewer can also purge a single request immediately from its detail page: the
briefing, findings and mail go, the contact details are overwritten, and what
remains is the audit record that the review was authorized and then purged.
Dumps taken before a deletion still hold the data until they age out (see
[backup](#backup)).

## Verifying a deployment

Use a TCecure-owned domain, never a third party's:

1. Submit the form at the staging or public URL.
2. Confirm the email. With `MAIL_TRANSPORT=log`, read the link out of the
   outbox: `docker compose exec -T db psql -U tcescan -c "select to_address, subject, body_text from email_outbox order by id desc limit 1"`.
3. A contact address on the domain being reviewed queues the snapshot as soon as
   the link is opened. An address on any other domain holds the request for a
   reviewer, who records the basis on the staff detail page.
4. Watch the worker pick up the snapshot job.
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
