#!/usr/bin/env bash
# The Cosmo Router for `just dev`: the same pinned image production runs, with
# this directory's config and safelist mounted. No local Go binary needed.
set -euo pipefail
cd "$(dirname "$0")/.."
pnpm exec wgc router compose -i graph.dev.yaml -o supergraph.json
exec docker run --rm --name kithena-router-dev -p 4000:4000 \
  -v "$PWD/config.yaml:/etc/router/config.yaml:ro" \
  -v "$PWD/deploy.yaml:/etc/router/deploy.yaml:ro" \
  -v "$PWD/supergraph.json:/etc/router/supergraph.json:ro" \
  -v "$PWD/persisted:/persisted:ro" \
  -e CONFIG_PATH=/etc/router/config.yaml,/etc/router/deploy.yaml \
  -e AUTH_JWKS_URL="${AUTH_JWKS_URL_DOCKER:-http://host.docker.internal:4100/.well-known/jwks.json}" \
  -e AUTH_TOKEN_AUDIENCE="${AUTH_TOKEN_AUDIENCE:-kithena-router}" \
  -e KITHENA_ENTITLEMENTS="${KITHENA_ENTITLEMENTS:-[\"module.people\"]}" \
  -e PEOPLE_API_TOKEN="${PEOPLE_API_TOKEN:-${INTERNAL_API_TOKEN:-dev-only-key}}" \
  -e GRAPH_SIGN_KEY=unused-no-control-plane-00000000 \
  ghcr.io/wundergraph/cosmo/router:0.352.0@sha256:75d839c9a9792c2bdeccabbb15e6066c3bf2fc0852cd4c23e5fd6c2024582b7e
