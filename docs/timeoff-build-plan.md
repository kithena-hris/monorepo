# Time Off module — build plan

Every ticket needed to ship the Time Off module, in an order that works. Tick
each box as it lands.

**This file, in the repository, is the record of progress.** Change a box here,
in git, and nowhere else.

**Specs**

| What                         | Where                                                                                                             |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Requirements                 | [`docs/timeoff-prd.md`](./timeoff-prd.md)                                                                         |
| Screens, web                 | Claude Design project `6fed6ac8…`, page **Kithena Time Off**, `T1`–`T36`                                          |
| Screens, mobile              | Same project, page **Kithena Time Off Mobile**, `MT1`–`MT21`                                                      |
| Screen source on disk        | `.claude/design/timeoff/` (`to-core.js` recipes, `to-web.js`, `to-mobile.js`, `core.js` the Reach recipe library) |
| Repo rules                   | [`CLAUDE.md`](../CLAUDE.md)                                                                                       |
| Layer boundaries             | [`docs/code-structure.md`](./code-structure.md)                                                                   |
| The People plan this mirrors | [`docs/people-build-plan.md`](./people-build-plan.md)                                                             |
| Reach usage                  | `.claude/skills/reach-ui/SKILL.md`                                                                                |

---

## How to work a ticket

1. **Read the spec references first.** Every ticket names a PRD section and,
   where there is one, a screen id. They are the acceptance criteria; this file
   is only the order.
2. **Check `Depends on`.** If a dependency is unticked, stop and do that one.
3. **Domain work is test-first.** Anything under `src/domain/` gets its failing
   test before its implementation.
4. **`Done when` is a command, not a feeling.**
5. **Tick the box in this file in the same commit as the work.**

### How the work lands

The module is built on the long-lived branch **`time-off`**. Each lane below is
one pull request **into `time-off`**, squash-merged once CI is green. When every
lane has landed, `time-off` goes to `main` as one pull request, so production
deploys once.

| PR  | Lane                                                                                        | Tickets           |
| --- | ------------------------------------------------------------------------------------------- | ----------------- |
| 1   | `timeoff/docs` — this plan and the PRD                                                      | —                 |
| 2   | `timeoff/foundation` — unblock, contracts, domain                                           | TOF-001 – TOF-028 |
| 3   | `timeoff/service` — storage, application, transports, standalone                            | TOF-029 – TOF-050 |
| 4   | `timeoff/web-shell` — Reach additions, the second remote, navigation, the clock             | TOF-051 – TOF-060 |
| 5   | `timeoff/employee` — overview, request, my requests, balances, holidays                     | TOF-061 – TOF-067 |
| 6   | `timeoff/manager` — approvals, calendar, delegation                                         | TOF-068 – TOF-073 |
| 7   | `timeoff/attendance` — timesheet, corrections, team right now                               | TOF-074 – TOF-077 |
| 8   | `timeoff/settings` — leave types, policy, negative balance, attendance, approvals, holidays | TOF-078 – TOF-083 |
| 9   | `timeoff/assist` — Phase 2 AI                                                               | TOF-084 – TOF-092 |
| 10  | `timeoff/hr-ops` — exceptions, month close, insights, nudges, policy preview                | TOF-093 – TOF-099 |
| 11  | `timeoff/parental` — parental leave                                                         | TOF-100 – TOF-106 |
| 12  | `timeoff/reach` — kiosk, integrations, more country packs                                   | TOF-107 – TOF-114 |

PRs 5 to 8 can run in parallel once PR 4 is in. PRs 9 to 12 can run in parallel
once PRs 5 to 8 are in.

### Rules no ticket restates

- No cross-module imports. `dependsOn: []` stays empty.
- Zod is the single schema source. Never hand-write a derived artifact.
- Every contract field carries a classification policy or `just codegen` fails.
- `occurredAt` and `effectiveFrom` on every event. Corrections carry
  `supersedes`.
- Days and hours are `numeric`, never a float in application code
  (`decimal.js`). Calendar dates are `date`.
- No `new Date()` in domain code — inject `Clock`.
- Migrations are expand-contract. No down migrations.
- Screens are built from Reach. Missing something? Add it to Reach first, as a
  variant on the nearest component.
- Authorization is enforced in application, never only in a resolver.
- Every tab and view is its own URL; every filter is in the query string;
  navigation is client-side with exact-shape skeletons.
- **The domain computes every number. AI only reads, ranks and writes**
  (PRD §14.1).

### Tracks

```
  A  contracts ──▶ domain ──▶ application ──▶ infrastructure ──▶ transports
  B  migrations and storage             (from TOF-029, needs A's contracts)
  C  Reach additions and the web shell  (from TOF-051, needs the GraphQL schema)
  D  screens                            (from TOF-061, needs B and C)
```

Phase 1 is done when every box down to TOF-083 is ticked and
`just standalone timeoff` is green in CI.

---

## Phase 0 — unblock

### [ ] TOF-001 — `svc_timeoff` hardened and the schema bootstrap

**Goal** `svc_timeoff` exists in `init-db.sql` without `NOBYPASSRLS`, unlike
`svc_people`, and there is no `timeoff` migration at all.

- **Spec** PRD §17
- **Files** `migrations/<ts>_timeoff_bootstrap.sql`, `tools/scripts/init-db.sql`
- **Depends on** nothing
- **Approach** Copy `PEO-003`: `CREATE SCHEMA IF NOT EXISTS timeoff`, create
  `svc_timeoff NOBYPASSRLS` if absent the way the People bootstrap does, grant
  usage. Fix the role in `init-db.sql`. Rehash `atlas.sum`.
- **Done when** `pnpm db:migrate` applies clean twice and an integration test
  proves a `svc_timeoff` connection without `app.tenant_id` sees nothing.

### [ ] TOF-002 — Outbox and Debezium

- **Spec** PRD §17
- **Files** `migrations/<ts>_timeoff_outbox.sql`, `docker-compose.yml`,
  `services/timeoff/src/infrastructure/tables.ts`
- **Depends on** TOF-001
- **Approach** `outboxTable('timeoff')` exactly as People's
  `20260927230100_people_outbox_relay.sql`; add `timeoff.outbox` to the
  Debezium table list.
- **Done when** an integration test writes an event through `publish()` and
  reads it from `timeoff.outbox`.

### [ ] TOF-003 — Boot like People

**Goal** `src/main.ts` is a bare yoga server on a hardcoded port.

- **Spec** PRD §18
- **Files** `services/timeoff/src/main.ts`, `services/timeoff/src/http/server.ts`
- **Depends on** nothing
- **Approach** Mirror `services/people/src/main.ts`: `startTelemetry`,
  `TIMEOFF_PORT` (default 4002), one `node:http` server carrying yoga and the
  REST router, `onShutdown` drain. Empty `wireConsumers()` and
  `wireBackground()` for later tickets.
- **Done when** `pnpm --filter @kithena/timeoff dev` serves `/graphql` and
  `/healthz`, and the standalone boot test still passes.

### [ ] TOF-004 — Dockerfile and deploy

- **Files** `services/timeoff/Dockerfile`, `deploy/vm/deploy.sh`
- **Depends on** TOF-003
- **Approach** Copy People's Dockerfile, including the runtime `graphql`
  dependency fix from #208.
- **Done when** `docker build -f services/timeoff/Dockerfile .` succeeds and the
  image answers `/healthz`.

### [ ] TOF-005 — Codegen sees Time Off's new events

- **Files** `tools/codegen/src/cli.ts`
- **Depends on** nothing
- **Approach** `timeoffEvents` is already concatenated; confirm, and make the
  new arrays in TOF-006 land in the same list so redaction paths, JSON Schema
  and the DSAR manifest include them.
- **Done when** `just codegen` passes and the generated redaction paths contain
  a Time Off path.

---

## Phase 1 — boots alone, does the job

### Contracts

### [ ] TOF-006 — Primitives

- **Spec** PRD §6.1, §7.1
- **Files** `packages/contracts/src/timeoff/primitives.ts`
- **Depends on** nothing
- **Approach** `LeaveTypeKey` (branded slug, immutable), `DayAmount` and
  `HourAmount` as decimal strings with three places (never a JS float in
  transport), `TeamKey`, `LocationKey`, `WorkModel` (`office`, `remote`,
  `client`), `PunchKind`, `PunchSource`, `LeaveCategory` mapping to the
  existing `AbsenceKind`. Register a policy on every field.
- **Done when** `just codegen` passes and tests refuse a float, a negative
  zero and a key with a hyphen.

### [ ] TOF-007 — Leave type and policy contracts

- **Spec** PRD §6.1, §6.2, §7.4
- **Files** `packages/contracts/src/timeoff/policy.ts`
- **Depends on** TOF-006
- **Approach** `LeaveTypeDefinition`, `PolicyDefinition` (allowance with
  tenure bands, year start, earning `upfront|monthly`, pro-rata, keep earning
  on parental, probation, carry-over cap and use-by, request rules, negative
  balance rules, `appliesTo` as a closed predicate grammar like People's
  requiredness). No user-authored expressions.
- **Done when** tests prove an unknown predicate operand is refused at parse
  time and a negative-balance limit cannot be negative.

### [ ] TOF-008 — Request, ledger and attendance contracts

- **Spec** PRD §7.1, §8.1, §11.2
- **Files** `packages/contracts/src/timeoff/request.ts`, `ledger.ts`,
  `attendance.ts`
- **Depends on** TOF-006
- **Approach** Request input and view shapes, `LedgerEntryKind`, punch input.
  The sick note is `asSpecialCategory('health')` and never appears in a view
  shape for anyone but the member and HR.
- **Done when** a type-level test asserts the teammate view of a sick request
  has no `typeKey` and no `note`.

### [ ] TOF-009 — Events

- **Spec** PRD §13
- **Files** `packages/contracts/src/events/timeoff.ts`,
  `services/timeoff/module.manifest.ts`
- **Depends on** TOF-006
- **Approach** `LeaveRequested` v2 with `leaveTypeKey`, half days and
  `workingDays`, plus an upcaster from v1; add `counter_proposed`, `changed`,
  `cancelled`, `balance.adjusted`, `policy.published`, `attendance.punched`,
  `attendance.corrected`, `period.closed`, `parental.plan_submitted`,
  `parental.plan_approved`. A punch event has no coordinate field. Update the
  manifest's `publishes`.
- **Done when** `just codegen` passes, the manifest contract test is green, and
  a contract test proves no Time Off payload can hold a latitude, a longitude
  or a sick note body.

### Domain

Test-first, all of it. No drivers, no I/O.

### [ ] TOF-010 — Working days and days away

- **Spec** PRD §7.3
- **Files** `services/timeoff/src/domain/calendar/working-days.ts`
- **Depends on** TOF-006
- **Approach** Pure functions over a work pattern (weekdays, hours per day), a
  holiday set and half-day flags. `daysAway` extends across adjacent
  non-working days. Use the design's numbers as fixtures: 13–16 Oct 2026 with
  12 Oct a holiday costs 4 and is 9 days away.
- **Done when** fixtures from T3, T4 and MT6 pass, and property tests prove
  `workingDays ≤ daysAway`.

### [ ] TOF-011 — Layered holiday calendars

- **Spec** PRD §10.2
- **Files** `services/timeoff/src/domain/calendar/holiday-calendar.ts`
- **Depends on** TOF-010
- **Approach** National + regional + city layers resolve to a set of dates for
  a location and year; weekend rule (`move_to_monday | none`) per layer.
- **Done when** Madrid 2026 resolves to the eleven dates in T36 plus San Isidro
  and La Almudena, and Barcelona does not get either.

### [ ] TOF-012 — Leave type aggregate

- **Spec** PRD §6.1
- **Files** `services/timeoff/src/domain/policy/leave-type.ts`
- **Depends on** TOF-007
- **Approach** Invariants: key immutable; a statutory type can be hidden, never
  deleted; sick and parental default to `off_only` visibility and cannot be
  loosened to show the reason to teammates.
- **Done when** every invariant has a failing-first test.

### [ ] TOF-013 — Policy, versions and the entitlement fold

- **Spec** PRD §6.2, §6.3, §7.1
- **Files** `services/timeoff/src/domain/policy/policy.ts`,
  `services/timeoff/src/domain/balance/entitlement.ts`
- **Depends on** TOF-012
- **Approach** A policy version produces the grant, accrual, carry-over and
  expiry entries for a member and year, given hire and termination dates and
  tenure. Pro-rata rounds up to the half day. Published versions are immutable.
- **Done when** a joiner on 1 Jul gets 12.5 of 25, monthly earning credits
  2.08 on the 1st with the year summing to exactly 25, and a 3-year
  anniversary moves to 26 from the band boundary.

### [ ] TOF-014 — The ledger and the balance fold

- **Spec** PRD §7.1, §7.2
- **Files** `services/timeoff/src/domain/balance/ledger.ts`
- **Depends on** TOF-013
- **Approach** Append-only entries with `effectiveOn`, `supersedes`; `balanceOn(date)`
  returns left, used, booked and allowance. A correction never edits an entry.
- **Done when** MT20's ledger folds to 11.5 left with 10.5 used and 3 booked,
  and a superseded entry is excluded exactly once.

### [ ] TOF-015 — Negative balance

- **Spec** PRD §7.4
- **Files** `services/timeoff/src/domain/balance/negative.ts`
- **Depends on** TOF-014
- **Approach** Given a policy and a requested cost, return `fits`,
  `borrow { days, nextYearStartsAt, approvers }`, `refused { limit }`, plus the
  alternatives (unpaid N days, shorten to dates that fit).
- **Done when** T5's numbers come out: 6.5 left, 8 requested, borrow 1.5,
  2027 starts at 23.5, approvers manager then HR; and 10 requested is refused
  at a limit of 3.

### [ ] TOF-016 — The request aggregate, rewritten

**Goal** The existing `LeaveRequest` refuses anything over the balance and has
no decline, cancel or change.

- **Spec** PRD §8.1, §8.4, §8.5
- **Files** `services/timeoff/src/domain/request/leave-request.ts` (moved from
  `src/domain/leave-request.ts`)
- **Depends on** TOF-015
- **Approach** The full state machine of PRD §8.1. `request` takes the
  negative-balance verdict instead of refusing; `decline`, `withdraw`,
  `counterPropose`, `acceptCounter`, `requestChange` (old dates stay booked),
  `shorten` and `cancel` (auto-approved), `markTaken`. Each raises its event
  and returns the ledger entries it implies.
- **Done when** every transition and every refused transition has a test, and
  the old `INSUFFICIENT_BALANCE` test is replaced by a borrow test.

### [ ] TOF-017 — Sick leave

- **Spec** PRD §8.5
- **Files** `services/timeoff/src/domain/request/sick.ts`
- **Depends on** TOF-016
- **Approach** Recorded, not requested; auto-approved under the threshold; a
  note required after N days; the note never leaves the aggregate except as
  `notePresent`.
- **Done when** a 2-day sick record is approved on creation and a 4-day one
  asks for a note.

### [ ] TOF-018 — Team minimums and coverage

- **Spec** PRD §9.3
- **Files** `services/timeoff/src/domain/coverage/coverage.ts`
- **Depends on** TOF-010
- **Approach** Coverage per day from team members, approved and pending
  absences and holidays; minimum as count or percentage; returns the days below.
- **Done when** T13's October fixture gives 4 of 7 on the 21st and nothing
  else below 5.

### [ ] TOF-019 — Approval rules and routing

- **Spec** PRD §9.1
- **Files** `services/timeoff/src/domain/approval/approval-rule.ts`
- **Depends on** TOF-016
- **Approach** A rule resolves to an ordered list of approver roles for a
  request; auto-approval conditions; a member without a manager falls through
  to HR.
- **Done when** T34's five rules resolve as drawn and a shorten resolves to no
  approver.

### [ ] TOF-020 — Delegation and escalation

- **Spec** PRD §9.7
- **Files** `services/timeoff/src/domain/approval/delegation.ts`
- **Depends on** TOF-019
- **Approach** A delegate for a range or automatically during the approver's
  approved time off; salary-related requests excluded unless allowed; escalation
  after N working days to the approver's manager.
- **Done when** Marco away 13–16 Oct routes Adam's request to Omar, and a
  request untouched for 3 working days escalates.

### [ ] TOF-021 — Queue grouping

- **Spec** PRD §9.2
- **Files** `services/timeoff/src/domain/approval/triage.ts`
- **Depends on** TOF-015, TOF-018
- **Approach** Deterministic: clear when within balance, coverage holds,
  sick under threshold, comp within banked hours; otherwise look closer with
  the first failing rule as a typed reason.
- **Done when** T16's five requests split 3 and 2 with the reasons drawn.

### [ ] TOF-022 — Clash fixes and counter-proposals

- **Spec** PRD §9.5, §9.6
- **Files** `services/timeoff/src/domain/approval/alternatives.ts`
- **Depends on** TOF-018, TOF-010
- **Approach** Generate: swap the clash day for the next working day; the next
  clean week; approve as asked. Rank requester-only first, then no change, then
  changes to someone else's approved time.
- **Done when** T15 and T18 produce "19, 20, 22, 23 and 26 Oct" first.

### [ ] TOF-023 — Punches and the clock

- **Spec** PRD §11.1, §11.2
- **Files** `services/timeoff/src/domain/attendance/clock.ts`
- **Depends on** TOF-008
- **Approach** State from punches (`out`, `in`, `on_break`); refuse impossible
  transitions; one clock regardless of source; a correction supersedes.
- **Done when** a punch from the kiosk followed by one from the web reads as one
  continuous day.

### [ ] TOF-024 — The working day and overtime

- **Spec** PRD §11.3, §11.5
- **Files** `services/timeoff/src/domain/attendance/day.ts`
- **Depends on** TOF-023
- **Approach** Segments (worked, break, overtime, missing, planned) for a day
  against a schedule; break and rest rules; weekly maximum; overtime to comp,
  paid or chosen.
- **Done when** T20's week computes 7h 58m, 9h 05m with +1h 05m, a missing
  Wednesday and 3h 41m live.

### [ ] TOF-025 — Missed punches and corrections

- **Spec** PRD §11.4
- **Files** `services/timeoff/src/domain/attendance/correction.ts`
- **Depends on** TOF-024
- **Approach** Detect an open day the next morning; a correction is a new punch
  with `supersedes`; corrections after 24 hours flag for the manager.
- **Done when** Wednesday's missing out is detected on Thursday and a
  correction at 18:05 yields 9h 18m with 1h 18m overtime.

### [ ] TOF-026 — Schedules

- **Spec** PRD §11.5
- **Files** `services/timeoff/src/domain/attendance/schedule.ts`
- **Depends on** TOF-024
- **Approach** Fixed, flexible with core hours, seasonal, rotating.
- **Done when** "Summer hours" Jul–Aug plans 35h and Madrid office plans 40h.

### [ ] TOF-027 — Pay period

- **Spec** PRD §11.8
- **Files** `services/timeoff/src/domain/attendance/pay-period.ts`
- **Depends on** TOF-024, TOF-014
- **Approach** Totals per member and team; closing locks; a later correction
  lands in the next open period with `supersedes`.
- **Done when** closing September refuses a correction dated September and
  posts it to October.

### [ ] TOF-028 — Spain country pack

- **Spec** PRD §12.3
- **Files** `services/timeoff/src/country-packs/es.ts`
- **Depends on** TOF-012, TOF-011
- **Approach** Statutory leave types, national holidays 2026–2027, 12-hour rest,
  4-year attendance retention, the parental entitlement table (used in Phase 3).
  Mark the pack `reviewed: false` until legal signs off.
- **Done when** a new Spanish tenant gets the statutory types and the national
  layer, and the pack's `reviewed` flag is surfaced in settings.

### Storage

### [ ] TOF-029 — Member projection table

- **Spec** PRD §5.2, §17
- **Files** `migrations/<ts>_timeoff_member.sql`,
  `services/timeoff/src/infrastructure/tables.ts`
- **Depends on** TOF-001
- **Approach** RLS as in TOF-001; `last_event_id` and `last_effective_from` for
  idempotent, ordered application.
- **Done when** an integration test applies the same event twice and sees one row.

### [ ] TOF-030 — Policy, leave type and ledger tables

- **Files** `migrations/<ts>_timeoff_policy_ledger.sql`
- **Depends on** TOF-029
- **Approach** `numeric(9,3)` amounts, `effective_on date`, ledger insert-only
  (`REVOKE UPDATE, DELETE` from `svc_timeoff`).
- **Done when** an integration test proves `svc_timeoff` cannot update or delete
  a ledger row.

### [ ] TOF-031 — Requests with the overlap constraint

- **Files** `migrations/<ts>_timeoff_request.sql`
- **Depends on** TOF-030
- **Approach** `daterange` and a `btree_gist` exclusion constraint over live
  states per member.
- **Done when** two concurrent inserts of overlapping live requests leave
  exactly one, in an integration test.

### [ ] TOF-032 — Approval, delegation, minimum and holiday tables

- **Files** `migrations/<ts>_timeoff_approval_holiday.sql`
- **Depends on** TOF-030
- **Done when** migrations apply clean twice.

### [ ] TOF-033 — Attendance tables

- **Files** `migrations/<ts>_timeoff_attendance.sql`
- **Depends on** TOF-030
- **Approach** `punch` insert-only, `schedule`, `pay_period`, `pay_period_line`;
  no coordinate column anywhere.
- **Done when** an integration test asserts the `punch` column list.

### [ ] TOF-034 — Drizzle repositories and the unit of work

- **Files** `services/timeoff/src/infrastructure/drizzle-*.ts`,
  `unit-of-work.ts`
- **Depends on** TOF-029 – TOF-033
- **Approach** Same pattern as People: `tenantTransaction`, aggregates save and
  publish their events to the outbox in one transaction.
- **Done when** integration tests round-trip every aggregate and see its events
  in the outbox.

### Application

### [ ] TOF-035 — Member sync

- **Spec** PRD §5.2
- **Files** `services/timeoff/src/application/member/`
- **Depends on** TOF-034
- **Approach** Commands `upsertMember`, `endMember`, translated from People
  events (TOF-045) or from an import (TOF-036). Hire grants the year's
  entitlement; termination settles a negative balance per policy.
- **Done when** a hire produces a member and a grant entry.

### [ ] TOF-036 — Member import when People is absent

- **Files** `services/timeoff/src/application/member/import.ts`
- **Depends on** TOF-035
- **Approach** CSV and JSON, dry run first, the same columns as PRD §5.2.
- **Done when** the standalone suite imports seven members with People absent.

### [ ] TOF-037 — Requesting, changing and cancelling

- **Files** `services/timeoff/src/application/request/`
- **Depends on** TOF-016, TOF-034
- **Approach** Loads policy, ledger, holidays and coverage; calls the aggregate;
  saves and publishes. Returns the preview (working days, days away, balance
  after, coverage warnings, negative verdict) without saving for the panel.
- **Done when** an application test sends, changes and cancels with in-memory
  ports.

### [ ] TOF-038 — Deciding, counter-proposing and batch approval

- **Files** `services/timeoff/src/application/approval/`
- **Depends on** TOF-019, TOF-021, TOF-037
- **Approach** OpenFGA check for `approver` or `delegate` on the member, then the
  aggregate. Batch approves only requests whose triage is `clear`.
- **Done when** a test proves batch refuses a look-closer request and a
  non-approver is refused in the application layer.

### [ ] TOF-039 — Delegation and escalation workflow

- **Files** `services/timeoff/src/application/approval/escalation.ts`,
  `services/timeoff/src/infrastructure/temporal/`
- **Depends on** TOF-020, TOF-038
- **Approach** One Temporal workflow per pending request; reminder at 09:00;
  escalation after 3 working days.
- **Done when** a Temporal test-environment test escalates with a skipped clock.

### [ ] TOF-040 — Calendar queries

- **Files** `services/timeoff/src/application/calendar/`
- **Depends on** TOF-018, TOF-034
- **Approach** Month, timeline and year views for team, company and me, with
  visibility applied (teammates see "Off" for sick); the day detail; the
  iCalendar feed with a signed, revocable token.
- **Done when** a test proves a teammate's view of a sick day has no type.

### [ ] TOF-041 — Holidays and policies admin

- **Files** `services/timeoff/src/application/admin/`
- **Depends on** TOF-013, TOF-011, TOF-034
- **Approach** CRUD for leave types, policies (draft, publish with re-fold),
  holiday calendars, approval rules, team minimums, negative balance rules,
  attendance rules. `hr_admin` only.
- **Done when** publishing a policy re-folds affected balances and emits
  `policy.published`.

### [ ] TOF-042 — The clock and the timesheet

- **Files** `services/timeoff/src/application/attendance/`
- **Depends on** TOF-023 – TOF-026, TOF-034
- **Approach** Punch, break, clock out, correct; my timesheet by week or month;
  team right now (manager); overtime approval.
- **Done when** an application test runs a full day and a correction.

### [ ] TOF-043 — Nightly and morning jobs

- **Files** `services/timeoff/src/infrastructure/background.ts`
- **Depends on** TOF-013, TOF-025
- **Approach** BullMQ: monthly accrual on the 1st, carry-over and expiry at year
  end and on use-by dates, warnings on 1 Oct and 1 Dec, `markTaken` after the
  last day, the morning missed-punch check, the 20:00 reminder.
- **Done when** a test with a fixed clock posts the October accrual once even if
  run twice.

### Transports

### [ ] TOF-044 — The subgraph

- **Spec** PRD §18
- **Files** `services/timeoff/src/graphql/`, `services/timeoff/schemas/timeoff.graphql`
- **Depends on** TOF-037 – TOF-042
- **Approach** Pothos, thin, mapping domain failures to GraphQL errors. Queries
  for every screen in Phase 1 (one query per screen, named for it, as People's
  `screens` do); mutations for every command. Extend `Person` with balances.
  Regenerate SDL with `just codegen`; `just supergraph` must compose.
- **Done when** `just supergraph` composes and the schema snapshot test passes.

### [ ] TOF-045 — People event consumers

- **Files** `services/timeoff/src/infrastructure/consumers/`
- **Depends on** TOF-035
- **Approach** `people.person.hired`, `terminated`, `manager_changed`,
  `org_changed`, `profile_updated`, `status_changed`, `synced_from_external`,
  and `people.location.*` into member commands. Idempotent by event id, ordered
  by `effectiveFrom`. Update the manifest's `consumes`.
- **Done when** a consumer test applies out-of-order events and ends in the right
  state.

### [ ] TOF-046 — REST and OpenAPI

- **Files** `services/timeoff/src/http/rest.ts`, `openapi.ts`
- **Depends on** TOF-044
- **Approach** `/v1/timeoff/...` generated from Zod; idempotency keys as People.
- **Done when** the OpenAPI document validates and a REST test sends a request.

### [ ] TOF-047 — Webhooks

- **Files** `services/timeoff/src/infrastructure/webhooks/`
- **Depends on** TOF-046
- **Approach** Signed, per published event, reusing People's signer.
- **Done when** a test verifies a signature.

### [ ] TOF-048 — OpenFGA model

- **Files** the FGA model file People uses, `services/timeoff/src/infrastructure/openfga.ts`
- **Depends on** TOF-038
- **Approach** `approver`, `delegate`, `hr_admin`, `teammate` on a member.
- **Done when** model tests cover manager, delegate during range only, HR, and a
  teammate who may see "Off" but not the type.

### [ ] TOF-049 — Seed for the demo company

- **Files** `services/timeoff/src/seed/`, `docs/demo-company.md`
- **Depends on** TOF-044
- **Approach** Acme's Platform team, Adam, Marco, Ada and the design's October
  2026 data, so screens match the design on `just dev`.
- **Done when** `just dev` shows T1 with 11.5 days left for Adam.

### [ ] TOF-050 — Standalone acceptance

- **Spec** PRD §3 Validation
- **Files** `services/timeoff/src/standalone/acceptance.standalone.test.ts`
- **Depends on** TOF-036 – TOF-047
- **Approach** Drive the REST handler and yoga schema over in-memory ports, no
  Postgres, no Kafka, People aliased to the absent sibling: import members,
  request, approve, borrow within the limit, clash warning, clock a day,
  correct it, close the month.
- **Done when** `just standalone timeoff` is green with and without the AI keys.

### Web shell and Reach

### [ ] TOF-051 — Reach: balance meter

- **Spec** PRD §15.3
- **Files** `packages/ui/src/components/progress/`
- **Depends on** nothing
- **Approach** `Progress` gains `segments` with a `pattern="hatched"` option.
  Story with used and booked.
- **Done when** `just test-stories` is green.

### [ ] TOF-052 — Reach: day bar

- **Files** `packages/ui/src/components/chart/`
- **Depends on** nothing
- **Approach** A `RangeBar` in the chart family (or `TimelineChart variant="day"`):
  a fixed axis, segments with tones and patterns, a now marker, an axis that can
  be hidden. Hand-drawn SVG, per the charts decision.
- **Done when** stories for T20's five days pass axe.

### [ ] TOF-053 — Reach: calendar markers

- **Files** `packages/ui/src/components/calendar/`
- **Depends on** nothing
- **Approach** `Calendar` gains per-day `markers` (dots), a highlighted `range`,
  `today`, struck-through days and an error tone per day.
- **Done when** a story reproduces MT6.

### [ ] TOF-054 — Reach: rows scheduler and month grid

- **Files** `packages/ui/src/components/scheduler/`
- **Depends on** nothing
- **Approach** `Scheduler variant="rows"` (people × days with bars, shaded
  weekends and holidays, highlighted row, clash columns, a summary row) and
  `view="month"` (chips per day, "+N more", selected and clash cells).
- **Done when** stories reproduce T12 and T13 and pass axe.

### [ ] TOF-055 — Reach: small variants

- **Files** `packages/ui/src/components/{card,badge,stat,slider}/`
- **Depends on** nothing
- **Approach** `Card tone="assistant"` (gradient border), `Badge pulse`,
  `Stat from` (before → after), `Slider variant="confirm"` (slide to confirm,
  keyboard operable).
- **Done when** each has a story and `just test-stories` is green.

### [x] TOF-056 — The shell loads a second remote

**Goal** The shell's remote loading, screen loading, persisted operations and
SSR signing are written for People only (`PEOPLE_REMOTE_URL`,
`people-screens.ts`, `people-operations.ts`).

- **Files** `apps/web/src/lib/remotes.ts`, `people-screens.ts`, `people.ts`,
  `remote-code.ts`, `apps/gateway/persisted/`
- **Depends on** nothing
- **Approach** Generalise by area: a map of area to remote URL and public key
  (`TIMEOFF_REMOTE_URL`, `TIMEOFF_REMOTE_SSR_PUBLIC_KEY`), screens and operations
  per area. People keeps working unchanged.
- **Done when** People's tests pass and a test resolves a `/time-off` path to
  the Time Off remote.

### [x] TOF-057 — The Time Off remote

- **Files** `apps/web/timeoff/` (new, mirroring `apps/web/people`)
- **Depends on** TOF-056
- **Approach** Vite + Module Federation, `routes.json` with sections, tabs,
  actions and settings per PRD §15.2, a frame with the page header and the
  sub-navigation, the load and held patterns from People. Port 3003.
- **Done when** `/time-off/overview` renders a placeholder screen through the
  shell, client and server side.

### [x] TOF-058 — Navigation turns on

- **Files** `apps/web/src/components/app-shell.tsx`, `lib/shortcuts.ts`
- **Depends on** TOF-057
- **Approach** `built: true` for Time off; the five sub-items with counts from
  the remote's nav; the Settings group; the phone tab bar gains Time off
  between Home and People; "My time off" in the account menu.
- **Done when** a shell test sees the sub-items for an employee without
  Insights, and for HR with it.

### [ ] TOF-059 — The clock in the top bar

- **Spec** PRD §11.1 · T2
- **Files** `apps/web/timeoff/src/clock/`, `apps/web/src/components/app-shell.tsx`
- **Depends on** TOF-057, TOF-042, TOF-052
- **Approach** The remote exposes a `TopBarClock` slot the shell renders on every
  page when the tenant has `module.timeoff`. The pill ticks every second without
  re-rendering the page; the popover shows the day bar, punches, working on,
  Start break and Clock out; `⌥T` toggles. Popover motion uses
  `popover-motion`.
- **Done when** a test punches in from the pill on a People page and sees the
  timer, and the shell renders without the slot when the module is off.

### [ ] TOF-060 — Persisted operations for Time Off

- **Files** `apps/web/src/lib/timeoff-operations.ts`, `apps/gateway/persisted/`
- **Depends on** TOF-044, TOF-056
- **Approach** One operation per screen, generated into the safelist with
  `pnpm --filter @kithena/gateway persist`. Writes go through server actions.
- **Done when** the router accepts every Time Off operation and refuses an
  unlisted one.

### Screens — employee

Each screen ticket builds the web screen and its phone layout in the same
component, at the same URL, and is done when its stories pass axe, its screen
test passes, and it matches the design's screen on the seeded demo company.

### [ ] TOF-061 — Overview

- **Screens** T1, MT1 · **Spec** PRD §7.2, §15
- **Depends on** TOF-058, TOF-059
- **Approach** Clock card, balance cards, coming up, team today. The AI card
  shows deterministic bridge days with templated text until TOF-085.

### [ ] TOF-062 — Request time off

- **Screens** T3, MT5, MT6, MT7 · **Spec** PRD §8.2
- **Depends on** TOF-061, TOF-053
- **Approach** Web: a side panel over the overview at `/time-off/request`.
  Phone: type sheet, date step with the bottom bar, review step. The preview
  comes from the server on every change.

### [ ] TOF-063 — Going below zero

- **Screens** T5, MT9 · **Spec** PRD §7.4
- **Depends on** TOF-062

### [ ] TOF-064 — My requests and the timeline

- **Screens** T6, MT10 · **Spec** PRD §8.3
- **Depends on** TOF-062
- **Approach** Tabs Upcoming, Past, Cancelled as routes; the timeline shows
  integration steps only when integrations are connected (Phase 3).

### [ ] TOF-065 — Change or cancel

- **Screens** T7 · **Spec** PRD §8.4
- **Depends on** TOF-064

### [ ] TOF-066 — Where the days went

- **Screens** MT20 (and a web equivalent from the balance card) · **Spec** PRD §7.1
- **Depends on** TOF-061

### [ ] TOF-067 — Holidays where you work

- **Screens** MT21 · **Spec** PRD §10.2
- **Depends on** TOF-061
- **Approach** "Add to my calendar" uses the iCalendar feed.

### Screens — manager

### [ ] TOF-068 — Approvals queue

- **Screens** T16, MT15 · **Spec** PRD §9.2
- **Depends on** TOF-058, TOF-038
- **Approach** Reasons are templated from the triage reason until TOF-086.

### [ ] TOF-069 — Deciding one request

- **Screens** T17, MT16 · **Spec** PRD §9.4
- **Depends on** TOF-068, TOF-054

### [ ] TOF-070 — Suggesting other dates

- **Screens** T18 · **Spec** PRD §9.5
- **Depends on** TOF-069
- **Approach** Options from TOF-022; templated message until TOF-088. The
  employee's accept is one tap on their request (TOF-064).

### [ ] TOF-071 — Delegation

- **Screens** T19 · **Spec** PRD §9.7
- **Depends on** TOF-068

### [ ] TOF-072 — Team calendar

- **Screens** T12, T13, T14, MT13, MT14 · **Spec** PRD §10.1
- **Depends on** TOF-054, TOF-040
- **Approach** Month, timeline and year as routes; team, types and holiday
  filters in the query string; Subscribe gives the feed URL.

### [ ] TOF-073 — A clash, and how to solve it

- **Screens** T15 · **Spec** PRD §9.6
- **Depends on** TOF-072, TOF-022

### Screens — attendance

### [ ] TOF-074 — My timesheet

- **Screens** T20, MT17 · **Spec** PRD §11.3
- **Depends on** TOF-052, TOF-042

### [ ] TOF-075 — Fixing a missed clock-out

- **Screens** T21, MT18 · **Spec** PRD §11.4
- **Depends on** TOF-074
- **Approach** Without TOF-089 the dialog asks for a time with no suggestion.

### [ ] TOF-076 — Clocking in and out on a phone

- **Screens** MT3, MT4 · **Spec** PRD §11.2, §16
- **Depends on** TOF-055, TOF-074
- **Approach** Slide to clock in; the one-time location check suggests Office
  and stores nothing; clock-out sheet shows the day. MT4's project split is a
  free-text "working on" until Projects exists.

### [ ] TOF-077 — Team, right now

- **Screens** T22, MT19 · **Spec** PRD §11.6
- **Depends on** TOF-074

### Screens — settings

### [ ] TOF-078 — Leave types

- **Screens** T29 · **Spec** PRD §6.1
- **Depends on** TOF-041, TOF-058

### [ ] TOF-079 — Editing a policy

- **Screens** T30 · **Spec** PRD §6.2, §6.3
- **Depends on** TOF-078
- **Approach** The change preview is computed (TOF-093 adds shadow runs).

### [ ] TOF-080 — Negative balance rules

- **Screens** T31 · **Spec** PRD §7.4
- **Depends on** TOF-078

### [ ] TOF-081 — Attendance rules

- **Screens** T33 · **Spec** PRD §11.5
- **Depends on** TOF-078

### [ ] TOF-082 — Approval rules and team minimums

- **Screens** T34 · **Spec** PRD §9.1, §9.3
- **Depends on** TOF-078

### [ ] TOF-083 — Holiday calendars

- **Screens** T36 (without the AI draft) · **Spec** PRD §10.2
- **Depends on** TOF-078

---

## Phase 2 — HR operations and assistance

### Assistance

### [ ] TOF-084 — AI ports and the gateway

- **Spec** PRD §14.1
- **Files** `services/timeoff/src/application/assist/`,
  `services/timeoff/src/infrastructure/assist/`
- **Depends on** TOF-050
- **Approach** Two ports: `Judge` (TypeSafe System One, as People's advisor) and
  `Writer` (the assistant model). Both through `aiGateway`; both return
  nothing on failure; template fallbacks for every caller.
- **Done when** the standalone suite is green with the keys unset and with them
  set and `fetch` mocked.

### [ ] TOF-085 — Bridge days

- **Screens** T1, MT1 AI card · **Depends on** TOF-084, TOF-061

### [ ] TOF-086 — Reasons in the approvals queue

- **Screens** T16, MT15 · **Depends on** TOF-084, TOF-068

### [ ] TOF-087 — What to know

- **Screens** T17, MT16 · **Depends on** TOF-084, TOF-069

### [ ] TOF-088 — Counter-proposal message and clash explanation

- **Screens** T15, T18 · **Depends on** TOF-084, TOF-070, TOF-073

### [ ] TOF-089 — Missed clock-out suggestion

- **Screens** T21, MT18 · **Depends on** TOF-084, TOF-075
- **Approach** Evidence is only calendar event end times (when a calendar is
  connected) and Kithena activity timestamps. Shown with the evidence.

### [ ] TOF-090 — Describe it, get the best dates

- **Screens** T4, MT8 · **Spec** PRD §14.2
- **Depends on** TOF-084, TOF-062
- **Approach** The sentence becomes editable chips (Judge); the domain generates
  and scores date options; the Writer writes each option's line.

### [ ] TOF-091 — Today in a sentence

- **Screens** T22 · **Depends on** TOF-084, TOF-077

### [ ] TOF-092 — Plan explanation

- **Screens** T9, T11, MT11 · **Depends on** TOF-084, TOF-101

### HR operations

### [ ] TOF-093 — Policy preview, preview as a person, shadow runs

- **Screens** T30 · **Spec** PRD §6.3
- **Depends on** TOF-079

### [ ] TOF-094 — Write a policy in plain words

- **Screens** T32 · **Spec** PRD §6.4
- **Depends on** TOF-084, TOF-093

### [ ] TOF-095 — Exceptions for HR and the inspector export

- **Screens** T23 · **Spec** PRD §11.7
- **Depends on** TOF-042

### [ ] TOF-096 — Close the month for Payroll

- **Screens** T24 · **Spec** PRD §11.8
- **Depends on** TOF-027, TOF-095
- **Approach** Publishes `timeoff.period.closed` with hours and amounts, never
  punch times or locations.

### [ ] TOF-097 — Insights

- **Screens** T27 · **Spec** PRD §14.2
- **Depends on** TOF-084
- **Approach** Tabs What changed, Time off, Attendance, Balances as routes;
  every point links to the people behind it; small groups hidden as People's
  cohort minimum.

### [ ] TOF-098 — Nudges

- **Screens** T28 · **Depends on** TOF-097
- **Approach** Each message carries only its recipient's data; sent through
  `platform/messaging`.

### [ ] TOF-099 — Overtime approvals for managers

- **Screens** T22 "Needs you", attendance Requests tab · **Depends on** TOF-077

---

## Phase 3 — planning and reach

### Parental leave

### [ ] TOF-100 — Parental entitlement (domain)

- **Spec** PRD §12.1, §12.3 · **Files** `services/timeoff/src/domain/parental/`
- **Depends on** TOF-028
- **Done when** Adam's answers give 6 + 11 + 2 weeks and Acme's 2 weeks.

### [ ] TOF-101 — The plan and its validation (domain)

- **Spec** PRD §12.2 · **Depends on** TOF-100
- **Done when** a block of 10 days is refused (whole weeks), a flexible block
  past the deadline is refused, and notice reminders fall 15 days before each
  flexible block.

### [ ] TOF-102 — Parental application, storage and events

- **Depends on** TOF-101, TOF-034

### [ ] TOF-103 — Reach: draggable lane track

- **Spec** PRD §15.3 · **Depends on** nothing
- **Approach** `TimelineChart` lanes with segments draggable by pointer and
  keyboard through `@dnd-kit`, with the live-region announcements.

### [ ] TOF-104 — Plan parental leave and your plan

- **Screens** T8, T9, MT11 · **Depends on** TOF-102, TOF-103

### [ ] TOF-105 — Handover and send

- **Screens** T10, MT12 · **Depends on** TOF-104

### [ ] TOF-106 — HR's view of the case

- **Screens** T11 · **Depends on** TOF-105

### Kiosk, integrations, reach

### [ ] TOF-107 — Kiosk devices

- **Spec** PRD §11.9 · **Depends on** TOF-042
- **Approach** Device registration per location, revocable token hash, scope
  punch-only; badge (keyboard wedge), PIN and personal QR.

### [ ] TOF-108 — Kiosk screens, offline

- **Screens** T25, T26 · **Depends on** TOF-107
- **Approach** `/kiosk/:deviceId` with its own minimal shell; a service worker
  queues punches offline with the device instant and a sequence; first name
  only; Undo for 5 seconds.

### [ ] TOF-109 — Integrations page

- **Screens** T35 · **Depends on** TOF-078
- **Approach** Lists connected integrations and the Kithena modules that would
  consume Time Off events, marked "Kithena module".

### [ ] TOF-110 — Calendar integration (Google, Microsoft)

- **Depends on** TOF-109
- **Approach** Behind a port; out-of-office on approval; holidays per location.
  Needs OAuth credentials a person must create.

### [ ] TOF-111 — Chat integration (Slack, then Teams)

- **Depends on** TOF-109
- **Approach** Status while away; approve from a message. Named generically in
  the UI ("Chat apps").

### [ ] TOF-112 — AI holiday drafts

- **Screens** T36 AI card · **Depends on** TOF-084, TOF-083
- **Approach** Drafts from data HR supplies or a licensed dataset; never
  publishes; unconfirmed days left for HR.

### [ ] TOF-113 — Germany and UK country packs

- **Depends on** TOF-028

### [ ] TOF-114 — SCIM member provisioning

- **Spec** PRD §18 · **Depends on** TOF-036

---

## Blocked

- **MT2, Live Activity and Dynamic Island** — needs a native iOS shell.
- **NFC phone punches** — needs a native shell (Web NFC is Android Chrome only).
- **Projects, Payroll, Benefits enrichments** — those modules do not exist.
- **Legal review of each country pack** — a person must sign off before a tenant
  enables it.
