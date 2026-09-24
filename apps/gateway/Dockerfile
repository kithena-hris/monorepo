# The Cosmo Router, as deployed: the pinned image with this directory baked in.
#
# Built by the deploy workflows with `apps/gateway` as the context, after they
# have composed `supergraph.json` against People's Compose name on the VM
# (`graph.deploy.yaml` is written by the workflow, never committed). Nothing
# here is fetched at runtime — no control plane, no CDN — so the image the
# smoke test ran is the image that serves.
#
# Pinned by version and digest. The integration tests start `latest`; a deploy
# that changed router under us would fail for a reason not in this repository,
# the same reason the Atlas and Vercel CLI versions are pinned. Bump it
# deliberately, and run `scripts/smoke.ts` against the new image first.
FROM ghcr.io/wundergraph/cosmo/router:0.352.0@sha256:75d839c9a9792c2bdeccabbb15e6066c3bf2fc0852cd4c23e5fd6c2024582b7e

# The safelist at `/persisted`: `config.yaml` says `path: persisted`, relative
# to the image's working directory, `/`. Without it every operation the shell
# sends is refused as not persisted.
COPY persisted /persisted
COPY config.yaml deploy.yaml supergraph.json /etc/router/

# `deploy.yaml` layered over `config.yaml` rather than a second copy of it, so
# the committed config stays the one the tests start.
ENV CONFIG_PATH=/etc/router/config.yaml,/etc/router/deploy.yaml

# `graph.sign_key` verifies an execution config downloaded from Cosmo's CDN,
# and this router downloads none: `deploy.yaml` points it at a file. The config
# schema still demands exactly 32 characters and refuses to boot without them, so this
# is a placeholder that authorises nothing, not a secret — the integration
# tests pass `'x'.repeat(32)` for the same reason.
ENV GRAPH_SIGN_KEY=unused-no-control-plane-00000000

EXPOSE 4000
