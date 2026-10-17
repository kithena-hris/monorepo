# Product Requirements Document: The Performance and Development module

Review cycles, continuous feedback, goals and learning in one module: HR builds
a cycle from activities (self, manager, peer and upward reviews, goals,
training), Kithena launches it on its start date, people write their reviews
with the whole year's evidence beside them, and the results reach calibration,
analytics, the employee's file in Documents and, later, Compensation.

**Version** 1.0 · **Date** 2026-10-17 · **Status** proposed, open for review

## How to read this

- **Published copy** (read-only, may lag this file):
  https://claude.ai/artifact/XizvxyfaS5jWHXz84vBSaj
- **The build plan** is [`performance-build-plan.md`](./performance-build-plan.md)
  (`PRF-` tickets). It is the only record of progress.
- **Screens are not designed yet.** §27 lists every screen with an id (`PF1`–
  on the web, `PFM1`– on the phone) so the Claude Design project `6fed6ac8…`
  can add the pages **Kithena Performance** and **Kithena Performance Mobile**
  against the same ids.
- **Repo rules** are in [`CLAUDE.md`](../CLAUDE.md). This document does not
  restate them: no cross-module imports, Zod as the single schema source,
  `occurredAt` and `effectiveFrom` on every event, money in minor units,
  calendar dates as `date`, no `new Date()` in the domain, screens from Reach.
- **Two decisions need sign-off before any AI ships** (§22.2, §22.3): a model
  reading reviews and feedback, and a model reading a writer's own messages and
  work in connected tools. Everything in Phases 1 and 2 works without either.

The questions the request raised, answered here with the reasoning in place so
the answer can be argued with:

| Question                                                         | Answer                                                                                                                                                                                                                     | Where      |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| Which module is this?                                            | `performance`, already in `ModuleKey`. Product name **Performance and development**. Goals and Learning live inside it                                                                                                     | §5         |
| How can form templates serve surveys and other modules?          | The form's shape, its answers and its rules are a shared contract (`packages/contracts/src/forms`) and a pure kit (`packages/form-kit`). Each module stores its own templates. No module imports another                   | §11.1      |
| How does a cycle's status reach the screen without polling?      | A GraphQL subscription over server-sent events, served by the Cosmo Router from a Redpanda topic the outbox already feeds (`apps/gateway/config.yaml`, `events.providers.kafka`)                                           | §8.7       |
| What happens to a launched cycle when its template is edited?    | Nothing. Every edit makes a new version. A cycle pins the version it launched with; draft and scheduled cycles follow the latest published version until they launch                                                       | §11.7      |
| What is an activity?                                             | One unit of work in a cycle: a review kind, goals or learning. New kinds (a 1:1, a development plan) are new activity kinds, not a new cycle shape                                                                         | §9         |
| Can a model draft a review from Slack, GitHub, Linear and so on? | Yes, under limits: only the writer's own connected accounts, only what the writer can already see, only about the person being reviewed, only for the review period, and only when the writer asks. Needs sign-off         | §22.3, §23 |
| Can attendance be taken automatically from a live session?       | Yes for Google Meet (Workspace Events API join events) and Microsoft Teams (Graph meeting call events and the attendance report). Zoom is parked with the rest of Zoom                                                     | §15.5      |
| Which learning platforms can feed completions?                   | LinkedIn Learning, Udemy Business and Pluralsight have reporting APIs for enterprise customers. Frontend Masters has no public API, so completion is self-reported with a certificate or imported                          | §15.7      |
| Does AI give anyone a rating?                                    | Never. A model drafts text and labels sentences. It never fills a scale, a performance score, a calibration or a goal score. A person decides every number about a person                                                  | §22.1      |
| How will Compensation use this?                                  | It consumes `performance.rating.finalized`, effective-dated to the review period, with calibrated values and `supersedes` on a correction. Performance never imports Compensation, and Compensation never reads its tables | §25        |

---

## 1. Executive summary

Performance and development is the sixth sellable module (`ModuleKey`
`performance`, entitlement `module.performance`). It owns review cycles and
their activities, the reviews written in them, continuous feedback, form
templates, goals, learning (training sessions, recordings, external courses),
calibration, cycle automations and performance analytics.

It boots alone (`requiresPeopleSource: 'either'`, `dependsOn: []`). Without
People it learns who works at the company, and who manages whom, from the same
member import Time Off, Documents and Recruiting use. With People it mirrors
People's events. It never imports another module. Where the work crosses into
another module — a review filed in Documents, a reviewer's leave in Time Off,
a probation review for Onboarding, a rating for Compensation, a task in the
Inbox — the shell composes the two modules' own operations, or the other module
consumes Performance's events.

Five things set it apart from the tools it is measured against (Lattice,
Culture Amp, Leapsome, 15Five, Personio, Workday):

1. **Reviews written with the evidence beside them.** The writer sees a
   summary of the year — past reviews, peer reviews, feedback, goals,
   training, and, if they choose, their own conversations and work in the tools
   the company uses — in a panel that never blocks the form. Every sentence the
   AI drafts cites where it came from.
2. **A form engine built once.** Sections, ordered questions, six question
   types, private questions, a single performance score, versioning that never
   changes a launched cycle, and a preview of every question. Surveys,
   training quizzes and probation reviews use the same engine.
3. **Fairness the domain can prove.** Confidential feedback is never shown
   below a minimum number of responses. Calibration keeps every change and its
   reason. Rater analytics show which managers rate high or low. Leave is
   taken into account in goals and deadlines. The domain computes every
   number. A person decides every rating.
4. **It runs itself.** Recurring cycles and probation cycles are created by
   automations, in words or with filters, with deadlines relative to the start.
   HR checks a scheduled cycle and does nothing else.
5. **Ready for pay.** Every finalised rating and goal score is an
   effective-dated event that Compensation can use for merit increases,
   including a retroactive correction after calibration.

## 2. Problem statement

### Current situation

A company running reviews today keeps a spreadsheet of who reviews whom,
copies last year's form into a survey tool, emails reminders by hand, chases
managers in chat, and pastes the results into a slide for calibration. Peer
feedback is either a free-for-all or nobody's job. Managers write reviews from
memory, so the review covers the last six weeks. Feedback given during the year
is lost in chat. Goals sit in another tool and are never part of the review.
Training lives in a third tool, and attendance is a list somebody typed. When
pay is adjusted, the ratings are copied into the payroll spreadsheet by hand.

The tools that do this well are separate products: one for reviews, one for
OKRs, one for learning. Each needs its own copy of the org chart. The AI they
add writes fluent paragraphs without saying where a claim came from, which is
exactly what the EU AI Act asks a provider to be able to explain for a system
that evaluates workers (Annex III, point 4(b)).

### Proposed solution

One module, headless first, that holds the whole review process and computes
every number from an append-only history: who wrote what, when, which version
of which form, and what changed after calibration. A form engine any module can
use. Goals and learning that live on their own and join a cycle as activities.
AI that summarises and drafts with citations, and never rates.

### Business impact

- A buyer of Performance alone gets reviews, feedback, goals and learning with
  their own org import, so the module sells without People.
- A buyer of the suite gets reviewers who are on leave handled by Time Off,
  reviews filed in Documents, probation reviews tied to Onboarding and ratings
  ready for Compensation, with nothing retyped.

## 3. Success metrics

### Primary KPIs

| Metric                                         | Target                                                                     | Measured by                                                        |
| ---------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Cycle set up, draft to scheduled               | Under 15 minutes for HR who has done it once; under 3 minutes by AI        | `cycle.created` → `cycle.scheduled`                                |
| Reviews submitted by the deadline              | ≥ 90% of manager reviews, ≥ 85% of self reviews                            | `review.submitted.occurredAt` vs the activity's deadline           |
| Time to write a manager review                 | Median under 25 minutes, measured with the form open                       | Active time between first autosave and submission                  |
| Evidence breadth                               | ≥ 60% of manager reviews cite something older than three months            | Citations stored with a draft, by source date                      |
| Status shown after a launch, without a refresh | 100% of launches, under 2 s after the state changes                        | Subscription delivery latency (router telemetry)                   |
| Unlock requests                                | Reported, not targeted: a high rate says the form or the deadline is wrong | `review.unlock_requested` per cycle                                |
| AI draft kept                                  | Reported, not targeted                                                     | Edit distance between the AI draft and the submitted answer        |
| Recurring cycles needing no HR edit            | ≥ 70% of automation-created cycles launch unchanged                        | `cycle.scheduled` by an automation → `cycle.launched` with no edit |

### Validation

- `just standalone performance` is green with People, Time Off, Documents,
  Onboarding and Compensation absent, and with the AI keys unset.
- The acceptance suite runs one cycle end to end with every activity: set up by
  filter and by AI chat, scheduled, launched on its date, nominations, every
  review written and submitted, an unlock, a late joiner, a leaver, close,
  calibration, release, export, archive.

## 4. Personas

- **Ada Lovelace**, HR: builds form templates and cycles, runs calibration,
  owns the settings and the automations, answers unlock requests.
- **Marco Ruiz**, engineering manager: writes manager reviews for six direct
  reports, approves their peer nominations, attaches goals and training, is
  reviewed upward by his team.
- **Adam Novak**, engineer: writes his self review, reviews two peers and his
  manager, gives and requests feedback during the year, tracks his goals,
  attends training.
- **Mei Tanaka**, a new starter (already Documents' and Onboarding's persona):
  is in a probation cycle at three and six months.
- **Sofia Conti**, head of engineering: a skip-level who sees her organisation's
  results and joins calibration.
- **A works council** (Germany, the Netherlands): agrees how performance data
  and AI are used before the module goes live for its entity (§23.4).
- **The Compensation module**: consumes finalised ratings (§25).
- **A third-party integrator**: reads cycles and results over REST, or pushes
  goals from another tool.

---

## 5. Where the boundary sits

### 5.1 What Performance owns

Cycles and their activities, participants and their reviewers, nominations,
reviews and their revisions, unlock requests, form templates and their
versions, answers, continuous feedback and feedback requests, the feedback
settings, goals and their periods, key results, check-ins and alignment,
learning items, sessions, enrolments, attendance and completions, learning
provider connections, calibration sessions and their changes, cycle
automations, saved views and chart plans, AI summaries and drafts and their
audit trail, and performance analytics.

### 5.2 What it learns

- **Members** (who works here, manager, team, location, legal entity, hire
  date, probation end, employment type, account): from `people.person.*` events
  when People is present, from a member import when it is not. The same member
  projection Time Off and Recruiting keep, copied, not shared.
- **The org graph** (manager chain, skip-levels, dotted-line managers, HR
  business partners per org unit): from the same source.
- **HR**: whoever identity names administrator for `module.performance`.
- **Who is away**: never by calling Time Off. The shell gives Performance's
  screens Time Off's answer (§26).
- **Hires and probation**: `people.person.hired` and the probation end date
  from the member projection, or Onboarding's `onboarding.probation.*` events
  when present (§16.3).

### 5.3 What it tells others

Events on `kithena.performance.v1` (§25). Inbox items through the Inbox
contract (`packages/contracts/src/inbox`): write a review, nominate peers,
approve nominations, an unlock request, a feedback request, a goal check-in
due, a training to acknowledge, results released to you. Assistant
capabilities (`packages/contracts/src/assistant/performance.ts`, §22.10).
Webhooks for every published event.

### 5.4 What it does not own

- **The employee and the org chart.** People does. Performance mirrors them.
- **Pay.** Compensation adjusts pay from Performance's events. Performance never
  shows or stores a salary.
- **The probation decision.** Passing, extending or ending a probation is
  Onboarding's task and People's record (Recruiting PRD §O8). Performance
  provides the review that informs it (§16.3).
- **Files.** A review exported as a document is Documents' file (§20).
- **Email and chat delivery.** `platform/messaging` and `platform/slack` send.
- **Calendars and meetings.** Google and Microsoft hold the event. Performance
  holds the session and the attendance it records.

### 5.5 Why Goals and Learning are inside, not separate modules

`ModuleKey` has `performance` and no `goals` or `learning`. The request treats
both as part of "performance and development", and so do Leapsome, Lattice
(Goals and Grow) and Culture Amp (Develop). Keeping them inside avoids two more
member projections, two more subgraphs and two more settings areas for
something most buyers buy together.

They are built as separate bounded contexts in the code
(`src/domain/goals/`, `src/domain/learning/`), with their own events and their
own tables, and they work with no cycle at all. Splitting either into its own
`ModuleKey` later is a move of folders and a new manifest, not a redesign.
Open for review (§36, decision 2).

### 5.6 Why forms are a shared kit, not a service

Other parts of the product will need forms: an engagement survey, a training
quiz, an exit interview, a probation review, Recruiting's questionnaires. A
forms service would be a runtime dependency every one of them needs, which
breaks "every module boots alone". So:

- **The shape is a contract.** `packages/contracts/src/forms` defines a form
  definition, its sections, question types, an answer set, and their
  classifications, in Zod. One definition gives the TypeScript type, the JSON
  Schema, the GraphQL input and the form resolver (repo rule).
- **The rules are a pure kit.** `packages/form-kit` (pure, like
  `@kithena/domain-kit`) validates a definition, validates answers against a
  definition, orders sections and questions, applies privacy to produce the
  subject's view, computes a version's fingerprint and diff, and maps an
  answer to its score. No I/O.
- **Storage is each module's.** Performance stores its templates and versions
  in its own schema. A future survey module stores its own. Neither imports
  the other.
- **Rendering is Reach.** `@reach/ui` gains a presentational `FormView` and
  `FormBuilder` that take plain props and know nothing of a contract (§28).
  The module maps the contract to the props.

---

## 6. Vocabulary

| Term              | Means                                                                                                                                    |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Cycle             | A named period of review work with a start date, a review period, participants and activities                                            |
| Review period     | The dates the work being reviewed falls in (`periodFrom`, `periodTo`). Distinct from when the cycle runs                                 |
| Participant       | A person being reviewed in a cycle (the **subject**)                                                                                     |
| Activity          | One unit of work in a cycle: `self_review`, `manager_review`, `peer_review`, `upward_review`, `goals`, `learning`. More kinds may follow |
| Review            | One form, written by one **reviewer** about one subject, for one review activity                                                         |
| Form template     | A reusable form. It has **versions**; a cycle uses one version                                                                           |
| Performance score | The one question on a form that states a person's overall performance                                                                    |
| Feedback          | Something one person writes about another, outside any cycle                                                                             |
| Goal              | Something a person, team or company means to achieve in a **goal period**, measured by key results or progress                           |
| Learning item     | A training: a live session, a recording, an external course, a document or a quiz                                                        |
| Calibration       | HR and managers comparing ratings across a group and changing them, with reasons, before they are final                                  |
| Release           | The moment a subject can see the reviews shared with them                                                                                |
| Automation        | A rule that creates scheduled cycles on a calendar or on an event, such as a hire                                                        |

---

## 7. The whole flow

```
 Performance                                                   Other modules (by event or the shell)
 ───────────                                                   ─────────────────────────────────────
 Form template  version: draft → publishing → published → superseded | archived

 Automation     active ──(rule fires)──▶ creates a cycle in `scheduled`

 Cycle          draft ─┬─(Schedule)─▶ scheduling ─▶ scheduled ─(start date)─▶ launching ─▶ in_progress
                       │                  ▲   │                                   │             │
                       │                  │   └─(Unschedule)─▶ draft              ▼             │
                       └─(Launch, start date is today)────────────────────▶ launching           │
                                         launch_failed ◀──────────────────────────┘             │
                                                                                                ▼
                                                   archived ◀── closed ◀── closing ◀──(Close)── in_progress
                                                                  │
                                                                  ├─▶ calibration (optional) ─▶ results released
                                                                  └─▶ performance.rating.finalized ─▶ Compensation

 Review         not_started → in_progress → locked ⇄ unlock_requested
                                             ▲ │ ▲        │
                                             │ │ └unlocked ◀┘ (HR approves)
                                             │ └─▶ in_review (calibration takes the score; reserved, §10.1)
                                             └──── in_review (calibration finalised)
                at close: not_started → abandoned · in_progress → withdrawn
                          locked, unlock_requested, unlocked, in_review → completed

 Nomination     (scheduled or in_progress) open → submitted → approved | changed → reviews created

 Feedback       draft → sent                                      Inbox: the receiver (if shared)
 Goal           draft → active → completed | missed | cancelled   (check-ins along the way)
 Enrolment      assigned → acknowledged → in_progress → completed | expired | excused
```

Every arrow is a typed event with `occurredAt` and `effectiveFrom`. A
correction (a rating changed in calibration, a check-in entered against the
wrong goal) is an event with `supersedes`, never an update.

---

## 8. Cycles

### 8.1 Setting up a cycle (PF4)

A cycle is created in `draft`, by HR, from scratch, from a copy of another
cycle, or by AI chat (§8.2). Setup is one page with steps (Reach `Stepper`);
every step saves as it changes, and any step can be visited in any order:

1. **Basics**: name, description, start date, review period (defaults to the
   six or twelve months before the start, editable), time zone (defaults to the
   company's), cycle owners (HR people who answer its unlock requests), and
   whether a calibration step follows (§17).
2. **Participants** (§8.2).
3. **Activities** (§8.3): which review kinds, their forms, deadlines and
   reminders, peer and upward selection, confidentiality and sharing; goals and
   learning, and who attaches them.
4. **Release**: when subjects see their reviews (§10.8).
5. **Review**: a summary of everything above, the number of reviews that will be
   created per activity, the warnings (§8.6), and the action button.

The action button reads **Launch cycle** when the start date is today in the
cycle's time zone, and **Schedule cycle** when it is later. A start date in the
past is refused. The button is disabled while a warning that blocks is open,
and says which.

### 8.2 Participants (PF4 step 2)

Three ways to choose people, which combine:

- **Filters.** The same filter builder as People and Time Off
  (`@reach/ui/filter-model`, `FilterBuilder`): department, team, location,
  legal entity, manager (direct or anywhere below), employment type, hire date,
  tenure, probation, job level, and custom fields the member projection
  carries. The matching list updates as the filter changes, with the count.
- **AI chat.** HR types "everyone in Engineering and Product hired before
  1 April, without contractors and people on probation". The model returns a
  filter plan by field name; the domain resolves the names it mentions
  ("Engineering") against the org, shows the filter it built as editable chips,
  and the list. The model never sees the list of people (§22.1). AI chat can do
  everything the setup page can: add or remove people, choose activities and
  forms, set deadlines and reminders, schedule. Each change it proposes is shown
  as a diff and applied only when HR confirms.
- **By hand.** Add named people the filter does not match, and exclude named
  people it does. Each inclusion and exclusion is a row with who made it and
  when, and an optional reason. Inclusions and exclusions override the filter.

**Keep in step after launch** (a switch, off by default): while the cycle is
`in_progress` and until a cutoff date, people who start matching the filter
(new hires, transfers) are added automatically and their reviews created
(§8.8). People who stop matching are not removed automatically; HR sees them in
a "no longer matches" list and decides.

**Who is in a review, not only who is reviewed.** A participant is a subject.
Reviewers come from the activities: the subject (self), the manager, peers,
direct reports. Someone can be a reviewer without being a participant.

### 8.3 Activities (PF4 step 3)

A list of every activity kind, each with a switch. Turning one on opens its
settings in place:

| Activity       | Settings when on                                                                                                                                                                                                                                                     |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Self review    | Form template (any published template); deadline; reminders                                                                                                                                                                                                          |
| Manager review | Form template; deadline; reminders; whether the manager sees the self review before writing (default yes, after the self review is submitted); dotted-line managers also review (off)                                                                                |
| Peer review    | Form template; deadline; reminders; **selection**: all peers, or nominations (§9.3); minimum and maximum peers per subject; confidentiality and sharing (§8.5); nomination deadline and who nominates                                                                |
| Upward review  | Form template; deadline; reminders; **selection**: all direct reports, or nominations; minimum responses before the subject sees anything (default 3); confidentiality and sharing (§8.5)                                                                            |
| Goals          | Goal periods to include (§14.6); **who attaches**: all of each subject's goals in those periods, automatically (option 1), or the manager chooses (option 2); whether goals are rated in the manager review (adds a generated goals section, §14.6); weighting rules |
| Learning       | Learning items or paths to include (§15.8); **who attaches**: every subject gets them (option 1), or the manager chooses (option 2); whether completion is shown in the manager review                                                                               |

The form template picker lists every **published** template, with its latest
version number, its question count, whether it has a performance score, and a
preview button. An archived template is not listed. A draft template with no
published version is listed as disabled with "not published yet".

At least one activity must be on. A cycle may have several review activities
and no goals or learning, or goals alone.

### 8.4 Deadlines and reminders

Each activity has a deadline, as an **exact date** or **relative to the start**
("14 days after the start"). Relative deadlines resolve to dates when the cycle
launches and are shown as both in setup ("14 days after start · 15 May").
Automation-created cycles always use relative deadlines (§16). Deadlines end at
23:59 in the cycle's time zone. The domain checks the order makes sense (the
manager review cannot be due before the self review it reads, if the manager
waits for it) and warns.

Nominations have their own deadline when nominations are on.

Each activity has reminder rules, from a short list:

- N days before the deadline (default 7 and 2);
- on the deadline;
- every N days after the deadline, at most M times (default every 3 days, 3
  times);
- when the activity opens.

Reminders go to the Inbox always, and by email and chat app according to the
person's notification settings (identity's `notifications` preferences, quiet
hours included). Reminders stop the moment the review is submitted. A reviewer
on leave on the reminder's day is skipped and reminded on their first working
day back, when Time Off is present (§26). HR can send a reminder by hand to any
row or a selection (§19.3).

### 8.5 Confidentiality and sharing in a cycle

Peer and upward reviews each have two settings, chosen when the cycle is set
up, with the same three values as feedback (§12.2):

- **Confidentiality** (is the reviewer's name shown to the subject?):
  confidential, not confidential, or the reviewer chooses.
- **Sharing** (does the subject see the review at all?): shared, not shared, or
  the reviewer chooses.

Defaults: peer reviews **reviewer chooses** for both; upward reviews
**confidential** and **shared**. Whatever is chosen, the reviewer sees what will
happen before they submit ("Marco will see this review. Your name will not be
shown."). The subject's manager and HR always see the review and the
reviewer's name (§24); the setting is about the subject.

**A confidential review is never shown alone.** A subject sees confidential
peer or upward reviews only when at least the cycle's minimum (default 3) of
that kind are submitted, and then as a group whose order does not follow
submission order. Below the minimum they are held for the manager, the manager's
manager and HR, and the subject sees "Not enough responses to share
confidentially". An AI summary of confidential reviews is written from text
with the reviewers' names removed (§22.4).

### 8.6 Checks before launch

Warnings shown in the review step and in the launch modal. The ones marked
**blocks** keep the button disabled:

- No participants (blocks).
- A review activity on with no form (blocks).
- A participant has no manager, and the manager review is on: they get no
  manager review, listed by name, with "set a reviewer" per row.
- A participant has fewer peers than the minimum, with selection "all".
- A form version used by an activity was superseded since it was chosen (the
  cycle will use the latest published version; shown so nobody is surprised).
- A deadline falls on a public holiday in a participant's location (when Time
  Off is present), or before the start.
- More than N reviews for one reviewer (default 12): workload, with the names.
- People in a German or Dutch entity while the works council setting is "not
  agreed" (blocks for those people only, §23.4).

### 8.7 Launching and scheduling, and the live status

Launching and scheduling are asynchronous. Pressing the button:

1. moves the cycle to `launching` (start date today) or `scheduling` (later) in
   one transaction, with the outbox event, and returns at once;
2. starts the cycle's Temporal workflow (`CycleWorkflow`, one per cycle), which
   for **scheduling** validates, resolves relative deadlines, opens nominations
   when they are on, sets a durable timer for the start, and moves the cycle to
   `scheduled`; and for **launching** snapshots the participants, pins each
   form version (§11.7), creates every review, attaches goals and learning when
   option 1 is chosen, sends the "you have reviews to write" notifications,
   schedules the reminders, and moves the cycle to `in_progress`;
3. on the start date, the timer fires and the scheduled cycle goes through
   `launching` the same way.

Creating the reviews is batched (500 per transaction) and idempotent per
`(cycle, activity, subject, reviewer)`, so a retried step creates nothing twice.
If a step fails after its retries, the cycle moves to `launch_failed` with the
reason, shown on the cycle with **Retry launch**. Nothing is half-visible: reviews
are created hidden and shown together when the cycle reaches `in_progress`.

A **scheduled** cycle can be edited. An edit to participants, activities or
deadlines takes effect on the workflow's next step; an edit to the start date
moves the timer. **Unschedule** returns it to `draft`.

**No polling.** The cycle page, the cycles list and the overview table subscribe
to changes:

- The subgraph declares a subscription,
  `cycleChanged(cycleId)` and `cyclesChanged`, backed by the Redpanda topic
  `kithena.performance.v1.cycle` through the Cosmo Router's event-driven
  federation (the `kafka` provider already in `apps/gateway/config.yaml`). The
  outbox is the only writer of that topic (Debezium), so the stream says exactly
  what was committed, and no module runs its own pub/sub.
- The browser receives it as **server-sent events** (`graphql-sse`,
  `Accept: text/event-stream`) through the router. The phone uses the same
  endpoint.
- Each message carries the cycle's id, state, counts and version. The page was
  server-rendered with the current state; the stream only moves it on. On
  reconnect the client reads the cycle once and resumes the stream; a message
  with an older version than the one on screen is ignored.
- The same stream carries review status changes for the overview table (§19)
  and a template version's `publishing` → `published` (§11.7).

### 8.8 Changes after launch

- **Adding a participant** (by hand, or by "keep in step"): their reviews are
  created from the cycle's settings, with the pinned form versions. Deadlines
  are the cycle's, or, if fewer than N days remain (default 7), the date it was
  added plus N; HR sees and can change the per-person deadline.
- **Removing a participant**: reviews about them that are `not_started` or
  `in_progress` are cancelled and disappear from reviewers' lists. Reviews about
  them that were **submitted** (`locked`, `unlock_requested`, `unlocked`) stay
  intact and become **detached** (§10.7).
- **A reviewer leaves the company**: their unsubmitted reviews are cancelled;
  their submitted reviews stay. HR sees "Reviewer left" and can assign a
  replacement reviewer where the activity needs one (a manager review).
- **The subject's manager changes** mid-cycle (People's event): the manager
  review moves to the new manager. If the old manager had started it, their
  draft goes with a "handed over from" note; if they had submitted it, it stays
  as theirs and the new manager is offered a second, optional manager review.
  The old manager can leave a handover note either way.
- **A deadline is extended** for the whole activity or per person. Reminders
  are rescheduled.
- **A form cannot change** after launch. HR can see which version the cycle uses
  and that a newer one exists.

### 8.9 Closing

**Close cycle** is HR's, from the cycle page, with a confirmation that says how
many reviews will become abandoned and withdrawn. Closing is asynchronous
(`closing` → `closed`, same stream) and maps every review's status (§10.1).
After closing, nothing in the cycle can be written or unlocked. Calibration, when
on, runs after closing and before release (§17). A cycle can be scheduled to
close on a date.

### 8.10 Archiving

A closed cycle can be **archived**. It leaves the default list (a filter shows
it), its reviews stay readable by everyone who could read them, nothing in it
can change, and it can be unarchived. Archiving never deletes; retention does
(§30).

---

## 9. Activities

Each activity kind is an implementation of one domain port, `ActivityKind`:
what it needs to be configured, how it creates work for a subject at launch,
what it adds to a subject's row in the overview, what it contributes to the
manager review, and what its status is. The cycle knows only activities. A new
kind — a 1:1, a development plan, a 360 by external reviewers — is a new
implementation and a new value in the contract's enum, not a change to cycles.

### 9.1 Self review

One review per subject, by the subject. Opens at launch.

### 9.2 Manager review

One review per subject, by their manager in the member projection at launch.
Dotted-line managers write a second manager review when the setting is on. A
subject with no manager is listed for HR to assign a reviewer. The manager can
read the subject's submitted self review and peer and upward reviews about the
subject (§13).

### 9.3 Peer review

**All peers**: at launch, a review for every peer of the subject, where a peer
is someone with the same manager. A tenant can widen "peer" to "same team" in
settings. Capped at the maximum; when there are more, the domain picks
deterministically (by most recent shared work, else alphabetically) and HR can
change the picks.

**Nominations**: from the moment the cycle is scheduled or launched, the overview
shows a **Peers** column asking for nominations (§19.2). Who nominates is a
cycle setting:

- the subject nominates and the manager approves (default);
- the manager nominates;
- HR nominates.

The nominator picks between the minimum and maximum from a list that suggests
people the subject works with (members of the same team, people who gave them
feedback this year, and with integrations, people they work with most; §23).
Approval can change the list. Approved nominations create the reviews: at
launch when nominations finish before the start, or at once when the cycle is
already `in_progress`. A nominee can decline with a reason; the nominator is
told and can replace them.

Peer reviews are collected for the manager: the manager always sees them (§8.5)
and they feed the manager's summary (§13.4).

### 9.4 Upward review

The same two options with the direction reversed: **all direct reports** review
their manager, or nominations, where the manager (or HR) picks which direct
reports review them. The overview shows **Nominate direct reports** for a
subject who manages anyone. Confidential by default; never shown to the subject
below the minimum (§8.5). The subject's own manager sees them and their summary.

### 9.5 Goals as an activity

See §14.6.

### 9.6 Learning as an activity

See §15.8.

---

## 10. Reviews

### 10.1 Statuses

| Status             | Means                                                                                                                                                                                 | Reviewer can            | Next                                                         |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------ |
| `not_started`      | Created, nothing saved                                                                                                                                                                | Open and write          | `in_progress` on the first saved answer                      |
| `in_progress`      | At least one answer saved                                                                                                                                                             | Write, submit           | `locked` on submit                                           |
| `locked`           | Submitted. Read-only                                                                                                                                                                  | Read, request an unlock | `unlock_requested`                                           |
| `unlock_requested` | Submitted, an unlock request waits for HR (the request's "locked in review")                                                                                                          | Read, withdraw request  | `unlocked` (approved) or `locked` (declined or withdrawn)    |
| `unlocked`         | Reopened by HR for edits; the last submitted version still stands                                                                                                                     | Write, resubmit         | `locked` on resubmit                                         |
| `in_review`        | Submitted and held for calibration: its performance score is being compared and may be changed (§17). **Reserved**: in the contract and the domain, not reachable from any screen yet | Read                    | `locked` when calibration is finalised; `completed` at close |
| `abandoned`        | Cycle closed while `not_started`                                                                                                                                                      | Nothing                 | Final                                                        |
| `withdrawn`        | Cycle closed while `in_progress`; the draft is kept for HR, never shared                                                                                                              | Nothing                 | Final                                                        |
| `completed`        | Cycle closed while `locked`, `unlock_requested`, `unlocked` or `in_review`                                                                                                            | Read                    | Final                                                        |
| `cancelled`        | The subject or reviewer left the cycle before submitting                                                                                                                              | Nothing                 | Final                                                        |

When a cycle closes on an `unlocked` review, **the last submitted version is the
completed one**. Edits made after the unlock and not resubmitted are kept as a
draft revision HR can see, and are never shared. An `unlock_requested` review
closes as `completed` with the request closed as "cycle closed".

**Why `in_review` exists.** Each manager rates differently: one gives most of
their team the top score, another almost never does. Calibration makes the
scores comparable before they are final (§17), and while it runs a review's
score must not move under it. `in_review` is that hold:

- A submitted review carrying a performance score (normally the manager
  review) moves from `locked` to `in_review` when a calibration session takes
  its subject. Reviews without a score (peer, upward, most self reviews) never
  enter it.
- While `in_review`, the reviewer reads and cannot request an unlock; an unlock
  request already open waits until the session is finalised. HR can still take
  a review out of the session, which returns it to `locked`.
- Finalising the session moves the review back to `locked`. A score changed in
  calibration is a calibration change superseding the reviewer's value; the
  reviewer's answers are not edited.
- At close, `in_review` becomes `completed`, like every submitted review.

**Reserved for now.** The state, its transitions and the close mapping are in
the contract (`PRF-010`) and the review aggregate (`PRF-022`), with domain
tests, so stored data and events never need a migration when calibration
arrives. No screen or operation moves a review into `in_review` until the
calibration work (§17, `PRF-111`) ships; until then the UI has no badge for it,
and a review that somehow reached it would show as "Submitted".

### 10.2 Autosave

Every answer saves as it is typed: debounced at 800 ms after the last keystroke,
and at once when a field loses focus, when the tab is hidden, and before the page
unloads (`sendBeacon`). Each save is a patch of the answers that changed, with
the review's revision number; a save with an older revision than the server's
is refused and the writer is shown the newer text with a choice (one review is
rarely open twice, but a phone and a laptop can be). The form shows "Saved ·
10:42" or "Saving…" or "Offline, will save when you're back" (saves queue
locally and replay). Rich text saves as ProseMirror JSON (`@tiptap`), so it is
identical on every browser (repo decision).

### 10.3 Submitting

**Submit** sits at the bottom of the form. It is disabled until every required
question is answered, and the form lists what is missing with links. It opens a
modal (PF12) that:

- says the review will be **submitted and locked**, and that changes after that
  need an unlock request that HR approves;
- shows a summary of the review: answered questions, the performance score
  highlighted (§13.7), and the sentiment slider (§13.7);
- shows **how the receiver will see it**: which answers they will see (private
  questions hidden, §11.4), whether their name is shown, and when (on release,
  §10.8);
- has **Submit** and **Back to edit**.

### 10.4 Unlock requests

From a locked review, **Request unlock** asks for a **reason**, required, at
least 10 characters. It creates an Inbox task for the cycle's owners (HR)
(`performance:unlock:<id>`), with the reason, the review and the person. HR
approves (the review becomes `unlocked` and the reviewer is told) or declines
with a note (back to `locked`). A tenant setting lets the subject's manager
approve unlock requests for reviews of their reports, beside HR (off by default;
§36, open question 2). Nothing can be unlocked after the cycle closes. HR can also
unlock a review without a request, with a reason.

### 10.5 Revisions

Every submission is a revision: the answers, the form version, who submitted,
when. Unlock and resubmit makes a new revision; the old one is kept. HR sees
the history; the subject sees only the current released revision.

### 10.6 Deleting

**No review that is part of a cycle can be deleted** by anyone, while the cycle
exists. Retention deletes (§30). The one exception is a detached review (§10.7).

### 10.7 Detached reviews

When a subject is removed from a cycle after a review about them was submitted,
that review becomes **detached**: it is no longer part of the cycle (not in its
counts, analytics, calibration or export), and it stays intact.

- The **author** sees it in their reviews list with a banner: "This review is
  not part of _H2 2026_ any more, because Adam was removed from the cycle." They
  choose **Keep** or **Delete**. Deleting asks for confirmation and is final.
- The **subject's manager and HR** can still read it, with the same banner,
  until the author deletes it.
- The **subject** sees it only if it was released to them before it was
  detached.

If the person is added back to the cycle, a kept detached review is reattached.

### 10.8 Release and acknowledgement

Subjects see the reviews shared with them at **release**, a cycle setting:

- when the cycle closes, or after calibration if it is on (default);
- on a date;
- when each review is submitted (for cycles without a manager review, or for a
  culture that wants it).

HR can release per person or per group early. At release the subject gets an
Inbox update and can **acknowledge** the manager review and add a **response**
(rich text, optional), which the manager and HR see and which is kept with the
review. Acknowledging is not agreeing; the screen says so.

---

## 11. Form templates

Built with care because other parts of the product will build on them (§5.6).

### 11.1 The shared kit

`packages/contracts/src/forms`:

- `FormDefinition`: id, version, title, description, `sections[]`,
  `performanceScore?`.
- `FormSection`: id, title, description, `questions[]`, position.
- `FormQuestion`: a discriminated union on `type` (§11.3), with id, prompt
  (rich text), help text, `required`, `allowComment`, `private`, position.
- `FormAnswers`: answers by question id, each typed by the question's type, plus
  an optional comment.
- Each field carries a classification policy. A question's prompt is
  `internal`; an answer is `confidential` and its comment the same; codegen
  emits the redaction paths and the DSAR manifest from these, as for every
  contract.

`packages/form-kit` (pure):

- `validateDefinition(def)`: the rules in §11.2–§11.5, as `Result` values.
- `validateAnswers(def, answers, { submitting })`: types, ranges, required on
  submit only.
- `normalise(def)`: removes empty sections, renumbers positions.
- `subjectView(def, answers)`: drops private questions and their answers, so the
  subject's copy cannot leak one by construction (§11.4).
- `fingerprint(def)` and `diff(a, b)`: for versioning (§11.7).
- `score(question, answer)`: the numeric value of a scale, binary or performance
  score answer, as a `Decimal`.

Domain tests come first, in the kit (repo rule).

### 11.2 Structure

- A template has one or more **sections**; each section has a title, an optional
  description and one or more **questions**.
- Sections are ordered, and questions are ordered within their section, by
  drag and drop with a keyboard alternative (`Sortable`, `@dnd-kit`). A question
  can be dragged to another section.
- **A section with no questions is removed when the template is saved**, with a
  toast that says so and an undo.
- The **performance score section**, when present, is always last and cannot be
  moved (§11.5).
- Limits: 30 sections, 100 questions. Enough for any sane form, and a check
  against a paste going wrong.

### 11.3 Question types

| Type                | Answer                                                                          | Configuration                                                                                                                                          |
| ------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `text`              | Rich text, always (`@tiptap`): paragraphs, bold, italic, lists, links, mentions | Optional length guidance (shown, not enforced)                                                                                                         |
| `scale`             | Exactly one option                                                              | 2–10 options, each a label and an optional description; ordered low to high; each option has a numeric value (default 1..n); layout as a row or a list |
| `binary`            | Yes or no                                                                       | Labels (default "Yes" / "No"); which counts as 1                                                                                                       |
| `choice`            | One option, or several when `multiple`                                          | 2–50 options; `multiple` on or off; minimum and maximum selections when multiple; shown as a dropdown (`Select` or `Combobox` with chips)              |
| `performance_score` | Exactly one option                                                              | Same as `scale` (2–10 options with values). Lives only in its own section (§11.5)                                                                      |
| `goals` (generated) | A rating and comment per attached goal                                          | Not addable by hand. Added to a manager review when the goals activity rates goals (§14.6)                                                             |

Every type except `goals` can allow a **comment** (plain rich text under the
answer).

### 11.4 Question settings

- **Required or optional.** Default required. Optional questions say so on the
  form.
- **Allow comment.** Adds a comment box under the answer.
- **Private.** The question and its answer are never shown to the review's
  subject. The subject does not see that it exists: no gap in numbering, no
  "hidden question" placeholder, no count, not in their export or PDF, not in
  any summary written for them. Managers, the cycle's HR and calibration see it.
  Enforced by `subjectView` in the kit and by a test that renders every surface
  the subject can reach (web, phone, PDF, REST, GraphQL, assistant) and fails if
  a private question's id or text appears.
- **Help text**: shown under the prompt.
- Private applies to the subject. On a self review, where the writer is the
  subject, private questions are visible to the writer while writing and hidden
  from them after submission, and the builder warns that this is rarely what is
  wanted.

### 11.5 The performance score section

- A template has **at most one** performance score question. It is optional.
- It lives in its own section, called "Performance score" (renamable), **always
  at the bottom**. The section holds that one question and nothing else: no
  **Add question** in it, no second section of its kind.
- The builder shows **Add performance score** only when there is none. Once
  added, HR can edit the prompt, the options (2–10, with values) and whether a
  comment is allowed. They can remove it.
- **It is always required** when present; the required switch is shown on and
  disabled.
- A company may define **one company-wide scale** for the performance score in
  settings (labels and values, for example 1 "Below expectations" to 5
  "Exceptional"). When defined, every template's performance score uses it, so
  scores compare across forms and cycles, and Compensation receives one scale.
  Without a company scale, each template defines its own and analytics compares
  only within a template version (§18).
- The performance score is never private: it is what the review is for. Whether
  the subject sees it at release is a cycle release setting ("share the
  performance score with the employee", default on).

### 11.6 The builder and previews (PF2)

A two-pane page: the builder on the left, a **live preview of the whole form**
on the right (toggle to full width), showing it as the reviewer will fill it on
the web or the phone (switch), and as the subject will read it (private
questions gone). Each question in the builder has a **quick preview** that
expands under it and is interactive, so HR can try the scale and the dropdown.
Changes appear in the preview as they are typed.

Templates are their own area, **Performance › Form templates**, listing every
template with its status (§11.7), latest version, number of cycles using each
version, owner and last edit. Only HR creates and edits templates (the
`performance.templates` permission, §24).

### 11.7 Versioning

The industry pattern (survey tools, Lattice and Culture Amp's templates,
Workday's business process definitions): **published versions are immutable,
and a running process pins the version it started with.**

- A template has versions `v1`, `v2`, … Each version has a status:
  - `draft`: being edited; at most one per template at a time.
  - `publishing`: HR pressed **Publish**; the domain is validating it and
    re-pointing draft and scheduled cycles (asynchronous, shown live, §8.7).
  - `published`: the current version, offered in cycle setup. At most one.
  - `superseded`: an older published version. Still used by any cycle that
    launched with it; not offered for new cycles.
  - `archived`: the template was archived; its versions stay readable.
- **Editing a published template** creates a new `draft` version, copied from
  the published one. The published version is unchanged until the draft is
  published.
- **Publishing** makes the draft `published` and the old one `superseded`, and
  updates every **draft and scheduled** cycle that uses the template to the new
  version. Cycles that are `launching`, `in_progress`, `closed` or `archived` keep
  the version they pinned at launch, and their reviews keep it too, forever.
  The publish screen lists the cycles that will move and the ones that will not.
- A cycle may also pin a version explicitly in setup ("Keep using v3"), for HR
  who want a scheduled cycle not to move. Pinned is shown on the cycle.
- **Version history** on the template page: a timeline of versions with status,
  who published, when, what changed (`diff`: questions added, removed, edited,
  moved), and which cycles use each. Any version can be previewed and copied into
  a new draft ("restore").
- Answers always store the version id and the question ids. Analytics compares a
  question across versions only when its id is the same and its options did
  not change (§18).

### 11.8 Deleting and archiving templates

- **Delete** is offered only when no cycle in any state has ever used any
  version of the template. It is final.
- Otherwise **Archive**: the template leaves the cycle setup picker and the
  default list. Every version stays readable for the cycles that used it.
  Unarchive brings it back.
- Deleting a draft version (not the template) is always possible.

### 11.9 AI in the builder

- **Write a template**: HR describes the purpose ("a mid-year check-in for
  engineers, five questions, one about mentoring") and the model returns a
  definition the kit validates. Invalid output is rejected, never patched
  silently. Shown as a draft to edit.
- **Suggest questions** for a section, **rewrite** a question to be clearer or
  less leading, **suggest options** for a scale or choice, **check the form**:
  double-barrelled questions, leading wording, scales without a midpoint
  description, too many required text questions for a deadline.
- **Translate** a template for multilingual companies; a person approves each
  language. Answers stay in the language written.

The model reads only the template, never answers.

### 11.10 Where else forms are used

In this module: reviews, feedback with a template (§12.4), training quizzes and
session feedback (§15), probation reviews (§16.3). Elsewhere, later: an
engagement survey would be a new module storing its own templates with the same
kit; Recruiting may move its questionnaires and scorecards onto the kit when it
next changes them. Neither is in scope here; the kit and Reach's `FormView`
being presentational and contract-only is what makes them possible.

---

## 12. Feedback

### 12.1 Giving feedback (PF14, PFM5)

Anyone in the company can give feedback to anyone else, at any time, outside any
cycle: from Performance, from a person's profile (the shell adds the action
when People is present), from the phone, and from chat apps (§23). The writer
picks the receiver, writes in a rich text editor, or picks a **form template**
(HR's published templates marked "usable for feedback"), and before sending sees
**exactly** who will see it and whether their name is shown.

Feedback is never part of a cycle. It is part of the evidence for every review
written about the receiver after it (§13.2).

### 12.2 Visibility and sharing settings

Two settings in **Settings › Performance › Feedback**, each with three values:

| Setting                                                           | Confidential / Not shared                                                         | Not confidential / Shared                         | Writer chooses                                                        |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------- |
| **Confidentiality** (is the writer's name shown to the receiver?) | Always hidden. The writer sees "Your name will not be shown" and cannot change it | Always shown, and the writer is told so           | A switch before sending, "Show my name to Adam"                       |
| **Sharing** (does the receiver see it?)                           | Never shown to the receiver; goes to their manager                                | Shown to the receiver; their manager also sees it | A choice before sending: "Adam and his manager" or "Only his manager" |

**Default: writer chooses, for both**, so every feedback asks before it is sent.
Whatever the setting, the writer sees the outcome in words before pressing
**Send**, and nothing about it can be changed after sending except deleting it
within 10 minutes (an undo, not an edit).

Who else sees feedback: the receiver's manager always sees feedback about their
reports, with the writer's name. HR can see writer names only through an
audited "reveal writer" action with a reason, for misconduct investigations;
the writer is not told, the audit log records it (`platform/audit`). Open for
review (§36, decision 6).

### 12.3 Requesting feedback

Anyone can **request feedback** about themselves (or a manager about a report)
from up to ten people, with a question or a template and an optional due date.
The request is an Inbox task for each. Declining is allowed and silent beyond
"declined".

### 12.4 Feedback with a template

A template marked "usable for feedback" is offered to writers. Its private
questions follow §11.4. It has no performance score: the builder refuses to mark
a template with a performance score as usable for feedback, because a rating
outside a cycle is not a review.

### 12.5 Care before sending

With AI on, before sending the writer can ask for a **tone check**: the model
labels sentences that read as personal rather than about behaviour, as vague, or
as harsh, with a suggestion for each. Advisory only; nothing is blocked. The
company can turn on a filter that holds feedback containing words on a list
(abuse, slurs) for the writer to reconsider.

### 12.6 Praise

Feedback can be marked **praise**, which, when the writer and the company allow,
can be posted to a chat channel the company picks (through `platform/slack`).
Praise is always not confidential and shared.

---

## 13. Writing a review (PF10, PFM3)

### 13.1 Layout

The form fills the page. A **detail panel** opens on the right when writing
(Reach `Sheet` in non-modal mode, resizable, or `ListDetail`), and stays open as
the writer scrolls and types: it never covers the form or takes focus, and on a
narrow screen it becomes a bottom sheet the writer can drag up and down. Its
state (open, width, filters) is in the URL query string (repo memory: every
filter in the URL).

### 13.2 What the panel shows

1. **The AI summary**, on top, fixed. Written for this writer from what they may
   read about the subject (§22.4):
   - a summary of peer reviews and upward reviews this cycle (for the manager);
   - a summary of feedback received since the subject's last **submitted manager
     review** (feedback has no cycle, so that is the boundary; with no previous
     manager review, the last 12 months);
   - the previous performance score and the one before it, with cycle names
     (when the writer may see them);
   - goals this cycle with progress and score, and learning completed.
     Each sentence cites its sources (chips that scroll the list below to the item).
     **The summary does not change with the filters below.**
2. **The evidence list**: every item the summary was written from, newest first:
   feedback, previous reviews (self, manager, peer, upward), goal check-ins,
   training completions, and items from connected tools when the writer chose
   to use them (§13.5).
   - **Filter** by kind: feedback, peer reviews, manager reviews, self reviews,
     upward reviews, goals, learning, connected tools.
   - **Group** by kind of source (feedback / reviews) or by cycle.
   - **Sort** by most recent or oldest first.
   - Each item opens in place. Private questions in past reviews are shown only
     to people who may see them (§11.4).

Without AI, the panel shows the list without the summary.

### 13.3 For a self review

The subject sees their own feedback (that was shared with them), their goals and
learning, their past released reviews, and their **notes** (§13.8). The AI can
draft the self review's text answers from these on request.

### 13.4 For a manager review

- On top, **summaries of the self review and of the peer and upward reviews**,
  with an overall sentiment (§13.6), before the full reviews.
- The **peer reviews** about the subject, each with its own sentiment and the
  reviewer's name (the manager always sees names, §8.5), filterable to positive
  or negative so the manager can pick what to use.
- **Prefill with AI**: on request, the model drafts every text answer of the
  manager review from the self review, peer reviews, feedback and goals, each
  sentence with citations. The draft is clearly marked, every AI-written answer
  carries an "AI draft" chip until the manager edits it, and submit asks once
  more if any answer is still an unedited draft. **Prefill never answers a
  scale, a choice, a binary, a goal rating or the performance score** (§22.1).

### 13.5 Evidence from connected tools

With the company's connections on (§23) and the writer's own accounts linked,
the panel offers **Find evidence in my tools**. The writer chooses which tools and
the period (the cycle's review period by default). Kithena then searches, **as
the writer**, only what the writer can already see:

- chat apps: messages and threads with or about the subject (Slack, Microsoft
  Teams, Google Chat);
- meeting notes and transcripts of meetings both attended (Google Meet, Teams);
- code: pull requests and reviews the subject authored or reviewed (GitHub,
  GitLab);
- work: issues the subject completed or commented on (Linear, Jira);
- documents: pages the subject wrote or edited (Confluence).

The results appear as evidence items, each with a link back to the source and a
one-line summary, which the writer can include or dismiss. The model drafts
from included items only, and every sentence links to them. What is kept: the
links, the one-line summaries the writer included, and the draft. Never the
messages themselves (§22.3).

### 13.6 Sentiment

For each review in the panel and for the writer's own draft, the model labels
each sentence on a five-point scale (very negative to very positive) and quotes
the sentence. **The domain computes** the overall position from the labels
(the mean of sentence labels weighted by length, as a `Decimal`), so the number
is reproducible and every part of it points to a sentence. Shown as a slider with
an emoji at each end and the position marked, plus "3 positive, 1 negative"
counts that filter the sentences. Sentiment is about the text, not the person,
and the screen says so.

### 13.7 Before submitting

The submit modal (§10.3) adds:

- the **performance score**, highlighted, with the option's label and
  description, and, when available, the subject's previous score beside it, so a
  jump is deliberate;
- the **sentiment slider** for the review as written;
- **how it will read**: a short paragraph the model writes on how the subject (or
  the manager, for an upward review) is likely to take it, and any sentences
  likely to be read differently from what was meant;
- **checks** (advisory): answers that describe personality rather than behaviour,
  gendered or age-coded wording, claims with no example, evidence only from the
  last six weeks of a twelve-month period (recency), and a score that does not
  fit the text (a "Exceptional" with mostly negative sentences).

### 13.8 Notes

Every person has private **notes** about their own work and, for managers, about
each report: a running log during the year ("shipped the billing migration").
Notes are never shared, are evidence for the writer's own reviews, and can be
turned into feedback. With chat apps connected, a message can be saved as a
note from the chat app.

---

## 14. Goals

Goals exist on their own and join cycles as an activity. The design follows the
common ground of Lattice, Leapsome, Betterworks and 15Five.

### 14.1 Goal periods

A company defines periods: years, halves, quarters, or custom dates ("FY27 H1").
Periods can overlap. A goal belongs to one period. Periods are calendar dates.

### 14.2 A goal

- Title, description (rich text), owner (a person, a team or the company),
  contributors, period, parent goal (alignment), visibility (everyone, team and
  managers, owner and managers only).
- **Measurement**, one of: key results (each measured as below), a number (start,
  target, current, unit), a percentage, a currency amount (minor units with a
  currency; `decimal.js` in code), done or not done, or milestones (a checklist).
- **Status**: `draft`, `active`, `completed`, `missed`, `cancelled`, with
  **on track / at risk / off track** as the owner's confidence on each check-in.
- **Progress** is computed by the domain: from key results (weighted average),
  from the number (current minus start over target minus start, capped 0–100%
  unless overachievement is allowed), from milestones (done over total).

### 14.3 Weighting

"Weighted or direct" in the request:

- **Direct** (unweighted): a person's goals are tracked and each has its own
  progress; there is no combined score.
- **Weighted**: each goal in a person's set for a period has a weight; weights
  must sum to 100% before the set is **committed**. Key results within a goal
  can also be weighted (sum 100%). The domain computes the **goal score**: the
  weighted sum of each goal's attainment, or of its rating when goals are rated
  in a review (§14.6).

A company picks direct or weighted in settings, per period or for all. The
manager can see and adjust the weights of their reports' goals before they are
committed; after commitment, a change is an event with a reason.

**Leave is taken into account**: when Time Off is present, a person with long
leave in a period (parental, sick, over a threshold the company sets) has their
goal targets shown pro-rated for the time present, beside the original, and the
manager can accept the pro-rated target. Nobody is scored against months they
were not at work.

### 14.4 Alignment

Goals can align to a parent goal (company → team → person). The goals page shows
the tree (Reach `TreeView`) and a person's goals with what they ladder up to.
Progress never rolls up automatically from children to parents; parents have
their own measurement. A parent shows its children's progress beside its own.

### 14.5 Check-ins

The owner updates progress and confidence, with an optional comment. The company
sets a cadence (weekly, fortnightly, monthly, none); a check-in due is an Inbox
task. With integrations, a key result can follow a **Linear** project's or a
**Jira** epic's completion, or a number from a webhook, so it updates itself.
Every check-in is an event; the history is a chart (`TrendChart`).

### 14.6 Goals in a cycle

When the goals activity is on (§8.3):

- **Which goals**: those in the chosen periods. A cycle can include any periods,
  so an H1 goal period can be part of a Q2, Q3, H1 or H2 cycle — fully
  configurable, and the setup shows how the goal period overlaps the review
  period.
- **Option 1, attach automatically**: at launch, every subject's goals in those
  periods are attached.
- **Option 2, the manager chooses**: the overview table has a **Goals** column;
  the manager attaches goals to one report, or selects several reports and
  attaches in bulk (a goal shared by a team, or a template goal copied to each).
  Managers can also **create** a goal for a report from there.
- If **rate goals in the manager review** is on, the manager review gets a
  generated **Goals** section (§11.3): one row per attached goal with its
  progress, a rating on the cycle's goal scale, and a comment. With weighted
  goals, the domain computes the goal score from the ratings and weights and
  shows it before the performance score. It does not set the performance score.
- Attached goals are a snapshot reference: later edits to a goal show as "changed
  since attached".

---

## 15. Learning

### 15.1 What it is

A catalogue of training the company wants people to take, assigned to people
directly, by audience, or through a cycle, with completion and attendance
recorded. Not a full LMS: no course authoring beyond sessions, quizzes and
documents, and no SCORM player in the first phases (§35).

### 15.2 Learning items

| Kind            | What it is                                                                 | Completed when                                                                               |
| --------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Live session    | A scheduled session with one or more dates, in person or online            | Attendance recorded (§15.5) for the required share of the session                            |
| Recording       | A video uploaded to Kithena or linked from Drive, OneDrive, YouTube        | Watched to the required share (uploaded videos), or marked done by the learner (linked ones) |
| External course | A course on a learning platform                                            | The platform reports completion (§15.7), or the learner marks done with a certificate        |
| Document        | A policy or guide, from Documents when present, or uploaded                | Read and acknowledged                                                                        |
| Quiz            | A form template with a pass mark (scale and choice answers marked correct) | Passed                                                                                       |
| Path            | An ordered list of the above                                               | Every required item completed                                                                |

Each item has an audience suggestion (engineering, product, everyone), a
duration, an owner, optional prerequisites, an optional quiz and an optional
session feedback form.

### 15.3 Assignment

HR or a manager assigns an item or a path to people, to a filter (the same
builder as cycles, kept in step for new joiners), or through a cycle (§15.8).
Each assignment has a due date (exact or relative to hire or to assignment) and
optional **acknowledgement**: the learner confirms they will take it, which is an
Inbox task. Mandatory training (compliance, security) can recur ("every 12
months") and expire.

### 15.4 Live sessions and calendar invites

A session date can create a **calendar event** for every enrolled learner,
through the company's Google Workspace or Microsoft 365 connection (§23), with a
Meet or Teams link. The learner's **accepting the invitation counts as
acknowledgement** (Google Calendar push notifications and Microsoft Graph event
change notifications carry the attendee's response); declining offers them
another date. Without a calendar connection, the invitation is an `.ics` file
and acknowledgement is a button.

### 15.5 Attendance taken from the meeting

Checked against the platforms' current APIs:

- **Google Meet**: a subscription through the **Google Workspace Events API** to
  the meeting space (or the organiser) delivers
  `google.workspace.meet.participant.v2.joined` (and `.left`) as the session
  happens. The event names the participant session; the **Meet REST API**
  (`conferenceRecords.participants`, `participantSessions`) gives who joined and
  for how long, and is the catch-up if an event is missed.
- **Microsoft Teams**: a **Microsoft Graph change notification** on the
  meeting's `meetingCallEvents` (call started, call ended, roster updated;
  application permission `OnlineMeetings.Read.All`, subscriptions renewed before
  their three-day limit, rich notifications) tells Kithena when the meeting runs;
  after it ends, the meeting's **attendance report** (`attendanceRecords`) gives
  each attendee's join and leave times. The company's Microsoft admin grants the
  permission and an application access policy.
- **Zoom**: the `meeting.participant_joined` webhook would do the same. Zoom is
  parked with the rest of Kithena's Zoom work until Kithena is a registered
  company (repo memory).
- **In person**: a QR code shown in the room that the learner scans on the phone,
  or the trainer ticks names.

Attendees are matched to learners by their account email. The domain marks
**attended** when a learner was present for at least the item's required share
(default 75%) and keeps the join and leave times. The trainer can correct
attendance, as an event with a reason.

### 15.6 Recordings

A live session's recording can be added to the item after it ends (an upload,
or the link Meet or Teams created), so people who missed it can watch it and
complete the item that way, when the item allows it.

### 15.7 Learning platforms

| Platform          | What its API offers                                                                                                                                                                                                                                                              | Route                                                                                                                    | Business task                                             |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| LinkedIn Learning | For companies with an enterprise licence: the **Reporting API** (`learningActivityReports`, completions and time viewed per learner, a bulk pull), the content API for the catalogue, and **xAPI** statements for real-time completion. The customer's admin provisions the keys | Import catalogue items the company picks; daily pull of completions per learner; xAPI endpoint for real-time completions | None for the customer's own keys; partner programme later |
| Udemy Business    | A **REST Reporting API** (user activity, user course activity, with a lag), **GraphQL** for the catalogue, and an **xAPI webhook** for real-time events. Enabled by the customer's admin under LMS/LXP integrations                                                              | Same as LinkedIn Learning                                                                                                | None                                                      |
| Pluralsight       | **GraphQL** API with `courseProgress` (completion, percent, updated once a day), activated per plan by Pluralsight support                                                                                                                                                       | Daily pull from the last `updatedOn`                                                                                     | The customer asks Pluralsight to activate API access      |
| Frontend Masters  | No public API found for teams                                                                                                                                                                                                                                                    | Link items to courses; the learner marks done and uploads the certificate; HR can import a CSV of the team's progress    | Ask Frontend Masters about a teams API                    |
| Any xAPI source   | Platforms that send xAPI statements                                                                                                                                                                                                                                              | A per-company xAPI statements endpoint that records `completed` and `passed` verbs for matched learners                  | None                                                      |

Every platform is an adapter behind one port (`LearningProvider`: list catalogue,
read completions since, map a learner). A new platform is one adapter. Learners
are matched by email; unmatched rows are shown to HR, never guessed.

### 15.8 Learning in a cycle

When the learning activity is on (§8.3), the chosen items or paths are attached
to every subject at launch (option 1) or the manager attaches them per report or
in bulk from the overview table (option 2). The overview shows completion per
subject; the manager review can show it in the panel and, if the cycle says so,
as a read-only section. Learning recommended in a review ("take the system
design course") can be assigned from the review in one step.

### 15.9 Skills and recommendations

Each item can be tagged with skills from a company list. A review question can be
linked to a skill. With AI on, the module suggests items for a person from gaps
named in their released reviews and goals, for their manager to assign.
Suggestions only.

---

## 16. Automations

### 16.1 Recurring cycles (PF16)

An automation is a rule that creates cycles. HR builds it with the same steps as
a cycle (participants filter, activities, forms, deadlines, reminders, release)
plus a **schedule**:

- **Calendar**: "every 6 months from 1 January", "every quarter", "every year
  on 1 March". Each occurrence creates a cycle named from a pattern ("H{half}
  {year} review"), with participants matched **at creation** and kept in step
  until launch, so new hires are included and leavers dropped.
- **Lead time**: the cycle is created in `scheduled` N days before its start
  (default 14), so HR can look at it, and it is launched by the normal timer.
- Exclusions in the rule: people on probation, people hired less than N days
  before the start, contractors, people on long leave.
- Deadlines are always **relative** ("self review 14 days after start").

The result of every occurrence is an ordinary **scheduled cycle**. Changing it
does not change the automation; changing the automation changes future
occurrences only. Pausing an automation stops new occurrences.

### 16.2 Built in words

"Create a review every six months for everyone except people on probation, with
self, manager and peer reviews using the Standard form, self due in two weeks,
manager in four." The model plans an automation by field and template name, the
domain resolves and validates it, and HR sees the automation, its next three
occurrences and who would be in the first, before confirming.

### 16.3 Probation cycles

An automation can be triggered by an **event** instead of a calendar: a person
is hired, or their probation starts (from the member projection; with
Onboarding, from its events). The rule says when each review happens relative to
that date, for example "3 months after the start, repeated every 3 months, twice"
(reviews at 3 and 6 months), and which activities and forms.

To keep the overview useful and avoid a cycle per person, people whose review
falls in the same week are grouped into one scheduled cycle ("Probation review
· week of 12 Jan"); a company can choose one cycle per person instead. If
the probation is extended or ended early (Onboarding or People events), pending
occurrences move or are cancelled.

Performance writes the review. **The decision stays where it is**: with
Onboarding present, its probation task links to the completed review; without
it, the review is the record and the decision is People's or HR's.

### 16.4 Previews and safety

An automation shows its next occurrences, the people who would be in each, and a
warning when two automations would put the same person in overlapping cycles
with the same activity.

---

## 17. Calibration

Not in the request, and expected by every buyer of a mid-size or larger tool.

- After a cycle closes (or during it, once manager reviews are in), HR opens a
  **calibration session** for a group (an org unit, a level, a manager's
  organisation) with participants (managers, skip-levels, HR).
- The session shows the group's performance scores as a distribution and on an
  **N-box grid** (§18.3), and each person's card with their score, goal score,
  sentiment and summary.
- Adding a person to the session moves their scored review to `in_review`
  (§10.1), so nobody changes it while it is compared.
- Moving a person to another score is a **calibration change** with a required
  reason, recorded as an event that supersedes the manager's value. The manager's
  original stays visible. The subject never sees calibration notes.
- Optional **guide distribution** (for example "about 15% in the top two
  scores"): shown as a target line, never enforced.
- **Finalise** closes the session: the scores become final, the reviews return
  from `in_review` to `locked`, and `performance.rating.finalized` is published
  per person (§25). Release follows (§10.8).

---

## 18. Analytics (PF7)

### 18.1 Principles

- The domain computes every number from the stored answers and events.
- Aggregates that could identify a confidential reviewer are shown only for cells
  of at least five people (People's cohort minimum), or the cycle's minimum for
  upward reviews if higher.
- Private questions appear only to people who may read them.
- Every chart is a Reach chart (repo decision: hand-drawn SVG in `packages/ui`).
- Filters (department, manager, location, level, tenure, activity) and the
  selected chart are in the URL.

### 18.2 The cycle dashboard

- **Tiles** (`Stat`): participants, reviews submitted / total, overdue, by
  activity; nominations outstanding; average performance score; calibration
  progress; unlock requests open.
- **Completion**: by activity over time (`StackedAreaChart`), by department and
  by manager (`BarChart`), with overdue highlighted.
- **Every numeric question** (scale, binary, choice, performance score): how many
  chose each option (`DistributionChart`), with drill-down to the people (for
  those allowed), by department or any filter, compared with the previous cycle
  for the same question id.
- **Choice questions**: counts per option, including multi-select.
- **Rater analytics**: each manager's average score against the company's and
  their spread (`RangeBarChart`), to show lenient and severe raters before
  calibration; self versus manager gaps.
- **Goals**: goal scores and progress distribution; **learning**: completion by
  item and audience.

### 18.3 The N-box grid

Pick any two numeric questions from the cycle (for example the performance score
and a "potential" scale), and the grid shows people in cells (default 3×3; the
grid follows the options, up to 5×5), with counts and names for those allowed
(`HeatmapChart` with a cell list, or a new `GridChart`, §28). Cells can be
labelled by the company ("Key talent", "Rising star"). From calibration (§17)
people can be moved on the grid, which is a calibration change.

### 18.4 The timeline

The cycle overview has a **timeline** (`TimelineChart`) of the cycle's events:
start, nomination deadline, each activity's opening and deadline, reminders sent,
close, calibration and release, with today marked and the share done per
activity drawn on its bar.

### 18.5 Ask for a chart (PF8)

As in Recruiting (Recruiting PRD §23.4): the user asks ("average manager score by
department compared with last cycle", "which teams have the most overdue peer
reviews"), the model returns a **chart plan** — metric, breakdown, filters,
period, chart kind — by name, the domain validates and computes it, and Reach
renders it. The plan is shown as editable chips; the model never sees a value.
Charts can be saved to the dashboard. With AI on, the dashboard also offers
**insights**: the domain finds notable differences (a department two points below
the rest, a manager who rated everyone top) and the model words them, each with
its numbers.

### 18.6 Across cycles

Performance score trends per person (for those allowed), per team and company;
movement between scores cycle to cycle (`MovementChart`); goal attainment over
periods; learning hours. Exportable as CSV for those allowed, and through REST.

---

## 19. The cycle overview (PF5)

### 19.1 Header

The cycle's name, state (live, §8.7), dates, the timeline (§18.4), and the tiles
(§18.2). Actions by state: Edit, Schedule, Launch, Unschedule, Close, Open
calibration, Release, Archive, Export.

### 19.2 The table

One row per participant, for HR (everyone), a manager (their reports, and below
if they choose) and a skip-level (their organisation):

| Column            | Shows                                                                                   |
| ----------------- | --------------------------------------------------------------------------------------- |
| Person            | Avatar, name, job title, department                                                     |
| Manager           | The manager reviewer                                                                    |
| Self              | Status badge                                                                            |
| Manager           | Status badge                                                                            |
| Peers             | "3 of 4 submitted", or **Nominate peers** / "Awaiting approval" when nominations are on |
| Upward            | Same, with **Nominate direct reports** for people who manage anyone                     |
| Goals             | Count attached and weight total, or **Attach goals**                                    |
| Learning          | Completed of attached, or **Attach training**                                           |
| Performance score | After submission, for those allowed                                                     |
| Calibrated        | After calibration                                                                       |

- **Virtualised** (Reach `VirtualList` inside `Table`) and **infinite scroll**:
  the first page is server-rendered, the next pages load as the user scrolls,
  using cursor pagination from the API. A **page size and page number** view is
  also available for people who prefer pages (the table's pagination control),
  and both are in the URL. Tested at 10,000 participants.
- Search, filters and sort in the URL. Saved views.
- Cells update live from the cycle stream (§8.7).
- **Bulk actions** on a selection: remind, extend deadline, attach goals, attach
  training, change reviewer, remove from cycle, export.
- Clicking a status opens the review (for those allowed) in the side panel.

### 19.3 My cycle

Everyone else sees **My reviews**: the reviews they owe and are owed, with
deadlines, and their nominations to make or approve.

---

## 20. Export, PDF and Documents

- **PDF**: any review, a subject's whole cycle (every review shared with them,
  or everything for HR), or a cycle's reviews in bulk (zip, background job). The
  PDF is rendered server-side from the same `FormView` data with the subject's
  view applied when the reader is the subject (private questions absent).
- **To Documents**: when Documents is present, a released review (or the
  subject's cycle packet) can be **filed to the person** as a document of the
  type **Performance and development** (a type the module seeds in Documents
  through Documents' own setup operation when both are present; Confidential,
  employee and HR, retention from the type). The shell composes Performance's
  PDF and Documents' file operation with `subjectRef` (`performance:review:<id>`),
  as Recruiting does for contracts. HR can file a whole cycle at release with
  one action. Without Documents, the PDF download is the export.

---

## 21. Settings (PF17)

**Settings › Performance**: general (performance score scale, peer definition,
minimum responses, review workload threshold), feedback (§12.2, praise channel,
word filter), goals (periods, weighting, cadence, check-in reminders), learning
(providers, required attendance share), release defaults, notifications, AI
(each feature on or off, §22.6), connections (§23), works councils (§23.4),
retention (§30).

---

## 22. AI

### 22.1 The rule

**The domain computes every number. A model reads what the asker may read,
cites it, labels sentences, plans charts, filters and automations by name, and
drafts text. A person decides every rating.** No model output sets a scale, a
choice, a binary, a goal rating, a goal score, a performance score or a
calibration change, sends feedback, submits a review or assigns anything without
a person pressing a button. Every AI feature degrades to a working screen
without the key; CI runs the standalone suite with and without it.

### 22.2 The proposed decision: a model may read reviews and feedback

Everywhere except Documents and Recruiting, a model sees field names and never a
value (`docs/tech-stack.md`). Summaries, prefill and sentiment are reading by
definition, so this PRD **proposes** a third exception, with limits enforced in
Performance:

1. A model reads a review, feedback, goal or note only for a person who may read
   it in Performance, for that request. What is kept is the output, the ids it
   read, and a hash of the text sent.
2. **Confidential authors are removed before the text leaves**: names become
   "Peer 1", "Peer 2", and the summary for a subject is written only from what
   the subject may see (shared reviews, above the minimum), so a summary cannot
   reveal what the screen would not.
3. **Private questions are never sent** for a summary meant for the subject.
4. Special-category data is not sent where it can be detected (health,
   religion, union membership, ethnicity, sexual orientation), and notes about a
   person's health or leave reasons are masked by code before sending.
5. A company can switch each AI feature off (§22.6), and the works council
   setting switches all of them off for an entity until agreed (§23.4).
6. Content is never used to train a model; processing stays in the EU where the
   provider offers it; every prompt leaves through the AI gateway
   (`packages/telemetry/src/ai-gateway.ts`).
7. The domain computes every number (§22.1).
8. Every AI output is logged with the model, the prompt version, the input hash,
   the output, and what the person did with it (AI Act art. 12).

Needs the owner's sign-off, then a record in `docs/tech-stack.md` and
`CLAUDE.md` beside Documents' and Recruiting's (§36, decision 1).

### 22.3 The proposed decision: a model may read the writer's own work tools

Drafting from Slack, Teams, Google Chat, meeting notes, GitHub, GitLab, Linear,
Jira and Confluence means a model reads workplace messages. That is employee
monitoring in most of Europe's eyes unless it is narrow. So, enforced in
Performance:

1. **Only the writer's own linked accounts** (user OAuth, never a workspace-wide
   token for this), and so only what the writer can already see in that tool.
2. **Only on request**, per review, choosing the tools and the period. Nothing
   is fetched in the background, nothing is indexed, and nothing is searched for
   people who are not the subject.
3. **Only about the subject and the review period**: the search filters on the
   subject's account in that tool and the dates.
4. What is kept: links, the one-line summaries the writer included, and the
   draft. The fetched content is discarded after the request.
5. **The subject is told**: a released review drafted with tool evidence says
   which tools were used ("Drafted with help from Slack and GitHub"), and the
   subject can see the linked items they can access.
6. **Off by default** for every company, switched on per tool by an admin, and
   off for an entity under a works council until agreed (§23.4).
7. Never used for a rating, never for ranking people, never across people
   ("who sends the fewest messages") — the module offers no such query.

Needs the owner's sign-off, and a legal review of the employee-monitoring
position per launch country before Phase 4 ships (§36, decision 1).

### 22.4 Features

| Feature                         | Screen     | The domain does                                                                | The model does                                           |
| ------------------------------- | ---------- | ------------------------------------------------------------------------------ | -------------------------------------------------------- |
| Participants by chat            | PF4        | Resolves names to ids; computes the list                                       | Plans a filter and cycle changes by field name           |
| Cycle setup by chat             | PF4        | Validates; shows a diff; applies on confirm                                    | Plans activities, forms, deadlines by name               |
| Write a template                | PF2        | Validates with the kit; rejects invalid output                                 | Drafts sections and questions                            |
| Question suggestions and checks | PF2        | Applies on confirm                                                             | Suggests, rewrites, flags wording                        |
| Review summary                  | PF10       | Selects what the writer may read; masks; checks every citation exists          | Summarises with citations                                |
| Peer and self summaries         | PF10, PF11 | Same                                                                           | Same                                                     |
| Sentiment                       | PF10, PF12 | Computes the overall position from labels                                      | Labels sentences with quotes                             |
| Prefill a manager review        | PF10       | Text answers only; marks drafts; checks citations                              | Drafts text answers                                      |
| Evidence from tools             | PF10       | Searches as the writer; filters to subject and period; keeps links             | Summarises items in one line; drafts from included items |
| Writing checks                  | PF12       | Recency check from evidence dates; score-text mismatch from computed sentiment | Flags personality, coded wording, unsupported claims     |
| How it will read                | PF12       | —                                                                              | Writes a short paragraph                                 |
| Tone check on feedback          | PF14       | —                                                                              | Labels sentences with suggestions                        |
| Ask for a chart, insights       | PF7, PF8   | Validates the plan; computes; finds differences                                | Plans by name; words insights from computed numbers      |
| Automation in words             | PF16       | Validates; previews occurrences and people                                     | Plans an automation by name                              |
| Learning suggestions            | PF15       | Picks candidate items by skill tags                                            | Ranks the candidates against the review's text           |
| Performance assistant           | Chat apps  | Runs each capability as the asker (Assistant PRD)                              | Plans which capabilities to call (§22.10)                |

A citation that does not resolve to an item the asker may read is dropped, with
the sentence that used it.

### 22.5 Explanations a person can check

Every AI output shows what it read (chips to the items), the model and the date,
and a "was this right?" control. A writer's dismissal of an AI draft or a
check is stored with the output.

### 22.6 Switches

Settings › Performance › AI: each feature in §22.4 on or off, per company and per
entity. Defaults: on for builder help, summaries, sentiment, charts and chat
setup; **off** for prefill, evidence from tools and learning suggestions.

### 22.7 The EU AI Act

AI used to evaluate the performance and behaviour of workers is high-risk (Annex
III, point 4(b)). Summaries and drafts that a manager uses to write an
evaluation are within reach of that, even though a person decides. Kithena
treats the module's AI as high-risk, as Recruiting does: the provider's risk
management file and technical documentation (as `docs/recruiting-ai-act.md`),
logging (§22.2 point 8), instructions for use for the deployer, human oversight
by design (§22.1, §22.5), and conformity assessment and registration on the same
schedule as Recruiting's (REC-127, parked until launch preparation, repo memory).
Sentence sentiment is on text, never on voice, face or biometrics, so the
prohibition on emotion recognition at work (art. 5(1)(f)) does not apply; the
module offers nothing that infers emotion from a meeting recording.

### 22.8 GDPR

The module processes personal data about performance on the employer's
legitimate interest or the employment contract, never on consent. A data
protection impact assessment template ships with the module (art. 35), because
evaluation with AI and work-tool evidence meets the criteria. Art. 22 does not
apply because a person makes every decision, and the screens say so. Subjects
can export everything about them except private questions and confidential
authors (§30).

### 22.9 Fairness

Rater analytics (§18.2) and calibration (§17) are the fairness tools. Where a
company records gender or other characteristics lawfully (People's fields), HR
with a separate grant sees performance score distributions by group with the
cohort minimum, separately for reviews written with and without AI prefill, so
the company can see whether the AI changes outcomes.

### 22.10 Assistant capabilities

`packages/contracts/src/assistant/performance.ts`, served by Performance as the
asker (Assistant PRD §8): reviews I owe and their deadlines, my team's review
progress, my goals and their progress, my team's goals at risk, training due for
me or my team, feedback requests waiting for me, a cycle's completion. Scores,
review text and feedback text are not capabilities: the assistant can say a
review is due, not what it says.

---

## 23. Integrations

Named generically in the product ("Chat apps", "Meeting notes", "Code", "Work
tracking", "Documents and wikis", "Calendars", "Learning platforms"); a vendor's
name only on its own row (repo memory).

### 23.1 Work tools for evidence (§13.5)

Each is per-person OAuth, read-only, with the narrowest scope that does the job.
Tokens are sealed. The admin turns each tool on for the company; each person
links their own account.

| Tool            | Route                                                                                                                                                                                                                                                                                                                                                                                            | Phase | Business task                                                     |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----- | ----------------------------------------------------------------- |
| Slack           | `platform/slack`'s app with a **user token** and Slack's **Real-time Search API** (`assistant.search.context`), which searches what the user can see without Kithena storing messages. Slack offers it only to Marketplace-published and internal apps, and limits `conversations.history` to one request a minute for other commercially distributed apps, so a Marketplace listing is required | 4     | List Kithena's Slack app in the Slack Marketplace                 |
| Microsoft Teams | Delegated Graph access to the user's own chats and channel messages they can read. Tenant-wide export (`getAllMessages`) is a protected, metered API and is not used                                                                                                                                                                                                                             | 4     | Entra app (parked with Entra publisher verification, repo memory) |
| Google Chat     | Chat API, user authentication, the user's spaces' messages, read-only                                                                                                                                                                                                                                                                                                                            | 4     | Google OAuth verification for the scope                           |
| Meeting notes   | **Google Meet**: Meet REST API `transcripts`, `transcripts.entries` and `smartNotes` for meetings the user owned or joined (entries are deleted by Google 30 days after the meeting, so older meetings fall back to the notes document in Drive). **Teams**: the user's meeting transcripts through Graph                                                                                        | 4     | Google OAuth verification; Entra app                              |
| GitHub          | A GitHub App installed on the company's organisation, acting with the user's authorisation: pull requests, reviews and issues by the subject in the period                                                                                                                                                                                                                                       | 4     | Register the GitHub App                                           |
| GitLab          | OAuth application, `read_api`: merge requests, reviews, issues                                                                                                                                                                                                                                                                                                                                   | 4     | None                                                              |
| Linear          | OAuth, read: issues completed or commented on by the subject; projects for key results (§14.5)                                                                                                                                                                                                                                                                                                   | 4     | None                                                              |
| Jira            | Atlassian OAuth 2.0 (3LO), read: issues; epics for key results                                                                                                                                                                                                                                                                                                                                   | 4     | Atlassian developer app                                           |
| Confluence      | Atlassian OAuth 2.0 (3LO), read: pages the subject created or edited                                                                                                                                                                                                                                                                                                                             | 4     | Same app as Jira                                                  |

Every tool is an adapter behind one port (`EvidenceSource`: search(subject,
period, asWriter) → items with link, date, kind, text for the request). A new
tool is one adapter.

### 23.2 Chat apps for the work itself

Through `platform/slack` (Teams may follow): review reminders with **Open**,
nominations to approve with buttons, give feedback and praise from a message
action or a shortcut, save a message as a note, unlock requests for HR with
**Approve** and **Decline** that run Performance's own operation as the person,
and the assistant (§22.10).

### 23.3 Calendars and meetings

Google Workspace and Microsoft 365 (the same connection Recruiting uses, §26.2
there): session invitations, responses as acknowledgement, attendance (§15.4,
§15.5).

### 23.4 Works councils

In Germany a works council has a co-determination right over technical systems
able to monitor performance or behaviour (BetrVG § 87(1) no. 6), and in the
Netherlands its consent is needed for systems that monitor staff (WOR art. 27).
Settings › Performance › Works councils lists each legal entity with "agreed on
<date>" or "not agreed". Until agreed, people in that entity cannot be added to a
cycle, and AI and connected tools are off for them. The module exports a
description of what it processes, its AI features and their switches, to give to
the council. **Awaiting a country reviewer**, as Recruiting's packs are.

---

## 24. Access

The org chart is a graph (manager, skip-level, dotted line, HR business partner
by org unit), so **who manages whom** is OpenFGA, as in People and Time Off,
written from the member projection. **Who may read a given review** is decided by
the domain from the review's own rows (author, subject, activity, sharing,
confidentiality, release, detached), in the application layer, for every
transport — Documents' and Recruiting's reasoning for row-level grants.

| Role                   | Scope                                             | May                                                                                                                                                    |
| ---------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Performance admin (HR) | Tenant, or org units                              | Everything: templates, cycles, automations, calibration, settings; every review and private question; reveal a feedback writer with a reason (audited) |
| Cycle owner            | One cycle                                         | That cycle's setup, unlocks, reminders, close, release                                                                                                 |
| Manager                | Reports (direct, and below if the company allows) | Write manager reviews; read reviews about reports with names; attach goals and training; approve nominations; see feedback about reports               |
| Skip-level             | Their organisation                                | Read manager reviews and scores; join calibration                                                                                                      |
| Calibrator             | A session's group                                 | See and change scores in that session                                                                                                                  |
| Reviewer               | Their reviews                                     | Write and read what they wrote                                                                                                                         |
| Subject                | Their reviews                                     | Read what is released and shared to them, without private questions, with names only where not confidential                                            |
| Member                 | Tenant                                            | Give and request feedback; goals and learning as their visibility allows                                                                               |
| Trainer                | Their sessions                                    | Attendance and recordings for their sessions                                                                                                           |

Authorization lives in the application layer, for every transport (repo rule).
Acceptance proves, at least: a subject cannot read a private question through
any transport; a subject cannot identify a confidential reviewer below the
minimum; a peer cannot read another peer's review; a manager cannot read reviews
of someone who is not their report; an assistant answer never contains review
text.

---

## 25. Events

Every event carries `occurredAt` and `effectiveFrom`; corrections carry
`supersedes`; every field is classified. **No event carries review text, an
answer, feedback text, a note or a comment.**

| Event                                                                                                                                                             | When                                                | Notable fields                                                                                                                                             |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `performance.cycle.created` / `.scheduled` / `.unscheduled`                                                                                                       | Setup                                               | cycleId, startDate, periodFrom, periodTo, automationId?                                                                                                    |
| `performance.cycle.launching` / `.launched` / `.launch_failed`                                                                                                    | Launch                                              | counts per activity; reason                                                                                                                                |
| `performance.cycle.closing` / `.closed` / `.archived`                                                                                                             | End                                                 | counts by final status                                                                                                                                     |
| `performance.participant.added` / `.removed`                                                                                                                      | Membership                                          | personId, by, reason?                                                                                                                                      |
| `performance.nomination.submitted` / `.decided`                                                                                                                   | Nominations                                         | subjectId, nomineeIds, decision                                                                                                                            |
| `performance.review.created` / `.started` / `.submitted` / `.unlock_requested` / `.unlocked` / `.held_for_calibration` / `.released_from_calibration` / `.closed` | Review state                                        | reviewId, activity, subjectId, reviewerId, formVersionId, status                                                                                           |
| `performance.review.detached` / `.deleted`                                                                                                                        | Detached review                                     | reviewId                                                                                                                                                   |
| `performance.results.released`                                                                                                                                    | Release                                             | cycleId, subjectIds                                                                                                                                        |
| `performance.rating.finalized`                                                                                                                                    | Calibration finalised, or close without calibration | subjectId, cycleId, scale id, option key, value (decimal string), goalScore?, calibrated, `effectiveFrom` = `periodTo`; `supersedes` on a later correction |
| `performance.feedback.sent`                                                                                                                                       | Feedback                                            | feedbackId, receiverId, shared, confidential (no writer id when confidential)                                                                              |
| `performance.goal.created` / `.committed` / `.checked_in` / `.closed`                                                                                             | Goals                                               | goalId, ownerId, periodId, progress (decimal string), status                                                                                               |
| `performance.learning.assigned` / `.acknowledged` / `.attended` / `.completed`                                                                                    | Learning                                            | itemId, learnerId, source (session, provider, self), dueDate                                                                                               |
| `performance.template.published`                                                                                                                                  | Template version                                    | templateId, versionId, version                                                                                                                             |

`performance.rating.finalized` is the contract with Compensation. It is the
calibrated value, on the company's performance score scale (§11.5), effective at
the end of the review period, so a merit increase can be computed for the right
date and a recalibration after pay changed produces a retroactive delta through
`supersedes`, exactly as the effective-dating rule requires.

---

## 26. With People, Time Off, Documents, Onboarding, Compensation, the Inbox and the assistant

| Flow                             | Screens          | How                                                                                                                                                                                                         |
| -------------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Who works here, who manages whom | All              | Performance's member projection, fed by People's events (or the import)                                                                                                                                     |
| Manager changes mid-cycle        | PF5              | People's `person.manager_changed` → §8.8                                                                                                                                                                    |
| Reviewers and learners on leave  | PF4, PF5         | The shell passes Time Off's absences for the people on screen (props are JSON, repo memory); reminders skip days away; deadlines suggest an extension; goals pro-rate (§14.3)                               |
| Public holidays in deadlines     | PF4              | The shell passes Time Off's holidays for participants' locations to the date pickers and the checks (§8.6)                                                                                                  |
| Reviews filed to the person      | PF5, PF10        | The shell runs Performance's PDF and Documents' file operation with `subjectRef` (§20)                                                                                                                      |
| Probation reviews                | PF16             | Hires and probation dates from People's events, or Onboarding's; Onboarding's probation task links to the review (§16.3)                                                                                    |
| Ratings to pay                   | —                | Compensation consumes `performance.rating.finalized` (§25)                                                                                                                                                  |
| Tasks                            | Inbox            | Performance answers the Inbox read: reviews due, nominations, unlock requests, feedback requests, check-ins, training to acknowledge; updates for releases; one line in `apps/web/src/lib/inbox/sources.ts` |
| Questions in chat                | Chat apps        | Performance's assistant capabilities (§22.10)                                                                                                                                                               |
| Give feedback from a profile     | People P-screens | The shell adds "Give feedback" to the person page when both are present                                                                                                                                     |

Each module stays sellable alone: every row above has a "without" path in the
section it points to.

---

## 27. Screens and navigation

### 27.1 Shell

Web: "Performance" (`target` icon, or the closest Reach has) after Recruiting in
the sidebar, with sub-items My reviews, Cycles, Feedback, Goals, Learning,
Calibration, Analytics, Form templates (HR), Automations (HR). Phone: a
Performance entry under More. Settings gains a Performance tab.

### 27.2 Web screens (remote `apps/web/performance`, port 3007)

| Id   | Screen                                                     | Route                                           |
| ---- | ---------------------------------------------------------- | ----------------------------------------------- |
| PF1  | Performance home: what I owe, what is owed to me, my goals | `/performance`                                  |
| PF2  | Form template builder with preview and history             | `/performance/templates/<id>?version=`          |
| PF3  | Form templates list                                        | `/performance/templates`                        |
| PF4  | Cycle setup (steps, AI chat)                               | `/performance/cycles/<id>/setup?step=`          |
| PF5  | Cycle overview (tiles, timeline, table)                    | `/performance/cycles/<id>`                      |
| PF6  | Cycles list                                                | `/performance/cycles?…`                         |
| PF7  | Cycle analytics                                            | `/performance/cycles/<id>/analytics?…`          |
| PF8  | Ask for a chart                                            | `/performance/analytics/ask?q=`                 |
| PF9  | Nominations                                                | `/performance/cycles/<id>/nominations?subject=` |
| PF10 | Write a review, with the detail panel                      | `/performance/reviews/<id>?panel=`              |
| PF11 | Read a review (and released results)                       | `/performance/reviews/<id>/read`                |
| PF12 | Submit modal                                               | `?submit=open` on PF10                          |
| PF13 | My reviews                                                 | `/performance/reviews?…`                        |
| PF14 | Feedback: give, request, received, sent                    | `/performance/feedback?tab=`                    |
| PF15 | Learning: catalogue, my learning, an item, a session       | `/performance/learning?…`, `/…/<id>`            |
| PF16 | Automations                                                | `/performance/automations`, `/…/<id>`           |
| PF17 | Settings                                                   | `/performance/settings/<page>`                  |
| PF18 | Goals: mine, my team, the company tree, a goal             | `/performance/goals?…`, `/…/<id>`               |
| PF19 | Calibration session                                        | `/performance/calibration/<id>?view=grid`       |
| PF20 | Unlock requests (HR)                                       | `/performance/unlocks`                          |
| PF21 | Notes                                                      | `/performance/notes?person=`                    |

Every tab, filter and view is its own URL (repo memory). Navigation is
client-side after a server-rendered first page, with no skeleton blink.

### 27.3 Phone screens (`apps/tenant-mobile`)

`PFM1` my reviews, `PFM2` read a review, `PFM3` write a review (the panel as a
bottom sheet), `PFM4` nominations to make or approve, `PFM5` give and request
feedback, `PFM6` my goals and check-ins, `PFM7` my learning, acknowledge and
attend (QR), `PFM8` my team's cycle progress, `PFM9` unlock requests (HR). Form
template builder, cycle setup, calibration, analytics and automations name their
reason in `desktop-only.json` (wide builders and grids), as the mobile parity
gate requires.

---

## 28. Reach additions

Each is added to Reach first, presentational, without knowing what a review or a
cycle is (repo rule). Check the existing component before adding:

- **`FormView`**: renders sections and questions of the six types from plain
  props, read-only or editable, with a comment box per question and a
  highlighted question. Built on `Field`, `RichText`, `RadioGroup`, `Select`,
  `Combobox`, `Rating` (check whether `Rating` takes labelled options as a
  variant before adding a scale control).
- **`FormBuilder`**: sections and questions with `Sortable`, add and remove,
  and a slot for a per-question preview — check `SectionEditor` and
  `FormSections` first; it may be a composition, not a component.
- **`Sheet`** gains a non-modal, resizable variant for the detail panel, if it
  has none (check `ListDetail`).
- **`SentimentSlider`**: a read-only `Slider` variant with end icons and a
  marker, if `Slider` cannot take it as props.
- **`GridChart`** for the N-box, unless `HeatmapChart` takes a cell slot.
- **`TimelineChart`** exists; it may need a "progress on bar" option.
- Charts otherwise from the existing set: `DistributionChart`, `BarChart`,
  `StackedAreaChart`, `RangeBarChart`, `MovementChart`, `TrendChart`,
  `HeatmapChart`.

---

## 29. Storage

Schema `performance`, role `svc_performance NOBYPASSRLS`, RLS on `tenant_id`, an
outbox relayed by Debezium. Tables: `member`, `org_edge`, `settings`,
`form_template`, `form_version` (definition as JSONB validated by the kit,
immutable once published), `cycle`, `cycle_activity`, `cycle_participant`,
`participant_override`, `nomination`, `review`, `review_revision` (answers as
JSONB, append-only), `review_draft`, `unlock_request`, `release`, `feedback`,
`feedback_request`, `note`, `goal_period`, `goal`, `key_result`, `goal_check_in`
(append-only), `cycle_goal`, `learning_item`, `learning_path`, `session`,
`enrolment`, `attendance` (append-only), `provider_connection`,
`provider_completion`, `cycle_learning`, `calibration_session`,
`calibration_change` (append-only), `rating` (finalised values,
`numeric(19,4)` for computed scores), `automation`, `automation_run`,
`ai_output` (model, prompt version, input hash, output, outcome),
`evidence_link`, `tool_link` (sealed tokens), `chart_plan`, `saved_view`,
`idempotency_key`, `outbox`. Recordings and certificates in S3
(`PERFORMANCE_BUCKET`), sealed with `PERFORMANCE_ENCRYPTION_KEY` (spare saved in
1Password after first deploy, repo memory); SeaweedFS locally; in memory in the
standalone suite. Atlas migrations, expand-contract.

The cycle's Temporal workflow and the reminder timers live in Temporal; the
tables are the truth, and the workflow re-reads them at every step.

---

## 30. Privacy and retention

- **Retention**: a company rule per kind (reviews, feedback, notes, goals,
  attendance), as a duration after the person leaves (default: reviews and
  ratings 3 years after leaving; feedback and notes 1 year; attendance for
  mandatory training as long as the training's own record rule). Nothing is
  deleted without HR confirming each batch, as in Documents. A legal hold
  overrides.
- **Rights**: access and portability export everything about the person except
  private questions and the identity of confidential writers (which would harm
  others' rights, GDPR art. 15(4)); rectification of a review is a response
  (§10.8), not an edit of someone else's opinion; erasure follows retention and
  legal hold.
- **Notes** are the author's. On leaving, a person's own notes are deleted after
  30 days unless HR holds them.
- **Connected-tool content** is never stored (§22.3).

---

## 31. Headless surfaces

- GraphQL subgraph `performance` (one query per screen, persisted operations),
  composed by the Cosmo Router, with the subscriptions in §8.7.
- REST `/v1/performance/...` with OpenAPI from the Zod contracts, idempotency
  keys on every write, cursor pagination everywhere.
- Webhooks for every published event, signed.
- An xAPI statements endpoint per company (§15.7) and the calendar and meeting
  notification endpoints (signed or validated per provider).

---

## 32. Non-functional requirements

- A cycle of 10,000 participants with four review activities (about 60,000
  reviews) launches in under five minutes, and the state change reaches every open
  screen within 2 s.
- The overview table scrolls 10,000 rows without jank (virtualised), and its
  first page renders server-side in under 300 ms at the 95th percentile.
- An autosave round trip is under 200 ms at the 95th percentile; no keystroke is
  lost when the network drops (queued saves).
- The AI summary for one review returns in under 15 s, streamed; prefill in under
  30 s. Evidence from tools returns per tool as each finishes.
- Every screen passes axe; a review can be written and submitted with a keyboard
  and a screen reader in the acceptance suite; the sentiment slider has a text
  equivalent.
- Every route enforces access in the application layer (§24).

---

## 33. What the market misses, and this offers

Researched against Lattice, Culture Amp, Leapsome, 15Five, Betterworks, Personio
and Workday. Each is a pressing need customers raise and none of them covers
well:

1. **Reviews that cite their evidence.** AI writing help exists everywhere; a
   draft where every sentence links to the feedback, peer review, pull request or
   message it came from, and drops the sentence when the link fails, does not.
   It is what makes AI-assisted reviews defensible to an employee, a works
   council and the AI Act.
2. **Leave-aware fairness.** Goals pro-rated for long leave, reminders that
   wait for the reviewer to be back, deadlines that skip public holidays per
   location. Requires an HRIS that knows leave, which is why point tools cannot.
3. **Re-identification protection** that is enforced, not a setting: minimum
   responses for confidential reviews, names removed before any model reads
   them, summaries for the subject written only from what the subject may see.
4. **Works-council mode.** An entity-level gate, AI switches and an export that
   describes the system for the council — a real blocker for European rollouts
   that tools handle in sales calls, not in the product.
5. **Ratings ready for pay, with effective dating.** Calibrated ratings as
   effective-dated events that a compensation module can use for retroactive
   corrections — most tools export a CSV.
6. **Probation and recurring cycles that run themselves**, created in words, with
   relative deadlines and a preview of who will be in them.
7. **Manager change handled**: the review moves with the report, with the old
   manager's handover note and draft.
8. **Writing checks** before submit — recency, personality language, coded
   wording, score that does not match the text — usually a separate product
   (Textio).
9. **A form engine reused across the product**, so surveys, quizzes and
   probation reviews look and behave the same.

## 34. Parity check

| Capability                                      | Here                                 |
| ----------------------------------------------- | ------------------------------------ |
| Review cycles: self, manager, peer, upward      | §8, §9                               |
| Peer nominations and approvals                  | §9.3                                 |
| Anonymous / confidential feedback rules         | §8.5, §12.2                          |
| Custom review forms, versioned                  | §11                                  |
| Overall rating                                  | §11.5                                |
| Deadlines and reminders                         | §8.4                                 |
| Continuous feedback, requests, praise           | §12                                  |
| Private notes                                   | §13.8                                |
| AI writing assist and summaries                 | §13, §22                             |
| Goals and OKRs, alignment, weighting, check-ins | §14                                  |
| Goals in reviews                                | §14.6                                |
| Learning assignments and completion             | §15                                  |
| Learning platform integrations                  | §15.7                                |
| Calibration and 9-box                           | §17, §18.3                           |
| Analytics and custom reports                    | §18                                  |
| Recurring and onboarding/probation cycles       | §16                                  |
| Export to PDF and the employee file             | §20                                  |
| Slack and Teams                                 | §23                                  |
| Acknowledgement and employee response           | §10.8                                |
| 1:1 meetings with agendas                       | Later (§35)                          |
| Engagement surveys                              | Later, on the form kit (§11.10)      |
| Career ladders and competency frameworks        | Later (§35); skills tags now (§15.9) |
| Development plans                               | Later, as an activity kind (§9)      |
| External (customer) reviewers                   | Later (§35)                          |
| SCORM player                                    | Later (§35)                          |

## 35. Scope and phasing

- **Phase 0 — unblock**: manifest, schema, role, outbox, boot, Dockerfile,
  codegen, `module.performance` offered, `packages/contracts/src/forms` and
  `packages/form-kit` with their domain tests.
- **Phase 1 — boots alone, runs a cycle**: contracts; the domain (cycles,
  activities, reviews and statuses, nominations, versions, release, feedback
  rules, goals scoring); storage; Temporal launch and reminders; the SSE
  subscriptions; GraphQL and REST; web screens PF1–PF7, PF9–PF14, PF17, PF20
  without AI; PDF export; the member import; standalone.
- **Phase 2 — goals, learning, automations, calibration**: PF15, PF16, PF18,
  PF19, PF21; sessions with `.ics`; learning items without providers;
  probation automations; rater analytics, N-box, timeline.
- **Phase 3 — AI**, after §22.2 is signed off: builder help, summaries,
  sentiment, prefill, writing checks, tone check, chat setup and automations in
  words, ask for a chart PF8 and insights; the AI Act file.
- **Phase 4 — integrations**: calendars and attendance (Meet, Teams), learning
  platforms (LinkedIn Learning, Udemy Business, Pluralsight, xAPI), chat apps for
  the work, and, after §22.3 is signed off and the legal review is done,
  evidence from work tools.
- **Phase 5 — with the suite**: §26's flows: Time Off in reminders, deadlines
  and goals, Documents filing, Onboarding probation links, the Inbox source,
  assistant capabilities, People's "Give feedback", the Compensation event;
  phone screens PFM1–PFM9.

Out of scope: 1:1 meetings, engagement surveys, career ladders, development
plans, external reviewers, a SCORM player and course authoring, Zoom (parked),
pay of any kind (Compensation), emotion or productivity inference of any kind.

## 36. Decisions and open questions

Proposed on 2026-10-17. Each follows common practice in the products §34
compares against, and each is **open for review**: changing one is a commit,
not a redesign.

1. **A model may read reviews and feedback** (§22.2) and **a writer's own work
   tools** (§22.3): **proposed, needs sign-off.** Until then Phases 1 and 2 ship
   without them, and every screen works.
2. **Goals and Learning are inside `performance`** (§5.5), built as separate
   bounded contexts so either can become its own `ModuleKey`.
3. **Forms are a contract and a pure kit, stored per module** (§5.6), not a
   service.
4. **Live status is a GraphQL subscription over SSE through the Cosmo Router,
   backed by a Redpanda topic** (§8.7), so no module runs its own pub/sub and the
   stream only says what was committed.
5. **The cycle lifecycle is a Temporal workflow** (long-running, with timers and
   human steps), per the repo's Temporal and BullMQ split. PDF bulk export and
   provider pulls are BullMQ jobs.
6. **Confidential feedback writers can be revealed to HR** only through an
   audited action with a reason (§12.2). A company that wants true anonymity can
   turn the action off; then nobody can reveal a writer.
7. **Release defaults to after close and calibration** (§10.8).
8. **One company-wide performance score scale is recommended** (§11.5) so
   Compensation receives one scale; per-template scales remain possible.
9. **Probation cycles group by week** (§16.3).
10. **A model never answers a numeric question** (§22.1), including in prefill.
11. **`in_review` is the calibration hold** (§10.1), decided by the owner on
    2026-10-17: in the contract and the domain from Phase 1, reachable from no
    screen until calibration ships.

Open questions for the owner:

1. **Who approves an unlock**: the request says both "the manager can unlock"
   and "an inbox task for HR". This document makes HR the approver, with a setting
   to let managers approve for their reports (§10.4). Which should be the
   default?
2. **Peers**: same manager by default, widened to same team by a setting
   (§9.3). Should cross-team peers (people who work together often) be a third
   option once work tools are connected?
3. **Business tasks** for Phase 4: Slack Marketplace listing, Google OAuth
   verification, the GitHub App and Atlassian app, and asking Frontend Masters
   about a teams API. Entra and Zoom stay parked with the existing decision.
