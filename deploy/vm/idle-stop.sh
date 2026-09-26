#!/usr/bin/env bash
# Stop the VM when nobody is using it; start the stack again when it boots.
#
#   idle-stop.sh           every 5 min, from `kithena-idle-stop.timer`
#   idle-stop.sh start     at boot, from `kithena-start.service`
#   idle-stop.sh decide    the decision alone, from the environment (the tests)
#
# Installed by `bootstrap.sh` when `IDLE_STOP_MINUTES` is set, and run as root
# from `~deploy/kithena`, where the deploy workflows keep it current. Every
# line it prints is a decision, and systemd puts it in the journal:
# `journalctl -u kithena-idle-stop`.
#
# Idle is all of these, for `IDLE_STOP_MINUTES` (default 30):
#
#   - no authenticated GraphQL request at any router. The router's access log
#     is the signal: it logs `/graphql` and nothing else (not `/health`, not
#     what cloudflared asks), and a request without a valid token answers 401,
#     which is the internet knocking, not a person. `docker logs --since` reads
#     it, so there is no state here to lose.
#   - no kithena container started, and nothing deployed, inside the window:
#     a boot, a deploy or a restart counts as activity.
#   - nobody logged in (`who`) and no Session Manager session open (an
#     `ssm-session-worker` process): an operator's session keeps it up.
#   - no export job queued, running or waiting to retry in BullMQ, and no
#     pending Temporal activity on `people-full-values`. A full-values request
#     waiting a week for HR's decision is a timer, not work: Temporal fires it
#     when the VM is next up.
#   - up for more than 15 minutes.
#
# Then: a backup (retried once; a failure stops the stop unless the last good
# backup is under 24 h old), `docker compose stop` so People drains on SIGTERM,
# and `shutdown -h now`. EC2's `InstanceInitiatedShutdownBehavior=stop` makes
# that a stop, not a terminate — `deploy/aws/provision.sh` sets it.
#
# `compose stop` marks every container stopped on purpose, and `unless-stopped`
# then leaves it stopped at boot: `start` is what brings the stack back.
set -euo pipefail

root="${KITHENA_ETC:-/etc/kithena}"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
minutes="${IDLE_STOP_MINUTES:-30}"
window=$((minutes * 60))

# Pure: the environment in, one line and an exit status out (0 stop, 1 stay).
# Any input that is not a number is a probe that failed, and an unknown is a
# reason to stay up, never to stop.
decide() {
  local name value
  for name in UPTIME_SECONDS REQUESTS NEWEST_START_SECONDS SESSIONS JOBS ACTIVITIES; do
    value="${!name:-}"
    [[ "$value" =~ ^[0-9]+$ ]] || { echo "stay: $name unknown (${value:-unset})"; return 1; }
  done
  if [ "$UPTIME_SECONDS" -lt 900 ]; then echo "stay: up ${UPTIME_SECONDS}s, under 15 min"; return 1; fi
  if [ "$REQUESTS" -gt 0 ]; then echo "stay: $REQUESTS request(s) in the last ${minutes} min"; return 1; fi
  if [ "$NEWEST_START_SECONDS" -lt "$window" ]; then
    echo "stay: a container started or a deploy landed ${NEWEST_START_SECONDS}s ago"; return 1
  fi
  if [ "$SESSIONS" -gt 0 ]; then echo "stay: $SESSIONS login session(s)"; return 1; fi
  if [ "$JOBS" -gt 0 ]; then echo "stay: $JOBS export job(s) in flight"; return 1; fi
  if [ "$ACTIVITIES" -gt 0 ]; then echo "stay: $ACTIVITIES full-values activit(y/ies) pending"; return 1; fi
  echo "stop: idle for ${minutes} min"
}

# Pure too: whether a failed backup still allows the stop.
backup_allows() { # <seconds since the last good backup, or empty for never>
  if [[ "${1:-}" =~ ^[0-9]+$ ]] && [ "$1" -lt 86400 ]; then
    echo "backup failed twice; the last good one is ${1}s old, so stopping anyway"
    return 0
  fi
  echo "stay: backup failed twice and none has succeeded in 24 h"
  return 1
}

envs() { for dir in "$root"/*/; do [ -d "$dir" ] && basename "$dir"; done; }
running() { [ "$(docker container inspect -f '{{.State.Running}}' "$1" 2>/dev/null)" = true ]; }

# The files and interpolation `deploy.sh` uses, with its placeholder for an
# image not deployed yet (Compose interpolates the whole file).
compose() { # <env> <compose args…>
  local env="$1" dir="$root/$1"
  shift
  local files=(-f "$dir/compose.yaml") people router
  [ "$env" = staging ] && files+=(-f "$dir/compose.staging.yaml")
  people="$(sed -n 's/^PEOPLE_IMAGE=//p' "$dir/state.env" | tail -n 1)"
  router="$(sed -n 's/^ROUTER_IMAGE=//p' "$dir/state.env" | tail -n 1)"
  PEOPLE_IMAGE="${people:-not-deployed-yet}" ROUTER_IMAGE="${router:-not-deployed-yet}" \
    docker compose -p "kithena-$env" --project-directory "$dir" "${files[@]}" \
    --env-file "$dir/secrets.env" --env-file "$dir/state.env" "$@"
}

# Authenticated `/graphql` lines in the router's access log inside the window.
requests() {
  local env n=0 c
  for env in $(envs); do
    running "kithena-$env-router-1" || continue
    c="$(docker logs --since "${minutes}m" "kithena-$env-router-1" 2>&1 \
      | grep '"path":"/graphql"' | grep -vc '"status":401' || true)"
    n=$((n + c))
  done
  echo "$n"
}

# Seconds since the newest kithena container started, or since a deploy copied
# its files here, whichever is more recent.
newest_start() {
  local newest=0 t f id
  # `scp` without `-p` stamps every file it copies with the time it copied it.
  for f in "$here" "$here"/*; do
    t="$(stat -c %Y "$f")"
    [ "$t" -gt "$newest" ] && newest="$t"
  done
  for id in $(docker ps -q --filter name='^kithena-'); do
    t="$(date -d "$(docker container inspect -f '{{.State.StartedAt}}' "$id")" +%s)" || continue
    [ "$t" -gt "$newest" ] && newest="$t"
  done
  echo $(($(date +%s) - newest))
}

# Export jobs waiting, running, prioritised or delayed for a retry. The
# scheduler's next sweep also sits in `delayed`, as `repeat:…`, and is not work.
queued() {
  local env n=0 c
  local lua="local n = redis.call('LLEN', KEYS[1]) + redis.call('LLEN', KEYS[2]) + redis.call('ZCARD', KEYS[3])
for _, id in ipairs(redis.call('ZRANGE', KEYS[4], 0, -1)) do
  if string.sub(id, 1, 7) ~= 'repeat:' then n = n + 1 end
end
return n"
  for env in $(envs); do
    running "kithena-$env-valkey-1" || continue
    c="$(docker exec "kithena-$env-valkey-1" valkey-cli --raw EVAL "$lua" 4 \
      bull:people-exports:active bull:people-exports:wait \
      bull:people-exports:prioritized bull:people-exports:delayed)" || { echo unknown; return; }
    n=$((n + c))
  done
  echo "$n"
}

# Running full-values workflows with an activity pending. One describe per
# running workflow: a handful for one company, and every five minutes.
activities() {
  local env n=0 id t ids out
  for env in $(envs); do
    t="kithena-$env-temporal-1"
    running "$t" || continue
    ids="$(docker exec "$t" temporal workflow list --address temporal:7233 --limit 200 -o jsonl \
      -q "TaskQueue='people-full-values' AND ExecutionStatus='Running'" \
      | sed -n 's/^{"execution":{"workflowId":"\([^"]*\)".*/\1/p')" || { echo unknown; return; }
    for id in $ids; do
      # Closed since the list: nothing pending.
      out="$(docker exec "$t" temporal workflow describe --address temporal:7233 -w "$id" -o json)" || continue
      [[ "$out" == *'"pendingActivities"'* ]] && n=$((n + 1))
    done
  done
  echo "$n"
}

backup() {
  local stamp="$root/.last-backup"
  [ -f "$here/backup.sh" ] || { echo "no backup.sh beside this script" >&2; return 1; }
  bash "$here/backup.sh" && return 0
  echo "backup failed; retrying once in 60 s"
  sleep 60
  bash "$here/backup.sh" && return 0
  local age=
  [ -f "$stamp" ] && age=$(($(date +%s) - $(stat -c %Y "$stamp")))
  backup_allows "$age"
}

check() {
  UPTIME_SECONDS="$(cut -d. -f1 /proc/uptime)"
  REQUESTS="$(requests)"
  NEWEST_START_SECONDS="$(newest_start)"
  # `who` sees an SSH login, tunnelled through SSM or not, but a Session
  # Manager shell never writes utmp: each open session is an
  # `ssm-session-worker` process instead. (`pgrep -c` prints 0 and exits 1
  # when there is none.)
  SESSIONS=$(($(who | wc -l) + $(pgrep -c -f ssm-session-worker || true)))
  JOBS="$(queued)"
  ACTIVITIES="$(activities)"
  export UPTIME_SECONDS REQUESTS NEWEST_START_SECONDS SESSIONS JOBS ACTIVITIES
  decide || exit 0
  backup || exit 0
  local env
  for env in $(envs); do
    echo "stopping kithena-$env"
    compose "$env" stop --timeout 30
  done
  echo "shutting down"
  shutdown -h now
}

start() {
  local env
  for env in $(envs); do
    [ -f "$root/$env/state.env" ] || continue
    echo "starting kithena-$env"
    compose "$env" start || echo "kithena-$env did not start cleanly" >&2
  done
}

case "${1:-check}" in
  check) check ;;
  start) start ;;
  decide) decide ;;
  backup-allows) backup_allows "${2:-}" ;;
  *) echo "usage: idle-stop.sh [check | start | decide | backup-allows <seconds>]" >&2; exit 2 ;;
esac
