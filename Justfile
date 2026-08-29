set dotenv-load := true

default:
    @just --list

# Boot infrastructure, migrate, seed, and start everything.
dev:
    docker compose up -d --wait
    pnpm db:migrate
    pnpm db:seed
    pnpm turbo run dev --parallel

up:
    docker compose up -d --wait

down:
    docker compose down

# Wipe local state. Destructive, obviously.
reset:
    docker compose down -v
    just dev

# Fast advisory typecheck (TypeScript 7, Go native).
check:
    pnpm typecheck

# Authoritative typecheck (TypeScript 6). This is what CI gates on.
check-strict:
    pnpm typecheck:authoritative

lint:
    pnpm lint
    pnpm boundaries

test:
    pnpm test

test-all:
    pnpm test && pnpm test:integration && pnpm test:contract && pnpm test:stories

# Design system docs at http://localhost:6006.
storybook:
    pnpm storybook

# Render every story in a browser and run axe over it.
test-stories:
    pnpm test:stories

# Regenerate JSON Schema, redaction paths and DSAR manifest from Zod contracts.
codegen:
    pnpm --filter @kithena/codegen generate

# Compose the federated supergraph locally.
supergraph:
    pnpm --filter @kithena/gateway compose

# Boot a single module with no siblings present, then run its acceptance suite.
standalone module:
    pnpm --filter @kithena/{{module}} test:standalone

# The auth origin and the identity service, locally.
#
# Two processes and the containers they need. Separate from `dev` because that
# one starts everything and this is the pair you want while working on sign-in.
#
# POSTGRES_PORT and VALKEY_PORT exist because a developer with Postgres already
# installed loses the race for `localhost:5432` — the host daemon binds it and
# Docker publishes to the wildcard, so `localhost` reaches the wrong server and
# every role appears not to exist. Override them and the compose file with
# `docker-compose.override.yml`, which is gitignored.
auth-dev postgres_port="5432" valkey_port="6379":
    docker compose up -d postgres valkey --wait
    #!/usr/bin/env bash
    set -euo pipefail
    # Rspack keeps a lock in its cache directory and panics if a second dev
    # server finds one left behind by a process that was killed rather than
    # stopped. Cheap to clear, and it is always the answer.
    rm -rf apps/auth/shell/node_modules/.cache
    export INTERNAL_API_TOKEN=dev-only-key
    export AUTH_ORIGIN=http://localhost:3100
    # Messaging first, so identity has somewhere to send an invitation. With no
    # RESEND_API_KEY it prints the message instead of sending it, which is what
    # you want while working on this — the enrolment link is single-use, so
    # every walk through the flow needs a fresh one.
    MESSAGING_DATABASE_URL="postgres://svc_messaging:kithena@localhost:{{postgres_port}}/kithena" \
      npx tsx platform/messaging/src/main.ts &
    IDENTITY_DATABASE_URL="postgres://svc_identity:kithena@localhost:{{postgres_port}}/kithena" \
    VALKEY_URL="redis://localhost:{{valkey_port}}" \
    MESSAGING_URL=http://localhost:4101 \
    WEBAUTHN_RP_ID=localhost \
      npx tsx platform/identity/src/main.ts &
    trap 'kill 0' EXIT
    cd apps/auth/shell
    INTERNAL_API_URL=http://localhost:4100 npx modern dev

# Put a tenant, an invited account and a fresh enrolment link in the database,
# and print the link. The link is single-use, so this is how you get another.
auth-seed postgres_port="5432":
    pnpm --filter @kithena/identity seed {{postgres_port}}

# The whole authenticated surface: identity, the auth origin and the
# back-office. Ports as arguments for the same reason `auth-dev` takes them —
# a developer with Postgres installed loses the race for `localhost:5432`.
admin-dev postgres_port="5432" valkey_port="6379":
    docker compose up -d postgres valkey --wait
    #!/usr/bin/env bash
    set -euo pipefail
    # Rspack keeps a lock in its cache and panics if a second dev server finds
    # one left by a process that was killed rather than stopped.
    rm -rf apps/auth/shell/node_modules/.cache
    export INTERNAL_API_TOKEN=dev-only-key
    export INTERNAL_API_URL=http://localhost:4100
    export AUTH_ORIGIN=http://localhost:3100
    # Messaging first. Creating a company in the back-office invites its
    # administrators, and with this running you see the message they would get.
    MESSAGING_DATABASE_URL="postgres://svc_messaging:kithena@localhost:{{postgres_port}}/kithena" \
      npx tsx platform/messaging/src/main.ts &
    IDENTITY_DATABASE_URL="postgres://svc_identity:kithena@localhost:{{postgres_port}}/kithena" \
    VALKEY_URL="redis://localhost:{{valkey_port}}" \
    MESSAGING_URL=http://localhost:4101 \
    WEBAUTHN_RP_ID=localhost \
    ADMIN_RP_ID=localhost ADMIN_ORIGIN=http://localhost:3001 \
      npx tsx platform/identity/src/main.ts &
    trap 'kill 0' EXIT
    (cd apps/auth/shell && npx modern dev) &
    cd apps/admin && npx next dev -p 3001

# Put an operator back in the state they start in: named, with no credential.
# Prints the link that enrols one.
admin-seed postgres_port="5432" email="ops@kithena.com":
    npx tsx platform/identity/scripts/seed-operator.ts {{postgres_port}} {{email}}

# Invite one person into a company that already exists, and send them the link.
#
# The path HR takes, from the outside: this is the same endpoint the back-office
# calls. Needs `just admin-dev` or `just auth-dev` running, because it goes
# through identity — which mints the token — and identity hands the link to
# messaging.
invite tenant_id email:
    curl -sS -X POST \
      -H 'content-type: application/json' \
      -H 'x-internal-token: dev-only-key' \
      -d '{"email":"{{email}}"}' \
      http://localhost:4100/api/internal/admin/tenants/{{tenant_id}}/invitations

# Render the invitation email to a file and print the plain-text half.
#
# Sending a real message to look at it is a bad loop: the link is single-use, a
# send costs a real address, and a bounce off a typo hurts the sending domain.
# Pass a logo to see the co-branded version — only `https:` URLs render, because
# Gmail drops `data:` image sources.
email-preview logo="":
    pnpm --filter @kithena/messaging preview {{ if logo != "" { "--logo " + logo } else { "" } }}

# Everything, locally: both platform services and all three front ends.
#
# Reads `.env`, which `set dotenv-load` above loads for every recipe — so the
# ports, the database URLs and the shared secret live in one gitignored file
# rather than in five shell invocations that drift apart.
#
# POSTGRES_PORT defaults to 55432 rather than 5432. A developer with Postgres
# already installed loses the race for 5432: the host daemon binds it, Docker
# publishes to the wildcard, and `localhost` reaches the wrong server — every
# role appears not to exist. `docker-compose.override.yml` publishes 55432 too.
local:
    docker compose up -d postgres valkey --wait
    #!/usr/bin/env bash
    set -euo pipefail
    # Rspack keeps a lock in its cache and panics if a second dev server finds
    # one left by a process that was killed rather than stopped.
    rm -rf apps/auth/shell/node_modules/.cache
    trap 'kill 0' EXIT
    npx tsx platform/messaging/src/main.ts &
    npx tsx platform/identity/src/main.ts &
    npx next dev apps/web -p 3200 &
    (cd apps/auth/shell && npx modern dev) &
    cd apps/admin && npx next dev -p 3001

# The tenant app on its own, on 3200. Reach it as acme.app.localhost:3200 —
# a bare localhost has no tenant label in front of the suffix, and the proxy
# answers 404 rather than guessing which company you meant.
web-dev:
    npx next dev apps/web -p 3200
