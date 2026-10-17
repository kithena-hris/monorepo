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

- [ ] **PRF-001** `services/performance/module.manifest.ts`: key
      `performance`, `dependsOn: []`, `requiresPeopleSource: 'either'`,
      entitlement `module.performance`; offered in `OFFERED_MODULES`.
- [ ] **PRF-002** Schema bootstrap: `performance` with `svc_performance
NOBYPASSRLS` and RLS on `tenant_id`.
- [ ] **PRF-003** Outbox and Debezium: `performance.outbox`, table list.
- [ ] **PRF-004** `services/performance` boots like Recruiting: `main.ts`,
      `/healthz`, Dockerfile.
- [ ] **PRF-005** Codegen walks `performanceEvents` and the forms contract.
- [ ] **PRF-006** `just standalone performance`; the module in the CI
      `standalone` matrix.
- [ ] **PRF-007** `packages/contracts/src/forms`: `FormDefinition`,
      `FormSection`, `FormQuestion` (the six types), `FormAnswers`, every field
      classified. PRD §11.1, §11.3.
- [ ] **PRF-008** `packages/form-kit`, pure, tests first: `validateDefinition`,
      `validateAnswers`, `normalise` (empty sections removed), `subjectView`
      (private questions removed), `fingerprint`, `diff`, `score`. PRD §11.1–§11.5.
- [ ] **PRF-009** Dependency-cruiser rule: `packages/form-kit` imports only
      contracts and `domain-kit`; nothing imports a module through it.

## Phase 1 — boots alone, runs a cycle

### Contracts (`packages/contracts/src/performance/`)

- [ ] **PRF-010** Primitives: ids, cycle and review statuses (including the
      reserved `in_review`), activity kinds, confidentiality and sharing values,
      release modes. PRD §6, §7, §10.1.
- [ ] **PRF-011** Events, every field classified, `performance.rating.finalized`
      shaped for Compensation. PRD §25.
- [ ] **PRF-012** The Inbox answer for Performance's item kinds. PRD §5.3.
- [ ] **PRF-013** Subscription payloads for the cycle stream. PRD §8.7.

### Domain (tests first)

- [ ] **PRF-015** Cycle aggregate and its state machine: draft, scheduling,
      scheduled, launching, launch_failed, in_progress, closing, closed,
      archived; the launch-or-schedule rule from the start date and time zone.
      PRD §7, §8.1, §8.7.
- [ ] **PRF-016** Participants: filter, inclusions and exclusions with reasons,
      keep in step with a cutoff, "no longer matches". PRD §8.2.
- [ ] **PRF-017** `ActivityKind` port and the six kinds' configuration and
      launch rules. PRD §8.3, §9.
- [ ] **PRF-018** Deadlines (exact and relative), order checks, reminder rules.
      PRD §8.4.
- [ ] **PRF-019** Checks before launch, blocking and not. PRD §8.6.
- [ ] **PRF-020** Peers: anyone in the company except the subject; "all peers"
      means the team (same manager, same team setting), with the deterministic
      cap. PRD §9.3.
- [ ] **PRF-021** Nominations: who nominates, minimum and maximum, approval,
      decline and replace, for peer and upward; the picker lists the team first,
      then people the subject works with, then a search over everyone. PRD §9.3,
      §9.4.
- [ ] **PRF-022** Review aggregate: statuses, revisions, unlock request and
      decision, close mapping (abandoned, withdrawn, completed), the last
      submitted revision as the completed one; the `in_review` calibration hold
      and its transitions, domain only, with no operation or screen reaching it.
      PRD §10.1, §10.4, §10.5.
- [ ] **PRF-023** Detached reviews: detach on removal, keep or delete by the
      author, reattach. PRD §10.7.
- [ ] **PRF-024** Changes after launch: late joiners and their deadlines,
      removal, reviewer leaves, manager change with handover. PRD §8.8.
- [ ] **PRF-025** Confidentiality and sharing, the response minimum, who sees
      which review and name. PRD §8.5, §24.
- [ ] **PRF-026** Release and acknowledgement. PRD §10.8.
- [ ] **PRF-027** Form template versions: draft, publishing, published,
      superseded, archived; pinning; draft and scheduled cycles follow the
      latest; delete only if never used. PRD §11.7, §11.8.
- [ ] **PRF-028** Performance score rules and the company scale. PRD §11.5.
- [ ] **PRF-029** Feedback: the two settings and their three values, the
      10-minute undo, requests, templates without a performance score, praise.
      PRD §12.
- [ ] **PRF-030** Notes. PRD §13.8.

### Storage

- [ ] **PRF-035** Atlas migrations for every table in PRD §29, expand-contract.
- [ ] **PRF-036** Drizzle repositories, with integration tests against
      Postgres 18.
- [ ] **PRF-037** Member projection and org edges from People's events, and the
      member import (Recruiting's, copied). PRD §5.2.
- [ ] **PRF-038** File storage port (S3, SeaweedFS, in memory) for recordings
      and certificates.

### Application

- [ ] **PRF-040** Templates: create, edit (new draft version), publish
      (asynchronous, re-points draft and scheduled cycles), archive, delete.
- [ ] **PRF-041** Cycles: create, copy, edit, schedule, unschedule, launch,
      close, archive.
- [ ] **PRF-042** `CycleWorkflow` on Temporal: validate, resolve deadlines, open
      nominations, timer to the start, batched idempotent review creation,
      reveal at `in_progress`, retries and `launch_failed`. PRD §8.7.
- [ ] **PRF-043** Reminders: Inbox always; email through `platform/messaging`,
      chat app through `platform/slack`, by the person's notification
      preferences; stop on submit. PRD §8.4.
- [ ] **PRF-044** Reviews: autosave patches with revision checks, submit,
      unlock requests and decisions with Inbox tasks, decided by HR only.
      PRD §10.2–§10.4.
- [ ] **PRF-045** Feedback, requests and notes.
- [ ] **PRF-046** Retention sweeper, legal holds, DSAR export (no private
      questions, no confidential writers) and deletion. PRD §30.
- [ ] **PRF-047** Analytics queries for the cycle dashboard, with the cohort
      minimum. PRD §18.1, §18.2.
- [ ] **PRF-048** PDF rendering of a review, a subject's cycle and a bulk zip
      (BullMQ), with the subject's view applied. PRD §20.
- [ ] **PRF-049** Works council gate per legal entity and the description
      export. PRD §23.4.
- [ ] **PRF-050** Audit: `performance.activity.recorded` in the same
      transaction as every action, refused attempt and sensitive read, with
      actor, as whom, AI output id, action, target, fields changed, reason
      link, surface, request, IP and user agent, outcome; no values.
      `platform/audit` consumes `kithena.performance.v1`. PRD §24.1.

### Transports

- [ ] **PRF-055** GraphQL subgraph `performance`, one query per screen.
- [ ] **PRF-056** Subscriptions `cycleChanged`, `cyclesChanged` over SSE,
      backed by the `kithena.performance.v1.cycle` topic through the Cosmo
      Router's event-driven federation; reconnect reads once. PRD §8.7.
- [ ] **PRF-057** REST `/v1/performance/...`, OpenAPI, idempotency keys, cursor
      pagination.
- [ ] **PRF-058** Signed webhooks for every published event.
- [ ] **PRF-059** Inbox source: Performance's answer, one line in
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

- [ ] **PRF-070** Remote scaffold, sidebar entry with sub-items, Settings tab.
- [ ] **PRF-071** PF1 home and PF13 my reviews.
- [ ] **PRF-072** PF3 templates list and PF2 builder with the whole-form and
      per-question previews and the version history.
- [ ] **PRF-073** PF4 cycle setup: steps, filters, inclusions and exclusions,
      activities, deadlines, reminders, release, the launch-or-schedule button.
- [ ] **PRF-074** PF5 cycle overview: live state, tiles, table (virtualised,
      infinite scroll and pages, bulk actions), PF9 nominations.
- [ ] **PRF-075** PF6 cycles list, live.
- [ ] **PRF-076** PF10 write a review with the detail panel (without AI), PF12
      submit modal, PF11 read and release.
- [ ] **PRF-077** PF20 unlock requests.
- [ ] **PRF-078** PF14 feedback: give, request, received, sent.
- [ ] **PRF-079** PF7 cycle analytics without AI.
- [ ] **PRF-080** PF17 settings.

### Standalone

- [ ] **PRF-099** Acceptance: one cycle end to end with every review activity
      (PRD §3, validation), with People, Time Off, Documents, Onboarding and
      Compensation absent and the AI keys unset; the access cases in PRD §24,
      including a private question absent from every transport.

## Phase 2 — goals, learning, automations, calibration

- [ ] **PRF-100** Goal periods, goals, key results, measurement and progress,
      tests first. PRD §14.1, §14.2.
- [ ] **PRF-101** Weighting: direct and weighted, commitment, goal score.
      PRD §14.3.
- [ ] **PRF-102** Alignment and check-ins with their cadence. PRD §14.4, §14.5.
- [ ] **PRF-103** Goals in a cycle: options 1 and 2, bulk attach, the
      generated goals section. PRD §14.6.
- [ ] **PRF-104** PF18 goals screens.
- [ ] **PRF-105** Learning items, paths, assignment by person, filter and
      cycle, acknowledgement, recurrence and expiry. PRD §15.2, §15.3, §15.8.
- [ ] **PRF-106** Sessions with `.ics` invitations, in-person attendance by QR
      and by hand, recordings, quizzes on the form kit. PRD §15.4–§15.6.
- [ ] **PRF-107** PF15 learning screens.
- [ ] **PRF-108** Automations on a calendar: lead time, exclusions, relative
      deadlines, previews, overlap warnings. PRD §16.1, §16.4.
- [ ] **PRF-109** Event-triggered automations and probation cycles grouped by
      week. PRD §16.3.
- [ ] **PRF-110** PF16 automations screens.
- [ ] **PRF-111** Calibration sessions: subjects added move their scored
      review to `in_review`, changes with reasons, guide distribution, finalise
      back to `locked` and `performance.rating.finalized`. PRD §10.1, §17.
- [ ] **PRF-112** PF19 calibration with the N-box grid (`GridChart` or
      `HeatmapChart`). PRD §18.3.
- [ ] **PRF-113** Rater analytics, across-cycle trends and the timeline.
      PRD §18.2, §18.4, §18.6.
- [ ] **PRF-114** PF21 notes.

## Phase 3 — AI

- [x] **PRF-130** **Gate**: the decision in PRD §22.2 signed off and recorded in
      `docs/tech-stack.md` and `CLAUDE.md`. Accepted by the owner on
      2026-10-17.
- [ ] **PRF-131** Masking: confidential authors renamed, private questions
      dropped for the subject's summaries, special-category masking. Pure,
      tests first. PRD §22.2.
- [ ] **PRF-132** AI output log (model, prompt version, input hash, output,
      outcome) and the per-feature switches. PRD §22.2, §22.6.
- [ ] **PRF-133** Builder help: write a template, suggest, rewrite, check,
      translate. PRD §11.9.
- [ ] **PRF-134** Review summaries with citation checks. PRD §13.2, §13.4.
- [ ] **PRF-135** Sentence sentiment and the computed position. PRD §13.6.
- [ ] **PRF-136** Prefill of the whole review: cited text, and suggested
      numeric answers and performance score with reasons, marked until
      confirmed; submit asks to confirm each. PRD §13.4, §13.7.
- [ ] **PRF-137** Writing checks and "how it will read". PRD §13.7.
- [ ] **PRF-138** Tone check on feedback. PRD §12.5.
- [ ] **PRF-139** Cycle setup and participants by chat, as diffs. PRD §8.2.
- [ ] **PRF-140** Automations in words. PRD §16.2.
- [ ] **PRF-141** PF8 ask for a chart and insights. PRD §18.5.
- [ ] **PRF-142** Learning suggestions from skills. PRD §15.9.
- [ ] **PRF-143** The AI Act file for Performance, beside
      `docs/recruiting-ai-act.md`, and the DPIA template. PRD §22.7, §22.8.
- [ ] **PRF-144** Fairness view by group, with and without AI prefill.
      PRD §22.9.
- [ ] **PRF-145** The AI panel on every PF screen and in chat apps: plans any
      operation the person could run, shows each write as a proposed action
      with its effect, runs it as the person on confirmation, audited with the
      AI marked. PRD §22.1.
- [ ] **PRF-146** AI calibration suggestions with reasons, applied only by a
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
- [ ] **PRF-164** Chat apps for the work: reminders, nominations, feedback and
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
      reminders, deadline checks, goal pro-rating. PRD §26.
- [ ] **PRF-191** Documents: the Performance and development type and filing
      with `subjectRef`. PRD §20.
- [ ] **PRF-192** Onboarding: probation dates from its events and its task
      linking to the review. PRD §16.3.
- [ ] **PRF-193** People: "Give feedback" on the person page. PRD §26.
- [ ] **PRF-194** Assistant capabilities in
      `packages/contracts/src/assistant/performance.ts`. PRD §22.10.
- [ ] **PRF-195** Phone screens PFM1–PFM9 and the `desktop-only.json` reasons.
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
