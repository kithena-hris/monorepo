#!/usr/bin/env bash
# Which web acceptance files a change reaches, per runner of `ci`'s
# `web-acceptance-files` matrix. Prints to $GITHUB_OUTPUT (stdout outside CI):
#
#   acceptance={"people":"acceptance/people.acceptance.test.ts", ..., "rest":"..."}
#   web=true|false        any file at all
#   web_full=true|false   every file (what `tested-tree` may record as proven)
#
# `all` and `none` need no input; `diff` reads the changed paths on stdin and
# SHARED, the regex of files every job depends on.
#
# A file of an area runs when that area changed: People's (`services/people`,
# its remote), Time Off's, Documents'. Anything else the stack is built from
# (the shell, identity, the router, packages, migrations, shared config) runs
# every file. The Recruiting and Onboarding remotes reach none: the stack
# never builds them (`apps/web/acceptance/build.ts`). A file not named below
# runs on any change that reaches the stack, so a new one is never left out.
set -euo pipefail

mode="${1:-diff}"
out="${GITHUB_OUTPUT:-/dev/stdout}"
changed=''
[ "$mode" = diff ] && changed="$(cat)"
has() { printf '%s\n' "$changed" | grep -Eq "$1"; }

core=false people=false timeoff=false docs=false
case "$mode" in
  all) core=true ;;
  none) ;;
  diff)
    beyond_areas="$(printf '%s\n' "$changed" |
      grep -Ev '^(services/(people|timeoff|documents)/|apps/web/(people|timeoff|documents|recruiting|onboarding)/)' || true)"
    if printf '%s\n' "$beyond_areas" | grep -Eq "${SHARED:?}|^(apps/web/|platform/identity/|apps/gateway/|packages/|migrations/)"; then
      core=true
    fi
    has '^(services/people/|apps/web/people/)' && people=true
    has '^(services/timeoff/|apps/web/timeoff/)' && timeoff=true
    has '^(services/documents/|apps/web/documents/)' && docs=true
    ;;
  *) echo "usage: $0 all|none|diff" >&2; exit 2 ;;
esac

reaches() {
  [ "$core" = true ] && return 0
  case "$1" in
    timeoff) [ "$timeoff" = true ] ;;
    people | people-* | perf) [ "$people" = true ] ;;
    directory) [ "$people" = true ] || [ "$docs" = true ] ;;
    *) [ "$people" = true ] || [ "$timeoff" = true ] || [ "$docs" = true ] ;;
  esac
}

json='' any=false full=true rest=''
add() { json="$json${json:+,}\"$1\":\"$2\""; }
for part in people people-companies people-pages perf; do
  if reaches "$part"; then
    add "$part" "acceptance/$part.acceptance.test.ts"; any=true
  else
    add "$part" ''; full=false
  fi
done
for file in apps/web/acceptance/*.acceptance.test.ts; do
  name="$(basename "$file" .acceptance.test.ts)"
  case "$name" in people | people-* | perf) continue ;; esac
  if reaches "$name"; then
    rest="$rest${rest:+ }acceptance/$name.acceptance.test.ts"; any=true
  else
    full=false
  fi
done
add rest "$rest"

{
  echo "acceptance={$json}"
  echo "web=$any"
  echo "web_full=$full"
} >> "$out"
