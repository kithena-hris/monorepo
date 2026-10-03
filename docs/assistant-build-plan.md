# The Assistant — build plan

Every ticket needed to ship the cross-module assistant, in an order that
works. Tick each box as it lands.

**This file, in the repository, is the record of progress.** Change a box here,
in git, and nowhere else.

**Specs**

| What                   | Where                                                                   |
| ---------------------- | ----------------------------------------------------------------------- |
| Requirements           | [`docs/assistant-prd.md`](./assistant-prd.md)                           |
| Repo rules             | [`CLAUDE.md`](../CLAUDE.md)                                             |
| Layer boundaries       | [`docs/code-structure.md`](./code-structure.md)                         |
| The plans this mirrors | [`docs/timeoff-build-plan.md`](./timeoff-build-plan.md)                 |
| AI in People           | [`docs/ai-settings.md`](./ai-settings.md), "Search and export in words" |
| The VM and its budget  | [`docs/environments.md`](./environments.md)                             |

There are no screens in Phases 1 and 2. Phase 3's web search box needs
designs in the Claude Design project before its ticket starts.

---

## How to work a ticket

1. **Read the spec references first.** Every ticket names PRD sections. They
   are the acceptance criteria; this file is only the order.
2. **Check `Depends on`.** If a dependency is unticked, stop and do that one.
3. **Domain work is test-first.** Anything under `src/domain/` gets its failing
   test before its implementation.
4. **`Done when` is a command, not a feeling.**
5. **Tick the box in this file in the same commit as the work.**

### How the work lands

Built on the long-lived branch **`assistant`**. Each lane below is one pull
request **into `assistant`**, squash-merged once CI is green. When Phase 1's
lanes (1 to 7) have landed, `assistant` goes to `main` as one pull request, so
People, Time Off, the assistant and Slack change in one deploy. Phase 2 and 3
lanes then branch from `main` again, one pull request each.

| PR  | Lane                                                                                     | Tickets           |
| --- | ---------------------------------------------------------------------------------------- | ----------------- |
| 1   | `assistant/docs` — this plan, the PRD, the `CLAUDE.md` paragraph                         | —                 |
| 2   | `assistant/contracts` — capability and plan contracts, codegen                           | AST-001 – AST-005 |
| 3   | `assistant/domain` — the service skeleton and its pure core                              | AST-006 – AST-011 |
| 4   | `assistant/service` — the use case, clients, identity's route, planner, eval gate, route | AST-012 – AST-017 |
| 5   | `assistant/people` — People's capabilities                                               | AST-018 – AST-021 |
| 6   | `assistant/timeoff` — Time Off's capabilities                                            | AST-022 – AST-024 |
| 7   | `assistant/slack-and-deploy` — Slack rerouted, People's old route gone, deploy, docs     | AST-025 – AST-029a |
| 8   | `assistant/timeoff-more` — balances, pending, the union of items                         | AST-030 – AST-032 |
| 9   | `assistant/follow-ups` — earlier questions in a conversation                             | AST-033           |
| 10  | `assistant/teams` — the Teams adapter                                                    | AST-034           |
| 11  | `assistant/web` — the subgraph and the search box                                        | AST-035 – AST-036 |

PRs 3, 5 and 6 run in parallel once PR 2 is in. PR 4 needs PR 3. PR 7 needs
PRs 4, 5 and 6. PRs 8 to 11 need `assistant` merged to `main`.

### Rules no ticket restates

- **No cross-module imports, either way.** `platform/assistant` imports
  `packages/*` only; no module imports the assistant or calls it.
  `.dependency-cruiser.cjs` (`no-modules-in-platform`, `no-platform-in-modules`)
  already fails the build.
- Zod is the single schema source. Every contract field carries a
  classification policy or `just codegen` fails.
- No `new Date()` in domain code — inject `Clock`.
- **The domain computes every number. AI only plans.** A model sees names of
  capabilities and fields, never a value, and writes no text after anything is
  looked up (PRD §11.2).
- **Authorization lives in the module.** A capability handler calls the
  module's existing use cases; it never re-decides who may see what, and the
  assistant never decides it at all (PRD §10.3).
- **Words are never logged**: not the question, not a filter, not a name, not
  a count (PRD §12.4).
- **A private leave type never reaches the model and never sits beside a name
  in chat** (PRD §11.4, §12.2).
- Reuse before writing: People's `describe()`, `filterFields`, `forModel`,
  `metricsFor`, `saying()` and smart search's reader; Time Off's `sightOf`
  and `accept()`. Where a platform service cannot import a module's code, the
  copy is deliberate and says where it came from.

### Tracks

```
  A  contracts ──▶ assistant domain ──▶ assistant application ──▶ route
  B  People capabilities     (from AST-018, needs A's contracts)
  C  Time Off capabilities   (from AST-022, needs A's contracts)
  D  Slack, deploy           (from AST-025, needs A, B, C)
```

Phase 1 is done when every box down to AST-029 is ticked, every example in
PRD §7 passes as an end-to-end test, and both modules' standalone suites are
green with their capability routes.

---

## Phase 1 — contracts

### [x] AST-001 — The shared capability shapes

**Goal** One vocabulary every module's capabilities are built from, so the
assistant can validate and join any of them without knowing the module.

- **Spec** PRD §8.1, §8.3
- **Files** `packages/contracts/src/assistant/capability.ts`,
  `packages/contracts/src/assistant/capability.test.ts`,
  `packages/contracts/src/index.ts`
- **Depends on** nothing
- **Approach** `capability({ name, version, module, about, accepts, groups,
output, yields })` returning a descriptor; the shared inputs (`Filter` with
  People's operators, `match`, `DateRef` and `{ from, to }`, `name`, `sort`,
  `limit`, `groupBy`, `personIds` ≤ 5,000) and outputs (`people`, `profile`,
  `items`, `ambiguous`, `not_found`), each field registered with a policy:
  names `asIdentity()`, ids `asIdentity()`, `described` and `notes`
  `asInternal()`, a row's `detail` `asSpecialCategory('health')` (it can hold a
  leave type). Also `AssistantQuestion` (`{ tenantId, email, question,
channel, earlier? }`) and `AssistantAnswer` (`{ text, understood, people,
answered }`, today's shape from `ask.ts`), which Slack and the assistant
  both parse.
- **Done when** the contract tests pass and `just codegen` reports no
  unclassified field once AST-005 walks it.
- **As built** each descriptor carries `schemas.step` (what a plan may write:
  date references, no `personIds`/`limit`) and `schemas.input` (what the module
  receives: resolved `{ from, to }`, `limit` up to 5,000 for §9.6's count by
  group, `ids`, `personIds`); every result has a `kind`; generic names are
  prefixed (`CapabilityFilter`, `NameAsTyped`, `ASSISTANT_LIMITS`).

### [x] AST-002 — People's capability contracts

- **Spec** PRD §7.4, §8, §16
- **Files** `packages/contracts/src/assistant/people.ts` (+ test)
- **Depends on** AST-001
- **Approach** Five descriptors: `people.find` (filters, match, sort, name as a
  manager, groupBy, within; output `people`; groups are the select and
  location fields, declared as `field:*`), `people.person` (name; `profile`),
  `people.reports` (name; `people`), `people.managers` (within only;
  `people`), `people.approvals` (nothing; `items`). `about` sentences written
  for the model, plain and short.
- **Done when** the tests parse a sample input and output for each and refuse a
  `people.managers` input without `personIds`.

### [x] AST-003 — Time Off's capability contracts

- **Spec** PRD §7.1, §7.2, §7.5, §8.2, §8.4
- **Files** `packages/contracts/src/assistant/timeoff.ts` (+ test)
- **Depends on** AST-001
- **Approach** `timeoff.away` (filters `leave_type`, `team`; `on` required;
  name; within; groups `team`, `location`; output `people`; yields `team` to
  `people.find`) and `timeoff.managers` (within; `people`; yields to
  `people.managers`). The catalogue's leave type entry carries `private:
boolean` (category `sick_leave` or `parental_leave`, or visibility
  `off_only`).
- **Done when** the tests pass and a row's `detail` is classified
  special-category.
- **As built** the entry is `CatalogueLeaveType`, and `isPrivateLeaveType()`
  decides `private`; each capability declares its own yield.

### [x] AST-004 — The plan and the catalogue

- **Spec** PRD §8.5, §9.1, §9.3
- **Files** `packages/contracts/src/assistant/plan.ts`,
  `packages/contracts/src/assistant/catalogue.ts` (+ tests)
- **Depends on** AST-001
- **Approach** `Plan` (`plan` | `unclear` | `unavailable`), `Step` (`s1`–`s4`,
  `capability`, `input` as an unknown record, `within`), `Answer` (`count`
  with `by`, `list`, `one`), all `z.strictObject`; `say` ≤ 240, `reply` ≤ 500.
  `RuntimeCatalogue` (`module`, `serves`, `fields` per capability, `metrics`,
  `leaveTypes`, `denied`). The plan's schema is shape only; meaning is checked
  in the assistant's domain (AST-007), against the catalogue.
- **Done when** the tests refuse an extra key at every level and five steps.
- **As built** exported as `AssistantPlan`, `PlanStep`, `PlanAnswer`, `StepId`
  and `RuntimeCatalogue`, `CatalogueField`; the step limit is
  `ASSISTANT_LIMITS.steps`.

### [x] AST-005 — Codegen walks capabilities

- **Spec** PRD §8.2
- **Files** `tools/codegen/src/cli.ts`, `packages/contracts/src/assistant/index.ts`
  (`allCapabilities`), `packages/telemetry/src/generated/*` (regenerated)
- **Depends on** AST-002, AST-003, AST-004
- **Approach** Walk every capability's input and output schema beside
  `allEvents`, under `capability.<name>.input` / `.output`. The generated
  redaction paths and AI deny list then cover them; an unclassified field fails
  the run as for events.
- **Done when** `just codegen` passes, the regenerated deny list contains the
  away row's `detail`, and removing one policy makes it exit non-zero.
- **As built** the walk now descends an unclassified list or union (a classified
  one stays a leaf, as before); redaction paths write items as `rows[*].detail`,
  the deny list as `rows.detail`. `generated/` is gitignored, so nothing
  regenerated is committed; the events' paths are unchanged.

---

## Phase 1 — the assistant's core

### [ ] AST-006 — `platform/assistant` boots

- **Spec** PRD §6.1, §15.1
- **Files** `platform/assistant/{package.json,tsconfig.json,vitest.config.ts,Dockerfile}`,
  `platform/assistant/src/{main.ts,composition.ts}`
- **Depends on** nothing
- **Approach** Mirror `platform/slack`: `startTelemetry('kithena-assistant')`,
  port 4104, `node:http`, `/health`, `onShutdown` drain, `node:24-bookworm-slim`.
  Layers `src/domain`, `src/application`, `src/infrastructure`, `src/http`.
  With nothing configured it starts and every question answers "The assistant
  isn't available right now." No database.
- **Done when** `pnpm --filter @kithena/assistant dev` answers `/health`,
  `just lint` (dependency boundaries included) passes, and the image builds.

### [ ] AST-007 — Plan validation

- **Spec** PRD §9.2, §9.3
- **Files** `platform/assistant/src/domain/plan.ts` (+ test, first)
- **Depends on** AST-004, AST-006
- **Approach** `readPlan(text, catalogue): Result<ValidPlan, PlanRefusal>`.
  The first `{…}` in the text (People's `firstObject`, copied), parsed with
  `Plan`; then every rule in PRD §9.2: capability offered, input against its
  schema and `accepts`, no `personIds` or `limit`, filters against the
  capability's runtime fields (key, operator by kind, option by value or label
  → value, as People's `checked()`), `within` earlier, unique ids, answer step
  exists, `by` declared. `say` kept only through `saying()` (copied from
  `intent.ts`). Refusal is whole and carries a reason code for telemetry.
- **Done when** one test per rule, each refusing; a valid plan for every PRD §7
  example accepted.

### [ ] AST-008 — Dates in the asker's zone

- **Spec** PRD §9.4
- **Files** `platform/assistant/src/domain/dates.ts` (+ test, first)
- **Depends on** AST-006
- **Approach** `resolve(ref, zone, clock)` → `{ from, to }` calendar dates;
  weeks Monday to Sunday; months whole; ISO dates pass through; `spoken()` for
  "Tuesday 6 October" and "12–18 October". Today in a zone from `Clock` with
  `Intl` (as Time Off's `zone.ts`). No `Date` construction from the wall clock.
- **Done when** tests cover 00:30 in Madrid on the 7th being the 7th (UTC
  says the 6th), `next_week` on a Sunday, `next_month` in December, and an
  unknown zone falling back to UTC with the answer saying so.

### [ ] AST-009 — Masking and refusals

- **Spec** PRD §7.6, §12.2
- **Files** `platform/assistant/src/domain/mask.ts` (+ test, first)
- **Depends on** AST-004, AST-006
- **Approach** `mask(question, leaveTypes)` replaces a private type's name, its
  key and its category's synonyms ("sick", "off sick", "ill", "sick leave",
  "maternity", "paternity", "parental") with `L1`, `L2`… and returns the
  references; `unmask(plan, refs)`. Non-private types are left alone. Then
  `refused(question)`: the assistant's copy of People's refusals in
  `services/people/src/domain/assistant/clarify.ts` (special category,
  performance, prediction), applied to what masking left, with People's
  sentences. The copy says where it came from and why.
- **Done when** "managers of people on sick leave today" with a private `sick`
  type masks to "managers of people on L1 today"; the same question with no
  Time Off is refused as special-category; "who is pregnant" is refused either
  way; a masked prompt fixture never contains "sick".

### [ ] AST-010 — Join, count, group

- **Spec** PRD §9.3, §9.5, §9.6
- **Files** `platform/assistant/src/domain/execute.ts` (+ test, first)
- **Depends on** AST-007
- **Approach** Pure scheduling and folding over results, I/O passed in:
  `order(plan)` gives waves of independent steps; `limitFor(step, plan)` is 0,
  25 or ids-only; `within` sets are the earlier step's `ids`; an intermediate
  total over 5,000 is `TOO_BROAD`; a failed step fails its dependants; `by`
  groups the final rows and counts each group. Distinctness is the module's.
- **Done when** tests cover a two-step join, two independent steps, a failure
  in s1 failing s2, too broad, and grouping by team.

### [ ] AST-011 — Answer text

- **Spec** PRD §7, §11
- **Files** `platform/assistant/src/domain/answer.ts` (+ test, first)
- **Depends on** AST-008, AST-010
- **Approach** One template per answer kind and output kind, carrying
  `ask.ts`'s sentences (count, list with "the directory has the rest",
  grouped, `not_found`, `ambiguous`, `profile`, `items`, `NO_PROFILE`).
  `scope: 'visible'` adds "you can see" and the fixed sentence about what the
  asker sees; the private-type sentence for a non-HR asker whose filter named
  a private type (PRD §7.7). `say` with `{n}` filled, then Time Off's
  `accept()` number rule (copied from `services/timeoff/src/application/assist/written.ts`)
  with no facts, so any number drops it. **Chat rules** (PRD §11.4): a
  private-type row's detail reads "Away"; a list whose filter names a private
  type becomes the count and the Time Off calendar link
  (`/time-off/calendar/month?day=…&types=…` on the tenant's host); managers
  listed without per-manager counts. `understood` from the steps' `described`.
- **Done when** `services/people/src/application/assistant/ask.test.ts`'s
  wording cases are ported here and pass, and every PRD §7 answer is a test.

---

## Phase 1 — the assistant as a service

### [ ] AST-012 — The ask use case

- **Spec** PRD §7, §10.4
- **Files** `platform/assistant/src/application/ask.ts`,
  `platform/assistant/src/application/ports.ts` (+ test)
- **Depends on** AST-009, AST-010, AST-011
- **Approach** Ports: `Identity.asker`, `Module.catalogue` / `Module.call`,
  `Planner.plan`, `Clock`. Resolve the asker; fetch catalogues in parallel
  (a failed one is left out); drop yielded entries; mask and refuse; plan
  (8 s); unmask; validate; resolve dates; execute in waves (4 s a call, 15 s a
  question, aborting what is in flight); write the answer. Unentitled
  modules' one-line descriptions go to the planner as `unavailable`. Hourly
  budget per company (`ASSISTANT_PLANS_PER_HOUR`, 120, in memory), at most 8
  questions at once.
- **Done when** tests with fake ports cover People only, Time Off only, both,
  neither, a module down, a module refusing, identity's 404, the budget spent,
  and every PRD §7 example end to end.

### [ ] AST-013 — The module client

- **Spec** PRD §6.5, §8.6, §10.2
- **Files** `platform/assistant/src/infrastructure/modules.ts` (+ test)
- **Depends on** AST-012
- **Approach** For each `ModuleKey` with capabilities in `allCapabilities`:
  `<MODULE>_URL` and `ASSISTANT_<MODULE>_TOKEN` from the environment; absent,
  the module is absent (logged once). `GET /internal/capabilities` and
  `POST /internal/capabilities/<name>` with `x-internal-token`,
  `x-kithena-principal` (the router's shape: `userId`, `tenantId`,
  `entitlements`, `impersonatedBy: null`, `viewedBy: null`) and
  `x-correlation-id`; `AbortSignal.timeout(4_000)`; responses parsed with the
  contract, anything else a failure. Catalogue cached 60 s per (tenant,
  account, module). A capability version the assistant does not pin is absent.
- **Done when** tests with a mocked `fetch` cover the headers, a timeout, a
  malformed response and an unknown version.

### [ ] AST-014 — Identity says who is asking

- **Spec** PRD §6.6, §10.1
- **Files** `platform/identity/src/account/http/asker-routes.ts` (+ test,
  - integration test), its wiring in identity's composition,
    `platform/assistant/src/infrastructure/identity.ts`
- **Depends on** AST-012
- **Approach** `POST /api/internal/tenants/<id>/assistant/asker`, behind
  `ASSISTANT_IDENTITY_TOKEN` (`presentsInternalToken`), body `{ email }`:
  exactly one active account with that work email in the tenant →
  `{ accountId, timeZone, slug, entitlements }` (recorded list, else
  `deploymentEntitlements`, as for `ent`); otherwise 404 with no reason.
  Precedent: `directory-routes.ts`. The client caches 60 s per (tenant, email).
- **Done when** the integration test covers one match, none, two, and an
  account whose access ended.

### [ ] AST-015 — The planner, through the AI gateway

- **Spec** PRD §12.1, §12.3, §14
- **Files** `platform/assistant/src/infrastructure/planner.ts`,
  `platform/assistant/src/domain/instruction.ts` (+ tests)
- **Depends on** AST-012
- **Approach** The instruction is built from the catalogue, in the voice of
  People's `instructionFor()`: the plan shapes, each capability's `about` and
  inputs, the date references, `@me`, "never a number in say", "on leave is
  employment status, not off today". Context: the masked question, today in
  words, the catalogue (keys, labels, kinds, options where `aiEligible`),
  `unavailable`. Through `aiGateway` over a per-tenant registry loaded from the
  static paths plus every catalogue's `denied`; no subjects, so the
  conservative name rule. Transport: People's `chatModel` shape from
  `ASSISTANT_*` (copied; JSON mode, temperature 0, 8 s). `AI_FIELD_NAMED` and
  `AI_VALUE_DENIED` → today's "touches information I'm not allowed to see".
- **Done when** a test asserts the prompt for each PRD §7 example holds no
  value, no `personId` and no private word, and a prompt naming "sick leave"
  unmasked is refused by the gateway.

### [ ] AST-016 — The eval set and its gate

- **Spec** PRD §13.2
- **Files** `platform/assistant/eval/{cases.ts,recorded.json,run.ts}`,
  `platform/assistant/src/eval.test.ts`, `Justfile` (`assistant-eval`)
- **Depends on** AST-007, AST-015
- **Approach** At least 40 cases in the PRD's groups, each a catalogue fixture
  (People only, Time Off only, both; HR, manager, employee) and an expected
  plan. `just assistant-eval --record` calls the real model and writes each
  output, the model id and a hash of the instruction and fixtures. The test
  replays the recording through `readPlan`: fails on a stale hash, under 90 %
  exact plans (filters and values order-normalised), or any safety case.
- **Done when** the recording is committed, the test passes, and changing one
  word of the instruction makes it fail until re-recorded.

### [ ] AST-017 — The internal route

- **Spec** PRD §5, §12.4, §13.1
- **Files** `platform/assistant/src/http/server.ts` (+ test)
- **Depends on** AST-012, AST-013, AST-014, AST-015
- **Approach** `POST /internal/ask`, body `AssistantQuestion`, answer
  `AssistantAnswer`. Caller tokens from `SLACK_ASSISTANT_TOKEN` (and later
  `TEAMS_ASSISTANT_TOKEN`), each naming its channel; anything else 401.
  One log line per question: tenant, channel, correlation id, outcome,
  capabilities called, durations — never words. OpenTelemetry spans and the
  counters in PRD §13.1.
- **Done when** a test posts a question through the route against fake modules
  and a fake model, and a log-capture test finds no word of the question.

---

## Phase 1 — People's capabilities

### [ ] AST-018 — People serves the catalogue

- **Spec** PRD §8.5, §10.2, §10.3
- **Files** `services/people/src/http/capabilities.ts`,
  `services/people/src/http/server.ts`,
  `services/people/src/application/assistant/capabilities.ts` (+ tests)
- **Depends on** AST-002
- **Approach** `ASSISTANT_PEOPLE_TOKEN` accepted on `/internal/capabilities`
  and `/internal/capabilities/*` only; the principal resolved as the router's
  is (`withTenantRoles`, the recorded entitlements); handlers inside
  `readOnly()`. `GET /internal/capabilities`: `serves`, fields from
  `filterFields` → `forModel` for `people.find`, `metricsFor`, `denied` (the
  tenant's `aiEligible: false` keys and labels, as `loadPolicies` loads them).
- **Done when** an integration test shows HR's and an employee's catalogues
  differ as their filterable fields do, the router's token is refused here, and
  the assistant's token is refused on `/graphql` and `/v1/`.

### [ ] AST-019 — `people.find`

- **Spec** PRD §7.3, §7.4, §9.5, §16
- **Files** `services/people/src/application/assistant/capabilities.ts`,
  `services/people/src/application/person/person-access.ts` (+ tests)
- **Depends on** AST-018
- **Approach** Smart search's selection run as the asker: conditions, match,
  sort by a field or metric, a manager by name (direct or all), groupBy,
  validated by People's own reader in `domain/assistant/selection.ts`. Add a
  `personIds` restriction to `access.list` and `access.count`, authorized
  exactly as the unrestricted calls. `ids` when asked; `total` from `count`;
  `described` from `describe()`; rows from `personLine()`. Port `ask.test.ts`'s
  `people` and `count` cases here.
- **Done when** the ported tests pass, and a test shows `personIds` never
  returns a person the asker cannot list without it.

### [ ] AST-020 — `people.person`, `people.reports`, `people.approvals`

- **Spec** PRD §7.4, §16
- **Files** `services/people/src/application/assistant/capabilities.ts` (+ tests)
- **Depends on** AST-018
- **Approach** `ask.ts`'s `person`, `reports` and `approvals` cases returning
  structured output instead of text: `onePerson` with `@me`, `ambiguous` and
  `not_found`; reports through `access.list` with `REPORTS_TO`;
  `approvalsView`. Port the matching `ask.test.ts` cases.
- **Done when** the ported tests pass.

### [ ] AST-021 — `people.managers`

- **Spec** PRD §7.2
- **Files** `services/people/src/application/assistant/capabilities.ts` (+ tests)
- **Depends on** AST-018
- **Approach** `readMany` the given people as the asker, take `REPORTS_TO`,
  `readMany` those managers as the asker; distinct; a manager the asker cannot
  read is left out. Rows carry no count of reports.
- **Done when** tests cover two reports with one manager (listed once), a
  manager the asker may not read, and somebody with no manager.

---

## Phase 1 — Time Off's capabilities

### [x] AST-022 — Time Off serves the catalogue

- **Spec** PRD §8.4, §8.5, §10.2
- **Files** `services/timeoff/src/http/capabilities.ts`,
  `services/timeoff/src/http/caller.ts`, `services/timeoff/src/http/server.ts`,
  `services/timeoff/src/application/assist/capabilities.ts` (+ tests)
- **Depends on** AST-003
- **Approach** A caller for `ASSISTANT_TIMEOFF_TOKEN` on
  `/internal/capabilities` and `/internal/capabilities/*` only, the same
  `Forwarded` principal, the same refusals (support and view-as sessions, no
  `module.timeoff`), `withMember`. Catalogue: leave types (key, name,
  category, `private`), teams and locations from the projection, groups, and
  `denied` from `infrastructure/assist/gateway.ts`'s `DENIED`.
- **Done when** a test shows the router's token refused here and the
  assistant's refused everywhere else, and the standalone suite (People absent)
  serves the catalogue.
- **As built** `caller.ts` is unchanged: the assistant's caller is
  `withMember(callerFromHeaders(ASSISTANT_TIMEOFF_TOKEN))`, the router's code
  over the other token, and the listener sends only `/internal/capabilities*`
  to it. The routes are their own small table in `http/capabilities.ts`, not
  `ROUTES`, so they never reach OpenAPI, the subgraph or persisted operations;
  every handler is a read, so there is no read-only unit of work to wrap.
  Leave types carry `key`, `name`, `private` (lane 2's `CatalogueLeaveType`
  has no category), and a private type is never a `leave_type` option by name,
  only in `leaveTypes`, so a missed mask cannot show it to a model. No
  location field: `timeoff.away` filters only by leave type and team, and a
  row's location is in its `groups`. `DENIED` moved to
  `application/assist/denied.ts` so the application layer can serve it.

### [ ] AST-023 — `timeoff.away`

- **Spec** PRD §7.1, §7.2, §7.3, §7.7, §14
- **Files** `services/timeoff/src/application/calendar/calendar.ts`,
  `services/timeoff/src/application/assist/capabilities.ts` (+ tests)
- **Depends on** AST-022
- **Approach** Lift `sightOf` and the visibility rule out of `calendarIn` so
  both use one function. Find requests in the range (live and taken; pending
  only when asked), restricted to `personIds` or a `name` the asker may find;
  then check sight only for those members. **A `leave_type` filter matches
  only entries with `type` sight.** Rows: name, `detail` ("Mon 12 to Wed 14 ·
  Vacation", "· Away" when not seen or private), part-day, groups. `total`,
  `scope` (`everyone` for HR), `described`, holidays in the range as `notes`.
- **Done when** tests cover HR, an approver and a teammate; **a teammate's
  request for a private type returns a byte-identical response whether two
  teammates are on that leave or none are**; and the standalone suite answers
  with People absent.

### [ ] AST-024 — `timeoff.managers`

- **Spec** PRD §7.5, §8.4
- **Files** `services/timeoff/src/application/assist/capabilities.ts` (+ tests)
- **Depends on** AST-022
- **Approach** From the member projection's `managerPersonId` and
  `displayName`, for the given `personIds`, distinct, leaving out members the
  asker may not see. No per-manager count.
- **Done when** tests pass in the standalone suite.

---

## Phase 1 — Slack, deploy, docs

### [ ] AST-025 — Slack asks the assistant

- **Spec** PRD §5, §16
- **Files** `platform/slack/src/{main.ts,service.ts,slack-api.ts}` (+ tests)
- **Depends on** AST-017
- **Approach** `ASSISTANT_URL` and `SLACK_ASSISTANT_TOKEN`; `question()` calls
  `/internal/ask` with 20 s and parses `AssistantAnswer`. A mention is
  answered with `chat.postEphemeral` to the asker in the thread; slash commands
  and DMs as today. `People.ask` goes; `People.act` stays.
- **Done when** service tests show each reply path, and a mention's answer is
  ephemeral.

### [ ] AST-026 — People's old chat route is deleted

- **Spec** PRD §16
- **Files** `services/people/src/http/server.ts`,
  `services/people/src/application/assistant/{ask.ts,ask.test.ts,from-chat.ts}`
- **Depends on** AST-019, AST-020, AST-025
- **Approach** Delete `/internal/assistant/ask`, `answerChat`, `askFromChat`,
  `ask()` and what only it used; keep what moved into capabilities
  (`describe`, `filterFields`, `metricsFor`). Smart search, export in words and
  the import keep `AssistantPort`. `/internal/chat/act` stays.
- **Done when** `just check-strict`, `just lint` and `just test` pass and
  nothing references `/internal/assistant/ask`.

### [ ] AST-027 — Deploy the assistant

- **Spec** PRD §15
- **Files** `deploy/vm/{compose.yaml,compose.staging.yaml,deploy.sh}`,
  `.github/workflows/{vercel-staging.yml,vercel-production.yml,deploy-production.yml}`,
  `docker-compose.yml`, `.env.example`, `Justfile`
- **Depends on** AST-017
- **Approach** As `slack` is: image build and `/health` smoke, push, prune,
  `deploy.sh <env> assistant <image>` before `slack`, Compose service
  (`160m`, `--max-old-space-size=96`, `PEOPLE_URL`, `TIMEOFF_URL`). The VM job
  writes `assistant.env` from `ASSISTANT_ENV` and the four pair tokens to both
  sides each (`slack.env`, `people.env`, `timeoff.env`; identity's on Vercel).
  Local `just dev` and `just admin-dev` start it.
- **Done when** a staging deploy answers a Slack question that needs both
  modules.

### [ ] AST-028 — Questions keep the VM awake

- **Spec** PRD §10.4
- **Files** `deploy/vm/idle-stop.sh`, `docs/environments.md`
- **Depends on** AST-027
- **Approach** `idle-stop.sh` counts the assistant's per-question log lines in
  the window as activity, beside the router's `/graphql` lines.
- **Done when** a question within the window shows as activity in
  `journalctl -u kithena-idle-stop`.

### [ ] AST-029 — Docs

- **Spec** PRD §15.2, §15.3
- **Files** `docs/environments.md` (memory budget row and total, "The
  assistant's settings"), `docs/ai-settings.md` (Slack's questions now go
  through the assistant), `CLAUDE.md` (a decision bullet: the assistant is a
  platform service; capabilities in contracts; the model only plans), this file
- **Depends on** AST-027
- **Done when** `pnpm docs:brand-leak` passes and the memory table adds up.

### [ ] AST-029a — A company's choice to name private leave in chat

- **Spec** PRD §11.4
- **Files** `services/timeoff/src/{domain,application}/settings/*`, Time Off's
  settings screen and its operations, the `timeoff.away` capability's
  catalogue answer, `platform/assistant/src/domain/answer*`
- **Depends on** AST-023, AST-011
- **Approach** A tenant setting `chatNamesPrivateLeave` (default false) in
  Time Off, changed only by HR, recorded as a settings event with who, when
  and the new value. The settings screen shows it with the warning text from
  the PRD. Time Off returns it with its capability catalogue; the assistant's
  answer policy lifts the two private-leave rules only when it is true, after
  Time Off's sight rule has already been applied.
- **Done when** a test proves: off, a sick-leave filter answers with a count
  and a link; on, it names the people the asker may see as sick; on, an asker
  who may only see "Away" still gets "Away"; and the change appears in the
  audit trail.

---

## Phase 2 — more of Time Off, and follow-ups

### [ ] AST-030 — `timeoff.balances`

- **Spec** PRD §17, Phase 2
- **Files** `packages/contracts/src/assistant/timeoff.ts`,
  `services/timeoff/src/application/assist/capabilities.ts`,
  `platform/assistant/src/domain/answer.ts` (+ tests)
- **Depends on** AST-023
- **Approach** Balances as the asker may see them (their own, the people they
  approve, HR everyone), from the ledger fold, as decimal strings, never a
  float; filters on remaining days ("more than 10 left"). Output kind
  `people` with `detail` "12.5 days left".
- **Done when** "how much vacation do I have left?" and "who in my team has
  more than 10 days left?" are eval cases and end-to-end tests.

### [ ] AST-031 — `timeoff.pending`

- **Depends on** AST-022
- **Approach** Requests waiting for the asker's decision, output `items`.
- **Done when** tests show only the asker's queue, as T16 shows it.

### [ ] AST-032 — An answer over several item steps

- **Spec** PRD §17, Phase 2
- **Files** `packages/contracts/src/assistant/plan.ts`,
  `platform/assistant/src/domain/{plan.ts,answer.ts}` (+ tests, first)
- **Depends on** AST-030, AST-031
- **Approach** `Answer.one` may name several steps whose output is `items`;
  the answer lists each module's under its name. "What's waiting for me?"
  plans `people.approvals` and `timeoff.pending`.
- **Done when** the eval set gains the case and it passes.

### [ ] AST-033 — Follow-ups in a conversation

- **Spec** PRD §4, §17
- **Files** `platform/slack/src/service.ts`, `platform/assistant/src/application/ask.ts`
- **Depends on** AST-025
- **Approach** Slack keeps the last five questions per conversation (DM, or
  thread) in memory for 30 minutes and sends them as `earlier`; questions
  only, never answers, as People's `EARLIER`. No new Slack scope, no storage.
- **Done when** "who's off today?" then "and tomorrow?" plans `tomorrow`.

---

## Phase 3 — more channels

### [ ] AST-034 — Teams

- **Depends on** AST-017
- **Approach** `platform/teams` calling `/internal/ask` with
  `TEAMS_ASSISTANT_TOKEN`, named generically in the UI ("Chat apps").
- **Done when** a Teams question gets the same answer as the same question in
  Slack.

### [ ] AST-035 — The assistant behind the router

- **Spec** PRD §17, Phase 3
- **Files** `platform/assistant/src/graphql/*`, `apps/gateway/config.yaml`
- **Depends on** AST-017
- **Approach** An `assistant` subgraph (Pothos) with one query,
  `ask(question)`, composed into the supergraph. The router sets
  `x-kithena-principal` and `x-internal-token` for it as for People; the
  assistant forwards view-as and support sessions unchanged, so each module
  treats them as it does on its own screens.
- **Done when** `just supergraph` composes, and a view-as session gets People's
  answers read-only and Time Off's refusal in words.

### [ ] AST-036 — The web search box

- **Depends on** AST-035; designs in the Claude Design project
- **Approach** Built from Reach (`SearchField variant="prompt"`); blocked until
  the screens exist.

---

## Not in this plan

- Proposals (an action that comes back for the person to confirm): their own
  PRD.
- Naming people on private leave in chat: waits on the open question in PRD §20.
