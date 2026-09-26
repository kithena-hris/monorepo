# Kithena

Headless, module-per-service HRIS. Every module is sellable on its own, which
is the constraint that explains most of the structure below.

The name is from `kith` — Old English for the people you belong among, and the
surviving half of _kith and kin_. Kin is the people you were born to; kith is
the people you came to know. An employer is kith.

The design system is a separate thing with a separate name, **Reach**, and
lives in `packages/ui` under the `@reach/*` scope. Kithena is built on it;
Reach does not know Kithena exists, and the dependency-cruiser rules keep it
that way.

## Getting started

```bash
mise install          # node, pnpm, just
pnpm install
cp .env.example .env
just dev              # compose up, migrate, seed, run everything
```

The gateway comes up on `http://localhost:4000`. Temporal UI is on `:8233`,
Mailpit on `:8025`, the SeaweedFS (local S3) admin UI on `:9001`.

The seed (`pnpm db:seed`) leaves a company to sign in to: **Acme**, with
`ada@acme.example` invited (it prints her enrolment link), named People's
administrator, People's employee fields published as version 1, and eight
sample employees in the directory, six active, one starting in a fortnight and
one not hired yet. Identity's seed writes the company, Ada and her naming the
way the back office does, events included. Debezium does not run locally, so
`pnpm --filter @kithena/identity events` prints identity's outbox and the seed
pipes it into People's (`services/people/src/seed-local.ts`), which hands each
event to People's consumer and then acts as Ada through People's own
endpoints. It is idempotent, and only fills a fresh
database: `just reset` for one.

### Working on a screen

`just dev` starts the whole infrastructure stack — Redpanda, Temporal, OpenFGA,
Typesense, SeaweedFS. Most days none of that is running for a reason. Use:

```bash
just local            # postgres, migrate, then every app, in one shell
just admin-seed       # print the link that enrols the first back-office passkey
```

| What | Where | Notes |
| --- | --- | --- |
| Back-office | `http://localhost:3001` | passkeys are bound to `localhost` |
| Auth origin | `http://auth.app.localhost:3100` | |
| A tenant | `http://acme.app.localhost:3000` | the label in front of the suffix is the company |
| Identity | `http://localhost:4100` | |
| Messaging | `http://localhost:4101` | logs invitations instead of sending them |
| Storybook | `http://localhost:6006` | `just storybook` |
| Mailbox | `http://localhost:8025` | every invitation and recovery link, rendered |

Nothing needs a hosts file: browsers resolve anything under `.localhost` to the
loopback and treat it as a secure context, which is the only reason WebAuthn
works here without a certificate.

**Email is real locally.** `SMTP_URL` points messaging at Mailpit, which
`docker-compose.yml` has always started, so every invitation and recovery link
arrives at `http://localhost:8025` rendered, with its links live and its markup
checkable. Without `SMTP_URL` the service falls back to writing the message to
the log, which is enough to copy a link out of and no use for the half of an
invitation that is HTML. Neither transport is reachable in production.

Two relying parties, so two passkeys. `app.localhost` covers the tenant apps and
the auth origin beneath it; the back-office is on `localhost:3001`, which is not
under that suffix and therefore cannot share the credential. Enrol the
back-office one with `just admin-seed`, then create a company there — inviting
somebody prints their enrolment link to the terminal, because no `RESEND_API_KEY`
means messaging logs a message rather than sending it.

`just local` applies `migrations/` with `psql` inside the container and records
what it applied in `public.local_migration`, so a new migration is picked up on
the next run and the companies and passkeys already in the database survive.
Atlas is still what writes and lints those files and what CI applies to staging
and production; it is simply not needed to run the app on a laptop. `just
local-reset` throws the database away and builds it again.

`.env` holds local values and nothing else. A machine that also needs the
staging connection strings should keep them in `.env.staging`, which nothing
loads automatically — `set dotenv-load` means anything in `.env` is what every
`just` recipe runs against, including `pnpm db:migrate`.

## Layout

```
apps/
  gateway/     Cosmo Router. Composes every subgraph into one graph.
  web/         Reference client. Not the product; the API is.
  admin/       Internal back-office. The only place tRPC is permitted.
  storybook/   Design system docs and the accessibility gate.
packages/
  ui/          Design system. Presentation only; imports no contract.
  contracts/   Zod schemas: events, classification, module manifests.
  domain-kit/  Entity, AggregateRoot, Result, Clock.
  db-kit/      Tenant RLS wrapper, outbox, column types.
  graphql-kit/ Shared Pothos builder, error mapping, context.
  auth-kit/    Principal, OpenFGA permissions, entitlements.
  telemetry/   OTel setup, Pino with generated redaction paths.
  testing/     Org-shape factories, Testcontainers fixtures.
services/
  people/      Owns the Person key. Source of record, or a facade over one.
  timeoff/     Extends Person. Runs standalone against an external HRIS.
tools/
  codegen/     Zod to JSON Schema, redaction paths, DSAR manifest.
```

## The rules that keep the architecture honest

**No cross-module imports.** A module talks to another module through events
and `packages/contracts`, never by importing it. Enforced by
`.dependency-cruiser.cjs`, checked in CI. This is the anti-sticky guarantee,
and it decays the moment it stops being mechanical.

**Every module boots alone.** `just standalone timeoff` starts the module with
no siblings and runs its acceptance suite. A module marked
`requiresPeopleSource: 'either'` must pass with People absent.

**Two TypeScript compilers, on purpose.** TypeScript 7 runs `tsc` for fast
local checks and the editor. TypeScript 6 runs `tsc6` and gates merges,
because the Go port can still disagree on edge cases and typescript-eslint
needs the 6.0 programmatic API until 7.1. Collapse this to one once 7.1 ships.

**Zod is the schema spine.** One definition produces the TypeScript type, the
JSON Schema in the Redpanda registry, the OpenAPI spec, the GraphQL input
validation, and the form resolver. `just codegen` regenerates the derived
artifacts and fails when a contract field has no classification policy.

**Classification drives enforcement.** A field registered as
`aiEligible: false` is rejected by the AI gateway, redacted by the logger,
and included in the DSAR manifest, all from one declaration. Do not hand-edit
`packages/telemetry/src/generated/`.

**Effective dating is not optional.** `occurredAt` is when we recorded it,
`effectiveFrom` is when it takes effect in the domain. A promotion entered on
the 15th and effective on the 1st needs both, or payroll cannot compute a
retroactive delta later.

**One design system, no per-module interfaces.** Every screen renders through
`@reach/ui`, which is what makes a tenant who bought only Time Off feel like
they bought part of one product. The package is presentation only — it imports
no contract, no domain type and no data client, and dependency-cruiser fails
the build if that changes. `just storybook` to browse it; `just test-stories`
renders every story in Chromium and runs axe over the result, in CI.

## Adding a module

1. `services/<name>/module.manifest.ts` with `dependsOn: []`. If you cannot
   write an empty array, reconsider the boundary.
2. Event contracts in `packages/contracts/src/events/<name>.ts`, every field
   registered with a classification policy.
3. Domain in `src/domain/`, free of drivers and frameworks.
4. Subgraph in `src/graphql/`, extending federated types rather than owning
   what it does not own.
5. Add it to the `standalone` matrix in `.github/workflows/ci.yml`.

## Licence

Proprietary. Copyright (c) 2026 Kithena, all rights reserved — see
[LICENSE](./LICENSE).

The source is public so that customers, auditors and security researchers can
read it. That is not a grant of rights: you may read it and quote it, and any
other use — running it, copying it, modifying it, or offering a service based on
it — requires a commercial subscription agreement. This is the model Lattice,
Personio and HiBob use, except that they do not publish the source at all.

Not open source, and GitHub labels it "Other" for that reason. To purchase a
licence or ask whether an intended use is permitted, contact info@kithena.com.
