# People module — build plan

Every ticket needed to ship the People module, in an order that works. Tick
each box as it lands.

**This file, in the repository, is the record of progress.** The published copy
linked below is read-only — a snapshot for reading and sharing, whose
checkboxes go stale the moment the next ticket lands. Change a box here, in
git, and nowhere else.

**Specs**

| What                        | Where                                                                                                                                     |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Requirements                | [`docs/people-prd.md`](./people-prd.md) · [published](https://claude.ai/code/artifact/aec9b244-64f7-4f53-ab16-7ae6e572da6a)               |
| Screens                     | [published design, 13 screens](https://claude.ai/code/artifact/4d719b45-46cb-45da-9a0a-6b845f03332f)                                      |
| This file, to read or share | [read-only copy](https://claude.ai/code/artifact/647ccf50-72b0-43ab-bd0a-7cbdd3ce9fd0) — a snapshot. Its checkboxes do not track progress |
| Repo rules                  | [`CLAUDE.md`](../CLAUDE.md)                                                                                                               |
| Layer boundaries            | [`docs/code-structure.md`](./code-structure.md)                                                                                           |
| Reach usage                 | `.claude/skills/reach-ui/SKILL.md`                                                                                                        |

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

**Phase 1 is complete** (PEO-060): every box down to PEO-060 is ticked, and
`just standalone people` is green in CI both with `TYPESAFE_API_KEY` unset and
with it set, the advisor mocked. What remains open is outside Phase 1:

- **Phase 2 and 3**, PEO-061 to PEO-078, as listed below.
- **Unticked follow-ups** under *Found while building Phase 1*: the router
  deployment mounting `apps/gateway/persisted` at `/persisted`, and a timed
  100 MB import through the production router (PEO-113's follow-up).
- **Things only a person can do**, none of which code can settle:
  - legal sign-off on the statutory retention floors (PEO-037; see *Blocked*);
  - a per-country review of each country pack (PEO-059);
  - the `TENANT_APP_BASE` repository variables per environment, without which
    production sends no notice email by design (`tenant-origin.ts`);
  - a remote deploy workflow for the People remote that holds
    `PEOPLE_REMOTE_SSR_SIGNING_KEY` and signs each release (PEO-115);
  - the router's persisted-operations mount and the timed 100 MB import above;
  - confirming the cohort minimum default of 10 (PEO-045).

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
  evaluates to _not required_ and returns a signal for an operational alert.
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
  duplicate — and separately count how many will import _incomplete_. The three
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
- _Landed in PEO-098._ `apps/web/acceptance/people.acceptance.test.ts` runs
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
- _Landed in PEO-098._ The acceptance test uploads four rows, two of them
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

### [x] PEO-060 — Standalone and CI

- **Spec** PRD §19, `CLAUDE.md`
- **Files** `services/people/src/standalone/`, `.github/workflows/ci.yml`
- **Depends on** everything above
- **Approach** `just standalone people` boots the module with no siblings and
  runs the acceptance suite — registry, person, required validation, events to
  an in-memory outbox, REST answering. Add People to the standalone matrix.
- **Done when** it is green in CI, and green again with `TYPESAFE_API_KEY`
  unset.
- _Landed as `src/standalone/acceptance.standalone.test.ts`: the in-memory
  ports behind the real REST handler and subgraph — the registry, a person
  created, a missing required field reported until filled, a malformed value
  refused with nothing in the outbox, the write read back over REST and
  GraphQL. `fetch` is replaced for the file, so a request to anything but the
  mocked TypeSafe endpoint fails. CI's `standalone` job runs it twice, key
  unset then a dummy key, as steps so the required checks keep their names.
  The web acceptance suite is a CI job too (`web acceptance`, gated by the
  `changes` job), and hermetic: its webhook test posts to the harness's own
  HTTPS receiver on loopback, which People accepts only off production
  (`egressPolicyFrom`, `PEOPLE_WEBHOOKS_ALLOW_LOOPBACK`). The receiver found a
  real fault: a screen's keyed write kicked the delivery pass from inside
  `sharing`, so the pass inherited the request's transaction through
  AsyncLocalStorage, hung once it committed, and held the tenant's `running`
  flag — no webhook went out again until a restart. The kick now waits for the
  outermost unit (`insideSharedUnit`)._

---

## Phase 2

Ordered, but none of it blocks Phase 1 shipping.

- [x] **PEO-061** PDF employee record — per person, section headings matching
      the UI, **"Not provided"** rather than a blank, withheld-field count in
      the footer. _(PRD §15.5)_
      _Landed as `format: 'pdf'` with `recordOf` on the ordinary export
      (`POST /v1/exports`, `requestExport`), so it is the same read, the same
      reason rule, the same signed link and the same `people.export.completed`.
      A **Download PDF** dialog on another person's profile asks the optional
      reason up front. Rendered by `pdfkit` with Noto Sans (vendored in `assets/fonts`, OFL) embedded
      (`application/export/pdf.ts`). Not built: the signature block, which
      waits on a tenant setting that does not exist yet; one's own profile,
      which has no person id in its view (the DSAR pack is the subject's
      path)._
- [x] **PEO-062** PDF roster — landscape, repeating headers, filter printed in
      the header so a printout is self-describing. _(PRD §15.5)_
      _Landed as `format: 'pdf'` in the export builder: A4 landscape, the
      builder's columns, the title, filter and as-of day and the column headers
      redrawn on every page, "Withheld" in a cell the viewer cannot read on
      that person, and the same footer as the record._
- [ ] **PEO-063** Document import — a zip or folder matched to people by a
      filename pattern the admin confirms. An unmatched file goes to a review
      list, **never onto the nearest-looking person**. _(PRD §14.1)_
      **Blocked on a document store.** A `document_ref` value is a reference,
      never bytes (§6.4), and document storage is out of scope for People
      (§19, "Document storage itself"). Nothing durable exists to point at:
      the import upload bucket is deleted on commit and after a day, and is
      not indexed by person — which is the only reason §14.2 allows it to hold
      employee data — and the export store expires in a day too. Keeping
      contracts and ID scans in either would make People the document store,
      with the retention, erasure, scanning and export path the contract
      (`data-type.ts`) says belong to whoever owns documents. No
      `document_ref` write path exists yet either (no profile control; bulk
      edit has none). Unblocked by PEO-076, or by a PRD decision naming the
      object storage §6.4 falls back to and who owns its retention and
      erasure. The upload, zip safety and dry-run shape can then reuse §14.2's
      presigned flow as it stands._
      **Decided 2026-09-26: waits for the Documents module**, to be built
      separately later. No fallback bucket; PEO-063 and PEO-076 land together
      once it exists.
- [x] **PEO-064** Effective-dated history UI — "what did this look like in
      March", per attribute. _(PRD §8.5)_
      _Built as `/people/:id/history` (and `/people/me/history`) over
      `peopleHistory` / `GET /v1/views/history[/{id}]?asOf=`. History is
      judged by today's rules (`readableHistory`): a field the viewer cannot
      read now has no rows, and a field sealed now shows only that it changed
      — on REST's `/history` too. Read-only: a correction is still made
      through `POST /v1/people/{id}/corrections`; offering it from the
      timeline is not built._
- [x] **PEO-065** The full predicate editor for conditional requiredness.
      _(PRD §6.5)_
      _As built: the field editor's second step is Optional / Required for
      everyone / Required when…, the last opening `PredicateEditor`
      (`apps/web/people/src/settings/predicate-editor.tsx`): all-or-any over
      up to ten rows, each a fact with a multi-select of its values, or
      another field set or equal to one of its option keys. Reach's `Select`,
      `Combobox` (multiple) and `Button`; nothing new in the design system.
      The field input carries the predicate as the contract's
      `RequirednessPredicate`, parsed at the REST boundary, so GraphQL, REST
      and the draft refuse the same things. Editing a conditional field used
      to save it as optional; it keeps its predicate now. The evaluator is
      shared with PEO-066 (`evaluatePredicate`).
      Privacy guard: a predicate may not name a special-category field
      (`PREDICATE_DISCLOSES`, on save and at publish; the editor says so
      beside the condition), since "missing" would tell whoever sees the gap
      that the condition held. A published document that still holds one is
      failed closed by `assessCompleteness`: the field is not required of
      anybody and the rule is reported as unevaluable. No country pack or
      seed carries such a predicate._
- [x] **PEO-066** Custom visibility rules beyond the presets. _(PRD §6.6)_
      _As built: `visibilityRules` on the definition — up to five, each
      preset scopes plus the same closed predicate, granting those scopes on
      the records it holds for. Absent when none, so documents published
      before keep their checksum; the draft keeps them in
      `attribute_definition.visibility_rules` (20260926140000, nullable).
      Enforced in `visibleTo`, so every read path decides alike: the relations
      carry the person's facts (`withSubjects` at the wiring, the rows' own
      facts for a page), and a question about everybody — a filter, a search,
      a directory column, an analytics population — has none, so no rule
      holds there. Safety: never for special-category data (contract and
      read side); never on a field a granted scope cannot already read
      outright, or on an archived one (`VISIBILITY_RULE_DISCLOSES`, on save
      and again at publish); the same for a placement fact, judged
      through the field `factsOf` reads it from (`legal_entity_id`,
      `home_address`/`country`, `employment_type`, `work_model`; no such
      field is a refusal too), and `status` only for `hr`, whose alone it is
      (PEO-120); rules never count towards "a required field
      somebody can read". The publish preview names a field whose readers or
      conditions changed (`changed`)._
- [x] **PEO-067** The remaining charts — attrition, tenure, span of control,
      joiner heatmap, composition stacked. _(PRD §16.2)_
      _Built on the Phase 1 queries (`application/analytics/queries.ts`),
      shaped by `application/screens/analytics.ts` and drawn with Reach's
      `TrendChart`, `StackedBarChart`, `BarChart` and `HeatmapChart`, each with
      its numbers one tap away. Every one reads the snapshot and is a manager's
      chain for a manager; composition is department by employment type, and
      a chart over a field the viewer cannot read is absent._
- [x] **PEO-068** Saved segments shared across directory, export and analytics.
      _(PRD §16.3)_
      _Landed as `people.segment`: a name, the directory's `key → value`
      filter, an owner and `shared`. Never a list of people: whoever uses one
      is authorized as for a typed filter, as themselves and when they use it,
      so a segment HR shared over an HR-only field shows a manager nobody and
      is not offered to them. `?segment=` on the directory and analytics,
      `segmentId` on an export, and each usable segment is an audience in the
      export builder. Analytics can use only keys the snapshot holds as
      dimensions (`org_unit`, `work_location`, `status`, `employment_type`);
      a segment over another key is offered in the directory and export only.
      Deleting is REST and GraphQL only; the screens have no delete yet._
- [x] **PEO-069** Scheduled reports through `platform/messaging` — the email
      carries a link, not the data. _(PRD §16.3)_
      _Landed as migration 20260926170000 (`people.report_schedule`,
      `people.report_run`; widens `messaging.delivery`'s kinds). HR and
      `people_admin` schedule an XLSX/PDF export or the analytics summary over
      a segment or a filter, daily/weekly/monthly on a legal entity's clock,
      to 1–25 accounts. Each run is built **as each recipient** at send time
      through the export path — nobody receives a report built as the owner.
      The email (`scheduled_report` notice) links to the tenant app:
      `/people/export?export=<id>` (the recipient's own, signed there for 24
      hours) or `/people/analytics`. Runs are idempotent per (schedule,
      period) and **catch up on wake**: the sweep runs on boot and hourly in
      the People process, sends only the latest missed period, and counts
      the ones it covers. Managed at `/people/reports` (list with status and
      last run, create and edit, pause/resume, delete behind a confirmation,
      `/people/reports/{id}` for the run history), over REST
      (`/v1/report-schedules`, `PUT` to edit) and GraphQL
      (`peopleReportSchedules`, `peopleReportRuns`, five mutations). Saving a
      new schedule, or a change to its recipients or audience, first asks the
      user to confirm that each recipient gets only what they may see, so
      recipients may receive different people and columns; the recipients
      field says the same in its description and a tooltip. The export page
      shows a report's download when its email is opened._
- [x] **PEO-070** Aggregate reporting for voluntary self-ID, cohort minimum
      enforced in the query. Its design follows PEO-083: served from the
      monthly publication, rounded to 5, never from the live snapshot.
      _(PRD §6.7, §16.1)_
      _The analytics screen serves every self-ID question to HR from
      `selfIdBreakdown`, with the tenant's `cohort_minimum` (default 10, the
      default still to be confirmed — see PEO-045 under *Blocked*); a withheld
      question carries no number at all, only the minimum. Never a manager's,
      never under a segment._
- [x] **PEO-071** Bulk edit beyond the completeness grid. _(PRD §8.4)_
      _As built: `application/screens/bulk-edit.ts` — HR only, at most
      `BULK_PAGE` (50) people a request, the same values from one
      `effectiveFrom`. Each person is one `PersonAccess.update` in its own
      savepoint, so nothing the single path enforces is skipped and a refusal
      rolls back that person alone; a value already standing as of the date
      is skipped. The preview is the same writes in one transaction thrown
      away, so it answers as the commit will, in-batch uniqueness clashes
      included. REST `/v1/views/bulk-edit[/preview]` (the commit keyed),
      GraphQL `peopleBulkEdit`, `peopleBulkEditPreview`, `bulkEditPeople`.
      The directory's rows are selectable for HR ("Edit together"); the
      `BulkEdit` screen at `/people/bulk-edit` previews and applies a page at
      a time. No migration. Not yet: selecting across directory pages or
      "everyone matching this filter", and choosing people from the phone
      layout's cards; a person field's before/after shows the id, not the
      name._

## Phase 3

- [x] **PEO-072** SCIM 2.0 `/Users` and `/Groups` with an extension for
      tenant-defined attributes; Okta and Entra verified first. _(PRD §13.5)_
      _Landed at `/scim/v2` on People's port, authenticated per connection
      by a hashed, rotatable, revocable bearer token, every change audited as
      `people.scim.connection_changed` (20260926160000). Writes go through
      `PersonAccess` as an integration, effective now. Built to Okta's and
      Entra's documented shapes and proven by `scim.integration.test.ts`;
      not yet tried against a live tenant of either. `active: false` and
      DELETE end nothing; groups carry no authorization. Public routing is
      an operator's checklist in `docs/environments.md`._
- [x] **PEO-073** Mirror mode — `sourceOfRecord: external`, per-attribute
      ownership, every other writer refused with the owning system named.
      _(PRD §13.6)_ _Landed: the approved mapping is the declaration, one
      owner per attribute by constraint, enforced in `canWrite` on the
      records the system provisions, shown read-only as "Kept in Okta"._
- [x] **PEO-074** Duplicate detection and merge. A merge is **always** a human
      decision, and it is additive — both histories survive, the absorbed
      record becomes a tombstone pointing at the survivor. _(PRD §12.4)_
      _Landed as migration 20260926143000 (`person.merged_into`, status
      `merged`, append-only `people.duplicate_decision`). Detection blocks
      on work email, name with `date_of_birth`, and unique claims the
      rotation found held twice; nothing is decrypted, and a signal is
      shown only to a viewer who may read what it is read from. HR only;
      nobody merges their own record. **Only a record never hired is
      absorbed** — the employed one survives, and two employed records are
      refused (see below). A merge releases the tombstone's unique claims,
      moves its account to the survivor, copies the values HR ticked
      through the ordinary write path (never a sealed, lifecycle,
      placement, manager or employee-number key), raises `status_changed`
      (`merged`) and `merged` on the tombstone, `profile_updated` and
      `identity_facts_changed` on the survivor, and records the decision.
      `GET /v1/duplicates`, `POST /v1/duplicates/dismissals`, `POST
      /v1/people/{id}/merge` (`mergePerson`), `peopleDuplicates`; screen
      `/people/duplicates`. The TypeSafe `Noul` ranking is not wired: code
      ranks by signal strength, and sending names and birth dates to a
      third party is a data decision this ticket did not take._
- [ ] Merging two **employed** records. Refused today
      (`MERGE_ABSORBS_EMPLOYMENT`): two employment periods on one human need
      somebody to decide which start, number and pay line are true, which is
      payroll's call. Found in PEO-074. _(PRD §12.4)_
- [ ] A merge's undo. Nothing is destroyed — the tombstone keeps its
      history, values and prior state, the decision row names what moved —
      but there is no `unmerge` use case; today a wrong merge is corrected
      value by value on the survivor. Found in PEO-074.
- [ ] DSAR and retention follow `merged_into`. A tombstone's history is the
      survivor's human, and neither the DSAR export nor the retention clock
      reads it yet. Found in PEO-074. _(PRD §12)_
- [ ] **PEO-075** Automated anonymisation on retention expiry. **Blocked until
      counsel reviews the floors** (PEO-126): `mayErase` refuses automated
      erasure under an unreviewed floor. _(PRD §8.1, §12)_
- [ ] **PEO-076** `document_ref` wired to the Documents module. _(PRD §6.4)_
- [x] **PEO-077** Approval workflows on sensitive changes, via Temporal.
      _(PRD §8.6)_ _A per-field `requiresApproval`, on by default for
      financial or encrypted data. A sensitive value from any writer is held
      as a pending change, never a current value; HR other than the requester
      and the subject approves within seven days, and the approval applies it
      from its original `effectiveFrom`. Withdrawal, expiry, notices through
      messaging, the approvals inbox, the Sensitive marker in Reach, and HR's
      "apply without approval" on import and bulk edit. SCIM writes are not
      held: the connection is the source of record for what it writes. The
      subject access pack carries a person's held changes, and the secret
      rotation re-wraps sealed pending values._
      _Later (product decision, 2026-09-26): **a requester with no other
      eligible approver approves their own change alone**, once a dialog
      says there is no other HR member who can and that the audit trail
      records it as theirs. Allowed only while no `hr` holder by the role
      rows but the requester may decide — the only one, or one of two
      changing the other's record, since the subject never decides — asked
      at decision time in the decision's transaction, and only with
      `soleApprover` on the request (`decideChange`, `mayApproveAlone`);
      otherwise 403 as before. Recorded as `decided_as = 'sole_hr'` and
      `change_decided.decidedAs` (migration 20260926230000, which widens
      `pending_change_not_self_decided` for exactly this and the review's
      decline). `canSelfApprove` on every pending value; "Approve it myself"
      on the profile's pending note, the setup wizard's section and the
      inbox. A doubted national identifier is reviewed before it is
      approved: see PEO-125._
- [x] **PEO-078** Pay distribution and compa-ratio charts, behind the finance
      relation. _(PRD §16.2)_
      _Landed as migration 20260926190000 with the three decisions §16.2
      records: bands in People (`people.pay_band`, append-only, per grade
      and currency, effective-dated, HR or finance on the Pay bands tab,
      `people.pay_band.set`/`.corrected`); the nightly snapshot decrypting
      `base_salary` in memory and writing only quartiles per group
      (`people.pay_snapshot`, a CHECK at the floor of ten) with an audit
      row per run (`people.pay_snapshot_audit`); finance seeing the 25th,
      median and 75th per grade, tenure band and compa-ratio, one currency
      each, and "insufficient data" with no number below the cohort
      minimum. `decimal.js` added to People for the arithmetic. Reach's
      `RangeChart` gained `spread` for the middle half. `GET`/`POST
      /v1/pay-bands`, `setPayBand`, `peopleOrganisation.payBands`,
      `peopleAnalytics.pay`. Not annualised by pay frequency or scaled by
      FTE; a raise dated ahead on a sealed salary counts from entry._

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
      and the wiring in `main.ts`. _Landed as `people.tenant`, filled by the
      consumer; the sweep is scheduled only once PEO-084 supplies a mailer._
- [x] **PEO-081** Identity has no endpoint listing a tenant's accounts.
      Reconciliation (PEO-028) is written against an assumed
      `GET /api/internal/tenants/<id>/accounts` returning
      `{ accounts, nextCursor }`; identity must serve that shape or the
      caller changes. _(PRD §8.2)_
- [x] **PEO-082** Unique claims hold `normalised_value` in plaintext, so an
      encrypted attribute cannot be unique without its plaintext sitting next
      to the ciphertext. Store a keyed hash instead; until then no national
      identifier in a country pack is marked unique. Found in PEO-059.
      _Landed as `value_hash`, HMAC-SHA-256 under a per-tenant key derived
      from the secrets' master key, for every attribute; rotation and the
      backfill are one hourly job. The packs' identifiers are unique per
      tenant. Dropping `normalised_value` is the contract step, once no claim
      has a null `key_id` (see 20260924150000)._
- [x] **PEO-083** Differencing across snapshots. Reading the latest snapshot
      on two days can reveal who changed in between, which is the attack the
      cohort minimum exists to stop for special-category breakdowns. Needs
      noise or a coarser publishing cadence; a product decision first.
      Found in PEO-045. _(PRD §16.1)_ _Decided as a monthly publication,
      republished only after N changes, rounded to 5; landed as
      `people.published_breakdown`._
- [x] **PEO-084** Reminder delivery. The sweep and its one-per-week cap exist
      (PEO-026) but `platform/messaging` has no reminder endpoint and nothing
      schedules a sweep. The PRD's day 1 / 3 / 7 cadence collapses to weekly
      under the cap; confirm that is intended. _(PRD §8.4)_ — Confirmed: day 1,
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
      lands.** Found in PEO-037. _(PRD §8.1, §12)_
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
      with a stated reason. Found in PEO-042. _(PRD §15.2)_ _Replaced, by
      product decision, with an approval: finance asks with a reason, HR
      decides within seven days, an approval issues one single-use 24-hour
      download, every step an event. A Temporal workflow per request; the
      approval rules live in `domain/approval/` for PEO-077 to reuse._
- [x] **PEO-089** A real object-storage adapter behind `ObjectStore`, and a
      queue to hand exports over 2,000 rows to. Today the port has one
      in-memory implementation and nothing decides when to queue. Found in
      PEO-043. _(PRD §15.1)_ _Landed as an S3 adapter (SSE under the
      service's own AES-GCM), BullMQ on Valkey keyed by export id, the
      `people.export` ledger, an hourly bounded sweep, and `POST
    /v1/exports` / `GET /v1/exports/{id}`. The export-ready email waits on
      platform/messaging, as PEO-084's reminders do._
- [x] **PEO-090** Import gaps: repeating-attribute sheets in an XLSX are not
      imported, a row matching an existing person does not change their
      `hire_date`, the import checksum is not on `people.import.started`, and a
      re-upload cannot re-serve the blocked-row report because it is not
      stored. Found in PEO-038 to PEO-041. _(PRD §14)_ — A repeating sheet is
      recognised by the key row the export now writes on it and is the whole
      list for each person it mentions (§14.5); a bad item is named by
      sheet, row and cell and holds back only that list. An existing
      person's new hire date is a correction through `PersonAccess.correct`,
      blocked where the tenant publishes no `hire_date`. `checksum` is on
      `people.import.started`. The report is stored sealed in the export's
      object store, keyed by checksum, for 7 days (the export sweep deletes
      it then), and deleted early when anybody it contains is anonymised:
      `people.import_report` (migration 20260924250000) keeps the ids it
      contains. A re-upload answers `ALREADY_IMPORTED` with a signed link
      while it is kept, and says it has expired after. Proven by the round
      trip in `export.test.ts`; erasure by `anonymise.integration.test.ts`.
      A DSAR erasure path does not exist yet; it calls
      `forgetImportReports` when it does.
- [x] **PEO-091** Export gaps: the Missing information sheet reflects today's
      completeness even for an `asOf` export, and grey not-applicable cells are
      not rendered. Found in PEO-042. _(PRD §15.4)_ _Status, employment type,
      work model, legal entity and whether a secret exists are still read as
      of today; none has a dated read yet._
- [x] **PEO-092** Authorization and transport setup. OpenFGA has no client
      yet, so relations come from `people.person` and roles; the Cosmo Router
      must be configured to forward the principal header with the internal
      token. Found in PEO-025 and PEO-030. _Landed as People's own OpenFGA
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
      nothing in the platform stores._
- [x] **PEO-093** Webhooks: a disabled endpoint only logs a warning instead of
      telling the tenant (needs an event, a contract and a manifest change),
      and a pending retry waits after a restart for that tenant's next
      transaction. Found in PEO-032. _(PRD §13.3)_ — `people.webhook.endpoint_disabled`,
      an alert email to the endpoint's `alert_email` (migration
      20260924120100), a boot-and-every-minute poller, and a lease claim per
      delivery.
- [x] **PEO-094** The People remote: no server-side rendering, and the
      remote's host needs `no-cache` and CORS for `remoteEntry.js` and
      `routes.json`. Found in PEO-046.
      _Settled in PEO-047:_ the CSS. The remote compiles its own utilities
      (`apps/web/people/src/styles.css`, against `@reach/ui/theme.css`, no
      preflight and no tokens) and `bundleAllCSS` loads them with the expose;
      the shell no longer scans `apps/web/people`, so a class missing from the
      remote's build fails in development too. Proven against an unchanged
      production shell build: a remote-only class was styled, a rebuild of
      the remote alone restyled it, and the same build without the remote's
      stylesheet left it unstyled. The sidebar item is enabled.
      _Still open:_ SSR (the screen is client-only behind a spinner; the shell
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
      management. Found in PEO-047. _Landed as:_ - `/v1/views/*` view models, plus REST for the draft, publishing, setup,
      import and webhook endpoints (PRD §13.2), all under
      `application/screens/*`; - the shell fetching each route's data on the server as the signed-in
      person (`lib/people.ts`, directly and not through the router, because
      nothing mints a token yet); - server actions for every callback; - every screen in `routes.json`.

      Field-level absence is proven in the HTML the shell sends. *Not done:*
          - Idempotency keys on the new writes, and OpenAPI entries for them.
            *Landed in PEO-116.*
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
      Found in PEO-029. _(PRD §8.5)_
- [x] **PEO-097** Name drift at enrolment. Identity writes the name typed at
      enrolment onto the account even after People has set one, and People
      only fills its own name when empty, so the two can differ until People's
      next name change. Decide which wins. Found in PEO-029. _(PRD §5)_ —
      People's wins once it has written the account (`people_facts_at` set);
      the typed name is still published on `profile_captured`.
- [x] **PEO-100** Corrections that contradict the state. An active person whose
      start date is corrected into the future stays active, and a person on
      notice whose last working day is corrected into the past has nothing
      asking HR to end the employment. _Decided: the first returns to
      `pre_hire`; the second stays on notice and HR's grid gets a
      `confirm_termination` row._ Found in PEO-096. _(PRD §8.1, §8.5)_
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
      `identity.tenant.amended` keeps current. _(PRD §6.8, §8.4, §8.5, §9.4,
      §10.2a, §11, §12, §16)_
- [x] **PEO-101** Employee numbering per legal entity (§7): format, prefix,
      sequence start. Found in PEO-099, which added the legal entity it hangs
      off. _(PRD §7, §9.4, Appendix A)_ _Landed as `people.employee_numbering`
      (20260924200000), set by `people_admin` over `PUT
    /v1/legal-entities/{id}/numbering`; a hire takes the next number under
      the entity's row lock, gap-free; a typed or imported number is held to
      the format, claimed tenant-wide and moves the sequence past it.*
- [x] **PEO-102** Completeness was recomputed only on a publish, so the stored
      state, the gap rows and the reminder went stale on every write. Each
      write now re-judges its one person in its transaction, through the
      publish recompute's own reader and `settle`, raising
      `profile_incomplete`/`profile_completed` only on a real transition; the
      reader counts a sealed value as present. _(PRD §8.4)_
- [x] **PEO-103** `assessCompleteness` asked a pre-hire for everything, where
      §8.1 asks only for fields collected at signup, enrolment or onboarding.
      Applied in the one function, and the import dry run judges a hired row
      in the state the commit leaves it in. _(PRD §8.1)_
- [x] **PEO-104** Nothing moved a pre-hire to active on their start date. An
      hourly, bounded, idempotent job in the background wiring starts each
      one once the date has begun on their own calendar, with the events a
      start raises and a completeness re-judge. _(PRD §8.1)_
- [x] **PEO-105** `secret-store.rotate` was never called, so no encrypted value
      ever moved off an old master key and step 4 of the rollout could never
      happen. An hourly, bounded, idempotent re-wrap job beside PEO-082's,
      refusing when a secret sits under a key the ring lacks. _(PRD §11.2)_
- [x] **PEO-106** Two concurrent imports claiming the same unique attributes
      in different orders deadlocked (40P01). `commitImportRetrying` retries
      the commit three times with backoff, idempotent by checksum, and refuses
      clearly when it still loses. _(PRD §14.5)_
- [x] **PEO-107** The full-values decision route had no Idempotency-Key, so a
      retried decision got 409 rather than a replay. Now keyed like every
      other People REST write. *(PRD §13.2)*
- [x] **PEO-108** Lifecycle actions through the application layer and
      transports. The domain could give notice, terminate, start and end
      leave and discard, but `PersonAccess` exposed none of them, so no
      transport could, and PEO-102's re-judge ran only for what it did
      expose. Found in PEO-100 and PEO-102. *(PRD §8.1, §8.5, §10.2, §12,
      §13)* *Landed as five HR-only use cases on the person's own calendar,
      each idempotent on a retry, each raising `status_changed` (termination
      now too, with a typed reason, beside `terminated`) with its dated row
      and a completeness re-judge; a termination waits for the last working
      day except for a pre-hire. `POST /v1/people/{id}/notice`,
      `/termination`, `/leave/start`, `/leave/end`, `/discard` and the
      matching mutations, both parsed by one Zod body each. Also the GraphQL
      `employeeNumbering`/`setEmployeeNumbering` for PEO-101, and REST tests
      for its routes. Not built, and written into §8.1: rehire and
      withdrawing notice.*
- [x] **PEO-109** Access ends with employment. A terminated person could sign
      in for as long as identity had their account, because nothing told
      identity employment had ended. *Decided: at the end of the last working
      day on the person's own calendar, identity suspends the account — no
      sign-in, every session revoked, enrolment links spent, passkeys kept for
      a rehire; suspended, never deleted.* *(PRD §5, §8.1, §10.2, §13)*
      *Landed as `people.person.access_ended`, raised once by the hourly
      lifecycle job for anybody on notice or terminated whose last working
      day has ended — HR's confirmation of the termination is not awaited;
      the `confirm_termination` row stays the paperwork prompt —
      (`access_ended_at`, 20260924220000) or at once
      by HR (`endAccessNow` on termination, `POST
      /v1/people/{id}/access/end`, `endPersonAccess`), and identity's consumer
      suspending with reason `employment_ended`, idempotent and blind to a
      stale event through `people_access_at`, remembering the status it
      suspended from in `access_ended_from` (20260924220100). A tenant
      without People is untouched.*
- [x] **PEO-110** Rehire: a new employment period on the same person record,
      HR only, from `terminated`, refused when not eligible for rehire unless
      HR overrides with a reason. Identity reactivates the suspended account
      at the new start; retention runs from the latest period's end and a
      rehire cancels it. *(PRD §5, §7, §8.1, §8.5, §10.2, §12, §13)*
      *An override raises its own audit event, `people.person.rehire_override`
      (actor, person, period, reason), beside the reason kept on the period.*
      *Landed as `people.employment_period` (20260924220200, backfilled with
      period 1; a hired record with no row reads as period 1), written by the
      repository beside the person row whenever a move changes the current
      period; `Person.rehire` opening period n+1 with `status_changed`
      (reason `rehired`), `hired` and a null `last_working_day` row from the
      start; `people.person.access_restored` when the start comes (with the
      rehire or from the hourly start job), which identity's consumer turns
      into a reinstatement to `access_ended_from`. The employee number is
      kept unless the entity rejoined numbers and its scheme would not write
      it. Retention reads the record locked. `POST
      /v1/people/{id}/rehire`, `GET /v1/people/{id}/employment-periods`,
      `rehirePerson`, `employmentPeriods`.*
- [x] **PEO-111** Withdraw notice: HR returns a person on notice to the
      status they held before it, until their last working day has ended on
      their calendar, superseding the notice's last-working-day row.
      *(PRD §8.1, §8.5, §10.2, §13)* *Landed as `Person.withdrawNotice`
      reading `notice_from` off the current employment period (PEO-110),
      `status_changed` with reason `notice_withdrawn`, a null
      `last_working_day` row superseding the notice's, the period's end and
      notice cleared so no access end is pending, and a completeness
      re-judge. `POST /v1/people/{id}/notice/withdraw` and
      `withdrawNotice`. No migration. Also closes the gap PEO-109 left: a
      notice's last working day corrected forward, after the job ended
      access, to a day not yet ended on the person's calendar raises
      `access_restored` (reason `last_working_day_corrected`) in the
      correction's transaction, and the job ends access again when the new
      day ends; a corrected day already ended keeps it ended.*
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
      *Residual risk* in PRD §13.2: sockets in Node 24, any signed build is
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
- [x] **PEO-117** Directory search covered only the first 200 people: the view
      read one page and searched it in memory. Search, filters and paging now
      run in Postgres through `PersonAccess.list` (and `count` for the
      summary): keyset pages of 50 by `?after=`, a search over the names and
      work email the viewer reads on everybody (refused when there is none,
      as a filter on a key they cannot read on everybody already was, PEO-052),
      `search` on `GET /v1/people` too. 57 ms for a filter page, 101 ms for a
      search page with its count, at 50,000 people. The screen pages with
      "Next page" / "First page"; each page is a URL. *(PRD §13.2, §17.2)*
      *Still open:* the profile's person picker and the completeness grid
      read only the first 200 people through `everybody()`; another lane
      pages them.
- [x] **PEO-116** PEO-098's screen writes took no Idempotency-Key and were
      missing from OpenAPI. The router now refuses any write without a key
      before its handler runs (four compute-only POSTs are `safe`); each
      screen write runs its use case inside the key's transaction (`sharing`,
      savepoints), and a retry is answered from what exists now — no secret,
      no import report. Every write is in `/v1/openapi.json` from its Zod
      body, and `writes.contract.test.ts` fails when a state-changing route
      lacks either. The shell sends a key per action. Found in PEO-098.
      _(PRD §13.2, §17.2)_
- [x] **PEO-112** Roles, properly. The first person in a tenant became
      `people_admin` and `hr`, which is wrong when People is switched on after
      accounts exist, and nothing could grant a role after that. Needs the back
      office naming the first People administrator when it switches People on
      (the only bootstrap), and grant and revoke through People's application
      layer — `people_admin` only, never the last `people_admin`, never
      oneself — written to OpenFGA, idempotent, each an audited event; REST
      with Idempotency-Key, GraphQL, and a settings screen. Found in PEO-092.
      *(PRD §4, §6.6, §7, §8.2, §9.4, §13)*
      *Landed as `people.role_grant` (20260924270200), the ledger OpenFGA's
      tenant tuples are synced from (`OpenFga.syncRoles`, off
      `people.role.granted`/`revoked`, which carry who, whom, the role, `via`
      and the reason); `domain/access/roles.ts` for the rules, asked of the
      rows under a per-tenant advisory lock, and a trigger refusing the last
      `people_admin` on any path. `GET /v1/roles`, `POST /v1/roles/grants`,
      `POST /v1/roles/revocations` with Idempotency-Key, `peopleRoles`,
      `grantRole`, `revokeRole`, OpenAPI from `http/roles.ts`, and the roles
      screen at `/people/settings/roles`. Identity refuses to switch People
      on without naming an account (`identity.tenant.administrator_named`),
      in the company wizard or on the company page, which can also name
      another later. The first-person rule is gone; the migration carries
      over what it granted. A leaver's roles are revoked when their access
      ends, and not restored with it — closed in PEO-113's lane
      (20260924280000).*
- [x] **PEO-113** The shell goes through the router. Identity can mint a token
      but nothing issues one, so the shell calls People directly with the
      internal token and a principal it builds itself. Needs identity issuing a
      short-lived access token to the shell's server for the signed-in session
      (never the browser), key rotation through the JWKS, the shell calling the
      router, and the direct path removed. Found in PEO-098. *(PRD §13)*
      *Landed in two parts.* Identity issues the token (`POST
      /api/internal/session/token`, five minutes, `aud` the router, `ent` the
      company's modules), publishes rotation keys (`AUTH_VERIFICATION_KEYS`),
      and the router checks the audience and refetches on an unknown `kid`.
      *Decided (option a):* the shell reaches People only through the router,
      over GraphQL. Every `/v1/views/*` view is a typed query and every screen
      write a mutation, each the REST route of the same name dispatched
      in-process (same Zod body, same caller check, same `Idempotency-Key` row
      through an `idempotencyKey` argument on every mutation); a record's values
      are a keyed list of a union, so a withheld field is absent rather than
      null. Imports came as multipart uploads of up to 100 MB (router
      `file_upload` and body limit, People's Yoga sized to match) — since
      replaced: a file now goes from the browser straight to object storage
      with a presigned PUT, and no file passes through the shell or the
      router (PRD §14.2); downloads stay signed links. The shell asks identity for the token and sends its
      own named operations (`people-operations.ts`), safelisted in the router
      from generated persisted operations; it has no People address or token
      left, and a test says so. The acceptance suite runs identity, the router
      and People for real. Also: a leaver's tenant roles are revoked with their
      access (system actor, reason `access_ended`; the last `people_admin` too,
      migration 20260924280000), and restored access restores no role.
- [x] **PEO-114** Entitlements per tenant. Which modules a tenant bought was
      one deployment-wide list. Found in PEO-092. *(PRD §7, §8.2, §13.1)*
      *Landed as `platform.tenant.entitlements` (20260924270000; null is
      "nothing recorded", so the deployment's `KITHENA_ENTITLEMENTS` is a
      default only), set in the company wizard's Modules step and on the
      company page (`PUT /api/internal/admin/tenants/{id}/entitlements`), each
      change `identity.tenant.entitlements_changed` with the whole list.
      People keeps a copy in `people.tenant_settings` (20260924270100) and
      every transport's caller check prefers it to the forwarded list. The
      shell reads the effective list from the session answer and shows only
      the areas the company bought.*
- [x] **PEO-119** Organisation settings and a way into every People screen.
      PEO-099 and PEO-101 had REST and GraphQL for legal entities, locations
      with effective-dated zones, employee numbering and the tenant's
      settings, and no screen; People's home was a placeholder, so a settings
      screen was reachable only by typing its URL. Needs one settings screen
      (`/people/settings/organisation`, tabs for entities, locations,
      numbering and the company) read by anybody in the tenant and changed by
      `people_admin`, the cohort minimum raisable and never lowerable on the
      screen too; People's home listing the areas the viewer's roles open;
      and HR seeing on a profile whose day it is for that person, since every
      lifecycle move runs on it. Everything through the router (`peopleOrganisation`,
      `peopleHome`, `PeopleProfile.calendar`). *(PRD §6.8, §9.4)*
      *Landed as those three reads (the last over `PersonAccess.calendar`,
      HR only), the seven existing mutations as persisted operations, the
      `Organisation` screen and a real `PeopleHome`. Reach: `Combobox` takes
      `FieldControl`'s id and description, so a zone picker is a labelled
      field (story "In a Field"). Proven by the acceptance test: from People's
      home to the settings, a location added in Pago Pago, the person placed
      there, and a zone change to Kiritimati moving their day on HR's view of
      the profile. Placing them is SQL in the test, because nothing else can
      (PEO-123).*
- [x] **PEO-120** Lifecycle actions on the profile. PEO-108 to PEO-111 have
      transports and no screen: give and withdraw notice, terminate (with
      ending access now), start and end leave, discard a provisional record,
      rehire (with the not-eligible override and its reason), and the
      employment periods. HR only, on the profile, each keyed.
      *(PRD §8.1, §8.5, §10.2)*
      *Landed as an Employment section on another person's profile, sent to
      HR alone (`PeopleProfile.employment`: status and every period, beside
      PEO-119's calendar): the periods table, and the moves the status allows,
      each a dialog over the existing mutations, a refusal shown as People
      worded it. Terminate asks the reason, a note, eligibility and whether to
      end access now; a rehire of somebody marked not eligible asks why and
      will not go without it, and is offered the day after the last working
      day at the earliest. One's own profile shows the section without moves.
      Proven by the acceptance test: HR terminates with access ended now
      (`access_ended` in the outbox), then rehires, and period 2 is on the
      screen and in `people.employment_period`.*
- [x] **PEO-121** Finance full values and the webhook delivery log on screen.
      PEO-088's request, decision and one download, and PEO-032/093's
      delivery log with replay, have transports and no screen; neither has a
      list to read from. *(PRD §13.3, §15.2)*
      *Landed as two reads and two screens.* `GET /v1/exports/full-values` /
      `peopleFullValues`: finance's own requests and the sealed, exportable
      fields it may ask for; HR's every request; anybody else refused
      (`fullValuesScreen`, the newest 50, the link only ever the requester's).
      `/people/full-values` is both halves: finance asks with a reason and
      downloads once, HR approves or rejects with a note. `GET
      /v1/webhooks/endpoints/{id}/deliveries` / `peopleWebhookDeliveries`:
      one endpoint's deliveries, newest first, keyset pages of 50 by `seq`,
      status, attempts and last response and never a body, `people_admin`
      only; `/people/settings/integrations/{id}` lists them with Replay on
      each, reached from the endpoint's card. People's home lists Full values
      for finance and HR. Proven by the acceptance tests: finance asks, HR
      approves, the link answers 200 once and 410 after, and HR is never
      handed it; a failed delivery is shown and replayed, the replay a row of
      its own naming the original.*
- [x] **PEO-122** The expiry timeline, and paging the person picker and the
      completeness grid. The analytics landing drew no timeline although
      `expiries` answers it (§16.2); the profile's picker and the grid still
      read the first 200 people (PEO-117's note). *(PRD §8.4, §16.2, §17.2)*
      *Landed as `expiryTimeline` (analytics): who, what and when over the
      next 90 days, each window on the person's legal entity's day at one
      instant, **read live** — the snapshot holds counts, never a person, and
      a person-level copy would be a second store of personal data, a day
      stale on the one operational chart (PRD §16.2, §16.4 now say so). A
      chart is a read item by item: a kind shows only when its field is
      readable at the viewer's level, an item only when the viewer reads that
      field on that person (`readableExpiries`, the profile's relation), a
      name only as far as they read it; the tile counts the items drawn, so
      a withheld one leaves no gap. A manager's is their chain. HR asks no
      per-person relation (a relation only adds scopes). Under 400 ms at
      50,000 people. `PeopleAnalytics.expiries`, drawn as `TimelineChart`
      lanes per person with its table. The grid pages by keyset over the
      people with a gap HR or Finance fills (`PersonAccess.list({ gaps:
      'staff' })`, HR only), its totals and field list over everybody from
      `people.completeness_gap`, "Next page" / "First page" as URLs; a person
      field is a `Combobox` that searches People (`peoplePicker`, PEO-117's
      search, 20 a page), and a profile sends only the people its person
      fields name. `everybody()` is gone. No migration. Acceptance: HR sees
      a permit expiring in 30 days, a manager outside the chain does not,
      and sees their own report's.* *Still open:* the timeline has no past
      `asOf` (a past day is the snapshot's counts). The export builder's
      sample and the per-person relations closed in PEO-124.
- [x] **PEO-123** Nothing places a person at a location or in a legal entity
      from a screen or an import: `location_id` and `legal_entity_id` are
      typed columns (§6.8) but no published attribute names them (the core
      pack has neither, and there is no `location_ref` data type), so a
      person's day can only follow a location somebody wrote into the row.
      Needs the two attributes in the core pack, a `location_ref` type with
      its picker, and the transfer semantics (§8.5). Found in PEO-119.
      *(PRD §6.8, §7, §8.1, §8.5, §10.2)* *Landed as `PersonAccess.place`,
      HR only: entity, location, org unit and cost centre from a date on the
      new calendar (today there by default; a date ahead from PEO-124), a location moving
      its entity with it, archived ones refused, a same-day repeat a
      correction carrying `supersedes`; `POST /v1/people/{id}/placement`,
      `placePerson`, and the placement control beside Employment on the
      profile. Decided: a legal-entity change is a transfer — the period
      closes the day before and the next opens, continuous service, hire
      date and status untouched — and a location change is not; applied in
      `update`, so a form or an import transfers the same way. The number
      follows the rehire rule. `legal_entity_id` and `location_id`
      (`location_ref`, new) in the core pack, effective-dated. No migration.*
- [x] **PEO-124** A value dated in the future came into force on no day. It
      was stored in history correctly, but nothing moved the projection, the
      person's calendar, completeness, analytics, OpenFGA or the events
      consumers act on when its date arrived, so PEO-123 refused future
      placements. Found in PEO-123. Also PEO-122's three leftovers.
      *(PRD §8.5, §10.2, §11.1, §11.2, §15.1, §16.2)* *Landed as an hourly,
      bounded, idempotent job beside the start job
      (`bringDueIntoForce` → `PersonAccess.bringIntoForce`): people with a
      row dated after the day it was recorded anywhere (`scheduled()`, at
      UTC−12) and now arrived on their own calendar — the one the value
      takes them to — have what history holds in force that day (`arrived()`:
      latest wins, a correction in place of what it superseded) written into
      their row, with `people.person.attribute_effective` (new, classified
      like `profile_updated`, filtered for webhooks the same way),
      `manager_changed` (OpenFGA's consumer moves the tuple from it: the new
      manager gains access on the day), `org_changed` and the PEO-123
      transfer and renumbering, identity's facts and a completeness
      re-judge, each dated the value's own day. The write raises
      `profile_updated` at once with the future `effectiveFrom`, as §10's
      envelope means. Applied-ness: `people.person.applied_through`, a
      per-person watermark, and a partial index over scheduled history rows
      (20260924320000); idempotence itself comes from comparing history with
      the row, so a rerun, a second replica or a stale watermark writes
      nothing. A future transfer for somebody on notice is refused at the
      write; one refused on its day (notice given since) is recorded once
      by history row (`people.scheduled_refusal`), raises
      `people.person.scheduled_change_refused` once, is never retried, and
      is a `scheduled_change_refused` row on HR's grid until a correction or
      new value for the key is recorded. Placement accepts any date; a retry of a scheduled one is a
      no-op. A corrected manager now raises `manager_changed` too. PEO-122's
      leftovers: the export builder offers fields from the published schema
      and the relations the viewer can hold (tenant roles, and self, manager
      and chain where `reach` finds somebody), counting everybody; the grid
      selects people by the HR-owned keys it shows (`list({ gaps: keys })`),
      so no page comes up short; relations for a page, an export and the
      expiry window are `relationsToMany` — OpenFGA `ListObjects` for self,
      manager and chain (`RelationsResolver.reach`), a per-person check only
      for whoever a list capped at 1,000 may have missed.*
- [x] **PEO-125** National identifiers were checked permissively (a PAN of
      any holder type, a NI number without its suffix, the Steuer-ID's
      digit rule skipped, NAF, SV-Nummer and UAN by shape only) and a failed
      check refused the value. Product decision: tighten the checks, never
      block — warn the employee, save the value, and let HR's reviewer
      decide, finally. *(PRD §6.4, §8.4, §14.5, appendix A)* *Landed as
      findings, not pass/fail: `checkNationalId` returns `{ level: ok |
      attention | mismatch, code, message }` per rule and refuses only what
      cannot be the identifier (length or characters after normalising).
      PAN holder types with a company/firm/trust as `attention` and the check
      letter as "cannot be verified" (unpublished); NIF/NIE/K-L-M mod 23 and
      a CIF as `attention`; NAF mod 97 with the short-number case; SV-Nummer
      check digit with the letter weighted as its alphabet position; Steuer-ID
      ISO 7064 and the digit rule, pre- and post-2016; NINO prefixes and an
      A–D suffix, a missing one `attention`; UAN shape, "cannot be verified".
      Every write — an edit, a section save, the grid, an import row, a
      hire, a correction — admits its values through one `validate` and one
      `gateIdentifiers`, so none can skip the check or the queue; each answers
      with the findings from one function (`findingsFor`), and a retried
      write with the same key recomputes the same answer. A form and the
      completeness grid ask before they save (`peopleIdentifierCheck`,
      `peopleGridCheck`) and warn on the field or cell (`FieldDescription
      tone="warning"`, new in Reach) and above the button, then save on
      "Save anyway". Whether a value is the one HR accepted is a keyed-hash
      comparison (`value_hash` on the review, re-keyed by the claim
      rotation): nothing is decrypted to compare. A doubted
      value opens `people.identifier_review` (20260924330000), keyed to the
      history row that wrote it, never the value: HR's grid gets an
      `identifier_review` row, `/people/identifier-reviews` lists each with
      its findings and last four, the value through the audited reveal
      (`people.person.identifier_revealed`). Accept is final — the same
      value saved again is not flagged — and send back shows on the
      employee's record and as `attention` in completeness until a new
      value supersedes it; both audited as
      `people.person.identifier_reviewed` (codes, never the value). The
      import dry run lists doubted cells without blocking; the commit counts
      what went to review.*
      *Later (product decision, 2026-09-26): **a doubted value held for
      approval (PEO-077) is reviewed first, then approved.** Holding it opens
      the review against the held change (`identifier_review.pending_change_id`,
      `history_id` null; migration 20260926230100) by the same
      `onIdentifierWritten` rule a write follows, so it also supersedes
      whatever was open — a sent-back value is answered by the next one
      (`change_requested.supersedesReview`; `reviewId` when it opens one).
      Nobody approves the change while its review is not accepted
      (`AWAITING_REVIEW`); the inbox shows *Awaiting identifier review* with
      the findings and no Approve. HR's queue lists it with the change's last
      four and reveals it from the held change, audited. Accepted, it becomes
      approvable, and the approval writes it through the normal path, where
      the accepted review of the same value asks nobody again. **Send back
      now requires a reason**, always; on a held value it declines the change
      in the same transaction (`change_decided`, `decidedAs:
      identifier_review`, the reason as its note; `identifier_reviewed`
      carries `changeId`), the employee's record shows "HR could not accept
      your NIF: <reason>. Please correct it." with *Correct it*, and the
      workflow emails them messaging's new `correction_requested` notice
      (which names neither the field nor the reason). A change closed any
      other way supersedes its pending review.*
- [x] **PEO-126** Product decision: keep the statutory retention floors
      (es-labour 48 months, de-labour 72, eu-payroll 120) but mark each
      unreviewed, pending counsel, and block automated erasure until counsel
      signs off. *(PRD §12)* *Landed as `FLOOR_REVIEWS` beside
      `STATUTORY_FLOOR_MONTHS` in `domain/retention/floors.ts`, every floor
      `unreviewed`; `mayErase` refuses an `automated` erasure relying on an
      unreviewed floor and lets HR act `manual`ly with a stated reason;
      `anonymiseDue` takes the mode and refuses with
      `RETENTION_FLOOR_UNREVIEWED`, clearing nothing; a manual run's reason
      rides `people.person.anonymised` as `manualReason`.
      `peopleOrganisation.retentionFloors` and a "Pending legal review" table
      on the organisation settings' Company tab. Reviewing a floor is `pnpm
      --filter @kithena/scripts review-retention-floor`, whose commit is the
      audit record. No migration.* *Still open:* no transport calls a manual
      `anonymiseDue` yet — HR's by-hand erasure needs a route and a control
      on the profile when PEO-075 is built.
- [x] Employment status leaked to anybody who could read the person:
      `Person.status` over GraphQL, `status` on `GET /v1/people[/{id}]`, every
      row of a list, the directory's `active` count (a one-person search
      answering "0 active" names them as away), and a manager's charts by
      status. Found beside PEO-065/066, whose guard assumes status is HR's.
      *(PRD §6.3)* *Landed as `statusVisibleTo` in
      `domain/access/field-access.ts` — HR, and the person's own — applied
      once in `PersonAccess`'s view, so REST leaves `status` out, GraphQL
      answers null, and the screens follow; lists and counts leave out
      leavers (`LEAVERS`) for anybody but HR, whose `active` is then the
      listed count; `authorizeFields` serves `status` to HR only. §6.3 no
      longer lists status under HR information.* *Still open:* a record
      read by its id is answered for a leaver, status withheld; hiding it
      from a peer altogether is a product call.
- [ ] Route `/scim/v2/*` through the Cloudflare Tunnel to People
      (`docs/environments.md` "Hosting" has the rule and the API call), and
      decide whether a tenant relying on SCIM keeps the VM awake. Found in
      PEO-072. *(PRD §13.5)*
- [ ] Verify SCIM against a live Okta and a live Entra tenant (the provider
      test suites: Okta's SCIM 2.0 spec tests, Entra's SCIM validator), and
      record what each sent that the build did not expect. Found in PEO-072.
      *(PRD §13.5)*
- [ ] A SCIM POST for somebody already in People (HR-created, or provisioned
      by identity) creates a second record or is refused `uniqueness`. HR
      adopting the existing record into the connection — and whether that
      should ever be automatic — needs deciding; PEO-074's duplicate
      detection is the nearest thing. Found in PEO-072. *(PRD §13.5, §12.4)*
- [ ] Router deployment mounts apps/gateway/persisted at /persisted;
      production router config and a timed 100 MB import through it. Found
      in PEO-113. *(PRD §13.1)*

## Blocked, and by what

| Ticket  | Blocked on          | Note                                                                                                                                      |
| ------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| PEO-027 | PEO-002             | People cannot see a name captured at enrolment until identity publishes it                                                                |
| PEO-059 | a human per country | A country in a pack is a claim that its paperwork rules are right, and they are only right where somebody checked                         |
| PEO-045 | nothing technical   | The cohort minimum default of 10 is a product decision; confirm before shipping                                                           |
| PEO-113 | resolved: option (a) | GraphQL for the screens through the router, with identity's token; REST stays for integrators. The shell has no direct path to People — PRD §13.1 |
| PEO-037 | legal review        | The statutory retention floors (es-labour 48 months, de-labour 72, eu-payroll 120) are placeholders until someone qualified confirms them |
| PEO-075 | counsel reviews the floors | Automated erasure refuses an unreviewed floor (PEO-126); HR may erase one person by hand, with a stated reason |
