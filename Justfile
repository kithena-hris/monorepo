set dotenv-load := true

default:
    @just --list

# Boot infrastructure, migrate, seed, and start everything.
#
# The seed is identity's then People's (`pnpm db:seed`): Acme, Ada invited and
# named People's administrator, version 1 published and sample employees.
# Identity's events are piped into People's seed, standing where the topic
# would; see `services/people/src/seed-local.ts`.
dev:
    docker compose up -d --wait
    pnpm db:migrate
    pnpm db:seed
    pnpm --filter @kithena/people upload-bucket
    pnpm turbo run dev --parallel --env-mode=loose --concurrency=20

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

# Compose the federated supergraph locally, from each subgraph's SDL written
# fresh from its schema — no service has to be running. `pnpm --filter
# @kithena/gateway compose` still introspects running subgraphs, for `just dev`.
supergraph:
    pnpm turbo run codegen --filter=@kithena/people --filter=@kithena/timeoff --output-logs=errors-only
    pnpm --filter @kithena/gateway check

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
auth-dev postgres_port=env_var_or_default("POSTGRES_PORT", "5432") valkey_port="6379":
    docker compose up -d postgres --wait
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
auth-seed postgres_port=env_var_or_default("POSTGRES_PORT", "5432"):
    pnpm --filter @kithena/identity seed {{postgres_port}}

# The whole authenticated surface: identity, the auth origin and the
# back-office. Ports as arguments for the same reason `auth-dev` takes them —
# a developer with Postgres installed loses the race for `localhost:5432`.
admin-dev postgres_port=env_var_or_default("POSTGRES_PORT", "5432") valkey_port="6379":
    docker compose up -d postgres --wait
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
admin-seed postgres_port=env_var_or_default("POSTGRES_PORT", "5432") email="ops@kithena.com":
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
# Gmail drops `data:` image sources. Pass a theme id — indigo, teal, forest,
# plum, clay, slate — to see the button in the colour that company chose.
email-preview logo="" theme="":
    pnpm --filter @kithena/messaging preview {{ if logo != "" { "--logo " + logo } else { "" } }} {{ if theme != "" { "--theme " + theme } else { "" } }}

# Everything, locally: both platform services and all three front ends.
#
# The one command for working on a screen. Brings up Postgres, applies any
# migration the database has not seen, then runs the five processes in one shell
# so Ctrl-C stops all of them.
#
# Reads `.env`, which `set dotenv-load` above loads for every recipe, so the
# ports, the connection strings and the shared secret live in one gitignored
# file rather than in five shell invocations that drift apart. Those values
# point at this machine. `.env.staging` holds the remote ones and nothing loads
# it, because a local process against the staging database is not a mode worth
# having one keystroke away.
local: local-db
    #!/usr/bin/env bash
    set -euo pipefail
    # Mailpit, because `SMTP_URL` in `.env` points at it and a messaging service
    # that cannot reach its transport refuses every send. Its inbox is printed
    # below; every invitation and recovery link lands there, rendered.
    docker compose up -d mailpit --wait
    # Rspack keeps a lock in its cache and panics if a second dev server finds
    # one left by a process that was killed rather than stopped.
    rm -rf apps/auth/shell/node_modules/.cache

    # A shebang recipe, so all of this is one shell. `just` runs an ordinary
    # recipe a line at a time in separate processes, which is why `trap` and
    # `export` never applied in the recipes above — and why stopping one left
    # orphaned dev servers holding their ports.
    trap 'kill 0' EXIT

    # `printf`, not a heredoc: `just` strips the common indentation from a
    # recipe body, so an indented heredoc's closing delimiter stops matching the
    # one it was opened with and `cat` reads to end of file, printing the rest
    # of the recipe instead of running it.
    printf '%s\n' \
      '' \
      '  back-office   http://localhost:3001' \
      '  auth origin   http://auth.app.localhost:3100' \
      '  a tenant      http://<company>.app.localhost:3000' \
      '  identity      http://localhost:4100' \
      '  messaging     http://localhost:4101' \
      "  postgres      localhost:${POSTGRES_PORT:-5432}" \
      '  mailbox       http://localhost:8025' \
      '' \
      'Nothing is signed in yet. `just admin-seed` prints the link that enrols' \
      'the first back-office passkey; the back-office is where companies and' \
      'their people are created.' \
      ''

    # `tsx watch`, not `tsx`. The front ends have always reloaded on a save and
    # these two never did, so a change to a route or a query looked like it had
    # no effect — the process still running was the one started before the edit.
    npx tsx watch platform/messaging/src/main.ts &
    npx tsx watch platform/identity/src/main.ts &
    (node apps/web/scripts/build-renderer.mjs && npx next dev apps/web -p 3000) &
    (cd apps/auth/shell && npx modern dev) &
    (cd apps/admin && npx next dev -p 3001) &
    wait

# Postgres, migrated, without starting anything else.
#
# The migration directory is applied with `psql` inside the container rather
# than with Atlas. Atlas stays the source of truth — it writes these files, it
# lints them, and it is what CI applies to staging and production — but needing
# it installed before a laptop can run the app at all is the friction that sends
# somebody to a deployed environment to test a button.
#
# Which files have run is recorded in `public.local_migration`, so a new
# migration is applied on the next run and the companies and passkeys already in
# the database survive. That table is this recipe's own bookkeeping and is not
# Atlas's revision history; it sits in `public` rather than `platform` so it
# cannot be mistaken for part of a schema a module owns.
local-db:
    #!/usr/bin/env bash
    set -euo pipefail
    docker compose up -d postgres --wait

    # `client_min_messages=warning`, because every `IF NOT EXISTS` in the
    # directory otherwise prints a NOTICE — and a wall of "already exists,
    # skipping" on a clean run teaches you to stop reading the output.
    psql() {
      docker compose exec -T -e PGOPTIONS='-c client_min_messages=warning' postgres \
        psql -v ON_ERROR_STOP=1 -U kithena -d kithena "$@"
    }

    psql -q -c "CREATE TABLE IF NOT EXISTS public.local_migration (
      filename text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )"

    # A database with a schema but no ledger was migrated by something else — an
    # older copy of this recipe, or Atlas — and there is no way to tell from
    # here how far it got. Guessing either skips a migration or repeats one, and
    # both fail later in a way that reads as a bug in the code.
    applied=$(psql -tAc "SELECT count(*) FROM public.local_migration")
    schema=$(psql -tAc "SELECT to_regclass('platform.tenant') IS NOT NULL")
    if [ "${applied}" = "0" ] && [ "${schema}" = "t" ]; then
      echo "This database has a schema but no migration ledger, so how much of" >&2
      echo "the directory it has already seen is unknown. Run 'just local-reset'." >&2
      exit 1
    fi

    for file in migrations/*.sql; do
      name=$(basename "${file}")
      seen=$(psql -tAc "SELECT EXISTS (SELECT 1 FROM public.local_migration WHERE filename = '${name}')")
      if [ "${seen}" = "t" ]; then continue; fi
      echo "applying ${name}"
      psql -q -f - < "${file}"
      psql -q -c "INSERT INTO public.local_migration (filename) VALUES ('${name}')"
    done

# Throw the local database away and build it again from the migrations.
#
# Destructive and meant to be: dropping the volume takes the roles, every
# company and every passkey with it, so the enrolment ceremony has to be walked
# again afterwards starting from `just admin-seed`.
local-reset:
    docker compose rm -sfv postgres
    docker volume rm -f kithena_pgdata18
    just local-db

# The tenant app on its own, on 3000. Reach it as acme.app.localhost:3000 —
# a bare localhost has no tenant label in front of the suffix, and the proxy
# answers 404 rather than guessing which company you meant.
#
# 3000 rather than 3200 to match the package's own `dev` script and
# `MODERN_TENANT_APP_BASE`, which is what the auth origin redirects to after a
# sign-in. Two ports for one app meant that redirect landed on nothing.
web-dev:
    node apps/web/scripts/build-renderer.mjs
    npx next dev apps/web -p 3000
