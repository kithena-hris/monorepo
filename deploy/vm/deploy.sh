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
