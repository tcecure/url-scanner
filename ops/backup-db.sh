#!/usr/bin/env bash
# Nightly logical dump of the scanner database on the web VM.
#
# Dumps hold customer contact details and briefing content, so they live
# root-only and are pruned on a shorter clock than the database itself: a
# deletion request is honoured in the database immediately, and the copy of it
# in a dump is gone within KEEP_DAYS.
set -euo pipefail

COMPOSE_DIR=${COMPOSE_DIR:-/opt/url-scanner}
DEST=${DEST:-/var/backups/tcescan}
KEEP_DAYS=${KEEP_DAYS:-14}

install -d -m 0700 -o root -g root "$DEST"
umask 077

stamp=$(date -u +%FT%H%M%SZ)
out="$DEST/tcescan-$stamp.dump"

cd "$COMPOSE_DIR"
docker compose exec -T db pg_dump -U tcescan -Fc tcescan > "$out.part"
mv "$out.part" "$out"
chmod 0600 "$out"

find "$DEST" -name 'tcescan-*.dump' -mtime "+$KEEP_DAYS" -delete
find "$DEST" -name 'tcescan-*.dump.part' -mtime +1 -delete
