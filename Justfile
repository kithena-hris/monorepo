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
    IDENTITY_DATABASE_URL="postgres://svc_identity:kithena@localhost:{{postgres_port}}/kithena" \
    VALKEY_URL="redis://localhost:{{valkey_port}}" \
    INTERNAL_API_TOKEN=dev-only-key \
    WEBAUTHN_RP_ID=localhost AUTH_ORIGIN=http://localhost:3100 \
      npx tsx platform/identity/src/main.ts &
    trap 'kill 0' EXIT
    cd apps/auth/shell
    INTERNAL_API_URL=http://localhost:4100 INTERNAL_API_TOKEN=dev-only-key npx modern dev

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
    IDENTITY_DATABASE_URL="postgres://svc_identity:kithena@localhost:{{postgres_port}}/kithena" \
    VALKEY_URL="redis://localhost:{{valkey_port}}" \
    WEBAUTHN_RP_ID=localhost AUTH_ORIGIN=http://localhost:3100 \
    ADMIN_RP_ID=localhost ADMIN_ORIGIN=http://localhost:3001 \
      npx tsx platform/identity/src/main.ts &
    trap 'kill 0' EXIT
    (cd apps/auth/shell && npx modern dev) &
    cd apps/admin && npx next dev -p 3001

# Put an operator back in the state they start in: named, with no credential.
# Prints the link that enrols one.
admin-seed postgres_port="5432" email="ops@kithena.com":
    npx tsx platform/identity/scripts/seed-operator.ts {{postgres_port}} {{email}}
