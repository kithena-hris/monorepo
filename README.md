# Kithena

Headless, module-per-service HRIS. Every module is sellable on its own, which
is the constraint that explains most of the structure below.

The name is from `kith` — Old English for the people you belong among, and the
surviving half of *kith and kin*. Kin is the people you were born to; kith is
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
Mailpit on `:8025`, MinIO console on `:9001`.

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
