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
