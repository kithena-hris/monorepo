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

| PR  | Lane                                                                                        | Tickets                              |
| --- | ------------------------------------------------------------------------------------------- | ------------------------------------ |
| 1   | `timeoff/docs` — this plan and the PRD                                                      | —                                    |
| 2   | `timeoff/foundation` — unblock, contracts, domain                                           | TOF-001 – TOF-028                    |
| 3   | `timeoff/service` — storage, application, transports, standalone                            | TOF-029 – TOF-050                    |
| 4   | `timeoff/web-shell` — Reach additions, the second remote, navigation                        | TOF-051 – TOF-058                    |
| 5   | `timeoff/employee` — operations, overview, request, my requests, balances, holidays         | TOF-060 – TOF-067                    |
| 6   | `timeoff/manager` — approvals, calendar, delegation                                         | TOF-068 – TOF-073                    |
| 7   | `timeoff/attendance` — the clock, timesheet, corrections, team right now                    | TOF-058a, TOF-059, TOF-074 – TOF-077 |
| 8   | `timeoff/settings` — leave types, policy, negative balance, attendance, approvals, holidays | TOF-078 – TOF-083                    |
| 9   | `timeoff/assist` — Phase 2 AI                                                               | TOF-084 – TOF-092                    |
| 10  | `timeoff/hr-ops` — exceptions, month close, insights, nudges, policy preview                | TOF-093 – TOF-099                    |
| 11  | `timeoff/parental` — parental leave                                                         | TOF-100 – TOF-106                    |
| 12  | `timeoff/reach` — kiosk, integrations, more country packs                                   | TOF-107 – TOF-114                    |

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

### [x] TOF-001 — `svc_timeoff` hardened and the schema bootstrap

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
- **As built** One integration test covers this ticket and TOF-002
  (`src/infrastructure/bootstrap.integration.test.ts`), with `timeoff.outbox`
  as the tenant-scoped probe instead of a throwaway table. The bootstrap does
  not `ALTER` a `svc_timeoff` that already exists: changing `BYPASSRLS` needs
  privileges the migrator may lack, and `deploy/vm/deploy.sh` already creates
  it `NOBYPASSRLS`.

### [x] TOF-002 — Outbox and Debezium

- **Spec** PRD §17
- **Files** `migrations/<ts>_timeoff_outbox.sql`, `docker-compose.yml`,
  `services/timeoff/src/infrastructure/tables.ts`
- **Depends on** TOF-001
- **Approach** `outboxTable('timeoff')` exactly as People's
  `20260927230100_people_outbox_relay.sql`; add `timeoff.outbox` to the
  Debezium table list.
- **Done when** an integration test writes an event through `publish()` and
  reads it from `timeoff.outbox`.

### [x] TOF-003 — Boot like People

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

### [x] TOF-004 — Dockerfile and deploy

- **Files** `services/timeoff/Dockerfile`, `deploy/vm/deploy.sh`
- **Depends on** TOF-003
- **Approach** Copy People's Dockerfile, including the runtime `graphql`
  dependency fix from #208.
- **Done when** `docker build -f services/timeoff/Dockerfile .` succeeds and the
  image answers `/healthz`.
- **As built** `deploy/vm/deploy.sh` is unchanged: it already creates
  `svc_timeoff NOLOGIN NOBYPASSRLS` before migrating, and Time Off has no VM
  service, database URL or relay to deploy until it holds data (TOF-030 on).
  `graphql` moved from dev to runtime dependencies, the #208 fix.

### [x] TOF-005 — Codegen sees Time Off's new events

- **Files** `tools/codegen/src/cli.ts`
- **Depends on** nothing
- **Approach** `timeoffEvents` is already concatenated; confirm, and make the
  new arrays in TOF-006 land in the same list so redaction paths, JSON Schema
  and the DSAR manifest include them.
- **Done when** `just codegen` passes and the generated redaction paths contain
  a Time Off path.
- **As built** No change to `cli.ts`: every new event is in `timeoffEvents`,
  which it already concatenates. The walk reads event payloads only, so the
  policy, request and ledger shapes are classified field by field but checked
  by their own tests, not by codegen. `payload.medicalNote` leaves the
  redaction list with v1 (TOF-009); `payload.dueDate` is the Time Off path now
  in it.

---

## Phase 1 — boots alone, does the job

### Contracts

### [x] TOF-006 — Primitives

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
- **As built** `WorkModel` is `AttendanceWorkModel`: People's requiredness
  already exports a `WorkModel` (a company's own option key) from the same
  package. `AbsenceKind` moved here from `events/timeoff.ts` so the policy and
  request files can use it without an import cycle; `LeaveCategory` is
  `AbsenceKind` without `public_holiday`. Keys reuse People's `keySchema`.
  `NonNegativeDayAmount` and `LeaveUnit` were added for TOF-007.

### [x] TOF-007 — Leave type and policy contracts

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

### [x] TOF-008 — Request, ledger and attendance contracts

- **Spec** PRD §7.1, §8.1, §11.2
- **Files** `packages/contracts/src/timeoff/request.ts`, `ledger.ts`,
  `attendance.ts`
- **Depends on** TOF-006
- **Approach** Request input and view shapes, `LedgerEntryKind`, punch input.
  The sick note is `asSpecialCategory('health')` and never appears in a view
  shape for anyone but the member and HR.
- **Done when** a type-level test asserts the teammate view of a sick request
  has no `typeKey` and no `note`.
- **As built** Three views: `LeaveRequestView` (member and HR, the only one
  with `sickNoteFileId`), `ApproverRequestView` (type, note, `notePresent`) and
  `TeammateRequestView`, a union on `shows: 'type' | 'off'` whose `off` branch
  has no type, category or note. The sick note is a reference to the encrypted
  file, never its content. `PunchInput` is `strict`, so a coordinate is refused
  rather than dropped.

### [x] TOF-009 — Events

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
- **As built** v2 drops v1's `medicalNote` (the note's text, which §8.5 keeps
  out of every payload) for `notePresent`, and adds `belowZero`. `workingDays`
  is a `DayAmount` and nullable only for an upcast v1, which never recorded a
  cost. v1 stays defined as `LeaveRequestedV1` but is out of `timeoffEvents`,
  so it is read and not published. The upcaster is one function,
  `readLeaveRequested`, in `events/timeoff.ts` rather than a mechanism in
  `event.ts`: it is the only versioned event in the registry. A parental due
  date is `asSpecialCategory('health')`. The `LeaveRequest` aggregate still
  builds a v1 payload and lifts it through the upcaster until TOF-016.

### Domain

Test-first, all of it. No drivers, no I/O.

### [x] TOF-010 — Working days and days away

- **Spec** PRD §7.3
- **Files** `services/timeoff/src/domain/calendar/working-days.ts`
- **Depends on** TOF-006
- **Approach** Pure functions over a work pattern (weekdays, hours per day), a
  holiday set and half-day flags. `daysAway` extends across adjacent
  non-working days. Use the design's numbers as fixtures: 13–16 Oct 2026 with
  12 Oct a holiday costs 4 and is 9 days away.
- **Done when** fixtures from T3, T4 and MT6 pass, and property tests prove
  `workingDays ≤ daysAway`.
- **As built** A work pattern is the ISO weekdays worked; hours per day waits
  for comp time, which is the first thing that needs it. Both functions take
  the contracts' `DateSpan` and return `DayAmount`, counted internally in whole
  half days, so no decimal library is needed. `daysAway` also returns the
  stretched `from` and `to` (Sat 10 to Sun 18). A half day at an end stops the
  absence reaching the weekend beside it. The property test is a seeded loop:
  fast-check is not a dependency.

### [x] TOF-011 — Layered holiday calendars

- **Spec** PRD §10.2
- **Files** `services/timeoff/src/domain/calendar/holiday-calendar.ts`
- **Depends on** TOF-010
- **Approach** National + regional + city layers resolve to a set of dates for
  a location and year; weekend rule (`move_to_monday | none`) per layer.
- **Done when** Madrid 2026 resolves to the eleven dates in T36 plus San Isidro
  and La Almudena, and Barcelona does not get either.
- **As built** The weekend rule governs a layer's own days. Spanish layers
  say `none` and carry the moved days their decrees publish, because Madrid
  moves a Sunday holiday and Catalonia does not. T36 leaves out three days
  of Madrid's 2026 decree (2 May, 2 Nov, 7 Dec), so Madrid 2026 resolves to 14,
  T36's 11 among them. The Madrid and Barcelona tests are in
  `country-packs/es.test.ts`, next to the data.

### [x] TOF-012 — Leave type aggregate

- **Spec** PRD §6.1
- **Files** `services/timeoff/src/domain/policy/leave-type.ts`
- **Depends on** TOF-007
- **Approach** Invariants: key immutable; a statutory type can be hidden, never
  deleted; sick and parental default to `off_only` visibility and cannot be
  loosened to show the reason to teammates.
- **Done when** every invariant has a failing-first test.

### [x] TOF-013 — Policy, versions and the entitlement fold

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

### [x] TOF-014 — The ledger and the balance fold

- **Spec** PRD §7.1, §7.2
- **Files** `services/timeoff/src/domain/balance/ledger.ts`
- **Depends on** TOF-013
- **Approach** Append-only entries with `effectiveOn`, `supersedes`; `balanceOn(date)`
  returns left, used, booked and allowance. A correction never edits an entry.
- **Done when** MT20's ledger folds to 11.5 left with 10.5 used and 3 booked,
  and a superseded entry is excluded exactly once.

### [x] TOF-015 — Negative balance

- **Spec** PRD §7.4
- **Files** `services/timeoff/src/domain/balance/negative.ts`
- **Depends on** TOF-014
- **Approach** Given a policy and a requested cost, return `fits`,
  `borrow { days, nextYearStartsAt, approvers }`, `refused { limit }`, plus the
  alternatives (unpaid N days, shorten to dates that fit).
- **Done when** T5's numbers come out: 6.5 left, 8 requested, borrow 1.5,
  2027 starts at 23.5, approvers manager then HR; and 10 requested is refused
  at a limit of 3.
- **As built** T5 labels the shorten option "14–21 Dec, 6.5 days", but 14–21
  Dec is 6 working days. `goingBelowZero` returns 14–22 Dec ending on a half
  day, which is what 6.5 actually covers, or 14–21 Dec at 6 when the policy
  allows no half days. The function takes the working dates as input rather
  than computing them, because TOF-010 owns working days.

### [x] TOF-016 — The request aggregate, rewritten

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
- **As built** The contracts have no event for a withdrawal, a change asked
  for or turned down, a counter-proposal turned down, or a request taken, so
  `withdraw` raises `cancelled` (the whole request released) and the other
  four raise nothing: a change reaches consumers as `changed` once approved,
  and `taken` tells nobody anything approval did not. `acceptCounter` raises
  `changed` then `approved`. A booking settles as a `release` and a `taken`
  of the same amount, so `left` stays the plain sum of the ledger. Approval is
  one step; a manager-then-HR chain is the application walking the chain
  TOF-019 returns. A counter-proposal is runs of days, not one range,
  because TOF-022's swap (19, 20, 22, 23 and 26 Oct) is not continuous:
  `counter_proposed.proposals` is `{ spans, workingDays }[]` and `changed`
  carries the `spans` inside its `from`–`to`, both widened in place at v1
  since neither has been published.

### [x] TOF-017 — Sick leave

- **Spec** PRD §8.5
- **Files** `services/timeoff/src/domain/request/sick.ts`
- **Depends on** TOF-016
- **Approach** Recorded, not requested; auto-approved under the threshold; a
  note required after N days; the note never leaves the aggregate except as
  `notePresent`.
- **Done when** a 2-day sick record is approved on creation and a 4-day one
  asks for a note.

### [x] TOF-018 — Team minimums and coverage

- **Spec** PRD §9.3
- **Files** `services/timeoff/src/domain/coverage/coverage.ts`
- **Depends on** TOF-010
- **Approach** Coverage per day from team members, approved and pending
  absences and holidays; minimum as count or percentage; returns the days below.
- **Done when** T13's October fixture gives 4 of 7 on the 21st and nothing
  else below 5.
- **As built** A day is held to the minimum only when someone on the team was
  due to work. A half day off counts as out. A percentage rounds up to whole
  people. `.gitignore` ignored every `coverage/` folder, so it now makes an
  exception for `services/*/src/domain/coverage/`.

### [x] TOF-019 — Approval rules and routing

- **Spec** PRD §9.1
- **Files** `services/timeoff/src/domain/approval/approval-rule.ts`
- **Depends on** TOF-016
- **Approach** A rule resolves to an ordered list of approver roles for a
  request; auto-approval conditions; a member without a manager falls through
  to HR.
- **Done when** T34's five rules resolve as drawn and a shorten resolves to no
  approver.

### [x] TOF-020 — Delegation and escalation

- **Spec** PRD §9.7
- **Files** `services/timeoff/src/domain/approval/delegation.ts`
- **Depends on** TOF-019
- **Approach** A delegate for a range or automatically during the approver's
  approved time off; salary-related requests excluded unless allowed; escalation
  after N working days to the approver's manager.
- **Done when** Marco away 13–16 Oct routes Adam's request to Omar, and a
  request untouched for 3 working days escalates.

### [x] TOF-021 — Queue grouping

- **Spec** PRD §9.2
- **Files** `services/timeoff/src/domain/approval/triage.ts`
- **Depends on** TOF-015, TOF-018
- **Approach** Deterministic: clear when within balance, coverage holds,
  sick under threshold, comp within banked hours; otherwise look closer with
  the first failing rule as a typed reason.
- **Done when** T16's five requests split 3 and 2 with the reasons drawn.
- **As built** Coverage comes in as `daysBelowMinimum` rather than being
  computed here, so this landed before TOF-018 and imports nothing from it.
  Adam's T16 line names the release on the 22nd too; the reason is the
  first rule that fails, `below_minimum` on the 21st, and the release is
  only the next one (`protected_period`).

### [x] TOF-022 — Clash fixes and counter-proposals

- **Spec** PRD §9.5, §9.6
- **Files** `services/timeoff/src/domain/approval/alternatives.ts`
- **Depends on** TOF-018, TOF-010
- **Approach** Generate: swap the clash day for the next working day; the next
  clean week; approve as asked. Rank requester-only first, then no change, then
  changes to someone else's approved time.
- **Done when** T15 and T18 produce "19, 20, 22, 23 and 26 Oct" first.
- **As built** A swap is not contiguous (19–20 and 22–26 Oct), so every
  option carries `spans`. `LeaveCounterProposed.proposals` holds one span per
  option, so TOF-016 cannot carry a swap as one proposal without a contract
  change. Asks to teammates go smallest absence first (Yuki before Omar).

### [x] TOF-023 — Punches and the clock

- **Spec** PRD §11.1, §11.2
- **Files** `services/timeoff/src/domain/attendance/clock.ts`
- **Depends on** TOF-008
- **Approach** State from punches (`out`, `in`, `on_break`); refuse impossible
  transitions; one clock regardless of source; a correction supersedes.
- **Done when** a punch from the kiosk followed by one from the web reads as one
  continuous day.

### [x] TOF-024 — The working day and overtime

- **Spec** PRD §11.3, §11.5
- **Files** `services/timeoff/src/domain/attendance/day.ts`
- **Depends on** TOF-023
- **Approach** Segments (worked, break, overtime, missing, planned) for a day
  against a schedule; break and rest rules; weekly maximum; overtime to comp,
  paid or chosen.
- **Done when** T20's week computes 7h 58m, 9h 05m with +1h 05m, a missing
  Wednesday and 3h 41m live.

### [x] TOF-025 — Missed punches and corrections

- **Spec** PRD §11.4
- **Files** `services/timeoff/src/domain/attendance/correction.ts`
- **Depends on** TOF-024
- **Approach** Detect an open day the next morning; a correction is a new punch
  with `supersedes`; corrections after 24 hours flag for the manager.
- **Done when** Wednesday's missing out is detected on Thursday and a
  correction at 18:05 yields 9h 18m with 1h 18m overtime.
- **As built, 2026-10-03** The correction yields 8h 28m with 28m overtime.
  The design's 9h 18m is the whole 08:47–18:05 span, but the same row records
  a 50-minute break, and Monday and Tuesday subtract theirs. A forgotten
  clock-out has no original punch to supersede, so
  `AttendanceCorrected.supersedes` is nullable. Tuesday's overtime starts at
  17:42, where the eighth hour ends, not at the 17:00 the design draws.

### [x] TOF-026 — Schedules

- **Spec** PRD §11.5
- **Files** `services/timeoff/src/domain/attendance/schedule.ts`
- **Depends on** TOF-024
- **Approach** Fixed, flexible with core hours, seasonal, rotating.
- **Done when** "Summer hours" Jul–Aug plans 35h and Madrid office plans 40h.

### [x] TOF-027 — Pay period

- **Spec** PRD §11.8
- **Files** `services/timeoff/src/domain/attendance/pay-period.ts`
- **Depends on** TOF-024, TOF-014
- **Approach** Totals per member and team; closing locks; a later correction
  lands in the next open period with `supersedes`.
- **Done when** closing September refuses a correction dated September and
  posts it to October.

### [x] TOF-028 — Spain country pack

- **Spec** PRD §12.3
- **Files** `services/timeoff/src/country-packs/es.ts`
- **Depends on** TOF-012, TOF-011
- **Approach** Statutory leave types, national holidays 2026–2027, 12-hour rest,
  4-year attendance retention, the parental entitlement table (used in Phase 3).
  Mark the pack `reviewed: false` until legal signs off.
- **Done when** a new Spanish tenant gets the statutory types and the national
  layer, and the pack's `reviewed` flag is surfaced in settings.
- **As built** Data only: seeding a tenant and the settings flag come with
  the application and settings tickets. TOF-012 was still open, so the types
  are parsed `LeaveTypeDefinition`s. An `entitlements` table holds the
  statutory days (vacation 30 calendar, marriage 15, and so on). The 2027
  national layer is what Madrid's and Catalonia's published 2027 calendars
  share, until the BOE list comes out.

### Storage

### [x] TOF-029 — Member projection table

- **Spec** PRD §5.2, §17
- **Files** `migrations/<ts>_timeoff_member.sql`,
  `services/timeoff/src/infrastructure/tables.ts`
- **Depends on** TOF-001
- **Approach** RLS as in TOF-001; `last_event_id` and `last_effective_from` for
  idempotent, ordered application.
- **Done when** an integration test applies the same event twice and sees one row.
- **As built** `src/infrastructure/storage.integration.test.ts` covers TOF-029 to
  TOF-033, one section per ticket. The guard — write only when
  `(last_effective_from, last_event_id)` moves forward — is spelled in the test
  as TOF-035's consumer will spell it; both columns are `NOT NULL` because a
  null never compares less. No time zone column: §5.2 does not list one.

### [x] TOF-030 — Policy, leave type and ledger tables

- **Files** `migrations/<ts>_timeoff_policy_ledger.sql`
- **Depends on** TOF-029
- **Approach** `numeric(9,3)` amounts, `effective_on date`, ledger insert-only
  (`REVOKE UPDATE, DELETE` from `svc_timeoff`).
- **Done when** an integration test proves `svc_timeoff` cannot update or delete
  a ledger row.
- **As built** A published `policy_version` refuses any change by trigger, and
  a policy has one draft at a time (a partial unique index). An entry is
  corrected once (a partial unique index on `supersedes`); a correction of a
  correction names the correction.

### [x] TOF-031 — Requests with the overlap constraint

- **Files** `migrations/<ts>_timeoff_request.sql`
- **Depends on** TOF-030
- **Approach** `daterange` and a `btree_gist` exclusion constraint over live
  states per member.
- **Done when** two concurrent inserts of overlapping live requests leave
  exactly one, in an integration test.
- **As built** `days` is a `datemultirange` rather than a `daterange`: an
  accepted counter-proposal books runs with a gap (T18), and a range would
  claim the day in between. Live is `pending`, `approved`, `change_pending`,
  `counter_proposed` and `taken`. A morning and an afternoon off on one date
  still overlap, until the domain has morning and afternoon. `btree_gist` is
  created `IF NOT EXISTS`, a trusted extension like `btree_gin`.
  `ledger_entry.request_id` gets its foreign key here.

### [x] TOF-032 — Approval, delegation, minimum and holiday tables

- **Files** `migrations/<ts>_timeoff_approval_holiday.sql`
- **Depends on** TOF-030
- **Done when** migrations apply clean twice.
- **As built** Checked with `atlas migrate apply` twice against a fresh
  Postgres 18 initialised by `init-db.sql`: 93 migrations, then "No migration
  files to execute". A holiday layer carries `country`, `region` and `city`,
  which is how a member's location picks its layers. One delegation per
  approver, the shape `routeTo` takes. `leave_type.approval_rule_key` gets its
  foreign key here.

### [x] TOF-033 — Attendance tables

- **Files** `migrations/<ts>_timeoff_attendance.sql`
- **Depends on** TOF-030
- **Approach** `punch` insert-only, `schedule`, `pay_period`, `pay_period_line`;
  no coordinate column anywhere.
- **Done when** an integration test asserts the `punch` column list.
- **As built** `kiosk_device` is here too (the token's SHA-256 only), because a
  punch names its device. `member_schedule` is effective dated. A closed
  `pay_period` refuses changes, and a line posted into one is refused under
  `FOR SHARE`, so a close and a post racing cannot both win. `punch` and
  `pay_period_line` are insert-only for `svc_timeoff`.

### [x] TOF-034 — Drizzle repositories and the unit of work

- **Files** `services/timeoff/src/infrastructure/drizzle-*.ts`,
  `unit-of-work.ts`
- **Depends on** TOF-029 – TOF-033
- **Approach** Same pattern as People: `tenantTransaction`, aggregates save and
  publish their events to the outbox in one transaction.
- **Done when** integration tests round-trip every aggregate and see its events
  in the outbox.
- **As built** `drizzleUnitOfWork(db)` is `withTenant` handing out every store
  bound to the transaction; `timeoffDatabase(env)` opens the pool from
  `TIMEOFF_DATABASE_URL`, and `main.ts` passes it to the consumers and the
  jobs (the transports take `drizzleUnitOfWork(db)` the same way).
  `LeaveRequest`, `Policy` and `LeaveType` gained `rehydrate`, and
  `AggregateRoot` a protected `restoreVersion`, so a stored request's next
  event numbers on from its version. `20261003120000_timeoff_repositories.sql`
  adds what the ports hold and the tables did not: the member's zone, a
  deleted leave type, a request's routing, which layers a location observes,
  the two tenant settings, overtime decisions, feed versions, People's
  locations (TOF-045) and `timeoff.tenant`, the job's tenant list on People's
  pattern. Relaxed, each saying why: a holiday layer's place (assigned per
  location instead) and "closed by" (the domain does not carry it yet). An
  import's member is stored as the nil event and `-infinity`, read back as
  null, and the upsert never moves a member backwards. `persist` now saves the
  request before its ledger rows, which name it by foreign key; the Spain
  pack's region keys are `es_md` and `es_ct`, the key shape the table holds.
  The application tests stay on the in-memory ports: People has no shared
  port contract, and `repositories.integration.test.ts` drives a hire and a
  request through the use cases over Drizzle instead.

### Application

### [x] TOF-035 — Member sync

- **Spec** PRD §5.2
- **Files** `services/timeoff/src/application/member/`
- **Depends on** TOF-034
- **Approach** Commands `upsertMember`, `endMember`, translated from People
  events (TOF-045) or from an import (TOF-036). Hire grants the year's
  entitlement; termination settles a negative balance per policy.
- **Done when** a hire produces a member and a grant entry.
- **As built** The ports are in `application/ports.ts`; unlike People's, no
  store takes the transaction — `UnitOfWork.run(tenantId, tx => …)` hands out
  every store already bound to it, and the in-memory adapters
  (`application/testing/in-memory.ts`) are what the application tests and the
  standalone suite run on. The projection carries a `timeZone` beside §5.2's
  fields, because "today" is the member's. A leaver's year is re-folded pro
  rata to the last day; `final_pay` deducts for everyone, since the
  projection does not know which contracts have the deduction clause.

### [x] TOF-036 — Member import when People is absent

- **Files** `services/timeoff/src/application/member/import.ts`
- **Depends on** TOF-035
- **Approach** CSV and JSON, dry run first, the same columns as PRD §5.2.
- **Done when** the standalone suite imports seven members with People absent.

### [x] TOF-037 — Requesting, changing and cancelling

- **Files** `services/timeoff/src/application/request/`
- **Depends on** TOF-016, TOF-034
- **Approach** Loads policy, ledger, holidays and coverage; calls the aggregate;
  saves and publishes. Returns the preview (working days, days away, balance
  after, coverage warnings, negative verdict) without saving for the panel.
- **Done when** an application test sends, changes and cancels with in-memory
  ports.
- **As built** Borrowing adds the negative-balance rule's approvers to the
  chain the approval rules give (default manager then HR). The aggregate
  stores no chain, so a `RequestRecord` carries the request with its routing
  (chain, step, since, escalated to). The Drizzle repository (TOF-034) will
  need a way to rebuild `LeaveRequest`, `Policy` and `LeaveType` from rows,
  which the domain does not have yet.

### [x] TOF-038 — Deciding, counter-proposing and batch approval

- **Files** `services/timeoff/src/application/approval/`
- **Depends on** TOF-019, TOF-021, TOF-037
- **Approach** OpenFGA check for `approver` or `delegate` on the member, then the
  aggregate. Batch approves only requests whose triage is `clear`.
- **Done when** a test proves batch refuses a look-closer request and a
  non-approver is refused in the application layer.

### [x] TOF-039 — Delegation and escalation workflow

- **Files** `services/timeoff/src/application/approval/escalation.ts`,
  `services/timeoff/src/infrastructure/temporal/`
- **Depends on** TOF-020, TOF-038
- **Approach** One Temporal workflow per pending request; reminder at 09:00;
  escalation after 3 working days.
- **Done when** a Temporal test-environment test escalates with a skipped clock.
- **As built** The workflow passes its own time to the activity, so the test
  server's skipped days are the days `escalationTick` counts
  (`escalation.integration.test.ts`, People's convention for Temporal tests).
  Without `TEMPORAL_ADDRESS` nothing reminds or escalates, and boot says so.

### [x] TOF-040 — Calendar queries

- **Files** `services/timeoff/src/application/calendar/`
- **Depends on** TOF-018, TOF-034
- **Approach** Month, timeline and year views for team, company and me, with
  visibility applied (teammates see "Off" for sick); the day detail; the
  iCalendar feed with a signed, revocable token.
- **Done when** a test proves a teammate's view of a sick day has no type.

### [x] TOF-041 — Holidays and policies admin

- **Files** `services/timeoff/src/application/admin/`
- **Depends on** TOF-013, TOF-011, TOF-034
- **Approach** CRUD for leave types, policies (draft, publish with re-fold),
  holiday calendars, approval rules, team minimums, negative balance rules,
  attendance rules. `hr_admin` only.
- **Done when** publishing a policy re-folds affected balances and emits
  `policy.published`.
- **As built** A negative balance rule is part of the policy, so setting one
  drafts the next version, published like any other.

### [x] TOF-042 — The clock and the timesheet

- **Files** `services/timeoff/src/application/attendance/`
- **Depends on** TOF-023 – TOF-026, TOF-034
- **Approach** Punch, break, clock out, correct; my timesheet by week or month;
  team right now (manager); overtime approval.
- **Done when** an application test runs a full day and a correction.
- **As built** A member without a schedule gets 09:00–17:30 with half an
  hour's break. Approved comp time is banked against the tenant's tracked
  hour-unit leave type, when there is one.

### [x] TOF-043 — Nightly and morning jobs

- **Files** `services/timeoff/src/infrastructure/background.ts`
- **Depends on** TOF-013, TOF-025
- **Approach** BullMQ: monthly accrual on the 1st, carry-over and expiry at year
  end and on use-by dates, warnings on 1 Oct and 1 Dec, `markTaken` after the
  last day, the morning missed-punch check, the 20:00 reminder.
- **Done when** a test with a fixed clock posts the October accrual once even if
  run twice.
- **As built** Entitlement is posted as it falls due (hire, the 1st, the year
  start), not a whole year ahead, so the ledger fold's `allowance` counts the
  months credited so far; the balance card's yearly figure is the policy's.
  `wireBackground` starts nothing until TOF-034 gives it a Drizzle unit of
  work and a tenant list.

### Transports

### [x] TOF-044 — The subgraph

- **Spec** PRD §18
- **Files** `services/timeoff/src/graphql/`, `services/timeoff/schemas/timeoff.graphql`
- **Depends on** TOF-037 – TOF-042
- **Approach** Pothos, thin, mapping domain failures to GraphQL errors. Queries
  for every screen in Phase 1 (one query per screen, named for it, as People's
  `screens` do); mutations for every command. Extend `Person` with balances.
  Regenerate SDL with `just codegen`; `just supergraph` must compose.
- **Done when** `just supergraph` composes and the schema snapshot test passes.
- **As built** Every field is one of REST's routes (`http/rest.ts`, `ROUTES`),
  reached in-process as the request's caller, as People's `viaRest`: a
  mutation is the route's write with its `Idempotency-Key`. Output types are
  generated from the routes' Zod answers (`graphql/zod.ts`), and a write's
  `input` is the route's JSON body, parsed by the route's schema. The reads
  live in `application/screens/` (Zod views in `views.ts`). Queries:
  `timeOffOverview`, `timeOffRequestPanel`, `timeOffMyRequests`,
  `timeOffRequest`, `timeOffApprovals`, `timeOffRequestDecision`,
  `timeOffDelegation`, `timeOffCalendarMonth`, `…Timeline`, `…Year`, `…Day`,
  `timeOffTimesheet`, `timeOffTeamRightNow`, `timeOffBalance`,
  `timeOffHolidays`, the six settings pages and `timeOffViewer`.
  `Person.timeOffBalances` replaces `leaveBalanceDays`. The snapshot is the
  committed SDL (`graphql/schema.test.ts`). **TOF-058a's server half is here**:
  `timeOffViewer` answers `approves`, `hrAdmin` and `counts`
  (`requestsWaiting`, `attendanceExceptions`); the shell half comes with the
  screens. Closing a month (`closePayPeriod`) was added to the application
  for TOF-050; it posts the month's days that have no line, then locks the
  period.

### [x] TOF-045 — People event consumers

- **Files** `services/timeoff/src/infrastructure/consumers/`
- **Depends on** TOF-035
- **Approach** `people.person.hired`, `terminated`, `manager_changed`,
  `org_changed`, `profile_updated`, `status_changed`, `synced_from_external`,
  and `people.location.*` into member commands. Idempotent by event id, ordered
  by `effectiveFrom`. Update the manifest's `consumes`.
- **Done when** a consumer test applies out-of-order events and ends in the right
  state.
- **As built** `handle.ts` is transport-free like People's; `wire.ts` consumes
  `kithena.people.v1` as group `timeoff` when `TIMEOFF_DATABASE_URL` and
  `KAFKA_BROKERS` are both set. Each person event reads, merges and calls
  `upsertIn` in one transaction, so the fields it does not carry stay as
  stored; an event about somebody unknown is ignored (People keys a person's
  events to one partition, so `hired` comes first). People names org units
  and locations by id, so the keys are `u_<hex>` and `l_<hex>`, and no People
  event names an org unit: a team's name stays the import's, or none.
  Locations are a small projection (`LocationStore`, a new port) that turns a
  member's location into country and zone; a zone change rewrites the
  members there without an event id, so it never holds back their own events.
  `profile_updated` applies a name only when given and family name both
  carry values, and a start date; `synced_from_external` carries field names
  only and is ignored, its values arriving on the events People raises beside
  it. A zone change applies on arrival, not from its date.

### [x] TOF-046 — REST and OpenAPI

- **Files** `services/timeoff/src/http/rest.ts`, `openapi.ts`
- **Depends on** TOF-044
- **Approach** `/v1/timeoff/...` generated from Zod; idempotency keys as People.
- **Done when** the OpenAPI document validates and a REST test sends a request.
- **As built** One route table serves REST, the document
  (`/v1/timeoff/openapi.json`) and the subgraph. The key, the request's hash
  and the answer are saved in the write's own transaction
  (`Tx.idempotency`, `timeoff.idempotency_key`): the answer rather than
  People's resource id, because a Time Off answer is a status or an id. The
  Drizzle unit of work hands out `drizzleIdempotency(tx, tenantId)`
  (`infrastructure/idempotency.ts`). The calendar feed is
  `GET /v1/timeoff/calendar/feed.ics?token=`, with no caller. The caller is
  read from the router's principal (`http/caller.ts`); identity's token does
  not carry a person yet, so `personId` is forwarded when there is one, and
  the router does not forward to Time Off yet.

### [x] TOF-047 — Webhooks

- **Files** `services/timeoff/src/infrastructure/webhooks/`
- **Depends on** TOF-046
- **Approach** Signed, per published event, reusing People's signer.
- **Done when** a test verifies a signature.
- **As built** People's signer copied, not shared — no package holds it — so
  one function verifies both modules. Delivery is one attempt per
  subscribed endpoint; People's durable schedule comes with Time Off's
  endpoint tables.

### [x] TOF-048 — OpenFGA model

- **Files** the FGA model file People uses, `services/timeoff/src/infrastructure/openfga.ts`
- **Depends on** TOF-038
- **Approach** `approver`, `delegate`, `hr_admin`, `teammate` on a member.
- **Done when** model tests cover manager, delegate during range only, HR, and a
  teammate who may see "Off" but not the type.
- **As built** Time Off's own store and model (`infrastructure/openfga.ts`),
  not People's file: a module is sold alone. `delegate` is `covered_by from
approver`, a conditional tuple whose ranges are checked against `today`;
  `teammate` is `member from team but not subject` (`self` is reserved).
  Ids carry the tenant, since team keys are the tenant's words. `syncMember`
  and `syncCover` write the tuples; calling them from the member consumers
  and `setDelegation` comes with TOF-045 and the Drizzle wiring.

### [x] TOF-049 — Seed for the demo company

- **Files** `services/timeoff/src/seed/`, `docs/demo-company.md`
- **Depends on** TOF-044
- **Approach** Acme's Platform team, Adam, Marco, Ada and the design's October
  2026 data, so screens match the design on `just dev`.
- **Done when** `just dev` shows T1 with 11.5 days left for Adam.
- **As built** `pnpm db:seed` ends with `pnpm --filter @kithena/timeoff seed`,
  which finds Acme by slug and runs `seedAcme` over the Drizzle unit of work:
  one transaction, as of 1 October 2026 12:33 in Madrid, through the import's
  `upsertIn`, the aggregates' own transitions at the dates they happened and
  `persist`; skipped whole once Adam exists. T1 is not built yet (TOF-051 on),
  so the "done when" is held by `acme.test.ts` and `acme.integration.test.ts`:
  Adam's vacation folds to 11.5 left, 10.5 used, 3 booked, personal 2, comp
  6h. With monthly accrual those need 4.167 carried in, and five days taken
  in February so the carry does not expire. Adam's own 19–23 October is left
  out: it is T3's request, whose 11.5 → 6.5 preview and 21 October clash only
  hold while it is unsent (`docs/demo-company.md`). Ravi's comp day books 1
  hour, the application having no day-to-hours rule for hour-unit leave.

### [x] TOF-050 — Standalone acceptance

- **Spec** PRD §3 Validation
- **Files** `services/timeoff/src/standalone/acceptance.standalone.test.ts`
- **Depends on** TOF-036 – TOF-047
- **Approach** Drive the REST handler and yoga schema over in-memory ports, no
  Postgres, no Kafka, People aliased to the absent sibling: import members,
  request, approve, borrow within the limit, clash warning, clock a day,
  correct it, close the month.
- **Done when** `just standalone timeoff` is green with and without the AI keys.
- **As built** `timeoffServer` over the in-memory ports; `fetch` answers
  nothing and the suite asserts nothing asked, with `TYPESAFE_API_KEY` set or
  not. A day's worked time with no break taken is the time clocked, flagged.

### [x] TOF-050a — The composition root

- **Files** `services/timeoff/src/composition.ts`, `main.ts`, `http/caller.ts`,
  `infrastructure/openfga.ts`, `infrastructure/consumers/`,
  `apps/gateway/config.yaml`
- **Depends on** TOF-034, TOF-045 – TOF-048
- **Approach** `main.ts` booted Yoga alone, so production had no REST and no
  database behind GraphQL, no tuple was ever written, and no caller was ever
  a member. Make `main.ts` a composition root, as People's `wirePeople` is.
- **Done when** an integration test boots the root against Postgres and
  OpenFGA and answers `/healthz`, a REST read and a GraphQL query as a seeded
  member named only by account.
- **As built** `composeTimeOff(env)` builds `timeoffServer` over
  `drizzleUnitOfWork(timeoffDatabase(env))`, Time Off's OpenFGA authorizer
  (`OPENFGA_URL`, its own store by `TIMEOFF_OPENFGA_STORE_ID` or by name),
  the router's principal checked with `TIMEOFF_API_TOKEN` (falling back to
  `INTERNAL_API_TOKEN`, People's pattern), `TIMEOFF_FEED_SECRET` (required in
  production, throwaway elsewhere) and Temporal's escalation clock when
  `TEMPORAL_ADDRESS` is set; `main.ts` hands its unit of work to the
  consumers and its pool to the jobs. Without `TIMEOFF_DATABASE_URL`, People's
  rule: the schema only, every field UNAVAILABLE. Without `OPENFGA_URL`
  nobody holds a relation (`nobodyRelates`), so only a member's own screens
  answer — closed, as audit is. Notices stay `logNotifier`: messaging's notice
  endpoint wants an address and a template Time Off has neither of.
  **Caller → member**: `timeoff.member.account_id`
  (`20261003130000_timeoff_member_account.sql`, nullable, not unique) is
  filled from `people.person.hired` and `identity_linked`, or an import's
  `accountId` column; `withMember` resolves the router's account to the one
  member holding it, per request, as People resolves roles. Two holders, or
  none, is an account and nothing more. A support or view-as session is
  refused: Time Off has neither of People's rules for them yet. The router
  forwards Time Off People's principal under its own secret
  (`headers.subgraphs.timeoff`); `just dev`'s entitlements now include
  `module.timeoff`. **Tuples**: `syncingTuples` wraps the unit of work, so
  every member saved — People's events, the import, a zone change — has its
  `subject`, `team` and `approver` tuples resynced from the row after the
  commit, and a redelivered event that changes nothing resyncs again (People's
  "the row is the truth"). `hr_admin` is whoever identity's
  `tenant.administrator_named` names for `module.timeoff`, until
  `administrator_removed`; the consumer now reads identity's topic too.
  **Still open**: `syncCover` is not called — a delegate's `covered_by` needs
  the delegation's range and the approver's approved time off, re-synced on
  `setDelegation` and on each decision of the approver's own requests — so
  delegates cannot act through OpenFGA yet; Time Off has no VM service, so
  `TIMEOFF_API_TOKEN` is in no deploy workflow (`docs/environments.md`, "Time
  Off's settings"); the Acme seed's members carry no account, so `just dev`
  signs nobody in as Adam until the seed maps identity's accounts.

### [x] TOF-050b — Delegates, local dev and deploy

- **Files** `services/timeoff/src/infrastructure/openfga.ts`,
  `services/timeoff/src/seed/`, `platform/identity/scripts/seed-auth.ts`,
  `package.json` (`db:seed`), `deploy/vm/`, `.github/workflows/vercel-production.yml`,
  `vercel-staging.yml`, `deploy-production.yml`,
  `tools/scripts/src/affected-targets.ts`,
  `apps/web/timeoff/scripts/smoke-deploy.mjs`, `docs/environments.md`,
  `docs/demo-company.md`
- **Depends on** TOF-050a
- **Approach** Close TOF-050a's three open ends: delegates act through
  OpenFGA, `just dev` signs Adam in as Adam, and Time Off deploys to the VM
  the way People does.
- **Done when** a delegation set, removed, or covered by the approver's own
  approved time off rewrites `covered_by` after the commit; the seeded members
  carry identity's demo accounts; and a merge deploys Time Off's container,
  the router's token and the remote, each smoke-tested.
- **As built** **Delegates**: `syncingTuples` also wraps
  `approvals.saveDelegation`/`removeDelegation` and `requests.save`; after the
  commit each approver touched has `covered_by` rewritten from the rows — the
  delegation's range, plus every approved request's spans when it is
  automatic — so an approval, a cancellation or a withdrawal of the
  approver's own time off moves it, and a removed delegation clears it. A
  request by somebody with no delegation costs one read and no write.
  ponytail: every approved span the approver ever had goes into the tuple's
  condition context; keep only those not yet over if that grows too large.
  **Local dev**: identity's seed invites an account for each of the seven
  (`first.last@acme.example`, ids `7ac0e000-0000-4000-8000-0000000000a1`–`a7`,
  plain rows with no `account.provisioned`, so People makes no provisional
  person of them), prints their enrolment links, and names Ada Time Off's
  administrator (idempotent, so an old database gets both without a reset);
  `acme.ts` gives each member that account, and relinks a member seeded
  before. `pnpm db:seed` pipes identity's events into Time Off's seed, which
  hands them to Time Off's consumer, as People's does; with `OPENFGA_URL` the
  seed makes Time Off's store and model and resyncs the team's tuples, so
  Marco approves and Ada is HR. `.env.example` already carried every
  `TIMEOFF_*` setting and `turbo run dev` already starts the service (4002)
  and the remote (3003); `just admin-dev` runs neither People nor Time Off,
  by design, and is unchanged. **Deploy**: a `timeoff` container in
  `deploy/vm/compose.yaml` (320 MB, `svc_timeoff`, the Compose addresses),
  `deploy.sh <env> timeoff <image>` (password generated on the VM, LOGIN
  granted in `migrate`, checks `/healthz`, a non-empty `TIMEOFF_API_TOKEN` and
  `timeoff.member` as `svc_timeoff`), `idle-stop.sh` interpolating every image
  so a never-deployed one cannot keep the VM awake, the router's supergraph
  routing `timeoff` to `http://timeoff:4002/graphql` and its env carrying
  `TIMEOFF_API_TOKEN`, `timeoff` and `timeoff-remote` deploy targets with
  rollback and deploy markers, and the remote built, signed, uploaded and
  smoke-tested exactly as People's (`smoke-deploy.mjs`, copied).
  **Left for a person** (names in `docs/environments.md`): environment secrets
  `TIMEOFF_API_TOKEN`, `TIMEOFF_ENV` (with `TIMEOFF_FEED_SECRET`) and
  `TIMEOFF_REMOTE_SSR_SIGNING_KEY` in `production` (and `staging` when it is
  switched on) — the VM job refuses to run without the first two, so create
  them before this merges; repository variables
  `VERCEL_PROJECT_ID_TIMEOFF_REMOTE_PRODUCTION`, `TIMEOFF_REMOTE_URL_PRODUCTION`
  and `TIMEOFF_REMOTE_SSR_PUBLIC_KEY_PRODUCTION` (and the `_STAGING` three);
  a Vercel Hobby project for `apps/web/timeoff` with its custom domain; and
  `module.timeoff` in `KITHENA_ENTITLEMENTS_PRODUCTION` when a company should
  see it. Time Off's outbox is not relayed: nothing on the VM reads its topic
  yet. Measure the container's memory after its first deploy.

### Web shell and Reach

### [x] TOF-051 — Reach: balance meter

- **Spec** PRD §15.3
- **Files** `packages/ui/src/components/progress/`
- **Depends on** nothing
- **Approach** `Progress` gains `segments` with a `pattern="hatched"` option.
  Story with used and booked.
- **Done when** `just test-stories` is green.

### [x] TOF-052 — Reach: day bar

- **Files** `packages/ui/src/components/chart/`
- **Depends on** nothing
- **Approach** A `RangeBar` in the chart family (or `TimelineChart variant="day"`):
  a fixed axis, segments with tones and patterns, a now marker, an axis that can
  be hidden. Hand-drawn SVG, per the charts decision.
- **Done when** stories for T20's five days pass axe.

### [x] TOF-053 — Reach: calendar markers

- **Files** `packages/ui/src/components/calendar/`
- **Depends on** nothing
- **Approach** `Calendar` gains per-day `markers` (dots), a highlighted `range`,
  `today`, struck-through days and an error tone per day.
- **Done when** a story reproduces MT6.

### [x] TOF-054 — Reach: rows scheduler and month grid

- **Files** `packages/ui/src/components/scheduler/`
- **Depends on** nothing
- **Approach** `Scheduler variant="rows"` (people × days with bars, shaded
  weekends and holidays, highlighted row, clash columns, a summary row) and
  `view="month"` (chips per day, "+N more", selected and clash cells).
- **Done when** stories reproduce T12 and T13 and pass axe.

### [x] TOF-055 — Reach: small variants

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

- **As built, 2026-10-03** The shell knows only the `hr`, `admin` and
  `finance` roles, so the manifest tags manager tabs `["manager", "hr"]` for a
  role that does not exist yet. Counts and the "My requests" label for
  employees wait for Time Off data. TOF-058a closes the gap.

### [x] TOF-058a — Manager is a capability, not a shell role

**Goal** Whether someone approves time off is a fact about the org graph Time
Off projects, not a role an admin grants. The shell cannot see it today.

- **Spec** PRD §9.1, §15.1
- **Files** `services/timeoff/src/graphql/`, `apps/web/src/lib/shell-data.ts`,
  `apps/web/timeoff/public/routes.json`
- **Depends on** TOF-044, TOF-058
- **Approach** The subgraph answers `timeOffViewer { approves, hrAdmin, counts }`.
  The shell asks it once per page for the Time Off area and adds `manager` to the
  viewer's roles for that area only when `approves` is true, so the manifest's
  `for` keeps working. Counts on Requests and Attendance come from the same
  answer. Employees see "My requests".
- **Done when** a shell test shows Marco (approves, no admin role) the Requests
  queue tabs and Adam none of them.
- **As built** `shell.ts` asks `timeOffViewer` beside Time Off's manifest
  once per page; `timeOffRoles` adds `manager` (and `hr` for Time Off's HR)
  for this area only, and `timeOffCounts` keys Requests and Attendance and
  the Waiting for me and Exceptions tabs. A manifest place may carry
  `labelFor` (role → label), so the section is "My requests" by default and
  "Requests" for managers and HR. Tests in `shell-data.test.ts` and
  `app-shell.test.tsx`.

### [x] TOF-059 — The clock in the top bar

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
- **As built** A manifest may name `slots` (`{ "topBar": "TopBarClock" }`);
  the shell reads them with the routes (`remoteNav`), a name it does not draw
  is ignored. The layout fetches each slot's data with the area's screen
  loader and its server build (`lib/slots.ts`), and `TopCorner` draws it
  between search and the bell through `RemoteSlot`: `RemoteScreen` with a
  `slot` is a stage of its own beside the area's screen and nothing at all
  when the remote is down. The clock (`apps/web/timeoff/src/clock/`) is drawn
  from `TimeOffTimesheet` over the last week, its state the last punch (a
  clock left running over a week shows out; Time Off has no clock read), and
  ticks in its own component. ⌥T is `clock` in the shell's table, run as the
  screen command the clock offers; Reach's `chordOf` reads the letter under
  Alt from `code`, as a Mac types `†`. "Working on" is free text kept on the
  device. The shell test is a stand-in remote pressed on a People page; the
  pill-to-punch path is the remote's own test.

### [x] TOF-060 — Persisted operations for Time Off

- **Files** `apps/web/src/lib/timeoff-operations.ts`, `apps/gateway/persisted/`
- **Depends on** TOF-044, TOF-056
- **Approach** One operation per screen, generated into the safelist with
  `pnpm --filter @kithena/gateway persist`. Writes go through server actions.
- **Done when** the router accepts every Time Off operation and refuses an
  unlisted one.
- **As built** One query per screen and one mutation per write, each asking
  for its whole answer; `$key` is always the idempotency key (a thing's own
  `key` argument is `$leaveTypeKey` or `$calendarKey`). `persist` reads
  People's and Time Off's lists and validates each against its subgraph.
  `lib/people.ts` runs either list by area (`timeOff()`); the router forwards
  the principal to Time Off with `TIMEOFF_API_TOKEN`, which the VM's
  `router.env` needs before Time Off is deployed. A screen's data is
  `lib/timeoff-screens.ts` (one case per screen), handed over by
  `components/timeoff-screen.tsx` with the server actions in
  `app/(app)/time-off/actions.ts`; `remote-area.tsx` picks both by area.

### Screens — employee

Each screen ticket builds the web screen and its phone layout in the same
component, at the same URL, and is done when its stories pass axe, its screen
test passes, and it matches the design's screen on the seeded demo company.

### [x] TOF-061 — Overview

- **Screens** T1, MT1 · **Spec** PRD §7.2, §15
- **Depends on** TOF-058, TOF-059
- **Approach** Clock card, balance cards, coming up, team today. The AI card
  shows deterministic bridge days with templated text until TOF-085.
- **As built** `apps/web/timeoff/src/overview/`. The shell finds the bridge
  days (`lib/timeoff-views.ts`, Monday to Friday) and passes the year's
  holidays and when it asked, so the timer starts from the server's minute
  and ticks in its own component. Balance cards have no context line yet
  (the view carries no next accrual or carry-over), and team today lists
  who is away without the In and Remote counts, which only the manager's
  right-now view has. Reach gained `ListItem iconTone`, `Stat` children and
  icons for time away. A Time Off page in flight draws its screen with
  `load: loading` under the real header (`TimeOffLoading`), once the
  remote's code is in the page.

### [x] TOF-062 — Request time off

- **Screens** T3, MT5, MT6, MT7 · **Spec** PRD §8.2
- **Depends on** TOF-061, TOF-053
- **Approach** Web: a side panel over the overview at `/time-off/request`.
  Phone: type sheet, date step with the bottom bar, review step. The preview
  comes from the server on every change.
- **As built** `apps/web/timeoff/src/request/`. What is asked lives in the
  address (`type`, `from`, `to`, `half`, `month`, and a phone's `step`), so
  every change is a client navigation that reads `TimeOffRequestPanel` again
  beside the overview behind, the team's month (dots, days already short) and
  the year's holidays (struck). A range half chosen stays in the screen until
  its last day is. `Half day` makes the last day a half day. Dates Time Off
  refuses are said in the panel, drawn without them. One component: a
  `Sheet` side panel at a desk; under a finger the type sheet, then the dates
  and the review full screen, each part `touch:hidden` off its step. "Who
  else is off" and the clash's names come from the team's month; the
  preview carries neither. Sending opens the new request.

### [x] TOF-063 — Going below zero

- **Screens** T5, MT9 · **Spec** PRD §7.4
- **Depends on** TOF-062
- **As built** In the panel: the warning, what borrowing means (next
  year's start, final pay, the approvals), and the choice. Borrowing is what
  sending does within the limit; shortening asks for the dates that fit
  (`to`, `half`), so the preview follows. **Unpaid is shown and disabled**:
  `LeaveRequestInput` carries no choice, and two requests split at a half
  day are refused as an overlap, so making days unpaid needs a contract
  field first. Past the limit the send is refused with the limit and the
  shorten offered. Days only, never money (§7.4, Phase 1).

### [x] TOF-064 — My requests and the timeline

- **Screens** T6, MT10 · **Spec** PRD §8.3
- **Depends on** TOF-062
- **Approach** Tabs Upcoming, Past, Cancelled as routes; the timeline shows
  integration steps only when integrations are connected (Phase 3).
- **As built** `apps/web/timeoff/src/requests/`. Each tab is its own
  component name in `routes.json` (`MyRequestsUpcoming`, `…Past`,
  `…Cancelled`), because the shell's loader reads the name, not the path. At
  a desk the list sits beside the request: a tab's first, or the one at
  `/time-off/requests/:id` beside the tab it belongs to; below 40rem one or
  the other (MT10). The timeline is what `TimeOffRequest` knows: sent, each
  approver in the chain against its step (roles, not names: the detail
  carries no decider or time), a suggestion or change waiting, cancelled or
  taken, and "No payroll change" for annual leave only, as the item carries
  no paid flag. A manager's suggested dates are one tap each, or keep your
  own. Someone else's request (an approver, HR) is drawn alone.

### [x] TOF-065 — Change or cancel

- **Screens** T7 · **Spec** PRD §8.4
- **Depends on** TOF-064
- **As built** One dialog from "Change dates" or "Cancel request": move
  (a new range, the booked dates highlighted; the old ones stay booked),
  shorten (a new last day before the old one) or cancel. A request nobody
  has decided offers only "Withdraw it". Time Off's refusal is said in the
  dialog.

### [x] TOF-066 — Where the days went

- **Screens** MT20 (and a web equivalent from the balance card) · **Spec** PRD §7.1
- **Depends on** TOF-061
- **As built** `apps/web/timeoff/src/balance/` at `/time-off/balances/:type`,
  linked from each overview balance card ("Where the days went"). The
  balance with its meter beside every ledger line of the leave year, newest
  first; a line recorded on another day than it is effective says so, and a
  superseded line is left out once. MT20's "lost on 31 Mar" warning waits
  for the view to carry the carry-over rule.

### [x] TOF-067 — Holidays where you work

- **Screens** MT21 · **Spec** PRD §10.2
- **Depends on** TOF-061
- **Approach** "Add to my calendar" uses the iCalendar feed.
- **As built** `apps/web/timeoff/src/holidays/` at `/time-off/holidays/:year`:
  this year and next as a segmented control, the layers resolved, a moved
  holiday saying so, and the bridge day (`bridgeDays`, never one already
  booked). The personal (`me`) feed now carries the holidays where the
  member works (`application/calendar/ical.ts`); the button issues it and
  shows its address to copy or open as `webcal:`. The feed's origin is
  `TIMEOFF_PUBLIC_URL` (default `http://localhost:4002`), which the tunnel
  must route before it works outside development.

### Screens — manager

### [x] TOF-068 — Approvals queue

- **Screens** T16, MT15 · **Spec** PRD §9.2
- **Depends on** TOF-058, TOF-038
- **Approach** Reasons are templated from the triage reason until TOF-086.
- **As built** `apps/web/timeoff/src/approvals/`. `/time-off/approvals/waiting`
  draws Clear to approve and Look closer as the domain splits them, each row
  with its templated line (`words.ts`); Approve all sends the clear rows still
  ticked and Time Off refuses anything else with why. Coming up and Decided
  list their requests. Under 40rem a row's title link covers the row and the
  checkboxes and per-row buttons go (MT15). The shell's loader passes the
  route (`loadScreen(component, query, path)`), so one component serves the
  tabs.

### [x] TOF-069 — Deciding one request

- **Screens** T17, MT16 · **Spec** PRD §9.4
- **Depends on** TOF-068, TOF-054
- **As built** `/time-off/approvals/waiting/:id`, owned by the Waiting tab: the
  queue and the request side by side in `ListDetail` (the request replaces the
  list on a phone, MT16). The decision view gained `lastTaken` and
  `alternatives`; the team comes from `TimeOffCalendarTimeline` around the
  dates (`lib/timeoff-calendar-views.ts`), twelve days at a desk and the
  working week on a phone. What to know is templated from the domain's
  numbers until TOF-087. No deadlines from Projects: that module does not
  exist.

### [x] TOF-070 — Suggesting other dates

- **Screens** T18 · **Spec** PRD §9.5
- **Depends on** TOF-069
- **Approach** Options from TOF-022; templated message until TOF-088. The
  employee's accept is one tap on their request (TOF-064).
- **As built** `…/waiting/:id/suggest`, a dialog over the request: the
  requester-only alternatives with their coverage, or dates picked by hand,
  and a drafted, editable message. **The counter-proposal carries no message**
  (`CounterBody`, `timeoff.request.counter_proposed`), so the dialog says it
  is not sent and offers to copy it; carrying one is a contract and storage
  change for its own ticket.

### [x] TOF-071 — Delegation

- **Screens** T19 · **Spec** PRD §9.7
- **Depends on** TOF-068
- **As built** `/time-off/approvals/delegation` is its own component
  (`Delegation`). The view gained `approverId` (whose delegate it is) and
  `escalatesTo` (the caller's manager). Beside the form, whom the caller
  covers for; the design's "recent delegated decisions" waits for a read
  that has them.

### [x] TOF-072 — Team calendar

- **Screens** T12, T13, T14, MT13, MT14 · **Spec** PRD §10.1
- **Depends on** TOF-054, TOF-040
- **Approach** Month, timeline and year as routes; team, types and holiday
  filters in the query string; Subscribe gives the feed URL.
- **As built** `apps/web/timeoff/src/calendar/`. Month and timeline read
  `TimeOffCalendarTimeline` over the month and the phone's week; the year is
  `CalendarHeatmap`. Scope, team, `month`, `week` and `year` are navigations;
  `types` (the legend toggles), `holidays` and `day` are noted in the address
  without a round trip. A day opens from the grid as a popover, a sheet on a
  phone: Reach's `Scheduler` gained `detail`/`onDismiss` for a month's day and
  a rows view's day heading. Calendar people carry `teamName`. Subscribe
  issues a token and shows `TIMEOFF_FEED_BASE?token=…`; nothing public fronts
  Time Off's feed yet.

### [x] TOF-073 — A clash, and how to solve it

- **Screens** T15 · **Spec** PRD §9.6
- **Depends on** TOF-072, TOF-022
- **As built** On the timeline, the waiting request on a day below the
  minimum (`?request=` picks one) opens beside it with every alternative in
  the domain's order; the requester's become a suggestion, approving as
  asked a decision, and asking a teammate is said, not sent.

### Screens — attendance

### [x] TOF-074 — My timesheet

- **Screens** T20, MT17 · **Spec** PRD §11.3
- **Depends on** TOF-052, TOF-042
- **As built** `apps/web/timeoff/src/attendance/timesheet.tsx`, export
  `Timesheet`. `?week=` (any day of it) or `?month=YYYY-MM`, this week by
  default; anything else is this week with a notice. A table at a desk; under
  40rem each row reflows to day, worked and status over the bar. The side
  panel has the period's total against the schedule, overtime waiting and
  approved (comp time banked is the overview's balance, not repeated), the
  retention line and §11.2's "never records". Retention reads "4 years,
  Spanish law" and "your manager" until Time Off sends the pack's retention
  and the manager's name.

### [x] TOF-075 — Fixing a missed clock-out

- **Screens** T21, MT18 · **Spec** PRD §11.4
- **Depends on** TOF-074
- **Approach** Without TOF-089 the dialog asks for a time with no suggestion.
- **As built** An open day's alert and its row's Fix open the dialog, as
  does `?fix=YYYY-MM-DD` (the morning notification's link). It shows the day
  with the chosen end, worked and overtime as you pick, and sends
  `CorrectTimeOffPunch` with `supersedes: null` (a new clock-out beside the
  record) through the `correctPunch` action; the wall time becomes an
  instant in the member's zone in the remote (`instantAt`).

### [x] TOF-076 — Clocking in and out on a phone

- **Screens** MT3, MT4 · **Spec** PRD §11.2, §16
- **Depends on** TOF-055, TOF-074
- **Approach** Slide to clock in; the one-time location check suggests Office
  and stores nothing; clock-out sheet shows the day. MT4's project split is a
  free-text "working on" until Projects exists.
- **As built** `ClockIn` and `ClockOutSheet` in `clock/clock.tsx`, used by
  the overview's card and the top bar's clock under a coarse pointer: where
  you work, then `Slider variant="confirm"`; Clock out opens the day first.
  Punches from a finger send `source: 'mobile'`. The location check
  (`clock/location.ts`) compares one Geolocation reading with the offices it
  is handed and keeps only the office's name; nothing hands it offices yet,
  as no Time Off read carries an office's coordinates, so until one does it
  never asks.

### [x] TOF-077 — Team, right now

- **Screens** T22, MT19 · **Spec** PRD §11.6
- **Depends on** TOF-074
- **As built** `attendance/team-now.tsx`, export `TeamNow`, from
  `TimeOffTeamRightNow` and today's `TimeOffCalendarDay` for who is away and
  until when. Counts, one row each with office or remote and today's bar
  (the bar is the desk's), and Needs you linking to the manager's timesheets
  tab. No AI line until TOF-084; a correction shows its date, not its time,
  as the board carries no zone.

### Screens — settings

### [x] TOF-078 — Leave types

- **Screens** T29 · **Spec** PRD §6.1
- **Depends on** TOF-041, TOF-058
- **As built** `apps/web/timeoff/src/settings/leave-types.tsx`: one `List` at
  every width, a row per type with its terms, who it reaches and who
  approves it (the approval rules, read beside it), each opening its
  policy. The settings views now carry `packs` (country, version,
  `reviewed`), so Spain's unreviewed pack is an `Alert` above the list and
  above the holidays. "Add leave type" and "Write a policy" are not here
  yet: the first needs its form, the second is T32 (TOF-094).

### [x] TOF-079 — Editing a policy

- **Screens** T30 · **Spec** PRD §6.2, §6.3
- **Depends on** TOF-078
- **Approach** The change preview is computed (TOF-093 adds shadow runs).
- **As built** `settings/leave-type.tsx` edits the policy chosen by
  `?policy=` (the type's first by default) as a draft behind `FormSaveBar`,
  and publishes it from the leave year's first day. The preview is
  `timeOffPolicyPreview`: `domain/policy/preview.ts` runs the entitlement
  fold over the draft and the version in effect for each member either
  reaches, and the screen groups who gets more, who fewer and who would
  lose days at the year end above the carry-over cap. "Preview as" is a
  `Select` kept in `?as=`, showing that member's allowance and year-end
  balance as `Stat from`, which leaves TOF-093 its shadow runs. Who a
  policy applies to is shown, not edited.

### [x] TOF-080 — Negative balance rules

- **Screens** T31 · **Spec** PRD §7.4
- **Depends on** TOF-078
- **As built** `settings/negative-balance.tsx`: the rule of the policy chosen
  under "For", as a `Toggle`, a `NumberField`, a `SegmentedControl` for who
  approves and two `RadioCard` groups, behind `FormSaveBar`. Saving revises
  the policy and publishes it from today, or joins the policy's draft when
  it has one (said above the form). "What people see" is the sentence a
  request that crosses zero shows (`negativeSentence`). The design's "Right
  now" figures and the count of contracts without a final-pay clause need
  data Time Off does not have (balances by sign; contracts), so the page
  says what to check instead.

### [x] TOF-081 — Attendance rules

- **Screens** T33 · **Spec** PRD §11.5
- **Depends on** TOF-078
- **As built** `settings/attendance-settings.tsx`: breaks, rest and the
  weekly maximum in the hours a form asks for (saved in minutes), and what
  overtime becomes with its rate, behind `FormSaveBar`. "What Kithena never
  records" is an `Alert` on the page. Ways to clock in lists the two Phase 1
  has (web, mobile) and the office-area check as off, without switches:
  readers and the kiosk are TOF-107 onwards, and reminders, automatic
  clock-out and schedules other than the default have no rule in Time Off
  yet, so the page shows the default schedule rather than a list to edit.

### [x] TOF-082 — Approval rules and team minimums

- **Screens** T34 · **Spec** PRD §9.1, §9.3
- **Depends on** TOF-078
- **As built** `settings/approval-settings.tsx`: each rule as a field named
  for what it covers ("Any request below zero", "Parental leave plans"),
  its chain read as "Request → Manager → HR" and chosen from a `Select`;
  automatic approval as checkboxes, the sick threshold a `NumberField`;
  each team's minimum as none, people or a share. One save sends the rules
  and only the minimums that changed (`saveApprovals`). Rules are edited,
  not added or removed, and "If nobody decides" waits for the escalation
  settings to be readable.

### [x] TOF-083 — Holiday calendars

- **Screens** T36 (without the AI draft) · **Spec** PRD §10.2
- **Depends on** TOF-078
- **As built** `settings/holiday-settings.tsx`: the year in the path
  (`/settings/time-off/holidays/2027`, this year without one) switched by a
  `SegmentedControl`, the work locations as a `List` of links keeping
  `?location=`, and the chosen location's resolved days with the layer each
  comes from and any move. Spain's unreviewed pack is the same notice as on
  leave types. Read-only: saving a layer and assigning layers to a location
  have their operations, and need their forms.
  `settings/settings.phone.test.tsx` draws every settings screen at 390×844
  under the Settings frame: axe with contrast, the 44px floor (People's
  measure, `test/floor.ts`) and no sideways scroll.

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

### [x] TOF-093 — Policy preview, preview as a person, shadow runs

- **Screens** T30 · **Spec** PRD §6.3
- **Depends on** TOF-079
- **As built** Preview and preview-as were TOF-079's. A shadow run is
  `startTimeOffShadowRun` (PUT `/policies/{id}/shadow`, HR, a draft only):
  the draft runs beside the version in effect for a month from today, kept
  in the `policy_shadows` setting and ended by publishing or
  `stopTimeOffShadowRun`. `timeOffPolicyPreview` carries `shadow`: each
  member's credited allowance and balance under both, folded to today (or
  the run's last day once over) by `shadowBalances`, the preview's fold cut
  at a date. Nothing is posted and only HR's settings read it. T30's "Shadow
  run" section starts and stops it and lists whose balance differs.

### [ ] TOF-094 — Write a policy in plain words

- **Screens** T32 · **Spec** PRD §6.4
- **Depends on** TOF-084, TOF-093

### [x] TOF-095 — Exceptions for HR and the inspector export

- **Screens** T23 · **Spec** PRD §11.7
- **Depends on** TOF-042
- **As built** `domain/attendance/exceptions.ts`: `exceptionsOf` (a day
  never clocked out, rest under the rules' minimum, overtime nobody decided,
  a holiday worked where the member works) and `dailyRecord` (each shift's
  start, end and breaks as wall times in the member's zone, from the
  punches that stand). `timeOffAttendanceExceptions` (HR, a year at most)
  answers every member's over a period; `timeOffInspectorRecord` answers the
  record as CSV (formula-safe) or a landscape A4 PDF (pdfkit, Noto Sans
  vendored in `services/timeoff/assets/fonts`, as People's exports), base64,
  which `apps/web/src/app/time-off/downloads/inspector` turns into a
  download. `attendance/exceptions.tsx` at `/time-off/attendance/exceptions`:
  the month in `?month=`, the four kinds with their count and why each
  matters, the open kind's people beside them (`?kind=`). The design's "What
  changed in September" card is TOF-097's.

### [x] TOF-096 — Close the month for Payroll

- **Screens** T24 · **Spec** PRD §11.8
- **Depends on** TOF-027, TOF-095
- **Approach** Publishes `timeoff.period.closed` with hours and amounts, never
  punch times or locations.
- **As built** `timeoff.period.closed` members gained `overtimeAmount`
  (`Money`, minor units, `null` by default, the array now classified
  financial): `close` prices paid overtime at the T33 multiplier with
  decimal.js when it is handed an hourly rate. No module tells Time Off a
  rate yet, so it passes none and Payroll gets hours (ponytail in
  `closePayPeriod`). `monthSummary` counts each team's people, who is late
  (a day without a clock-out or overtime undecided), overtime and how it is
  paid, and the totals; `timeOffPayPeriod` reads a month live, or as its
  lines once closed. `remindTimeOffPayPeriod` asks the late for their
  clock-outs and their managers for the overtime (the new `overtime_waiting`
  notice), once a day each. `attendance/pay-period.tsx` at
  `/time-off/attendance/pay-period`, last month by default: the teams'
  table, the totals, the late flagged with "Remind them", and "Send
  September to Payroll", held until the month is over.

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

### [x] TOF-100 — Parental entitlement (domain)

- **Spec** PRD §12.1, §12.3 · **Files** `services/timeoff/src/domain/parental/`
- **Depends on** TOF-028
- **Done when** Adam's answers give 6 + 11 + 2 weeks and Acme's 2 weeks.

### [x] TOF-101 — The plan and its validation (domain)

- **Spec** PRD §12.2 · **Depends on** TOF-100
- **Done when** a block of 10 days is refused (whole weeks), a flexible block
  past the deadline is refused, and notice reminders fall 15 days before each
  flexible block.

### [x] TOF-102 — Parental application, storage and events

- **Depends on** TOF-101, TOF-034
- **As built** `application/parental/parental.ts`. Four answers start a
  private draft laid out from the entitlement (mandatory at the child's
  date, every flexible week straight after, then the company's); answers
  that change nothing the entitlement reads keep the dragged blocks. A
  draft's blocks are replaced whole and kept even when a rule breaks
  (`problems` on every read); sending refuses it. Nobody but the parent
  reads a draft, HR included. Sending tells the manager and HR
  (`parental_plan_sent`); HR approves; the parent or HR records the birth,
  which raises the new `timeoff.parental.birth_recorded` (birth date
  `asIdentity`) for a sent plan only. The `parental-notices` job tells the
  parent on the day a flexible block's notice falls due. `parental_plan`
  keeps the answers, the company's weeks as they were, the country whose
  pack decided the law, what the team sees and the handover; one open plan
  per member is a partial unique index. The company's weeks are the
  `parental_company` setting (Acme: 2 after a year, booked as its own
  `company_parental` type); there is no settings screen for it yet. The
  checklist is computed: the entitlement step is done when the rules hold,
  the manager step once sent, the certificate is to do, Payroll and Benefits
  are `elsewhere` with their module, the birth certificate is scheduled for
  3 days after the due date. Routes: `timeOffParentalPlan` (with answers in
  the query, the entitlement unsaved), `timeOffParentalCase`, and
  answer, blocks, handover, send, approve, birth.

### [x] TOF-103 — Reach: draggable lane track

- **Spec** PRD §15.3 · **Depends on** nothing
- **Approach** `TimelineChart` lanes with segments draggable by pointer and
  keyboard through `@dnd-kit`, with the live-region announcements.

### [x] TOF-104 — Plan parental leave and your plan

- **Screens** T8, T9, MT11 · **Depends on** TOF-102, TOF-103
- **As built** `apps/web/timeoff/src/parental/plan.tsx`, one step per
  address: `about` (T8), `plan` (T9), `handover` and `send` (T10, split so
  each of the Stepper's four steps is its own URL). `/plan` before there is
  a plan asks the four questions, so Overview's link still lands. T8's
  entitlement is Time Off's, asked through a server action as the answers
  change and saved nowhere. T9 drags whole weeks on `TimelineChart
variant="track"` (mandatory pinned, unbooked later weeks hatched) and
  saves the blocks on drop; under 40rem it is MT11's vertical list. "Why
  this plan" is templated from Time Off's numbers until TOF-092; pay is per
  payer and period, without Payroll's "Synced" badge.

### [x] TOF-105 — Handover and send

- **Screens** T10, MT12 · **Depends on** TOF-104
- **As built** The handover is typed by hand (work, who covers it) until
  Projects exists; out-of-office, chat status and meetings are shown off
  and disabled, each naming the integration it waits for (TOF-110, TOF-111).
  What the team sees is chosen on T8 and again here. `send` holds the
  summary, "The dates follow the birth" and "Private until you send it";
  Send is disabled while a rule breaks. A sent plan is shown as sent at
  every step, with the birth to record.

### [x] TOF-106 — HR's view of the case

- **Screens** T11 · **Depends on** TOF-105
- **As built** `apps/web/timeoff/src/parental/case.tsx` at
  `/time-off/parental/cases/:id`: the track read-only, the checklist with
  Payroll and Benefits named as their modules, the rules check as the
  domain's `problems` (each rule passed or broken, and each block's notice),
  who can see it and the handover. HR and the manager read it once sent;
  only HR approves, and only while the rules hold. "Message Adam" and an HR
  list of cases wait for messaging and an HR queue; a case is reached by
  its link.

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
