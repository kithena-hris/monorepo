# Performance and Development — build plan

Every ticket needed to ship the Performance and Development module (`PRF-`),
in an order that works. Tick each box as it lands, in the same commit as the
work.

**This file, in the repository, is the record of progress.**

| What                  | Where                                                                                     |
| --------------------- | ----------------------------------------------------------------------------------------- |
| Requirements          | [`docs/performance-prd.md`](./performance-prd.md)                                         |
| Screens               | Claude Design project `6fed6ac8…`: Kithena Performance, web and mobile (not designed yet) |
| The plan this mirrors | [`docs/recruiting-build-plan.md`](./recruiting-build-plan.md)                             |

### How the work lands

Everything is built on the one branch **`performance`**, with a commit per
concern (a ticket or a small group). It goes to `main` as one pull request and
one merge, so Vercel deploys once.

### Rules no ticket restates

- `dependsOn: []`, `requiresPeopleSource: 'either'`. Other modules are joined
  by events or the shell (PRD §26).
- Zod is the single schema source; every contract field is classified.
- `occurredAt` and `effectiveFrom` on every event; corrections carry
  `supersedes`.
- No `new Date()` in the domain; calendar dates are `date`; computed scores in
  `decimal.js` and `numeric(19,4)`.
- Domain tests first (`src/domain/` and `packages/form-kit`).
- Screens are built from Reach; what Reach lacks is added to Reach first.
- Authorization in the application layer, never only in a resolver.
- Every filter and view in the URL; server-rendered first page; no polling.
- AI can run every operation as the person, with writes confirmed; it suggests
  numeric answers and calibration changes, and a person confirms each. The
  domain computes every derived number (PRD §22.1).
- No event carries review text, an answer, feedback text, a note or a comment.

---

## Phase 0 — unblock

- [x] **PRF-001** `services/performance/module.manifest.ts`: key
      `performance`, `dependsOn: []`, `requiresPeopleSource: 'either'`,
      entitlement `module.performance`; offered in `OFFERED_MODULES`.
- [x] **PRF-002** Schema bootstrap: `performance` with `svc_performance
NOBYPASSRLS` and RLS on `tenant_id`.
- [x] **PRF-003** Outbox and Debezium: `performance.outbox`, table list.
- [x] **PRF-004** `services/performance` boots like Recruiting: `main.ts`,
      `/healthz`, Dockerfile.
- [x] **PRF-005** Codegen walks `performanceEvents` and the forms contract.
- [x] **PRF-006** `just standalone performance`; the module in the CI
      `standalone` matrix.
- [x] **PRF-007** `packages/contracts/src/forms`: `FormDefinition`,
      `FormSection`, `FormQuestion` (the six types), `FormAnswers`, every field
      classified. PRD §11.1, §11.3.
- [x] **PRF-008** `packages/form-kit`, pure, tests first: `validateDefinition`,
      `validateAnswers`, `normalise` (empty sections removed), `subjectView`
      (private questions removed), `fingerprint`, `diff`, `score`. PRD §11.1–§11.5.
- [x] **PRF-009** Dependency-cruiser rule: `packages/form-kit` imports only
      contracts and `domain-kit`; nothing imports a module through it.

## Phase 1 — boots alone, runs a cycle

### Contracts (`packages/contracts/src/performance/`)

- [x] **PRF-010** Primitives: ids, cycle and review statuses (including the
      reserved `in_review`), activity kinds, confidentiality and sharing values,
      release modes. PRD §6, §7, §10.1.
- [x] **PRF-011** Events, every field classified, `performance.rating.finalized`
      shaped for Compensation. PRD §25.
- [x] **PRF-012** The Inbox answer for Performance's item kinds. PRD §5.3.
- [x] **PRF-013** Subscription payloads for the cycle stream. PRD §8.7.

### Domain (tests first)

- [x] **PRF-015** Cycle aggregate and its state machine: draft, scheduling,
      scheduled, launching, launch_failed, in_progress, closing, closed,
      archived; the launch-or-schedule rule from the start date and time zone.
      PRD §7, §8.1, §8.7.
- [x] **PRF-016** Participants: filter, inclusions and exclusions with reasons,
      keep in step with a cutoff, "no longer matches". PRD §8.2.
- [x] **PRF-017** `ActivityKind` port and the six kinds' configuration and
      launch rules. PRD §8.3, §9.
- [x] **PRF-018** Deadlines (exact and relative), order checks, reminder rules.
      PRD §8.4.
- [x] **PRF-019** Checks before launch, blocking and not. PRD §8.6.
- [x] **PRF-020** Peers: anyone in the company except the subject; "all peers"
      means the team (same manager, same team setting), with the deterministic
      cap. PRD §9.3.
- [x] **PRF-021** Nominations: who nominates, minimum and maximum, approval,
      decline and replace, for peer and upward; the picker lists the team first,
      then people the subject works with, then a search over everyone. PRD §9.3,
      §9.4.
- [x] **PRF-022** Review aggregate: statuses, revisions, unlock request and
      decision, close mapping (abandoned, withdrawn, completed), the last
      submitted revision as the completed one; the `in_review` calibration hold
      and its transitions, domain only, with no operation or screen reaching it.
      PRD §10.1, §10.4, §10.5.
- [x] **PRF-023** Detached reviews: detach on removal, keep or delete by the
      author, reattach. PRD §10.7.
- [x] **PRF-024** Changes after launch: late joiners and their deadlines,
      removal, reviewer leaves, manager change with handover. PRD §8.8.
- [x] **PRF-025** Confidentiality and sharing, the response minimum, who sees
      which review and name. PRD §8.5, §24.
- [x] **PRF-026** Release and acknowledgement. PRD §10.8.
- [x] **PRF-027** Form template versions: draft, publishing, published,
      superseded, archived; pinning; draft and scheduled cycles follow the
      latest; delete only if never used. PRD §11.7, §11.8.
- [x] **PRF-028** Performance score rules and the company scale. PRD §11.5.
- [x] **PRF-029** Feedback: the two settings and their three values, the
      10-minute undo, requests, templates without a performance score, praise.
      PRD §12.
- [x] **PRF-030** Notes. PRD §13.8.

### Storage

- [x] **PRF-035** Atlas migrations for every table in PRD §29, expand-contract.
- [x] **PRF-036** Drizzle repositories, with integration tests against
      Postgres 18.
- [x] **PRF-037** Member projection and org edges from People's events, and the
      member import (Recruiting's, copied). PRD §5.2.
- [ ] **PRF-038** File storage port (S3, SeaweedFS, in memory) for recordings
      and certificates.

### Application

- [x] **PRF-040** Templates: create, edit (new draft version), publish
      (asynchronous, re-points draft and scheduled cycles), archive, delete.
- [x] **PRF-041** Cycles: create, copy, edit, schedule, unschedule, launch,
      close, archive.
- [ ] **PRF-042** `CycleWorkflow` on Temporal: validate, resolve deadlines, open
      nominations, timer to the start, batched idempotent review creation,
      reveal at `in_progress`, retries and `launch_failed`. PRD §8.7.
- [ ] **PRF-043** Reminders: Inbox always; email through `platform/messaging`,
      chat app through `platform/slack`, by the person's notification
      preferences; stop on submit. PRD §8.4.
- [x] **PRF-044** Reviews: autosave patches with revision checks, submit,
      unlock requests and decisions with Inbox tasks, decided by HR only.
      PRD §10.2–§10.4.
- [x] **PRF-045** Feedback, requests and notes.
- [x] **PRF-046** Retention sweeper, legal holds, DSAR export (no private
      questions, no confidential writers) and deletion. PRD §30.
- [x] **PRF-047** Analytics queries for the cycle dashboard, with the cohort
      minimum. PRD §18.1, §18.2.
- [x] **PRF-048** PDF rendering of a review, a subject's cycle and a bulk zip
      (BullMQ), with the subject's view applied. PRD §20.
- [ ] **PRF-049** Works council gate per legal entity and the description
      export. PRD §23.4.
- [x] **PRF-050** Audit: `performance.activity.recorded` in the same
      transaction as every action, refused attempt and sensitive read, with
      actor, as whom, AI output id, action, target, fields changed, reason
      link, surface, request, IP and user agent, outcome; no values.
      `platform/audit` consumes `kithena.performance.v1`. PRD §24.1.

### Transports

- [x] **PRF-055** GraphQL subgraph `performance`, one query per screen.
- [x] **PRF-056** Subscriptions `cycleChanged`, `cyclesChanged` over SSE,
      backed by the `kithena.performance.v1.cycle` topic through the Cosmo
      Router's event-driven federation; reconnect reads once. PRD §8.7.
- [x] **PRF-057** REST `/v1/performance/...`, OpenAPI, idempotency keys, cursor
      pagination.
- [x] **PRF-058** Signed webhooks for every published event.
- [x] **PRF-059** Inbox source: Performance's answer, one line in
      `apps/web/src/lib/inbox/sources.ts`.

### Reach

- [ ] **PRF-060** `FormView`: the six types, read-only and editable, comments,
      a highlighted question. Check `Rating` and `Field` first. PRD §28.
- [ ] **PRF-061** `FormBuilder` from `SectionEditor`, `FormSections` and
      `Sortable`, with a per-question preview slot. PRD §28.
- [ ] **PRF-062** A non-modal, resizable `Sheet` (or `ListDetail`) for the
      detail panel. PRD §13.1.
- [ ] **PRF-063** `SentimentSlider` as a `Slider` variant, with a text
      equivalent. PRD §13.6.

### Web (`apps/web/performance`, port 3007)

- [x] **PRF-070** Remote scaffold, sidebar entry with sub-items, Settings tab.
- [x] **PRF-071** PF1 home and PF13 my reviews.
- [x] **PRF-072** PF3 templates list and PF2 builder with the whole-form and
      per-question previews and the version history.
- [x] **PRF-073** PF4 cycle setup: steps, filters, inclusions and exclusions,
      activities, deadlines, reminders, release, the launch-or-schedule button.
- [x] **PRF-074** PF5 cycle overview: live state, tiles, table (virtualised,
      infinite scroll and pages, bulk actions), PF9 nominations.
- [x] **PRF-075** PF6 cycles list, live.
- [x] **PRF-076** PF10 write a review with the detail panel (without AI), PF12
      submit modal, PF11 read and release.
- [x] **PRF-077** PF20 unlock requests.
- [x] **PRF-078** PF14 feedback: give, request, received, sent.
- [x] **PRF-079** PF7 cycle analytics without AI.
- [x] **PRF-080** PF17 settings.

### Standalone

- [x] **PRF-099** Acceptance: one cycle end to end with every review activity
      (PRD §3, validation), with People, Time Off, Documents, Onboarding and
      Compensation absent and the AI keys unset; the access cases in PRD §24,
      including a private question absent from every transport.

## Phase 2 — goals, learning, automations, calibration

- [x] **PRF-100** Goal periods, goals, key results, measurement and progress,
      tests first. PRD §14.1, §14.2.
- [x] **PRF-101** Weighting: direct and weighted, commitment, goal score.
      PRD §14.3.
- [x] **PRF-102** Alignment and check-ins with their cadence. PRD §14.4, §14.5.
- [x] **PRF-103** Goals in a cycle: options 1 and 2, bulk attach, the
      generated goals section. PRD §14.6.
- [x] **PRF-104** PF18 goals screens.
- [x] **PRF-105** Learning items, paths, assignment by person, filter and
      cycle, acknowledgement, recurrence and expiry. PRD §15.2, §15.3, §15.8.
- [x] **PRF-106** Sessions with `.ics` invitations, in-person attendance by QR
      and by hand, recordings, quizzes on the form kit. PRD §15.4–§15.6.
- [x] **PRF-107** PF15 learning screens.
- [x] **PRF-108** Automations on a calendar: lead time, exclusions, relative
      deadlines, previews, overlap warnings. PRD §16.1, §16.4.
- [x] **PRF-109** Event-triggered automations and probation cycles grouped by
      week. PRD §16.3.
- [x] **PRF-110** PF16 automations screens.
- [x] **PRF-111** Calibration sessions: subjects added move their scored
      review to `in_review`, changes with reasons, guide distribution, finalise
      back to `locked` and `performance.rating.finalized`. PRD §10.1, §17.
- [x] **PRF-112** PF19 calibration with the N-box grid (`GridChart` or
      `HeatmapChart`). PRD §18.3.
- [x] **PRF-113** Rater analytics, across-cycle trends and the timeline.
      PRD §18.2, §18.4, §18.6.
- [x] **PRF-114** PF21 notes.

## Phase 3 — AI

- [x] **PRF-130** **Gate**: the decision in PRD §22.2 signed off and recorded in
      `docs/tech-stack.md` and `CLAUDE.md`. Accepted by the owner on
      2026-10-17.
- [x] **PRF-131** Masking: confidential authors renamed, private questions
      dropped for the subject's summaries, special-category masking. Pure,
      tests first. PRD §22.2.
- [x] **PRF-132** AI output log (model, prompt version, input hash, output,
      outcome) and the per-feature switches. PRD §22.2, §22.6.
- [x] **PRF-133** Builder help: write a template, suggest, rewrite, check,
      translate. PRD §11.9.
- [x] **PRF-134** Review summaries with citation checks. PRD §13.2, §13.4.
- [x] **PRF-135** Sentence sentiment and the computed position. PRD §13.6.
- [x] **PRF-136** Prefill of the whole review: cited text, and suggested
      numeric answers and performance score with reasons, marked until
      confirmed; submit asks to confirm each. PRD §13.4, §13.7.
- [x] **PRF-137** Writing checks and "how it will read". PRD §13.7.
- [x] **PRF-138** Tone check on feedback. PRD §12.5.
- [x] **PRF-139** Cycle setup and participants by chat, as diffs. PRD §8.2.
- [x] **PRF-140** Automations in words. PRD §16.2.
- [x] **PRF-141** PF8 ask for a chart and insights. PRD §18.5.
- [x] **PRF-142** Learning suggestions from skills. PRD §15.9.
- [ ] **PRF-143** The AI Act file for Performance, beside
      `docs/recruiting-ai-act.md`, and the DPIA template. PRD §22.7, §22.8.
- [x] **PRF-144** Fairness view by group, with and without AI prefill.
      PRD §22.9.
- [x] **PRF-145** The AI panel on every PF screen and in chat apps: plans any
      operation the person could run, shows each write as a proposed action
      with its effect, runs it as the person on confirmation, audited with the
      AI marked. PRD §22.1.
- [x] **PRF-146** AI calibration suggestions with reasons, applied only by a
      calibrator. PRD §17.

## Phase 4 — integrations

- [ ] **PRF-160** Calendar invitations and responses through Google Workspace
      and Microsoft 365. PRD §15.4.
- [ ] **PRF-161** Attendance from Google Meet: Workspace Events API
      subscription, Meet REST catch-up. PRD §15.5.
- [ ] **PRF-162** Attendance from Teams: `meetingCallEvents` notifications with
      renewal, the attendance report. PRD §15.5.
- [ ] **PRF-163** `LearningProvider` port and LinkedIn Learning, Udemy Business
      and Pluralsight adapters; the xAPI endpoint; CSV import. PRD §15.7.
- [x] **PRF-164** Chat apps for the work: reminders, nominations, feedback and
      praise, notes, unlocks. PRD §23.2.
- [x] **PRF-165** **Gate**: the decision in PRD §22.3 signed off. Accepted by
      the owner on 2026-10-17; the legal review per launch country is a
      launch-prep task (PRF-168), not a gate.
- [ ] **PRF-166** `EvidenceSource` port and adapters: Slack (Real-time Search),
      Teams, Google Chat, meeting notes, GitHub, GitLab, Linear, Jira,
      Confluence. Each read only on the person's own explicit, revocable,
      audited grant, per source, off by default (My connected tools). PRD
      §13.5, §22.3, §23.1.
- [ ] **PRF-167** Key results that follow a Linear project or a Jira epic.
      PRD §14.5.
- [ ] **PRF-168** The owner's business tasks (the account owner does them):
      Slack Marketplace listing, Google OAuth verification, the GitHub App, the
      Atlassian app, the Frontend Masters enquiry; at launch prep, a legal
      review of reading connected tools per launch country. PRD §36.

## Phase 5 — with the suite

- [ ] **PRF-190** Time Off's absences and holidays through the shell:
      reminders, deadline checks, goal pro-rating. PRD §26. So far the cycle
      overview marks who is away in the next month ("Away until", never why).
- [x] **PRF-191** Documents: the Performance and development type and filing
      with `subjectRef`. PRD §20.
- [x] **PRF-192** Onboarding: probation dates from its events and its task
      linking to the review. PRD §16.3.
- [x] **PRF-193** People: "Give feedback" on the person page. PRD §26.
- [x] **PRF-194** Assistant capabilities in
      `packages/contracts/src/assistant/performance.ts`. PRD §22.10.
- [x] **PRF-195** Phone screens PFM1–PFM9 and the `desktop-only.json` reasons.
      PRD §27.3.

## Progress notes

- **2026-10-17.** Requirements written and proposed. Nothing is built.
  Decisions open for review are in PRD §36, with no open questions left. The `in_review` review state is the calibration hold, decided by the
  owner: built in Phase 1 in the contract and domain, used from PRF-111.
- **2026-10-17, later.** The owner decided: AI does everything a person can,
  numbers included as suggestions a person confirms (PRF-136, PRF-145,
  PRF-146); connected tools are read only on each person's explicit grant,
  never by default (PRF-166); only HR approves an unlock (PRF-044); every
  action is audited with all its details (PRF-050). Both AI gates are ticked on
  this record.
- **2026-10-17, later still.** A peer can be anyone in the company, with the
  team listed first (PRF-020, PRF-021). The business tasks are the owner's
  (PRF-168). No questions are open.
- **2026-10-17, built.** Phases 0 to 3 and the phone landed in one pull
  request (#424), built from the v2 designs where they differ from v1. What is
  ticked is built and tested; what is not ticked is below, with the decision
  that stands in for it.

## Decisions to review

Taken on the owner's behalf while the owner was away, each the recommended
option. The owner reviewed them on 17 October 2026; where they chose
otherwise, the item says what was built instead.

1. **The launch runs in process, not on Temporal (PRF-042).** A cycle launches
   in batches of 25 subjects, idempotent by review key, resumed by a sweep
   every 60 seconds; a failure is `launch_failed` with Retry.
2. **Done: one activity log for every module (PRF-050).** The owner chose the
   company's log, with each module's filtered to it. Every module raises
   `<module>.activity.recorded`; `platform/audit` keeps it under the module's
   name; Settings lists each module's Activity log as
   `/settings/activity?module=<key>`, read by that module's administrators.
   `performance.audit` is no longer written; its lines were backfilled.
3. **One record table (PRF-035, PRF-036).** Every aggregate is a row of
   `performance.record` under RLS.
4. **The form view, builder and detail panel are composed in the remote, not
   added to Reach (PRF-060 to PRF-063).**
5. **Done: bulk export as one PDF or a zip, the reader's choice (PRF-048).**
   The zip holds a PDF per review and `index.csv`.
6. **Read-only answers are drawn as plain text**, by a one-pass scanner.
7. **Done: goals are private until made public (PRD §14.2).** Owner and
   managers by default; the team, or everyone, when the owner shares it.
   Company goals are everyone's.
8. **Publishing a template is immediate**; there is no "publishing" state.
9. **Feedback audiences follow v2.**
10. **Release modes keep their three stored values** with the v2 words.
11. **The scale's top label is "Exceptional"** (v2).
12. **The VM container is 192 MB with a 112 MB heap.** Measure.
13. **Done: every module's outbox is relayed (PRF-003).** The VM's one relay
    tails all six; nothing written before is replayed. People writes
    `people.person.snapshot` (and restates its departments) for a company
    whenever its modules change, and once after this deploy, so no module
    shows a person as "Someone".
14. **Done: on the phone a session's code is scanned with the camera**
    (expo-camera); typing it stays as the fallback.
15. **Done: chat apps for the work, the assistant's capabilities, the
    Documents type and filing, and "Give feedback" on the person page**
    (PRF-164, PRF-191, PRF-193, PRF-194). A review's PDF is filed to the
    person as "Performance and development", which Documents seeds for every
    company. **Not built yet**: the works council gate (PRF-049), the AI Act
    file (PRF-143, parked to launch prep), Phase 4's provider integrations,
    and Time Off's absences beyond the overview's "Away until" (PRF-190).
    Onboarding now says when probation ends as a plan starts, and its
    probation task links to the review once Performance releases it
    (PRF-192).
16. **A super administrator administers every module.** A People
    administrator, however they became one, is named administrator of every
    module the company has, whenever either happened (identity). People's
    Roles page shows an administrator's HR and Finance as held. Removing
    somebody as People administrator does not remove them elsewhere.
