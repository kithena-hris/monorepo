# Product Requirements Document: The People module

**Version**: 1.0
**Date**: 2026-09-22
**Author**: Sarah (Product Owner)
**Quality Score**: 92/100
**Status**: Draft for engineering review

---

## How to read this

**Building it?** The ordered tickets are in [`docs/people-build-plan.md`](./people-build-plan.md) ([published](https://claude.ai/code/artifact/647ccf50-72b0-43ab-bd0a-7cbdd3ce9fd0)), and the screens are [here](https://claude.ai/code/artifact/4d719b45-46cb-45da-9a0a-6b845f03332f).

This document specifies `services/people` end to end: the configurable field
registry, the person record it describes, who writes each fact, where each fact
lives, the events it emits, and the settings screen that lets an HR admin change
all of it without a deploy.

Four architectural questions were open when this was written. They are answered
here rather than left for implementation, with the reasoning in place so the
answer can be argued with:

| Question | Answer | Where |
| --- | --- | --- |
| How are custom attribute values stored? | Typed columns for the core, JSONB for tenant-defined attributes, an append-only history table for the truth | [§11](#11-storage-design) |
| What happens when a field becomes required after people exist? | Nothing blocks. The record gains a completeness state and raises a task | [§8.4](#84-when-a-field-becomes-required-later) |
| Who classifies a runtime custom attribute? | HR chooses; a System One judgment pre-fills; special-category never auto-applies | [§12](#12-classification-of-tenant-defined-attributes) |
| What does "works without the rest of the HRIS" mean in v1? | GraphQL, REST, signed webhooks and the published schema artifact in Phase 1; SCIM and mirror mode after | [§13](#13-headless-surfaces) |
| What happens when an import is missing a required field? | Core identity fields block the row; every other required field imports and shows as incomplete; an *invalid* value always blocks | [§14.4](#144-when-required-fields-are-missing) |
| How does an export handle fields the customer invented? | Columns generated from the published schema, two header rows — label and stable key — so an edited file re-imports correctly | [§15.2](#152-exporting-a-sheet-that-has-extra-attributes) |

Everything the module inherits from the repository — no cross-module imports,
Zod as the single schema source, effective dating on everything, money in minor
units, no `new Date()` in domain code — is assumed rather than restated.

---

## 1. Executive summary

Every HRIS eventually loses the same argument. It ships a fixed employee record,
a customer needs one more field, and the field arrives as a code change, a
migration, a release and six weeks. The customers who cannot wait put the value
in a "Notes" box, and a year later that box holds a diagnosis, a grievance and
another employee's name — unclassified, un-redacted, and in every export.

The People module answers that by making the shape of an employee record a
tenant-owned, versioned artifact rather than a schema we own. An HR admin defines
sections, defines attributes, marks them required or optional, says who may fill
them and who may see them, and publishes. The change takes effect immediately,
for everyone, with no deploy.

This matters beyond convenience because of what else depends on that shape. The
same registry that renders a form also produces: the validation the API enforces,
the GraphQL and REST contracts a third party integrates against, the redaction
paths in the logs, the deny list the AI gateway reads, the DSAR export manifest,
the retention schedule, and the payload of every event on Redpanda. One
definition, six derived artifacts, per the rule that already governs
`packages/contracts`.

It also has to stand alone. Kithena is a headless, module-per-service HRIS where
every module must be sellable on its own — and People is the module most likely
to be bought by a company that already has an HRIS and wants an employee data
layer with a real API, real events and real data-protection behaviour underneath
it. So People ships its own API surface, its own webhooks and its own schema
artifact, and it does not assume any Kithena screen is running in front of it.

---

## 2. Problem statement

### Current situation

`services/people` exists as a manifest, a stub subgraph and two test harnesses.
There is no person record, no schema, no domain layer. Today the only thing the
system knows about an employee is what `platform.account` holds for the sign-in
ceremony: a work email, a time zone, an employment start date, a three-part name
and a mobile number. The migrations that added the name and the mobile say
explicitly, twice, that a job title, a manager, a department, an emergency
contact and a home address belong to People and that identity holding them would
give one person two records that drift apart.

So a company can be created, a first administrator can be invited, and that
administrator can enrol a passkey and sign in — into a product with nowhere to
put an employee.

Three specific gaps follow:

1. **No employee record.** Nothing consumes `identity.account.provisioned`, so
   an account exists with no person attached to it.
2. **No configurable shape.** `people.person.hired` carries a fixed payload —
   name, work email, employment period, status, manager, org unit. Real
   customers need a national identifier in Spain, a right-to-work check date in
   the UK, a PAN in India, a collective agreement reference in Germany and a
   cost centre everywhere, and no fixed payload can hold that union.
3. **No runtime classification.** `just codegen` walks the Zod registry and
   fails on an unclassified field. That walk is static. The moment an HR admin
   creates an attribute at runtime, there is a personal-data field in the system
   that the redaction paths, the AI deny list and the DSAR manifest have never
   heard of.

### Proposed solution

A People module built in two halves that ship together:

- **The schema half.** A tenant-scoped registry of sections and attribute
  definitions, versioned and published as an immutable artifact. Configured from
  a settings screen. Every attribute carries a data type, validation, a
  requiredness rule, an ownership rule, a visibility rule and a classification
  policy.
- **The record half.** A person aggregate whose core facts are typed columns and
  whose tenant-defined facts are validated against the published schema. Every
  change is effective-dated, append-only and event-sourced into the outbox.

### Business impact

- A customer-specific field becomes a five-minute settings change instead of a
  release. That removes the single most common reason an HRIS deal stalls in
  procurement.
- Every field in the product, including the ones a customer invented this
  morning, is classified, redacted, retained and exportable by construction —
  which is what makes a GDPR answer a fact rather than a promise.
- People becomes sellable on its own to companies that keep their HRIS and want
  a governed employee data layer with events.

---

## 3. Success metrics

### Primary KPIs

| Metric | Target | How measured |
| --- | --- | --- |
| Time to add a tenant-specific field | < 5 minutes, 0 deploys | Wall clock from opening the settings screen to the field appearing on a profile, measured in the acceptance suite and on a real tenant |
| Required-field completeness | ≥ 95% of active employees complete within 30 days of a schema publish | `people.person.profile_completed` and `profile_incomplete` counts per tenant |
| Completion turnaround | Median < 3 days from a field becoming required to the record being complete | Time between `profile_incomplete` and `profile_completed` for the same person and attribute set |
| Classification correctness | ≥ 98% agreement on a sampled audit; **zero** special-category attributes marked AI-eligible | Quarterly audit of `people.attribute_definition` against a human review; the second number is a hard gate, not a target |
| Person read latency | P95 < 120 ms for a full profile; < 300 ms for a 50-row directory page | Subgraph traces |
| Schema publish propagation | P95 < 5 s from publish to webhook delivered and REST reflecting the new version | Webhook delivery telemetry |
| Standalone boot | `just standalone people` green on every CI run | CI matrix |
| DSAR export | < 60 s, containing 100% of exportable attributes including tenant-defined ones | Integration test asserting the manifest against the live registry |
| Import success | ≥ 95% of rows import on the first attempt for a well-formed file; every blocked row names its cell | Import reports, sampled per tenant |
| Import turnaround | A 5,000-row migration from upload to committed in < 10 minutes including the dry run | Wall clock on the import job |
| Export round-trip | An export edited in Excel and re-imported changes only what was edited — zero unintended writes | Contract test over export → edit → import |
| Analytics freshness | Snapshot-backed charts no more than 24 h stale; the staleness is stated on the card | Snapshot job telemetry |
| Mobile completion | ≥ 80% of onboarding completions happen on a phone without a desk session | Session telemetry by pointer type |

### Secondary

- Onboarding form completion rate > 90% without HR intervention.
- Fewer than 5% of custom attributes created with the `long_text` type after the
  first quarter — a high number means people are still using a Notes box and the
  type catalogue is missing something.
- Zero tenant-defined attributes reaching a log or a model prompt without a
  policy. Enforced, then measured to prove the enforcement works.

### Validation

Measured per tenant from day one, reviewed at 30 and 90 days after the first
production tenant. The classification audit runs quarterly regardless of volume.

---

## 4. Personas

### Primary: Priya — HR operations lead

- **Role**: owns the employee data set at a 200–2,000 person company.
- **Goals**: get every employee record complete and correct; answer a payroll or
  audit question without a spreadsheet; add the field the works council asked
  for without raising a ticket.
- **Pain points**: the current system's fields are almost right; every exception
  becomes a Notes box; she cannot tell which records are missing what.
- **Technical level**: intermediate. Comfortable with a form builder, not with
  JSON, and should never see the word "schema".

### Primary: Adam — employee

- **Role**: anybody with an account.
- **Goals**: get through first-day data entry once; keep an address and an
  emergency contact current; see who his colleagues are.
- **Pain points**: being asked for the same information three times; being asked
  for a bank account on a page that does not look like it belongs to his
  employer; not knowing who can see what he typed.
- **Technical level**: novice. Will do this on a phone, once, and not come back
  unless chased.

### Secondary: Marco — line manager

- **Role**: manages 4–12 people.
- **Goals**: see his team's working pattern, time zone, location and job title;
  see nothing else.
- **Pain points**: managers in most systems can see salary and date of birth by
  accident. He does not want that and should not have it.

### Secondary: Ines — CX operator, back office

- **Role**: creates customers, invites the first administrator, fixes things.
- **Goals**: get a new customer to a usable state; never see employee personal
  data while doing it.
- **Pain points**: the first employee is a chicken-and-egg problem in every HRIS
  she has operated.

### Secondary: a third-party integrator

- **Role**: builds against Kithena for a customer, or is the customer's own
  platform team.
- **Goals**: read the schema, read and write people, subscribe to changes, and
  never poll.
- **Pain points**: HRIS APIs that expose a fixed record and drop custom fields
  on the floor; webhooks with no signature, no ordering and no replay.

---

## 5. Where the boundary sits

This is the first thing to fix in a reader's head, because the two most common
implementation mistakes both come from getting it wrong.

`platform/identity` already holds five facts about a person. The migrations
justify each one the same way: the sign-in ceremony and the enrolment rules need
them, and neither can wait for a module the customer may not have bought.

| Fact | Identity holds it because | People's relationship to it |
| --- | --- | --- |
| `work_email` | It routes the invitation and names the account | **Projection.** Read-only in People. Changes go through identity's API |
| `time_zone` | Decides when a start date and a last working day fall | **Projection**, with People as the editing surface via identity's API |
| `employment_start` | Gates enrolment — a hire entered three weeks early must not be able to log in | **People is the source of record.** Identity holds a cached copy and corrects it from People's events |
| `given_name` / `family_name` / `preferred_name` | Rendered in the WebAuthn prompt; `ada@acme.example` is a poor way to ask somebody to confirm an account is theirs | **People is the source of record once a person exists.** Identity holds a copy and corrects it from People's events |
| `mobile` | A second channel for HR-mediated recovery. Never a sign-in factor | **People is the source of record once a person exists.** Same correction path |

The rule this produces:

> **Identity owns the facts that must exist before People does. People owns them
> afterwards. The copies are reconciled by events in one direction only —
> People publishes, identity consumes.**

That direction matters. A tenant with no People module keeps identity's copies
as the only truth, which is exactly what `requiresPeopleSource` is for. A tenant
with People gets one editing surface and one source of record, and the two rows
cannot drift because only one of them is ever written by a human.

Everything else about a person — job, org, contract, pay, addresses, emergency
contacts, documents, every tenant-defined attribute — is People's alone, and
identity never sees it.

### 5.1 The event identity is missing

Identity currently captures a name and a mobile during enrolment and publishes
no event saying so. People needs to know, and polling `platform.account` across
a service boundary is not a thing this system does.

**New contract, owned by identity**: `identity.account.profile_captured` v1.

```
accountId       AccountId
identityId      IdentityId
name            { given, family, preferred | null }   asIdentity()
timeZone        string                                 asInternal()
mobilePresent   boolean                                asInternal()
capturedAt      Instant
```

`mobilePresent` rather than the number. The number is contact data that People
will ask for itself under its own classification, and an event that carries a
phone number to a consumer that may not need it is a phone number in one more
log. The name is carried because People genuinely needs it and it is the same
value People would otherwise ask for twice on the same morning.

---

## 6. The data model

### 6.1 Three objects, and what each is for

```
people.section                  A titled group of attributes. Ordered. Tenant-owned.
people.attribute_definition     One field. Type, validation, requiredness,
                                ownership, visibility, classification.
people.schema_version           An immutable published snapshot of the above.
                                What a form renders, an API validates and a
                                third party integrates against.
```

Publishing is what makes a draft real. Editing a definition does not change
behaviour until a version is published, which is the only way to give an
integrator a stable contract and an HR admin a safe place to experiment.

Versions are append-only. "Rolling back" publishes the previous version's
content as a new version, for the same reason there are no down migrations.

### 6.2 Attribute definition

Every field on a definition, and why it exists:

| Field | Type | Purpose |
| --- | --- | --- |
| `key` | slug, immutable | Stable identifier in payloads, exports and integrations. Chosen once. A rename is a new attribute plus a migration of values, offered as an explicit action, never an in-place edit |
| `label` | localized string map | What a human sees. Localized because the product is; the key never is |
| `description` | localized string, nullable | Help text under the field. Worth more than most validation |
| `sectionKey` | ref | Which section it appears in |
| `order` | int | Position within the section |
| `dataType` | enum | See §6.4 |
| `typeConfig` | JSON, type-discriminated | Options for a select, min/max for a number, currency for money, country for a national identifier, accepted MIME types for a document |
| `cardinality` | `single` \| `repeating` | A repeating attribute is a group — emergency contacts, education, equity grants |
| `requiredness` | rule | See §6.5 |
| `ownership` | set of writer roles | Who may write it: `employee`, `manager`, `hr`, `finance`, `system`, `external` |
| `visibility` | rule | Who may read it: `self`, `manager`, `manager_chain`, `hr`, `finance`, `admin`, `directory` |
| `collectAt` | enum | `signup`, `enrolment`, `onboarding`, `hr_only`, `anytime` — which moment asks for it |
| `classification` | `FieldPolicy` | The existing contract shape: classification, piiKind, exportable, aiEligible, retention |
| `effectiveDated` | boolean | Whether a change to this value is a dated fact (salary, job title) or a correction (a typo in a phone number) |
| `unique` | `none` \| `tenant` \| `legal_entity` | Employee number, national identifier, work email |
| `encrypted` | boolean | Forced true for `piiKind: 'financial'` and for national identifiers. Value lives in `people.person_secret`, never in JSONB and never in an event |
| `indexed` | boolean | Promotes the attribute to a generated column so it can be filtered and sorted at directory scale |
| `includeInDirectory` | boolean | Appears in the searchable employee directory |
| `includeInEvents` | boolean | Whether the value — not just the key — rides on the Kafka payload. Defaults to false for anything `confidential` or above, and cannot be set true for special-category data |
| `deprecatedAt` | timestamp, nullable | Hidden from forms, still exported, still in history. The honest alternative to deleting a field somebody's integration reads |
| `origin` | `core` \| `country_pack` \| `tenant` | Whether Kithena ships it, a country pack ships it, or the customer invented it |

**Core attributes cannot be deleted, and their classification cannot be
loosened.** A tenant may relabel `hire_date`, may not make it optional, and may
not mark a national identifier AI-eligible. The registry enforces a floor; the
tenant configures above it.

### 6.3 Sections

Shipped defaults, all of which a tenant may rename, reorder, extend or hide.
Sections are presentation *and* a permission grouping — a visibility rule set on
a section is the default for every attribute in it, which is how Priya avoids
setting twenty rules by hand and how Marco avoids seeing a salary by accident.

| Section | Default visibility | Default ownership | Notes |
| --- | --- | --- | --- |
| Personal information | self, hr | employee, hr | Name, preferred name, pronouns, date of birth, nationality, personal contact, home address, photo |
| Identification & right to work | hr | hr, employee | National identifiers, passport, visa, permit expiry, right-to-work check. Heavily country-dependent |
| Emergency contacts | self, hr | employee | Repeating. Nobody else needs these, including the manager |
| HR information | self, manager, hr | hr | Employee number, status, hire date, legal entity, department, location, manager, job title, level |
| Employment terms | self, hr | hr | Contract type and dates, working pattern, FTE, probation, notice, collective agreement, work model |
| Compensation & finance | self, finance, hr | finance, hr, employee | Salary, pay frequency, variable pay, bank account, tax and social security, pension. Bank details are employee-owned and finance-readable |
| Public profile | directory | employee | Display name, photo, title, department, work contact, time zone, bio, skills, languages |
| Onboarding & offboarding | hr, manager | hr | Buddy, checklist state, equipment, termination fields |
| Education & experience | self, hr | employee | Repeating. Degrees, certifications with expiry, prior employment |
| Assets & access | self, manager, hr | system, hr | Devices, licences, building access |
| Health & safety | hr | hr, employee | Occupational health, accommodations, dietary requirements. Article 9 throughout |
| Diversity & voluntary self-ID | **nobody** | employee | Special category, voluntary, answerable only in aggregate. See §6.7 |
| *(tenant-defined)* | tenant's choice | tenant's choice | |

A full inventory of the attributes each section ships with is in
[Appendix A](#appendix-a-default-attribute-inventory).

### 6.4 Data types

The type catalogue is deliberately long, because every type missing from it
becomes a `long_text` field holding something nobody can validate, index or
classify.

`text`, `long_text`, `number`, `decimal`, `percentage`, `money`, `boolean`,
`date`, `datetime`, `duration`, `select`, `multi_select`, `tags`, `email`,
`phone`, `url`, `country`, `currency`, `language`, `time_zone`, `address`,
`national_id`, `bank_account`, `person_ref`, `org_unit_ref`,
`legal_entity_ref`, `document_ref`, `image`.

Four of these carry country-specific behaviour and are not generic strings:

- `address` reuses `PostalAddress` and `checkAddress` from
  `packages/contracts/src/address.ts` — the country decides the subdivision
  label, the postcode label and the postcode rule, and Spain's province/postcode
  cross-check already exists there.
- `national_id` takes a country in `typeConfig` and validates against that
  country's rule: NIF/NIE checksum in Spain, National Insurance shape in the UK,
  PAN in India. An unknown country validates on length only and says so.
- `bank_account` takes a country and validates IBAN (mod-97) or the local
  equivalent. Always encrypted, always financial, never in an event.
- `money` is `Money` — minor units and a currency, never a float, per the rule
  that already exists.

`document_ref` points at the Documents module when it exists and at object
storage when it does not. People stores a reference and never bytes.

### 6.5 Requiredness

Three states, because two are not enough for a multi-country employer:

```
never
always
conditional  —  required when a predicate over the person holds
```

The predicate is a closed, non-Turing-complete expression over a small set of
person facts that People itself owns:

```
legalEntity in [...]         country in [...]
employmentType in [...]      workModel in [...]
status in [...]              anotherAttribute is set / equals
```

Closed on purpose. A predicate language a customer can write loops in is a
customer support incident waiting for a slow afternoon, and every real
requirement in HR is a country, a legal entity, a contract type, or another
field being present. A predicate that cannot be evaluated — because it names an
archived attribute, say — is treated as *not required* and raises an operational
alert. Failing towards "required" would lock a tenant out of their own records
over a configuration typo.

Each requiredness rule additionally carries:

- `requiredFrom` — a calendar date. Required from the 1st, not required
  retroactively for a record completed on the 30th of the month before.
- `appliesTo` — `new_records` or `all_records`. Defaults to `all_records`; see
  §8.4 for what that actually does, which is not "block".

### 6.6 Visibility and ownership

**Ownership** is who may write. **Visibility** is who may read. They are
separate rules because they genuinely differ: an employee owns their bank
account and cannot see their own salary band; HR can see a national identifier
and should not be the one typing it.

Both are enforced in the domain and application layers, never only in a
resolver — GraphQL is one transport of four, and a rule in a resolver is a rule
that leaks through REST, SCIM, webhooks and workers. The resolver maps a domain
refusal to a GraphQL error and nothing more.

Authorization uses OpenFGA, which the stack already commits to. The relations
that matter:

```
person:<id>  self          user:<account>
person:<id>  manager       user:<account>          (direct)
person:<id>  manager_chain user:<account>          (transitive, via org unit)
tenant:<id>  hr            user:<account>
tenant:<id>  finance       user:<account>
tenant:<id>  people_admin  user:<account>          (may edit the schema)
```

Field-level checks are a set intersection between the attribute's visibility
rule and the viewer's relations, computed once per request and cached for the
life of that request. A profile read is one FGA check for the person plus a
local intersection per attribute, not one check per field.

**A redaction is invisible, not empty.** A field the viewer may not read is
absent from the response, not present-and-null, because present-and-null tells a
manager that a field exists and has a value — which for a diversity self-ID
field is the disclosure itself.

### 6.7 Voluntary self-identification

Diversity data is the section most likely to be built carelessly, so its rules
are explicit and are not tenant-configurable:

- Always employee-owned. HR may never write it.
- Always `special-category`, never `aiEligible`, never `includeInEvents`.
- Visible to nobody as an individual value, including HR and including the
  tenant's own administrators.
- Answerable only through aggregate reporting, with a minimum cohort size
  (default 10, tenant-raisable, never lowerable) below which the aggregate
  returns "insufficient data" rather than a number.
- Every question carries a "prefer not to say" option that is a real stored
  answer, distinct from unanswered.
- Never required. A `requiredness` of anything but `never` is refused by the
  domain.

---

## 7. Who creates what, and where it lives

The question the brief asked most directly. Read this table as: for each group of
facts, who is capable of writing it, at which moment, and which service's
database the bytes end up in.

| Fact group | Created by | At which moment | Lives in |
| --- | --- | --- | --- |
| Tenant, slug, branding, auth policy | CX operator | Back-office company creation | `platform.tenant`, `platform.tenant_auth_policy` |
| First account (work email, start date, time zone) | CX operator | Back-office invitation | `platform.account` |
| Enrolment token | Identity | Invitation | `platform.enrolment_token` (hash only) |
| Legal name, preferred name, mobile, time zone | The person | Enrolment, on the auth origin | `platform.account`, projected into People |
| Provisional person record | People, from `identity.account.provisioned` | Automatically, within the second | `people.person` |
| Schema: sections, attributes, requiredness | HR admin (`people_admin`) | Settings, any time | `people.section`, `people.attribute_definition`, `people.schema_version` |
| Country pack defaults | Kithena | Tenant creation, by legal-entity country | Same tables, `origin: 'country_pack'` |
| Personal information | The employee; HR may correct | Onboarding, then any time | `people.person`, `people.person_attribute_history` |
| Identification, right to work | HR, with employee-supplied values | Onboarding | `people.person_secret` (encrypted) plus history |
| Emergency contacts | The employee | Onboarding, then any time | `people.person` (JSONB, repeating) plus history |
| HR information | HR | Hire, then on change | Typed columns plus history |
| Employment terms | HR | Hire, then on change | Typed columns plus history |
| Salary, variable pay | HR or finance | Hire, then effective-dated changes | Typed columns, encrypted where financial, plus history |
| Bank account, tax identifiers | The employee | Onboarding | `people.person_secret` only |
| Public profile | The employee | Any time | `people.person` plus history |
| Manager, org unit | HR | Hire, then on change | Typed columns; emits `manager_changed` |
| Onboarding checklist state | System, from the Onboarding module or People's own minimal version | Automatically | `people.person` |
| Termination facts | HR | Offboarding | Typed columns; emits `terminated` |
| Assets | System, from an MDM integration, or HR | Any time | JSONB |
| Diversity self-ID | The employee, only | Any time, voluntary | Separate encrypted store, aggregate-only reads |
| External-sourced records | An upstream HRIS | Continuously | `people.person` with `sourceOfRecord: external`; emits `synced_from_external` |

Three rules make that table safe rather than merely descriptive:

1. **One writer per fact at a time.** An attribute's `ownership` set says who may
   write it; where an external system is the source of record for an attribute,
   every other writer is refused, and the refusal names the system that owns it.
2. **Every write is an event.** No path writes a person row without an outbox
   row in the same transaction. There are no dual writes.
3. **No fact is edited in place.** A change is a new effective-dated row; a
   mistake is a correction carrying `supersedes`. Payroll cannot compute a
   retroactive delta from an `UPDATE`.

---

## 8. Lifecycle

### 8.1 Person states

```
provisional ──▶ pre_hire ──▶ active ──▶ on_leave ──▶ active
     │              │           │
     │              │           ├──▶ notice ──▶ terminated ──▶ (rehired) ──▶ pre_hire
     │              │           │
     └──────────────┴───────────┴──▶ discarded          (provisional only)
```

- **provisional** — an account exists, a person record has been created from it,
  and no HR has confirmed it is an employee. Required fields do not apply.
- **pre_hire** — confirmed, with a start date in the future. Required fields
  apply to whatever is `collectAt: signup | enrolment | onboarding`.
- **active** — started. All applicable required fields apply.
- **on_leave**, **notice** — active variants; relevant because requiredness
  predicates can name them.
- **terminated** — a tombstone. The record survives; employment records outlive
  employment, and `platform.tenant` already makes the same argument about
  customers. Retention and anonymisation act on this state, on a schedule.
- **discarded** — a provisional record that was never a person. The only state
  that permits a hard delete, and only before confirmation.

### 8.2 The first employee

The chicken-and-egg case the brief asked about specifically, in sequence:

```
1. Ines creates the company in the back office.
     platform.tenant row. No accounts, no people.

2. Ines invites the first administrator by work email.
     POST /accounts on identity
     platform.account row + enrolment token (hash only)
     ──▶ identity.account.provisioned { via: 'admin_api' }

3. People consumes that event.
     Creates people.person in state `provisional`, holding only:
       identityAccountId, workEmail, timeZone, employmentStart
     No required-field evaluation. No task. No nag.

4. The administrator opens the enrolment link and enrols a passkey.
     Gives name, preferred name, mobile, confirms time zone.
     ──▶ identity.account.enrolled
     ──▶ identity.account.profile_captured   (new; §5.1)

5. People consumes profile_captured and fills the name onto the provisional
   person. The person is now nameable in a UI.

6. First sign-in lands on the People setup wizard, because the tenant has no
   published schema version:
     a. Confirm the legal entity and its country.
     b. Accept or adjust the country pack — the shipped sections and
        attributes for that country, pre-marked required where the law is not
        optional.
     c. Publish schema version 1.
     ──▶ people.schema.published { schemaVersion: 1 }

7. The wizard's last step is the administrator's own profile, which is now the
   first record evaluated against version 1. They see exactly what every
   employee will see, which is the cheapest possible usability test.
     ──▶ people.person.hired
     ──▶ identity consumes it and corrects its cached start date and name.

8. Every subsequent hire starts at step 2 from inside People instead of the
   back office, and `via` reads `people_module`.
```

Two cases this has to survive, and does:

- **People is bought later.** The tenant has accounts and no person records.
  Enabling the module runs a reconciliation: People calls identity's internal
  HTTP endpoint for the tenant's accounts — the same internal-token mechanism
  identity already uses to call messaging — and creates a provisional person per
  account. Idempotent on `identityAccountId`. Re-running it is a no-op.

  The token is a secret of its own, `PEOPLE_IDENTITY_TOKEN`, for the reason
  `MESSAGING_API_TOKEN` is: the listing is every work email and name in a
  company, and the token every front end holds should not be enough to read
  it. It falls back to `INTERNAL_API_TOKEN` until a deployment splits them.

  **A terminated account is not listed.** It belongs to somebody who has left,
  and its work email may already be held by a new account. A leaver who never
  had a person record is not given a provisional one on the way out.
- **People is never bought.** Identity's copies stay the only truth, no People
  event ever arrives to correct them, and nothing in identity's code path checks
  for the module's presence. This is what `requiresPeopleSource` exists to keep
  honest, and `just standalone timeoff` already asserts the symmetric case.

### 8.3 The three collection moments

| Moment | Where it happens | What it may ask for | Constraint |
| --- | --- | --- | --- |
| **Signup / enrolment** | `auth.app.kithena.com`, before a session exists | `collectAt: signup` or `enrolment` | Identity's own fields plus a strictly bounded set. Nothing confidential, nothing financial, nothing special-category. A person about to spend a single-use link should not be asked for a bank account, and the auth origin should not be a place where employee data accumulates |
| **Onboarding** | The tenant app, after first sign-in | `collectAt: onboarding` | Sectioned, resumable, saves per section rather than per form. Shows what is required and what is optional, and says who will see each answer |
| **Any time after** | Profile screens | `collectAt: anytime`, plus corrections | Ownership rules apply. An employee editing an HR-owned field sees it read-only with the owner named, not hidden |

`collectAt: hr_only` fields never appear to an employee at all.

**Onboarding must be resumable and must work on a phone.** Adam will do this
once, on a train. Each section saves independently and emits its own
`profile_updated`; an abandoned onboarding leaves a partially complete record
rather than nothing, and the remaining fields become the completeness gap that
drives the reminder.

### 8.4 When a field becomes required later

The case that decides whether this feature is usable or hated.

**Nothing is blocked.** Not saving, not signing in, not any other module. A
person record gains a derived completeness state:

```
complete             every applicable required attribute has a value
incomplete           one or more do not, listed by key and by owner
not_applicable       provisional or discarded records
```

On publishing a schema version that adds or tightens a requirement:

1. Every person in scope is re-evaluated, asynchronously, in a bounded job.
2. Each newly incomplete person raises `people.person.profile_incomplete` with
   the missing attribute keys and, for each, who owns it.
3. Missing **employee-owned** attributes become a task for the employee: a
   banner on their profile, an item in their task list, and a reminder email
   through `platform/messaging` on a decaying schedule (day 1, day 3, day 7,
   then weekly, capped). Never more than one reminder email per person per
   week regardless of how many fields are missing.
4. Missing **HR-owned** attributes become a task for HR, aggregated: "88 people
   are missing a cost centre" with a bulk-edit grid, not 88 separate tasks.
5. The settings screen shows the impact **before** publishing: "This makes 88 of
   412 people incomplete. 61 fields are employee-owned, 27 are yours."

The preview is the part that prevents the mistake. An HR admin who can see the
consequence before committing will pick a sensible `requiredFrom` date; one who
cannot will mark six fields required on a Friday afternoon and mail four hundred
people.

Completeness is exposed on the API and in reporting, so a customer who *wants*
to gate something on it — an onboarding module, an access request — can do that
themselves, with their own rules, rather than having ours imposed.

### 8.5 Effective dating and corrections

Per the repository rule, and it is load-bearing here rather than decorative:

- `occurredAt` — when we recorded it.
- `effectiveFrom` — when it takes effect in the domain.
- A promotion entered on the 15th, effective on the 1st, stores both.
- A **correction** is a typed event carrying `supersedes`, never a silent update.
  A salary typo corrected three months later must not read as a pay cut followed
  by a raise.

An attribute marked `effectiveDated: false` — a phone number, a personal email —
keeps only the correction path: history records who changed it and when, but
there is no "as of" query for it, because a phone number had no value "as of
last March" in any sense payroll cares about.

Every read of a person takes an optional `asOf` date. The default is today. A
payroll run for March asks for March, and gets the org chart, the salary and the
cost centre as they were, not as they are.

---

## 9. The settings screen

Lives at `/settings/people/fields` in the tenant app, behind the
`tenant:people_admin` relation.

### 9.1 Layout

```
┌────────────────────────────────────────────────────────────────────┐
│  Employee fields                        [ Preview ]  [ Publish v4 ]│
│  Version 3 published 12 Sep · 4 unpublished changes                │
├──────────────────────┬─────────────────────────────────────────────┤
│  SECTIONS            │  Personal information                       │
│  ⠿ Personal          │  Visible to: self, HR       Owned by: both  │
│  ⠿ Identification    │  ─────────────────────────────────────────  │
│  ⠿ Emergency         │  ⠿ Legal name        text      Required     │
│  ⠿ HR information    │  ⠿ Date of birth     date      Required     │
│  ⠿ Employment terms  │  ⠿ Pronouns          select    Optional     │
│  ⠿ Compensation      │  ⠿ Home address      address   Required ᶜ   │
│  ⠿ Public profile    │  ⠿ Shirt size        select    Optional  ᵗ  │
│  ⠿ Diversity  🔒     │                                             │
│  + Add section       │  + Add field                                │
└──────────────────────┴─────────────────────────────────────────────┘
        ᶜ conditional   ᵗ tenant-defined   🔒 fixed rules, not editable
```

Drag to reorder both lists — `@dnd-kit` is already the approved dependency, and
its keyboard sensor and live-region announcements are why: a settings screen
that can only be operated with a mouse is a settings screen that fails the axe
gate and excludes a real administrator.

### 9.2 The field editor

A drawer, in four steps, in this order deliberately:

1. **What is it** — label, description, type, type configuration.
2. **Who fills it in, and when** — ownership, `collectAt`.
3. **Who can see it** — visibility, defaulted from the section, with a plain
   sentence reading back what was chosen: *"Adam can see and edit this. His
   manager cannot. HR can see it."*
4. **What kind of data it is** — classification, pre-filled by the judgment
   described in §12, with special-category always requiring an explicit tick.

Classification is last because it is the step most likely to be clicked through,
and by then the admin has already told the form enough for the suggestion to be
good.

### 9.3 Publishing

Publishing shows a diff and an impact summary, then writes an immutable version:

```
Publishing version 4

  + Added    Cost centre (HR information, required for all)
  ~ Changed  Home address — now required for employees in Spain
  − Archived Shirt size (values kept, hidden from forms)

  Impact
    88 of 412 people become incomplete
      61 fields owned by employees  → tasks and reminders
      27 fields owned by you        → one bulk-edit grid
    3 integrations read this schema → webhook on publish

  [ Cancel ]                              [ Publish version 4 ]
```

Every component here is Reach: `PageHeader`, `Card`, `Field`, `Select`,
`Switch`, `Badge`, `Table`, `Alert`, `Button`, `Spinner`. Where Reach lacks
something — the visibility matrix is the likely candidate — it is added to Reach
first, as a variant on the closest existing component, described without knowing
who is asking. A permissions matrix is a `Table` with a selection mode, not a
`PeopleFieldPermissionGrid`.

### 9.4 The other People settings

The same screen area, separate tabs:

- **Employee numbering** — format, prefix, sequence start, per legal entity.
- **Directory** — which attributes are searchable, who may see the directory,
  whether photos show.
- **Country packs** — which are enabled, per legal entity.
- **Completeness and reminders** — reminder schedule, cap, who receives the HR
  digest, minimum cohort size for aggregate reporting.
- **Integrations** — webhook endpoints, subscribed events, per-endpoint field
  allowlists, signing secret rotation, delivery log and replay. See §13.
- **Data protection** — retention per classification, DSAR export format, the
  read-only generated list of every field and its policy. This screen is how a
  works council question gets answered in a meeting rather than in a fortnight.

---

## 10. Events

Topic naming, envelope, ordering and the outbox are all as
`packages/contracts/src/event.ts` already defines them: topic per module,
partitioned by `tenantId:aggregateId`, envelope carrying `occurredAt`,
`recordedAt`, `effectiveFrom`, `actor`, `correlationId`, `causationId`.

### 10.1 Schema events

| Event | Payload highlights |
| --- | --- |
| `people.schema.section_created` v1 | sectionKey, labels, order, default visibility |
| `people.schema.section_updated` v1 | sectionKey, changed field names |
| `people.schema.section_archived` v1 | sectionKey |
| `people.schema.attribute_created` v1 | attributeKey, sectionKey, dataType, cardinality, requiredness, ownership, visibility, classification, origin |
| `people.schema.attribute_updated` v1 | attributeKey, changed field names, requiredness transition |
| `people.schema.attribute_archived` v1 | attributeKey, whether values were kept |
| `people.schema.published` v1 | schemaVersion, checksum, counts, a link to the full artifact |

**Schema events carry field definitions, never employee values.** A consumer
that wants the whole shape fetches the published artifact by version; the event
tells it a new version exists and what changed at a summary level.

### 10.2 Person events

Existing, kept, extended where noted:

- `people.person.hired` — payload gains `schemaVersion` and `sourceOfRecord`.
  `legalEntityId` is nullable: a tenant whose published schema has no legal
  entity attribute has none to send, and §14.4 demands only the core fields the
  schema defines. A webhook receives the hire itself — who, which account,
  which version — always, and the name, work email, employment period, legal
  entity, manager and org unit only where its allowlist names the attribute
  each stands for, exactly as §10.3 filters `profile_updated`.
- `people.person.manager_changed` — unchanged.
- `people.person.terminated` — unchanged.
- `people.person.synced_from_external` — unchanged; finally has a writer.

New:

| Event | Purpose |
| --- | --- |
| `people.person.provisioned` v1 | A provisional record was created from an account |
| `people.person.identity_linked` v1 | A person and an identity account were connected, in either direction |
| `people.person.profile_updated` v1 | One or more attributes changed. See §10.3 for what travels |
| `people.person.attribute_corrected` v1 | A correction carrying `supersedes` |
| `people.person.job_changed` v1 | Title, level, job family — effective-dated |
| `people.person.org_changed` v1 | Org unit, cost centre, legal entity, location |
| `people.person.compensation_changed` v1 | Amount as `Money`, effective-dated, `includeInEvents`-gated |
| `people.person.status_changed` v1 | Previous and next state, reason |
| `people.person.profile_incomplete` v1 | Missing attribute keys and their owners |
| `people.person.profile_completed` v1 | The inverse. Both exist so a consumer can drive a task list |
| `people.person.merged` v1 | Two records became one. Carries the surviving and absorbed ids |
| `people.person.anonymised` v1 | Retention executed. Carries which classes were cleared |

### 10.3 What a payload may carry

The rule that keeps this safe as tenants invent fields:

```
Always in the payload    attribute key, section, classification, the fact of change
In the payload if        attribute.includeInEvents === true
Never in the payload     encrypted attributes, special-category attributes,
                         anything an admin has not explicitly opted in
```

`includeInEvents` defaults to false for anything `confidential` or above, and
cannot be set true for special-category data. A consumer needing a value it is
not sent reads it back through the API, where authorization applies per field.
That is one extra round trip and the correct trade: a Kafka topic is a durable,
replayable copy of whatever is put on it, and the cost of a mistake there is
measured in years of retention.

Webhook payloads are filtered a second time, per endpoint, against that
endpoint's own field allowlist. An integration that needs a start date and a
department gets a start date and a department.

---

## 11. Storage design

### 11.1 Shape

```sql
-- Registry ------------------------------------------------------------------
people.section                (tenant_id, key, labels jsonb, ord, visibility,
                               archived_at)
people.attribute_definition   (tenant_id, key, section_key, data_type,
                               type_config jsonb, cardinality, requiredness jsonb,
                               ownership text[], visibility jsonb, collect_at,
                               classification jsonb, effective_dated, unique_scope,
                               encrypted, indexed, include_in_directory,
                               include_in_events, origin, deprecated_at)
people.schema_version         (tenant_id, version, published_at, published_by,
                               checksum, document jsonb)   -- immutable

-- Records -------------------------------------------------------------------
people.person                 (id, tenant_id, identity_account_id,
                               -- typed core, real constraints
                               employee_number, status, legal_entity_id,
                               given_name, family_name, preferred_name,
                               work_email, hire_date, seniority_date,
                               manager_id, org_unit_id, location_id,
                               employment_type, fte numeric(5,4),
                               base_salary numeric(19,4), salary_currency char(3),
                               -- tenant-defined
                               custom jsonb NOT NULL DEFAULT '{}',
                               schema_version int,
                               completeness text,
                               source_of_record text,
                               created_at, updated_at)

people.person_attribute_history (id uuidv7, tenant_id, person_id, attribute_key,
                                 value jsonb, effective_from date,
                                 recorded_at timestamptz, actor jsonb,
                                 supersedes uuid, event_id uuid)   -- append-only

people.person_secret          (tenant_id, person_id, attribute_key,
                               ciphertext bytea, key_id, last4 text,
                               created_at)                        -- separate RLS

people.attribute_unique       (tenant_id, attribute_key, scope_id,
                               normalised_value, person_id)
                               UNIQUE (tenant_id, attribute_key, scope_id,
                                       normalised_value)

people.outbox                 -- same shape as platform.outbox
```

### 11.2 Why this shape

**Typed columns for the core.** Hire date, manager, salary, status and employee
number are queried, joined, sorted and constrained on every screen and every
report. They get real types, real foreign keys, real check constraints, and
`numeric(19,4)` for money because the repository rule says money is never a
float. A JSONB-only design gives all of that up for uniformity nobody asked for.

**JSONB for tenant-defined attributes.** Current values only, validated on write
against the published schema version. A GIN index covers containment queries; an
attribute marked `indexed` is promoted to a generated column with its own index,
which is a migration rather than runtime DDL and is the only thing that makes a
50,000-row directory filter on a custom field survivable.

**History is the truth, the person row is a projection.** Every change writes an
append-only history row and an outbox row in the same transaction. `asOf` reads
replay history. If the person row and the history disagree, the history wins and
the projection is rebuilt — which is also how a schema migration to a new field
shape is done without touching what was recorded.

**No runtime DDL, ever.** A uniqueness rule on a tenant-defined attribute is
enforced by a row in `people.attribute_unique` with a real unique index over
`(tenant_id, attribute_key, scope_id, normalised_value)`, written in the same
transaction as the value. This is the point in the design most likely to be
implemented as `CREATE INDEX` at runtime, and the reason not to is the repository
rule that migrations are expand-contract only. Runtime DDL against a
multi-tenant production database is an outage with a configuration screen in
front of it.

**Secrets are not in the row.** Bank accounts, national identifiers and tax
identifiers live in `people.person_secret` under envelope encryption, with their
own RLS policy and their own grant. The person row keeps `last4` for display.
Nothing in `custom` and nothing in an event ever holds the plaintext.

**RLS with FORCE on every table**, `svc_people` created `NOBYPASSRLS`, using the
same `NULLIF(current_setting('app.tenant_id', true), '')::uuid` form the identity
migrations already use. Tenant isolation is a database property here, not an
application one.

### 11.3 Migration policy

Expand-contract only, as the repository requires: add nullable, backfill, write,
stop reading, drop later. There are no down migrations. Atlas writes and lints
the files; CI applies them.

Shipping a new **core** attribute is a migration. Shipping a new **country
pack** attribute is a data change to the registry. Shipping a **tenant**
attribute is a row the customer writes themselves. Only the first requires a
release, which is the entire point of the design.

---

## 12. Classification of tenant-defined attributes

### 12.1 The gap

`just codegen` walks the Zod registry and exits non-zero on an unclassified
field. That walk emits the Pino redaction paths, the AI gateway deny list and the
DSAR export manifest. It is a **build-time** walk over **static** schemas.

An attribute created by Priya on a Tuesday afternoon is a personal-data field
that no build has ever seen. Without an answer, the redaction paths do not cover
it, the AI deny list does not know it, the DSAR manifest omits it and the
retention job ignores it — and the guarantee the repository makes about
classification quietly becomes a guarantee about the fields we happened to ship.

### 12.2 The answer

**A runtime policy registry with the same shape as the static one, and every
derived artifact computed from the union of both.**

- `people.attribute_definition.classification` stores a `FieldPolicy` — the
  exact interface in `packages/contracts/src/classification.ts`. Not a parallel
  vocabulary.
- The logging adapter redacts the static generated set **plus** a per-tenant
  set loaded at boot and refreshed on `people.schema.published`. The static
  paths are fixed and Pino compiles them; a tenant's keys are matched **by key,
  at any depth and inside arrays**, on every line and in every child logger's
  bindings, by one copy-on-write walk. A log line is not a fixed shape, and a
  field logged one level deeper than someone anticipated must not go out in
  clear. The walk is bounded (depth 32, 10,000 objects) and closed at the
  bound: what it did not look at is censored, never written. Its cost is a
  budget, not a hope — a typical line costs under 1 µs more than one with no
  tenant redaction at all.
- The AI gateway's deny list is computed the same way. A prompt that would carry
  an attribute where `aiEligible: false` is refused by the gateway, not filtered
  by a caller.
- **The gateway checks free text for values, not only context for keys.** A
  value pasted into the instruction, or into a string under an innocent key,
  is invisible to a key match. The caller names the people a prompt is about;
  the gateway asks People for the current values of their denied attributes,
  with the caller's field access applied, and refuses when any of them appears
  in the text however it is cased, spaced, accented or punctuated —
  `DE89 3704 0044…`, `123-45-6789` and `ab 12 34 56 c` all match their stored
  form. It refuses, it never filters, and it never forwards. The values are
  held in memory for the comparison only: never logged, never in the refusal.
  - **The rule: only values the caller may read are checked.** People applies
    the same field-level visibility (`visibleTo`) it applies to a profile
    read, and a value the caller cannot see is never looked up. The reason is
    the oracle: if every value were checked, "is she Catholic?" could be
    answered by whether the prompt was refused, one guess at a time. A value
    the caller cannot read did not come from us, so leaving it out costs the
    check nothing the caller could have got here.
  - **Short values are matched only next to their field's name.** A value
    under 4 normalised characters with no digit — blood group `A`, `AB`, a
    sex marker `F` — is an ordinary word, and refusing every prompt with "a"
    in it would make the gateway useless without making anyone safer. Such a
    value refuses a prompt only as a whole word within 3 words of one of its
    own attribute's names, key or label in any locale: `blood group: A`,
    `grupo sanguíneo AB`. Anywhere else it is ignored. (`SHORT_BELOW` and
    `NAME_WINDOW` in `free-text.ts`.)
  - **Dates are matched however they are written.** A stored calendar date
    matches ISO (`1990-01-02`, `19900102`), day/month/year and
    month/day/year with `/`, `-` or `.`, two- or four-digit years, with or
    without leading zeros and ordinal suffixes, and with the month spelled
    out or abbreviated in the country packs' languages — English, Spanish,
    Catalan, German and Hindi (`2 January 1990`, `Jan 2, 1990`,
    `2 de enero de 1990`, `2. Januar 1990`). A numeric date is read both ways
    round: `01/02/1990` matches the 1st of February and the 2nd of January,
    because which one the writer meant cannot be known and refusing both is
    the safe side.
  - A person who cannot be resolved refuses the prompt. Not knowing the values
    is not evidence the text is clean.
  - **A caller that names nobody** cannot have values checked, so any mention
    of a denied field's key or label, in any locale, is refused, and the
    refusal says so and says to name the subjects instead.
- The DSAR manifest is generated per tenant, per request, from the published
  schema version the record was written under — which is why the version is
  stored on the person row.
- Retention jobs read the same source.

An attribute cannot be created without a policy. There is no "unclassified"
state, no default that means "we will decide later", and no code path that
writes a definition row with a null policy. The field is `NOT NULL` and the
domain refuses before the database gets a chance to.

### 12.3 Where a judgment helps

Priya is an HR operations lead. Asked to pick between "internal" and
"confidential" for a field called *"Accommodation notes"*, she will pick wrong
often enough to matter — and it is the wrong question to ask her in that
vocabulary at all.

So the form asks in her language, and a **System One** judgment (TypeSafe's Jev)
pre-fills the answer from the attribute's metadata. This is the pattern the
TypeSafe documentation calls code-in-control: the workflow, the storage, the
enforcement and the final decision are ordinary code; the model supplies one
bounded judgment where semantic understanding genuinely helps.

**What is sent**: the attribute's label, description, type, section and the
option list if it has one. Metadata only.

**What is never sent**: any employee's value. Not one, not a sample, not an
"example" taken from an existing record. The classification judgment runs at
definition time, when no values exist yet, which is what makes that rule cheap
to keep.

```ts
// services/people/src/infrastructure/typesafe-attribute-advisor.ts
// An adapter behind a port. The domain never imports this.
import { TypeSafeClient, choice, noul } from '@typesafe-ai/sdk';

const response = await client.systemOne({
  state: {
    attribute: {
      label: 'Accommodation notes',
      description: 'Adjustments agreed with the employee',
      dataType: 'long_text',
      section: 'Health & safety',
      options: null,
    },
    sectionDefaults: { classification: 'special-category' },
  },
  questions: {
    classification: choice(
      'How sensitive is the data an HR team would put in `attribute`?',
      {
        public: null,            // may appear in a public directory
        internal: null,          // ordinary business data about a person
        confidential: null,      // would embarrass or harm if disclosed
        'special-category': null // GDPR Article 9
      },
    ),
    piiKind: choice('What kind of personal data would `attribute` hold?', {
      identity: null, financial: null, contact: null,
      health: null, biometric: null, none: null,
    }),
    isArticle9: noul(
      'Could `attribute` routinely hold health, biometric, racial, religious, ' +
      'political, trade-union or sexual-orientation data about the employee?',
    ),
    freeTextRisk: noul(
      'Is `attribute` a free-text field where an HR user could type anything, ' +
      'including a third party\'s personal data?',
    ),
  },
});
```

**How the answer is used — the gate, in code, not in a habit:**

| Condition | Behaviour |
| --- | --- |
| `isArticle9` probability ≥ 0.5, or classification is `special-category` | Force `special-category`, `aiEligible: false`, `includeInEvents: false`. Require an explicit tick with the consequence spelled out. Never auto-applied |
| `freeTextRisk` ≥ 0.5 | Floor at `confidential` and `aiEligible: false`, matching what `asFreeText()` already does for static fields |
| Confidence ≥ 0.9 and not the above | Pre-select, clearly marked as a suggestion, one click to change |
| Confidence 0.5–0.9 | Pre-select nothing. Show the top two with their reasons and make her choose |
| Confidence < 0.5, or the API is unavailable | Fall back to the section default, or to `confidential` / `aiEligible: false` if the section has none. Never block the admin on an inference call |

The asymmetry is deliberate. A suggestion that makes a field **more** protected
can be applied automatically; one that makes it **less** protected cannot. The
model can never downgrade a classification, and no amount of confidence changes
that — a wrong "internal" on a field holding a diagnosis is exactly the failure
this whole system is built to prevent, and it is not a failure worth automating
away a click for.

Every suggestion and every override is recorded on the definition
(`classificationSource: 'suggested' | 'human' | 'section_default'`), which is
what makes the quarterly audit in §3 possible.

### 12.4 The other judgments

Same adapter, same rules, all in the infrastructure layer, all optional — the
module boots and functions with no TypeSafe key configured.

| Where | Judgment | Gate |
| --- | --- | --- |
| **CSV import** | Map each spreadsheet column to an attribute key. `Choice` over candidate keys plus `no_match`; code supplies the candidate list from the published schema | ≥ 0.9 auto-maps, below that goes to the manual mapping screen. The mapping is always shown before import runs |
| **SCIM / HRIS mapping** | Map an external schema's fields to attribute keys, once per integration | Never auto-applied. It drafts a mapping a human approves, because it is applied to every record thereafter |
| **Duplicate detection** | `Noul`: are these two records the same human? Code supplies the pairs from cheap blocking on name, email and date of birth | A merge is **always** a human decision. The judgment ranks candidates; it never merges |
| **Legacy free-text normalisation** | Code finds candidate values in an imported blob; `Choice` selects the intended one. The pre-parsed extraction pattern — select, never generate | Every selection is shown in the import dry-run diff before anything is written |
| **Directory safety screen** | `Noul`: does this bio or public field contain a third party's personal data, or special-category data about the author? | ≥ 0.5 warns the employee before publishing. Advisory. It never blocks somebody from describing themselves |

**What no judgment ever decides**: whether a field is required, who may see it,
who may write it, what a salary is, or whether a record may be merged. Those are
policy and identity, and a calibrated probability is not the right instrument for
either.

**Cost and latency.** All judgments over one state go in one request — the
documented pattern, and the reason the classification call asks four questions
rather than making four calls. The path is off the request-critical path in every
case except the attribute form, where it runs while the admin is still typing the
description and is abandoned if they publish first.

---

## 13. Headless surfaces

The brief's requirement, restated precisely: **the People layer must be fully
usable by a customer who never loads a Kithena screen.**

### 13.1 GraphQL (Phase 1)

The federated subgraph, thin, mapping domain failures to GraphQL errors. Person
and schema types; tenant-defined attributes exposed as a typed union rather than
a stringly-typed bag, generated per tenant from the published schema version.
Extends federated types rather than owning what People does not own.

### 13.2 REST (Phase 1)

Because a GraphQL-only API excludes every integration built by somebody who is
not going to learn GraphQL for one webhook, and because the whole point is to be
sellable alone.

```
GET    /v1/schema                      the published schema version
GET    /v1/schema/versions             history
GET    /v1/people                      filter, sort, paginate, ?asOf=
POST   /v1/people                      create
GET    /v1/people/{id}                 ?asOf=
PATCH  /v1/people/{id}                 partial, per-attribute authorization
GET    /v1/people/{id}/history         effective-dated, per attribute
POST   /v1/people/{id}/corrections     a correction carrying supersedes
GET    /v1/people/{id}/completeness    what is missing and who owns it
POST   /v1/imports                     dry run, then commit
GET    /v1/exports/{id}                including a DSAR package for one person
```

OpenAPI generated from the same Zod definitions, per the rule that a derived
artifact is never hand-written. Idempotency keys on every write. Cursor
pagination. Field-level authorization identical to GraphQL's, because both call
the same application layer.

### 13.3 Webhooks (Phase 1)

| Property | Behaviour |
| --- | --- |
| Signing | HMAC over the raw body with a per-endpoint secret, rotatable with an overlap window |
| Ordering | Per person, guaranteed. Across people, not |
| Delivery | At least once. Every payload carries `eventId`; consumers deduplicate on it |
| Retry | Exponential backoff to 24 hours, then the endpoint is disabled and the tenant is told: `people.webhook.endpoint_disabled` is raised in the same transaction, once however many deliveries hit the ceiling together, and the endpoint's alert address is emailed through `platform/messaging` |
| Alert address | Required when an endpoint is registered: a request without a valid one is refused, 400, naming `alertEmail`. An endpoint registered before this rule may have none and is told through the event alone |
| Durability | The retry schedule is `next_attempt_at` on each delivery row. A bounded poller passes every known tenant on boot and every minute, so a retry pending across a restart resumes when it falls due. A pass claims a delivery with a short lease before sending, so two replicas never send one twice and a crash mid-send is a resend |
| Replay | Any delivery re-sendable from the settings screen for the retention window |
| Filtering | Per endpoint: which events, and which attributes within them (§10.3) |
| Payload | The event envelope, unchanged, minus what the allowlist excludes |

### 13.4 The schema artifact (Phase 1)

Published schema versions are fetchable as JSON Schema — generated from the same
Zod definitions — so an integrator can generate their own types against a
specific version and pin to it. `people.schema.published` tells them a new one
exists. This is what makes "configurable fields" safe for a third party rather
than a moving target.

### 13.5 SCIM 2.0 (Phase 3)

`/Users` and `/Groups`, with tenant-defined attributes exposed through a schema
extension and mapped by the approved mapping from §12.4. Okta and Entra as the
first two verified providers.

### 13.6 Mirror mode (Phase 3)

`sourceOfRecord: external`. A customer's HRIS owns the records; People holds the
registry, the projection and the events; `people.person.synced_from_external`
fires on every change, carrying field names and never values. Per-attribute
source ownership, so a customer can keep names and jobs upstream while owning
emergency contacts in Kithena. Every other writer to an externally-owned
attribute is refused, and the refusal names the owning system.

This is what makes the module genuinely sellable to a Workday shop, and it is
Phase 3 because it is worth nothing until the registry and the API beneath it are
solid.

---

---

## 14. Importing people

A spreadsheet is how employee data actually arrives. Every customer migrating
to Kithena has one, every acquisition arrives as one, and the alternative — a
person typing 400 records into a form — is the reason HRIS migrations take a
quarter. Import is not a convenience feature here; it is the second-most-used
write path after onboarding.

### 14.1 What can be imported

| Source | Produces | Notes |
| --- | --- | --- |
| CSV / TSV | People and their attribute values | Encoding sniffed, BOM handled, delimiter detected |
| XLSX | The same, plus repeating groups from extra sheets | First sheet is people unless told otherwise |
| A Kithena export | The same file round-tripped after editing | The key row (§15.3) is what makes this safe |
| A folder or zip of documents | `document_ref` attribute values attached to existing people | Contracts, signed offers, ID scans, right-to-work evidence |

Document import is its own path because the matching problem is different: a
spreadsheet row carries its own identifiers, a PDF carries a filename. Files
are matched to people by a filename pattern the admin confirms
(`{employee_number}-contract.pdf`, `{work_email}_*.pdf`) or by a column in an
accompanying sheet. Nothing is attached on a guess — an unmatched file lands in
a review list, never on the nearest-looking person.

### 14.2 The flow

```
Upload  ──▶  Detect  ──▶  Map columns  ──▶  Dry run  ──▶  Fix  ──▶  Commit  ──▶  Report
                │             │                 │                      │
          sheet, encoding,    each column to    every row              row-level
          delimiter, header   an attribute      classified before      outcomes,
          row, row count      key or ignored    anything is written    downloadable
```

**Nothing is written until the dry run is accepted.** The dry run is the
product, not a formality: it classifies every row into create, update, unchanged,
blocked or duplicate, and shows the first twenty of each with the exact cell
that caused it.

### 14.3 Mapping columns

Columns are matched to attribute keys by exact key, then by label, then by a
System One judgment over the candidate list from the published schema — the
`Choice` with a `no_match` option described in §12.4, auto-mapping at ≥ 0.9 and
falling to manual below that. The mapping is always shown before the dry run
runs, whatever the confidence.

Three things can happen to a column that matches nothing:

1. **Ignore it.** The default, and reversible on the next import.
2. **Map it to an existing attribute** the admin picks by hand.
3. **Create an attribute from it.** Opens the field editor from §9.2 inline —
   including the classification step, which is not skippable. A column called
   "Medical notes" does not become an `internal` free-text field because
   somebody was in a hurry importing 400 rows.

A column is never silently dropped. An import that ignores six columns says so
on the dry run and in the final report, because "the data didn't come across"
is discovered three months later otherwise.

### 14.4 When required fields are missing

The question the brief asked, and the answer is deliberately not symmetric.
Two different kinds of missing:

| Missing | Outcome | Why |
| --- | --- | --- |
| A **core identity** field — legal name, work email, hire date, legal entity | The **row is blocked**. It is not imported, it is listed in the dry run with the offending column, and the rest of the file proceeds | There is no such thing as a person record without these. Creating one produces a row nobody can find, match or invite |
| Any other **required** attribute — cost centre, national identifier, a tenant-defined required field | The row **imports and the person is incomplete**, exactly as §8.4 describes | A migration whose source system never held a cost centre must not be un-importable. Blocking here would mean the customer has to fix their old spreadsheet before they can use the new system, which is the wrong order |
| An **invalid** value — a malformed NIF, an unparseable date, an option not in the list | The **row is blocked** with the cell named | Wrong is not the same as absent. Importing a bad value is worse than importing nothing, because nothing is visible as a gap and wrong is not |

The dry run states all three counts before anything is written:

```
412 rows read
  368  create
   21  update      (matched on work_email)
    4  unchanged
   14  blocked     11 missing work email · 3 invalid hire date
    5  duplicate   review before importing

Of the 389 rows that will import, 88 will be incomplete.
  61  missing Cost centre
  27  missing Home address  (required in Spain)
```

That last pair of lines is the point: the admin learns, before committing, that
a successful import still leaves 88 people to chase — and that this is normal
rather than a failure.

### 14.5 The rest of the rules

- **Matching.** On work email first, then employee number, then a duplicate
  judgment over name plus date of birth (§12.4). A suspected duplicate is never
  merged automatically; it is a review item.
- **Effective dating.** A file may carry an `effective_from` column. Without
  one, imported facts take the person's hire date for employment facts and the
  import timestamp for everything else — and the report says which was used.
- **Idempotency.** An import carries a key derived from the file's checksum.
  Re-uploading the same file reports "already imported" rather than
  duplicating 400 people, which is the mistake every importer makes once.
- **Partial commit.** Blocked rows never prevent good rows. The report is
  downloadable as a CSV with the original row number, the original values and
  the reason, so it can be fixed and re-imported as a smaller file.
- **Authorization.** An importer can only write attributes they own. An HR
  admin importing a file containing a salary column when they lack the finance
  relation gets that column refused at mapping time, not silently dropped at
  write time.
- **Audit.** `people.import.started` and `people.import.completed` carry the
  actor, the row counts, the attribute keys touched and the file checksum —
  never the file, and never a value.
- **Limits.** 50,000 rows or 100 MB per file, 500 MB per document batch, one
  running import per tenant. Larger migrations are several files, which is also
  how they stay reviewable.

---

## 15. Exporting

Three formats, because they are read by three different audiences and a single
format serving all three serves none of them well.

| Format | For | Shape |
| --- | --- | --- |
| **CSV** | Another system, a script, a re-import | One row per person, flat, no styling, keys in the second header row |
| **XLSX** | A human — finance, a works council, a payroll bureau | Multiple sheets, real types, dropdowns, highlighted gaps, a provenance sheet |
| **PDF** | A record to hand over, print or file — an employee file, a labour inspection, a DSAR pack | Per person or a roster, with page furniture and explicit "Not provided" |

### 15.1 The export builder

Four choices, in one screen: **who** (the current directory filter, or a saved
segment, or a selection), **which fields** (by section, with a field picker),
**as of when** (today, or any past date — history makes this free), and **what
format**.

Two rules bind it:

- **Field-level authorization applies to an export exactly as it applies to a
  screen.** A manager exporting their team gets the fields a manager can read
  and no others. There is no "export everything" that bypasses the check — an
  export is a read, and the most common way a permission model is defeated is
  an export button that forgot it.
- **Every export is an event.** `people.export.completed` carries the actor,
  the attribute keys, the row count and the format. An export containing
  financial or special-category attributes additionally requires a stated
  reason, which is recorded with it.

Anything over 2,000 rows runs as a job. The file lands in object storage,
encrypted, behind a signed link that expires in 24 hours and is delivered as a
notification — never as an email attachment, because an email attachment is a
copy of the employee register in a mailbox nobody controls.

### 15.2 Exporting a sheet that has extra attributes

The brief's question, and the design has to answer it without either hiding
custom fields or producing a file that breaks the moment the schema changes.

**Columns are generated from the published schema version at export time.** A
tenant with 58 attributes gets 58 columns in section order, then attribute
order — the same order as the profile screen, so the file reads like the UI.

- **Two header rows.** Row 1 is the human label ("Cost centre"). Row 2 is the
  stable attribute key (`cost_centre`). Humans read the first, the re-importer
  reads the second, and a relabelled field therefore round-trips correctly.
- **Repeating attributes** — emergency contacts, education, equity grants — do
  not flatten into `contact_1_name … contact_4_email`. They become their own
  sheet in XLSX, keyed by employee number, and their own file in a CSV export
  bundle. Flattening produces either truncation or a hundred empty columns.
- **Archived attributes** are excluded by default and included on request,
  marked `(archived)` in the label row. Their values still exist, so an export
  that silently omitted them would misreport what is held.
- **Encrypted attributes** — bank accounts, national identifiers — export as
  the masked form (`ES•• •••• 2291`) unless the exporter holds the finance
  relation *and* states a reason, in which case the full value is exported and
  the export is flagged in the audit log.
- **Special-category attributes never appear** in a standard export at all.
  They are reachable only through the DSAR path (§15.5), which runs as the
  subject rather than as a viewer.
- **A provenance sheet** — "About this export" — carries the schema version,
  the `asOf` date, the filter used, the field list, who exported it and when.
  A spreadsheet that outlives its context is a spreadsheet somebody will
  misread in nine months.

### 15.3 Round-tripping

Export, edit in Excel, re-import. This is how bulk correction actually happens,
so it is a supported path rather than an accident:

- The key row (row 2) is what the importer maps against, so no re-mapping is
  needed and a relabelled field still lands correctly.
- The provenance sheet carries the schema version. If the schema has since
  changed **incompatibly** — a required field added, an option removed, a type
  changed — the import says so, names the difference and offers to map the
  file against the current version rather than failing.
- Rows carry a hidden person id, so a re-import updates rather than creating
  duplicates even if somebody has edited a name.

### 15.4 What a missing required value looks like in each format

Absence has to be visible, and it has to be distinguishable from zero, from an
empty string and from "not applicable at this company".

| Format | Missing required | Missing optional | Not applicable |
| --- | --- | --- | --- |
| CSV | Empty cell. A `__missing_required` column lists the keys, comma-separated | Empty cell | Empty cell |
| XLSX | Empty cell with an amber fill and a cell comment naming the field, plus a **Missing information** sheet listing person, field and who owns filling it | Empty cell, no fill | Cell shaded grey, comment "not required for this person" |
| PDF | Prints **Not provided** in muted type, never a blank | Omitted entirely | Omitted entirely |

The PDF rule is the one that matters most. A blank line on a printed employee
record is ambiguous between "we do not hold this", "the field did not exist"
and "the printer cut it off", and the one place that ambiguity gets read is a
labour inspection.

XLSX exports also carry real types, not strings: money is a numeric cell with a
currency format and its minor units intact, dates are date cells, and option
attributes get a data validation dropdown drawn from the live option list. A
column of money as text is a column finance cannot sum, which is the single
most common complaint about every HRIS export ever shipped.

### 15.5 The PDF exports, specifically

Two documents, not one:

- **An employee record.** One person, every section they have a value in,
  section headings matching the UI, a signature block where the tenant has
  configured one, generated-at and generated-by in the footer, and "Page 3 of
  7" on every page. This is what gets handed to a labour inspector, attached to
  a grievance file, or given to an employee who asked for their file.
- **A roster.** Landscape, one row per person, the columns chosen in the
  builder, repeating headers on every page, and the filter printed in the
  header so a printout is self-describing.

Both are rendered server-side from the same data the API returns, so a field
the requester cannot read is not on the page — and the footer states how many
fields were withheld, because a record that silently omits things is a record
that misleads.

**The DSAR pack is a third thing and is stricter.** It runs as the subject, not
as a viewer: every attribute with `exportable: true` including special-category
ones, the full effective-dated history, and the event log for that person, as a
zip containing a PDF for reading, a JSON file for porting, and the attached
documents. Generated in under a minute, per §3.

---

## 16. Analytics

### 16.1 What People is allowed to answer

People owns **descriptive analytics about the data People holds**: headcount,
composition, movement, org shape, expiries and data quality. Anything that
joins another module's facts — absence rates, performance against pay, cost per
hire — belongs to a Reporting module and reaches these facts through events and
the API. People does not grow a warehouse, because a module that needs every
other module's data to be useful is a module nobody can buy on its own.

Every chart obeys four rules without exception:

1. **A chart is a read.** Field-level authorization applies, so a manager's
   headcount chart counts their own chain and a chart over an attribute they
   cannot read does not render for them.
2. **Cohort minimum.** Any breakdown touching special-category data returns
   "insufficient data" below the tenant's minimum (default 10, raisable, never
   lowerable). This applies to the chart, the tooltip and the underlying export.
   A minimum that holds on every reading still leaks across two — 14 people on
   Monday, 15 on Tuesday, and HR knows who started on Tuesday — so a
   special-category breakdown is **published**, never read live from the daily
   snapshot. A new one is published at most once per calendar month, on the
   month's first run, and only when at least as many people as the cohort
   minimum changed since the last (joined, left, or changed their answer);
   otherwise the previous one keeps being served, unchanged. Before the first,
   the answer is "insufficient data". Every count in a published breakdown is
   rounded to the nearest 5, ties away from zero, after the minimum has been
   checked on the true counts; the total is rounded on its own and is not the
   sum of the rounded counts, and the result says so.
3. **`asOf` is a first-class control.** History makes "what did the org look
   like in March" a parameter rather than a separate report.
4. **Every chart ships its table.** Reach's `ChartDataTable` renders the
   screen-reader equivalent alongside the SVG, so a chart is never the only way
   to get a number.

### 16.2 The charts, and the question each one answers

Reach already draws all of these by hand — no charting library, per the
existing decision — and the fixtures in `packages/ui/src/charts` are HRIS data
already.

| Question | Chart | The relation it shows |
| --- | --- | --- |
| Are we growing? | `TrendChart` — headcount by month, with a `Sparkline` in the stat tile above it | Level over time. Joiners and leavers sit beneath as a stacked bar so growth is visibly the difference between two flows, not one line |
| Where did the change come from? | `WaterfallChart` — opening, joiners, internal moves, leavers, closing | The single most-asked HR number, and the only chart that makes headcount reconcile rather than merely display |
| What are we made of? | `HorizontalBarChart` by department, location or employment type; `DonutChart` for status | One dimension at a time. A second dimension becomes `StackedBarChart`, never a pie of pies |
| Are people leaving faster? | `TrendChart` — rolling 12-month attrition, annualised, with the formula stated on the card | Rate over time. Shown next to headcount because attrition without a denominator is a vanity number |
| Who is at risk of leaving? | `BarChart` — tenure distribution in bands | Tenure against leaver counts in the same bands: the classic 6-to-18-month cliff shows up as a shape, not a statistic |
| Is the org shaped sensibly? | `BarChart` — span of control distribution, plus `OrgChart` for the structure itself | How many managers have one report, and how many layers sit between an employee and the top |
| Is our data any good? | `HorizontalBarChart` — completeness by section and by field, with a trend since the last publish | This is what makes §8.4 measurable rather than aspirational, and it is the chart Priya opens most |
| Where do new joiners stall? | `FunnelChart` — invited, enrolled, onboarding started, onboarding completed, record complete | The drop between "enrolled" and "onboarding completed" is the onboarding form's real completion rate |
| What is about to expire? | `TimelineChart` — work permits, fixed-term contracts, probation ends and certifications over the next 90 days | The only genuinely operational chart here. A permit expiring in three weeks is a person who cannot legally work in four |
| When do people join? | `HeatmapChart` — month against department | Hiring seasonality, which is what makes a capacity plan arguable |
| How is pay distributed? | `RangeChart` for band ranges with the actuals inside them; `ScatterChart` for pay against tenure | Requires the finance relation. Compa-ratio against band midpoint is the relation; a raw salary list is not analysis |
| What does the workforce look like in aggregate? | Bar charts over voluntary self-ID | Cohort minimum enforced everywhere, per §6.7. Never per person, never to a manager |

### 16.3 Segments, saved views and delivery

Filters are the directory's filters — one filter model across the directory,
the export builder and analytics, so a segment defined once is usable
everywhere. A saved segment is a named filter, shareable within the tenant,
and it is what a scheduled report points at.

Scheduled reports go out through `platform/messaging` on a tenant-set cadence:
a PDF roster, an XLSX export, or a digest of the completeness numbers. The
email carries a link, not the data.

**Exporting a chart exports its data**, as CSV or XLSX, plus the chart itself
inside the PDF report. There is no "download as PNG" — a PNG of a chart is a
number nobody can check, and it goes stale the moment it leaves.

### 16.4 How it stays fast

A daily snapshot table, `people.headcount_snapshot`, holds the aggregate
dimensions per tenant per day: counts by department, location, status,
employment type, tenure band and completeness. Charts read snapshots.

Arbitrary `asOf` dates outside the snapshot grid fall back to replaying
history, which is slower and is marked as such in the UI. Nothing is computed
by scanning every person on every page load, and no chart query touches the
person table directly.

---

## 17. Mobile

Every screen in this document works on a phone. That is a requirement, not an
aspiration, and it is cheap here because the design system already does most of
the work: control heights come from `--reach-control-*`, which
`@media (pointer: coarse)` re-points to the 44px tap floor. No component asks
how wide the window is.

### 17.1 Three tiers, and what each means

| Tier | Screens | What "mobile" means |
| --- | --- | --- |
| **Full parity** | Onboarding, own profile, a colleague's profile, the directory, tasks and reminders, analytics viewing, notifications | Identical capability. These are the screens an employee uses, and most employees have no other device |
| **Adapted** | The field registry, the publish flow, the completeness grid, import mapping, the export builder | Same capability, different layout. Reorder gains explicit "move up / move down" actions alongside drag. The completeness grid becomes one card per person with one field on it. Import mapping stacks into a list of column-to-field rows |
| **Initiated, not performed** | A 50,000-row import, a large PDF roster | Started and monitored on a phone, executed server-side. Closing the tab does not cancel anything, and the result arrives as a notification |

Nothing is desk-only by design. A rule that says "do this at a computer" is a
rule that gets broken in a car park by somebody who needed it now.

### 17.2 The rules that make it true

- **Tables become lists.** Below the `md` breakpoint, `DataTable` gives way to
  `ListDetail` cards carrying the two or three columns that matter, with the
  rest behind a tap. Reach's `useBreakpoint` decides; the screen does not sniff
  a user agent.
- **Dialogs become sheets.** `Sheet` from the bottom, not `Dialog` in the
  middle — a centred modal on a phone puts its actions under the keyboard.
- **Actions stick.** A form's primary action sits in a sticky bar above the
  safe-area inset, so "Save" is never below a keyboard or behind a scroll.
- **No hover-only affordance.** Anything revealed on hover has a visible
  equivalent. A row action that only appears on hover does not exist on a
  phone.
- **Forms are one column, always.** Two-column forms reflow into an order
  nobody intended.
- **Charts adapt, they do not shrink.** Fewer axis ticks, abbreviated labels, a
  horizontally scrollable container for anything time-based, and the data table
  always one tap away. A twelve-month trend squeezed to 340px is a smear.
- **Documents come from the camera.** A `document_ref` upload offers the camera
  as well as the file picker, because a right-to-work document is a passport on
  a desk, not a file on a laptop.
- **Poor networks are the normal case.** Onboarding saves per section and
  retries; a failed save says which section and keeps the values.

### 17.3 How it is checked

Every story renders at a phone viewport as well as a desk one, and
`pnpm test:stories` runs axe over both. Tap targets are asserted against the
44px floor rather than eyeballed. The onboarding flow has an acceptance test
that completes it end to end at 390×844 with a software keyboard raised.

---

## 18. Non-functional requirements

**Performance.** P95 full profile read < 120 ms. Directory page of 50 < 300 ms
at 50,000 people. Schema publish to propagated < 5 s. Import of 10,000 rows < 5
minutes including validation and the dry-run diff. Export of 10,000 people to
XLSX < 90 s. A snapshot-backed chart renders in < 400 ms; an arbitrary `asOf`
that misses the snapshot grid may take seconds and says so rather than
pretending.

**Scale.** 100,000 people per tenant. 500 attribute definitions per tenant. 50
sections. 20 webhook endpoints. Values of a single attribute up to 10,000
characters, beyond which it should have been a document.

**Availability.** The module boots and serves reads with Redpanda unavailable;
writes queue in the outbox and drain on recovery. No dual writes, ever. TypeSafe
being unavailable degrades a suggestion, never a save.

**Security.** RLS on every table with `FORCE`. Envelope encryption for financial
and identifier attributes. Field-level authorization in the application layer.
Every read of a special-category attribute is audit-logged with actor, time and
reason. Rate limits on the public REST surface per tenant and per key.

**Accessibility.** Every screen passes axe as a merge gate, which Storybook
already runs over every story. The settings screen is fully keyboard operable
including reordering. Control heights come from `--reach-control-*`; onboarding
on a phone gets the 44px tap floor for free through `@media (pointer: coarse)`,
and no component asks how wide the window is. Every chart ships its
`ChartDataTable` equivalent, so no number is available only as a picture.

**Mobile.** A requirement across every screen, specified in §17. Three tiers —
full parity, adapted layout, and initiated-but-executed-server-side — with the
rules and the checks that hold them.

**Internationalization.** Labels and descriptions are localized per tenant.
Dates are calendar dates, not timestamps. Names keep their three parts and are
formatted at the edge. Addresses follow the country's own field names.

**Observability.** Every attribute write carries the schema version it was
validated against. Completeness is a first-class metric per tenant. Webhook
delivery, import outcomes and judgment confidence distributions are all
dashboards, because a calibrated model whose calibration nobody watches is a
model nobody can trust in a year.

---

## 19. Scope and phasing

### Phase 1 — MVP

The smallest thing that is honestly usable and honestly safe:

1. Registry: sections, attribute definitions, requiredness (`always` and
   `conditional` on legal entity, country and employment type), publish and
   version.
2. Core typed person record, all states, effective dating, corrections, history.
3. Completeness evaluation, tasks and reminders.
4. Default sections and attributes, plus country packs for the launch countries.
5. The settings screen, including the impact preview.
6. Onboarding flow, resumable, mobile-first.
7. Employee and HR profile screens, with field-level authorization.
8. The first-employee reconciliation, both directions.
9. Events: schema and person, into the outbox.
10. GraphQL subgraph, REST API, signed webhooks, the published schema artifact.
11. Runtime policy registry feeding redaction, the AI deny list, DSAR and
    retention.
12. CSV and XLSX import with the dry run, and CSV/XLSX export with the two
    header rows. Migration is how a customer's first 400 people arrive, so it
    is not a Phase 2 nicety.
13. A first analytics set: headcount trend, composition, completeness by
    section, and the expiry timeline.
14. Every screen working at 390×844.
15. `just standalone people` green.

**MVP definition**: a customer can define their employee record, invite their
people, have them fill it in, see what is missing, and integrate against it —
with every field classified.

### Phase 2

PDF exports — the employee record and the roster — and the DSAR pack. Document
import with filename matching. The TypeSafe classification suggestion and
column mapping. The effective-dated history UI ("what did this look like in
March"). Custom visibility rules beyond the presets; the full predicate editor
for conditional requiredness; bulk edit grids. The rest of the chart set:
movement waterfall, attrition, tenure, span of control, onboarding funnel,
joiner heatmap. Saved segments and scheduled reports. The aggregate reporting
surface for voluntary self-ID.

### Phase 3

SCIM 2.0; mirror mode and per-attribute external ownership; duplicate detection
and merge; automated anonymisation on retention expiry; document attributes
wired to the Documents module; approval workflows on sensitive changes via
Temporal; pay distribution and compa-ratio charts behind the finance relation.

### Out of scope

Payroll calculation. Performance reviews. Document storage itself. Applicant
tracking. Org chart *editing* as a visual tool — People owns the data, a future
module owns the canvas. Time and attendance. Benefits administration beyond
recording an enrolment. **Cross-module analytics** — absence rates, pay against
performance, cost per hire — which belong to a Reporting module and reach these
facts through events and the API. A chart that needs another module's data is
how People stops being sellable alone.

---

## 20. User stories

### Story 1 — Priya adds a field her works council asked for

**As an** HR operations lead
**I want to** add a "Works council representative" field to HR information
**So that** I can answer a compliance question without raising a ticket

**Acceptance criteria**

- [ ] I can create the attribute, choose a type, write help text and publish it
      in under five minutes with no deploy.
- [ ] The classification step is pre-filled and I can change it in one click.
- [ ] Before publishing I see how many people become incomplete.
- [ ] After publishing, the field appears on every profile and in the API's
      schema, and the version number increments.
- [ ] A webhook fires to every subscribed endpoint within five seconds.
- [ ] If I choose a name that already exists, I am told before I publish, not
      after.

### Story 2 — Adam fills in his profile on a train

**As a** new employee
**I want to** complete onboarding on my phone in several sittings
**So that** I am not stuck doing it on a laptop on my first morning

**Acceptance criteria**

- [ ] Each section saves on its own; closing the tab loses nothing already saved.
- [ ] Required fields are visibly distinct from optional ones.
- [ ] Each section says who will be able to see what I type there.
- [ ] Every control meets the 44px tap floor without the page asking how wide my
      screen is.
- [ ] An invalid national identifier tells me which part is wrong, in my
      country's own terminology.
- [ ] I am never asked for a bank account on the auth origin.

### Story 3 — Marco sees his team and nothing else

**As a** line manager
**I want to** see my team's working pattern, location and time zone
**So that** I can schedule around them

**Acceptance criteria**

- [ ] I see every attribute whose visibility includes `manager`, and no others.
- [ ] A field I may not read is **absent**, not present-and-null.
- [ ] The same rule applies identically through GraphQL, REST and export.
- [ ] I cannot reach a salary, a date of birth or a diversity answer by any
      transport, including a crafted query.

### Story 4 — Ines sets up a new customer

**As a** CX operator
**I want to** create a company and invite its first administrator
**So that** they can configure their own employee record

**Acceptance criteria**

- [ ] The invitation works with the People module absent, present but unpublished,
      and fully configured.
- [ ] A provisional person exists within a second of the account being provisioned.
- [ ] The administrator's first sign-in lands on the setup wizard.
- [ ] I never see employee personal data in the back office.
- [ ] Enabling People on a tenant with existing accounts reconciles them, and
      running it twice changes nothing.

### Story 5 — An integrator builds against People with no Kithena UI

**As a** third-party integrator
**I want to** read the schema, read and write people, and subscribe to changes
**So that** I can keep a customer's systems in step

**Acceptance criteria**

- [ ] I can fetch a pinned schema version and generate types from it.
- [ ] Writes are idempotent under a key I supply.
- [ ] Webhooks are signed, ordered per person, retried, and replayable.
- [ ] A payload never carries a field my endpoint is not allowed.
- [ ] `just standalone people` proves the whole surface works with no other
      module present.

### Story 6 — Priya migrates 412 people from a spreadsheet

**As an** HR operations lead
**I want to** import our existing employee spreadsheet
**So that** I do not type 412 records into a form

**Acceptance criteria**

- [ ] Columns are mapped for me, and I see and can change every mapping before
      anything is written.
- [ ] A column matching nothing is never silently dropped — I ignore it, map
      it, or turn it into a new field with its classification.
- [ ] The dry run tells me how many rows create, update, block and duplicate,
      and how many will import **incomplete**.
- [ ] A row missing a work email is blocked and named. A row missing a cost
      centre imports and shows as incomplete.
- [ ] An invalid date blocks its row and names the cell; the other 411 proceed.
- [ ] Re-uploading the same file reports "already imported" rather than
      creating 412 duplicates.
- [ ] I can download the blocked rows, fix them, and import just those.

### Story 7 — Finance asks for the register, and a manager asks for their team

**As a** finance lead
**I want to** export the employee register to Excel
**So that** I can reconcile it against the payroll run

**Acceptance criteria**

- [ ] Every field I can read is a column, including fields Acme invented, in
      the same order as the profile screen.
- [ ] Salary is a numeric cell with a currency format, not text, and sums.
- [ ] A missing required value is an amber cell with a comment, and appears on
      a **Missing information** sheet.
- [ ] Emergency contacts are their own sheet, not `contact_1_name` through
      `contact_4_email`.
- [ ] An "About this export" sheet states the schema version, the `asOf` date,
      the filter and who ran it.
- [ ] A manager running the same export gets only the fields a manager can
      read, and the PDF footer says how many fields were withheld.
- [ ] I can edit the file and re-import it, and only what I edited changes.

### Story 8 — Priya opens analytics on a Monday

**As an** HR operations lead
**I want to** see headcount, what moved, and where our data is thin
**So that** I can answer the leadership question before the meeting

**Acceptance criteria**

- [ ] Headcount, joiners and leavers reconcile — the waterfall adds up to the
      closing number.
- [ ] Completeness by section shows me exactly which field is dragging.
- [ ] Permits and fixed-term contracts expiring in 90 days are a timeline I can
      act on, not a number.
- [ ] Any breakdown touching voluntary self-ID refuses below the cohort
      minimum, including in the tooltip and the export.
- [ ] Every chart has a table equivalent for a screen reader.
- [ ] The same page works on my phone on the train — fewer ticks, scrollable,
      data one tap away.

### Story 9 — A works council asks what the system holds

**As a** data protection officer
**I want to** produce a complete field inventory and a subject access export
**So that** I can answer within the statutory window

**Acceptance criteria**

- [ ] The field inventory is generated from the live registry, including every
      tenant-defined attribute, and is never hand-maintained.
- [ ] A DSAR export for one person contains every exportable attribute including
      custom ones, and completes in under a minute.
- [ ] No attribute anywhere lacks a classification.
- [ ] An integration test asserts that no special-category attribute is
      AI-eligible or event-included.

---

## 21. Risks

| Risk | Probability | Impact | Mitigation |
| --- | --- | --- | --- |
| Runtime classification is skipped or defaulted carelessly, and personal data reaches a log or a prompt | Medium | **High** | No default that means "later"; `NOT NULL` policy; downgrades never automated; quarterly audit; an integration test asserting the invariant |
| JSONB custom attributes make directory queries slow at 50k people | Medium | Medium | `indexed` promotes to a generated column; GIN for containment; the directory reads a projection, not the person table |
| The predicate language grows into a programming language | Medium | Medium | Closed grammar, fixed operand set, no user-authored expressions. Every extension is a product decision with a migration |
| An HR admin marks six fields required and mails four hundred people | High | Medium | Impact preview before publish; `requiredFrom`; one reminder per person per week regardless of field count |
| Identity and People name copies drift | Medium | Medium | One direction only — People publishes, identity consumes. A contract test asserts the direction |
| A tenant-defined attribute holds a national identifier without being marked as one | Medium | High | Type catalogue makes the right type easy; free-text risk judgment floors at confidential; the safety screen flags it |
| TypeSafe unavailable or miscalibrated | Medium | Low | Every judgment is advisory with a code fallback; the module functions with no key configured; confidence distributions are monitored |
| Merging two person records loses history | Low | High | Merge is additive — both histories survive, the absorbed record becomes a tombstone pointing at the survivor. Never a delete |
| Webhook replay leaks a field an endpoint's allowlist later removed | Low | Medium | Replay re-filters against the **current** allowlist, not the one in force at delivery |
| An export becomes the hole in the permission model | Medium | **High** | An export is a read and runs the same field-level check; no "export all" path exists; every export is an event with actor, fields and row count |
| A migration imports a "Notes" column as internal free text | High | High | An unmatched column cannot be imported without going through the field editor, classification step included; the free-text risk judgment floors it at confidential |
| An admin blocks their own migration by requiring a field their old system never held | High | Medium | Only core identity fields block a row. Everything else imports incomplete, which is the same answer §8.4 gives |
| Analytics quietly re-identifies someone through a small cohort | Medium | **High** | Cohort minimum enforced in the query, the tooltip and the export — not in the chart component |
| Charts drift from the data because someone exports a PNG | Medium | Low | There is no PNG export. Chart data exports as CSV/XLSX; the chart itself only appears inside a generated PDF that carries its own provenance |
| Scope creep into payroll, performance or documents | High | Medium | §19 out-of-scope list; `dependsOn: []` stays empty and any pressure on it is a boundary discussion, not a code change |

---

## 22. Dependencies

**Depends on**

- `platform/identity` — accounts, the `account.provisioned` event, the internal
  HTTP endpoint for reconciliation, and the new `account.profile_captured`
  event (§5.1), which is a change identity must make.
- `platform/messaging` — reminder emails, over internal HTTP, per the existing
  port.
- `packages/contracts` — the envelope, classification registry, `PersonName`,
  `PersonProfile`, `PostalAddress`, `Money`, `Period`.
- `packages/ui` (Reach) — every screen. Where it lacks something, it is added to
  Reach first as a variant on the closest component. The chart set is already
  there and hand-drawn, per the existing decision — but see the blocker below:
  four of the charts these screens need exist and are not exported.
- `Dropzone`, `FileUploader` and `ImageUploader` for import and document
  attachment. All three already ship.
- OpenFGA for relations, Redpanda for events, Atlas for migrations.
- TypeSafe, optionally, for the judgments in §12. Not a boot requirement.

**`dependsOn` in the manifest stays `[]`.** Identity and messaging are platform
services, not modules, and the events People consumes are read as contracts. The
module boots and passes its acceptance suite with no sibling module present.

**Blockers**

- `identity.account.profile_captured` does not exist. Until it does, a name
  captured at enrolment is invisible to People and step 5 of §8.2 is manual.
- `HorizontalBarChart`, `StackedBarChart`, `HeatmapChart` and `FunnelChart` are
  implemented in `packages/ui/src/components/chart/chart.tsx` and have stories,
  but are **not exported from `packages/ui/src/index.ts`**. Composition,
  completeness, the joiner heatmap and the onboarding funnel all need them. The
  fix is four lines on the existing export block, not new components.
- The country packs need a source of truth per country. Spain, the UK, Germany,
  India and the US are the launch set based on the existing address rules; each
  needs a review by somebody who knows that country's employment paperwork.

---

## Appendix A: Default attribute inventory

Shipped defaults. Every one is relabellable; the ones marked **core** cannot be
deleted and cannot have their classification loosened.

### Personal information

`legal_given_name`**core**, `legal_family_name`**core**, `preferred_name`,
`pronouns`, `date_of_birth`**core**, `place_of_birth`, `nationalities`
(multi-select country), `marital_status`, `personal_email`, `personal_mobile`,
`home_address` (address), `languages_spoken`, `photo` (image).

### Identification & right to work

`national_id` (country-typed, encrypted), `tax_id` (encrypted), `passport_number`
(encrypted), `passport_country`, `passport_expiry`, `visa_type`,
`work_permit_number` (encrypted), `work_permit_expiry`,
`right_to_work_checked_on`, `right_to_work_checked_by`, `driving_licence_number`
(encrypted), `sponsorship_required` (boolean).

### Emergency contacts *(repeating)*

`contact_name`, `relationship`, `primary_phone`, `alternate_phone`,
`contact_email`, `contact_address`, `is_primary`.

### HR information

`employee_number`**core** (unique per legal entity), `status`**core**,
`hire_date`**core**, `seniority_date`, `legal_entity`**core**, `org_unit`,
`cost_centre`, `work_location`, `manager`**core**, `dotted_line_manager`,
`work_email`**core**, `work_phone`, `job_title`**core**, `job_family`,
`job_level`, `grade`, `hr_business_partner`, `badge_id`.

### Employment terms

`employment_type`**core** (permanent, fixed-term, intern, apprentice,
contractor), `contract_start`, `contract_end`, `probation_end`,
`probation_outcome`, `working_pattern` (days and hours per week),
`shift_pattern`, `fte`**core**, `working_time_percentage`,
`notice_period_employee`, `notice_period_employer`, `collective_agreement`,
`work_model` (onsite, hybrid, remote), `remote_country`,
`employment_jurisdiction`, `non_compete_months`, `mobility_clause`.

### Compensation & finance

`base_salary`**core** (money, effective-dated), `pay_frequency`,
`variable_pay_scheme`, `target_bonus_percentage`, `commission_plan`,
`allowances` (repeating), `equity_grants` (repeating), `bank_account`
(encrypted), `payment_split` (repeating), `tax_residence_country`, `tax_code`
(encrypted), `social_security_number` (encrypted), `pension_scheme`,
`pension_contribution_percentage`, `benefits_enrolment` (repeating),
`payroll_provider_ref`, `payroll_id`.

### Public profile

`display_name`, `public_photo`, `public_pronouns`, `public_job_title`,
`public_department`, `public_work_email`, `public_work_phone`, `office`,
`time_zone`**core**, `visible_start_date`, `bio`, `skills` (tags),
`interests` (tags), `social_links` (repeating), `public_languages`.

### Onboarding & offboarding

`onboarding_buddy`, `onboarding_template`, `onboarding_state`,
`first_day_location`, `equipment_assigned` (repeating),
`termination_date`**core**, `last_working_day`**core**, `termination_type`
(resignation, dismissal, redundancy, end of contract, retirement, death in
service), `termination_reason` (free text, confidential),
`eligible_for_rehire`, `exit_interview_completed`, `handover_owner`,
`final_pay_date`, `assets_returned`.

### Education & experience *(repeating)*

`institution`, `qualification`, `field_of_study`, `start_year`, `end_year`,
`certification_name`, `certification_issuer`, `certification_expiry`,
`prior_employer`, `prior_role`, `prior_period`.

### Assets & access *(repeating)*

`asset_type`, `asset_identifier`, `assigned_on`, `returned_on`,
`software_licence`, `building_access_level`, `system_access` (repeating).

### Health & safety

`occupational_health_check_date`, `workplace_accommodations` (special-category),
`dietary_requirements` (special-category), `medical_notes` (special-category),
`accessibility_needs` (special-category).

### Diversity & voluntary self-identification

`ethnicity`, `gender_identity`, `disability_status`, `veteran_status`,
`caregiver_status`. All special-category, all voluntary, all aggregate-only,
all with a stored "prefer not to say". Rules per §6.7 and not tenant-editable.

---

## Appendix B: Contract sketch

The shape the Zod definitions take in `packages/contracts/src/people/`. Every
field registered with a classification policy, per the existing rule, because
these are the definitions `just codegen` walks.

```ts
export const AttributeDataType = z.enum([
  'text', 'long_text', 'number', 'decimal', 'percentage', 'money', 'boolean',
  'date', 'datetime', 'duration', 'select', 'multi_select', 'tags', 'email',
  'phone', 'url', 'country', 'currency', 'language', 'time_zone', 'address',
  'national_id', 'bank_account', 'person_ref', 'org_unit_ref',
  'legal_entity_ref', 'document_ref', 'image',
]);

export const Requiredness = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('never') }),
  z.object({
    mode: z.literal('always'),
    requiredFrom: CalendarDate.nullable(),
    appliesTo: z.enum(['all_records', 'new_records']).default('all_records'),
  }),
  z.object({
    mode: z.literal('conditional'),
    when: RequirednessPredicate,
    requiredFrom: CalendarDate.nullable(),
    appliesTo: z.enum(['all_records', 'new_records']).default('all_records'),
  }),
]);

export const WriterRole  = z.enum(['employee','manager','hr','finance','system','external']);
export const ViewerScope = z.enum(['self','manager','manager_chain','hr','finance','admin','directory']);

export const AttributeDefinition = z.object({
  key: AttributeKey,
  sectionKey: SectionKey,
  label: LocalizedString,
  description: LocalizedString.nullable(),
  dataType: AttributeDataType,
  typeConfig: AttributeTypeConfig,
  cardinality: z.enum(['single', 'repeating']),
  requiredness: Requiredness,
  ownership: z.array(WriterRole).min(1),
  visibility: z.array(ViewerScope),
  collectAt: z.enum(['signup','enrolment','onboarding','hr_only','anytime']),
  // The existing FieldPolicy interface. Not a parallel vocabulary.
  classification: FieldPolicySchema,
  classificationSource: z.enum(['human', 'suggested', 'section_default']),
  effectiveDated: z.boolean(),
  uniqueScope: z.enum(['none', 'tenant', 'legal_entity']),
  encrypted: z.boolean(),
  indexed: z.boolean(),
  includeInDirectory: z.boolean(),
  includeInEvents: z.boolean(),
  origin: z.enum(['core', 'country_pack', 'tenant']),
  deprecatedAt: Instant.nullable(),
})
.refine(
  (a) => a.classification.classification !== 'special-category' ||
         (!a.classification.aiEligible && !a.includeInEvents),
  'special-category data is never AI-eligible and never travels on an event',
)
.refine(
  (a) => !(a.classification.piiKind === 'financial') || a.encrypted,
  'financial data is always encrypted at rest',
);
```

Aggregate invariants — a required attribute cannot be invisible to everyone who
owns it; an archived section cannot hold a required attribute; a `person_ref`
cannot point outside the tenant — live in the domain objects and, where a race
is possible, in a Postgres constraint as well. A `superRefine` that queries the
database is a design error, and none appears here.

---

## Appendix C: Glossary

- **Attribute** — one field on a person record.
- **Attribute definition** — the configuration of that field: type, rules,
  policy.
- **Completeness** — whether a person has a value for every applicable required
  attribute.
- **Country pack** — a set of sections and attributes Kithena ships for one
  country's employment paperwork.
- **Effective dating** — `occurredAt` is when we recorded it; `effectiveFrom` is
  when it takes effect in the domain.
- **FieldPolicy** — classification, PII kind, exportability, AI eligibility and
  retention. The existing interface in `packages/contracts`.
- **Mirror mode** — People holds the registry and projection while an external
  HRIS owns the records.
- **Ownership** — who may write an attribute.
- **Provisional person** — a record created from an account, not yet confirmed
  as an employee.
- **Published schema version** — an immutable snapshot of the registry. What
  forms render and APIs validate against.
- **Section** — a titled, ordered group of attributes; also the default
  permission grouping.
- **Source of record** — which system owns a fact. `own` or `external`, settable
  per attribute in mirror mode.
- **System One** — TypeSafe's model class returning calibrated, typed judgments
  rather than generated text.
- **Visibility** — who may read an attribute.

---

*Requirements gathered interactively with quality scoring across business,
functional, UX and technical dimensions. Four architectural questions were
answered here rather than deferred; the reasoning is in place so each can be
argued with rather than merely obeyed.*
