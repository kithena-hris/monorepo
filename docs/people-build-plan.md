# People module — build plan

Every ticket needed to ship the People module, in an order that works. Tick
each box as it lands.

**This file, in the repository, is the record of progress.** The published copy
linked below is read-only — a snapshot for reading and sharing, whose
checkboxes go stale the moment the next ticket lands. Change a box here, in
git, and nowhere else.

**Specs**

| What | Where |
| --- | --- |
| Requirements | [`docs/people-prd.md`](./people-prd.md) · [published](https://claude.ai/code/artifact/aec9b244-64f7-4f53-ab16-7ae6e572da6a) |
| Screens | [published design, 13 screens](https://claude.ai/code/artifact/4d719b45-46cb-45da-9a0a-6b845f03332f) |
| This file, to read or share | [read-only copy](https://claude.ai/code/artifact/647ccf50-72b0-43ab-bd0a-7cbdd3ce9fd0) — a snapshot. Its checkboxes do not track progress |
| Repo rules | [`CLAUDE.md`](../CLAUDE.md) |
| Layer boundaries | [`docs/code-structure.md`](./code-structure.md) |
| Reach usage | `.claude/skills/reach-ui/SKILL.md` |

---

## How to work a ticket

1. **Read the spec references first.** Every ticket names a PRD section and,
   where there is one, a screen. They are the acceptance criteria; this file is
   only the order.
2. **Check `Depends on`.** If a dependency is unticked, stop and do that one.
3. **Domain work is test-first.** Anything under `src/domain/` gets its failing
   test before its implementation. That layer is pure, so tests are cheap and
   the bugs that matter live there.
4. **`Done when` is a command, not a feeling.** If it does not name something
   runnable, the ticket is under-specified — fix the ticket before the code.
5. **Tick the box in this file, commit, move on.** One ticket per PR where it
   is reasonable. The commit is the audit trail — nothing else needs updating,
   and the published copy is deliberately not kept in step.

### Rules no ticket restates

- No cross-module imports. `dependsOn: []` stays empty.
- Zod is the single schema source. Never hand-write a derived artifact.
- Every contract field carries a classification policy or `just codegen` fails.
- `occurredAt` and `effectiveFrom` are both required. Corrections carry
  `supersedes`; nothing is updated silently.
- Money is `numeric(19,4)` and minor units in transport. Calendar dates are
  `date`.
- No `new Date()` in domain code — inject `Clock`.
- Migrations are expand-contract. No down migrations.
- Screens are built from Reach. Missing something? Add it to Reach first, as a
  variant on the nearest component.
- Authorization is enforced in domain and application, never only in a resolver.

### Tracks that can run in parallel

```
  A  contracts ──▶ domain ──▶ application ──▶ infrastructure ──▶ transports
  B  migrations and storage          (from PEO-018, needs A's contracts only)
  C  UI shell and screens            (from PEO-046, needs the schema contract)
  D  governance: redaction, DSAR     (from PEO-034, needs A)
```

Phase 1 is done when every box down to PEO-060 is ticked and
`just standalone people` is green in CI.

---

## Phase 0 — unblock

Three small things that other tickets wait on. None takes a day.

### [x] PEO-001 — Export the four missing charts from Reach

**Goal** `HorizontalBarChart`, `StackedBarChart`, `HeatmapChart` and
`FunnelChart` are implemented in
`packages/ui/src/components/chart/chart.tsx` and have stories, but are absent
from the package's public API. Analytics needs all four.

- **Spec** PRD §16.2 · design screen 12
- **Files** `packages/ui/src/index.ts`
- **Depends on** nothing
- **Approach** Add the four names to the existing chart export block. No new
  components, no new dependency, no behaviour change.
- **Done when** `pnpm --filter @reach/ui typecheck` passes, the four are
  importable from `@reach/ui`, and `pnpm test:stories` is green.

### [x] PEO-002 — `identity.account.profile_captured`

**Goal** Identity captures a name, time zone and mobile at enrolment and
publishes nothing. People cannot see any of it, and polling another service's
table is not a thing this system does.

- **Spec** PRD §5.1
- **Files** `packages/contracts/src/events/identity.ts`,
  `platform/identity/src/credential/application/complete-enrolment.ts`
- **Depends on** nothing
- **Approach** New event carrying `accountId`, `identityId`, `name`,
  `timeZone`, `mobilePresent: boolean` and `capturedAt`. **The number itself is
  not in the payload** — People asks for it under its own classification, and
  an event carrying a phone number to a consumer that may not need it is a
  phone number in one more log. Raise it from the enrolment aggregate into the
  outbox, alongside `account.enrolled`.
- **Done when** `just codegen` passes, a contract test asserts the payload has
  no `mobile` field, and an integration test sees the event in the outbox after
  an enrolment.

### [x] PEO-003 — `svc_people` and the schema bootstrap

**Goal** A database role and an empty `people` schema with the RLS pattern the
rest of the tickets build on.

- **Spec** PRD §11.2
- **Files** `migrations/<ts>_people_bootstrap.sql`, `tools/scripts/init-db.sql`
- **Depends on** nothing
- **Approach** `CREATE SCHEMA people`. Create `svc_people` `NOBYPASSRLS` if
  absent, the same way the messaging and identity migrations do — a bare GRANT
  fails in the throwaway Postgres an integration test starts. Establish the
  `NULLIF(current_setting('app.tenant_id', true), '')::uuid` policy form as the
  pattern every later table copies.
- **Done when** `pnpm db:migrate` applies clean twice, and an integration test
  proves a connection without `app.tenant_id` set sees nothing.

---

## Phase 1 — MVP

### Contracts

Nothing below writes to a database. Get the vocabulary right first; every other
track reads it.

### [x] PEO-004 — Registry primitives

- **Spec** PRD §6.2, Appendix B
- **Files** `packages/contracts/src/people/primitives.ts`
- **Depends on** nothing
- **Approach** `AttributeKey` and `SectionKey` as branded slugs — lowercase,
  underscore-separated, immutable once chosen. `LocalizedString` as a locale
  map with a required default. Register a policy on every field.
- **Done when** `just codegen` passes and a test proves a key with a hyphen,
  a leading digit or an uppercase letter is refused.

### [x] PEO-005 — Data types and their configuration

- **Spec** PRD §6.4
- **Files** `packages/contracts/src/people/data-type.ts`
- **Depends on** PEO-004
- **Approach** `AttributeDataType` enum, then `AttributeTypeConfig` as a
  discriminated union on it — options for `select`, min/max for `number`,
  currency for `money`, country for `national_id` and `bank_account`, accepted
  types for `document_ref`. Reuse `PostalAddress` for `address` and `Money` for
  `money` rather than redefining either.
- **Done when** a test proves a `select` without options fails to parse, and a
  `money` config cannot express a float.

### [x] PEO-006 — Requiredness and its predicate

- **Spec** PRD §6.5
- **Files** `packages/contracts/src/people/requiredness.ts`
- **Depends on** PEO-004
- **Approach** Discriminated union on `mode`: `never`, `always`, `conditional`.
  The predicate is a **closed grammar** over `legalEntity`, `country`,
  `employmentType`, `workModel`, `status` and another attribute being set or
  equal. No user-authored expressions, no loops. `requiredFrom` and `appliesTo`
  on the dated modes.
- **Done when** a test proves an unknown operand is refused at parse time, not
  at evaluation time.

### [x] PEO-007 — `AttributeDefinition`

- **Spec** PRD §6.2, Appendix B
- **Files** `packages/contracts/src/people/attribute-definition.ts`
- **Depends on** PEO-005, PEO-006, PEO-008
- **Approach** The full object from Appendix B, including the two refinements
  that are not negotiable: special-category is never `aiEligible` and never
  `includeInEvents`; financial is always `encrypted`.
- **Done when** tests prove both refinements refuse, and that `includeInEvents`
  defaults to false for anything `confidential` or above.

### [x] PEO-008 — `FieldPolicySchema` and the runtime registry type

- **Spec** PRD §12.2
- **Files** `packages/contracts/src/people/policy.ts`
- **Depends on** nothing
- **Approach** A Zod mirror of the existing `FieldPolicy` **interface** in
  `classification.ts`. Same vocabulary, not a parallel one — the whole point is
  that the runtime registry and the static registry produce one union.
- **Done when** a type-level test asserts `z.infer<typeof FieldPolicySchema>`
  is assignable to `FieldPolicy` and back.

### [x] PEO-009 — Schema events

- **Spec** PRD §10.1
- **Files** `packages/contracts/src/events/people.ts`
- **Depends on** PEO-007
- **Approach** `section_created/updated/archived`,
  `attribute_created/updated/archived`, `schema.published`. These carry **field
  definitions, never employee values** — a consumer wanting the whole shape
  fetches the published artifact by version.
- **Done when** a contract test asserts no schema event payload can hold a
  person id or a value.

### [x] PEO-010 — Person events

- **Spec** PRD §10.2, §10.3
- **Files** `packages/contracts/src/events/people.ts`
- **Depends on** PEO-007
- **Approach** Add `provisioned`, `identity_linked`, `profile_updated`,
  `attribute_corrected`, `job_changed`, `org_changed`,
  `compensation_changed`, `status_changed`, `profile_incomplete`,
  `profile_completed`, `merged`, `anonymised`. Extend `hired` with
  `schemaVersion` and `sourceOfRecord`. Update the manifest's `publishes`.
- **Done when** `just codegen` passes, the manifest contract test is green, and
  a test proves an encrypted or special-category attribute cannot appear in a
  payload's value map.

### Domain

Test-first, all of it. No drivers, no I/O.

### [x] PEO-011 — Section and attribute aggregates

- **Spec** PRD §6.2, §6.3
- **Files** `services/people/src/domain/schema/`
- **Depends on** PEO-007
- **Approach** Invariants: a core attribute's classification cannot be
  loosened and its requiredness cannot be lowered; an archived section cannot
  hold a required attribute; a required attribute cannot be invisible to
  everyone who owns it; a key is immutable. Result-returning operations, no
  throwing.
- **Done when** every invariant has a failing-first test and `just test` is
  green with no database running.

### [x] PEO-012 — Publishing a schema version

- **Spec** PRD §6.1, §9.3
- **Files** `services/people/src/domain/schema/publish.ts`
- **Depends on** PEO-011
- **Approach** A version is immutable and append-only. Publishing computes a
  checksum and a diff against the previous version — added, tightened,
  archived. "Rolling back" publishes the previous content as a **new** version,
  for the same reason there are no down migrations.
- **Done when** a test proves a published version cannot be mutated, and that a
  rollback produces version n+1 rather than editing n−1.

### [x] PEO-013 — Requiredness evaluation

- **Spec** PRD §6.5
- **Files** `services/people/src/domain/schema/requiredness.ts`
- **Depends on** PEO-006, PEO-011
- **Approach** Pure evaluation of a predicate against a person's facts. A
  predicate that **cannot** be evaluated — it names an archived attribute —
  evaluates to *not required* and returns a signal for an operational alert.
  Failing towards "required" would lock a tenant out of their own records over
  a configuration typo.
- **Done when** a test covers each operand, `requiredFrom` in the past and
  future, and the unevaluable case.

### [x] PEO-014 — Completeness

- **Spec** PRD §8.4
- **Files** `services/people/src/domain/person/completeness.ts`
- **Depends on** PEO-013
- **Approach** Derive `complete`, `incomplete` with the missing keys and their
  owners, or `not_applicable` for provisional and discarded records. Pure
  function of (person, published version, clock).
- **Done when** tests cover a provisional record, a newly-required field with a
  future `requiredFrom`, and a field required only in one country.

### [x] PEO-015 — The person aggregate and its state machine

- **Spec** PRD §8.1
- **Files** `services/people/src/domain/person/`
- **Depends on** PEO-010
- **Approach** `provisional → pre_hire → active → on_leave / notice →
  terminated`, plus `discarded` from provisional only. Terminated is a
  tombstone — employment records outlive employment. `discarded` is the only
  state permitting a hard delete.
- **Done when** every illegal transition has a test proving it is refused.

### [x] PEO-016 — Effective-dated values and corrections

- **Spec** PRD §8.5
- **Files** `services/people/src/domain/person/history.ts`
- **Depends on** PEO-015
- **Approach** A change is a new dated fact. A correction carries `supersedes`
  and never overwrites. An attribute with `effectiveDated: false` keeps the
  correction path but has no `asOf` query. Reads take an optional `asOf`
  defaulting to today.
- **Done when** a test proves a salary typo corrected three months later does
  not read as a pay cut followed by a raise.

### [x] PEO-017 — Field-level authorization

- **Spec** PRD §6.6
- **Files** `services/people/src/domain/access/`
- **Depends on** PEO-007
- **Approach** Pure intersection of an attribute's `visibility` with the
  viewer's relations, and of `ownership` with the writer's. **A field the
  viewer may not read is absent from the result, not present-and-null** —
  present-and-null tells a manager a field exists and has a value, which for a
  self-ID answer is the disclosure itself.
- **Done when** a test asserts the redacted shape has no key at all, and that
  the same decision function is what both the read and the write path call.

### Storage

### [x] PEO-018 — Registry tables

- **Spec** PRD §11.1
- **Files** `migrations/<ts>_people_registry.sql`
- **Depends on** PEO-003
- **Approach** `people.section`, `people.attribute_definition`,
  `people.schema_version`. RLS with FORCE on all three. `classification` is
  `NOT NULL` — there is no "unclassified" state and no default meaning "decide
  later".
- **Done when** an integration test proves a definition row cannot be inserted
  without a policy, and that a second tenant's connection sees none of it.

### [x] PEO-019 — Person tables

- **Spec** PRD §11.1, §11.2
- **Files** `migrations/<ts>_people_person.sql`
- **Depends on** PEO-018
- **Approach** `people.person` with typed core columns and a `custom jsonb`;
  `people.person_attribute_history` append-only with `supersedes` and
  `event_id`; `people.person_secret` with its own RLS and grant;
  `people.attribute_unique`; `people.outbox` mirroring `platform.outbox`.
  `numeric(19,4)` for money, `date` for calendar dates, GIN on `custom`.
- **Done when** RLS is proven per table, and a test asserts
  `people.person_secret` has no plaintext column.

### [x] PEO-020 — Repositories and the outbox

- **Spec** PRD §7, rule 2
- **Files** `services/people/src/infrastructure/`
- **Depends on** PEO-019, PEO-015
- **Approach** Drizzle repositories. **No path writes a person row without an
  outbox row in the same transaction.** Scope objects rather than closures over
  a pool, for the reason `invite-account.ts` sets out: `app.tenant_id` is
  transaction-scoped, and a shape that cannot express "these run together" is
  one where RLS refuses the second statement with a 42501 and nothing says why.
- **Done when** an integration test proves a rolled-back write leaves neither
  the row nor the event.

### [x] PEO-021 — The secret store

- **Spec** PRD §11.2
- **Files** `services/people/src/infrastructure/secret-store.ts`
- **Depends on** PEO-019
- **Approach** Envelope encryption, `key_id` recorded per row, `last4` kept for
  display. Bank accounts, national identifiers and tax identifiers never reach
  `custom` and never reach an event.
- **Done when** a test asserts the plaintext appears in no other table, no log
  line and no event payload.

### [x] PEO-022 — Uniqueness without runtime DDL

- **Spec** PRD §11.2
- **Files** `services/people/src/infrastructure/unique.ts`
- **Depends on** PEO-019
- **Approach** A uniqueness rule on a tenant-defined attribute is a row in
  `people.attribute_unique` with a real unique index over
  `(tenant_id, attribute_key, scope_id, normalised_value)`, written in the same
  transaction as the value. **Not `CREATE INDEX` at runtime** — DDL against a
  multi-tenant production database is an outage with a settings screen in front
  of it.
- **Done when** a concurrency test fires simultaneous writes of the same
  employee number and proves exactly one wins.

### [x] PEO-023 — Promoting an indexed attribute

- **Spec** PRD §11.2
- **Files** `tools/scripts/promote-attribute.ts`, a migration template
- **Depends on** PEO-019
- **Approach** An attribute marked `indexed` becomes a generated column with
  its own index, produced as a **migration file** for review — not applied at
  runtime. This is what makes a 50,000-row directory filter on a custom field
  survivable.
- **Done when** running the tool emits a valid Atlas migration and `just
  check-strict` passes on the generated code.

### Application

### [x] PEO-024 — Configure and publish the schema

- **Spec** PRD §9.3
- **Files** `services/people/src/application/schema/`
- **Depends on** PEO-012, PEO-018
- **Approach** Draft edits, then publish. Publishing computes the **impact
  preview** — how many people become incomplete, split by who owns each missing
  field — before anything is written. The preview is the part that prevents an
  admin marking six fields required on a Friday and mailing four hundred
  people.
- **Done when** an integration test publishes a version and asserts the preview
  count matches the count after the recompute in PEO-026.

### [x] PEO-025 — Reading and writing a person

- **Spec** PRD §6.6, §8.5
- **Files** `services/people/src/application/person/`
- **Depends on** PEO-017, PEO-020
- **Approach** Every read and write passes the authorization decision from
  PEO-017 and validates against the published schema version, which is stored
  on the row. Corrections go through the correction path, never an update.
- **Done when** a test proves a manager's read of a salary attribute returns a
  result with no such key, through this layer rather than through a resolver.

### [x] PEO-026 — Completeness recompute and its events

- **Spec** PRD §8.4
- **Files** `services/people/src/application/completeness/`
- **Depends on** PEO-014, PEO-024
- **Approach** On publish, re-evaluate every person in scope in a bounded job.
  Raise `profile_incomplete` with missing keys and owners. Employee-owned gaps
  become a task and a reminder on a decaying schedule — **never more than one
  reminder email per person per week regardless of how many fields are
  missing**. HR-owned gaps aggregate into one grid, not one task each.
- **Done when** a test publishes a tightening version over 400 seeded people
  and asserts both the event count and the one-email-per-week cap.

### [x] PEO-027 — The provisional person

- **Spec** PRD §8.2, steps 3 and 5
- **Files** `services/people/src/infrastructure/consumers/`
- **Depends on** PEO-002, PEO-015, PEO-020
- **Approach** Consume `identity.account.provisioned` → create a `provisional`
  person holding only `identityAccountId`, `workEmail`, `timeZone`,
  `employmentStart`. No required-field evaluation, no task, no nag. Consume
  `identity.account.profile_captured` → fill the name.
- **Done when** an integration test provisions an account and sees a
  provisional person within a second, idempotent on `identityAccountId`.

### [x] PEO-028 — Reconciliation for tenants who buy People later

- **Spec** PRD §8.2, "People is bought later"
- **Files** `services/people/src/application/reconcile.ts`
- **Depends on** PEO-027
- **Approach** Call identity's internal HTTP endpoint for the tenant's
  accounts — the same internal-token mechanism identity already uses to reach
  messaging — and create a provisional person per account.
- **Done when** running it twice over the same tenant changes nothing the
  second time.

### [x] PEO-029 — People corrects identity's copies

- **Spec** PRD §5, the direction rule
- **Files** `platform/identity/src/.../consumers/`
- **Depends on** PEO-010
- **Approach** Identity consumes `people.person.hired` and
  `people.person.profile_updated` and corrects its cached start date and name.
  **One direction only.** A tenant with no People module keeps identity's
  copies as the only truth, which is what `requiresPeopleSource` exists to keep
  honest.
- **Done when** a contract test asserts no People consumer reads an identity
  table, and no identity path writes a People one.

### Transports

### [x] PEO-030 — The GraphQL subgraph

- **Spec** PRD §13.1
- **Files** `services/people/src/graphql/`
- **Depends on** PEO-025
- **Approach** Thin. Maps domain failures to GraphQL errors and nothing more.
  Tenant-defined attributes are exposed as a typed union generated from the
  published schema version, not a stringly-typed bag. Extend federated types
  rather than owning what People does not own.
- **Done when** `just supergraph` composes and a query for a redacted field
  returns a result without the key.

### [x] PEO-031 — REST v1

- **Spec** PRD §13.2
- **Files** `services/people/src/http/`
- **Depends on** PEO-025
- **Approach** The routes in §13.2. OpenAPI **generated from the same Zod
  definitions** — never hand-written. Idempotency keys on every write, cursor
  pagination, identical field-level authorization because both transports call
  the same application layer.
- **Done when** a contract test runs the same authorization scenario through
  GraphQL and REST and asserts identical visible fields.

### [x] PEO-032 — Webhooks

- **Spec** PRD §13.3
- **Files** `services/people/src/infrastructure/webhooks/`
- **Depends on** PEO-031
- **Approach** HMAC over the raw body, per-endpoint secret with a rotation
  overlap. Per-person ordering. At-least-once with `eventId` for
  deduplication. Backoff to 24 hours, then disable and tell the tenant. Replay
  re-filters against the **current** allowlist, not the one in force at
  delivery.
- **Done when** a test proves a replay after an allowlist was narrowed does not
  resend the removed field.

### [x] PEO-033 — The published schema artifact

- **Spec** PRD §13.4
- **Files** `services/people/src/http/schema-artifact.ts`
- **Depends on** PEO-024
- **Approach** Each published version fetchable as JSON Schema, generated from
  the same Zod definitions, so an integrator can pin to a version and generate
  types. `schema.published` tells them a new one exists.
- **Done when** two published versions are independently fetchable and the
  older one is byte-identical across requests.

### Governance

### [x] PEO-034 — The runtime policy registry

- **Spec** PRD §12.2
- **Files** `packages/telemetry/src/`, `services/people/src/infrastructure/`
- **Depends on** PEO-018
- **Approach** Redaction paths are the **union** of the static generated set
  and a per-tenant set loaded at boot and refreshed on `schema.published`. The
  guarantee `just codegen` makes about classification has to survive a field
  created on a Tuesday afternoon.
- **Done when** a test creates a tenant attribute, logs a value, and asserts it
  is redacted without a restart.

### [x] PEO-035 — The AI gateway deny list

- **Spec** PRD §12.2
- **Files** wherever the gateway's deny list is assembled
- **Depends on** PEO-034
- **Approach** Same union. A prompt carrying an attribute where
  `aiEligible: false` is **refused by the gateway**, not filtered by a caller.
- **Done when** a test asserts a prompt containing a tenant-defined
  special-category attribute is refused at the gateway.

### [x] PEO-036 — DSAR export

- **Spec** PRD §12.2, §15.5
- **Files** `services/people/src/application/dsar/`
- **Depends on** PEO-034, PEO-021
- **Approach** Generated per tenant, per request, from the published schema
  version **the record was written under** — which is why that version is on
  the person row. Runs as the subject: every `exportable` attribute including
  special-category, the full history, the event log, as a zip of PDF, JSON and
  attachments.
- **Done when** an integration test asserts 100% of exportable attributes
  including tenant-defined ones appear, in under 60 seconds.

### [x] PEO-037 — Retention targets

- **Spec** PRD §6.2, §8.1
- **Files** `services/people/src/application/retention/`
- **Depends on** PEO-034
- **Approach** Retention jobs read the same union. A terminated record is
  anonymised on schedule per classification, honouring any `statutoryFloor`.
  `people.person.anonymised` records which classes were cleared.
- **Done when** a test proves a statutory floor beats a shorter tenant policy.

### Import and export

### [x] PEO-038 — Upload, detect, parse

- **Spec** PRD §14.1, §14.2
- **Files** `services/people/src/application/import/`
- **Depends on** PEO-025
- **Approach** CSV/TSV with encoding, BOM and delimiter detection; XLSX with
  sheet selection. Nothing is written by this ticket.
- **Done when** fixtures for UTF-8-BOM, semicolon-delimited and multi-sheet
  files all parse to the same intermediate shape.

### [x] PEO-039 — Column mapping

- **Spec** PRD §14.3, §12.4
- **Files** `services/people/src/application/import/mapping.ts`,
  `services/people/src/infrastructure/typesafe-attribute-advisor.ts`
- **Depends on** PEO-038
- **Approach** Exact key, then label, then a System One `Choice` over the
  candidate list with a `no_match` option — auto-mapping at ≥ 0.9, manual
  below. The advisor sits **behind a port in infrastructure**; the domain never
  imports it, and the module boots with no TypeSafe key configured. A column
  matching nothing is ignored, mapped by hand, or turned into an attribute
  through the field editor — **classification step included**.
- **Done when** the module's tests pass with the advisor absent, and a test
  proves an unmatched column cannot become an attribute without a policy.

### [x] PEO-040 — The dry run

- **Spec** PRD §14.4
- **Files** `services/people/src/application/import/dry-run.ts`
- **Depends on** PEO-039, PEO-014
- **Approach** Classify every row: create, update, unchanged, **blocked**,
  duplicate — and separately count how many will import *incomplete*. The three
  outcomes are deliberately asymmetric:
  - missing **core identity** field → row blocked;
  - missing any other **required** field → row imports, person incomplete;
  - **invalid** value → row blocked, cell named.
- **Done when** a fixture file covering all three produces exactly the counts
  in PRD §14.4, and nothing is written.

### [x] PEO-041 — Commit, idempotency, report

- **Spec** PRD §14.5
- **Files** `services/people/src/application/import/commit.ts`
- **Depends on** PEO-040
- **Approach** Partial commit — blocked rows never prevent good ones. An import
  key derived from the file checksum makes a re-upload report "already
  imported" rather than duplicating 400 people. The report is downloadable CSV
  with original row number, original values and reason.
  `people.import.started/completed` carry counts and attribute keys, never a
  value and never the file.
- **Done when** importing the same file twice creates one set of people, and
  the blocked-row CSV re-imports cleanly after a fix.

### [x] PEO-042 — CSV and XLSX export

- **Spec** PRD §15.2, §15.4
- **Files** `services/people/src/application/export/`
- **Depends on** PEO-025
- **Approach** Columns generated from the published schema in section order.
  **Two header rows** — label, then stable key — which is what makes a
  round-trip safe after a relabel. Repeating attributes get their own sheet,
  never `contact_1_name … contact_4_email`. Money is a **numeric cell with a
  currency format**, dates are date cells, option fields get validation
  dropdowns. Missing required: amber fill and a **Missing information** sheet
  in XLSX, a `__missing_required` column in CSV. An "About this export" sheet
  carries schema version, `asOf`, filter, field list and who ran it.
- **Done when** a round-trip test — export, edit one cell, re-import — changes
  only that cell, and a test asserts the salary column sums in a spreadsheet
  engine.

### [x] PEO-043 — Export jobs and their audit trail

- **Spec** PRD §15.1
- **Files** `services/people/src/application/export/job.ts`
- **Depends on** PEO-042
- **Approach** Over 2,000 rows runs as a job; the file lands encrypted in
  object storage behind a signed link expiring in 24 hours, delivered as a
  notification — **never an email attachment**, which is a copy of the employee
  register in a mailbox nobody controls. Every export raises
  `people.export.completed` with actor, field keys, row count and format.
  Financial or special-category exports additionally require a stated reason.
- **Done when** a test proves the link expires, and that an export of a
  financial attribute without a reason is refused.

### Analytics

### [x] PEO-044 — Snapshots

- **Spec** PRD §16.4
- **Files** `migrations/<ts>_people_snapshot.sql`,
  `services/people/src/application/analytics/snapshot.ts`
- **Depends on** PEO-019
- **Approach** `people.headcount_snapshot` holds aggregate dimensions per
  tenant per day: counts by department, location, status, employment type,
  tenure band and completeness. A daily job writes it. **No chart query touches
  the person table directly.**
- **Done when** a chart query over 50,000 seeded people returns in under
  400 ms.

### [x] PEO-045 — Analytics queries

- **Spec** PRD §16.1, §16.2
- **Files** `services/people/src/application/analytics/`
- **Depends on** PEO-044, PEO-017
- **Approach** Headcount trend, movement waterfall, composition, attrition,
  tenure, span of control, completeness, onboarding funnel, expiries, joiner
  heatmap. A chart is a **read** — field-level authorization applies. The
  cohort minimum is enforced **in the query**, not in the chart component, so
  it holds in the tooltip and the export too. Arbitrary `asOf` outside the
  snapshot grid falls back to history and is marked slow.
- **Done when** a test proves a diversity breakdown of 9 people returns
  "insufficient data" through the query layer, the tooltip payload and the
  export alike.

### UI

### [x] PEO-046 — The People remote

- **Spec** `docs/build-plan.md`, step 3
- **Files** `apps/web/people/`
- **Depends on** nothing in this list
- **Approach** Module Federation remote exporting components, fetching nothing,
  holding no session. Add its routes to the runtime route manifest.
- **Done when** the remote can be rebuilt and redeployed alone and the change
  is visible without rebuilding the shell. **Do not skip this check** — if it
  fails, the federation is decoration.

### [x] PEO-047 — Field registry screens

- **Spec** PRD §9.1, §9.2 · design screens 2 and 3
- **Files** `apps/web/people/src/settings/`
- **Depends on** PEO-046, PEO-030
- **Approach** `ListDetail` for the two rails, `SortableList` for reordering
  both, `Sheet` for the four-step field editor. Classification is the **last**
  step — by then the admin has described the field well enough for the
  suggestion to be good. Special-category always needs an explicit tick.
- **Done when** reordering works by keyboard, `pnpm test:stories` is green, and
  no hand-rolled control appears in the diff.

### [x] PEO-048 — Publish and impact

- **Spec** PRD §9.3 · design screen 4
- **Files** `apps/web/people/src/settings/publish.tsx`
- **Depends on** PEO-047, PEO-024
- **Approach** Diff plus the impact numbers as `Stat`, and a `requiredFrom`
  picker. The `+ ~ −` markers carry meaning — added, tightened, archived — and
  colour alone never distinguishes them.
- **Done when** the previewed count matches what the recompute produces.

### [x] PEO-049 — Setup wizard

- **Spec** PRD §8.2 · design screen 1
- **Files** `apps/web/people/src/setup/`
- **Depends on** PEO-047
- **Approach** `Stepper`. Confirm the legal entity, accept or adjust the
  country pack, publish version 1, then the administrator's own profile — which
  is the first record evaluated against it, and the cheapest possible usability
  test.
- **Done when** a fresh tenant reaches a published version 1 and a complete
  first profile without touching an API by hand.
- *Landed in PEO-098.* `apps/web/acceptance/people.acceptance.test.ts` runs
  the wizard in the shell at 390×844, with the keyboard raised for each
  section. It publishes version 1 (the core fields plus the Spanish pack),
  saves the names, and abandons before identification, which leaves a partial
  record: names in, no NIF. It then comes back, finishes, and lands on
  `/people/me`. The confirmed legal entity is stored in PEO-099's
  `people.legal_entity`: the first one in that country is renamed, and a
  different country creates a new one.

### [x] PEO-050 — Onboarding

- **Spec** PRD §8.3 · design screen 5
- **Files** `apps/web/people/src/onboarding/`
- **Depends on** PEO-046, PEO-030
- **Approach** Sectioned and resumable — each section saves independently and
  emits its own `profile_updated`. Each section states who will see the
  answers. `PhoneField` and the typed fields do the phone-keyboard work.
- **Done when** an acceptance test completes it end to end at 390×844 with a
  software keyboard raised, and abandoning mid-way leaves a partial record.

### [x] PEO-051 — Profile screens

- **Spec** PRD §6.6 · design screen 6
- **Files** `apps/web/people/src/profile/`
- **Depends on** PEO-050
- **Approach** One screen, rendered from the published version, differing only
  by the authorization decision. A field the viewer cannot read is **absent** —
  no padlock, no greyed row, no empty section.
- **Done when** a test renders the same person as HR and as a manager and
  asserts the manager's DOM contains none of the withheld labels.

### [x] PEO-052 — Directory

- **Spec** PRD §13.1 · design screen 7
- **Files** `apps/web/people/src/directory/`
- **Depends on** PEO-051
- **Approach** `DataTable` over `VirtualList`. Columns generated from the
  published schema. Completeness is a count badge, not a percentage —
  "2 missing" is actionable and "94%" is not.
- **Done when** filtering on a tenant-defined indexed attribute over 50,000
  rows meets the 300 ms budget.

### [x] PEO-053 — Completeness grid

- **Spec** PRD §8.4 · design screen 8
- **Files** `apps/web/people/src/completeness/`
- **Depends on** PEO-052, PEO-026
- **Approach** One grid over exactly the missing cells. An editable cell is a
  real `Select` inside `DataTable`, not a div that becomes an input. Keyboard
  order runs **down the column** — the work is filling one field 27 times, not
  27 fields once.
- **Done when** tabbing moves down the column and a bulk save emits one event
  per person.

### [x] PEO-054 — Integrations settings

- **Spec** PRD §13.3 · design screen 9
- **Files** `apps/web/people/src/settings/integrations/`
- **Depends on** PEO-032
- **Approach** Per-endpoint event subscription and field allowlist as
  `TagsInput` backed by the published schema, so it cannot name a field that
  does not exist or one the policy forbids. `CopyField` for a signing secret —
  shown once, never retrievable, the shape the back-office already uses for an
  enrolment link.
- **Done when** a special-category attribute cannot be added to any allowlist
  through the UI or the API.

### [x] PEO-055 — Import screens

- **Spec** PRD §14 · design screen 10
- **Files** `apps/web/people/src/import/`
- **Depends on** PEO-041
- **Approach** `Dropzone`, mapping table with confidence shown, then the dry
  run with its five counts and the incomplete warning. Blocked rows list the
  offending cell and download as CSV.
- **Done when** an admin can take a broken file, fix the blocked rows from the
  downloaded CSV, and import them without re-mapping.
- *Landed in PEO-098.* The acceptance test uploads four rows, two of them
  broken (an empty work email, `31/02/2025`). It downloads the blocked-rows
  CSV at the dry run and imports the two good rows. It then fixes the two
  cells in the downloaded file and uploads it, and every column maps itself.
  The two fixed rows import.

### [x] PEO-056 — Export builder

- **Spec** PRD §15.1 · design screen 11
- **Files** `apps/web/people/src/export/`
- **Depends on** PEO-043
- **Approach** Who, which fields, as of when, what format. The field picker
  offers only what the requester can read — there is no "export everything"
  path, because an export button that forgot the permission model is the most
  common way one is defeated.
- **Done when** a manager's builder cannot select a field their profile view
  withholds.

### [x] PEO-057 — Analytics screens

- **Spec** PRD §16 · design screen 12
- **Files** `apps/web/people/src/analytics/`
- **Depends on** PEO-045, PEO-001
- **Approach** Stat tiles with `Sparkline`, the movement `WaterfallChart`,
  completeness as `HorizontalBarChart`, expiries as `TimelineChart`, the
  onboarding `FunnelChart`. Every chart ships its `ChartDataTable`.
- **Done when** axe passes on every chart story and each chart's numbers are
  reachable as a table.

### [x] PEO-058 — The mobile pass

- **Spec** PRD §17 · design screen 13
- **Files** across `apps/web/people/`
- **Depends on** PEO-057
- **Approach** `useBreakpoint` turns `DataTable` into `ListDetail`; dialogs
  become `Sheet` from the bottom; primary actions stick above the safe-area
  inset; reorder gains explicit move up/down beside the drag; charts get fewer
  ticks and a scroll container. Nothing sniffs a user agent.
- **Done when** every story renders at a phone viewport with axe green, and tap
  targets are **asserted** against the 44px floor rather than eyeballed.

### [x] PEO-059 — Country packs

- **Spec** PRD §6.3, §8.2
- **Files** `services/people/src/country-packs/`
- **Depends on** PEO-024
- **Approach** Spain, the UK, Germany, India and the US — matching the
  countries `packages/contracts/src/address.ts` already has rules for. A pack
  is registry data with `origin: 'country_pack'`, not a migration. Each needs a
  review by somebody who knows that country's employment paperwork.
- **Done when** applying a pack to a fresh tenant produces a publishable
  version 1, and the NIF, National Insurance and PAN validators each have
  tests.

### [ ] PEO-060 — Standalone and CI

- **Spec** PRD §19, `CLAUDE.md`
- **Files** `services/people/src/standalone/`, `.github/workflows/ci.yml`
- **Depends on** everything above
- **Approach** `just standalone people` boots the module with no siblings and
  runs the acceptance suite — registry, person, required validation, events to
  an in-memory outbox, REST answering. Add People to the standalone matrix.
- **Done when** it is green in CI, and green again with `TYPESAFE_API_KEY`
  unset.

---

## Phase 2

Ordered, but none of it blocks Phase 1 shipping.

- [ ] **PEO-061** PDF employee record — per person, section headings matching
      the UI, **"Not provided"** rather than a blank, withheld-field count in
      the footer. *(PRD §15.5)*
- [ ] **PEO-062** PDF roster — landscape, repeating headers, filter printed in
      the header so a printout is self-describing. *(PRD §15.5)*
- [ ] **PEO-063** Document import — a zip or folder matched to people by a
      filename pattern the admin confirms. An unmatched file goes to a review
      list, **never onto the nearest-looking person**. *(PRD §14.1)*
- [ ] **PEO-064** Effective-dated history UI — "what did this look like in
      March", per attribute. *(PRD §8.5)*
- [ ] **PEO-065** The full predicate editor for conditional requiredness.
      *(PRD §6.5)*
- [ ] **PEO-066** Custom visibility rules beyond the presets. *(PRD §6.6)*
- [ ] **PEO-067** The remaining charts — attrition, tenure, span of control,
      joiner heatmap, composition stacked. *(PRD §16.2)*
- [ ] **PEO-068** Saved segments shared across directory, export and analytics.
      *(PRD §16.3)*
- [ ] **PEO-069** Scheduled reports through `platform/messaging` — the email
      carries a link, not the data. *(PRD §16.3)*
- [ ] **PEO-070** Aggregate reporting for voluntary self-ID, cohort minimum
      enforced in the query. Its design follows PEO-083: served from the
      monthly publication, rounded to 5, never from the live snapshot.
      *(PRD §6.7, §16.1)*
- [ ] **PEO-071** Bulk edit beyond the completeness grid. *(PRD §8.4)*

## Phase 3

- [ ] **PEO-072** SCIM 2.0 `/Users` and `/Groups` with an extension for
      tenant-defined attributes; Okta and Entra verified first. *(PRD §13.5)*
- [ ] **PEO-073** Mirror mode — `sourceOfRecord: external`, per-attribute
      ownership, every other writer refused with the owning system named.
      *(PRD §13.6)*
- [ ] **PEO-074** Duplicate detection and merge. A merge is **always** a human
      decision, and it is additive — both histories survive, the absorbed
      record becomes a tombstone pointing at the survivor. *(PRD §12.4)*
- [ ] **PEO-075** Automated anonymisation on retention expiry. *(PRD §8.1)*
- [ ] **PEO-076** `document_ref` wired to the Documents module. *(PRD §6.4)*
- [ ] **PEO-077** Approval workflows on sensitive changes, via Temporal.
- [ ] **PEO-078** Pay distribution and compa-ratio charts, behind the finance
      relation. *(PRD §16.2)*

---

## Found while building Phase 1

Gaps the Phase 1 lanes surfaced. Each is outside the ticket that found it, so
it is written down here rather than left in a PR description.

- [x] **PEO-079** `drizzlePeopleFacts().forImpact` exposes custom attributes
      only, so a required **core** field such as `hire_date` counts as missing
      for everybody. The publish-impact preview (PEO-024) and the analytics
      missing-field counts (PEO-045) both overstate. Found in PEO-045.
- [x] **PEO-080** Background work has no list of tenants to run for. RLS
      correctly stops `svc_people` enumerating them, so the snapshot job
      (PEO-044), the policy registry's boot load (PEO-034) and the reminder
      sweep (PEO-026) are built but nothing calls them. Needs a tenant source
      and the wiring in `main.ts`. *Landed as `people.tenant`, filled by the
      consumer; the sweep is scheduled only once PEO-084 supplies a mailer.*
- [x] **PEO-081** Identity has no endpoint listing a tenant's accounts.
      Reconciliation (PEO-028) is written against an assumed
      `GET /api/internal/tenants/<id>/accounts` returning
      `{ accounts, nextCursor }`; identity must serve that shape or the
      caller changes. *(PRD §8.2)*
- [x] **PEO-082** Unique claims hold `normalised_value` in plaintext, so an
      encrypted attribute cannot be unique without its plaintext sitting next
      to the ciphertext. Store a keyed hash instead; until then no national
      identifier in a country pack is marked unique. Found in PEO-059.
      *Landed as `value_hash`, HMAC-SHA-256 under a per-tenant key derived
      from the secrets' master key, for every attribute; rotation and the
      backfill are one hourly job. The packs' identifiers are unique per
      tenant. Dropping `normalised_value` is the contract step, once no claim
      has a null `key_id` (see 20260924150000).*
- [x] **PEO-083** Differencing across snapshots. Reading the latest snapshot
      on two days can reveal who changed in between, which is the attack the
      cohort minimum exists to stop for special-category breakdowns. Needs
      noise or a coarser publishing cadence; a product decision first.
      Found in PEO-045. *(PRD §16.1)* *Decided as a monthly publication,
      republished only after N changes, rounded to 5; landed as
      `people.published_breakdown`.*
- [x] **PEO-084** Reminder delivery. The sweep and its one-per-week cap exist
      (PEO-026) but `platform/messaging` has no reminder endpoint and nothing
      schedules a sweep. The PRD's day 1 / 3 / 7 cadence collapses to weekly
      under the cap; confirm that is intended. *(PRD §8.4)* — Confirmed: day 1,
      then weekly. Messaging serves `POST /api/internal/messaging/notice`;
      People's mailer is configured by `MESSAGING_URL` and
      `MESSAGING_PEOPLE_TOKEN`, and the hourly sweep runs only when it is. The
      email names the company and links to its own origin (`TENANT_APP_BASE`,
      from PEO-099's slug and name); a tenant without both waits.
- [x] **PEO-085** Retention does not fully erase. `anonymise` clears current
      plain values only: encrypted values stay because `svc_people` has no
      DELETE on `people.person_secret`, and history keeps every past value
      because `person_attribute_history` is append-only by trigger. Needs a
      migration (DELETE grant, nullable `redacted_at` / `redaction_reason`, the
      trigger widened to allow exactly one redaction shape) and `anonymise`
      then erasing all three places. **Do not schedule retention before this
      lands.** Found in PEO-037. *(PRD §8.1, §12)*
- [x] **PEO-086** Wire governance at runtime. The policy registry, the AI
      gateway's deny list and the refresh on `people.schema.published` are
      exported but nothing calls them. Needs the Kafka consumer PEO-027 added
      and the tenant source in PEO-080. Found in PEO-034.
- [x] **PEO-087** Log redaction matches tenant fields four levels deep, and the
      AI gateway checks structured `context` only, not free text in the
      instruction. Decide whether either needs to go further. Found in PEO-034
      and PEO-035.
- [x] **PEO-088** An audited way to read a secret for export. Encrypted fields
      are always masked in an export, but §15.2 lets finance see the full value
      with a stated reason. Found in PEO-042. *(PRD §15.2)* *Replaced, by
      product decision, with an approval: finance asks with a reason, HR
      decides within seven days, an approval issues one single-use 24-hour
      download, every step an event. A Temporal workflow per request; the
      approval rules live in `domain/approval/` for PEO-077 to reuse.*
- [x] **PEO-089** A real object-storage adapter behind `ObjectStore`, and a
      queue to hand exports over 2,000 rows to. Today the port has one
      in-memory implementation and nothing decides when to queue. Found in
      PEO-043. *(PRD §15.1)* *Landed as an S3 adapter (SSE under the
      service's own AES-GCM), BullMQ on Valkey keyed by export id, the
      `people.export` ledger, an hourly bounded sweep, and `POST
      /v1/exports` / `GET /v1/exports/{id}`. The export-ready email waits on
      platform/messaging, as PEO-084's reminders do.*
- [ ] **PEO-090** Import gaps: repeating-attribute sheets in an XLSX are not
      imported, a row matching an existing person does not change their
      `hire_date`, the import checksum is not on `people.import.started`, and a
      re-upload cannot re-serve the blocked-row report because it is not
      stored. Found in PEO-038 to PEO-041. *(PRD §14)*
- [x] **PEO-091** Export gaps: the Missing information sheet reflects today's
      completeness even for an `asOf` export, and grey not-applicable cells are
      not rendered. Found in PEO-042. *(PRD §15.4)* *Status, employment type,
      work model, legal entity and whether a secret exists are still read as
      of today; none has a dated read yet.*
- [x] **PEO-092** Authorization and transport setup. OpenFGA has no client
      yet, so relations come from `people.person` and roles; the Cosmo Router
      must be configured to forward the principal header with the internal
      token. Found in PEO-025 and PEO-030. *Landed as People's own OpenFGA
      store and model (`infrastructure/openfga.ts`; PRD §6.6 "As built"),
      tuples synced from the row on each of People's person events, the first
      person in a tenant granted `people_admin` and `hr`, and
      `drizzleRelations` kept for `OPENFGA_URL` unset — which is what
      `just standalone people` runs. `manager_changed` and `org_changed` are
      now raised. The router verifies the JWT and sets the principal and the
      internal token (`apps/gateway/config.yaml`, PRD §13.1); its config did
      not boot on the current router and is fixed. Proven by
      `openfga.integration.test.ts` (chain transitivity, a manager change
      revoking the old chain through the outbox, HR scoped to its tenant) and
      `router.integration.test.ts` (the shipped config in the real router in
      front of the real subgraph). Still open: a role-management transport
      for any grant after the first, and per-tenant entitlements, which
      nothing in the platform stores.*
- [x] **PEO-093** Webhooks: a disabled endpoint only logs a warning instead of
      telling the tenant (needs an event, a contract and a manifest change),
      and a pending retry waits after a restart for that tenant's next
      transaction. Found in PEO-032. *(PRD §13.3)* — `people.webhook.endpoint_disabled`,
      an alert email to the endpoint's `alert_email` (migration
      20260924120100), a boot-and-every-minute poller, and a lease claim per
      delivery.
- [x] **PEO-094** The People remote: no server-side rendering, and the
      remote's host needs `no-cache` and CORS for `remoteEntry.js` and
      `routes.json`. Found in PEO-046.
      *Settled in PEO-047:* the CSS. The remote compiles its own utilities
      (`apps/web/people/src/styles.css`, against `@reach/ui/theme.css`, no
      preflight and no tokens) and `bundleAllCSS` loads them with the expose;
      the shell no longer scans `apps/web/people`, so a class missing from the
      remote's build fails in development too. Proven against an unchanged
      production shell build: a remote-only class was styled, a rebuild of
      the remote alone restyled it, and the same build without the remote's
      stylesheet left it unstyled. The sidebar item is enabled.
      *Still open:* SSR (the screen is client-only behind a spinner; the shell
      is Next, not Modern.js) and the hosting headers.
      *Landed:* the SSR and the hosting headers.
      - **Server rendering by the remote's own server build.** Module
        Federation does not support the App Router on the server.
        `vite.ssr.config.ts` builds `ssr/people.cjs`, whose only imports are
        React, JSX and Reach. The page fetches it per request and
        `remote-screen.tsx` evaluates it against the shell's copies of those
        three. The screen streams in the response, and hydration holds it
        until federation has loaded the browser build.
      - **The hosting headers** are in `apps/web/people/vercel.json`:
        `no-cache` on `remoteEntry.js`, `routes.json` and the server build,
        `immutable` on the hashed chunks, and CORS echoed for tenant origins.
      - **Proven** by the acceptance test: with the remote's JavaScript
        blocked, the profile is still on the page. With it, the same page
        hydrates without a mismatch and saves.
      - **The trade.** The remote's host now runs code on the shell's
        server. `PEOPLE_REMOTE_SSR=off` turns server rendering off.
        *Closed by PEO-115:* a signed build, rendered in a process that holds
        nothing.
      - **Not verified.** The CORS capture group in `vercel.json` has not
        been checked on a real deployment, because nothing was deployed.
- [x] **PEO-098** The shell hands People screens their data. The screens from
      PEO-047 on are presentational: each takes a `Loadable` and async
      callbacks as props, and `routes.json` lists none of them yet because the
      shell has nothing to pass. Needs the router forwarding a principal
      (PEO-092), a query per route that the shell runs and passes down, the
      callbacks as server actions, and transports for what only the
      application layer has today — draft edits, reorder, publish preview and
      publish, the setup pack, import, export, analytics and webhook endpoint
      management. Found in PEO-047. *Landed as:*
      - `/v1/views/*` view models, plus REST for the draft, publishing, setup,
        import and webhook endpoints (PRD §13.2), all under
        `application/screens/*`;
      - the shell fetching each route's data on the server as the signed-in
        person (`lib/people.ts`, directly and not through the router, because
        nothing mints a token yet);
      - server actions for every callback;
      - every screen in `routes.json`.

      Field-level absence is proven in the HTML the shell sends. *Not done:*
      - Idempotency keys on the new writes, and OpenAPI entries for them.
      - A finance full-values screen (PEO-088 has transports, no screen).
      - A webhook delivery log (replay is a transport only).
      - The expiry timeline and the onboarding funnel in analytics.
      - Screens for legal entities, locations and settings. #100 has REST for
        them and no screen exists. The wizard's legal entity step is wired.
- [x] **PEO-095** Hiring raises nothing to identity. `Person.shareIdentityFacts`
      exists and the name paths call it, but no hire path does, so a new
      person's start date never reaches identity. The import commit (PEO-041)
      hires through `Person.hire`; it and any later hire path must call
      `shareIdentityFacts` and raise `people.person.hired`. Found in PEO-029.
- [x] **PEO-096** Correcting `last_working_day` writes into `custom` while
      every reader uses the typed column, the same bug PEO-029 fixed for
      `hire_date`. A hire-date correction also does not re-evaluate status.
      Found in PEO-029. *(PRD §8.5)*
- [x] **PEO-097** Name drift at enrolment. Identity writes the name typed at
      enrolment onto the account even after People has set one, and People
      only fills its own name when empty, so the two can differ until People's
      next name change. Decide which wins. Found in PEO-029. *(PRD §5)* —
      People's wins once it has written the account (`people_facts_at` set);
      the typed name is still published on `profile_captured`.
- [x] **PEO-100** Corrections that contradict the state. An active person whose
      start date is corrected into the future stays active, and a person on
      notice whose last working day is corrected into the past has nothing
      asking HR to end the employment. *Decided: the first returns to
      `pre_hire`; the second stays on notice and HR's grid gets a
      `confirm_termination` row.* Found in PEO-096. *(PRD §8.1, §8.5)*
- [x] **PEO-099** Whose day it is. Every "today" in People — required-from,
      the reminder window, retention due dates, the daily snapshot, the
      monthly self-ID publication — ran on UTC or on whatever zone a request
      carried. Decided (option D): a time zone per legal entity and per
      location, owned by People (`people.legal_entity`, `people.location`,
      effective-dated `people.location_zone`), a tenant default and the cohort
      minimum in `people.tenant_settings` (never lowerable, by trigger too).
      A person's day is their location's, else their entity's, else their own,
      else the tenant's; aggregates are counted per legal entity on its own
      day and summed. One resolver (`Calendars`), one conversion
      (`localDate`); the company wizard carries the first zone and country to
      People on `identity.tenant.provisioned`, with the slug and name that
      `identity.tenant.amended` keeps current. *(PRD §6.8, §8.4, §8.5, §9.4,
      §10.2a, §11, §12, §16)*
- [x] **PEO-101** Employee numbering per legal entity (§7): format, prefix,
      sequence start. Found in PEO-099, which added the legal entity it hangs
      off. *(PRD §7, §9.4, Appendix A)* *Landed as `people.employee_numbering`
      (20260924200000), set by `people_admin` over `PUT
      /v1/legal-entities/{id}/numbering`; a hire takes the next number under
      the entity's row lock, gap-free; a typed or imported number is held to
      the format, claimed tenant-wide and moves the sequence past it.*
      off. *(PRD §7, §9.4, Appendix A)*
- [x] **PEO-102** Completeness was recomputed only on a publish, so the stored
      state, the gap rows and the reminder went stale on every write. Each
      write now re-judges its one person in its transaction, through the
      publish recompute's own reader and `settle`, raising
      `profile_incomplete`/`profile_completed` only on a real transition; the
      reader counts a sealed value as present. *(PRD §8.4)*
- [x] **PEO-103** `assessCompleteness` asked a pre-hire for everything, where
      §8.1 asks only for fields collected at signup, enrolment or onboarding.
      Applied in the one function, and the import dry run judges a hired row
      in the state the commit leaves it in. *(PRD §8.1)*
- [x] **PEO-104** Nothing moved a pre-hire to active on their start date. An
      hourly, bounded, idempotent job in the background wiring starts each
      one once the date has begun on their own calendar, with the events a
      start raises and a completeness re-judge. *(PRD §8.1)*
- [x] **PEO-105** `secret-store.rotate` was never called, so no encrypted value
      ever moved off an old master key and step 4 of the rollout could never
      happen. An hourly, bounded, idempotent re-wrap job beside PEO-082's,
      refusing when a secret sits under a key the ring lacks. *(PRD §11.2)*
- [x] **PEO-106** Two concurrent imports claiming the same unique attributes
      in different orders deadlocked (40P01). `commitImportRetrying` retries
      the commit three times with backoff, idempotent by checksum, and refuses
      clearly when it still loses. *(PRD §14.5)*
- [x] **PEO-107** The full-values decision route had no Idempotency-Key, so a
      retried decision got 409 rather than a replay. Now keyed like every
      other People REST write. *(PRD §13.2)*
- [x] **PEO-115** Server rendering without trusting the remote's host.
      PEO-094 evaluated the remote's server build in the shell's own process,
      beside the internal token. *Decided (option A):* integrity and
      isolation. The remote's deploy pipeline signs a manifest of SHA-384
      hashes (`sign-ssr.mjs`); the shell pins the Ed25519 public key
      (`PEOPLE_REMOTE_SSR_PUBLIC_KEY`) and renders only a build that matches,
      so a remote release is still a remote deploy alone. The build renders in
      a child process with an empty environment, the permission model, no
      code generation from strings and a `vm` context holding React, JSX and
      Reach only (`remote-render.ts`, `remote-renderer.ts`); in the browser
      the remote's own root hydrates it. Refused, altered or failing builds
      render in the browser. `PEOPLE_REMOTE_SSR=off` is still the switch.
      *Residual risk* in PRD §13.2: sockets in Node 22, any signed build is
      trusted, the browser build is not covered, and nothing signs a
      production build yet. *(PRD §13.2, §17.3)*
- [x] **PEO-118** People never exited on SIGTERM: `startTelemetry` caught the
      signal to flush spans and nothing else, so the database pool, the Kafka
      consumers and the pollers kept the process alive until it was SIGKILLed,
      mid-request and mid-job. The acceptance harness SIGKILLed it after 3 s
      and said so in a comment. *Landed:* `@kithena/telemetry` owns the stop —
      `onShutdown(name, step)` registers a step, `drain(server)` stops
      accepting and waits for requests in flight; on SIGTERM or SIGINT every
      step runs, spans are flushed within 2 s, and the process exits 0, or 1
      when a step failed or `SHUTDOWN_DEADLINE_MS` (10 s) passed, naming the
      steps still running. People drains HTTP then closes the export queue,
      the Temporal worker, the webhook poller and its pool; its consumers and
      background jobs finish the one in hand and close theirs. Time Off,
      identity (and its consumer) and messaging drain the same way. Proven by
      `shutdown.integration.test.ts`: the real `main.ts` with Postgres and
      Redpanda answers a half-sent request after SIGTERM, refuses a new one,
      exits 0; a request that never finishes exits 1 at the deadline. The
      harness now fails a run whose server outlives SIGTERM by 15 s.
      *(PRD §18)*

## Blocked, and by what

| Ticket | Blocked on | Note |
| --- | --- | --- |
| PEO-027 | PEO-002 | People cannot see a name captured at enrolment until identity publishes it |
| PEO-059 | a human per country | A country in a pack is a claim that its paperwork rules are right, and they are only right where somebody checked |
| PEO-045 | nothing technical | The cohort minimum default of 10 is a product decision; confirm before shipping |
| PEO-037 | legal review | The statutory retention floors (es-labour 48 months, de-labour 72, eu-payroll 120) are placeholders until someone qualified confirms them |
