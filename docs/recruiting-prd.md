# Product Requirements Document: The Recruiting module

Hiring from the first "we need someone" to a signed contract: requisitions,
job ads, a public job site with search, job boards, applications, a pipeline,
interviews and scorecards, offers built on each country's employment law, and
the contract signed in Kithena. Part II specifies the Onboarding module, which
takes the hire from there to the end of probation.

## How to read this

- **The build plan** is [`recruiting-build-plan.md`](./recruiting-build-plan.md)
  ([published](https://claude.ai/artifact/RPvxsmE6skmpEaiAn7nhKa)).
  It is the only record of progress for both modules (`REC-` and `ONB-`
  tickets).
- **Screens are not designed yet.** §29 lists every screen with an id (`R1`–,
  `RM1`– on the phone, `J1`– on the public site, `O1`– for Onboarding) so the
  Claude Design project `6fed6ac8…` can add the pages **Kithena Recruiting**,
  **Kithena Recruiting Mobile**, **Kithena Jobs** and **Kithena Onboarding**
  against the same ids.
- **Repo rules** are in [`CLAUDE.md`](../CLAUDE.md). This document does not
  restate them: no cross-module imports, Zod as the single schema source,
  `occurredAt` and `effectiveFrom` on every event, money in minor units,
  calendar dates as `date`, no `new Date()` in the domain, screens from Reach.
- **Legal content is unreviewed.** Every country rule in §19 and §O7 is the
  published rule as we understand it, marked **awaiting a country reviewer**,
  exactly as People's identifier rules are (People PRD Appendix A). A pack is
  not enabled for a tenant until a reviewer signs it off (REC-150).

The questions that were open when this was written are answered here, with the
reasoning in place so the answer can be argued with:

| Question                                                    | Answer                                                                                                                                                                                               | Where         |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| Is onboarding part of Recruiting?                           | No. It is its own module, `onboarding`, which `ModuleKey` already lists. Recruiting ends at a signed contract; Onboarding starts from a hire, whether it came from Recruiting, People or another ATS | §5.5, Part II |
| What is "provisionally hired"?                              | **Pre-hire**: the contract is signed, the start date is in the future, and pre-start conditions (right to work, background check) may still be open. It is People's `pre_hire`, the same word        | §21.3         |
| Does AI reject candidates?                                  | Never. AI reads, cites and ranks; the domain computes every score; a person decides every rejection                                                                                                  | §22.1         |
| May a model read a CV?                                      | Only with a new recorded decision, which this PRD proposes and which needs sign-off: Recruiting would become the second place, after Documents, where a model reads content                          | §22.2, §36    |
| Can we post to LinkedIn, Indeed and Glassdoor on day one?   | Google for Jobs and an open XML feed, yes. Indeed needs a signed partner agreement; Glassdoor jobs come through Indeed; LinkedIn is not taking new posting partners                                  | §26.1         |
| How are contract type, length, probation and notice chosen? | From a versioned **terms pack** per country. Each choice narrows the next. The domain computes every limit; the screen only offers what is lawful                                                    | §19           |
| Are contracts signed in Kithena?                            | Yes, through Documents, as a simple electronic signature. A German fixed-term clause needs written form, so that case is printed and signed by hand                                                  | §21.2         |
| What happens without People, Documents or Time Off?         | Recruiting still hires: its own member import, its own offer acceptance, and a `hired` webhook for whatever HRIS the company runs                                                                    | §5, §28       |
| What is the public website?                                 | **Kithena Jobs** (`apps/jobs`, `jobs.kithena.com`): a search across every company that opts in, and a careers page per company                                                                       | §10           |

---

## 1. Executive summary

Recruiting is the fifth sellable module (`ModuleKey` `recruiting`, entitlement
`module.recruiting`). It owns the hiring process: requisitions, jobs, job ads,
where they are published, applications, candidates, the talent pool, the
pipeline, questionnaires, interviews, scorecards, offers, employment terms,
the benefits a job offers, and recruiting analytics.

It boots alone (`requiresPeopleSource: 'either'`, `dependsOn: []`). Without
People it learns who works at the company from the same member import Time Off
and Documents use; with People it mirrors People's events. It never imports
another module. Where the process crosses into another module — the contract
signed in Documents, the new person created in People, an interviewer's day
off in Time Off, a task in the Inbox — the shell composes the two modules'
own operations, or the other module consumes Recruiting's events.

Three things set it apart from the tools it is measured against (JOIN,
Personio, Factorial, LinkedIn Recruiter and Greenhouse):

1. **Offers built on the law.** Contract type, duration, probation, notice,
   hours and working mode are chosen in one composer where each answer narrows
   the next, from a versioned pack per country (Spain, the UK, Germany, India,
   the US — the launch set People already uses). Nobody can send an offer a
   pack says is unlawful.
2. **AI that shows its work.** The model reads an application against the
   criteria the hiring team wrote, and returns a verdict per criterion with the
   passage that supports it. The domain turns verdicts into a score. A person
   decides. Every AI step degrades to a working screen without a key.
3. **One flow, start to finish, inside the HRIS.** A requisition becomes a job,
   a job becomes an ad on Kithena Jobs and the boards, an application becomes
   a hire, the offer becomes a contract signed in Documents, and the hire
   becomes a pre-hire in People and an onboarding plan — with each module still
   sellable alone.

## 2. Problem statement

### Current situation

A company hiring today runs a job board account, a spreadsheet of candidates,
a shared inbox, calendar invitations, interview notes in documents, an offer
letter in a word processor, an e-signature tool and then retypes everything
into the HRIS. Nobody can answer "how long does it take us to hire an
engineer?" or "which board brings people who pass probation?" without a week
of spreadsheet work. Offers are copied from the last offer, so a German
fixed-term contract goes out with an unlawful probation or a Spanish temporary
contract without its legal cause. AI screening tools score candidates without
saying why, which the EU AI Act classes as high-risk (Annex III, point 4).

### Proposed solution

One module, headless first, that holds the whole process and computes every
number from an append-only history: when a candidate moved, who moved them,
and why. A public job site for candidates. A terms composer that knows each
launch country's rules. AI that reads and cites, never decides.

### Business impact

- A buyer of Recruiting alone gets a complete ATS with a careers site, so the
  module sells without People.
- A buyer of the suite gets the hire written into People, the contract into
  Documents and the tasks into the Inbox with nothing retyped.

## 3. Success metrics

### Primary KPIs

| Metric                                | Target                                                        | Measured by                                            |
| ------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------ |
| Job created to published              | Under 10 minutes for a recruiter who has done it once         | `job.created` → `job.published`                        |
| Application completed on a phone      | ≥ 70% of applications started on a phone are sent             | Kithena Jobs telemetry by pointer type                 |
| Scorecards in on time                 | ≥ 85% within 24 hours of the interview                        | `interview.completed` → `scorecard.submitted`          |
| Offer sent with zero rule warnings    | 100% (a warning blocks the send)                              | Terms validation result on `offer.sent`                |
| Signed contract to pre-hire in People | Under one minute, no typing                                   | `documents.envelope.completed` → `people.person.hired` |
| AI suggestions overturned             | Reported, not targeted: a high rate says the criteria are bad | `ai_assessment` vs human decision                      |

### Validation

- `just standalone recruiting` is green with People, Documents and Time Off
  absent, and with the AI keys unset.
- The acceptance suite walks one candidate from requisition to pre-hire for
  each launch country.

## 4. Personas

- **Ada Lovelace**, HR and recruiter: opens requisitions, writes and
  publishes jobs, runs pipelines, sends offers, owns the terms packs and the
  benefits catalogue.
- **Marco Ruiz**, engineering manager and hiring manager: asks for headcount,
  approves the job, reviews candidates, interviews, decides.
- **Adam Novak**, engineer and interviewer: gets an interview kit, interviews,
  submits a scorecard, refers a friend.
- **Yuki Sato**, a candidate outside the company (already Documents' external
  signer): searches Kithena Jobs, applies on a phone, books an interview slot,
  accepts an offer and signs the contract.
- **Mei Tanaka**, a new starter (already Documents' persona): a pre-hire who
  finishes onboarding tasks before day one (Part II).
- **Lena Weber**, a recruitment agency: submits candidates to a job she was
  invited to, and sees only her own.
- **A works council** (Germany): sees each hire before it is made (§19.4,
  BetrVG § 99).
- **A third-party integrator**: builds a careers page on the public API, or
  pushes hires into another HRIS from the `hired` webhook.

---

## 5. Where the boundary sits

### 5.1 What Recruiting owns

Requisitions, jobs and their ads, publication targets and their state, the
apply form and questionnaires, candidates, applications and their stage
history, files candidates send (CVs, cover letters, portfolios, work samples),
the talent pool and its consent, interview plans, kits, interviews, scorecards,
references, offers and their versions, employment terms packs, the benefits
catalogue, email templates and each candidate's message thread, sources and
their cost, referrals, agencies, the public listing projection, AI assessments
and their audit trail, and recruiting analytics.

### 5.2 What it learns

- **Members** (who works here, team, manager, location, legal entity, account):
  from `people.person.*` events when People is present, from a member import
  when it is not. Time Off's member projection, copied, not shared.
- **Legal entities, org units, locations**: from People's events when present;
  otherwise Recruiting keeps its own short lists, edited in its settings.
- **HR**: whoever identity names administrator for `module.recruiting`.
- **Pay bands**: from `people.pay_band.set` when People is present (People PRD
  §16.2); otherwise from Recruiting's own optional bands.
- **Who is away**: never by calling Time Off. Scheduling screens get Time Off's
  answer from the shell (§28).
- **Signed contracts**: from `documents.envelope.completed`, matched on the
  envelope's `subjectRef` (§21.2; a new optional field on Documents' envelope).

### 5.3 What it tells others

Events on `kithena.recruiting.v1` (§27). Inbox items through the Inbox contract
(`packages/contracts/src/inbox`): approve a requisition, approve an offer,
submit a scorecard, review new applicants, an interview today, a candidate
replied. Assistant capabilities (`packages/contracts/src/assistant/recruiting.ts`,
§22.9). Webhooks for every published event.

### 5.4 What it does not own

- **The employee.** A hire becomes a person in People (People consumes
  `recruiting.candidate.hired`). Recruiting never writes People's tables.
- **Signatures.** Documents signs. Without Documents, Recruiting records an
  offer's acceptance itself and takes a signed contract as an upload (§21.2).
- **Onboarding.** Part II.
- **Payroll and benefits enrolment.** An offer says what is offered; enrolling
  in a pension or a health plan is a Compensation or Payroll concern.
- **Email delivery.** `platform/messaging` sends; Recruiting keeps the thread
  (§12.7).

### 5.5 Onboarding: why it is a separate module

The request asked whether onboarding belongs here. It does not, for four
reasons:

1. **It is already a module.** `ModuleKey` lists `onboarding` beside
   `recruiting`, and People's onboarding checklist state is written "from the
   Onboarding module or People's own minimal version" (People PRD §7).
2. **Each sells alone.** A company hiring through Greenhouse wants Kithena's
   onboarding without Kithena's ATS. A company running Workday wants Kithena's
   ATS and onboards in Workday. Folding them together would break both sales.
3. **Different people own each half.** Recruiting is the hiring team's.
   Onboarding is the new starter's, their manager's, IT's and HR's.
4. **The handover is one event.** `recruiting.candidate.hired` carries what
   Onboarding needs (start date, entity, manager, work mode, terms). Onboarding
   also accepts `people.person.hired` and an external webhook, so it never
   depends on Recruiting.

Recruiting keeps what belongs to the offer: conditions that must be met before
the start (right to work, background check, references) are open items on the
pre-hire in Recruiting until cleared (§21.3). Everything about getting the
person ready — accounts, equipment, forms, day one, probation — is Onboarding.

---

## 6. The whole flow, from zero to hire

```
 Recruiting                                              Other modules (by event or the shell)
 ──────────                                              ─────────────────────────────────────
 Requisition  draft → pending_approval → approved ─┐      Inbox: approvers get a task
                                                   ▼
 Job          draft → open ─────────────────────▶ published ──▶ Kithena Jobs, careers page,
              ▲          │                         │            Google for Jobs, XML feed,
              └ reopened ┴─ on_hold ─ closed ◀──── filled       Indeed (+Glassdoor), LinkedIn
                                                   │
 Application  applied → screening → interview → assessment → offer → hired
                  │          │           │            │          │      │
                  └──────────┴───────────┴────────────┴──────────┴──▶ rejected | withdrawn
                                                   │
 Offer        draft → pending_approval → approved → sent → accepted ─┐   Inbox: approvers
                                                     │   └▶ declined | expired | withdrawn
                                                     └ revised (new version, same offer)
                                                                     ▼
 Contract     generated → out_for_signature → signed ──────────────────▶ Documents signs (SES)
                                                     │
 Pre-hire     conditions open → conditions met → started | cancelled    People: pre_hire → active
                                                                         Onboarding: plan starts
                                                                         Time Off: entitlement
```

Every arrow is a typed event with `occurredAt` and `effectiveFrom`. A
correction (a candidate moved by mistake) is an event with `supersedes`, never
an update.

---

## 7. Requisitions

### 7.1 What a requisition is (R2)

A request for headcount: title, org unit, hiring manager, legal entity,
location(s), number of openings, target start date, reason (`new_role`,
`backfill`, `temporary_cover`, `growth`), the person replaced for a backfill,
a budget (salary range in the entity's currency, minor units), employment
terms in outline (§19), and a free-text justification.

States: `draft → pending_approval → approved | rejected | cancelled`, then
`filled` when every opening has a hire. Approved requisitions open one or more
jobs; one job may fill openings from several requisitions.

### 7.2 Approval chains (R3, S4)

Rules per tenant: ordered steps, each a person, a role (`hr`, `finance`), or
"the hiring manager's manager" (from the member projection's reporting line).
Conditions select the chain: budget above a threshold, a new role, a given
legal entity. Each approver gets an Inbox task. A change to budget or openings
after approval returns the requisition to `pending_approval` with a diff.

Companies that do not want requisitions switch them off; a job then opens
directly (S1).

---

## 8. Jobs and job ads

### 8.1 The job (R4)

Internal title, the advertised title, requisition(s), department, hiring team
(§25), pipeline template (§12.1), scorecard (§16.2), questionnaire (§15.1),
locations, work mode, employment terms outline, salary range and whether it is
shown, languages the ad is written in, internal-only or public, confidential
(the hiring company is not named, for a replacement nobody knows of yet),
target hire date, and openings.

States: `draft → open → on_hold → closed`, or `filled`. Published is not a
state of the job; it is the state of each publication target (§9).

### 8.2 The ad (R5)

The ad is rich text (`@tiptap`, the only rich text editor Reach has), in one or
more languages, each language a separate version with its own slug. Sections
are suggested, not enforced: about the company, the role, what you will do,
what you bring, nice to have, what we offer (filled from benefits, §20), salary,
process, and an equal-opportunity statement.

Before an ad can be published the domain runs the **ad checks** for each
location's country (§8.3). A failed check blocks publishing and says why, in
the editor, next to the paragraph.

### 8.3 Ad checks per country

| Check                       | Where                                               | Rule (domain, from the terms pack)                                                                                                                                                                                                                                                                                                 |
| --------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gender-neutral title        | DE                                                  | The title carries a neutral marker (`(m/w/d)`, `(all genders)`) or is neutral by itself. AGG § 11 forbids an ad that discriminates; a missing marker is the most common evidence in an AGG claim                                                                                                                                   |
| Pay range shown             | EU (Pay Transparency Directive 2023/970), US states | Where the directive is transposed, the range or starting pay is given in the ad or before the interview. US: a range is required in the ad in the states and cities listed in the pack (California, Colorado, Washington, New York, Illinois, Minnesota, Maryland, Massachusetts, New Jersey, Vermont, Hawaii, DC, NYC and others) |
| No pay history question     | EU, US states with a salary-history ban             | The questionnaire may not ask for current or past pay (Directive art. 5(2)); refused at save                                                                                                                                                                                                                                       |
| Protected characteristics   | Everywhere                                          | Age limits, "young team", "native speaker", marital status, photo requests: flagged by a word list per language (domain, deterministic); AI may add a sentence of explanation                                                                                                                                                      |
| Equal-opportunity statement | US                                                  | Offered; required for federal contractors (a tenant setting)                                                                                                                                                                                                                                                                       |
| Language                    | ES (co-official languages), DE                      | An ad in a language the location does not use warns, never blocks                                                                                                                                                                                                                                                                  |

### 8.4 The apply form (R6)

A form builder over typed fields: name, email, phone, location, CV (required by
default), cover letter, links (LinkedIn profile, portfolio, GitHub), right to
work in the location's country, notice period, earliest start, salary
expectation (blocked where §8.3 bans it, allowed as "expectation" elsewhere),
and any questionnaire (§15). Each field: required or not, shown or hidden.
The same Zod definition renders the form on Kithena Jobs, validates the public
API and types the stored answer.

What the form may never ask: date of birth, photo, marital status, religion,
health, pregnancy, nationality (right to work is asked instead), trade union
membership. Refused at save; this is a domain list, not a setting.

---

## 9. Publishing and distribution

### 9.1 Publication targets (R7)

A job is published to targets. Each target has its own state
(`pending → live → paused → expired | failed`), its own URL, its own source tag
for attribution, and its own error when a board refuses it.

| Target              | Phase | What it is                                                                                  |
| ------------------- | ----- | ------------------------------------------------------------------------------------------- |
| Careers page        | 1     | The company's page on Kithena Jobs (§10.3), and its embeddable widget                       |
| Kithena Jobs search | 1     | The cross-company search at `jobs.kithena.com`, opt-in per company and per job              |
| Google for Jobs     | 1     | `JobPosting` structured data on every public job page; Google crawls it. Free, no agreement |
| Open XML feed       | 1     | `/feeds/<company>.xml` for aggregators that read feeds                                      |
| Internal job board  | 1     | Visible to members only, in the tenant app, with referral and internal-application buttons  |
| Share links         | 1     | A tracked link per channel (LinkedIn post, email, QR code) so a source is attributed        |
| Indeed              | 3     | Job Sync API and Indeed Apply, after the partner agreement (§26.1)                          |
| Glassdoor           | 3     | Through Indeed: Glassdoor lists jobs it receives from Indeed (§26.1)                        |
| LinkedIn            | 3+    | Only with a LinkedIn partnership (§26.1); until then the tracked share link                 |
| Agencies            | 2     | An invitation to named agencies, who submit candidates through their own portal (§9.4)      |

Unpublishing a job takes it down everywhere at once and stops new applications;
applications in flight continue.

### 9.2 Source attribution

Every application carries a source: a target, a share link, a referral, an
agency, a sourced profile, or "added by a recruiter". It is fixed when the
application is created and cannot be edited, only corrected with a reason.
Analytics reads it (§23).

### 9.3 Referrals (R8, RM6)

Members refer a person to a job from the internal board or the phone: name,
email, a note, the CV if they have it. The candidate gets an email to complete
the application themselves (their consent, not the referrer's). The referrer
sees whether the referral was hired, never the stages or the reasons. A
referral bonus rule (amount, paid after the new hire passes probation) is
recorded per tenant; paying it is Payroll's.

### 9.4 Agencies (R9, J9)

An agency is invited to a job with fee terms (a percentage of first-year base
or a fixed fee, minor units) and a guarantee period. It submits candidates
through a portal on Kithena Jobs, signed in by an emailed code. **Ownership**:
the first submission of a candidate (matched by email) owns them for a
configurable period (default 6 months); a duplicate is refused with the date
of the earlier one. The agency sees its own candidates' stage, never another
agency's, never internal notes.

---

## 10. Kithena Jobs: the public website

### 10.1 What it is

A new app, `apps/jobs`, served at `jobs.kithena.com`. Two faces:

1. **Search** across every published job whose company opted in.
2. **A careers page per company** at `jobs.kithena.com/<company>`, in the
   company's own accent (the tenant's branding, `packages/contracts/src/branding.ts`,
   a closed list that keeps contrast at WCAG AA), with
   its jobs, its benefits, and its about text.

It is a Next.js app built from Reach, server-rendered for search engines, and
reads only the public projection (§31.2): no tenant schema, no personal data.
On Vercel's Hobby plan beside `apps/web` (hosting memory: Vercel Hobby
frontends). A company's own domain (`careers.acme.com`) is Phase 3; the Hobby
plan caps domains per project, so a ceiling is recorded in REC-136.

### 10.2 Search (J1, J2)

| Part       | Behaviour                                                                                                                                              |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Query      | Free text over title, company, skills and the ad body, in the ad's language, by Postgres full-text search (`tsvector` per language). No new dependency |
| Location   | Country, region, city, or "remote in <country>"; a remote job lists the countries it may be done from                                                  |
| Filters    | Work mode, contract type, hours (full/part), department category, seniority, salary from, posted within, language of the ad, company                   |
| Sort       | Relevance (`ts_rank`), newest, salary                                                                                                                  |
| URL        | Every filter, the query, the sort and the page in the query string (repo rule: filters in the URL); every result page is a bookmarkable URL            |
| Speed      | First page server-rendered; next pages client-side; no skeletons                                                                                       |
| Alerts     | "Email me jobs like this": the search saved against an email after a double opt-in; a weekly or daily digest; one-click unsubscribe                    |
| No account | Searching and applying need no account. A candidate account is optional (§10.5)                                                                        |

### 10.3 A job page (J3)

Title, company, location and work mode, contract type, hours, salary (when
shown), the ad in the chosen language, benefits, the hiring process in steps
(from the pipeline's candidate-facing stage names), the apply button, and
`JobPosting` JSON-LD with `datePosted`, `validThrough`, `employmentType`,
`jobLocation` or `applicantLocationRequirements` + `jobLocationType: TELECOMMUTE`,
`baseSalary`, `directApply: true`. A closed job answers 410 with similar
open jobs, so search engines drop it.

### 10.4 Apply (J4, J5)

On a phone first: one column, the CV upload first (it fills what it can, §14,
with the candidate confirming), then the fields, then the questionnaire, then
consent. The email address is confirmed by a six-digit code before the
application is sent (the pattern Documents uses for external signers,
copied), which also stops most spam. Rate limits per IP and email. A honeypot
field. Files: PDF, DOCX, ODT, RTF, images for portfolios; ≤ 10 MB each.

Consent is separate and explicit:

- Processing for this application (the legal basis, retention period and
  controller, shown before sending).
- Optional: keep me in the talent pool for other jobs, for N months (§13.2).
- US, where a job uses an automated tool in New York City: the notice NYC
  Local Law 144 requires, at least ten business days before use (§22.8).

A candidate may ask for a reasonable adjustment (step-free access, extra time,
a different format) on the form; it reaches the recruiter, never the scorecard.

### 10.5 The candidate's own page (J6, J7)

Reached by a magic link in every email, or an optional account (identity's
passkey or email code; no password). Shows each application: its stage under
the candidate-facing name, upcoming interviews with a reschedule link,
requested documents to upload, the offer to read, accept or decline, and the
contract to sign (Documents' public signing page). Withdraw an application.
Download my data. Delete my data (§24).

### 10.6 The job assistant (J8)

A chat on each job page and on search, answering from the job ad, the
company's published FAQ and the process steps — nothing else. It says it is an
AI (AI Act art. 50, in force since August 2026). It never assesses the
candidate, never asks for personal data, never promises an outcome, and hands
over to "ask the recruiter" (an email to the job's recruiter) when it cannot
answer from its sources. On search it turns a sentence ("remote backend jobs in
Spain paying over 50k") into the filters in §10.2, which the candidate sees and
can change: the model fills a filter object, the database searches.

### 10.7 Embedding and headless use

- A script tag renders a company's jobs inside its own site, styled by the
  company's branding tokens.
- The public API (§32) lists jobs and takes applications, so a company can
  build its own careers site and never use Kithena Jobs.

---

## 11. Applying, received

### 11.1 What arrives

An application is a candidate (§12.3) plus: the job, the source, the answers,
the files, the consent record, the time, the language, and the result of the
knockout rules (§15.2). Arriving from a board's apply (Indeed Apply), it is
mapped to the same shape at the adapter.

### 11.2 Duplicates

A candidate is matched by email first, then by phone, then by name with the
same CV hash. A match on email joins the application to the existing
candidate. Anything weaker is shown as "possibly the same person" with the two
side by side (Reach `MergeCompare`), and merging is always a person's decision,
as in People.

---

## 12. Candidates and the pipeline

### 12.1 Pipelines (S2)

A pipeline template is an ordered list of stages. Every stage has a
**category** that analytics reads — `applied`, `screening`, `interview`,
`assessment`, `offer`, `hired` — a name the hiring team sees, a name the
candidate sees (or hidden), and optional automations:

- send a template email on entry (with a delay, and never between 21:00 and
  08:00 in the candidate's time zone);
- request a scorecard from the interviewers;
- send a questionnaire or an assessment;
- offer self-scheduling for an interview (§16.4);
- move the candidate's thread to a recruiter.

A job copies its template; changes to the template do not touch open jobs.

### 12.2 The pipeline board (R10, RM2)

Kanban by stage (Reach `Kanban`, dnd-kit), with the counts, days in stage, the
AI match band (§14.4) when on, unread messages, and the next interview. Or a
table (Reach `Table`) with every column sortable and filterable, filters in the
URL. Bulk actions: move, reject with a reason and a template, email, add to a
pool, tag, assign a reviewer.

Moving a card asks only what the move needs: a reason for a rejection, the
interview type when entering an interview stage. A move into `offer` opens the
offer (§18). A move is reversible for 10 seconds (undo), and after that only
by a corrected move.

### 12.3 The candidate (R11, RM3)

One record per person across applications: name, contact, location, links,
the parsed profile (§14.2), files, tags, the talent pools they are in, their
consent and its expiry, and every application with its timeline.

The profile page is a list-detail (Reach `ListDetail`): the applications on
the left, and on the right tabs for profile, CV (rendered, with the evidence
from §14.3 highlighted), questionnaire answers, interviews and scorecards,
messages, activity, and offers. Who may see which tab is §25.

### 12.4 Rejection

A rejection needs a reason from the tenant's list (`not_qualified`,
`better_candidate`, `withdrew_interest`, `no_show`, `salary`, `location`,
`position_closed`, `knockout`, custom), a template (or none), and a send time
(now, or later today so it does not arrive within minutes of an interview).
Reasons are internal; the email never states a reason the candidate did not
see in writing elsewhere. A rejected candidate may be added to a pool in the
same step, with their consent asked by email when they have none.

### 12.5 Notes and mentions

Notes on a candidate or an application, private to the hiring team, with
`@mentions` that reach the person's Inbox. Notes are not shown to interviewers
before they submit their scorecard (§16.6).

### 12.6 Tags and custom fields

Tenant-defined tags and typed custom fields (the same typed-field kinds People
offers), each with a classification policy so the redaction paths and the DSAR
export include them (repo rule).

### 12.7 Messages (R12)

Two-way email per candidate: sent through `platform/messaging` (Resend) from a
per-tenant reply address; replies arrive through Resend's inbound webhook and
land on the thread. Templates with variables (candidate name, job, interviewer,
slot link), per language. Recruiting stores the thread — it is the feature —
and `messaging.delivery` keeps outcomes only, as it does today. No SMS (no
provider is paid for), no WhatsApp; the port leaves room for both.

---

## 13. Talent pool and CRM

### 13.1 Pools (R13)

Named lists of candidates (silver medallists, "frontend, Madrid", an event).
A candidate enters by a recruiter's action, by their own opt-in at apply time,
or by a sourcing import. Each pool member carries the reason and who added
them.

### 13.2 Consent and expiry

Nobody stays in a pool without a lawful basis. The default is consent, asked
by email, with a period from the country pack (default 12 months in the EU and
the UK). Thirty days before expiry the candidate is asked to renew; without an
answer they leave the pool and their data follows §24.2.

### 13.3 Nurture and rediscovery

- Send a campaign to a pool (a template, throttled, with unsubscribe).
- When a job opens, the pool members who match it are suggested (§14.5), never
  contacted automatically.
- Sourced profiles: a recruiter adds a person found elsewhere by hand, or by
  pasting a public profile URL; the person is told within one month (GDPR art. 14) by an automatic email with the opt-out link.

---

## 14. CV parsing and analysis

### 14.1 Without a model

Every CV's text is extracted by code (PDF text layer; DOCX and ODT as XML).
A scanned CV with no text layer is stored and marked "no text"; it is read by a
person. Search over CV text works without any AI key.

### 14.2 Parser

With the AI switched on (S7) and the proposed decision accepted (§22.2), a
model reads the extracted text and returns a typed profile (Zod schema, one
definition): contact details, work history (employer, title, from, to,
description), education, skills, languages with a level, certifications,
links. Every value carries the passage it came from. The domain validates:
dates in order, no future end dates, no overlapping impossibilities flagged
rather than fixed. The candidate confirms their own parsed profile when they
apply (§10.4), so the parser fills a form and a person checks it.

### 14.3 Analyser: the evidence matrix

The hiring team writes the job's **criteria** (R4): must-haves and
nice-to-haves, each a sentence ("five years building backend services in
production", "Spanish at C1"), each with a weight. The analyser reads one
application against each criterion and returns, per criterion:

- a verdict: `met`, `partly_met`, `not_met`, `not_evidenced`;
- the passages that support it (quoted, with their position in the CV);
- one sentence of explanation.

The domain checks that every quoted passage exists in the text; a verdict
whose evidence cannot be found becomes `not_evidenced`. The domain computes
the **match score** as the weighted sum of verdicts (met 1, partly 0.5, else 0) over the criteria, and the **band** (`strong`, `good`, `weak`) from fixed
thresholds. The model never emits a number.

### 14.4 Ranking and the "AI front desk"

The applications list can be ordered by match score. The board shows the band.
The recruiter sees the matrix beside the CV with the passages highlighted, and
agrees or disagrees per criterion; a disagreement is stored and feeds the
overturn rate (§3). There is no threshold that rejects; a "weak" band is a
label, not a stage.

### 14.5 Rediscovery

When a job opens, the analyser reads the job's criteria against pool members
whose consent covers it, and lists the strongest with their matrices.

### 14.6 What the analyser never sees

Before any text leaves Recruiting it is masked: name, photo, date of birth or
age, gender markers, nationality, address beyond the city, marital status,
religion, health, union membership, and the names of schools on a tenant
setting (to reduce prestige bias). The masking is code (patterns plus the
parsed contact block), runs before the gateway, and its result is stored with
the assessment so an audit can see exactly what the model read.

---

## 15. Screening

### 15.1 Questionnaires (S3)

Reusable sets of questions: short text, long text, single or multiple choice,
number, yes/no, date, file. A question may be **scored** (points per option)
or a **knockout** (§15.2). Questionnaires attach to the apply form or are sent
at a stage. In Germany, a questionnaire used across hires is a "Personalfragebogen"
and needs the works council's consent (BetrVG § 94); the tenant records that
consent against the questionnaire's version and a DE job cannot use an
unconsented one.

### 15.2 Knockouts

A knockout is a rule a person wrote ("right to work in Spain: no"). The domain
evaluates it. By default a knockout **flags** the application for review, it
does not reject. A tenant may switch on automatic rejection on knockout per
question; when it does, the candidate's email says a rule decided and offers
a human review (GDPR art. 22(3)), and the switch is unavailable for any
question that is not a legal requirement in a DE or ES job (works-council and
AEPD guidance on automated decisions).

### 15.3 Assessments

A take-home task (instructions, files, a deadline, submission by upload or
link) is built in. Third-party assessment providers come through a port
(`AssessmentProvider`) with no provider implemented in Phase 1: the result is
a score and a report URL on the application.

---

## 16. Interviews

### 16.1 Interview plan (R14)

Per job: the interviews in order (phone screen, technical, culture, panel,
final), each with its duration, the interviewers or an interviewer pool, the
competencies it covers, and the scorecard it uses.

### 16.2 Scorecards (S5)

A scorecard is a list of competencies (each with a description and the
questions that probe it) rated on a fixed scale with labelled anchors
(1 strong no – 4 strong yes, no midpoint), plus an overall recommendation and
notes. Competencies come from a library the tenant keeps. Ratings are stored
as integers; every average is computed by the domain.

### 16.3 Interview kits (R15, RM4)

What an interviewer opens: the candidate's CV, the parts of the profile they
may see, the competencies they own, the questions, the time, the place or the
video link, and the scorecard to fill as they go. Works on the phone.

### 16.4 Scheduling (R16, J6)

- **Manual**: pick slots from the interviewers' free/busy (calendar
  integration, §26.2); without a calendar, the interviewers' working hours in
  Recruiting.
- **Self-scheduling**: the candidate gets a link with slots that fit every
  interviewer, in the candidate's time zone, and picks one; reschedule and
  cancel from the same link.
- **Panels**: back-to-back interviews in one booking.
- **Away**: the shell passes Time Off's absences for the interviewers so a
  slot on a day off is not offered (§28).
- Each booking writes calendar events for interviewers and an invitation to
  the candidate with the video link (Meet or Teams through the calendar
  integration) or the address.
- Reminders: candidate 24 h before; interviewers 1 h before with the kit link.

### 16.5 Interview state

`scheduled → completed | no_show | cancelled | rescheduled`. A completed
interview opens a scorecard task for each interviewer in the Inbox, due 24
hours later.

### 16.6 Independent feedback

An interviewer sees the other scorecards only after submitting their own,
which keeps the first opinion from anchoring the rest. The hiring manager and
recruiter see all of them as they arrive.

### 16.7 Debrief and decision (R17)

A debrief view per candidate: every scorecard side by side, the average per
competency (domain), where interviewers disagree by two points or more
(domain), and an AI summary that cites the scorecards it summarises (§22.4).
The decision (advance, reject, offer) is the hiring manager's, recorded with a
reason.

---

## 17. References and background checks

### 17.1 References (R18)

The candidate names referees in their portal. Each referee gets a form by
email (questions per tenant), completes it without an account, and the answers
land on the application. A reference is requested only after the candidate
names the referee: never contacted behind their back.

### 17.2 Background checks

Through a port (`BackgroundCheckProvider`), no provider implemented until one
is chosen and paid for. The country pack says when a check may be started:
in the US, after a conditional offer where a fair-chance law applies
(California, New York City and others in the pack), with the FCRA standalone
disclosure and authorisation; in the EU, only what is necessary for the role
and lawful in that country (criminal records only where a law allows it).
A check is a pre-start condition (§21.3).

---

## 18. Offers

### 18.1 The offer (R19)

An offer is versioned. Each version holds:

- the employment terms (§19), fully resolved;
- compensation: base pay (money, minor units, the entity's currency), pay
  frequency, number of payments (ES: 12 or 14), variable pay, sign-on bonus,
  equity (a description and a number of units; never priced by Kithena),
  relocation;
- benefits from the catalogue (§20), with the statutory ones included and
  locked;
- start date (a `date`; the shell shows public holidays from Time Off when it
  is present);
- the offer's expiry date;
- the offer letter, from a template per entity and language, merged with the
  above.

### 18.2 Checks before anyone sees it

- **Terms**: the pack validates every term (§19.3). An error blocks; there is
  no override.
- **Pay band**: the base pay against the band for the grade (People's bands or
  Recruiting's). Outside the band is allowed with a reason and sends the offer
  to the approval chain's "outside band" step.
- **Pay equity**: where the Pay Transparency Directive applies, the domain
  compares the offer with the range advertised; an offer below the advertised
  range is an error.
- **Budget**: against the requisition's budget.

### 18.3 Approval (R20)

Approval chains like requisitions (§7.2), selected by conditions (outside
band, above budget, an executive grade). Approvers see the offer and the
checks' results, not the candidate's private data beyond name and job.

### 18.4 Sending and accepting (J7)

The candidate gets the offer in their portal: the letter, the terms in plain
words, the benefits, the expiry. They accept, decline with an optional reason,
or ask a question (to the recruiter). A counter-offer is a new version made
by the recruiter; the earlier version is kept and marked superseded.
Acceptance records the time, IP and the version's hash.

An offer is not a contract. In most launch countries the contract follows
(§21); in the US, an accepted offer letter is often the only document, and the
pack says so (§19.8).

---

## 19. Employment terms by country

### 19.1 Terms packs

A **terms pack** is versioned, effective-dated domain data plus pure functions,
one per country, in `services/recruiting/src/domain/terms/<cc>/`. It answers,
for a date and the answers given so far:

- which choices are offered next and which are not (with the reason);
- the limits on each number (probation, duration, hours, notice);
- the defaults;
- the mandatory clauses and documents;
- the pre-start conditions;
- the warnings a person should read.

The pack is code, not configuration, because the rules are logic ("probation
at most half of a fixed term of under 12 months"). A tenant cannot loosen a
pack. It may set its own stricter defaults (a 3-month probation where 6 is
lawful) and record its collective agreement's values where the agreement
overrides the statute, within what the statute allows.

Launch set: **Spain, the United Kingdom, Germany, India, the United States** —
the set People's country packs already use. Every pack is **awaiting a
country reviewer** (REC-150).

### 19.2 The terms composer (R21)

One modal, a list of steps, each step's options computed from the answers
above it. Changing an earlier answer re-runs the later steps and marks any that
became invalid. A side panel lists every rule that applied, in words, with its
source (statute and section).

| #   | Step                 | Options depend on                              | What the pack decides                                                                                                     |
| --- | -------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 1   | Legal entity         | The tenant's entities                          | The country, hence the pack; the currency                                                                                 |
| 2   | Work location        | Entity's country                               | Region where it matters: US state, Indian state, German Land, Spanish autonomous community                                |
| 3   | Relationship         | Country                                        | Employee; worker (GB); contractor (warns about misclassification tests per country)                                       |
| 4   | Contract type        | Country, relationship                          | The lawful types (§19.4–§19.8)                                                                                            |
| 5   | Fixed-term reason    | Type is fixed-term, country                    | ES: a legal cause is required; DE: with or without objective reason (Sachgrund); others: free text                        |
| 6   | Duration             | Type, reason, country, the candidate's history | Minimum and maximum length; an end date or an event that ends it                                                          |
| 7   | Hours                | Country, type                                  | Full or part time, weekly hours within the legal maximum; FTE computed against the entity's full-time hours               |
| 8   | Probation            | Country, type, duration, role group, agreement | Allowed or not, default and maximum                                                                                       |
| 9   | Notice               | Country, type, probation                       | Statutory minimums for each side; contractual may be longer, never shorter                                                |
| 10  | Work mode            | Country                                        | Onsite, hybrid (days per week), remote; remote from another country warns (tax, social security, permanent establishment) |
| 11  | Collective agreement | Country (ES required; DE where bound)          | The agreement and its professional group, which sets minimum pay                                                          |
| 12  | Pay                  | Country, type, hours, agreement, US state      | Minimum wage check, number of payments (ES), US exempt status against the salary threshold, India's CTC breakdown         |
| 13  | Benefits             | Entity, type, hours                            | The catalogue items the person is eligible for (§20)                                                                      |
| 14  | Clauses              | Country, US state, pay                         | Non-compete allowed or not and its conditions; confidentiality; IP; mobility                                              |
| 15  | Summary              | Everything                                     | Errors (block), warnings (read and confirm), the documents that must accompany the contract                               |

The result is a `ResolvedTerms` value (Zod, in `packages/contracts`), which
maps one to one onto People's employment terms fields (`employment_type`,
`contract_start`, `contract_end`, `probation_end`, `working_pattern`, `fte`,
`notice_period_employee`, `notice_period_employer`, `collective_agreement`,
`work_model`, `remote_country`, `employment_jurisdiction`,
`non_compete_months`, `mobility_clause`; People PRD Appendix A). Where People
has a fixed list (`employment_type`: permanent, fixed-term, intern,
apprentice, contractor) the pack's richer type keeps the country's own name
and carries the People type it maps to.

The same composer is used, in outline, on a requisition and a job (§7.1,
§8.1), so a job's ad already shows the contract type and hours it will offer.

### 19.3 Validation

`validateTerms(pack, terms, on: date) → Result<ResolvedTerms, TermsIssue[]>`
is pure and runs in three places: the composer on every change, the offer
before approval and send, and the contract before it is generated. Each issue
carries a code, the step, the rule's source and a sentence. Tested per pack
with a table of lawful and unlawful cases (TDD: domain tests first, repo
rule).

### 19.4 Germany (DE) — awaiting a country reviewer

| Term                                | Rule                                                                                                                                                                                                                                                                                                          |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Types                               | Unbefristet (permanent); befristet mit Sachgrund (§ 14(1) TzBfG); befristet ohne Sachgrund (§ 14(2)); Minijob (geringfügige Beschäftigung); Werkstudent; Praktikum (mandatory or voluntary); Ausbildung (BBiG); freelance (Freier Mitarbeiter, with a Scheinselbstständigkeit warning)                        |
| Fixed term without objective reason | At most 2 years with at most 3 extensions; up to 4 years in the first 4 years of a new company (§ 14(2a)); up to 5 years from age 52 under § 14(3) conditions. Not allowed if the person was employed by the same employer before (§ 14(2) sentence 2): the composer asks, and refuses when the answer is yes |
| Written form                        | A fixed-term clause needs written form (§ 14(4) TzBfG): wet ink, or a qualified electronic signature. **Documents' simple electronic signature does not satisfy it** (§21.2)                                                                                                                                  |
| Probation                           | At most 6 months (§ 622(3) BGB), with 2 weeks' notice during it. In a fixed-term contract the probation must be proportionate to the term (§ 15(3) TzBfG): the pack warns above half the term. Ausbildung: 1 to 4 months, mandatory (§ 20 BBiG)                                                               |
| Notice                              | 4 weeks to the 15th or the end of a month; the employer's period grows with tenure (§ 622(2) BGB). A contract may not give the employee a longer period than the employer                                                                                                                                     |
| Hours                               | 8 hours a day, up to 10 if averaged to 8 over 6 months (§ 3 ArbZG); Minijob earnings below the limit for the year (the pack holds the limit by year, tied to the minimum wage); Werkstudent at most 20 hours a week in term time                                                                              |
| Minimum wage                        | By year, from the pack (the Mindestlohn); Pflichtpraktikum exempt; voluntary internship over 3 months is not                                                                                                                                                                                                  |
| Holiday                             | At least 20 days on a 5-day week (BUrlG § 3, 24 Werktage)                                                                                                                                                                                                                                                     |
| Terms document                      | The Nachweisgesetz's list of essential terms must be given; since 2025 text form is allowed with the employee's receipt, except in the sectors § 2a SchwarzArbG lists                                                                                                                                         |
| Works council                       | Where the entity has a works council, every hire needs its information and consent (§ 99 BetrVG): a stage the pipeline adds automatically for DE jobs (§19.9)                                                                                                                                                 |
| Non-compete                         | Allowed only with compensation of at least half the last pay for its duration, at most 2 years (§§ 74 ff. HGB)                                                                                                                                                                                                |
| Work mode                           | Remote is either mobile work or Telearbeit (Arbeitsstättenverordnung applies to the latter); the composer asks which                                                                                                                                                                                          |

### 19.5 Spain (ES) — awaiting a country reviewer

| Term        | Rule                                                                                                                                                                                                                                                                                                                                    |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Types       | Indefinido (permanent, the default since the 2021 reform, RDL 32/2021); fijo-discontinuo; temporal por circunstancias de la producción; temporal por sustitución; formativo en alternancia; formativo para la obtención de la práctica profesional; full or part time on any of them                                                    |
| Fixed term  | Only with a legal cause, which the contract must state precisely. Circumstances of production: at most 6 months, up to 12 by sector agreement; or occasional foreseeable peaks for at most 90 days a year. Substitution: while the replaced person's job is reserved. Práctica: 6 months to 1 year, within 3 years of the qualification |
| Probation   | Agreed in writing. At most 6 months for qualified technicians, 2 months for others (3 in companies under 25 employees), unless the collective agreement says otherwise; at most 1 month in a temporary contract of up to 6 months (art. 14 ET). None if the person did the same job for the company before                              |
| Notice      | Employer: 15 days for an objective dismissal and to end a temporary contract over a year. Employee: from the agreement or custom; the pack defaults to 15 days                                                                                                                                                                          |
| Hours       | At most 40 a week averaged over the year and 9 ordinary hours a day unless the agreement says otherwise; daily time recording is mandatory (Time Off's attendance)                                                                                                                                                                      |
| Pay         | The collective agreement's table for the professional group is the floor; the SMI (statutory minimum) by year; 14 payments by default (two extra payments), or 12 with them prorated                                                                                                                                                    |
| Holiday     | 30 calendar days                                                                                                                                                                                                                                                                                                                        |
| Remote      | Remote when at least 30% of time over 3 months (Ley 10/2021): a written remote work agreement with its mandatory content is required, and costs are compensated; the composer adds the agreement to the contract documents                                                                                                              |
| Formalities | The contract is communicated to the public employment service (Contrat@) within 10 days, and the person registered with Social Security before they start: Onboarding tasks (§O7)                                                                                                                                                       |
| Agreement   | Required: the convenio colectivo and the professional group                                                                                                                                                                                                                                                                             |

### 19.6 United Kingdom (GB) — awaiting a country reviewer

| Term          | Rule                                                                                                                                                                                                   |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Relationship  | Employee, worker, or self-employed; the composer explains the difference and warns that the label does not decide status                                                                               |
| Types         | Permanent; fixed-term; zero-hours or casual (worker; exclusivity clauses are unenforceable); apprenticeship (minimum duration from the pack)                                                           |
| Fixed term    | No maximum length; four years of successive fixed terms make the contract permanent unless justified (Fixed-term Employees Regulations 2002, reg. 8)                                                   |
| Probation     | Not statutory; the pack defaults to 3 months and warns above 6. The Employment Rights Act 2025 changes unfair-dismissal qualifying service; the pack carries the dates once the reviewer confirms them |
| Notice        | Statutory minimum from the employer: 1 week after a month's service, then 1 week per complete year up to 12; from the employee: 1 week (ERA 1996 s. 86)                                                |
| Hours         | 48 a week averaged over 17 weeks unless the worker opts out in writing (Working Time Regulations 1998)                                                                                                 |
| Holiday       | 5.6 weeks (28 days on a 5-day week, bank holidays may be included)                                                                                                                                     |
| Terms         | A written statement of particulars on or before day one (ERA 1996 s. 1), with its mandatory items, generated from the terms                                                                            |
| Conditions    | Right-to-work check before the start (Immigration, Asylum and Nationality Act 2006): a pre-start condition that blocks the start                                                                       |
| Pay           | National Minimum / Living Wage by age band and year, from the pack                                                                                                                                     |
| Pension       | Automatic enrolment duties (Pensions Act 2008): a statutory benefit, locked in the offer                                                                                                               |
| Flexible work | Requests are a day-one right; the work mode is a term, not a promise of future flexibility                                                                                                             |

### 19.7 India (IN) — awaiting a country reviewer

| Term         | Rule                                                                                                                                                                                                                                                                                       |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Region       | The state is required: the Shops and Establishments Act of the state sets hours, holidays and leave                                                                                                                                                                                        |
| Types        | Permanent; fixed-term employment (same hours, wages and benefits as permanent staff, and gratuity pro rata after one year under the labour codes); probationary; trainee or apprentice (Apprentices Act 1961); consultant or retainer (with a misclassification warning)                   |
| Labour codes | The four labour codes (wages, industrial relations, social security, occupational safety) replace the earlier acts; the pack records the date they apply from and the state rules made under them, once the reviewer confirms both                                                         |
| Probation    | Not statutory; from the standing orders where they apply, otherwise the contract; the pack defaults to 6 months and allows one extension                                                                                                                                                   |
| Notice       | From the contract and standing orders; the pack defaults to 30 days for the employee and the employer                                                                                                                                                                                      |
| Hours        | 8 a day and 48 a week; overtime at twice the ordinary rate                                                                                                                                                                                                                                 |
| Pay          | Offered as cost to company (CTC) with its components (basic, house rent allowance, special allowance, employer provident fund, gratuity). The domain checks that "wages" as the Code on Wages defines them are at least half of total remuneration, and that the state minimum wage is met |
| Statutory    | Provident fund (EPF) and, below the wage ceiling, state insurance (ESI); gratuity; maternity benefit: statutory benefits, locked                                                                                                                                                           |
| Terms        | An appointment letter to every employee (Occupational Safety, Health and Working Conditions Code)                                                                                                                                                                                          |
| Non-compete  | A restraint after employment ends is void (Indian Contract Act s. 27): the clause is not offered                                                                                                                                                                                           |

### 19.8 United States (US) — awaiting a country reviewer

| Term          | Rule                                                                                                                                                                                          |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Region        | The state (and city where a city law applies) is required                                                                                                                                     |
| Relationship  | W-2 employee or 1099 contractor; the composer warns where the state uses an ABC test (California and others in the pack)                                                                      |
| Types         | At-will full time, part time, temporary or seasonal, intern; an employment contract for a fixed term is offered but warns that it ends at-will status                                         |
| At-will       | The default everywhere except Montana, where after a probationary period a dismissal needs good cause (Wrongful Discharge from Employment Act); the pack holds Montana's probation rule       |
| Probation     | Not statutory outside Montana; the pack offers an "introductory period" with a warning that it does not change at-will status                                                                 |
| Exempt status | Exempt or non-exempt under the FLSA; exempt requires the duties test and a salary at or above the federal threshold and the state's, from the pack                                            |
| Pay           | Federal, state and city minimum wage by date, from the pack; pay range in the ad where a pay transparency law applies (§8.3)                                                                  |
| Document      | The accepted offer letter is often the only document; the pack marks the contract step optional                                                                                               |
| Conditions    | Form I-9: section 1 by the first day, section 2 within three business days (Onboarding, §O7); E-Verify where the state requires it; background checks under FCRA and fair-chance laws (§17.2) |
| Non-compete   | Not offered in states that void it (California, Minnesota, North Dakota, Oklahoma); offered with the state's pay threshold and notice rules elsewhere, from the pack                          |
| Benefits      | No statutory paid holiday federally; state paid sick leave where a state requires it (statutory, locked); health coverage duties for large employers (ACA) noted, not computed                |

### 19.9 The works council stage (DE)

For a job at a German entity with a works council (an entity setting), the
pipeline gains a stage before `offer`: the hire is presented to the works
council with what § 99 BetrVG requires (the candidate, the job, the grouping,
the effect on others). The works council's members get a read-only view of
that one candidate for that one job through a role (§25). Consent, refusal
with reasons, or no answer within a week (deemed consent) is recorded. An
offer cannot be sent before consent or deemed consent.

---

## 20. Benefits

### 20.1 The catalogue (S6)

Per legal entity, a list of benefits the company offers. Each benefit:

- a category: health, pension or retirement, meal, transport, childcare,
  learning, equipment, wellbeing, mobility (company car, bike leasing),
  equity, bonus, extra holiday, insurance (life, disability), flexible pay
  (ES retribución flexible), relocation, other;
- a name and a description per language;
- a value (money in minor units, a percentage, days, or descriptive);
- eligibility: contract types, minimum hours, a waiting period (after
  probation, after N months), work mode, location;
- whether it is **statutory** (shipped by the pack: UK pension
  auto-enrolment, India's provident fund and gratuity, US state paid sick
  leave; cannot be removed from an offer) or **company**;
- a tax note per country (descriptive, from the pack where it is standard:
  Spain's exempt meal allowance limit, Germany's Sachbezug limit), never a
  calculation of anyone's tax.

### 20.2 Where benefits appear

- On the ad's "what we offer" section and the company's careers page.
- In the terms composer's step 13, filtered by eligibility.
- In the offer, as a list the candidate reads, with what applies to them.
- In `recruiting.candidate.hired`, so a Compensation or Benefits module
  (`compensation` in `ModuleKey`) can enrol the person. Recruiting enrols no
  one.

### 20.3 Total rewards on the offer

The offer shows a total rewards summary: base, variable at target, the money
value of benefits that have one, and the descriptive ones listed. The domain
adds the numbers (decimal.js); equity is shown as units, never priced.

---

## 21. Contract, signature and the hire

### 21.1 Generating the contract (R22)

When an offer is accepted, the contract is generated from a template per
entity, language and contract type, merged with the resolved terms, the pay,
the benefits and the pack's mandatory clauses, plus the documents the pack
requires (ES remote work agreement; GB written statement; DE Nachweis; IN
appointment letter). The terms are validated again on the start date (§19.3);
a pack version that changed in between shows the difference.

### 21.2 Signing

**With Documents** (the shell composes, §28): Documents files the contract as
a document about the candidate, creates an envelope (the candidate first, then
the company's signatory), and sends it. The envelope carries a new optional
`subjectRef` (`recruiting:offer:<id>:<version>`) so Recruiting can match the
`documents.envelope.completed` event without asking Documents anything. The
candidate signs on Documents' public signing page with the emailed code.

**Germany, fixed term:** a simple electronic signature does not meet § 14(4)
TzBfG's written form. The pack marks the contract `wet_ink`: the contract is
printed, signed by hand by both before the start, and the scan uploaded and
recorded as signed with the date of the second signature. (A qualified
electronic signature provider would remove this step; out of scope, §35.)

**Without Documents:** Recruiting records the offer's acceptance itself
(§18.4) and accepts the signed contract as an upload, marked signed by a
person with the date.

### 21.3 Pre-hire and its conditions

When the contract is signed, the application moves to `hired` and the
candidate becomes a **pre-hire**: hired, with a start date in the future. This
is what the request called "provisionally hired"; it uses People's word
(`pre_hire`), because "provisional" already means something else in People (a
record nobody has confirmed as an employee).

A pre-hire may carry **conditions**, from the pack and the offer:
right-to-work check (GB, US), background check, references, a qualification
certificate, a work permit. Each condition is `open → met | waived | failed`,
with who decided and when. A failed condition can withdraw the offer (with the
pack's notice rules); an open condition on the start date blocks the start and
tells HR.

`recruiting.candidate.hired` is published when the contract is signed (with
the conditions' states); `recruiting.prehire.conditions_met` when all are met;
`recruiting.prehire.cancelled` if the hire falls through before the start
(reneged, no-show, failed condition), with a reason.

### 21.4 What other modules do with a hire

- **People** consumes `recruiting.candidate.hired` and creates the person in
  `pre_hire` with the employment terms, pay, manager, org unit, location and
  start date — People's own write, People's own rules. It consumes
  `recruiting.prehire.cancelled` and discards the record.
- **Onboarding** starts a plan (Part II).
- **Documents** files the signed contract to the person once they are a
  member.
- **Time Off** gives the entitlement from People's hire, as it does today.
- **Without People**: the `hired` webhook carries the same payload for any
  HRIS, and the REST API serves it.

### 21.5 Closing the loop

When every opening of a job is hired, the job becomes `filled`, every target is
unpublished, and the remaining candidates are offered a bulk rejection with a
template (never sent automatically).

---

## 22. AI

### 22.1 The rule

**The domain computes every number. A model reads, cites, ranks the options
the domain generated, and writes text. A person decides every outcome that
affects a candidate.** No model output moves a candidate, rejects anyone,
sets pay or sends an email without a person pressing a button.

### 22.2 The proposed decision: a model may read an application

Everywhere except Documents, a model sees field names and never a value
(`docs/tech-stack.md`, "A model may read a document"). CV parsing, the
evidence matrix and rediscovery are reading by definition, so this PRD
**proposes** a second exception, with limits enforced in Recruiting and not by
convention:

1. A model reads an application only for a member of that job's hiring team,
   for that request; what is kept is the result and the masked text it read.
2. Protected characteristics are masked by code before the text leaves
   (§14.6).
3. Special-category data is never sent (health, religion, union membership,
   ethnicity, sexual orientation, criminal records); diversity self-ID is in a
   separate store no AI path can read (§24.4).
4. A tenant can switch every AI feature off, per feature (S7).
5. Applications are never used to train a model; processing stays in the EU
   where the provider offers it; every prompt leaves through the AI gateway
   (`packages/telemetry/src/ai-gateway.ts`).
6. The domain computes every score (§14.3).
7. Every assessment is logged with the model, the prompt version, the masked
   input's hash, the output and the human decision that followed (AI Act art.
   12, record-keeping).

**Accepted on 2026-10-15** (§36, open for review). Recorded in
`docs/tech-stack.md`.

### 22.3 Features

| Feature                    | Screen    | The domain does                                                           | The model does                                                                                                           |
| -------------------------- | --------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Write a job ad             | R5        | Runs the ad checks (§8.3); fills benefits and terms from data             | Drafts sections from the intake; rewrites a paragraph on request                                                         |
| Inclusive-language hints   | R5        | Flags from a word list per language                                       | Explains a flagged phrase and offers a neutral one                                                                       |
| Translate an ad            | R5        | Keeps the structured parts (salary, terms) from data                      | Translates the prose; a person approves each language                                                                    |
| Parse a CV                 | R11, J4   | Extracts text; validates dates; the candidate confirms                    | Returns the typed profile with passages                                                                                  |
| Evidence matrix            | R11, R10  | Checks every quote exists; computes score and band                        | Returns a verdict and passages per criterion                                                                             |
| Rediscover from pools      | R13       | Selects only consented members; computes scores                           | Same as the matrix                                                                                                       |
| Interview kit              | R14       | Keeps competencies and scale from the scorecard                           | Suggests questions per competency                                                                                        |
| Debrief summary            | R17       | Computes averages and disagreements                                       | Summarises the scorecards, citing each; reads the tone and suggests proceed, reject or more evidence (owner, 2026-10-21) |
| Draft an email             | R12       | Fills variables from data                                                 | Drafts the text from a template's intent                                                                                 |
| Job assistant (candidates) | J8        | Restricts sources to the job, FAQ and process; turns filters into a query | Answers from the sources; fills search filters                                                                           |
| Ask for a chart            | R25       | Validates the plan; computes; renders with Reach charts                   | Picks metric, breakdown, filters, period and chart kind by name (§23.4)                                                  |
| Recruiting assistant       | Slack, R1 | Runs each capability as the asker (Assistant PRD)                         | Plans which capabilities to call (§22.9)                                                                                 |

Every feature degrades to a working screen without the key. CI runs the
standalone suite with and without it.

### 22.4 Explanations a person can check

Every AI output on screen shows what it read (the passage or the scorecard),
the model and the date, and a "was this right?" control. A recruiter's
disagreement is stored with the assessment.

### 22.5 Human oversight

The evidence matrix never hides a candidate, never sorts the list by default
(the default is newest first; sorting by score is a choice), and shows its
band beside the human's stage, never instead of it. The AI Act's human
oversight duty (art. 14) is met by design: the person decides, sees why, and
can override per criterion.

The debrief summary's suggestion (the owner's decision, 2026-10-21) is the
same kind of thing: a label with a one-sentence why drawn from the
scorecards, shown beside the averages, kept as an assessment, and never acted
on by itself. The job's recruiter or hiring manager records the decision with
a reason. Before launch it falls under the conformity work parked as REC-127.

### 22.6 Fairness checks

Monthly, per job family with enough volume, the domain computes stage pass
rates by voluntary self-ID group (US EEO categories where collected; gender
where a tenant collects it lawfully), with the four-fifths rule's adverse
impact ratio. Only aggregates with at least five people per cell are shown
(People's cohort minimum). Separately for AI-assisted and non-assisted
decisions, so a tenant can see whether the matrix changes outcomes.

### 22.7 The EU AI Act

AI used to filter applications and evaluate candidates is high-risk (Annex III,
point 4(a)). After the Digital Omnibus (Regulation (EU) 2026/1744), the
high-risk obligations for Annex III systems apply from **2 December 2027**;
transparency (art. 50) and AI literacy (art. 4) already apply. Kithena is the
provider; the tenant is the deployer. Phase 2 ships with what a provider needs
and the deployer must be told:

- a risk management file and technical documentation (REC-125);
- logging (§22.2 point 7);
- instructions for use for the deployer: what the matrix is for, its limits,
  how to oversee it (REC-126);
- data governance for the prompts' test sets;
- a conformity assessment and EU database registration before 2 December 2027
  (REC-127, a business task, owner to name).

### 22.8 NYC Local Law 144

A job located in New York City that uses the evidence matrix uses an automated
employment decision tool: it needs a bias audit by an independent auditor
within the last year, the audit's summary published, and the notice to
candidates at least ten business days before use. The tenant's NYC jobs keep
the matrix off until the audit date is recorded (S7), and the apply form adds
the notice (§10.4).

### 22.9 Assistant capabilities

`packages/contracts/src/assistant/recruiting.ts`, served by Recruiting as the
asker (Assistant PRD §8): open jobs with counts per stage, time to hire,
interviews today or this week for me, scorecards I owe, offers awaiting my
approval, pipeline for a job. Candidate names are `personal`; nothing about a
candidate is visible beyond what the asker may see in Recruiting.

---

## 23. Analytics

### 23.1 Principles

- Every number is computed by the domain from the append-only stage history,
  interviews, offers and sources, with `effectiveFrom` deciding the period.
- Charts are Reach's own (`FunnelChart`, `TrendChart`, `StackedBarChart`,
  `HorizontalBarChart`, `HeatmapChart`, `CohortChart`, `BulletChart`,
  `ComboChart`, `DonutChart`, `Sparkline`, inside `ChartCard`), each with its
  data table for screen readers. No charting library.
- Every filter in the URL; every view bookmarkable.
- Aggregates over people respect the five-person cohort minimum.

### 23.2 Dashboards (R23, R24, RM7)

| Dashboard       | Who                   | Charts                                                                                                                                |
| --------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Overview        | HR                    | Open jobs, applications this period, hires, offers out (stats with sparklines); hires by month (trend); pipeline by stage (funnel)    |
| Funnel          | HR, hiring managers   | Conversion per stage (funnel); time in stage (heatmap stage × week); drop-off reasons (stacked bar)                                   |
| Speed           | HR                    | Time to fill and time to hire, median and 85th percentile, by department (bullet against target); trend by month                      |
| Sources         | HR                    | Applications, interviews, hires and probation passes by source (stacked bar); cost per hire per source (combo: bars cost, line hires) |
| Offers          | HR, finance           | Acceptance rate (trend); decline reasons (bar); offer vs band position (heatmap grade × quartile)                                     |
| Interviewers    | HR                    | Interviews per person (bar); scorecard lateness (bar); rating spread per interviewer (to spot a harsh or a lenient scorer)            |
| Quality of hire | HR                    | Probation pass rate and 12-month retention by source and by hiring manager (cohort chart; needs People's events, empty without them)  |
| Fairness        | HR (a separate grant) | Adverse impact ratio per stage and group (bullet against 0.8); AI-assisted vs not (§22.6)                                             |
| Requisitions    | HR, finance           | Open requisitions by age (bar); approval time (trend); headcount plan vs hired (combo)                                                |
| Job             | The hiring team       | That job's funnel, sources, time in stage, interviews this week                                                                       |

Metric definitions are one module (`domain/analytics/metrics.ts`): time to
hire is application to `hired`; time to fill is job opened to the last
opening `hired`; conversion is the share of applications that ever reached a
stage category; each with its test.

### 23.3 Saved views, exports, schedules

Any dashboard tile can be saved with its filters, exported as CSV, and sent on
a schedule as an email with a link (not an attachment; the link opens under
the reader's own permissions).

### 23.4 Ask for a chart (R25)

A prompt box on the analytics page: "offer acceptance by department this year
as bars", "how long do engineering hires take compared with sales, by month".
The pattern is the assistant's (Assistant PRD §9), restricted to Recruiting:

1. The model sees the question and the **metrics catalogue** — metric names,
   dimension names, filter names, periods and chart kinds — never a value.
2. It returns a plan: `{ metric, breakdown?, filters, period, compare?, chart }`.
3. The domain validates the plan (unknown names, a breakdown the metric does
   not support, a cohort below five) and refuses it whole with the reason.
4. The domain computes; Reach draws the chosen chart; the plan is shown as
   editable chips above it, so a person can change any part by hand.
5. Saved to a dashboard like any tile.

Without the key, the same chips build the chart by hand.

---

## 24. Privacy and candidate rights

### 24.1 Roles

The tenant is the controller; Kithena the processor. A candidate's data is
`personal`; files and notes are `confidential`; diversity self-ID is
`special_category`.

### 24.2 Retention

From the country pack, per outcome, starting at the decision:

| Country | Rejected or withdrawn                                                                   | Talent pool      |
| ------- | --------------------------------------------------------------------------------------- | ---------------- |
| DE      | 6 months (AGG claim window: 2 months to claim, then 3 to sue, plus margin)              | With consent, 12 |
| ES      | 6 months by default; the reviewer confirms against limitation periods                   | With consent, 12 |
| GB      | 6 months (Equality Act claim window plus margin)                                        | With consent, 12 |
| IN      | 6 months by default under the DPDP Act's purpose limitation                             | With consent, 12 |
| US      | At least 1 year (EEOC record-keeping, 29 CFR 1602.14); 2 for larger federal contractors | With consent, 24 |

At the end, the candidate's personal data is deleted and the application
anonymised: the stage history, source, dates and reasons stay for analytics,
with no way back to the person. Hires are kept and handed over (§21.4).
A legal hold suspends deletion.

### 24.3 Rights

Access (a download from the candidate page, or HR exports it), correction,
deletion (immediate, except under a legal hold or for a hire), objection to
the talent pool, and human review of a knockout (§15.2). Each request is
logged. The DSAR manifest is generated by codegen from the classified
contracts, as everywhere.

### 24.4 Diversity self-ID

Voluntary, after the application is sent, never on the form itself, in a
separate encrypted store, readable only as aggregates with the cohort minimum,
never by a hiring team member, never by a model. US EEO-1 categories where the
tenant is a US employer; elsewhere off unless the tenant switches on a
category that is lawful in that country.

---

## 25. Access

Who may see what depends on the job, so it is a graph: the job, its hiring
team, and the candidate's applications. OpenFGA, like People and Time Off.

| Role             | Scope            | May                                                                                                     |
| ---------------- | ---------------- | ------------------------------------------------------------------------------------------------------- |
| Recruiting admin | Tenant           | Everything, settings, packs' tenant values, analytics including fairness (fairness by a separate grant) |
| Recruiter        | Jobs assigned    | Run the pipeline, message, schedule, make offers                                                        |
| Hiring manager   | Their jobs       | Review, decide, approve; see offers for their jobs                                                      |
| Interviewer      | Their interviews | The kit, the CV, the parts of the profile the job allows; their own scorecard; others after submitting  |
| Coordinator      | Jobs assigned    | Schedule; no scorecards, no offers                                                                      |
| Approver         | One item         | The requisition or offer they approve                                                                   |
| Works council    | DE jobs          | The candidate presented for consent, for that job (§19.9)                                               |
| Agency           | Invited jobs     | Their own submissions' stages                                                                           |
| Member           | Tenant           | The internal board; refer; apply internally                                                             |

**Internal applicants** are hidden from their own manager until the candidate
reaches a stage the tenant names (default: offer), so applying internally does
not cost anyone their standing. Offers and pay are visible to recruiters,
the hiring manager, approvers and admins only.

Authorization lives in the application layer, for every transport (repo rule).

---

## 26. Integrations

Named generically in the product ("Job boards", "Calendars", "Video",
"Chat apps"); a vendor's name only on its own row (integration naming memory).

### 26.1 Job boards

| Board           | Route                                                                                                                                                                                                                                                         | Phase | Business task                                                           |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ----------------------------------------------------------------------- |
| Google for Jobs | `JobPosting` structured data on every job page                                                                                                                                                                                                                | 1     | None                                                                    |
| Indeed          | **Job Sync API** to publish, update and close jobs; **Indeed Apply** posts applications to Recruiting's endpoint; disposition sync returns stages. Indeed checks the job's public URL matches what was sent, so Kithena Jobs' page is the job's URL           | 3     | Sign Indeed's developer agreement and request the integration           |
| Glassdoor       | Glassdoor takes ATS jobs through Indeed; publishing to Indeed lists the job on Glassdoor. No separate integration                                                                                                                                             | 3     | Covered by Indeed's                                                     |
| LinkedIn        | LinkedIn's Job Posting API is partner-only, and LinkedIn reports it is not accepting new posting partners; Apply Connect is partner-gated too. Until a partnership exists, the tracked share link and the candidate's "apply with LinkedIn profile URL" field | 3+    | Apply to LinkedIn's Talent Solutions partner programme; outcome unknown |
| Open XML feed   | Per company and for Kithena Jobs as a whole, for aggregators that read feeds                                                                                                                                                                                  | 1     | None                                                                    |

Every board is an adapter behind one port (`JobBoard`: publish, update,
close, status, and an inbound application mapper). A new board is one
adapter. Multiposting resellers fit the same port and are out of scope until
asked for.

### 26.2 Calendars and video

Google Workspace and Microsoft 365 by OAuth per member: free/busy, create and
update events, and a Meet or Teams link with the event. Zoom the same way, for
a member who would rather give a Zoom link than Meet or Teams. Tokens are sealed;
scopes are the narrowest that do the job. Without a calendar, scheduling uses
working hours in Recruiting and sends an `.ics` invitation.

### 26.3 Chat apps

Through `platform/slack` (Teams may follow): new applicant digests for a job's
channel, scorecard reminders, approvals with buttons that run Recruiting's own
operation as the person.

### 26.4 Other systems

- **HRIS** (when People is absent): the `hired` webhook and REST.
- **Assessments** and **background checks**: ports, no provider until chosen
  (§15.3, §17.2).
- **E-signature**: Documents. External providers are out of scope.

---

## 27. Events

Every event carries `occurredAt` and `effectiveFrom`; corrections carry
`supersedes`; every field is classified. No event carries a CV, a note, a
message body, an answer or a score explanation.

| Event                                                                            | When                                   | Notable fields                                                                                       |
| -------------------------------------------------------------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `recruiting.requisition.submitted`                                               | Sent for approval                      | openings, orgUnitId, budget (minor units, currency)                                                  |
| `recruiting.requisition.decided`                                                 | Approved or rejected                   | decision, by                                                                                         |
| `recruiting.job.opened` / `.closed` / `.filled`                                  | Job state                              | jobId, requisitionIds                                                                                |
| `recruiting.job.published` / `.unpublished`                                      | A target goes live or down             | target, url                                                                                          |
| `recruiting.application.received`                                                | A new application                      | applicationId, candidateId, jobId, source                                                            |
| `recruiting.application.moved`                                                   | Stage change                           | from, to, category, by; `supersedes` for a correction                                                |
| `recruiting.application.rejected`                                                | Rejected                               | reasonKey (no free text), by                                                                         |
| `recruiting.application.withdrawn`                                               | The candidate withdrew                 |                                                                                                      |
| `recruiting.interview.scheduled` / `.completed` / `.cancelled`                   | Interview state                        | interviewId, interviewerIds, startsAt                                                                |
| `recruiting.scorecard.submitted`                                                 | A scorecard in                         | interviewId, interviewerId, recommendation                                                           |
| `recruiting.offer.approved` / `.sent` / `.accepted` / `.declined` / `.withdrawn` | Offer state                            | offerId, version                                                                                     |
| `recruiting.candidate.hired`                                                     | Contract signed                        | ResolvedTerms, pay, benefits, startDate, managerId, orgUnitId, locationId, legalEntityId, conditions |
| `recruiting.prehire.conditions_met`                                              | Every condition met                    |                                                                                                      |
| `recruiting.prehire.cancelled`                                                   | The hire fell through before the start | reasonKey                                                                                            |
| `recruiting.candidate.deleted`                                                   | Retention or a request                 | candidateId only                                                                                     |

---

## 28. With People, Documents, Time Off, the Inbox and the assistant

| Flow                              | Screens | How                                                                                                                                                               |
| --------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hiring team from the org          | R2, R4  | Recruiting's member projection, fed by People's events (or the import)                                                                                            |
| Pay bands in offers               | R19     | Recruiting's projection of `people.pay_band.set`                                                                                                                  |
| A hire becomes a person           | R22     | People consumes `recruiting.candidate.hired`, creates the `pre_hire`, maps `ResolvedTerms` to its fields; consumes `.prehire.cancelled` to discard                |
| The contract, signed              | R22, J7 | The shell runs Documents' file + envelope with `subjectRef`; Recruiting consumes `documents.envelope.completed`                                                   |
| The signed contract on the person | —       | Documents files it to the member once People's `pre_hire` reaches Documents' member projection                                                                    |
| Interviewers' days off            | R16     | The shell passes Time Off's absences for the interviewers to the scheduler (props are JSON, remote props memory)                                                  |
| Start date and holidays           | R19     | The shell passes Time Off's public holidays for the location's calendar to the date picker                                                                        |
| Tasks                             | Inbox   | Recruiting answers the Inbox read: approvals, scorecards due, new applicants (update), interviews today, replies; one line in `apps/web/src/lib/inbox/sources.ts` |
| Questions in chat                 | Slack   | Recruiting's assistant capabilities (§22.9)                                                                                                                       |
| Referrals                         | R8      | Members from the projection; referral outcome told to the referrer                                                                                                |
| Onboarding                        | O1      | Onboarding consumes `recruiting.candidate.hired` (Part II)                                                                                                        |

Each module stays sellable alone: every row above has a "without" path in the
section it points to.

---

## 29. Screens and navigation

### 29.1 Shell

Web: "Recruiting" (`briefcase`) after Documents in the sidebar, with sub-items
Jobs, Candidates, Talent pools, Interviews, Offers, Analytics. Phone: a
Recruiting entry under More for hiring managers and interviewers. Settings
gains a Recruiting tab.

### 29.2 Web screens (remote `apps/web/recruiting`, port 3005)

| Id    | Screen                                                                                                 | Route                                           |
| ----- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------- |
| R1    | Recruiting home: my tasks, my jobs                                                                     | `/recruiting`                                   |
| R2    | Requisitions list and editor                                                                           | `/recruiting/requisitions`, `/…/<id>`           |
| R3    | Requisition approval                                                                                   | `/recruiting/requisitions/<id>/approve`         |
| R4    | Job setup (details, team, criteria, plan)                                                              | `/recruiting/jobs/<id>/setup`                   |
| R5    | Ad editor with checks and languages                                                                    | `/recruiting/jobs/<id>/ad`                      |
| R6    | Apply form builder                                                                                     | `/recruiting/jobs/<id>/form`                    |
| R7    | Publishing targets                                                                                     | `/recruiting/jobs/<id>/publish`                 |
| R8    | Internal job board and referrals                                                                       | `/recruiting/board`                             |
| R9    | Agencies                                                                                               | `/recruiting/agencies`                          |
| R10   | Pipeline board / table                                                                                 | `/recruiting/jobs/<id>?view=board` (or `table`) |
| R11   | Candidate profile                                                                                      | `/recruiting/candidates/<id>?tab=`              |
| R12   | Messages                                                                                               | `/recruiting/candidates/<id>?tab=messages`      |
| R13   | Talent pools                                                                                           | `/recruiting/pools`, `/…/<id>`                  |
| R14   | Interview plan and kits                                                                                | `/recruiting/jobs/<id>/interviews`              |
| R15   | Interview kit and scorecard                                                                            | `/recruiting/interviews/<id>`                   |
| R16   | Scheduling                                                                                             | `/recruiting/interviews/schedule?application=`  |
| R17   | Debrief                                                                                                | `/recruiting/applications/<id>/debrief`         |
| R18   | References                                                                                             | `/recruiting/applications/<id>/references`      |
| R19   | Offer editor                                                                                           | `/recruiting/offers/<id>`                       |
| R20   | Offer approval                                                                                         | `/recruiting/offers/<id>/approve`               |
| R21   | Terms composer (modal)                                                                                 | `?terms=open` on R2, R4, R19                    |
| R22   | Contract and pre-hire                                                                                  | `/recruiting/offers/<id>/contract`              |
| R23   | Analytics dashboards                                                                                   | `/recruiting/analytics/<dashboard>?…`           |
| R24   | Analytics tile detail                                                                                  | `/recruiting/analytics/<dashboard>/<tile>`      |
| R25   | Ask for a chart                                                                                        | `/recruiting/analytics/ask?q=`                  |
| R26   | Candidates (all)                                                                                       | `/recruiting/candidates?…`                      |
| S1–S8 | Settings: general, pipelines, questionnaires, approvals, scorecards, benefits, AI, packs and retention | `/recruiting/settings/<page>`                   |

### 29.3 Phone screens (`apps/tenant-mobile`)

`RM1` my interviews, `RM2` a job's pipeline (list by stage), `RM3` candidate,
`RM4` interview kit and scorecard, `RM5` approvals, `RM6` refer, `RM7`
analytics overview. Everything else names its reason in `desktop-only.json`
(the ad editor, the form builder, the terms composer: long forms with wide
tables), as the repo's mobile parity gate requires.

### 29.4 Kithena Jobs (`apps/jobs`)

`J1` search, `J2` results, `J3` job, `J4` apply, `J5` sent, `J6` my
applications and scheduling, `J7` offer and contract, `J8` job assistant,
`J9` agency portal, `J10` company careers page, `J11` job alerts.

---

## 30. Reach additions

Each is added to Reach first, presentational, without knowing what a
candidate is (repo rule):

- **`Kanban`** exists; it gains a column header slot for counts and a card
  footer slot. No recruiting words.
- **`ScoreScale`**: a labelled 1–4 rating with anchors, keyboard operable,
  if `Rating` cannot take anchors as a variant (check first).
- **`EvidenceHighlight`**: a text view with highlighted ranges and a side list
  linking to them — or a `highlights` prop on an existing text view if one
  fits.
- **`StepComposer`**: a vertical list of dependent steps with a rules side
  panel, for the terms composer — check `Stepper` and `FormSections` first.
- **`SlotPicker`**: day columns with time slots, time-zone aware; check
  `Scheduler` first.
- **`ChartPlanChips`**: editable chips for a chart plan, likely `Chip` and
  `Combobox` composed, not a component.
- Charts: the existing set covers §23 (`FunnelChart`, `CohortChart`,
  `BulletChart`, `ComboChart`, `HeatmapChart`); none is added.

---

## 31. Storage

### 31.1 The module's schema

Schema `recruiting`, role `svc_recruiting NOBYPASSRLS`, RLS on `tenant_id`, an
outbox relayed by Debezium. Tables: `member`, `entity`, `org_unit`,
`location`, `requisition`, `requisition_approval`, `job`, `job_ad`,
`job_target`, `job_criterion`, `pipeline_template`, `stage`, `form`,
`questionnaire`, `question`, `candidate`, `candidate_file`, `candidate_text`,
`application`, `application_stage_event` (append-only), `answer`,
`consent`, `pool`, `pool_member`, `tag`, `note`, `message`, `interview_plan`,
`interview`, `interview_interviewer`, `scorecard_template`, `scorecard`,
`rating`, `reference_request`, `condition`, `offer`, `offer_version`,
`offer_approval`, `contract`, `benefit`, `pay_band`, `terms_tenant_value`,
`source`, `source_cost`, `referral`, `agency`, `agency_submission`,
`ai_assessment`, `ai_verdict`, `chart_plan`, `saved_view`, `self_id`
(encrypted, separate grant), `calendar_link` (sealed tokens), `settings`,
`idempotency_key`, `outbox`. Files in S3 (`RECRUITING_BUCKET`), sealed with
`RECRUITING_ENCRYPTION_KEY`; SeaweedFS locally; in memory in the standalone
suite. Atlas migrations, expand-contract.

### 31.2 The public projection

Kithena Jobs reads across companies, which RLS forbids by design. So a
separate schema, `recruiting_public`, holds only what is already public: the
published job's ad, title, company display name and branding, location,
terms outline, salary when shown, benefits, the `tsvector`, and the targets'
URLs. Written only by Recruiting's outbox consumer on `job.published` and
`.unpublished`; read by `apps/jobs` through a read-only role. Every column is
`public` in the classification; a codegen check fails if a non-public field
reaches it.

---

## 32. Headless surfaces

- GraphQL subgraph `recruiting` (one query per screen), composed by the Cosmo
  Router.
- REST `/v1/recruiting/...` with OpenAPI from the Zod contracts, idempotency
  keys on every write.
- **Public API** (no tenant auth): list and read published jobs, the apply
  endpoint (with the email code), the candidate portal's operations by its
  magic token, the board inbound endpoints (signed).
- Webhooks for every published event, signed.
- The XML feed and the embed script.

---

## 33. Non-functional requirements

- Kithena Jobs search answers under 300 ms at the 95th percentile for 100,000
  open jobs; the first page is server-rendered; Core Web Vitals green on a
  mid-range phone.
- The pipeline board renders 2,000 applications in a job without jank
  (virtualised lists, Reach `VirtualList`).
- An application with a 10 MB CV is accepted in under 3 s on a 4G
  connection.
- The evidence matrix for one application returns in under 20 s; batches run
  in the background (BullMQ) and the board fills as they land.
- Every Reach screen passes axe; the apply form is completed with a keyboard
  and a screen reader in the acceptance suite.
- Every route enforces access in the application layer; acceptance proves an
  interviewer cannot read another job's candidates, an agency cannot read
  another agency's, and a manager cannot see an internal applicant before the
  named stage.

---

## 34. Parity check

Capabilities the benchmark tools (JOIN, Personio, Factorial, LinkedIn's hiring
tools, Greenhouse) offer between them, and where each is here. A row marked
"later" is a decision, not an oversight.

| Capability                                  | Here          |
| ------------------------------------------- | ------------- |
| Requisitions and approvals                  | §7            |
| Job ads, multilingual, AI-assisted          | §8, §22       |
| Careers page and embeddable widget          | §10           |
| Multiposting to boards                      | §9, §26.1     |
| Google for Jobs                             | §9, §10.3     |
| Apply form, questionnaires, knockouts       | §8.4, §15     |
| CV parsing                                  | §14.2         |
| AI matching with explanations               | §14.3         |
| Pipeline kanban, bulk actions               | §12           |
| Candidate database and talent pools         | §12, §13      |
| Two-way email, templates                    | §12.7         |
| Self-scheduling, calendar sync, video links | §16.4, §26.2  |
| Structured interviews, kits, scorecards     | §16           |
| Debrief and decision                        | §16.7         |
| References, background checks               | §17           |
| Offers, approvals, letters                  | §18           |
| Country-aware contract terms                | §19           |
| E-signature                                 | §21           |
| Referrals, agencies, internal mobility      | §9.3, §9.4    |
| Candidate portal                            | §10.5         |
| Analytics and custom reports                | §23           |
| Diversity reporting, bias checks            | §22.6, §24.4  |
| GDPR retention and requests                 | §24           |
| Onboarding                                  | Part II       |
| SMS and WhatsApp                            | Later (§12.7) |
| Video interview recording and transcription | Later (§35)   |
| Sourcing extension (browser)                | Later (§35)   |

---

## 35. Scope and phasing

- **Phase 0 — unblock**: manifest, schema, role, outbox, boot, Dockerfile,
  codegen, `module.recruiting` offered.
- **Phase 1 — boots alone, hires**: contracts; the domain (pipeline, stage
  history, terms packs for the five countries, offers, metrics); storage;
  application; GraphQL, REST, public API; the web remote R1–R26 without AI;
  Kithena Jobs J1–J7, J9–J11; Google for Jobs and the XML feed; two-way
  email; manual and self-scheduling without calendars; analytics dashboards
  without "ask"; offer acceptance and upload-signed contract; the `hired`
  webhook; standalone.
- **Phase 2 — AI**, after §22.2 is signed off: parser, matrix, rediscovery,
  ad writer, kits, debrief summary, email drafts, the job assistant J8, ask for
  a chart R25, the AI Act documentation, fairness dashboard.
- **Phase 3 — integrations**: calendars and video, Indeed (and so Glassdoor),
  chat apps, LinkedIn if a partnership exists, a company's own domain for its
  careers page.
- **Phase 4 — with the suite**: §28's flows: People's pre-hire, Documents'
  contract envelope with `subjectRef`, Time Off's absences and holidays in
  scheduling, the Inbox source, assistant capabilities, phone screens RM1–RM7.
- **Phase 5 — Onboarding**: Part II.

Out of scope: SMS and WhatsApp, video interview recording and transcription
(consent and works-council issues outweigh the value for now), qualified
electronic signatures, a browser sourcing extension, payroll, benefits
enrolment, pricing equity, multiposting resellers, background-check and
assessment providers (ports only).

## 36. Decisions

Taken on the owner's behalf on 2026-10-15, while they were away, so the build
was not blocked. Each follows common practice in the products §34 compares
against, and each is **open for review**: changing one is a commit, not a
redesign.

1. **A model may read an application** (§22.2): **accepted**, with the seven
   limits in §22.2 enforced in Recruiting. Greenhouse, Workday, Personio and
   JOIN all read CVs with a model; the limits are what make it defensible
   under the AI Act and GDPR art. 22. Recorded in `docs/tech-stack.md` and
   `CLAUDE.md`; REC-110 is ticked on this record.
2. **Kithena Jobs as a cross-company site**: **yes**, opt-in per company and
   per job, off by default. A company's careers page works without it.
   Abuse is handled by the apply form's email code, rate limits and honeypot
   (§10.4), and by a report link on every job page that unpublishes it from
   the cross-company search for review.
3. **Board partnerships**: the adapters are built behind the `JobBoard` port
   with a fake each; going live with Indeed or LinkedIn is the owner's
   business task (signing Indeed's developer agreement, applying to
   LinkedIn's programme). Nothing in Phase 1 waits for it.
4. **Country reviewers**: the five packs ship **enabled**, each marked
   "awaiting a country reviewer" in the composer's rules panel and on the
   offer, with the statute cited for every rule so a reviewer can check it.
   REC-150 stays open until a reviewer signs each off.
5. **Hosting**: `apps/jobs` goes on Vercel Hobby beside `apps/web`, per the
   hosting decision. The non-commercial clause remains flagged for the owner;
   moving to Pro is one setting when they choose to.
6. **The AI Act conformity owner**: the account owner until they name
   someone; REC-127 stays a business task with a December 2027 deadline.
7. **Access is decided by the domain, not OpenFGA** (§25): over
   Recruiting's own rows (administrators, each job's hiring team, an
   approval's approvers, a works council), for every transport, in the
   application layer — Documents' reasoning. Nothing in it is a graph
   OpenFGA answers better, and keeping the hiring team as tuples too would
   be a second copy to keep in step. The internal applicant's manager comes
   from the member projection.

---

# Part II — The Onboarding module

## O1. Executive summary

Onboarding is its own sellable module (`ModuleKey` `onboarding`, entitlement
`module.onboarding`, `requiresPeopleSource: 'either'`, `dependsOn: []`). It
takes a hire — from Recruiting, from People, or from another system by
webhook — and runs the plan that gets the person from a signed contract to the
end of probation: what they do before day one, what everyone else must do for
them, day one itself, the first weeks, and the probation review.

## O2. Where the boundary sits

- **Owns**: plan templates, plans, tasks and their state, the pre-start
  welcome page, buddy assignments, check-ins, probation reviews, onboarding
  analytics.
- **Learns**: the hire from `recruiting.candidate.hired`, `people.person.hired`
  or `POST /v1/onboarding/hires` (an external ATS); members from People's
  events or the import; the probation end from the hire's terms.
- **Tells**: `onboarding.plan.started`, `.task.completed`, `.plan.completed`,
  `.probation.reviewed` (outcome: passed, extended, failed), Inbox tasks for
  every role, assistant capabilities.
- **Does not own**: the person's fields (People collects them through its own
  `collectAt: onboarding` form; Onboarding links to it as a task), documents
  (Documents' document requests and acknowledgements, linked as tasks),
  accounts and devices (integrations, Phase 3).

## O3. Templates (O2)

A template is a list of tasks grouped by phase: **before day one**, **day
one**, **first week**, **first month**, **until probation ends**. Each task: a
title, an owner role (`new_hire`, `manager`, `buddy`, `hr`, `it`, a named
person), a due rule relative to the start date (`-14d`, `0`, `+30d`) or to
probation's end (`-14d`), a kind (`todo`, `form` linking People's onboarding
section, `document` linking a Documents request, `acknowledge` linking a
Documents policy, `meeting`, `equipment`, `account`), and conditions
(legal entity, country, location, department, work mode, contract type).
Country tasks come from the pack (§O7) and cannot be removed for that country.

## O4. A plan (O3, O4)

When a hire arrives, the templates whose conditions match are merged into a
plan with dates computed from the start date, skipping non-working days from
the location's calendar when Time Off's holidays are passed by the shell.
States: `scheduled → in_progress → completed | cancelled`. A start date moved
moves every task that hangs off it; a cancelled hire cancels the plan.

## O5. The new hire before day one (O5, MO1)

The pre-hire has no account yet. They get a welcome email with a link to a
**welcome page** on Kithena Jobs' host (the candidate page grows into it):
their start date, place and time, who meets them, their buddy, what to bring,
the first week's agenda, and their tasks (upload documents, read policies,
fill the forms the country needs). On the start date, identity's enrolment
invitation (already built) gives them an account and the page becomes their
tenant app's onboarding section.

## O6. Everyone else (O6, O7)

Manager, buddy, IT and HR see their onboarding tasks in the Inbox and on an
onboarding board: every plan in flight, how far along, what is late. A
check-in is a short form (new hire and manager) at day 30, 60 and 90.

## O7. Country tasks — awaiting a country reviewer

| Country | Before the start                                                                                            | Around day one                                                                                                          |
| ------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| ES      | Social Security registration (alta) before the start; collect the NAF and bank details                      | Communicate the contract to the public employment service within 10 days; daily time recording on                       |
| DE      | Collect tax ID, health insurer, social security number; register with social insurance by the first payroll | Hand over the Nachweis if not already given; data protection and confidentiality acknowledgements                       |
| GB      | Right-to-work check (a Recruiting condition) before the start                                               | Written statement of particulars on or before day one; starter checklist for payroll; pension auto-enrolment assessment |
| IN      | Collect PAN and bank details; UAN for the provident fund (existing or new)                                  | Appointment letter; provident fund and state insurance registration where applicable                                    |
| US      | Collect W-4 and the state withholding form                                                                  | Form I-9 section 1 by day one, section 2 within three business days; E-Verify where required                            |

Identification values are People's (its encrypted identifiers); Onboarding's
task only asks for them through People's form.

## O8. Probation (O8)

Thirty days before probation ends (from `ResolvedTerms`), the manager gets a
review task: pass, extend (where the pack allows and by no more than the pack
allows), or end. The outcome is published; People records it as
`probation_outcome`. Ending a probation is People's termination flow, not
Onboarding's.

## O9. Analytics (O9)

Plans on time, tasks late by owner role, time to productive (a tenant-defined
task as the marker), probation outcomes by department and by source (with
Recruiting's events when present), 90-day retention.

## O10. Screens

Web remote `apps/web/onboarding` (port 3006): `O1` onboarding board, `O2`
templates, `O3` a plan, `O4` my tasks as manager or buddy, `O5` the welcome
page (public host), `O6` check-ins, `O7` settings, `O8` probation reviews,
`O9` analytics. Phone: `MO1` welcome and my tasks (new hire), `MO2` my
onboarding tasks (others), `MO3` probation review.

## O11. Storage and surfaces

Schema `onboarding`, role `svc_onboarding NOBYPASSRLS`, RLS, outbox. Tables:
`member`, `hire`, `template`, `template_task`, `plan`, `task`, `check_in`,
`probation_review`, `settings`, `idempotency_key`, `outbox`. GraphQL subgraph
`onboarding`, REST `/v1/onboarding/...`, the hire webhook in, events out.

## O12. Phasing

Onboarding is Phase 5 of this plan: templates, plans, the welcome page, the
board, country tasks, probation, the three hire sources, standalone; then the
Inbox source, analytics, and account and device integrations (Phase 3 of
Onboarding, out of scope here).
