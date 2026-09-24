#!/usr/bin/env bash
# Nightly: the VM's own state, to the backups bucket (Oracle Object Storage
# through its S3 Compatibility API; any S3 endpoint works).
#
# Run as root by `kithena-backup.timer` (installed by `bootstrap.sh`). For each
# environment running on this VM:
#
#   <env>/<date>/people.dump       pg_dump -Fc of People's database, `kithena`:
#                                  every tenant's employee records
#   <env>/<date>/postgres.sql.gz   pg_dumpall of the rest: the roles, Temporal's
#                                  workflows and OpenFGA's tuples
#   <env>/<date>/topics.txt.gz     every `kithena.*` topic, one record a line
#
# Nightly is the recovery point: there is no point-in-time restore for People's
# data on this VM. Identity's data is Neon's, which keeps its own history.
# Retention is the bucket's lifecycle rule, not this script.
# `docs/environments.md` "Backups" has the restore.
#
# `/etc/kithena/backup.env` (0600, written once by hand) holds
# BACKUP_S3_ENDPOINT, BACKUP_S3_REGION, BACKUP_S3_BUCKET, AWS_ACCESS_KEY_ID and
# AWS_SECRET_ACCESS_KEY (an OCI Customer Secret Key).
set -euo pipefail

root="${KITHENA_ETC:-/etc/kithena}"
set -a # exported, for `docker run -e NAME`
# shellcheck source=/dev/null
. "$root/backup.env"
set +a
: "${BACKUP_S3_ENDPOINT:?}" "${BACKUP_S3_REGION:?}" "${BACKUP_S3_BUCKET:?}" "${AWS_ACCESS_KEY_ID:?}" "${AWS_SECRET_ACCESS_KEY:?}"
date="$(date -u +%Y-%m-%d)"

# The checksum settings: the CLI's default trailing checksums are newer than
# most S3-compatible stores, Oracle's included.
upload() {
  docker run --rm -i \
    -e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY -e "AWS_DEFAULT_REGION=$BACKUP_S3_REGION" \
    -e AWS_REQUEST_CHECKSUM_CALCULATION=when_required \
    -e AWS_RESPONSE_CHECKSUM_VALIDATION=when_required \
    amazon/aws-cli:2.31.0@sha256:3b018ce74732c98acf6f1de59b3a89587cb7f9eb6ea0d1447d1779091b2bf057 s3 cp - "s3://$BACKUP_S3_BUCKET/$1" \
    --endpoint-url "$BACKUP_S3_ENDPOINT" --only-show-errors
}

status=0
for dir in "$root"/*/; do
  env="$(basename "$dir")"
  # Compose names the containers `<project>-<service>-1`.
  pg="kithena-$env-postgres-1" rp="kithena-$env-redpanda-1"
  docker container inspect "$pg" "$rp" >/dev/null 2>&1 || continue
  echo "backing up $env"
  # Custom format: compressed, and `pg_restore` can take one table back out.
  if docker exec "$pg" psql -U kithena -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = 'kithena'" | grep -q 1; then
    docker exec "$pg" pg_dump -U kithena -d kithena -Fc \
      | upload "$env/$date/people.dump" || { echo "::error::$env people" >&2; status=1; }
  fi
  docker exec "$pg" pg_dumpall -U kithena --clean --if-exists --exclude-database=kithena \
    | gzip | upload "$env/$date/postgres.sql.gz" || { echo "::error::$env postgres" >&2; status=1; }
  # Named, not `--regex`, which rpk refuses beside `--offset :end` (stop at the
  # current end rather than wait for more). Base64 so a binary key or value
  # survives a line format. Headers are not kept.
  topics="$(docker exec "$rp" rpk topic list | awk 'NR > 1 && /^kithena\./ { print $1 }')"
  [ -n "$topics" ] || continue
  # shellcheck disable=SC2086 # one argument per topic
  docker exec "$rp" rpk topic consume $topics --offset :end --format '%t %k{base64} %v{base64}\n' \
    | gzip | upload "$env/$date/topics.txt.gz" || { echo "::error::$env topics" >&2; status=1; }
done
exit "$status"
