# Recruiting and Onboarding — build plan

Every ticket needed to ship the Recruiting module (`REC-`) and the Onboarding
module (`ONB-`), in an order that works. Tick each box as it lands, in the same
commit as the work.

**This file, in the repository, is the record of progress.**

| What                  | Where                                                                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Requirements          | [`docs/recruiting-prd.md`](./recruiting-prd.md) (Part II is Onboarding)                                                                     |
| Screens               | Claude Design project `6fed6ac8…`: Kithena Recruiting, Jobs and Onboarding, web and mobile; source in `_build/rc-*.js`, `jobs.js`, `onb.js` |
| The plan this mirrors | [`docs/documents-build-plan.md`](./documents-build-plan.md)                                                                                 |

### How the work lands

Everything, Recruiting and Onboarding alike, is built on the one branch
**`recruiting`**, with a commit per concern (a ticket or a small group). It
goes to `main` as one pull request and one merge, so Vercel deploys once.

### Rules no ticket restates

- `dependsOn: []`, `requiresPeopleSource: 'either'`. Other modules are joined
  by events or the shell (PRD §28).
- Zod is the single schema source; every contract field is classified.
- `occurredAt` and `effectiveFrom` on every event; corrections carry
  `supersedes`.
- No `new Date()` in the domain; calendar dates are `date`; money in minor
  units and `decimal.js`.
- Domain tests first (`src/domain/`).
- Screens are built from Reach; what Reach lacks is added to Reach first.
- Authorization in the application layer, never only in a resolver.
- Every filter and view in the URL; server-rendered first page.
- The domain computes every number; a model reads, cites and writes (PRD §22).
- Every terms pack and the retention table are **awaiting a country
  reviewer** until REC-150.

---

## Phase 0 — unblock

- [x] **REC-001** `services/recruiting/module.manifest.ts`: key `recruiting`,
      `dependsOn: []`, `requiresPeopleSource: 'either'`, entitlement
      `module.recruiting`; offered in `OFFERED_MODULES`.
- [x] **REC-002** Schema bootstrap: `recruiting` with `svc_recruiting
NOBYPASSRLS` and RLS on `tenant_id`; `recruiting_public` with a
      read-only role for `apps/jobs` (PRD §31.2).
- [x] **REC-003** Outbox and Debezium: `recruiting.outbox`, table list.
- [x] **REC-004** `services/recruiting` boots like Documents: `main.ts`,
      `/healthz`, Dockerfile.
- [x] **REC-005** Codegen walks `recruitingEvents`; a check fails when a
      non-`public` field is written to `recruiting_public`.
- [x] **REC-006** `just standalone recruiting`; the module in the CI
      `standalone` matrix.

## Phase 1 — boots alone, hires

### Contracts (`packages/contracts/src/recruiting/`)

- [x] **REC-010** Primitives: ids, stage categories, sources, reason keys,
      consent, the candidate-facing shapes. §12.1, §9.2, §12.4.
- [x] **REC-011** Events, every field classified. §27.
- [x] **REC-012** `ResolvedTerms` and `TermsIssue`, with the mapping onto
      People's employment terms fields and `employment_type`. §19.2.
- [x] **REC-013** Public shapes: listing, job page, apply payload, candidate
      page operations, XML feed. §10, §32.
- [x] **REC-014** The Inbox answer for Recruiting's item kinds. §5.3.

### Domain (tests first)

- [x] **REC-015** Requisition aggregate and approval chain selection. §7.
- [x] **REC-016** Job aggregate; publication target state machine. §8.1, §9.1.
- [x] **REC-017** Ad checks per country and language (gender-neutral title,
      pay range, pay history ban, protected-characteristic word lists). §8.3.
- [x] **REC-018** Apply form schema builder and the never-ask list. §8.4.
- [x] **REC-019** Application aggregate: append-only stage history,
      corrections with `supersedes`, the 10-second undo, rejection. §12.
- [x] **REC-020** Duplicate matching: email, phone, name with CV hash;
      merge as a decision. §11.2.
- [x] **REC-021** Questionnaire scoring and knockouts: flag by default;
      automatic rejection guarded by country. §15.
- [x] **REC-022** Interviews and scorecards: plan, states, ratings,
      independent-feedback visibility, debrief averages and disagreements.
      §16.
- [x] **REC-023** Offer aggregate: versions, supersede on counter-offer,
      checks (band, budget, advertised range), acceptance record. §18.
- [x] **REC-024** Terms pack framework: steps, options as a function of
      answers and date, limits, defaults, clauses, `validateTerms`. §19.1–§19.3.
- [x] **REC-025** Germany pack, with a table of lawful and unlawful cases.
      §19.4, §19.9.
- [x] **REC-026** Spain pack. §19.5.
- [x] **REC-027** United Kingdom pack. §19.6.
- [x] **REC-028** India pack, with the state as a required step. §19.7.
- [x] **REC-029** United States pack, with state and city data. §19.8.
- [x] **REC-030** Benefits: catalogue, eligibility, statutory items locked,
      total rewards with `decimal.js`. §20.
- [x] **REC-031** Contract model: the documents each pack requires;
      `wet_ink` for a German fixed term. §21.1, §21.2.
- [x] **REC-032** Pre-hire: conditions state machine; hired, conditions met,
      cancelled. §21.3.
- [x] **REC-033** Consent and retention per country; the anonymisation plan.
      §13.2, §24.2.
- [x] **REC-034** Access: decided by the domain over the hiring team (PRD §36.7), internal-applicant hiding, works
      council and agency scopes. §25.
- [x] **REC-035** Metrics catalogue and definitions; cohort minimum. §23.
- [x] **REC-036** Referral outcome visibility; agency ownership window. §9.3,
      §9.4.

### Storage

- [x] **REC-040** Atlas migrations for every table in §31.1, expand-contract.
- [x] **REC-041** Drizzle repositories, with integration tests against
      Postgres 18.
- [x] **REC-042** File storage port (S3, SeaweedFS, in memory) and text
      extraction for PDF, DOCX and ODT, written in Recruiting (Documents'
      approach, copied, not imported). §14.1.
- [x] **REC-043** Public projection written in the job's own transaction (no dual write), with a
      `tsvector` per ad language. §31.2.
- [ ] **REC-044** Member projection from People's events, and the member
      import (Time Off's, copied). §5.2.

### Application

- [x] **REC-045** Requisitions and approvals; Inbox tasks.
- [x] **REC-046** Jobs, ads, internal targets, publish and unpublish.
- [x] **REC-047** Public application intake: email code, rate limits,
      honeypot, consent, files, source. §10.4, §11.
- [x] **REC-048** Pipeline moves, bulk actions, rejection with template and
      send time, stage automations. §12.
- [ ] **REC-049** Messages: send through `platform/messaging`, inbound
      replies from Resend's webhook, templates. §12.7.
- [x] **REC-050** Talent pools; consent renewal and expiry job (BullMQ). §13.
- [ ] **REC-051** Scheduling without calendars: working hours, self-scheduling
      links, panels, `.ics`, reminders. §16.4.
- [x] **REC-052** Scorecards, Inbox tasks, debrief, decision. §16.5–§16.7.
- [x] **REC-053** References. §17.1.
- [x] **REC-054** Offers: compose, approve, send, accept, decline, revise.
      §18.
- [x] **REC-055** Contract by upload, pre-hire conditions, `hired` event and
      webhook, job filled. §21.
- [x] **REC-056** Retention sweeper, legal holds, DSAR export and deletion.
      §24.
- [x] **REC-057** Analytics queries for every dashboard in §23.2.
- [x] **REC-058** Works council presentation and consent for DE entities.
      §19.9.

### Transports

- [x] **REC-060** GraphQL subgraph `recruiting`, one query per screen.
- [x] **REC-061** REST `/v1/recruiting/...`, OpenAPI, idempotency keys.
- [x] **REC-062** Public API, XML feed, `JobPosting` JSON-LD builder. §32.
- [ ] **REC-063** Signed webhooks for every published event.
- [x] **REC-064** Inbox source: Recruiting's answer, one line in
      `apps/web/src/lib/inbox/sources.ts`.

### Web (`apps/web/recruiting`, port 3005)

- [x] **REC-070** Remote scaffold, sidebar entry with sub-items, Settings tab.
- [x] **REC-071** R1 home.
- [x] **REC-072** R2, R3 requisitions and approval.
- [x] **REC-073** R4 job setup: details, hiring team, criteria, plan.
- [x] **REC-074** R5 ad editor with checks and languages.
- [x] **REC-075** R6 apply form builder.
- [x] **REC-076** R7 publishing targets.
- [x] **REC-077** R8 internal board and referrals.
- [x] **REC-078** R9 agencies.
- [x] **REC-079** R10 pipeline board and table, bulk actions, filters in the
      URL.
- [x] **REC-080** R11, R12 candidate profile and messages.
- [x] **REC-081** R13 talent pools.
- [x] **REC-082** R14–R16 interview plan, kit and scorecard, scheduling.
- [ ] **REC-083** R17 debrief, R18 references.
- [x] **REC-084** R19–R22 offer, approval, terms composer, contract and
      pre-hire.
- [ ] **REC-085** R23, R24 analytics dashboards with Reach charts and data
      tables.
- [x] **REC-086** R26 all candidates.
- [x] **REC-087** S1–S8 settings.
- [ ] **REC-088** Reach additions (PRD §30), each in Reach first with
      stories and axe.

### Kithena Jobs (`apps/jobs`)

- [ ] **REC-090** App scaffold on Reach; Vercel project; `jobs.kithena.com`;
      reads `recruiting_public` only.
- [x] **REC-091** J1, J2 search: full-text, filters, sort, all in the URL;
      server-rendered first page.
- [x] **REC-092** J3 job page: JSON-LD, 410 for a closed job, sitemap.
      Note: a closed or unpublished job answers 404 with a "no longer open"
      page; App Router has no 410 short of a proxy, and search engines drop
      both.
- [x] **REC-093** J4, J5 apply on a phone: CV first, email code, consent,
      adjustments.
- [x] **REC-094** J6, J7 candidate page: applications, self-scheduling, offer,
      withdraw, my data.
- [ ] **REC-095** J9 agency portal.
- [x] **REC-096** J10 company careers page and the embed script.
- [ ] **REC-097** J11 job alerts: double opt-in, digest, unsubscribe.

### Standalone

- [ ] **REC-099** Acceptance: one candidate from requisition to pre-hire per
      launch country, with People, Documents and Time Off absent and the AI
      keys unset; the access cases in PRD §33.

## Phase 2 — AI

- [x] **REC-110** **Gate**: the decision in PRD §22.2 signed off and recorded
      in `docs/tech-stack.md` and `CLAUDE.md`. Nothing below starts before it.
- [ ] **REC-111** Masking of protected characteristics, pure, tests first.
      §14.6.
- [ ] **REC-112** Model port through the AI gateway; prompt versions;
      `ai_assessment` logging. §22.2.
- [ ] **REC-113** CV parser with passages; candidate confirmation on J4.
      §14.2.
- [ ] **REC-114** Evidence matrix; quote verification; score and band in the
      domain. §14.3.
- [ ] **REC-115** Matrix on R10 and R11; per-criterion disagreement. §14.4,
      §22.4.
- [ ] **REC-116** Rediscovery from consented pool members. §14.5.
- [ ] **REC-117** Ad writer, inclusive-language explanations, translation.
- [ ] **REC-118** Interview kit question suggestions.
- [ ] **REC-119** Debrief summary with citations.
- [ ] **REC-120** Email drafts.
- [ ] **REC-121** J8 job assistant with the AI disclosure. §10.6.
- [ ] **REC-122** R25 ask for a chart: plan, validation, chips. §23.4.
- [ ] **REC-123** Self-ID store and the fairness dashboard. §22.6, §24.4.
- [ ] **REC-124** NYC Local Law 144 gate and notice. §22.8.
- [ ] **REC-125** AI Act risk management file and technical documentation.
      §22.7.
- [ ] **REC-126** Instructions for use for the deployer. §22.7.
- [ ] **REC-127** Conformity assessment and EU database registration before
      2 December 2027 (business task; owner to name).
- [ ] **REC-128** Standalone suite with and without the AI keys.

## Phase 3 — integrations

- [ ] **REC-130** `JobBoard` port; Google for Jobs and the XML feed moved
      behind it. §26.1.
- [ ] **REC-131** Indeed: developer agreement signed (business), then Job
      Sync adapter.
- [ ] **REC-132** Indeed Apply inbound and disposition sync.
- [ ] **REC-133** Glassdoor through Indeed: confirm listings appear; document
      it on R7.
- [ ] **REC-134** LinkedIn: apply to the partner programme (business); the
      adapter only if accepted.
- [ ] **REC-135** Calendars and video: Google Workspace and Microsoft 365
      OAuth, free/busy, events, Meet and Teams links. §26.2.
- [ ] **REC-136** A company's own domain for its careers page, with the
      Vercel plan's domain ceiling recorded.
- [ ] **REC-137** Chat apps: digests, reminders, approvals. §26.3.
- [ ] **REC-138** Assessment and background-check ports with a fake adapter
      each. §15.3, §17.2.

## Phase 4 — with the suite

- [ ] **REC-140** Documents: optional `subjectRef` on an envelope and its
      events (a Documents change); the shell flow from an accepted offer to an
      envelope; Recruiting consumes `documents.envelope.completed`. §21.2.
- [ ] **REC-141** People consumes `recruiting.candidate.hired` (creates the
      `pre_hire`) and `recruiting.prehire.cancelled` (discards it): People's
      own consumer. §21.4.
- [ ] **REC-142** Pay band projection from `people.pay_band.set`. §18.2.
- [ ] **REC-143** Time Off's absences and holidays passed by the shell to
      scheduling and the start-date picker. §28.
- [ ] **REC-144** Assistant capabilities. §22.9.
- [ ] **REC-145** Phone: RM1–RM7, the rest in `desktop-only.json`. §29.3.

## Before any pack is enabled

- [ ] **REC-150** Country review: Spain, the UK, Germany, India and the US
      terms packs, the ad checks and the retention table, each signed off by
      a reviewer who knows that country's employment law.

---

## Phase 5 — Onboarding (`ONB-`)

- [x] **ONB-001** Manifest (`onboarding`, `dependsOn: []`), schema, role,
      outbox, boot, Dockerfile, codegen, standalone matrix.
- [x] **ONB-002** Contracts: events and the hire intake shape. §O2.
- [x] **ONB-003** Domain: template matching, due rules from the start date
      and probation end, plan states, a moved start date. §O3, §O4.
- [x] **ONB-004** Country tasks for the five launch countries. §O7.
- [x] **ONB-005** Probation review rules from `ResolvedTerms` and the pack.
      §O8.
- [x] **ONB-006** Storage and repositories. §O11.
- [x] **ONB-007** Hire intake from `recruiting.candidate.hired`,
      `people.person.hired` and the webhook.
- [x] **ONB-008** Application use cases; Inbox tasks per role.
- [x] **ONB-009** GraphQL and REST.
- [ ] **ONB-010** Web remote `apps/web/onboarding` (port 3006): O1–O4,
      O6–O9.
- [ ] **ONB-011** O5 welcome page on the Kithena Jobs host.
- [ ] **ONB-012** Inbox source.
- [ ] **ONB-013** Phone: MO1–MO3.
- [ ] **ONB-014** Onboarding analytics. §O9.
- [x] **ONB-015** Standalone acceptance with People and Recruiting absent.

## Progress notes
