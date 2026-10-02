#!/usr/bin/env bash
# Did the pull request that produced this main commit already test this exact
# tree? `ci` on main reads the answer to skip what it would only repeat.
#
# Writes `matched` (true|false) and `proven` (the narrowed gates the pull
# request ran in full: any of contracts web integration ui) to $GITHUB_OUTPUT,
# and the reason to $GITHUB_STEP_SUMMARY. Any doubt — no pull request, no
# status, an API error, a run that is not a green `ci` run on that head, a
# different tree — is `matched=false`: the full suite runs.
#
# The record it reads is the `ci/tested-tree` commit status `ci` posts on the
# pull request's head once every required check is green. Only a
# workflow in this repository can write it as github-actions[bot]; a fork's
# token cannot write statuses at all.
#
# Inputs: SHA (the main commit), REPO (owner/name), GH_TOKEN. `GH` overrides
# the gh binary, which is how the dry run in docs/environments.md fakes the API.
set -uo pipefail

gh="${GH:-gh}"
out="${GITHUB_OUTPUT:-/dev/stdout}"
summary="${GITHUB_STEP_SUMMARY:-/dev/stderr}"

full() {
  echo "Full suite: $1" >> "$summary"
  { echo "matched=false"; echo "proven="; } >> "$out"
  exit 0
}

tree="$(git rev-parse "$SHA^{tree}")" || full "cannot read the tree of $SHA"

pulls="$("$gh" api "repos/$REPO/commits/$SHA/pulls")" || full "the pull request lookup failed"
pr="$(jq -r --arg sha "$SHA" '[.[] | select(.merged_at != null and .merge_commit_sha == $sha and .base.ref == "main")][0] // empty | "\(.number) \(.head.sha)"' <<< "$pulls")" \
  || full "the pull request lookup returned something unreadable"
[ -n "$pr" ] || full "no merged pull request has $SHA as its merge commit (a direct push?)"
head="${pr#* }"; pr="${pr%% *}"

statuses="$("$gh" api "repos/$REPO/commits/$head/statuses?per_page=100")" || full "the status lookup failed"
# Newest first, so this is the last green run's record.
status="$(jq -c '[.[] | select(.context == "ci/tested-tree" and .state == "success" and .creator.login == "github-actions[bot]")][0] // empty' <<< "$statuses")" \
  || full "the status lookup returned something unreadable"
[ -n "$status" ] || full "PR #$pr has no ci/tested-tree status on $head"
description="$(jq -r .description <<< "$status")"
url="$(jq -r .target_url <<< "$status")"
tested="$(sed -n 's/^tree=\([0-9a-f]\{40\}\) ran=[a-z,]*$/\1/p' <<< "$description")"
ran="$(sed -n 's/^tree=[0-9a-f]\{40\} ran=\([a-z,]*\)$/\1/p' <<< "$description")"
[ -n "$tested" ] || full "PR #$pr's status reads '$description', not 'tree=<sha> ran=<gates>'"

run="$(sed -n 's#^https://github.com/'"$REPO"'/actions/runs/\([0-9][0-9]*\)$#\1#p' <<< "$url")"
[ -n "$run" ] || full "PR #$pr's status does not link a run in $REPO"
runinfo="$("$gh" api "repos/$REPO/actions/runs/$run")" || full "the run lookup failed"
jq -e --arg head "$head" --arg repo "$REPO" \
  '.conclusion == "success" and .event == "pull_request" and .path == ".github/workflows/ci.yml"
   and .head_sha == $head and .repository.full_name == $repo' <<< "$runinfo" > /dev/null \
  || full "run $run is not a successful ci run on PR #$pr's head $head"

[ "$tested" = "$tree" ] || full "tree $tree differs from the $tested PR #$pr tested; something merged in between"

proven="$(printf '%s' "$ran" | tr ',' ' ')"
{
  echo "Tree \`$tree\` already passed in PR #$pr, run $url."
  echo
  echo "Skipped here: verify, standalone${ran:+, ${ran//,/, }}. Every gate the pull request narrowed runs in full."
} >> "$summary"
{ echo "matched=true"; echo "proven=$proven"; } >> "$out"
