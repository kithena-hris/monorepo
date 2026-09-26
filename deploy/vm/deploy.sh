#!/usr/bin/env bash
# Put one service of one environment on a given image, and prove it came up.
#
#   deploy.sh <staging|production> migrate
#   deploy.sh <staging|production> people <image>
#   deploy.sh <staging|production> router <image>
#
# `migrate` runs first, as the Neon step does for identity: it makes sure
# People's database and its two roles exist, applies `migrations/` with a
# pinned Atlas container, and gives `svc_people` its login. Migrations are
# expand-contract, so it is never undone and a rollback never runs it.
#
# Run as root on the VM by the deploy workflows, from the directory they copied
# `deploy/vm/` into. A rollback is the same call with the image the deploy
# printed as `previous=`: there is one path onto an image, not two.
#
# `/etc/kithena/<env>/` (0700, root) is the project directory: the compose files
# copied here, `people.env`, `router.env` and `secrets.env` written by the
# workflow, and `state.env`, which this script owns — the image each service is
# on, the one before it, and the VM Postgres passwords generated on first run.
# Images named in any environment's `state.env` are kept on disk, so rolling
# back never depends on the registry still having the tag.
set -euo pipefail

usage='usage: deploy.sh <staging|production> <migrate | people <image> | router <image>>'
env="${1:?$usage}"
service="${2:?$usage}"
case "$env" in staging | production) ;; *) echo "unknown environment: $env" >&2; exit 2 ;; esac
case "$service" in
  migrate) image= ;;
  people | router) image="${3:?$usage}" ;;
  *) echo "unknown service: $service" >&2; exit 2 ;;
esac

root="${KITHENA_ETC:-/etc/kithena}"
dir="$root/$env"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
umask 077
mkdir -p "$dir"
chmod 700 "$root" "$dir"
cp "$here/compose.yaml" "$here/compose.staging.yaml" "$dir/"
touch "$dir/state.env" "$dir/people.env" "$dir/router.env" "$dir/secrets.env"
chmod 600 "$dir"/*

get() { sed -n "s/^$1=//p" "$dir/state.env" | tail -n 1; }
put() {
  grep -v "^$1=" "$dir/state.env" > "$dir/state.env.new" || true
  printf '%s=%s\n' "$1" "$2" >> "$dir/state.env.new"
  mv "$dir/state.env.new" "$dir/state.env"
}

for secret in VM_POSTGRES_PASSWORD MIGRATOR_PASSWORD PEOPLE_DB_PASSWORD; do
  [ -n "$(get "$secret")" ] || put "$secret" "$(openssl rand -hex 24)"
done
# The copy of `migrations/` and `atlas.hcl` the workflow put beside this file.
export MIGRATIONS_DIR="${MIGRATIONS_DIR:-$here/migrations}"
files=(-f "$dir/compose.yaml")
if [ "$env" = staging ]; then
  files+=(-f "$dir/compose.staging.yaml")
fi
compose() {
  docker compose -p "kithena-$env" --project-directory "$dir" "${files[@]}" \
    --env-file "$dir/secrets.env" --env-file "$dir/state.env" "$@"
}
# From inside People: nothing here publishes a port to ask from the host.
ask() {
  compose exec -T people node -e \
    "fetch('$1').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
}
retry() {
  for _ in $(seq 1 30); do "$@" && return 0; sleep 2; done
  return 1
}

# People's first deploy has no router image yet, and Compose interpolates the
# whole file. Placeholders in the environment, never in `state.env`.
[ -n "$(get PEOPLE_IMAGE)" ] || export PEOPLE_IMAGE=not-deployed-yet
[ -n "$(get ROUTER_IMAGE)" ] || export ROUTER_IMAGE=not-deployed-yet

# Postgres 17 to 18, once, before anything here starts Postgres. 18 cannot
# open a 17 data directory, and its image keeps the cluster in a versioned
# directory under a volume mounted one level up, so `compose.yaml` names a new
# volume, `postgres18`, and this moves the data across by dump and restore:
#
#   1. back up to S3 with `backup.sh`, and stop if that fails;
#   2. stop everything but the old Postgres, and `pg_dumpall` it to disk;
#   3. start 18 on the new volume and restore; the roles come with their
#      password hashes, so every login works as before;
#   4. compare roles and the row count of every table, both sides, and only
#      then mark the new volume as the upgraded one.
#
# The marker is what makes the next run a no-op; a run that failed part way
# left an unmarked volume, which the next run throws away and starts again.
# The old volume is never touched. `KITHENA_PG_UPGRADE_SKIP_BACKUP=1` skips
# step 1 and exists for the local rehearsal; nothing on the VM sets it.
old_volume="kithena-${env}_postgres" new_volume="kithena-${env}_postgres18"
old_container="kithena-$env-postgres-1"
marker=upgraded-from-17 # at the root of the new volume
# The image `compose.yaml` ran before 18, only ever to read the old volume.
pg17=postgres:17.6-bookworm@sha256:f3bd19c606e442c3d7bdfa8002e03fe260a1023351e0ea4598032022b68dd6e3
# `yes` or `no`; a Docker failure fails the deploy rather than reading as `no`,
# which would start 18 on an empty volume beside the real data.
in_volume() { # <volume> <shell test>, the volume at /v
  docker volume inspect "$1" >/dev/null 2>&1 || { echo no; return; }
  docker run --rm --network none --entrypoint sh -v "$1:/v:ro" "$pg17" \
    -c "if $2; then echo yes; else echo no; fi"
}
# Every role with a hash of its password, and every table with its row count.
snapshot() { # <container>
  docker exec "$1" psql -U kithena -d postgres -XAtqc \
    "SELECT rolname || ' ' || md5(coalesce(rolpassword, '')) FROM pg_authid WHERE rolname !~ '^pg_' ORDER BY 1"
  for db in $(docker exec "$1" psql -U kithena -d postgres -XAtqc \
    "SELECT datname FROM pg_database WHERE datallowconn AND NOT datistemplate ORDER BY 1"); do
    docker exec "$1" psql -U kithena -d "$db" -XAtqc "
      SELECT '$db.' || table_schema || '.' || table_name || ' ' ||
             (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I.%I',
               table_schema, table_name), false, true, '')))[1]::text
        FROM information_schema.tables
       WHERE table_type = 'BASE TABLE' AND table_schema NOT IN ('pg_catalog', 'information_schema')
       ORDER BY 1"
  done
}
old_is_17="$(in_volume "$old_volume" "grep -qx 17 /v/PG_VERSION")"
new_is_done="$(in_volume "$new_volume" "test -e /v/$marker")"
if [ "$old_is_17" = yes ] && [ "$new_is_done" = no ]; then
  echo "$env: moving Postgres 17 ($old_volume) to 18 ($new_volume)"
  running="$(compose ps --services --status running | grep -vx postgres || true)"
  # The dump comes from 17 on the old volume, always. Once an earlier run got as
  # far as replacing the container, that is a stand-in 17 under the same name,
  # so that `backup.sh` finds it; nothing has written to 17 since.
  case "$(docker inspect -f '{{.Config.Image}}' "$old_container" 2>/dev/null)" in
    postgres:17*) ;;
    *)
      docker rm -f "$old_container" >/dev/null 2>&1 || true
      docker run -d --name "$old_container" --network none \
        -v "$old_volume:/var/lib/postgresql/data" "$pg17" >/dev/null
      ;;
  esac
  docker start "$old_container" >/dev/null
  retry docker exec "$old_container" pg_isready -q -U kithena
  if [ "${KITHENA_PG_UPGRADE_SKIP_BACKUP:-}" = 1 ]; then
    echo "$env: backup skipped (KITHENA_PG_UPGRADE_SKIP_BACKUP=1)"
  else
    docker start "kithena-$env-redpanda-1" >/dev/null || true
    bash "$here/backup.sh" "$env" || {
      echo "::error::the backup before the Postgres upgrade failed; nothing was changed" >&2
      exit 1
    }
  fi
  # Nothing writes while the dump runs, or the writes after it would be lost.
  # shellcheck disable=SC2046 # one argument per service
  compose stop $(compose config --services | grep -vx postgres)
  dump="$dir/postgres17.sql"
  docker exec "$old_container" pg_dumpall -U kithena > "$dump"
  snapshot "$old_container" > "$dir/postgres17.snapshot"
  # From here a failure leaves 18 stopped, so neither a boot nor a restart
  # policy puts anything on a half-restored database; 17 is still untouched.
  trap 'echo "::error::the Postgres 18 upgrade stopped part way; 18 is stopped, $old_volume untouched; deploy again to retry" >&2
        compose stop postgres' EXIT
  # A volume left by a run that failed before the marker holds nothing ours.
  docker rm -f "$old_container" >/dev/null
  docker volume rm "$new_volume" >/dev/null 2>&1 || true
  compose up --detach --wait --wait-timeout 120 postgres
  # The image made `kithena` and an empty `openfga`, and the dump makes both.
  compose exec -T postgres psql -q -v ON_ERROR_STOP=1 -U kithena -d postgres -c 'DROP DATABASE openfga'
  sed '/^CREATE ROLE kithena;$/d' "$dump" \
    | compose exec -T postgres psql -q -X -v ON_ERROR_STOP=1 -U kithena -d postgres >/dev/null
  compose exec -T postgres vacuumdb -q -U kithena --all --analyze-only
  snapshot "kithena-$env-postgres-1" > "$dir/postgres18.snapshot"
  diff -q "$dir/postgres17.snapshot" "$dir/postgres18.snapshot" >/dev/null || {
    echo "::error::Postgres 18 does not hold what 17 did; the diff is in $dir, 17 is untouched" >&2
    diff "$dir/postgres17.snapshot" "$dir/postgres18.snapshot" | cut -d' ' -f1-2 >&2 || true
    exit 1
  }
  compose exec -T postgres touch "/var/lib/postgresql/$marker"
  trap - EXIT
  rm -f "$dump" "$dir/postgres17.snapshot" "$dir/postgres18.snapshot"
  # shellcheck disable=SC2086 # one argument per service
  [ -z "$running" ] || compose up --detach $running
  echo "$env: Postgres 18 is serving; $old_volume is kept. Once satisfied: docker volume rm $old_volume"
fi

if [ "$service" = migrate ]; then
  compose up --detach --wait --wait-timeout 120 postgres
  # On stdin, so no password is in an argv. Idempotent: a role or database
  # that exists is left alone, and the passwords are re-asserted from state.
  compose exec -T postgres psql -q -v ON_ERROR_STOP=1 -U kithena -d postgres <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'migrator') THEN
    CREATE ROLE migrator LOGIN CREATEROLE BYPASSRLS NOSUPERUSER;
  END IF;
  -- Every service role a migration grants to, before the migration that would
  -- create it has run: the same list, for the same reason, as the production
  -- workflow's "atlas dev roles" and \`tools/scripts/init-db.sql\`. NOLOGIN;
  -- only \`svc_people\` is given a login, below, because only People is here.
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'svc_people') THEN
    CREATE ROLE svc_people NOLOGIN NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'svc_timeoff') THEN
    CREATE ROLE svc_timeoff NOLOGIN NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'svc_identity') THEN
    CREATE ROLE svc_identity NOLOGIN NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'svc_messaging') THEN
    CREATE ROLE svc_messaging NOLOGIN NOBYPASSRLS;
  END IF;
END \$\$;
ALTER ROLE migrator PASSWORD '$(get MIGRATOR_PASSWORD)';
SELECT 'CREATE DATABASE kithena OWNER migrator'
 WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'kithena')\\gexec
SQL
  compose run --rm --no-deps migrate
  # NOLOGIN until now, as on Neon, where the console grants the login.
  compose exec -T postgres psql -q -v ON_ERROR_STOP=1 -U kithena -d postgres <<SQL
ALTER ROLE svc_people LOGIN PASSWORD '$(get PEOPLE_DB_PASSWORD)';
SQL
  echo "$env migrate: applied"
  exit 0
fi

key="$(echo "$service" | tr '[:lower:]' '[:upper:]')"
current="$(get "${key}_IMAGE")"
echo "previous=$current"
if [ "$current" != "$image" ]; then
  [ -n "$current" ] && put "${key}_PREVIOUS" "$current"
  put "${key}_IMAGE" "$image"
fi
unset "${key}_IMAGE" # the placeholder, if any: the state file has it now

docker image inspect "$image" >/dev/null 2>&1 || docker pull --quiet "$image"

if [ "$service" = people ]; then
  compose up --detach --wait --wait-timeout 300 people
  # `/v1/openapi.json`, not `/health`: the REST routes are mounted only once
  # `PEOPLE_DATABASE_URL` is set, so this is the check a missing setting fails.
  retry ask http://127.0.0.1:4001/v1/openapi.json || {
    echo "::error::People is up but does not serve /v1/openapi.json" >&2
    compose logs --tail 80 people >&2
    exit 1
  }
  # And the database behind it answers, as `svc_people`, through People's own
  # URL — the pool connects lazily, so nothing above has proved it.
  compose exec -T people node --input-type=module -e \
    "import postgres from 'postgres'; const sql = postgres(process.env.PEOPLE_DATABASE_URL, { max: 1 });
     await sql\`SELECT 1 FROM people.tenant LIMIT 1\`; await sql.end();" || {
    echo "::error::People cannot reach its database as svc_people" >&2
    exit 1
  }
else
  compose up --detach --wait --wait-timeout 120 router
  retry ask http://router:4000/health/ready || {
    echo "::error::the router never became ready" >&2
    compose logs --tail 80 router >&2
    exit 1
  }
  # Not waited on: whether the tunnel carries traffic is what the workflow's
  # smoke test through the public URL answers, and it answers it better.
  compose up --detach cloudflared
fi
echo "$env $service: $image"

# Every kithena image no environment is on or would roll back to.
keep="$(cat "$root"/*/state.env | sed -nE 's/^[A-Z]+_(IMAGE|PREVIOUS)=//p' | sort -u)"
docker images --format '{{.Repository}}:{{.Tag}}' \
  | grep -E '/kithena-(people|router):' \
  | grep -vxF -f <(printf '%s\n' "$keep") \
  | xargs -r docker rmi >/dev/null || true
