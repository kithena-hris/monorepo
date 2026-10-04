# Product Requirements Document: The Assistant

**Version**: 1.0
**Date**: 2026-10-03
**Status**: Draft for engineering review

---

## How to read this

**Building it?** The ordered tickets are in
[`docs/assistant-build-plan.md`](./assistant-build-plan.md), on the long-lived
branch `assistant`. There are no new screens in Phase 1: the assistant answers
in Slack, which already exists.

This document specifies Kithena's cross-module assistant: a platform service,
`platform/assistant`, that takes a question in words ("how many people are off
today?", "who are the managers of people on sick leave today?"), plans it as
calls to the modules the company has, runs those calls as the person who asked,
joins and counts the results itself, and answers in words.

The questions that were open when this was written are answered here, with the
reasoning in place so the answer can be argued with:

| Question                                                   | Answer                                                                                                      | Where                                         |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| Is the assistant a module?                                 | No. A platform service, like messaging and Slack: every tenant has it, nobody buys it, `ModuleKey` omits it | [§6](#6-where-the-boundary-sits)              |
| How does it reach People and Time Off without importing?   | Each module publishes typed capabilities in `packages/contracts` and serves them over internal HTTP         | [§8](#8-the-capability-contract)              |
| What does the model decide?                                | Which capabilities to call, with which filters. Never a number, never a value, never who may see what       | [§9](#9-the-plan-language)                    |
| Whose permissions apply?                                   | The asker's, checked by each module in its own application layer, exactly as on its own screens             | [§10](#10-execution-and-authorization)        |
| Does a company with only People, or only Time Off, get it? | Yes. The assistant offers only the capabilities of the modules a company has, and says what it cannot see   | [§7.4](#74-a-company-with-people-only)        |
| Can someone learn who is on sick leave by asking?          | Only if they could see it on Time Off's calendar, and never as names in a chat channel                      | [§7.7](#77-someone-who-may-only-see-away)     |
| Does sick leave reach the model?                           | No. A private leave type in the question is replaced by an opaque reference before the prompt is built      | [§12.2](#122-special-category-data)           |
| Is the plan accurate enough?                               | A fixed set of questions with expected plans is a merge gate                                                | [§13.2](#132-evaluation)                      |
| What happens to Slack's existing path to People?           | It moves to the assistant in the same release, and People's `/internal/assistant/ask` is deleted            | [§16](#16-migrating-the-slack-to-people-path) |

Everything the service inherits from the repository — no cross-module imports,
Zod as the single schema source, every contract field classified, no
`new Date()` in domain code, Result-returning domain operations — is assumed
rather than restated. `CLAUDE.md` names `docs/tech-stack.md` for the full
reasoning behind the stack; that file does not exist in the repository today,
so this document cites `CLAUDE.md` and the code instead.

---

## 1. Executive summary

People already answers questions in Slack. A manager types "who reports to
Michael?" and People's assistant reads it into a query over People's own
fields, runs it as that manager and answers. It is good at that and blind to
everything else: it cannot say who is off today, because time off is not
People's.

The question people actually ask crosses modules. "How many people are off
today?" is Time Off's. "Who are the managers of people on sick leave today?" is
a filter on Time Off joined to People's reporting lines. "Who in Engineering is
off next week?" is People's department joined to Time Off's calendar. No single
module can answer any of these, and none may import another to try.

The assistant is the one place that may know every module exists. Each module
describes what it can be asked — typed capabilities with Zod inputs and
outputs, published in `packages/contracts` — and serves them over internal
HTTP. The assistant shows a model the question and the names of those
capabilities and fields, never a value from anybody's record, and gets back a
plan: a short list of capability calls, where a later call may be narrowed to
the people an earlier one found. The assistant validates the plan strictly,
runs each call as the asker so every module applies its own permissions,
joins on `personId`, counts in code, and writes the answer from a template.

It also has to respect the constraint everything else here does: every module
must be sellable on its own. A company with People alone keeps exactly the
assistant it has today. A company with Time Off alone, running its people in
Workday, gets answers about time off. A future module joins by publishing its
own capabilities; the assistant does not change.

---

## 2. Problem statement

### Current situation

- **Slack asks People, and only People.** `platform/slack/src/service.ts`
  (`question`) reads the asker's verified email from Slack and calls
  `People.ask`, which `platform/slack/src/main.ts` sends to People's
  `POST /internal/assistant/ask` with `SLACK_PEOPLE_TOKEN`.
- **People answers as the asker.** `services/people/src/http/server.ts`
  (`answerChat`) checks the token; `application/assistant/from-chat.ts`
  (`askFromChat`) finds the current person with that work email
  (`accountByEmail`: one current person, an identity account, access not
  ended) and their roles; `application/assistant/ask.ts` (`ask`) builds the
  catalogue of fields the asker may filter on (`filterFields`, `aiEligible`
  only), sends the question and the catalogue through the AI gateway, reads the
  model's answer strictly into an `Intent`
  (`domain/assistant/intent.ts`: `people`, `count`, `person`, `reports`,
  `approvals`, `unclear`), runs it through the directory's own authorization
  and writes the answer itself.
- **The design already expected more than one module.** `AssistantAnswer.answered`
  in `ask.ts` says: "Where several modules are asked the same question, this is
  how an answer is chosen." That is a fan-out: ask everyone, keep the answer
  that says it answered. It cannot answer a join. "Managers of people on sick
  leave" is not an answer either module can give and the other can pick; it is
  a Time Off result fed into a People query. This PRD replaces the fan-out with
  a plan.
- **People's smart search is richer than Slack's path.** Merged in #249,
  `domain/assistant/selection.ts` reads rankings ("the person with the most
  missing details"), counts, negations ("not in Sales"), relative dates ("next
  month", "left last quarter"), managers ("Marco's team") and groups ("which
  department has the most…"), behind `POST /v1/views/directory/plan`
  (`application/assistant/selection.ts`, `planDirectory`). Slack's path uses
  the older, narrower `Intent`.
- **Time Off has AI, and rules for it.** `services/timeoff/src/application/assist/`
  holds Time Off's judgments and lines. `ports.ts` states the rule — the domain
  computes every number; no health data and no other person's data in a
  prompt — and `written.ts` enforces it: a model's line is kept only when every
  number in it is among the facts it was given, otherwise the template stands
  (`accept`, `written`). `infrastructure/assist/gateway.ts` loads, for every
  tenant, a deny list of keys and words that would mean health data reached a
  prompt, "sick leave" among them.
- **Time Off already decides who sees which absence.** `application/calendar/calendar.ts`
  (`calendarIn`, `sightOf`): the member and their approvers and delegates see
  the leave type; a teammate sees the type unless the type's `visibility` is
  `off_only`, and then sees "Off" and nothing else; anybody else sees nothing;
  HR sees everyone. Sick and parental leave default to `off_only`
  (`docs/timeoff-prd.md` §6.1, `domain/policy/leave-type.ts`).

### Proposed solution

A platform service that plans across modules and lets each module stay the
only authority over its own data:

1. Each module publishes **capabilities**: named, versioned, typed read
   queries in `packages/contracts/src/assistant/`, every field classified.
2. Per question, the assistant asks each module the company has for its
   **catalogue**: which capabilities it serves, and which fields, options and
   leave types this asker may filter by. Names only.
3. A model turns the question and the catalogue into a **plan**, which the
   assistant validates strictly and refuses whole if it names anything it was
   not offered.
4. The assistant **executes** the plan by calling each module as the asker. The
   module authorizes every call as it would the same person on its own screen.
5. The assistant **joins and counts** in code and **writes** the answer from a
   template. The model's only words in the answer are an opening it wrote
   before anything was looked up, with `{n}` where the count goes.

### Business impact

- The assistant is the first thing a company with two modules gets that
  neither module gives alone, without either module depending on the other.
- Slack becomes a reason to buy a second module: the question that crossed
  modules starts working the day the second module is switched on.
- The same contract serves Teams and the web search box later; nothing about
  a capability is Slack's.

---

## 3. Goals and success metrics

### Goals

1. Answer cross-module read questions correctly, as the asker, in Slack.
2. Keep every module sellable alone: no import, no `dependsOn`, no module that
   fails to boot or answer because the assistant or a sibling is absent.
3. Never let a model compute, see or leak a value: it plans, the code answers.
4. Never let the assistant widen anybody's access: a person learns nothing
   through the assistant that the module's own screen would not show them.
5. No regression for a company with People alone.

### Primary KPIs

| Metric                                                              | Target             | Measured by                                                |
| ------------------------------------------------------------------- | ------------------ | ---------------------------------------------------------- |
| Plan accuracy on the fixed eval set                                 | ≥ 90 % exact plans | `just assistant-eval`, gated in CI (§13.2)                 |
| Safety cases on the eval set (unknown capability, leak, number)     | 100 %              | Same gate                                                  |
| Answer posted after the question, p50 / p95                         | ≤ 4 s / ≤ 10 s     | `assistant.ask.duration_ms` (§13.1)                        |
| Questions answered (not `unclear`, not refused, not failed)         | ≥ 80 % in month 1  | `assistant.ask` outcome counter                            |
| People-only parity cases (today's `ask.test.ts` behaviours) passing | 100 %              | Ported tests in the assistant and People capability suites |

### Validation

- Every worked example in §7 is an end-to-end test against fake modules, and
  the Time Off ones also against Time Off's real application layer.
- A teammate's question for a private leave type returns a response that is
  byte-identical whether or not anybody is on that leave (§7.7).

---

## 4. Non-goals

- **No writes in v1.** The assistant reads. "Approve Ana's request" or "book me
  Friday off" will come back later as a _proposal_ the person confirms in the
  module's own flow, never done on a model's word. Approving from a Slack
  button already exists (`/internal/chat/act`, Time Off's chat integration) and
  is not the assistant's.
- **No free-form queries.** No SQL, no GraphQL written by a model, no
  capability that takes an expression. A plan can only name capabilities and
  filters the catalogue offered.
- **No model-computed numbers.** Counts, totals, balances and dates are
  computed by modules or by the assistant's domain code. A model never sees a
  record, so it has nothing to compute from.
- **No memory of answers.** Follow-up questions (Phase 2) carry earlier
  _questions_, never earlier answers, as People's `ask` already does (`EARLIER`).
- **No storage.** The assistant has no database in v1 (§12.4).
- **No new screens in Phase 1.** The web search box is Phase 3 and needs
  designs (§17).
- **No analytics engine.** "Average tenure by department over five years" is
  People's Insights' job. The assistant counts and groups the rows a
  capability returns; it does not do arithmetic across them beyond that.

---

## 5. Users and channels

### Who asks

| Persona                   | Asks things like                                                             | Sees                                                                                  |
| ------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Ada Lovelace — HR admin   | "How many people are off today?" "Who's on sick leave this week?"            | Everyone, every leave type (Time Off HR; People HR)                                   |
| Marco Ruiz — line manager | "Who in my team is off next week?" "Managers of people on sick leave today?" | Types for the people he approves; teammates' private types as "Away"; People as today |
| Adam Novak — employee     | "Is anyone in my team off Friday?" "Who reports to Marco?"                   | His team on the calendar, private types as "Away"; People as an employee sees it      |

### Where questions arrive

| Channel              | Phase | How                                                                                                           |
| -------------------- | ----- | ------------------------------------------------------------------------------------------------------------- |
| Slack slash command  | 1     | `/kithena …`, answered to the asker alone through the command's response URL (`platform/slack/src/events.ts`) |
| Slack direct message | 1     | Answered in the conversation                                                                                  |
| Slack mention        | 1     | `@Kithena …` in a channel. **Answered ephemerally to the asker, in the thread** — see below                   |
| Microsoft Teams      | 3     | A `platform/teams` adapter calling the same `/internal/ask`                                                   |
| The web search box   | 3     | Through the router as an `assistant` subgraph, with the signed-in principal                                   |

**A mention is answered to the asker alone.** Today a mention is answered in a
public thread (`Reply.via === 'thread'`). An answer is authorized for the
asker, not for everyone in the channel: HR asking "who earns above 80k?" in
`#general` would post salaries to the channel. From Phase 1 a mention's answer
is posted with `chat.postEphemeral` into the same thread, visible only to the
asker (the existing `chat:write` scope covers it). This fixes a leak that
exists today for People's answers, and the cross-module answers would make it
worse.

---

## 6. Where the boundary sits

### 6.1 What the assistant is

A platform service in `platform/assistant`, port 4104, beside `platform/slack`
(4102) and `platform/audit` (4103). The workspace already separates the two
kinds: `pnpm-workspace.yaml` says platform services are not modules, nobody
buys them, and `ModuleKey` correctly does not list them. The assistant is not
in `ModuleKey`, not in `OFFERED_MODULES`, not an entitlement, and not in the
`standalone` matrix (§15.5).

Layers as everywhere: `src/domain/` (plan validation, masking, dates, join and
count, answer text — pure, test-first), `src/application/` (the ask use case
over ports), `src/infrastructure/` (module, identity and model clients),
`src/http/` (the internal route).

### 6.2 What it owns

The plan language, the planner prompt, the join and count, the answer
templates, the eval set, and the list of capability versions it was built
against. Nothing about a person: it holds no record, keeps no copy and stores
nothing (§12.4).

### 6.3 What it does not own

- **Data.** Every value comes from a module, through that module's
  authorization, for this one question.
- **Permissions.** The assistant never decides whether someone may see
  something. It forwards who is asking; each module decides. Where a module
  answers "you may not", the assistant says so rather than working around it.
- **Vocabulary.** A module describes its own results in words
  (`described`: "whose department is Engineering"; "away on Tuesday 6
  October"), deterministically, from its own data. The assistant strings those
  phrases together. People's `describe()` in `ask.ts` is exactly this and moves
  behind People's capabilities unchanged.

### 6.4 No imports, either way

`.dependency-cruiser.cjs` already forbids it: `no-modules-in-platform` stops
`platform/*` importing `services/*`, and `no-platform-in-modules` stops the
reverse. The assistant knows a module only through `packages/contracts` (the
capability schemas) and the module's URL and pair token in its environment.
No module calls the assistant, so no module's standalone boot can depend on
it. A module serves its capability routes whether or not an assistant exists,
the way it serves REST whether or not anybody calls it.

### 6.5 Which modules a company has

The catalogue offers only the capabilities of modules the company is entitled
to (PEO-114): the back office's recorded list in `platform.tenant.entitlements`,
else the deployment's `KITHENA_ENTITLEMENTS` (`packages/contracts/src/entitlements.ts`,
`moduleEntitlements`, `deploymentEntitlements`). The assistant learns the list
from identity with the asker (§10.1) and forwards it in the principal, because
Time Off judges entitlement by the forwarded list (`services/timeoff/src/http/caller.ts`
refuses without `module.timeoff`) while People prefers its own recorded copy
from `identity.tenant.entitlements_changed`. A module that is entitled but has
no URL configured in this deployment is treated as absent and logged once.

### 6.6 Who the asker is

Slack knows a verified work email and nothing of Kithena. Today People turns
that into an account (`accountByEmail`). That cannot stay in People: a company
with Time Off alone has no People. **Identity** is the platform service every
tenant has and the owner of accounts (`platform/identity/src/account`), so it
gains one internal route (§10.1): an email and a tenant in, the active account,
its time zone, the tenant's slug and its modules out. Each module then resolves
everything else from the account as it does for a request through the router —
People its person and roles (`withTenantRoles`), Time Off its member
(`withMember`, from its projection).

---

## 7. Worked examples

All examples are a company in `Europe/Madrid` on **Tuesday 6 October 2026**,
with People and Time Off unless stated. Plans are shown as the model returns
them, after masking.

### 7.1 "How many people are off today?" — Ada, HR, in a direct message

1. **Slack** acknowledges at once (`platform/slack/src/main.ts`, unchanged),
   reads Ada's email, and calls `POST /internal/ask` on the assistant with
   `SLACK_ASSISTANT_TOKEN`: `{ tenantId, email, question, channel: 'slack' }`.
2. **Identity** resolves the email: Ada's account, `Europe/Madrid`, slug
   `acme`, modules `module.people`, `module.timeoff`.
3. **Catalogues**, in parallel, from People and Time Off as Ada (cached 60 s
   per account). Time Off's offers `timeoff.away` with filters `leave_type`
   (Vacation, Personal, Comp; the private types only when named, §12.2) and
   `team`; People's offers `people.find`, `people.person`, `people.reports`,
   `people.managers`, `people.approvals` with Ada's filterable fields. Because
   People is present, Time Off's `team` filter and `timeoff.managers` yield to
   People's (§8.4) and are not shown.
4. **Masking** finds nothing private in the question.
5. **The model** sees the question, "Today is Tuesday 6 October 2026", and the
   catalogue. It returns:

   ```json
   {
     "kind": "plan",
     "steps": [{ "id": "s1", "capability": "timeoff.away", "input": { "on": "today" } }],
     "answer": { "kind": "count", "step": "s1" },
     "say": "Here's who is out today: {n} people."
   }
   ```

6. **Validation** passes: one step, a capability offered, `on` a date
   reference, the answer names an existing step, `say` has no digit.
7. **Dates**: `today` in Ada's zone is `2026-10-06`.
8. **Execution**: `POST {TIMEOFF_URL}/internal/capabilities/timeoff.away` as
   Ada, `{ on: { from: '2026-10-06', to: '2026-10-06' }, limit: 0 }`. Time Off
   finds the absences that day that Ada may see — all of them, she is HR — and
   returns `{ total: 14, scope: 'everyone', rows: [], described: 'away on
Tuesday 6 October', notes: [] }`.
9. **Answer**: "Here's who is out today: 14 people." Understood: "Away on
   Tuesday 6 October." `{n}` was filled in by the assistant from Time Off's
   total.

**Adam, an employee, asking the same.** Time Off returns only the absences
his sight allows — his team and himself — with `scope: 'visible'`, total 3.
The template carries the scope: "3 people you can see are off today. You see
your own team; HR sees everyone." A company-wide number is never implied to
somebody who was only shown part of it.

### 7.2 "Who are the managers of people on sick leave today?" — Marco, manager, as a mention in `#eng`

1. Identity, catalogues as above.
2. **Masking**: "sick leave" matches Time Off's leave type `sick` (category
   `sick_leave`, visibility `off_only`, so private). It becomes the opaque
   reference `L1`. The model sees _"who are the managers of people on L1
   today?"_ and, in the catalogue, `leave_type` option `L1` labelled "a leave
   type named in the question". It never sees "sick".
3. **Plan**:

   ```json
   {
     "kind": "plan",
     "steps": [
       {
         "id": "s1",
         "capability": "timeoff.away",
         "input": {
           "on": "today",
           "filters": [{ "key": "leave_type", "op": "in", "values": ["L1"] }]
         }
       },
       { "id": "s2", "capability": "people.managers", "within": "s1", "input": {} }
     ],
     "answer": { "kind": "list", "step": "s2" }
   }
   ```

4. **Unmasking** turns `L1` back into `sick` before execution.
5. **s1** as Marco: Time Off applies its sight rule. Marco approves four
   people; two are on sick leave, so they match. A peer of Marco's is also on
   sick leave, but Marco sees peers' sick leave only as "Off", and **a type
   filter only matches absences whose type the asker may see** — so the peer
   is not in the result, and nothing in the response says there was anyone
   else. Being an intermediate step, s1 returns every matching `personId` (up
   to 5,000) and the total.
6. **s2** as Marco: People reads those two people as Marco may
   (`readMany`), takes their reporting line, and returns the distinct managers
   Marco may read: Marco himself.
7. **Answer** (posted ephemerally to Marco in the thread): "The people on sick
   leave today that you can see report to: • Marco Ruiz (you)." Understood:
   "Managers of people on sick leave on Tuesday 6 October."

**Ada asking the same** gets every manager, because Time Off shows her every
absence's type. The managers are named; **the people on sick leave are not**
(§11.4). Managers are listed without a per-manager count, because "Marco — 1"
for a manager with one report names the person.

### 7.3 "Who in Engineering is off next week?" — Marco, in a direct message

1. **Plan**: s1 `people.find` with `filters: [{ key: 'department', op: 'in',
values: ['engineering'] }]`; s2 `timeoff.away` with `on: 'next_week'`,
   `within: 's1'`; answer `list` of s2.
2. **Dates**: `next_week` is Monday 12 to Sunday 18 October in Marco's zone.
3. **s1** as Marco: People's directory authorization; 34 people.
4. **s2** as Marco, restricted to those 34: Time Off returns the absences
   Marco may see, each row with its dates, part of day, and the leave type
   only where Marco sees it.
5. **Answer**: "6 people in Engineering you can see are off next week (12–18
   October):" then one line each — "• Ana Ruiz — Mon 12 to Wed 14 · Vacation",
   "• Ben Ode — Thu 15 · Away". Ben is on sick leave and Marco approves him, so
   Time Off told the assistant the type; the chat line still says "Away",
   because a private leave type is never written beside a name in a chat app
   (§11.4).

The join is an **intersection**: a person appears only if every step that
touched them let the asker see them. A later step can narrow, never widen.

### 7.4 A company with People only

The catalogue has no Time Off capabilities. The model is told, in one line
each, which modules exist but are not part of this company's Kithena
(`unavailable`), so it can say so rather than guess.

- **"How many people are off today?"** → `{ "kind": "unavailable", "module":
"timeoff" }` → "I can't see time off: your company doesn't use Time Off in
  Kithena. I can help with your people — who is in a team, who reports to
  whom, how many people work where." People's status _On leave_ is employment
  status, not "off today", and the instruction says so.
- **"Who reports to Michael?"** → `people.reports` `{ name: 'Michael' }`,
  answered exactly as today: "Michael Scott has 5 direct reports: …", or "A few
  people are called Michael. Which one did you mean?" when several match.
- **"What's waiting for my approval?"** → `people.approvals`, as today.

Every behaviour of today's `ask.ts` is a capability and a template here, and
`ask.test.ts`'s cases are ported to them (AST-011, AST-019, AST-020).

### 7.5 A company with Time Off only

People is absent; employee records come from Workday through Time Off's
import. Time Off's `team` filter and `timeoff.managers` no longer yield to
anything and are offered.

- **"Who are the managers of people on sick leave today?"** → s1
  `timeoff.away` (L1), s2 `timeoff.managers` `within: s1`. Managers come from
  Time Off's member projection (`managerPersonId`, `displayName`), which it
  keeps for approvals (`docs/timeoff-prd.md` §5.2).
- **"Who in Engineering is off next week?"** → one step, `timeoff.away` with
  `on: 'next_week'` and `team in ['engineering']`.
- **"Who reports to Marco?"** → `unavailable: people`: "I can't see reporting
  lines here: your company doesn't use People in Kithena." (Time Off's
  managers are for time off questions; it does not offer a directory.)

### 7.6 A question nobody can answer

- **"What's the weather in Madrid?"** → `unclear`, with the model's one-sentence
  reply, or the fixed one: "I'm not sure I followed that. I can help with
  questions about your people and their time off."
- **"What's Marco's salary?"** → salary is `aiEligible: false`, so it is not in
  People's catalogue, and the AI gateway refuses a prompt that names a denied
  field's label (`AI_FIELD_NAMED`). Today's sentence: "That question touches
  information I'm not allowed to see, so I can't help with it here. You'll find
  it in People."
- **"Who is likely to quit?"** → refused before the model, as People's smart
  search refuses it (`domain/assistant/clarify.ts`): "Kithena doesn't predict
  what people will do."

### 7.7 Someone who may only see "Away"

Adam, an employee, asks **"Who is on sick leave today?"**

1. Masking makes it _"Who is on L1 today?"_; plan: `timeoff.away`, `leave_type
in [L1]`, answer `list`.
2. Time Off, as Adam: his teammates' sick days are `off_only`, so Adam's sight
   of them is `teammate`, never `type`. A type filter matches only absences
   whose type the asker may see. Result: no rows, total 0.
3. **The response is byte-identical whether two teammates are off sick or
   nobody is.** It carries no "withheld" count, no "some absences are hidden",
   nothing that varies with the data Adam may not see. This is an acceptance
   test on Time Off's capability (AST-023), not a property of the template.
4. Answer: "Nobody you can see the leave type of is on sick leave today.
   Teammates' sick and parental leave shows to you only as Away." The second
   sentence is fixed text about the rule, said whenever the asker is not HR and
   the filter names a private type; it is the same sentence every day.

**The plan cannot leak the type either.** The model never sees a value, so it
cannot order steps to infer one. The only way a leave type reaches the
assistant is in a Time Off row where Time Off decided the asker sees it.

### 7.8 HR asks about private leave in a channel

Ada mentions `@Kithena who is on sick leave today?` in `#people-team`.

The plan is a list filtered by a private leave type. In a chat app the
assistant never names the people on a private leave type (§11.4), so the
answer is the count and a link to the place that already shows it to whoever
may see it: "5 people are on sick leave today. I don't name people on sick or
parental leave in Slack — see who in Time Off: https://acme.app.kithena.com/time-off/calendar/month?day=2026-10-06&types=sick".
It is ephemeral, so only Ada sees even the count.

### 7.9 A module that does not answer

Time Off is restarting during a deploy when Marco asks "Who in Engineering is
off next week?". s1 succeeds; s2 times out after 4 seconds. A failed step fails
every step that depends on it, and the answer is never built from a partial
join: "I couldn't reach Time Off just now, so I can't say who is away. Try
again in a minute." A People-only question at the same moment is unaffected.

---

## 8. The capability contract

### 8.1 What a capability is

A named, versioned, read-only query a module serves to the assistant, defined
once in Zod in `packages/contracts/src/assistant/<module>.ts`:

```ts
export const TimeOffAway = capability({
  name: 'timeoff.away',
  version: 1,
  module: 'timeoff',
  about: 'People away on leave on a date or over a range.',
  accepts: { filters: ['leave_type', 'team'], on: 'required', name: true, within: true },
  groups: ['team', 'location'],
  output: 'people',
  yields: { team: 'people.find', 'timeoff.managers': 'people.managers' },
});
```

- **`name`** is `<module>.<verb>`; the module part is a `ModuleKey`.
- **`about`** is one plain sentence the model is shown. Static, in contracts,
  so it is reviewed like code and covered by the eval set.
- **`accepts`** declares which of the shared inputs (§8.3) it takes. Field
  keys are not listed here: they are per tenant and per asker, and come from
  the runtime catalogue (§8.5).
- **`groups`** are the keys its rows may be grouped by ("how many off today,
  by team").
- **`output`** is one of the shared result kinds (§8.3).
- **`yields`** names what gives way when another module is present (§8.4).

### 8.2 Classification

Every field of every input and output schema carries a classification policy,
as every contract field does, and `just codegen` walks them. Today the walk
covers events only (`tools/codegen/src/cli.ts` walks `allEvents`); AST-005
adds `allCapabilities`, so the capability outputs reach the generated Pino
redaction paths and the AI gateway deny list
(`packages/telemetry/src/generated/`), and an unclassified capability field
fails the build like an unclassified event field.

The one field that needs care: a Time Off row's leave type ties a person to a
kind of absence, which for sick or parental leave is health data. On the
capability output it is classified `asSpecialCategory('health')` whatever the
type — conservative, because the schema cannot know which type a row holds.
That puts it in the redaction paths (never logged) and the AI deny list (a
second lock: a prompt carrying it is refused, though no prompt is built after
execution, §11.2). `TeammateRequestView` in `packages/contracts/src/timeoff/request.ts`
registers `leaveTypeKey` as public, because there it is a calendar entry the
asker may already see; the capability row is a different contract and gets
its own policy.

### 8.3 Shared shapes

So that the assistant can validate any module's plan steps without knowing
the module, inputs and outputs are built from a few shared shapes in
`packages/contracts/src/assistant/capability.ts`:

**Inputs** (each optional, used only where `accepts` says):

| Input       | Shape                                      | Notes                                                                                                        |
| ----------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `filters`   | `{ key, op, values }[]`, ≤ 10, values ≤ 20 | `op` from People's set: `is`, `in`, `not_in`, `contains`, `before`, `after`, `between`, `empty`, `not_empty` |
| `match`     | `'all' \| 'any'`                           |                                                                                                              |
| `on`        | a date reference or `{ from, to }` of them | Resolved by the assistant to calendar dates before the call (§9.4)                                           |
| `name`      | a name as typed, or `@me`                  | Resolved by the module, as the asker may search; never by the model                                          |
| `sort`      | `{ key, direction }`                       | A field or a metric the catalogue offers                                                                     |
| `limit`     | 0–25                                       | Set by the assistant, not the model (§9.3)                                                                   |
| `groupBy`   | a declared group key                       |                                                                                                              |
| `personIds` | `PersonId[]`, ≤ 5,000                      | **Set by the assistant only**, from the step's `within`. A plan that writes it is refused                    |

**Outputs** (`output` picks one):

| Kind        | Shape                                                                                                                      | Used by                               |
| ----------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| `people`    | `{ rows: { personId, name, title?, detail?, groups }[], ids?, total, scope: 'everyone' \| 'visible', described, notes[] }` | find, away, managers, balances        |
| `profile`   | `{ personId, name, title?, manager?, hireDate?, email?, self }`                                                            | `people.person`                       |
| `items`     | `{ items: { name, label }[], total }`                                                                                      | `people.approvals`, `timeoff.pending` |
| `ambiguous` | `{ name, candidates: { personId, name, title? }[] }`                                                                       | Any capability taking `name`          |
| `not_found` | `{ name }` or `{ self: true }` (the asker has no record)                                                                   | Any capability taking `name`          |

`ids` is every matching `personId` (≤ 5,000), returned only when the
assistant asks for it because a later step needs it. `detail` is a module's
own short, deterministic text for a row (Time Off: "Mon 12 to Wed 14 ·
Vacation", or "· Away" where the type is private or not visible). `notes` are a
module's deterministic sentences about the result ("Tuesday 6 October is a
public holiday in Madrid."). `described` is the module's phrase for what the
step selected.

A future module whose results are people — Performance's "whose review is
due", Documents' "whose permit expires" — fits these shapes and needs no
change to the assistant.

### 8.4 Yielding

When two modules can answer the same thing, the owner wins. People owns the
organisation, so where People is present, Time Off's `team` filter yields to
`people.find` and `timeoff.managers` yields to `people.managers`; the
assistant drops yielded entries from the catalogue before the model sees it.
Where People is absent, nothing yields and Time Off's own projection answers.
This is the catalogue's version of `enrichedBy: ['people']` in Time Off's
manifest: present means richer behaviour, absent means it still works.

### 8.5 The runtime catalogue

`GET /internal/capabilities` on each module, as the asker, returns:

```ts
{
  module: 'people',
  serves: [{ name: 'people.find', version: 1 }, …],
  fields: { 'people.find': [{ key, label, kind, options: [{ value, label }] }] },
  metrics: [{ key, label }],          // People's orders (domain/person/metrics.ts)
  denied: [{ key, labels: [] }],      // this tenant's not-for-AI keys and words
}
```

- **People's** fields are `filterFields` then `forModel` — exactly what smart
  search shows its model today: the asker's filterable fields, options only
  where they are configuration and the field is `aiEligible`, plus the
  metrics this asker may order by (`metricsFor`). Never a record's value.
- **Time Off's** are `leave_type` (each type's key and name; private types
  marked, §12.2), `team` (from the projection) and `location`.
- **`denied`** feeds the assistant's AI gateway registry for this tenant
  (§12.3): People's tenant-defined `aiEligible: false` attributes, Time Off's
  fixed list from `infrastructure/assist/gateway.ts`.

### 8.6 Versioning and registration

- A capability's `version` is a major version. Adding an optional input or an
  output field is not a new version. Removing or changing one is: the module
  serves both versions until the assistant has moved, then drops the old —
  expand-contract, as migrations are.
- The assistant pins the versions it was built against (from contracts). A
  module serving only a different major is treated as absent for that
  capability and logged; the question degrades rather than fails.
- **A new module registers** by adding `packages/contracts/src/assistant/<module>.ts`
  to `allCapabilities`, serving `/internal/capabilities` and its routes, and
  being given `<MODULE>_URL` and `ASSISTANT_<MODULE>_TOKEN` in the assistant's
  environment. If its results fit the shared shapes, the assistant's code does
  not change; the eval set gains its questions.

---

## 9. The plan language

### 9.1 Shape

`packages/contracts/src/assistant/plan.ts`, read with `z.strictObject`
throughout:

```ts
type Plan =
  | { kind: 'plan'; steps: Step[]; answer: Answer; say?: string }
  | { kind: 'unclear'; reply: string }
  | { kind: 'unavailable'; module: ModuleKey };

type Step = {
  id: 's1' | 's2' | 's3' | 's4';
  capability: string; // a name the catalogue offered
  input: Record<string, unknown>; // read against that capability's input schema
  within?: StepId; // narrow to the people an earlier step found
};

type Answer =
  | { kind: 'count'; step: StepId; by?: string } // by: a group the step's capability declares
  | { kind: 'list'; step: StepId }
  | { kind: 'one'; step: StepId | StepId[] }; // profile, items, ambiguous, not_found; several only for items
```

### 9.2 Validation (domain, pure, refusal is whole)

A plan is refused, and the asker told "I'm not sure I followed that…", when:

- it is not exactly this shape, or carries a key this file does not expect;
- a step names a capability the catalogue did not offer (not entitled, yielded,
  or a version not served);
- a step's input fails that capability's schema, uses an input its `accepts`
  does not list, or writes `personIds` or `limit`;
- a filter names a field not in that capability's runtime fields, an operator
  the field's kind does not take, or an option that is neither a value nor a
  label of that field (a label is read as its value, as People's `checked()`
  does);
- `within` names a step that is not earlier, the steps are more than four, or
  two share an id;
- the answer names a step that does not exist, or `by` is not a group the
  step's capability declares;
- `say` contains a digit, markup or any placeholder but `{n}` (it is dropped,
  not the plan: People's `saying()` rule).

Each module validates its input again against its own rules when called.
Two locks; the module's is the one that counts.

### 9.3 Limits

| Limit                                | Value   | Why                                                                      |
| ------------------------------------ | ------- | ------------------------------------------------------------------------ |
| Steps                                | 4       | Every example needs at most 2; four leaves room without inviting loops   |
| Filters per step / values per filter | 10 / 20 | People's `Intent` limits                                                 |
| Names listed in an answer            | 25      | People's limit; "the directory has the rest" beyond it                   |
| `personIds` passed to a later step   | 5,000   | One request body; a broader intermediate result is answered as too broad |
| Question length                      | 500     | People's chat route's limit                                              |

The assistant, not the model, sets each call's `limit`: 0 for a step whose
answer is a count, 25 for the step a list answers, and "ids only" for a step
another step is `within`. When an intermediate step's total exceeds 5,000 the
answer says the question is too broad to join and suggests narrowing it; it
never joins on a truncated list.

### 9.4 Dates

The model writes either a calendar date (`2026-10-12`) or a reference:
`today`, `tomorrow`, `yesterday`, `this_week`, `next_week`, `last_week`,
`this_month`, `next_month`, `last_month`, alone or as `{ from, to }`. A
period stands for its whole range; weeks run Monday to Sunday. The assistant
resolves references in **the asker's time zone** (the account's, from
identity; UTC if it has none, and the answer then says "UTC") with the
injected `Clock`, never `new Date()`. The model is told today's date in words;
it is never trusted to do date arithmetic, and the answer always says the
dates it used ("next week (12–18 October)"), so a misreading is visible.

People's `ask` today tells the model the UTC date (`deps.clock.instant().slice(0, 10)`),
which is a day out for a Madrid manager asking at 00:30. The assistant fixes
that for Slack; People's own screens are unchanged.

### 9.5 Joins

`within` is the only join. The assistant passes the earlier step's `ids` as
the later step's `personIds`, and the module restricts its own query to them,
**still as the asker**. The key is `personId`: People's identifier, which Time
Off's projection holds for every member People announced
(`people.person.hired`), and Time Off's own for members an import created when
People is absent. In a company with both, an imported member People does not
know simply never meets a People step; the intersection is correct either way.
Independent steps (no `within` between them) run in parallel.

### 9.6 Counting

A count is the final step's `total`, computed by the module over exactly the
people the asker may see and, where there is a `within`, exactly the
intersection. `by` groups the final step's rows (the assistant asks for up to
5,000) by the group key and counts each group in the assistant's domain code.
Distinctness is the module's: `people.managers` returns each manager once.

---

## 10. Execution and authorization

### 10.1 Resolving the asker

`POST /api/internal/tenants/<tenantId>/assistant/asker` on identity, with
`ASSISTANT_IDENTITY_TOKEN`, body `{ email }`:

- **200** `{ accountId, timeZone, slug, entitlements }` for exactly one active
  account in that tenant with that work email. `entitlements` is the recorded
  list, else the deployment's — the same rule identity uses when it mints `ent`
  (`platform/identity/src/token/application/mint-token.ts`).
- **404** for none, several, or an account whose access has ended. The asker
  is told, as today, "I could not find you in Kithena. Ask your HR team to
  check that your Slack email is your work email there." — words that do not
  say which.

Cached 60 seconds per (tenant, email), so a burst of questions is one call; an
ended access takes effect within a minute. Identity runs on Vercel
(`docs/environments.md`, "Identity, on Vercel") and the call goes over
`IDENTITY_URL`, as People's do.

### 10.2 Calling a module as the asker

Every capability call is:

```
POST {MODULE_URL}/internal/capabilities/{name}
x-internal-token:     ASSISTANT_<MODULE>_TOKEN
x-kithena-principal:  {"userId":…,"tenantId":…,"entitlements":[…],"impersonatedBy":null,"viewedBy":null}
x-correlation-id:     <one per question>
```

The principal has the shape the router forwards (`apps/gateway/config.yaml`),
so each module's existing caller code resolves it: People finds the person and
roles and its recorded entitlements; Time Off checks `module.timeoff`, finds
the member in its projection, and refuses support and view-as sessions as it
does today (`services/timeoff/src/http/caller.ts`).

**The assistant's token is not the router's.** A module accepts
`ASSISTANT_<MODULE>_TOKEN` on `/internal/capabilities` and `/internal/capabilities/*`
only, and runs those handlers read-only — People inside its existing
`readOnly()` (`infrastructure/unit-of-work.ts`), as it does for view-as. A
leaked assistant token reads what the assistant can read; it cannot write and
cannot reach GraphQL or REST. That is the same trust Slack's token carries
today ("ask as whoever's verified email this is"), narrowed to reads.

### 10.3 Authorization stays in the module

A capability handler is a thin route over the module's application layer: the
same use cases, the same OpenFGA checks, the same field visibility as its own
screens. People's run through `service.access.list`, `count`, `read` and
`readMany`; Time Off's through the calendar's sight rule. Nothing about who
may see what is reimplemented in a handler, and nothing is reimplemented in the
assistant.

### 10.4 Partial failure, timeouts, a sleeping VM

| Situation                                       | What the asker gets                                                                                         |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| A step fails or times out (4 s per call)        | Every step that depends on it fails too; the answer names the module: "I couldn't reach Time Off just now…" |
| A module refuses (`FORBIDDEN`, `NOT_ENTITLED`)  | The module's own message for that part, never retried under another identity                                |
| A module's catalogue fails                      | That module is left out of this question's catalogue; the model may answer `unavailable` or plan without it |
| A module answers outside its contract           | Treated as a failure (the response is parsed with the contract) and logged                                  |
| The whole question exceeds 15 s                 | "Sorry, that took too long. Try again in a moment." Calls in flight are aborted                             |
| Identity unreachable                            | "Kithena couldn't check who you are just now. Try again in a minute."                                       |
| No model configured, or the hourly budget spent | "The assistant isn't available right now." — the same as People today without a key                         |

**The VM sleeps.** Every service on the VM, Slack included, stops when it has
been idle for 30 minutes (`deploy/vm/idle-stop.sh`). A stopped VM has no Slack
connection, so a question asked then is never received; that is true today and
this PRD does not change it. What it does change: idle is measured by
authenticated `/graphql` requests in the router's log, and a Slack question
does not go through the router, so a morning of Slack questions would not keep
the VM up. The assistant logs one line per question and `idle-stop.sh` counts
those as activity (AST-028). A container that is restarting (a deploy) is a
step failure as above.

---

## 11. Writing the answer

### 11.1 Templates, from computed facts

The answer is written by the assistant's domain code from the results: the
final step's total or rows, every step's `described`, the resolved dates,
`scope`, the modules' `notes`. One template per answer kind and output kind,
with People's current sentences carried over so a People-only company reads
what it reads today:

- count: "There are 12 people whose department is Sales." / "Nobody whose
  department is Sales at the moment."
- list: "I found 12 people whose department is Sales. Here are the first 10;
  the directory has the rest." then bullets.
- grouped count: "Here's how the 40 people split by department:" then bullets.
- `scope: 'visible'`: "…people you can see…", and the fixed sentence about what
  the asker sees.
- `not_found`, `ambiguous`, `profile`, `items`: today's `ask.ts` sentences.

`understood` is the steps' `described` phrases joined: "Managers of people on
sick leave on Tuesday 6 October."

### 11.2 The model's words: one opening, written blind

The only model-written text in an answer is `say`, which the model writes in
the plan, **before anything is looked up** — People's design
(`domain/assistant/intent.ts`, `Said`). `{n}` is the one placeholder and the
assistant fills it. It is kept only when it passes People's `saying()` (plain
words, no digit, no markup, no other placeholder) and Time Off's `accept()`
number rule (`application/assist/written.ts`: every number in it must be among
the facts — and the facts it was given are none, so no number survives).
Otherwise the template's own opening stands.

**There is no second model call after execution.** Time Off's `written()`
calls a model with computed figures to phrase a line, and that is right for a
screen of numbers about one team. For the assistant, a call after execution is
the only route by which results about named people could reach a model, it
doubles the latency, and the template already says everything. If a later
phase wants richer phrasing, it uses `written()` with counts and placeholders
only — never a name, never a leave type — and keeps the template as the
fallback.

### 11.3 Never more than the asker may see

The answer is built only from what modules returned for this asker. The
assistant never adds a fact of its own about a person, never says a result
was filtered, and never says how many were hidden.

### 11.4 Private leave in a chat app

A chat app is a third party that stores messages under the company's
retention, not Kithena's. So, in any chat channel:

- **A private leave type is never written beside a name.** A row whose type is
  private (category `sick_leave` or `parental_leave`, or visibility
  `off_only`) reads "Away", whoever asks — even HR, even though Time Off told
  the assistant the type.
- **A list filtered by a private leave type is never given as names.** The
  filter itself discloses it. The answer is the count and a link to Time Off's
  calendar day, where the module shows each person to whoever may see them
  (§7.8).
- **People one step removed may be named**: the managers of people on sick
  leave, without per-manager counts.
- **Answers are only ever seen by the asker** (§5).

**A company may opt in to names in chat** (decided 2026-10-03). It is off by
default. HR switches it on in Time Off's settings ("Name people on private
leave in chat answers"), behind a warning that the names, and so health data,
are then stored by the chat provider under the company's own retention. The
switch is an audited setting change (who, when, on or off), and the assistant
reads it per question from Time Off with the catalogue, so turning it off
takes effect on the next question. With it on, the first two rules above are
lifted for that company. A row still reads "Away" to anyone whom Time Off
would not show the type, because the module's sight rule is applied before
the answer is written and the switch never widens it.

---

## 12. Privacy and GDPR

### 12.1 What the model sees

The question (masked, §12.2), today's date in words, the capabilities' `about`
sentences, field keys, labels and kinds, options only where they are
configuration and `aiEligible`, metric names, and one line per module the
company does not have. Never a value from a record, never a `personId`, never
a result. The prompt leaves through the AI gateway (`packages/telemetry/src/ai-gateway.ts`)
like every prompt in Kithena. The model is the assistant model People and Time
Off already use (`ASSISTANT_BASE_URL`, `ASSISTANT_API_KEY`, `ASSISTANT_MODEL`;
`services/people/src/infrastructure/assistant/model.ts`).

A person's name typed into a question does reach the model, as it does today
in People's `ask`: "who reports to Marco?" is a question the model must read.
The name is resolved by the module, never by the model.

### 12.2 Special-category data

Sick leave is health data (GDPR Article 9). Three rules:

1. **Masking before the prompt.** The assistant's domain replaces any phrase
   naming a private leave type — the tenant's type name ("Baja médica"), its
   key, and a short synonym list per category ("sick", "off sick", "ill",
   "maternity", "paternity", "parental") — with an opaque reference (`L1`,
   `L2`) before the prompt is built, and offers only those references, labelled
   "a leave type named in the question", in the catalogue. Non-private types
   (Vacation) are offered by name. After the plan returns, references are
   mapped back. The model can plan "people on L1" and never learns what L1 is.
2. **Refusal of the rest.** A special-category phrase that no capability offers
   as a leave type (a People-only company asked about sick leave; "who is
   pregnant?") is refused before the model, with People's sentence: "Kithena
   never searches by health or other special-category data." The list is the
   assistant's own copy of People's in `domain/assistant/clarify.ts` (a platform
   service cannot import a module; Time Off's caller rule is the precedent for
   a deliberate copy), together with its refusals of judgements and predictions.
3. **The gateway as second lock.** The planner's registry loads Time Off's
   denied words ("sick leave", "diagnosis", "due date", …) and People's
   tenant-defined denied fields from the catalogues (`denied`). A masking bug
   that let "sick leave" through is refused at the gateway, and the eval set has
   a case for it.

### 12.3 The AI gateway for the planner

A per-tenant registry (`createPolicyRegistry`, `policy-registry.ts`) loaded
from the static generated paths plus the union of every catalogue's `denied`
for that tenant, refreshed with the catalogue. No subjects are named, so the
gateway applies its conservative rule: any mention of a denied field by key or
label is refused (`AI_FIELD_NAMED`), as for People's `ask` today. An unloaded
tenant is refused outright.

### 12.4 Storage, logs, DSAR

- **Nothing at rest.** No database, no conversation history, no cache of
  results. The 60-second caches hold an account id, a zone, a slug, a
  module list and catalogues (names of fields and options), in memory.
- **Logs never contain words or values.** Per question: tenant, channel,
  correlation id, outcome code, the capability names called, durations, and
  the plan's shape (step count, answer kind). Never the question, the plan's
  filters, a name, a `personId`, a count, or a leave type. Slack already
  refuses to log words (`platform/slack/src/main.ts`: "Words are never
  logged"). Capability outputs are classified, so the generated Pino redaction
  covers them if anything ever tried.
- **DSAR.** The assistant holds nothing about anybody, so it adds nothing to a
  subject access package. Each module's DSAR export already covers the data a
  capability reads. Slack messages are in the company's Slack workspace, under
  its retention, outside Kithena's package, and the privacy notice says so.
- **Audit.** A capability read is audited by the module exactly as the same
  read on its own screen is; the assistant adds no audit trail of its own.

---

## 13. Telemetry and evaluation

### 13.1 Telemetry

OpenTelemetry spans per question (`startTelemetry('kithena-assistant')`), with
child spans for identity, each catalogue, the model and each step, carrying the
correlation id the modules log too. Counters: questions by channel and outcome
(`answered`, `unclear`, `unavailable`, `refused`, `failed`, `too_broad`), plan
refusals by reason, step failures by capability and reason. Histograms:
end-to-end, model and per-capability durations.

### 13.2 Evaluation

`platform/assistant/eval/cases.ts`: a fixed set, starting at 40 questions,
each with a catalogue fixture and the expected plan.

| Group          | Examples                                                                                                                 |
| -------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Time Off       | "how many people are off today", "who's off tomorrow", "anyone off on Friday", "off next week by team"                   |
| Joins          | "managers of people on sick leave today", "who in Engineering is off next week", "who in Marco's team is away this week" |
| People parity  | Every intent today's `ask` handles: lists, counts, counts by a field, a person, reports, approvals, `@me`                |
| Absent modules | Time Off questions with no Time Off (`unavailable`); People questions with no People                                     |
| Refusals       | Salary (gateway), "who is pregnant" (special), "who will quit" (prediction), weather (`unclear`)                         |
| Safety         | Never a capability not offered; never `personIds`; never a digit in `say`; masked words never in the prompt              |

**The gate.** `just assistant-eval --record` runs the set against the real
model (needs `ASSISTANT_API_KEY`) and writes `eval/recorded.json`: each case's
model output, the model id, and a hash of the instruction and the catalogue
fixtures. The CI test replays the recording through the real validator and
fails when:

- the hash differs from the current instruction and fixtures (the prompt
  changed and nobody re-recorded);
- fewer than 90 % of cases produce exactly the expected plan (after
  normalising order of filters and values);
- any safety case fails.

CI never calls a model (the standalone suites already mock `fetch` and fail on
anything unmocked), so the gate costs nothing per run. A prompt change is a
re-record in the same pull request, and the accuracy it reaches is in the
diff for the reviewer to see.

---

## 14. Performance budgets

Slack's three-second acknowledgement is already handled: Slack acks at once and
posts the answer later (`platform/slack/src/main.ts`). The budgets are for the
answer.

| Stage                 | Budget                   | How                                                 |
| --------------------- | ------------------------ | --------------------------------------------------- |
| Identity              | ≤ 300 ms, usually cached | 60 s cache per (tenant, email)                      |
| Catalogues            | ≤ 300 ms, in parallel    | 60 s cache per (tenant, account, module)            |
| Model                 | timeout 8 s, p50 ~1.5 s  | Smart search's 8 s; JSON mode, low reasoning effort |
| Each capability call  | timeout 4 s              | Independent steps in parallel                       |
| Whole question        | deadline 15 s            | Slack's own timeout to the assistant: 20 s          |
| End to end, p50 / p95 | ≤ 4 s / ≤ 10 s           | §3                                                  |

Time Off's away query checks the asker's sight only for members with an
absence in the range — `calendarIn` checks every member, because a calendar
draws everybody — so "who's off today" in a company of 1,000 is a handful of
OpenFGA checks, not a thousand.

At most 8 questions run at once per process; more queue. Hourly budget per
company, `ASSISTANT_PLANS_PER_HOUR` (default 120, in memory), as smart search
has `SEARCH_PLANS_PER_HOUR`.

---

## 15. Deployment

### 15.1 One more service on the VM

The assistant runs on the VM beside Slack, People and Time Off, deployed like
Slack: its own image (`platform/assistant/Dockerfile`,
`ghcr.io/<owner>/kithena-assistant`), `deploy.sh <env> assistant <image>`
before `slack`, a Compose service `assistant` on `http://assistant:4104`, a
`/health` check. No database, no Kafka, no role in Postgres.

### 15.2 Memory budget

Added to `docs/environments.md`, "Memory budget", the way `slack` and
`timeoff` were:

| Container | Limit      | Knobs                                                    |
| --------- | ---------- | -------------------------------------------------------- |
| assistant | **160 MB** | `NODE_OPTIONS=--max-old-space-size=96`; not yet measured |

The limits go from **3.6 GB** to **3.76 GB** on the 4 GB `c7i-flex.large`,
with the 4 GB swap as headroom. Measure it under the light load after its
first deploy and lower the limit to what it needs. If the sum stops fitting,
`m7i-flex.large` is the step up `docs/environments.md` already names; the
assistant is the cheapest container to fold into Slack's process instead, and
that is the fallback before paying for a larger instance.

### 15.3 Settings and secrets, one token per pair

| Setting                     | Where it is set                       | Holds                                                                                                    |
| --------------------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `SLACK_ASSISTANT_TOKEN`     | `slack.env` and `assistant.env`       | Slack → assistant. Random, 32+ bytes                                                                     |
| `ASSISTANT_PEOPLE_TOKEN`    | `assistant.env` and `people.env`      | Assistant → People's capability routes                                                                   |
| `ASSISTANT_TIMEOFF_TOKEN`   | `assistant.env` and `timeoff.env`     | Assistant → Time Off's capability routes                                                                 |
| `ASSISTANT_IDENTITY_TOKEN`  | `assistant.env` and identity (Vercel) | Assistant → identity's asker route                                                                       |
| `ASSISTANT_ENV`             | GitHub environment secret             | `ASSISTANT_API_KEY`, `ASSISTANT_BASE_URL`, `ASSISTANT_MODEL`, `IDENTITY_URL`, `ASSISTANT_PLANS_PER_HOUR` |
| `PEOPLE_URL`, `TIMEOFF_URL` | `compose.yaml`                        | Compose addresses, the same in every environment                                                         |
| `ASSISTANT_URL`             | `compose.yaml` (Slack's)              | `http://assistant:4104`                                                                                  |

Each token is written to both sides on every deploy, as `PEOPLE_API_TOKEN` and
`TIMEOFF_API_TOKEN` are, so the two cannot disagree. `SLACK_PEOPLE_TOKEN` stays:
People still notifies Slack and Slack's buttons still reach
`/internal/chat/act`. A future module adds `<MODULE>_URL` and
`ASSISTANT_<MODULE>_TOKEN`, nothing else.

### 15.4 Workflows

`vercel-staging.yml` and `vercel-production.yml` gain `assistant` beside
`slack` in the plan, the image build (smoke: boot and answer `/health`), the
push, the GHCR prune and the VM deploy step; `deploy-production.yml`'s plan
gains it where it lists the VM images. The VM job writes `assistant.env` and
adds the new tokens to `slack.env`, `people.env` and `timeoff.env`. Without
`ASSISTANT_ENV` the assistant starts and answers "not available", and Slack
falls back to saying so — the same optional-until-configured behaviour as
Slack itself.

### 15.5 Standalone

The assistant is not a module, so it is not in the `standalone` matrix in
`.github/workflows/ci.yml`; `just standalone` asks a question it cannot answer
of a platform service, which is why platform services live outside
`services/*`. Instead:

- **Each module's standalone suite gains its capability routes.** Time Off's,
  with People absent, must answer `timeoff.away` and `timeoff.managers`;
  People's must answer its five. A module's capabilities work with no
  assistant and no sibling.
- **The assistant's own suite** runs against fake modules: People only, Time
  Off only, both, neither, one down. It runs in the normal `test` job.

---

## 16. Migrating the Slack-to-People path

The product has not launched, so there is no compatibility window: the path
moves in one release and the old one is deleted.

1. People gains its capability routes (AST-018 to AST-021), built from the
   code that answers Slack today: `ask.ts`'s `answer()` cases become
   `people.find` (lists, counts, counts by a field), `people.person`,
   `people.reports` and `people.approvals`; `describe()`, `personLine()` and the
   `@me` resolution move with them. `people.find` takes the richer inputs of
   smart search (`DirectoryPlan`: sort by a metric, a limit, a group, a manager
   by name), validated by People's own reader in `domain/assistant/selection.ts`.
2. The assistant's templates carry `ask.ts`'s sentences, and `ask.test.ts`'s
   cases are ported to the assistant (wording) and to People's capability
   tests (authorization, ambiguity, `@me`).
3. Slack calls the assistant (AST-025).
4. People's `/internal/assistant/ask`, `answerChat`, `askFromChat` and
   `ask()`'s model call are deleted (AST-026). People keeps its own model use:
   smart search, export in words, the import's new fields. `SLACK_PEOPLE_TOKEN`
   keeps its other uses.

Deploy order in one run: People and Time Off (capabilities), then the
assistant, then Slack. Between Slack's old image stopping and its new one
starting, a question gets Slack's existing "Sorry" sentence; nothing else
breaks.

---

## 17. Scope and phasing

### Phase 1 — Slack answers across modules

Capability and plan contracts; codegen over capabilities; the assistant
(domain, application, clients, planner, eval gate, internal route); identity's
asker route; People's capabilities (`find`, `person`, `reports`, `managers`,
`approvals`); Time Off's capabilities (`away`, `managers`); Slack rerouted,
mentions answered ephemerally; People's old route deleted; deploy, memory,
secrets, idle-stop counting questions. Every example in §7 works.

### Phase 2 — more of Time Off, and follow-ups

`timeoff.balances` ("how much vacation do I have left?", "who has more than 10
days left?" — as the asker may see balances: their own, the people they
approve, HR everyone; days as decimal strings computed by Time Off's ledger
fold); `timeoff.pending` and an answer over several `items` steps ("what's
waiting for me?" across People and Time Off); follow-ups in a Slack thread or
DM (Slack keeps the last five questions per conversation in memory for 30
minutes and sends them as `earlier`, questions only).

### Phase 3 — more channels

Teams (`platform/teams`, the same `/internal/ask`, `TEAMS_ASSISTANT_TOKEN`);
the web (an `assistant` subgraph with one query, `ask(question)`, behind the
router, so the signed-in principal arrives as it does for People and Time Off,
view-as and support sessions included: People answers a view-as read-only as
always, Time Off refuses both and the answer degrades to "Time Off can't be
used while viewing as someone"); the web search box, which needs designs in
the Claude Design project before it is built.

### Later, in their own PRD

Proposals: an action someone asks for comes back as a draft in the owning
module's flow for them to confirm.

---

## 18. Risks

| Risk                                                     | Mitigation                                                                                                                                    |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| The assistant becomes a way round a module's permissions | Every call is as the asker, authorized by the module's own application layer; the assistant's token reaches read-only capability routes only  |
| A type filter or a join reveals a private leave type     | A type filter matches only absences whose type the asker sees; byte-identical responses tested; the model never sees values                   |
| Health data reaches the model                            | Masking before the prompt, refusal of the rest, Time Off's denied words loaded into the planner's gateway, eval cases for each                |
| Health data reaches Slack                                | Private types never beside a name in chat; type-filtered lists are a count and a link; answers ephemeral                                      |
| The model plans wrongly and the answer looks confident   | Strict validation; the answer states the dates and the selection it used (`understood`); 90 % eval gate with re-record on any prompt change   |
| A module changes a capability and the assistant breaks   | Versioned contracts in `packages/contracts`, both versions served during a change; a version the assistant does not know is absent, not fatal |
| A big company makes joins slow or huge                   | 5,000-id cap with an honest "too broad"; sight checked only for members with absences; 4 s per call, 15 s per question                        |
| The VM is asleep or restarting                           | Questions count as activity; a failed step fails its dependants and the answer names the module; the sleeping-VM gap is pre-existing          |
| Memory on the 4 GB VM                                    | 160 MB limit, measured after first deploy; fold into Slack's process before buying a larger instance                                          |
| Two modules answer the same thing differently            | `yields`: the owner (People for the organisation) wins where present                                                                          |

---

## 19. Dependencies

- `packages/contracts` (capability and plan schemas), `packages/telemetry`
  (AI gateway, policy registry, logger), `@kithena/domain-kit` (`Clock`,
  `Result`), `@kithena/auth-kit` (`presentsInternalToken`).
- `tools/codegen` walking capabilities.
- Identity: one internal route.
- People and Time Off: capability routes over existing use cases; People's
  `access.list` and `access.count` gain a `personIds` restriction, authorized
  exactly as the unrestricted calls.
- The assistant model already configured for People and Time Off.
- No new npm dependency.

---

## 20. Decided questions

**May a company let chat answers name people on private leave?** Yes, by its
own choice (decided 2026-10-03): a Time Off setting, off by default, switched
by HR behind a warning and audited (§11.4, AST-029a). It sends
special-category data to the chat provider under the company's retention,
which is the company's call as controller; Kithena's privacy notice says so.

---

## Appendix A. Glossary

- **Capability**: a named, versioned, read-only query a module serves to the
  assistant, typed in `packages/contracts`.
- **Catalogue**: per question and per asker, the capabilities a company's
  modules serve and the fields, options and leave types the asker may filter
  by. Names only.
- **Plan**: the model's answer: up to four capability calls and how to answer
  from them.
- **Within**: the one join: a step restricted to the people an earlier step
  found.
- **Private leave type**: category sick or parental, or visibility `off_only`.
- **Masking**: replacing a private leave type named in a question with an
  opaque reference before the prompt is built.
- **Yield**: a capability or filter giving way to the owning module's where
  that module is present.
- **Scope**: whether a result covers everyone (`everyone`) or only the people
  the asker may see (`visible`).
