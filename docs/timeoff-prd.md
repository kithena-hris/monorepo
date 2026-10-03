# Product Requirements Document: The Time Off module

**Version**: 1.0
**Date**: 2026-10-03
**Status**: Draft for engineering review

---

## How to read this

**Building it?** The ordered tickets are in
[`docs/timeoff-build-plan.md`](./timeoff-build-plan.md). The screens are in the
Claude Design project `6fed6ac8-1267-4f58-b7be-3b845ed13224`, pages
**Kithena Time Off** (web, 36 screens, `T1`–`T36`) and **Kithena Time Off
Mobile** (21 screens, `MT1`–`MT21`). Their readable source is
`_build/to-core.js`, `_build/to-web.js` and `_build/to-mobile.js`; a copy is kept
under `.claude/design/timeoff/` for agents that cannot read the design project.

This document specifies the Time Off module end to end: leave types and the
policies behind them, balances and the ledger that explains them, the request
lifecycle, approvals, team calendars and coverage, public holidays, attendance
(the clock, timesheets and the month close), parental leave planning, the kiosk,
and the AI that sits on top of all of it.

The questions that were open when this was written are answered here, with the
reasoning in place so the answer can be argued with:

| Question                                                            | Answer                                                                           | Where                                  |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------- | -------------------------------------- |
| Where does Time Off get people, managers, teams and locations from? | Its own projection, fed by People events or by an import when People is absent   | [§5](#5-where-the-boundary-sits)       |
| Is a balance a number or a history?                                 | A history. The number is a fold over an append-only ledger                       | [§7](#7-balances-and-the-ledger)       |
| Can a balance go below zero?                                        | Yes, within a per-policy limit, and the request says what it costs               | [§7.4](#74-going-below-zero)           |
| Do team minimums block a request?                                   | No. They warn the employee and inform the approver                               | [§9.3](#93-team-minimums-and-coverage) |
| Is attendance part of this module?                                  | Yes. One clock, three sources, no surveillance                                   | [§11](#11-attendance)                  |
| What does the AI decide?                                            | Nothing. Domain code computes every number; AI reads sentences, ranks and writes | [§14](#14-ai)                          |
| What about the Live Activity, the Dynamic Island and NFC?           | Out of scope for the web build. They need a native shell                         | [§16](#16-mobile)                      |

Everything the module inherits from the repository — no cross-module imports,
Zod as the single schema source, effective dating on everything, money in minor
units, calendar dates as `date`, no `new Date()` in domain code — is assumed
rather than restated.

---

## 1. Executive summary

Time off is the module employees open most, and the one most HRIS products get
most wrong. The request form is easy. Everything around it is not: the balance
nobody can explain, the clash the manager finds out about after approving, the
holiday that applies in Madrid and not in Barcelona, the overtime that was worked
and never recorded, the parental leave that has to fit a law with fixed and
flexible parts.

Kithena's Time Off answers those directly. An employee sees the balance after a
request before sending it, sees who else is off on the calendar while picking
dates, and is told about a clash rather than blocked by it. A manager gets a
queue already split into what is clearly fine and what needs a look, with the
one-line reason. HR writes policies in plain words and sees who gains and who
loses before publishing. Attendance is one clock across the badge reader, the
web and the phone, and the month closes for Payroll in one step.

It also has to stand alone. A company running Workday for people data can buy
Time Off by itself. So the module owns its own projection of the people it
serves, its own API, its own events, and boots with no sibling present.

---

## 2. Problem statement

### Current situation

`services/timeoff` exists as a manifest, a `LeaveRequest` aggregate with
`request()` and `approve()`, a subgraph that answers `leaveBalanceDays: 0`, and
two test harnesses. `packages/contracts/src/events/timeoff.ts` defines four
events. The shell lists "Time off" in its navigation, disabled. There is no
storage, no balance, no policy, no calendar, no screen.

The existing aggregate also encodes a rule the design overturns: it refuses a
request larger than the balance. Section 7.4 replaces that.

### Proposed solution

A module in four parts, built in this order:

1. **Policy and balance**: leave types, policies, accrual, carry-over, and a
   ledger that explains every balance.
2. **Requests and approvals**: the request lifecycle, change and cancel,
   approval chains, delegation, escalation, team minimums.
3. **Calendars and attendance**: team calendar, holiday calendars, the clock,
   timesheets, corrections, overtime and the month close.
4. **Planning and assistance**: parental leave, the kiosk, integrations, and
   AI that ranks and explains without deciding.

### Business impact

- Time off is the first module most buyers evaluate. It sells People.
- Attendance records are a legal obligation in Spain (Real Decreto-ley 8/2019,
  four-year retention) and an inspector's first request. Shipping it inside
  Time Off removes a second vendor.
- The month close removes the spreadsheet between attendance and payroll.

---

## 3. Success metrics

### Primary KPIs

| Metric                          | Target                   | How measured                                  |
| ------------------------------- | ------------------------ | --------------------------------------------- |
| Time to send a request          | Under 30 seconds, median | Panel open to `timeoff.request.requested`     |
| Decisions within 3 working days | 100%                     | Escalation guarantees it; alert on any breach |
| Balance questions to HR         | Down 70% after rollout   | Support tag, tenant survey                    |
| Missed clock-outs               | Under 5% of working days | Attendance exceptions per period              |

### Secondary

- Requests changed rather than cancelled-and-resent: above 50% of changes.
- Clashes approved with a recorded reason: 100% (the approver sees every clash).

### Validation

`just standalone timeoff` boots the module with no siblings and runs the
acceptance suite. The suite proves the request-to-approval path, the ledger, a
negative balance within its limit, a clash warning, a clock-in to clock-out day
and a month close, with People absent.

---

## 4. Personas

The design uses three people at Acme, and every screen is labelled with one.

### Adam Novak — employee (primary)

Backend engineer in the Madrid office. Wants to know how many days he has, book
them without a back-and-forth, and clock in without thinking about it. Is
planning parental leave for a baby due 14 January 2027.

### Marco Ruiz — line manager (primary)

Engineering manager of Platform, 7 people. Wants a short queue, the context to
decide in one screen, and never to find out about a clash after approving. Is
away 13–16 October, so his approvals go to a delegate.

### Ada Lovelace — HR admin (primary)

Runs HR operations for Acme across Spain, Germany and the UK. Owns policies,
holiday calendars, attendance rules and the month close. Answers to the labour
inspector.

### An office kiosk (secondary)

A wall tablet or badge reader at an entrance. Not a person, but a client with
its own trust level: it may punch, it may never show personal data.

### A third-party integrator (secondary)

Connects a payroll engine or a calendar. Needs stable events, a REST API and
webhooks that do not assume a Kithena screen.

---

## 5. Where the boundary sits

### 5.1 What Time Off owns

Leave types, policies, entitlements, the balance ledger, requests and their
decisions, delegations, team minimums, holiday calendars, schedules, punches,
timesheets, overtime, pay periods, parental leave plans, kiosks and their
devices.

### 5.2 What it does not own, and how it learns it

Time Off needs to know who a person is, who manages them, which team they are
in, where they work and when they started. **People owns all of that.** Time Off
keeps its own projection, `timeoff.member`, holding only what it needs:

| Field                                      | Why Time Off needs it     | Source when People is present                    | Source when People is absent |
| ------------------------------------------ | ------------------------- | ------------------------------------------------ | ---------------------------- |
| `personId`                                 | Identity                  | `people.person.hired`                            | Import or SCIM push          |
| `displayName`, `firstName`                 | Screens, kiosk greeting   | `people.person.hired`, `profile_updated`         | Import                       |
| `managerPersonId`                          | Approval chain            | `people.person.manager_changed`                  | Import                       |
| `teamKey`, `teamName`                      | Calendar, minimums        | `people.person.org_changed`                      | Import                       |
| `locationKey`, `country`, `region`, `city` | Holidays, statutory rules | `people.person.org_changed`, `people.location.*` | Import                       |
| `hireDate`, `terminationDate`              | Pro-rata, tenure          | `hired`, `terminated`                            | Import                       |
| `workPattern`                              | Working days              | Policy default; overridable here                 | Policy default               |
| `status`                                   | Active, on leave, left    | `status_changed`, `terminated`                   | Import                       |

The projection is an anti-corruption layer. A People event is translated into a
Time Off command; nothing downstream reads a People payload. When People is
absent, `POST /v1/timeoff/members:import` (CSV or JSON) and a SCIM 2.0 endpoint
feed the same commands. `module.manifest.ts` keeps `dependsOn: []`,
`enrichedBy: ['people']` and `requiresPeopleSource: 'either'`.

### 5.3 What Time Off tells others

Events (§13). Payroll, Benefits and Projects are modules that do not exist yet.
Time Off publishes what they would need and consumes nothing from them in Phase

1. Where a screen shows data from one of them (a Projects deadline, a Payroll
   amount), it shows it only when an enrichment source is configured, and the
   screen is designed to read correctly without it.

### 5.4 Things the design shows that need a module we do not have

| Design element                                         | Needs                 | Phase 1 behaviour                                          |
| ------------------------------------------------------ | --------------------- | ---------------------------------------------------------- |
| "Billing v2 release on Thu 22" in approvals (T14, T17) | Projects              | Omitted                                                    |
| "Working on Billing v2" in the clock (T2, MT4)         | Projects              | A free-text "working on" label                             |
| Handover suggestions (T10)                             | Projects              | Manual handover list                                       |
| "Pause salary in Payroll" (T11, T24)                   | Payroll               | Published as an event; shown as "Sent to Payroll"          |
| "Add the baby as a dependent" (T11)                    | Benefits              | Checklist item linked to nothing, marked "Benefits module" |
| Calendar and Slack status (T6, T10)                    | External integrations | Phase 3, behind ports                                      |

---

## 6. Leave types and policies

### 6.1 Leave type

A leave type is a tenant-owned definition of a kind of time off.

| Field          | Meaning                                                                                                                |
| -------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `key`          | Immutable slug: `vacation`, `personal`, `sick`, `parental`, `comp`, `unpaid`, `bereavement`, …                         |
| `name`         | Localised label                                                                                                        |
| `category`     | Maps to the contract `AbsenceKind` for consumers that do not know the tenant's types                                   |
| `colorToken`   | One of `--reach-chart-1`…`6`, `fg-3` (away), `fill-strong` (holiday)                                                   |
| `icon`         | A Lucide name from the design's set (`sun`, `coffee`, `thermometer`, `baby`, `timer`, `circle-slash`, `plane`, `flag`) |
| `unit`         | `day` or `hour` (comp time is hours)                                                                                   |
| `tracked`      | Whether it draws a balance (`sick` does not)                                                                           |
| `paid`         | `paid`, `unpaid`, `statutory` (paid by a third party, e.g. Social Security)                                            |
| `approval`     | Reference to an approval rule (§9.1)                                                                                   |
| `visibility`   | What teammates see: the type, or only "Off" / "Away"                                                                   |
| `requiresNote` | E.g. sick: a note after 3 days                                                                                         |
| `appliesTo`    | Country, legal entity, contract type predicates                                                                        |
| `statutory`    | Pre-filled per country; cannot be deleted, only hidden                                                                 |

Statutory types come pre-filled per country pack (§12.3). Sick leave and
parental leave default to `visibility: off_only` for teammates: **teammates see
"Off" for sick days; types and reasons stay with the manager and HR** (MT14).

### 6.2 Policy

A policy attaches entitlement rules to a leave type for a population.

- **Allowance**: a base number per year, optionally **by tenure band** (T30:
  0–2 years 25, 3–5 26, 6–9 27, 10+ 28).
- **Year**: a start month and day (`1 Jan – 31 Dec` default).
- **Earning**: `upfront` or `monthly` (25/12 = 2.08 a month, credited on the 1st).
- **Pro-rata** for joiners and leavers, rounded up to the nearest half day.
- **Keep earning during parental leave** (default on; required by law in Spain).
- **Probation**: can book after N months, counted from day one (T32).
- **Carry-over**: up to N days, used by a date (`5 days by 31 Mar`). Anything
  above the cap expires at year end; anything carried and unused expires on the
  use-by date. Warnings go out on 1 Oct and 1 Dec (T30).
- **Requests**: half days allowed; show who else is off before sending; block
  below team minimum (default **off**: warn and let the manager decide).
- **Negative balance**: §7.4.
- **Applies to**: predicates over country, legal entity, contract type, location.

### 6.3 Publishing a policy change

A policy is versioned. A draft can be previewed before it is published:

- **Change preview** (T30): who gains days, who would lose days, and when. The
  preview is computed by running the new policy's fold over each affected
  member's ledger and comparing it with the current one. It is not an estimate.
- **Preview as a person** (T30 "Preview as Adam"): the employee view of the
  balance under the draft.
- **Shadow run** (T32): a draft can run alongside the current policy for a
  month so HR can compare balances. Shadow balances are never shown to
  employees.

Publishing writes a `timeoff.policy.published` event and re-folds affected
balances from the effective date. A change never rewrites history: entries
already posted stay, and a correction is posted as a new entry.

### 6.4 Writing a policy in plain words (T32)

HR may write the policy as handbook prose. The AI reads it into the structured
policy form above, shows the rules it understood, and **asks the one question it
cannot answer from the text** (T32: working days or calendar days). HR confirms
each rule. Nothing is created until HR presses "Create draft", and the draft is
an ordinary policy draft, tested on real people before it exists (§6.3). See
§14.

---

## 7. Balances and the ledger

### 7.1 A balance is a fold

Every change to what a person is owed or has used is an entry in
`timeoff.ledger_entry`, append-only:

| Kind          | Example                                  | Sign             |
| ------------- | ---------------------------------------- | ---------------- |
| `grant`       | Annual allowance on 1 Jan, upfront       | +                |
| `accrual`     | "Earned in October +2.08"                | +                |
| `carry_over`  | "Carried over from 2025 +3"              | +                |
| `expiry`      | "Lost on 31 Mar −1.5"                    | −                |
| `booking`     | "Booked · 19–23 Oct −5" (on request)     | − (pending)      |
| `taken`       | Booking settles when the dates pass      | −                |
| `release`     | Shortened or cancelled                   | +                |
| `borrow`      | Negative balance borrowed from next year | marker, see §7.4 |
| `adjustment`  | HR correction, always with a reason      | ±                |
| `comp_earned` | Overtime banked as comp time             | + (hours)        |

Each entry carries `occurredAt` (recorded) and `effectiveOn` (the domain date),
the policy version, and `supersedes` when it corrects another. A balance on any
date is the sum of entries effective on or before it. **Every number on a
screen is a fold over this ledger**, so "why do I have 11.5?" always has a
one-screen answer (MT20, "Where the days went").

### 7.2 What a balance card shows

T1 and MT1 show, per tracked type: days left (large), used, booked (pending,
hatched), the yearly allowance, and one line of context ("+2.08 on 1 Nov. Up to
5 carry into 2027."). Comp time shows hours banked and its use-by date. Sick
shows "Paid · no limit" with the note rule.

### 7.3 Working days

A request's cost is its **working days**, not calendar days: the dates between
`from` and `to`, minus non-working days in the member's work pattern, minus
public holidays in the member's holiday calendar (§10), with half days at the
boundaries. "Days away" (T4: 4 days used, 9 days away) is the length of the
continuous absence including adjacent weekends and holidays. Both are pure
domain functions with exhaustive tests.

### 7.4 Going below zero

A policy may let people go below zero:

- **How far**: up to N days, for named types (T31: up to 3, vacation only).
- **Who approves**: manager; manager then HR (default); HR only.
- **At year end**: take it from next year's allowance (default); make it unpaid
  (deducted from December pay); write it off.
- **If someone leaves while negative**: deduct from final pay (default, shown on
  the leaver's checklist and sent to Payroll); write it off; HR decides each
  time. Deduction from final pay needs a contract clause; members whose contract
  lacks it are written off instead, and the settings page says how many (T31).

A request that would cross zero is **a choice, not an error** (T5, MT9). The
panel offers:

1. Borrow N days from next year (suggested when it is within the limit), with
   next year's starting balance and the final-pay risk in money;
2. Make N days unpaid, with the estimated pay reduction;
3. Shorten to the dates that fit the balance.

The money figures are estimates from the member's daily rate when one is known
to Time Off (it is not, in Phase 1, without Payroll), so Phase 1 shows the
days and omits the euro amount rather than inventing it. A request beyond the
limit is refused with the limit in the message.

This replaces the existing `INSUFFICIENT_BALANCE` rule in
`services/timeoff/src/domain/leave-request.ts`.

---

## 8. The request lifecycle

### 8.1 States

```
draft ──▶ pending ──▶ approved ──▶ taken
            │  │          │
            │  │          ├──▶ change_pending ──▶ approved (new dates)
            │  │          │                   └─▶ approved (old dates kept)
            │  │          └──▶ cancelled
            │  ├──▶ declined
            │  ├──▶ counter_proposed ──▶ approved (employee accepted)
            │  │                     └─▶ pending   (employee kept own dates)
            │  └──▶ withdrawn
```

- `pending` posts a `booking` ledger entry, so the balance after is visible to
  everyone at once.
- `approved` keeps the booking; `taken` converts it once the last day passes.
- `declined`, `withdrawn` and `cancelled` post a `release`.

### 8.2 Requesting (T3, MT5–MT7)

One panel, three parts: **type** (with the balance beside each), **dates** (a
month calendar with teammates' days off as dots, clash days in red, holidays
struck through, full or half day), and **consequences** (working days, days
away, balance before → after, the clash explained, an optional note to the
approver). The approver is named on the button ("Send to Marco").

On mobile the same flow is a sheet of types (MT5), a full-screen date picker with
a bottom bar showing the count and the balance after (MT6), and a review step
answering how much is left, who else is off, and whether it causes a problem
(MT7).

### 8.3 After sending (T6, MT10)

"My requests" lists upcoming, past and cancelled requests. The selected request
shows a timeline: sent, approved by whom (and "for Marco, who's away" when a
delegate decided), what Kithena did in other tools (calendar, chat status,
out-of-office, Phase 3) and the payroll effect ("No payroll change · paid
vacation").

### 8.4 Change or cancel (T7)

- **Move the dates**: a change request. **The old dates stay booked until the
  new ones are approved**, so changing never leaves a gap.
- **Shorten**: approved automatically, because it only gives time back.
- **Cancel**: approved automatically; the days return to the balance at once.

Shortening and cancelling after the dates have started are refused for the days
already passed; HR can correct with an adjustment.

### 8.5 Sick leave

Sick is "tell, don't ask": recorded on the day, informing the manager, approved
automatically under the policy's threshold (default under 3 days). A note is
requested after N days. The note is special-category health data
(`asSpecialCategory('health')`, as the existing contract already marks it),
stored encrypted, never in an event payload except as a boolean `notePresent`,
and never sent to a model.

---

## 9. Approvals

### 9.1 Approval rules (T34)

A rule reads like a sentence: Request → Manager; Request → Manager → HR;
Plan → HR; Timesheet → Manager. Rules attach to leave types and to conditions
(below zero, unpaid, overtime). **Approved automatically**: shortening or
cancelling (default on), sick under 3 days (default on), one day of vacation
with the team above minimum (default off).

The approver for "Manager" is the member's `managerPersonId` from the
projection. A member without a manager falls through to HR. Authorization is
checked in the application layer through OpenFGA (`approver` relation on the
member), never only in a resolver.

### 9.2 The queue (T16, MT15)

"Waiting for me" is split into **Clear to approve** and **Look closer**, each
row with a one-line reason. **Batch approval covers only the clear ones.** The
footer says: "Sorted by Kithena using coverage, balances and deadlines. The
order never decides for you."

The split is a deterministic rule first:

- _Clear_: within balance, team stays at or above minimum on every day, no
  overlap with a protected period, sick under the threshold, comp within banked
  hours.
- _Look closer_: anything else, with the first failing rule as the reason.

The reason text is generated (§14) from the rule that fired and the numbers the
domain computed; the rule decides the group.

### 9.3 Team minimums and coverage

A team minimum is "at least N of M in" or "at least P% in, every weekday" (T34).
Coverage for a day is the members of the team not off (approved or pending) and
not on a holiday that day. Minimums **warn, they never block** (unless the
policy's "block below team minimum" is switched on): the employee sees "Wed 21
Oct: only 4 of 7 on Platform would be in", the manager sees the clash, and
decides.

### 9.4 Deciding one request (T17, MT16)

The decision screen shows the balance before → after, the team timeline around
the dates with coverage, the last time off taken, and an AI note ending with why
it might be fine. Decide by **Decline**, **Suggest other dates** or **Approve**.

### 9.5 Suggesting other dates (T18)

Instead of declining, a manager counter-proposes. Options are computed (the same
days with the clash day swapped, the next clean week, or dates picked by hand)
with the coverage of each. The message is drafted and editable. **The employee
accepts in one tap and the request is approved the moment they do.**

### 9.6 Clash fixes (T15)

When a request would break a minimum, Kithena proposes fixes ranked by who they
inconvenience: ask the requester to swap a day; approve as asked (and says
honestly when that is fine); ask the teammate whose day was approved first to
move (only if they offer). Ranking is deterministic: requester-only changes
first, then no change, then changes to someone else's approved time.

### 9.7 Delegation and escalation (T19)

- A delegate covers an approver for a date range, or **automatically whenever
  the approver's own time off is approved**.
- A delegate does not see salary-related requests unless allowed (off by
  default; overtime pay goes to HR instead).
- **If nobody decides**: after 3 working days the request goes to the
  approver's manager, with a daily reminder at 09:00. Nothing waits longer.
  Escalation runs as a Temporal workflow per pending request.

---

## 10. Calendars and holidays

### 10.1 Team calendar (T12–T14, MT13–MT14)

Three views of the same data, each its own URL:

- **Month** (T12): a grid with each person's time off as a chip, holidays per
  location, and days below minimum flagged with "4 of 7". Pending is outlined.
- **Timeline** (T13): one row per person, one column per day, a coverage row
  counting who's in against the minimum, red where it is not met.
- **Year**: a heatmap of days off per day.

Filters (team, types, holiday calendar) live in the query string. Clicking a
day (T14, MT14) shows who is off, the type (subject to visibility), whether
approved, and other modules' events that day when enriched.

Scopes: **Team**, **Company**, **Me** (MT13). An employee sees their team; a
manager sees their reports; HR sees everyone. Types follow §6.1 visibility.

"Subscribe" gives an iCalendar feed URL per scope, signed and revocable.

### 10.2 Holiday calendars (T36, MT21)

Calendars are **layered**: national + regional + city, assigned by work
location (Madrid = Spain + Comunidad de Madrid + Madrid city). "Remote" uses the
member's home location when known, else the legal entity's. A holiday falling on
a weekend follows the regional rule (moved or not) recorded on the calendar.

HR maintains calendars per year. Country packs ship the national layer. An AI
draft of next year (T36) is Phase 3 and works from data HR supplies or a
licensed dataset; it never publishes on its own, and leaves unconfirmed days for
HR.

---

## 11. Attendance

### 11.1 One clock

A member is `out`, `in` or `on_break`. Punches come from three sources: a badge
reader or kiosk, the web top bar, the phone. **There is one clock**: punching on
one source is visible on the others, and closing the tab does not stop it.

The clock lives **in the top bar on every page of Kithena** (T2), not only in
Time Off. The pill shows the running time; opening it shows the day as a bar,
the punches so far, "working on" (§5.4), Start break and Clock out. `⌥T`
toggles it.

### 11.2 The punch

A punch records `at` (instant), `kind` (`in`, `out`, `break_start`,
`break_end`), `source`, `workModel` (`office`, `remote`, `client`) and the
`device` for kiosks. **Location is checked only at the moment of punching, to
suggest "Office", and is never stored as coordinates** (MT3). The punch stores
the derived work model and, when a geofence policy is on, a boolean "inside the
office area".

**What Kithena never records**: no location trail, no screenshots, no keyboard
or app activity. Only the punches people make. This sentence appears on the
attendance settings page (T33) and the timesheet.

### 11.3 Timesheet (T20, MT17)

Each day is a bar from 07:00 to 19:00: worked, break, overtime, missing,
planned. The table shows in, out, breaks and worked. The side panel shows the
week total against the schedule, overtime (approved, waiting, comp banked) and
the retention line: "Kept for 4 years as Spanish law requires. Only you, Marco
and HR can see it."

### 11.4 Corrections (T21, MT18)

A missed clock-out is detected the next morning. The employee is asked when they
finished. A suggestion may be offered (§14) with the evidence it used — only
calendar events and Kithena activity, never screen time or location history.
**A correction never overwrites the original**: it is a new punch with
`supersedes`, and edits after 24 hours are shown to the manager beside the
original record.

### 11.5 Rules (T33)

- Ways to clock in: badge/phone at a reader, web top bar, mobile, only inside
  the office area (off by default), shared kiosk with PIN.
- Breaks and limits: break after 6 hours, 30 minutes; 12 hours' rest between
  days; weekly maximum (40h + 2h overtime); remind people not clocked out by
  20:00; automatic clock-out (off by default — "an automatic clock-out can hide
  real overtime").
- Schedules: fixed, flexible with core hours, seasonal (summer hours), rotating
  shifts.
- Overtime becomes: comp time (hour for hour), paid (at a multiplier, sent to
  Payroll), or the person chooses.

### 11.6 Team, right now (T22, MT19)

A calm live board: in, on a break, not in yet, away; per person, status, office
or remote, and today's bar. No location trail, no screen tracking. An AI line
says what is normal ("Ravi started at 10:12, which is inside Platform's
flexible hours") so managers do not chase non-issues. "Needs you" lists open
corrections and overtime awaiting approval.

### 11.7 Exceptions for HR (T23)

Only what needs action: missed clock-outs, less than 12 hours' rest, overtime
waiting for approval, worked on a holiday (day in lieu). Each with the legal
reason where there is one. **Export for the labour inspector**: the per-person
daily record (start, end, breaks) for a period, as CSV and PDF, which is what
the Spanish inspectorate asks for.

### 11.8 Closing the month (T24)

One step at month end: per team, people, timesheets approved or waiting,
overtime and how it is paid. Totals: overtime paid (hours; money when rates are
known), comp time banked, unpaid leave days, negative balances. Late items are
flagged with a reminder action. "Send September to Payroll" publishes
`timeoff.period.closed` with **hours and amounts, never punch times or
locations**. A closed period is locked; a later correction posts to the next
open period with `supersedes`.

### 11.9 Kiosk (T25, T26)

A wall tablet at an entrance, registered as a device of a location. Punch by
badge (NFC reader attached to the tablet, keyboard-wedge input), an NFC phone
(Phase 3, needs native), a PIN, or a personal QR code shown on the member's
phone. **It works offline**: punches queue locally with the device clock and a
monotonic sequence, and sync when the network returns; the server accepts them
with their recorded instant and flags clock skew above a threshold.

The confirmation shows **first name only**, the time, "Not you? Undo · 5", and
nothing else. **No balances or personal details ever appear on a shared
screen.** A kiosk authenticates as a device with a revocable token scoped to
punching at its location; it can read nothing.

---

## 12. Parental leave

### 12.1 Starting a plan (T8)

Four answers: you are the birth parent, the other parent, or adopting/fostering;
due date; two parents or a single parent; twins or more. Plus what the team
sees: "Parental leave" or just "Away" (HR and the manager always see the type).

The entitlement is worked out from **the law in the member's country plus the
company's own policy**, and shown in plain numbers before anything is planned:
for Spain (RDL 9/2025), 6 weeks straight after the birth full time, 11 weeks any
time before the child's first birthday (in the design, before 14 Jan 2028), 2
weeks any time before the child turns 8; paid at 100% by Social Security; Acme
adds 2 paid weeks after 1 year of service; vacation keeps accruing.

### 12.2 The plan (T9, MT11)

A timeline built around the law's fixed and flexible parts: mandatory, flexible
blocks, vacation earned while away, company paid weeks, weeks kept for later.
Blocks are dragged on the web and listed vertically on the phone. Pay while away
is shown per period (who pays, what). Notice deadlines are computed (each
flexible block needs 15 days' notice) and become reminders.

Validation is domain code from the country pack: flexible blocks in whole
weeks; flexible weeks end before the deadline; mandatory weeks start at the
birth; total within entitlement. **The AI explains the shape of the plan; it
does not validate it** (§14).

### 12.3 Country packs

The statutory rules (leave types, parental entitlements, attendance retention,
rest limits, holiday national layer) live in versioned country packs, as People
does for its own country rules. Phase 1 ships Spain. Germany and the United
Kingdom follow in Phase 3. Every pack needs a legal review before it is enabled
for a tenant.

### 12.4 Handover and send (T10, MT12)

Who covers what (manual in Phase 1; suggested from Projects when that module
exists), out-of-office, chat status and recurring meetings (Phase 3
integrations), and a summary. **Private until sent.** The dates follow the
birth: when the birth date is recorded, mandatory blocks move with it.

### 12.5 HR's view (T11)

The plan becomes a checklist: entitlement checked, manager told, company
certificate for Social Security (drafted from data HR confirms), pause salary
(Payroll module), add dependent (Benefits module), birth certificate (requested
3 days after the due date). Steps belonging to modules that do not exist are
linked, not duplicated. A rules check runs before HR approves.

---

## 13. Events

Every event carries `occurredAt` and `effectiveFrom`. Corrections carry
`supersedes`. Every field is registered with a classification policy.

| Event                                   | When                              | Notable fields                                                                  |
| --------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------- |
| `timeoff.request.requested` v2          | A request is sent                 | `leaveTypeKey`, `category`, `from`, `to`, half days, `workingDays`, `belowZero` |
| `timeoff.request.approved` v1 (exists)  | Approved                          | `approvedBy`, `onBehalfOf`, `workingDays`, `payroll`                            |
| `timeoff.request.rejected` v1 (exists)  | Declined                          | `reason` (free text)                                                            |
| `timeoff.request.counter_proposed`      | Manager suggests dates            | `proposals`                                                                     |
| `timeoff.request.changed`               | New dates approved                | `supersedes`                                                                    |
| `timeoff.request.cancelled`             | Cancelled or shortened            | `releasedDays`                                                                  |
| `timeoff.request.corrected` v1 (exists) | HR correction                     | `supersedesEventId`                                                             |
| `timeoff.balance.adjusted`              | HR adjustment, expiry, carry-over | `leaveTypeKey`, `delta`, `reason`                                               |
| `timeoff.policy.published`              | Policy version published          | `policyId`, `version`, `effectiveFrom`                                          |
| `timeoff.attendance.punched`            | A punch                           | `kind`, `source`, `workModel` — **no coordinates**                              |
| `timeoff.attendance.corrected`          | A correction                      | `supersedes`                                                                    |
| `timeoff.period.closed`                 | Month closed                      | per member: hours, overtime, comp, unpaid days, negative balance                |
| `timeoff.parental.plan_submitted`       | Plan sent                         | blocks, due date                                                                |
| `timeoff.parental.plan_approved`        | HR approves                       | blocks                                                                          |

The existing `LeaveRequested` v1 payload hardcodes `startsHalfDay: false` and
lacks the tenant's leave type; v2 adds it. v1 consumers are served by the
upcaster in `packages/contracts`.

---

## 14. AI

### 14.1 The rule

**The domain computes every number. AI reads sentences, ranks options the domain
generated, and writes text.** A balance, a working-day count, a coverage count, a
validation result or a legal entitlement is never produced by a model.

Two kinds of model call, both behind ports in `application/`, both through
`aiGateway` so classified fields never reach a model:

- **Judgments** (TypeSafe System One, as People's column advisor uses): pick one
  of N options, score a candidate. Used for: which group a request belongs to
  when the deterministic rule is ambiguous (never to override it), parsing
  "a week off in October next to a holiday" into structured choices.
- **Text** (the OpenAI-compatible assistant model): one-line reasons, the
  counter-proposal message, nudges, the "today in a sentence" line, the month
  summary, policy prose to structured rules.

Every AI feature degrades to a working screen without the key: the
deterministic options still show; the generated sentence is replaced by a
templated one. CI runs the standalone suite with and without the keys.

### 14.2 The features

| Feature             | Screen        | Domain does                                                               | AI does                                                   |
| ------------------- | ------------- | ------------------------------------------------------------------------- | --------------------------------------------------------- |
| Describe it         | T4, MT8       | Generates candidate date ranges, scores by days used, days away, coverage | Parses the sentence into chips; writes each option's line |
| Bridge days         | T1, MT1       | Finds holidays where 1 day buys 4                                         | Writes the card                                           |
| Approval sorting    | T16, MT15     | Groups by rule                                                            | Writes the reason                                         |
| What to know        | T17, MT16     | Computes coverage, balance, last break                                    | Writes the note                                           |
| Clash fixes         | T15           | Generates and ranks fixes                                                 | Writes the explanation                                    |
| Counter-proposal    | T18           | Computes options                                                          | Drafts the message                                        |
| Missed clock-out    | T21, MT18     | Collects evidence (last meeting end, last Kithena action)                 | Suggests a time from the evidence                         |
| Today in a sentence | T22           | Computes statuses                                                         | Writes the line                                           |
| Month summary       | T23, T27      | Computes trends                                                           | Writes the points                                         |
| Nudges              | T28           | Selects people, finds their bridge days                                   | Writes each message, per person, with only their data     |
| Plain-words policy  | T32           | Validates the structured policy, runs the preview                         | Parses prose into rules; asks the open question           |
| Plan explanation    | T9, T11, MT11 | Validates the plan                                                        | Explains its shape                                        |

Health data (sick notes, reasons) is never sent. Nudges never include another
person's data. Evidence for a clock-out suggestion is calendar event end times
and Kithena activity timestamps only.

---

## 15. Screens and navigation

### 15.1 Shell

The sidebar's **Time off** item expands to **Overview, Calendar, Requests,
Attendance, Insights** (Insights hidden from employees), with counts:
Requests (danger) and Attendance (warning). Settings gets a **Time off** group:
**Leave types, Holidays, Negative balance, Attendance, Approvals,
Integrations**. The clock pill sits in the top bar on every page. The account
menu's "My time off" goes to the Overview.

On a phone the tab bar gains **Time off** between Home and People (MT1).

### 15.2 Routes

Every tab and view is its own URL (no `?tab=`), filters in the query string, and
navigation is client-side with exact-shape skeletons.

| Route                                                                                                      | Screens                                                                             |
| ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `/time-off`                                                                                                | Redirects to `/time-off/overview`                                                   |
| `/time-off/overview`                                                                                       | T1, T2 (clock open), MT1                                                            |
| `/time-off/request`                                                                                        | T3, T5, MT5–MT7, MT9 (panel over the overview on web; full-screen steps on a phone) |
| `/time-off/request/describe`                                                                               | T4, MT8                                                                             |
| `/time-off/requests/upcoming` · `/past` · `/cancelled`                                                     | T6, T7, MT10                                                                        |
| `/time-off/requests/:id`                                                                                   | T6 detail, MT10                                                                     |
| `/time-off/approvals/waiting` · `/coming-up` · `/decided` · `/delegation`                                  | T16–T19, MT15, MT16                                                                 |
| `/time-off/calendar/month` · `/timeline` · `/year`                                                         | T12–T15, MT13, MT14                                                                 |
| `/time-off/attendance/timesheet` · `/requests` · `/schedule`                                               | T20, T21, MT17, MT18                                                                |
| `/time-off/attendance/now` · `/timesheets` · `/exceptions` · `/pay-period`                                 | T22–T24, MT19                                                                       |
| `/time-off/balances/:type`                                                                                 | MT20                                                                                |
| `/time-off/holidays/:year`                                                                                 | MT21                                                                                |
| `/time-off/parental/:step`                                                                                 | T8–T10, MT11, MT12                                                                  |
| `/time-off/parental/cases/:id`                                                                             | T11                                                                                 |
| `/time-off/insights/what-changed` · `/time-off` · `/attendance` · `/balances`                              | T27, T28                                                                            |
| `/settings/time-off/leave-types` · `/leave-types/:id` · `/leave-types/new/describe`                        | T29, T30, T32                                                                       |
| `/settings/time-off/negative-balance` · `/attendance` · `/approvals` · `/integrations` · `/holidays/:year` | T31, T33–T36                                                                        |
| `/kiosk/:deviceId`                                                                                         | T25, T26 (its own minimal shell, no sidebar)                                        |

Approvals live at `/time-off/approvals/*`; the design's sidebar label is
"Requests" for managers and HR, and "My requests" for employees, both under the
same item.

### 15.3 Components

Screens are built from Reach. The design's recipes map to existing components:
`Card`, `Stat`, `Badge`, `Chip`, `Avatar`, `List`/`ListItem`, `SegmentedControl`,
`Tabs`, `Calendar`, `DatePicker`, `TimePicker`, `Sheet`, `Dialog`, `Alert`,
`Banner`, `Stepper`, `Timeline`, `TimelineChart`, `CircularProgress`,
`Progress`, `Switch`, `Checkbox`, `RadioCard`, `Field`, `KeyValues`,
`PageHeader`, `DataTable`, `Skeleton`, `PinInput`, the chart family, and the
`Assistant*` set for AI cards.

Gaps, to be added to Reach first as variants on the nearest component, described
without knowing who is asking:

| Need                                                    | Becomes                                                                 |
| ------------------------------------------------------- | ----------------------------------------------------------------------- |
| Balance meter (used, booked hatched, total)             | `Progress` with `segments` and a `pattern="hatched"` segment            |
| Day bar 07:00–19:00 with segments and a now marker      | `TimelineChart` `variant="day"` or a new `RangeBar` in the chart family |
| Calendar with per-day dots, ranges, struck-through days | `Calendar` `markers`, `range`, `disabledStyle="strike"`                 |
| People × days grid with bars and a coverage row         | `Scheduler` `variant="rows"` with a `summaryRow`                        |
| Month grid with chips per day                           | `Scheduler` `view="month"`                                              |
| Month-scale track with lanes (parental plan)            | `TimelineChart` lanes with draggable segments (dnd-kit)                 |
| Slide to confirm (MT3)                                  | `Slider` `variant="confirm"`                                            |
| AI card with the gradient border                        | `Card` `tone="assistant"`                                               |
| Live pulse dot                                          | `Badge` `pulse`                                                         |
| Before → after value                                    | `Stat` `from`                                                           |

---

## 16. Mobile

Mobile is the same web app at phone width (container query below 40rem), with
the tab bar, sheets and full-screen steps the design shows. MT1, MT3–MT21 are in
scope.

Out of scope for this build, because the web platform cannot do them:

- **MT2, Live Activity and Dynamic Island**: needs a native iOS shell.
- **NFC phone punches at a reader**: Web NFC exists only on Android Chrome; the
  kiosk accepts badge readers and QR codes instead.
- **Slide to clock in in a pocket-proof way**: the slide is built (MT3); the
  "can't happen in a pocket" guarantee is weaker on the web.

They are listed in the build plan as blocked on a native shell.

The one-time location check (MT3) uses the browser Geolocation API with the
same rule: checked at the moment of clocking in, turned into "Office" or
nothing, never stored.

---

## 17. Storage

Schema `timeoff`, role `svc_timeoff NOBYPASSRLS`, every table with `tenant_id`,
`ENABLE` + `FORCE ROW LEVEL SECURITY` and the
`NULLIF(current_setting('app.tenant_id', true), '')::uuid` policy. Migrations in
the repository's single Atlas history, expand-contract only.

| Table                                         | Notes                                                                                                    |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `member`                                      | The projection (§5.2).                                                                                   |
| `leave_type`, `policy`, `policy_version`      | Versioned; published versions immutable.                                                                 |
| `ledger_entry`                                | Append-only. `numeric(9,3)` days or hours, `effective_on date`.                                          |
| `request`, `request_decision`                 | `daterange` with a `btree_gist` exclusion constraint so two live requests for one member cannot overlap. |
| `approval_rule`, `delegation`, `team_minimum` |                                                                                                          |
| `holiday_calendar`, `holiday`                 | Layered, per year.                                                                                       |
| `schedule`, `member_schedule`                 |                                                                                                          |
| `punch`                                       | Append-only; corrections supersede.                                                                      |
| `pay_period`, `pay_period_line`               | Locked when closed.                                                                                      |
| `parental_plan`, `parental_block`             |                                                                                                          |
| `kiosk_device`                                | Token hash only.                                                                                         |
| `outbox`                                      | `outboxTable('timeoff')`, added to the Debezium list.                                                    |

Retention: punches and timesheets 4 years after the period (Spain); requests and
the ledger for the life of employment plus the statutory floor; sick notes per
the health-data floor. DSAR export and the redaction paths are generated from
the contract registry as usual.

---

## 18. Headless surfaces

- **GraphQL**: the `timeoff` subgraph, extending `Person` with balances when
  People is present, and owning `TimeOffMember` otherwise.
- **REST**: `/v1/timeoff/...` with an OpenAPI spec generated from Zod, the same
  idempotency key handling as People.
- **Webhooks**: signed, for every published event.
- **iCalendar**: the calendar subscription feed.
- **SCIM 2.0**: member provisioning when People is absent (Phase 3).

---

## 19. Non-functional requirements

- Every screen renders its skeleton in the final shape; no blank page, no
  spinner-only page, no layout jump.
- Request panel open to send: under 30 seconds for a returning user.
- The clock pill updates every second without re-rendering the page.
- axe passes on every story and every screen.
- The standalone suite runs with no Postgres, no Kafka and no People.
- Every endpoint is tenant-scoped through RLS, and every write is authorised in
  the application layer.

---

## 20. Scope and phasing

### Phase 1 — boots alone, does the job

Leave types, policies, ledger, accrual, carry-over, negative balance; requests,
change, cancel, sick; approvals, the queue, counter-proposal, delegation,
escalation; team minimums; team calendar (month, timeline, year); holiday
calendars; the clock in the top bar, timesheet, corrections, team right now;
the settings pages T29–T31, T33, T34, T36; mobile MT1, MT3, MT5–MT7, MT9, MT10,
MT13–MT17, MT19–MT21. Spain country pack. AI features fall back to templates.

### Phase 2 — HR operations and assistance

Describe it, bridge days, AI reasons, clash fixes, missed clock-out
suggestions, exceptions, month close, insights and nudges, plain-words policy,
policy preview and shadow runs.

### Phase 3 — planning and reach

Parental leave (T8–T11, MT11, MT12), kiosk (T25, T26), integrations (T35:
calendar, chat, badge readers), Germany and UK country packs, SCIM, AI holiday
drafts, MT4's project split when Projects exists.

### Blocked on something we do not have

MT2 (native shell), NFC phone punches (native shell), Projects, Payroll and
Benefits enrichments (those modules).

---

## 21. Risks

| Risk                                   | Mitigation                                                                                                               |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Statutory rules are wrong              | Country packs are versioned and need a legal review before a tenant can enable them                                      |
| Attendance reads as surveillance       | No coordinates, no activity tracking, the promise on the settings page, an AI line that defuses non-issues               |
| A model invents a number               | Numbers are computed by the domain; AI output is text over computed values, and every AI feature has a template fallback |
| Overlapping requests under concurrency | `btree_gist` exclusion constraint on the request range                                                                   |
| Offline kiosk clock skew               | Device instants accepted with a skew flag; HR sees flagged punches as exceptions                                         |
| People events arrive out of order      | The projection applies by `effectiveFrom` and event version, and is idempotent per event id                              |

---

## 22. Dependencies

- Reach additions in §15.3.
- `@kithena/domain-kit` `Clock`, `packages/db-kit` tenant and outbox helpers.
- OpenFGA model additions: `approver`, `delegate`, `hr_admin` on a member.
- Temporal for escalation and the parental notice reminders; BullMQ for the
  nightly accrual and expiry jobs and the morning missed-punch check.
- TypeSafe and the assistant model for Phase 2 AI, both optional at runtime.

---

## Appendix A. Glossary

- **Working days**: days a request costs, after work pattern and holidays.
- **Days away**: the continuous absence including adjacent non-working days.
- **Booked**: requested and not yet taken; shown hatched.
- **Coverage**: members of a team in on a day.
- **Team minimum**: the coverage a team asks for; warns, never blocks by default.
- **Delegate**: an approver acting on someone's behalf for a range.
- **Comp time**: overtime banked as hours of time off.
- **Pay period**: a month of attendance, closed and sent to Payroll.
- **Country pack**: versioned statutory rules for one country.
