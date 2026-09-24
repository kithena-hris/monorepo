#!/usr/bin/env bash
# Put one service of one environment on a given image, and prove it came up.
#
#   deploy.sh <staging|production> people <image>
#   deploy.sh <staging|production> router <image>
#
# Run as root on the VM by the deploy workflows, from the directory they copied
# `deploy/vm/` into. A rollback is the same call with the image the deploy
# printed as `previous=`: there is one path onto an image, not two.
#
# `/etc/kithena/<env>/` (0700, root) is the project directory: the compose files
# copied here, `people.env`, `router.env` and `secrets.env` written by the
# workflow, and `state.env`, which this script owns — the image each service is
# on, the one before it, and the VM Postgres password generated on first run.
# Images named in any environment's `state.env` are kept on disk, so rolling
# back never depends on the registry still having the tag.
set -euo pipefail

env="${1:?usage: deploy.sh <staging|production> <people|router> <image>}"
service="${2:?usage: deploy.sh <env> <people|router> <image>}"
image="${3:?usage: deploy.sh <env> <service> <image>}"
case "$env" in staging | production) ;; *) echo "unknown environment: $env" >&2; exit 2 ;; esac
case "$service" in people | router) ;; *) echo "unknown service: $service" >&2; exit 2 ;; esac

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

[ -n "$(get VM_POSTGRES_PASSWORD)" ] || put VM_POSTGRES_PASSWORD "$(openssl rand -hex 24)"
files=(-f "$dir/compose.yaml")
if [ "$env" = staging ]; then
  files+=(-f "$dir/compose.staging.yaml")
  put REDPANDA_MEMORY 512M
  put VALKEY_MAXMEMORY 96mb
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

key="$(echo "$service" | tr '[:lower:]' '[:upper:]')"
current="$(get "${key}_IMAGE")"
echo "previous=$current"
if [ "$current" != "$image" ]; then
  [ -n "$current" ] && put "${key}_PREVIOUS" "$current"
  put "${key}_IMAGE" "$image"
fi
# People's first deploy has no router image yet, and Compose interpolates the
# whole file. A placeholder in the environment, never in `state.env`.
[ -n "$(get ROUTER_IMAGE)" ] || export ROUTER_IMAGE=not-deployed-yet

docker image inspect "$image" >/dev/null 2>&1 || docker pull --quiet "$image"

if [ "$service" = people ]; then
  compose up --detach --wait --wait-timeout 300 people
  # `/v1/openapi.json`, not `/health`: the REST routes are mounted only once
  # `PEOPLE_DATABASE_URL` is set, so this is the check a missing secret fails.
  retry ask http://127.0.0.1:4001/v1/openapi.json || {
    echo "::error::People is up but does not serve /v1/openapi.json" >&2
    compose logs --tail 80 people >&2
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
