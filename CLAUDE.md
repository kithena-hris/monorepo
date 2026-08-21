# Kithena

Headless, module-per-service HRIS. Every module must be sellable on its own.
That single constraint explains most of the structure here, so check any
proposal against it before writing code.

## Decisions already made

Do not relitigate these. If you think one is wrong, say so and stop rather
than quietly working around it.

- **TypeScript 7** (`tsc`) for fast local checks and the editor. **TypeScript
  6** (`tsc6`, via the `typescript6` npm alias) is the merge gate, because 7.0
  ships no programmatic API and typescript-eslint cannot run on it until 7.1.
  Collapse to one compiler when 7.1 lands.
- **GraphQL federation** with Pothos subgraphs and the Cosmo Router. No Apollo
  Router (Elastic license blocks self-hosted enterprise deployments).
- **No tRPC** anywhere in `services/*` or `packages/*`. It is permitted in
  `apps/admin` only. Connect-RPC is the escape hatch if typed synchronous RPC
  ever becomes necessary.
- **Zod 4** is the single schema source. One definition generates the TS type,
  the JSON Schema for the Redpanda registry, the OpenAPI spec, the GraphQL
  input validation, and the form resolver. Never hand-write a derived artifact.
- **Redpanda** with a transactional outbox and Debezium CDC. No dual writes.
- **Postgres 17**, schema-per-module, RLS for tenant isolation, Drizzle for
  queries, Atlas for migrations.
- **OpenFGA** for authorization. Org charts are graphs, not role tables.
- **Temporal** for long-running human-in-the-loop workflows. BullMQ for
  fire-and-forget jobs.
- **Two names, and they are not interchangeable.** The product is **Kithena**
  (`@hris/*`, `apps/web`, `apps/admin`, `services/*`). The design system is
  **Reach** (`@reach/*`, `packages/ui`, `apps/storybook`, `apps/docs`). Reach
  must never learn that Kithena exists; the dependency-cruiser rules already
  forbid the import, `pnpm docs:brand-leak` forbids the name reaching the
  documentation, and the naming should not blur what they enforce. Both marks
  live in `packages/ui/src/brand`, because a mark is presentation and nothing
  else.

  **Reach is used internally for now**, but its two sites are public:
  `design.kithena.com` and `storybook.kithena.com`. That is not the preference —
  Vercel's Hobby plan cannot protect a production deployment or a custom domain
  at all, and the API refuses `ssoProtection` on production outright. Assume
  anything in `apps/docs` or a non-excluded story is world-readable, because it
  is.

  This is exactly why `pnpm docs:brand-leak` is a merge gate rather than a
  convention, and why `.storybook/main.ts` excludes the mark's stories: the two
  checks are the only thing standing between an unreviewed example and the
  Kithena brand on a public URL. Selling Reach separately stays a live option,
  which is also why the naming rule holds — the dependency boundary is expensive
  to reverse and stays regardless, and the naming rule costs nothing while it is
  cheap. The day the docs start saying "Kithena", separation stops being a
  decision and becomes a project. Revisit deliberately, not by letting a
  reference slip in.

- **One design system, `packages/ui`.** Tailwind v4 (CSS-first, tokens as
  `@theme` variables), Radix primitives for behaviour, CVA for variants. It
  ships TypeScript source rather than build output — Next compiles it via
  `transpilePackages`, Vite compiles it directly. Storybook 9 hosts the docs
  and runs axe over every story as a merge gate.
- **Density is a property of the pointer, not of the screen.** Control heights
  come from `--reach-control-*`, which `@media (pointer: coarse)` re-points to
  the 44px tap floor and `[data-platform='tv']` re-points again for a 10-foot
  UI. A component never asks how wide the window is. Platform is declared by
  the app on `<html>`; it is not sniffed, because no media feature separates a
  1920px television from a 1920px monitor.
- **Two UI dependencies beyond Radix, both for behaviour nobody should
  hand-roll.** `@dnd-kit` for drag and drop: the native HTML API does not fire
  on touch at all, its drag image is unstyleable, and it has no keyboard story
  — dnd-kit supplies a keyboard sensor and the live-region announcements a drag
  needs to be audible. `@tiptap` (ProseMirror) for rich text: a
  `contenteditable` emits whatever markup the browser felt like, and content
  that is stored, versioned, exported and shown to a labour inspector has to be
  identical on every browser. Both are presentation-layer only and stay inside
  `packages/ui`.
- **Drag and drop keeps a preview of itself mid-gesture.** A destination
  container that has not been told a card is coming cannot open a gap for it,
  so the Kanban board moves the item in a throwaway copy as it crosses a
  boundary and discards that copy on drop. The props stay the truth either side
  of the drag.
- **Charts are hand-drawn SVG in `packages/ui`, not a charting library.** The
  four shapes a dashboard needs are a few hundred lines; a library brings its
  own colour system, tooltip and focus behaviour, and the design system would
  then have two sources of truth for a colour and none for a focus ring. A
  module needing a genuinely analytical chart takes that as a module
  dependency.

Full reasoning lives in `docs/tech-stack.md`.

## Rules that are enforced, not suggested

**No cross-module imports.** A module reaches another module through events
and `packages/contracts`, never by importing it. `.dependency-cruiser.cjs`
fails the build. If a feature seems to need a direct import, the boundary is
wrong; raise it rather than adding an exception.

**Every module boots alone.** `just standalone <module>` starts a module with
no siblings present and runs its acceptance suite. A module declaring
`requiresPeopleSource: 'either'` must pass with the People module absent.

**Every contract field carries a classification policy.** `just codegen`
walks the Zod registry and exits non-zero on an unclassified field. The same
walk emits the Pino redaction paths, the AI gateway deny list, and the DSAR
export manifest. Files under `packages/telemetry/src/generated/` are outputs,
never edited by hand.

**Effective dating on everything.** `occurredAt` is when we recorded it,
`effectiveFrom` is when it takes effect in the domain. A promotion entered on
the 15th and effective on the 1st needs both, or payroll cannot compute a
retroactive delta. Corrections are typed events carrying `supersedes`, never
silent updates.

**The design system stays presentational.** `packages/ui` may not import a
contract, a domain type or a data client, and `services/*` may not import
`packages/ui`. Both directions are dependency-cruiser rules. A module composes
screens out of the system; it never teaches the system what a Person is.

**Money is never a float.** `numeric(19,4)` in Postgres, minor units in
transport, `decimal.js` in application code. Calendar dates (hire, leave,
birthday) are `date`, not timestamps.

**No `new Date()` in domain code.** Inject `Clock` from `@hris/domain-kit`.
Effective-dated logic is untestable otherwise.

## Layer boundaries

```
src/domain/          Pure. No drivers, no frameworks, no I/O.
                     Invariants and Result-returning operations live here.
src/application/     Use cases. Orchestrates domain + repositories + outbox.
src/infrastructure/  Drizzle repositories, Kafka consumers, external adapters.
src/graphql/         Subgraph. Thin. Maps domain failures to GraphQL errors.
```

Authorization is enforced in the domain and application layers, never only in
a resolver. GraphQL is one transport of four (REST, SCIM, webhooks, workers)
and a rule that lives in a resolver is a rule that leaks.

Zod validates shape at boundaries. Aggregate invariants live in domain
objects, and where a race is possible they are also enforced by a Postgres
constraint. A `superRefine` that queries the database is a design error.

## Commands

```bash
just dev                  # compose up, migrate, seed, run everything
just check                # fast typecheck (TS 7)
just check-strict         # authoritative typecheck (TS 6) — what CI gates on
just lint                 # oxlint + eslint + dependency boundaries
just test                 # unit
just test-all             # unit + integration + contract
just codegen              # regenerate derived artifacts from Zod contracts
just standalone timeoff   # boot one module with no siblings
just supergraph           # compose the federated schema locally
just storybook            # design system docs on :6006
just test-stories         # render every story in Chromium, run axe over it
```

## Adding a module

1. `services/<name>/module.manifest.ts` with `dependsOn: []`. If that array
   cannot be empty, stop and discuss the boundary.
2. Event contracts in `packages/contracts/src/events/<name>.ts`, every field
   registered with a classification policy.
3. Domain first, then application, then infrastructure, then subgraph.
4. Extend federated types rather than owning what the module does not own.
5. Add the module to the `standalone` matrix in `.github/workflows/ci.yml`.

## Working style

Write the failing test before the implementation for anything in `src/domain/`.
That layer is pure, so tests are cheap and the bugs that matter live there.

Prefer editing an existing file over creating a new one. Do not add a
dependency without saying why the existing stack cannot cover it.

Migrations are expand-contract only: add nullable, backfill, write, stop
reading, drop later. There are no down migrations against a multi-tenant
production database.
