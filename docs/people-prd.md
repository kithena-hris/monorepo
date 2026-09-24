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

| Question                                                       | Answer                                                                                                                           | Where                                                     |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| How are custom attribute values stored?                        | Typed columns for the core, JSONB for tenant-defined attributes, an append-only history table for the truth                      | [§11](#11-storage-design)                                 |
| What happens when a field becomes required after people exist? | Nothing blocks. The record gains a completeness state and raises a task                                                          | [§8.4](#84-when-a-field-becomes-required-later)           |
| Who classifies a runtime custom attribute?                     | HR chooses; a System One judgment pre-fills; special-category never auto-applies                                                 | [§12](#12-classification-of-tenant-defined-attributes)    |
| What does "works without the rest of the HRIS" mean in v1?     | GraphQL, REST, signed webhooks and the published schema artifact in Phase 1; SCIM and mirror mode after                          | [§13](#13-headless-surfaces)                              |
| What happens when an import is missing a required field?       | Core identity fields block the row; every other required field imports and shows as incomplete; an _invalid_ value always blocks | [§14.4](#144-when-required-fields-are-missing)            |
| How does an export handle fields the customer invented?        | Columns generated from the published schema, two header rows — label and stable key — so an edited file re-imports correctly     | [§15.2](#152-exporting-a-sheet-that-has-extra-attributes) |

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

| Metric                              | Target                                                                                             | How measured                                                                                                                           |
| ----------------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Time to add a tenant-specific field | < 5 minutes, 0 deploys                                                                             | Wall clock from opening the settings screen to the field appearing on a profile, measured in the acceptance suite and on a real tenant |
| Required-field completeness         | ≥ 95% of active employees complete within 30 days of a schema publish                              | `people.person.profile_completed` and `profile_incomplete` counts per tenant                                                           |
| Completion turnaround               | Median < 3 days from a field becoming required to the record being complete                        | Time between `profile_incomplete` and `profile_completed` for the same person and attribute set                                        |
| Classification correctness          | ≥ 98% agreement on a sampled audit; **zero** special-category attributes marked AI-eligible        | Quarterly audit of `people.attribute_definition` against a human review; the second number is a hard gate, not a target                |
| Person read latency                 | P95 < 120 ms for a full profile; < 300 ms for a 50-row directory page                              | Subgraph traces                                                                                                                        |
| Schema publish propagation          | P95 < 5 s from publish to webhook delivered and REST reflecting the new version                    | Webhook delivery telemetry                                                                                                             |
| Standalone boot                     | `just standalone people` green on every CI run                                                     | CI matrix                                                                                                                              |
| DSAR export                         | < 60 s, containing 100% of exportable attributes including tenant-defined ones                     | Integration test asserting the manifest against the live registry                                                                      |
| Import success                      | ≥ 95% of rows import on the first attempt for a well-formed file; every blocked row names its cell | Import reports, sampled per tenant                                                                                                     |
| Import turnaround                   | A 5,000-row migration from upload to committed in < 10 minutes including the dry run               | Wall clock on the import job                                                                                                           |
| Export round-trip                   | An export edited in Excel and re-imported changes only what was edited — zero unintended writes    | Contract test over export → edit → import                                                                                              |
| Analytics freshness                 | Snapshot-backed charts no more than 24 h stale; the staleness is stated on the card                | Snapshot job telemetry                                                                                                                 |
| Mobile completion                   | ≥ 80% of onboarding completions happen on a phone without a desk session                           | Session telemetry by pointer type                                                                                                      |

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

- **Role**: creates customers, invites the first administrator, switches
  modules on and names who administers People, fixes things.
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

| Fact                                            | Identity holds it because                                                                                         | People's relationship to it                                                                                         |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `work_email`                                    | It routes the invitation and names the account                                                                    | **Projection.** Read-only in People. Changes go through identity's API                                              |
| `time_zone`                                     | Decides when a start date and a last working day fall                                                             | **Projection**, with People as the editing surface via identity's API                                               |
| `employment_start`                              | Gates enrolment — a hire entered three weeks early must not be able to log in                                     | **People is the source of record.** Identity holds a cached copy and corrects it from People's events               |
| `given_name` / `family_name` / `preferred_name` | Rendered in the WebAuthn prompt; `ada@acme.example` is a poor way to ask somebody to confirm an account is theirs | **People is the source of record once a person exists.** Identity holds a copy and corrects it from People's events |
| `mobile`                                        | A second channel for HR-mediated recovery. Never a sign-in factor                                                 | **People is the source of record once a person exists.** Same correction path                                       |

The rule this produces:

> **Identity owns the facts that must exist before People does. People owns them
> afterwards. The copies are reconciled by events in one direction only —
> People publishes, identity consumes.**

**Which name wins at enrolment.** The person types a name on the enrolment
form. If People has not yet written the account's name, identity stores what
was typed. If it has — `platform.account.people_facts_at` is set once People's
first correction is applied — identity keeps People's and does not overwrite
it. Either way identity publishes `identity.account.profile_captured` with what
was typed, and People fills its own name from it only when its own is empty.
A later correction from People still applies as usual, so the two cannot drift.

That direction matters. A tenant with no People module keeps identity's copies
as the only truth, which is exactly what `requiresPeopleSource` is for. A tenant
with People gets one editing surface and one source of record, and the two rows
cannot drift because only one of them is ever written by a human.

**Access ends with employment (PEO-109).** Who may sign in is identity's
question, but *when employment ends* is People's fact, so People decides the
moment and identity acts on it — the same one direction:

- At the end of a leaver's last working day **on their own calendar** (§6.8)
  — Auckland's 30th at 11:00 UTC on the 30th, Los Angeles's at 07:00 UTC on
  the 1st — People's hourly lifecycle job raises `people.person.access_ended`,
  once, effective from the first day without access, carrying that midnight
  as `endedAt`. **Whether or not HR has confirmed the termination**: a person
  on `notice` whose last day has ended loses access exactly as a terminated
  one does. Confirming the termination is paperwork, which the
  `confirm_termination` row still asks HR for (§8.1, §8.4); ending access is
  security, and it does not wait for paperwork.
- For a dismissal for cause HR ends it at once instead: `endAccessNow` on the
  termination, or `POST /v1/people/{id}/access/end` after it. HR only, and the
  event names who did it.
- Identity consumes it and **suspends** the account (reason
  `employment_ended`): no sign-in, every live session revoked so a cookie is
  refused on its next request, every live enrolment link spent. Suspended,
  never terminated or deleted, and the passkeys are kept, so a rehire (§8.1)
  signs in with the one they already have. Idempotent on the event and blind
  to a stale one (`people_access_at`, the `people_facts_at` guard for access).
  An account identity had already suspended for its own reason keeps it.
- **A rehire gives it back (PEO-110).** When a rehired person's new employment
  starts on their calendar — with the rehire if the start has come, else by
  the same hourly job that starts pre-hires — People raises
  `people.person.access_restored`, and identity reinstates the account to the
  status People's suspension took it from (an invited account that never
  enrolled goes back to invited). The same account, the same passkeys; the
  new start reaches identity first on `identity_facts_changed`, so its
  enrolment gate reads the new date. Identity's own suspensions are left for
  an admin to lift.

A tenant without People never raises either event, and its accounts end the
way they always have — an admin suspends or terminates them in identity.

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

| Field                | Type                                 | Purpose                                                                                                                                                                                                                                                               |
| -------------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `key`                | slug, immutable                      | Stable identifier in payloads, exports and integrations. Chosen once. A rename is a new attribute plus a migration of values, offered as an explicit action, never an in-place edit                                                                                   |
| `label`              | localized string map                 | What a human sees. Localized because the product is; the key never is                                                                                                                                                                                                 |
| `description`        | localized string, nullable           | Help text under the field. Worth more than most validation                                                                                                                                                                                                            |
| `sectionKey`         | ref                                  | Which section it appears in                                                                                                                                                                                                                                           |
| `order`              | int                                  | Position within the section                                                                                                                                                                                                                                           |
| `dataType`           | enum                                 | See §6.4                                                                                                                                                                                                                                                              |
| `typeConfig`         | JSON, type-discriminated             | Options for a select, min/max for a number, currency for money, country for a national identifier, accepted MIME types for a document                                                                                                                                 |
| `cardinality`        | `single` \| `repeating`              | A repeating attribute is a group — emergency contacts, education, equity grants                                                                                                                                                                                       |
| `requiredness`       | rule                                 | See §6.5                                                                                                                                                                                                                                                              |
| `ownership`          | set of writer roles                  | Who may write it: `employee`, `manager`, `hr`, `finance`, `system`, `external`                                                                                                                                                                                        |
| `visibility`         | rule                                 | Who may read it: `self`, `manager`, `manager_chain`, `hr`, `finance`, `admin`, `directory`                                                                                                                                                                            |
| `collectAt`          | enum                                 | `signup`, `enrolment`, `onboarding`, `hr_only`, `anytime` — which moment asks for it                                                                                                                                                                                  |
| `classification`     | `FieldPolicy`                        | The existing contract shape: classification, piiKind, exportable, aiEligible, retention                                                                                                                                                                               |
| `effectiveDated`     | boolean                              | Whether a change to this value is a dated fact (salary, job title) or a correction (a typo in a phone number)                                                                                                                                                         |
| `unique`             | `none` \| `tenant` \| `legal_entity` | Employee number (per legal entity), national identifier (per tenant: it names one human, and a tenant holds one record per human), work email. Enforced on a keyed hash of the normalised value, never the value, so an encrypted attribute may be unique too (§11.2) |
| `encrypted`          | boolean                              | Forced true for `piiKind: 'financial'` and for national identifiers. Value lives in `people.person_secret`, never in JSONB and never in an event                                                                                                                      |
| `indexed`            | boolean                              | Promotes the attribute to a generated column so it can be filtered and sorted at directory scale                                                                                                                                                                      |
| `includeInDirectory` | boolean                              | Appears in the searchable employee directory                                                                                                                                                                                                                          |
| `includeInEvents`    | boolean                              | Whether the value — not just the key — rides on the Kafka payload. Defaults to false for anything `confidential` or above, and cannot be set true for special-category data                                                                                           |
| `deprecatedAt`       | timestamp, nullable                  | Hidden from forms, still exported, still in history. The honest alternative to deleting a field somebody's integration reads                                                                                                                                          |
| `origin`             | `core` \| `country_pack` \| `tenant` | Whether Kithena ships it, a country pack ships it, or the customer invented it                                                                                                                                                                                        |

**Core attributes cannot be deleted, and their classification cannot be
loosened.** A tenant may relabel `hire_date`, may not make it optional, and may
not mark a national identifier AI-eligible. The registry enforces a floor; the
tenant configures above it.

### 6.3 Sections

Shipped defaults, all of which a tenant may rename, reorder, extend or hide.
Sections are presentation _and_ a permission grouping — a visibility rule set on
a section is the default for every attribute in it, which is how Priya avoids
setting twenty rules by hand and how Marco avoids seeing a salary by accident.

| Section                        | Default visibility | Default ownership     | Notes                                                                                                                                     |
| ------------------------------ | ------------------ | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Personal information           | self, hr           | employee, hr          | Name, preferred name, pronouns, date of birth, nationality, personal contact, home address, photo                                         |
| Identification & right to work | hr                 | hr, employee          | National identifiers, passport, visa, permit expiry, right-to-work check. Heavily country-dependent                                       |
| Emergency contacts             | self, hr           | employee              | Repeating. Nobody else needs these, including the manager                                                                                 |
| HR information                 | self, manager, hr  | hr                    | Employee number, status, hire date, legal entity, department, location, manager, job title, level                                         |
| Employment terms               | self, hr           | hr                    | Contract type and dates, working pattern, FTE, probation, notice, collective agreement, work model                                        |
| Compensation & finance         | self, finance, hr  | finance, hr, employee | Salary, pay frequency, variable pay, bank account, tax and social security, pension. Bank details are employee-owned and finance-readable |
| Public profile                 | directory          | employee              | Display name, photo, title, department, work contact, time zone, bio, skills, languages                                                   |
| Onboarding & offboarding       | hr, manager        | hr                    | Buddy, checklist state, equipment, termination fields                                                                                     |
| Education & experience         | self, hr           | employee              | Repeating. Degrees, certifications with expiry, prior employment                                                                          |
| Assets & access                | self, manager, hr  | system, hr            | Devices, licences, building access                                                                                                        |
| Health & safety                | hr                 | hr, employee          | Occupational health, accommodations, dietary requirements. Article 9 throughout                                                           |
| Diversity & voluntary self-ID  | **nobody**         | employee              | Special category, voluntary, answerable only in aggregate. See §6.7                                                                       |
| _(tenant-defined)_             | tenant's choice    | tenant's choice       |                                                                                                                                           |

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
archived attribute, say — is treated as _not required_ and raises an operational
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

**As built (PEO-092).** The model is People's own OpenFGA store, `people`,
found by name or created on boot, with the model in
`services/people/src/infrastructure/openfga.ts`:

```
type tenant   hr, finance, people_admin: [user]
type person   account: [user]                  (§6.6's `self`; OpenFGA reserves the word)
              reports_to: [person]
              manager: account from reports_to
              manager_chain: manager or manager_chain from reports_to
```

- **Two tuples a person, at most**: the account they sign in as, and the
  person they report to. A manager is whoever signs in as that person, so a
  manager changing account or leaving touches nothing on their reports, and a
  move is one tuple replaced — the old chain loses the person in the same
  write the new one gains them.
- **Written from People's own events** — `provisioned`, `identity_linked`,
  `hired`, `manager_changed`, `org_changed`, `status_changed`, `terminated`,
  `anonymised` — by the consumer on People's topic. The event says which
  person to look at; the row says what the tuples should be. That makes it
  idempotent and indifferent to order, on top of the per-person ordering the
  outbox's partition key already gives. A leaver's `account` tuple goes, so
  their reports' chain skips them.
- **`manager_changed` and `org_changed` are raised** when an update moves
  `manager_id`, or any of `org_unit_id`, `cost_centre`, `legal_entity_id`,
  `location_id`: `profile_updated` names keys and never values, so the tuples
  could not be written from it.
- **Tenant roles (PEO-112).** Nobody holds a role for having arrived first.
  The back office names the first People administrator — an existing account
  — when it switches People on, or later for a company that has lost every
  one (`identity.tenant.administrator_named`, §8.2); People then grants that
  account `people_admin` and `hr`. Every other grant and revocation is a
  People administrator's, through `TenantRoles` in the application layer:
  - only a `people_admin` grants or revokes;
  - nobody grants a role to themselves;
  - the last `people_admin` is never revoked — not even by themselves — and
    a trigger on `people.role_grant` refuses it for any path that skips the
    application; the one exception is a leaver, whose roles all end with
    their access (§8.1; the trigger lets a grant go once its account's
    person has `access_ended_at`, 20260924280000);
  - each needs a reason, up to 500 characters;
  - a role already held, or not held, changes nothing and raises nothing.

  The ledger is `people.role_grant` (20260924270200): a grant is a row and a
  `people.role.granted` event (`revoked` for the reverse) in one
  transaction, carrying who (`by`, and the envelope's actor), whom, which role,
  `via` (`people` or `back_office`) and the reason, classified free text. The
  consumer brings that account's tenant tuples in line with the rows
  (`OpenFga.syncRoles`) — the row is the truth, as `people.person` is for the
  person tuples, so nothing is written to OpenFGA beside the database. The
  rules are asked of the rows under a per-tenant advisory lock, so two
  administrators revoking each other at once cannot leave none. Tenants that
  relied on the old first-person rule keep what it granted: the migration
  carries it over.

  With OpenFGA, every transport resolves the caller's tenant roles from these
  tuples once per request (`withTenantRoles`), so a grant takes effect once the
  event is consumed. A role claimed in the forwarded principal is ignored. The
  code that reads `viewer.roles` (settings, legal entities, finance's full
  values) therefore sees OpenFGA's answer.
- **The manager chain is the reporting line.** Org units have no heads in the
  data yet, so an org unit grants nothing; `org_changed` re-syncs the person and
  is where that would start.
- **Standalone.** With `OPENFGA_URL` unset, the same questions are answered
  from `people.person` and the roles on the forwarded principal. That is what
  `just standalone people` runs, and it needs no OpenFGA.
- **Freshness.** Tuples follow the outbox, so a relation lags a write by the
  time Debezium and the consumer take. A new report is visible to their
  manager once the event is consumed, not in the same response.

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

### 6.8 Legal entities, locations and whose day it is

A calendar date is not an instant. "Required from the 1st", "last working day
plus 48 months" and "headcount today" all compare a date with _today_, and at
11:30 UTC on 1 March today is the 2nd in Auckland and still the 1st in Los
Angeles. So People owns two small objects whose job is to say whose today it
is, and one tenant setting as the last resort:

```
people.legal_entity   The employer of record. A name, a country, a default
                      IANA time zone. The country decides which country pack
                      and which numbering apply; the zone decides whose day the
                      entity's aggregates are counted on.
people.location       Where somebody works. A name, a country, a legal entity
                      it belongs to, and an IANA time zone that is
                      effective-dated: an office moving to the Canaries on
                      1 April is on Canary time from midnight on 1 April,
                      Canary time.
people.tenant_settings  The tenant's default zone, the cohort minimum (§16.1),
                      and a copy of the company's slug (`<slug>.app…`) and
                      name from the back office, for links and reminders.
```

**A person's zone** is, in order: their `work_location`'s zone on that
instant, else their `legal_entity`'s default, else their own `time_zone` (the
copy identity holds, §5), else the tenant default. A location or entity the
tenant does not have, or an own zone that is not an IANA zone, is skipped
rather than trusted. A tenant nobody has configured runs on UTC.

**An aggregate's day** is a legal entity's: a company-wide figure is counted
per legal entity, each on that entity's own day at the moment of counting, and
a tenant-wide figure is the sum of the per-entity figures. Somebody with no
legal entity is counted on the tenant default's day. A location's zone never
decides an aggregate, so an office in the Canaries does not split its Madrid
entity's headcount across two days.

What that means for the attributes that point at them:

- `legal_entity` (`legal_entity_id`) and `work_location` (`location_id`) are
  references to these rows. Setting either can move a person onto another
  calendar, and the move takes effect for every person-level rule from the
  next evaluation — nothing is back-dated by it.
- `time_zone` stays identity's projection (§5). It is the person's own zone
  and it only decides their day when neither their location nor their entity
  does.
- `employee_number` is numbered per legal entity (§9.4) — each entity its own
  prefix and sequence — which is why the entity is a row with an id rather
  than a label. The number itself is unique in the whole tenant, so it names
  one person whichever entity it came from.

Zones are IANA names, validated against the runtime's own database (`Intl`)
where they are written; an offset such as `UTC+2` is refused, because it has no
daylight saving and is wrong for half of every year somewhere. A location's
zone change is an effective-dated fact with the correction path of §8.5: a
second change dated the same day supersedes the first. An entity's default
zone and the tenant default are configuration, changed when recorded.

Entities and locations are archived, never deleted: a person's history names
them, and an archived entity still decides its people's day.

---

## 7. Who creates what, and where it lives

The question the brief asked most directly. Read this table as: for each group of
facts, who is capable of writing it, at which moment, and which service's
database the bytes end up in.

| Fact group | Created by | At which moment | Lives in |
| --- | --- | --- | --- |
| Tenant, slug, branding, auth policy | CX operator | Back-office company creation | `platform.tenant`, `platform.tenant_auth_policy` |
| Modules the company bought (entitlements) | CX operator | The company wizard, then the company page, any time | `platform.tenant.entitlements`; People's copy in `people.tenant_settings` from `identity.tenant.entitlements_changed` |
| First account (work email, start date, time zone) | CX operator | Back-office invitation | `platform.account` |
| Enrolment token | Identity | Invitation | `platform.enrolment_token` (hash only) |
| Legal name, preferred name, mobile, time zone | The person | Enrolment, on the auth origin | `platform.account`, projected into People |
| Provisional person record | People, from `identity.account.provisioned` | Automatically, within the second | `people.person` |
| Schema: sections, attributes, requiredness | HR admin (`people_admin`) | Settings, any time | `people.section`, `people.attribute_definition`, `people.schema_version` |
| Tenant roles: `hr`, `finance`, `people_admin` (§6.6) | The back office names the first People administrator; after that, a People administrator | Switching People on; then settings, any time | `people.role_grant`, and OpenFGA's tenant tuples from `people.role.*` |
| Employee numbering schemes: prefix, width, next number (§9.4) | HR admin (`people_admin`) | Settings, any time | `people.employee_numbering` |
| Legal entities, locations and their time zones (§6.8) | HR admin (`people_admin`); the first entity from the back office's company wizard | Tenant creation, then settings, any time | `people.legal_entity`, `people.location`, `people.location_zone` |
| Tenant default time zone, cohort minimum | HR admin (`people_admin`); the default zone first from the company wizard | Tenant creation, then settings | `people.tenant_settings` |
| Country pack defaults | Kithena | Tenant creation, by legal-entity country | Same tables, `origin: 'country_pack'` |
| Personal information | The employee; HR may correct | Onboarding, then any time | `people.person`, `people.person_attribute_history` |
| Identification, right to work | HR, with employee-supplied values | Onboarding | `people.person_secret` (encrypted) plus history |
| Emergency contacts | The employee | Onboarding, then any time | `people.person` (JSONB, repeating) plus history |
| HR information | HR | Hire, then on change | Typed columns plus history |
| Employment terms | HR | Hire, then on change | Typed columns plus history |
| Salary, variable pay | HR or finance | Hire, then effective-dated changes | Typed columns, encrypted where financial, plus history |
| Bank account, tax identifiers | The employee | Onboarding | `people.person_secret` only |
| Public profile | The employee | Any time | `people.person` plus history |
| Employee number | People, from the legal entity's numbering scheme (§9.4); HR or an import where it has none, or to set one by hand | Hire | `people.person.employee_number`; the sequence in `people.employee_numbering` |
| Manager, org unit | HR | Hire, then on change | Typed columns; emits `manager_changed` |
| Onboarding checklist state | System, from the Onboarding module or People's own minimal version | Automatically | `people.person` |
| Termination facts | HR | Offboarding | Typed columns; emits `terminated` |
| Employment periods: each hire and rehire, its legal entity, last working day, leaving reason, rehire eligibility and any rehire override | People, from HR's hire, notice, termination and rehire (§8.1) | Hire, then each lifecycle move | `people.employment_period`, one row per employment; the dates also as `hire_date` / `last_working_day` history |
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
                   ┌───────────┐
                   ▼           │  start date corrected into the future
provisional ──▶ pre_hire ──▶ active ──▶ on_leave ──▶ active
     │              │           │
     │              │           ├──▶ notice ──▶ terminated ──▶ rehired (new period) ──▶ pre_hire | active
     │              │           │      │            │         access back when it starts (PEO-110)
     │              │           │      │            └ end of last working day, own calendar:
     │              │           │      │              access ends, on notice or terminated
     │              │           │      │              (identity suspends; PEO-109)
     │              │           │      ├ last working day passed: HR confirms (a task, not a date)
     │              │           │      └ withdrawn before the last day ends ──▶ active | on_leave
     │              │           │        (the status notice was given from; PEO-111)
     │              │           │
     └──────────────┴───────────┴──▶ discarded          (provisional only)
```

- **provisional** — an account exists, a person record has been created from it,
  and no HR has confirmed it is an employee. Required fields do not apply.
- **pre_hire** — confirmed, with a start date in the future. Required fields
  apply to whatever is `collectAt: signup | enrolment | onboarding`; an
  `hr_only` or `anytime` field waits for the start date. The filter is in the
  one function every reader of completeness calls, so the publish preview, the
  recompute, a record's own verdict, the import dry run (which judges a hired
  row in the state the commit will leave it in) and an export's grey
  not-applicable cells all agree. Analytics counts missing fields for active,
  on-leave and notice records only.
- **active** — started. All applicable required fields apply. A pre-hire
  becomes active on their start date without anybody pressing anything: an
  hourly job starts every pre-hire whose start date has begun on their own
  calendar (§6.8) — Auckland's 1st at its midnight, Los Angeles's at its own —
  raising `status_changed` (reason `started`, effective from the start date)
  and, for a linked person, `identity_facts_changed`, and re-judging their
  completeness. Bounded per run, one transaction per person, and idempotent:
  a second replica or a re-run finds nobody left to start.
- **on_leave**, **notice** — active variants; relevant because requiredness
  predicates can name them.
- **terminated** — a tombstone. The record survives; employment records outlive
  employment, and `platform.tenant` already makes the same argument about
  customers. Retention and anonymisation act on this state, on a schedule.
- **discarded** — a provisional record that was never a person. The only state
  that permits a hard delete, and only before confirmation.

**A corrected date re-reads the state; it never ends employment.** The two
definitions above are about dates, so a correction to one of those dates
(§8.5) can make the state false, and it is re-read in both directions:

- A **pre_hire** whose start date is corrected to today or earlier has started,
  and becomes **active**.
- An **active** person whose start date is corrected into the future has not
  started, and returns to **pre_hire**. Everything that reads the state follows
  it back: required fields are those of a pre-hire again, headcount stops
  counting them, and identity learns the later start date, which is the date
  it gates enrolment on.
- A person on **notice** whose last working day is corrected to a date already
  past **stays on notice**. Termination is a deliberate act, so HR gets a task
  to confirm it, in the same grid as HR's missing fields (§8.4) rather than one
  task per person. The task is read off the state and the date: it closes when
  HR terminates or corrects the date forward. Their access ended at the end
  of the old day all the same (§5); **corrected forward to a day that has not
  ended on their calendar**, it comes back in the correction's transaction —
  `access_restored`, reason `last_working_day_corrected`, and identity
  reinstates the account to the status it suspended it from, as for a rehire
  — and ends again when the new day ends. Corrected to a day that has already
  ended there (Auckland's 1st at 11:00 UTC, while Los Angeles's is still
  going), it stays ended. A terminated record keeps it ended.
- **on_leave** and **terminated** keep their state whatever either date is
  corrected to.

Each move raises `status_changed` with reason `corrected`; §8.5 says what it
is effective from.

**HR moves a person; nobody else does.** Notice, termination, leave and
discarding are HR's (§7 gives termination facts to HR), through one use case
each that every transport calls (§13). A manager, the person themselves and a
`people_admin` who is not also HR are refused. Each raises `status_changed`
through the outbox in the write's transaction, writes the lifecycle's dated
row where a date moved, and re-judges the person's completeness, because a
requiredness predicate may name the state. "Today" is the person's own (§6.8).
A request whose move has already happened — the same leave started, the same
notice or termination with the same last working day, the same discard — is
answered with the record and raises nothing.

- **Leave** — `active → on_leave → active`, effective from today. Bringing back
  somebody who was never away is refused, not answered.
- **Notice** — from `active`, and from `on_leave` (somebody resigns during
  parental leave without coming back first). Carries the last working day and
  why: `resigned` by the person, `dismissed` or `end_of_contract` by the
  employer. Effective from the day it is given; the last working day gets its
  own dated row, which is what a later correction supersedes.
- **Termination** — from `notice`, and directly from `active` or `on_leave`
  when the last day is already behind them (a leaver recorded late). Only once
  the last working day has begun on the person's calendar: before that they are
  on notice, still working and still counted. A `pre_hire` who never started
  is the exception and closes on their start date. Raises `status_changed`
  with the typed reason, then `terminated` with HR's free-text note and
  whether they are eligible for rehire, both effective from the last working
  day — which is also where retention's clock starts (§12). The `confirm
  termination` row closes on its own, being read off the status. Access
  ended at the end of that day on their calendar whether or not this has
  happened yet, or ends at once with `endAccessNow` (§5, PEO-109).
- **End access now** — `terminated` only, HR only: a dismissal for cause
  ends access this instant rather than at the end of the last working day.
  Raises `access_ended` (trigger `ended_by_hr`); once access has ended, by
  either path, a repeat is answered with the record.
- **Discard** — `provisional` only, as the diagram says.

- **Rehire** (PEO-110) — `terminated` only, HR only. **One person, many
  employments**: a new employment period on the same record, not a second
  person, so the account, the history and the DSAR subject stay one. Each
  period holds its start, legal entity, last working day, leaving reason and
  HR's eligibility for rehire (`people.employment_period`). Refused when the
  last period was marked not eligible, unless HR gives a reason, which the new
  period keeps and which raises its own audit event,
  `people.person.rehire_override` (the acting user on the envelope, the
  person, the period, the reason — no other personal data); an unknown
  eligibility is not a refusal. It starts after the
  last working day, and is `pre_hire` until the start has begun on the
  person's calendar, `active` from it. Raises `status_changed` (reason
  `rehired`) and `hired` for the new period, both effective from the start,
  `identity_facts_changed` with the new start, and `access_restored` when the
  start comes (§5). History gains a `hire_date` row and a null
  `last_working_day` row from the start, so an "as of" read in either period
  answers for that period (§8.5). Completeness is re-judged.
  **The employee number** is kept — it is the person's in the register and on
  every document — unless the legal entity they rejoin numbers its people and
  the number is not one its scheme would write; then they take that scheme's
  next number, as a new hire there would. Someone with no number rejoining an
  entity that numbers gets one. The old number stays in history.

- **Withdraw notice** (PEO-111) — `notice` only, HR only, until the last
  working day has ended on the person's calendar (during that day it is still
  allowed; after it, the answer is termination or a later rehire). Returns
  them to the status they gave notice from — `active`, or `on_leave` for
  somebody who resigned from leave; a notice recorded before periods existed
  reads as from `active`. Raises `status_changed` (reason
  `notice_withdrawn`) effective today on their calendar, and writes a
  `last_working_day` row of null that supersedes the notice's row from the
  date it was effective (§8.5), so no "as of" read shows the withdrawn end.
  With no last working day there is no access end pending (§5). Completeness
  is re-judged. A repeat is refused; a REST retry is answered by its
  Idempotency-Key.

Identity hears the end of access and its return (§5): it caches a start date,
not an end.

A person on notice whose last working day has passed without HR terminating
stays on notice — termination is HR's act — but **loses access at the end of
that day** all the same (§5): confirming the termination is paperwork, and the
`confirm_termination` row is what asks for it. Terminating afterwards raises
no second `access_ended`.

**A leaver's tenant roles end with their access.** When access ends, by
either path, People revokes every tenant role the leaver's account holds
(`hr`, `finance`, `people_admin`, §6.6) in the same transaction: one
`people.role.revoked` each, with the system as the actor (`via: system`, `by`
null) and the reason `access_ended`, and OpenFGA's tuples follow from the
events as they do for any revocation. The last `people_admin` goes too — a
leaver administers nothing — and the company's next administrator is named in
the back office, as for a company that lost every one (§8.2). **Restored access
does not restore roles.** A rehire, a withdrawn notice or a last working day
corrected forward gives the account back, and nothing else: a People
administrator grants each role again, with a reason, like any other grant.

### 8.2 The first employee

The chicken-and-egg case the brief asked about specifically, in sequence:

```
1. Ines creates the company in the back office, choosing its country (the
   registered office's) and its time zone.
     platform.tenant row. No accounts, no people.
     ──▶ identity.tenant.provisioned { slug, displayName, country, timeZone }
     People takes the zone as the tenant default, a first legal entity in
     that country and zone (§6.8), and the slug and name for its reminders.
     The first administrators' accounts carry the same zone.
     Ines ticks the modules the company bought (PEO-114).
     ──▶ identity.tenant.entitlements_changed { entitlements }
     People keeps the list; the tenant app shows only what is on it.

2. Ines invites the first administrator by work email, and — when People is
   ticked — names which of them administers People (PEO-112).
     POST /accounts on identity
     platform.account row + enrolment token (hash only)
     ──▶ identity.account.provisioned { via: 'admin_api' }
     ──▶ identity.tenant.administrator_named { entitlement: 'module.people', accountId }
     People grants that account `people_admin` and `hr`, with an event each.
     Being invited first grants nothing.

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
     a. Confirm the legal entity, its country and its time zone — already
        there from step 1, and editable.
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

  **Switching People on names its administrator (PEO-112).** The back office
  refuses to switch People on without naming one of the company's accounts
  that can still sign in, and that is the only way anybody first becomes a
  People administrator. A company whose People was on before this was
  required is given one the same way, on its page.

  **A terminated account is not listed.** It belongs to somebody who has left,
  and its work email may already be held by a new account. A leaver who never
  had a person record is not given a provisional one on the way out.

- **People is never bought.** Identity's copies stay the only truth, no People
  event ever arrives to correct them, and nothing in identity's code path checks
  for the module's presence. This is what `requiresPeopleSource` exists to keep
  honest, and `just standalone timeoff` already asserts the symmetric case.

### 8.3 The three collection moments

| Moment                 | Where it happens                                | What it may ask for                    | Constraint                                                                                                                                                                                                                                                                        |
| ---------------------- | ----------------------------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Signup / enrolment** | `auth.app.kithena.com`, before a session exists | `collectAt: signup` or `enrolment`     | Identity's own fields plus a strictly bounded set. Nothing confidential, nothing financial, nothing special-category. A person about to spend a single-use link should not be asked for a bank account, and the auth origin should not be a place where employee data accumulates |
| **Onboarding**         | The tenant app, after first sign-in             | `collectAt: onboarding`                | Sectioned, resumable, saves per section rather than per form. Shows what is required and what is optional, and says who will see each answer                                                                                                                                      |
| **Any time after**     | Profile screens                                 | `collectAt: anytime`, plus corrections | Ownership rules apply. An employee editing an HR-owned field sees it read-only with the owner named, not hidden                                                                                                                                                                   |

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
   through `platform/messaging`: on day 1 (the first sweep after the gap
   opens), then weekly until the profile is complete. Never more than one
   reminder email per person per week regardless of how many fields are
   missing — the cap is the rule, and it replaced an earlier day 1 / 3 / 7
   schedule whose day 3 would have been a second email in the same week. It
   is only ever sent between 09:00 and 18:00 on the person's own clock (§6.8)
   — see below. The email is from the company by name and links to the
   person's profile on the company's own origin (`<slug>.app…/people`), both
   from People's copy of the tenant (§9.4); until People has heard both, the
   reminder waits for a later sweep rather than going out unnamed or to
   another origin. It counts the missing details and names none of them; the
   person reads the list there, signed in.
4. Missing **HR-owned** attributes become a task for HR, aggregated: "88 people
   are missing a cost centre" with a bulk-edit grid, not 88 separate tasks.
5. The settings screen shows the impact **before** publishing: "This makes 88 of
   412 people incomplete. 61 fields are employee-owned, 27 are yours."

The preview is the part that prevents the mistake. An HR admin who can see the
consequence before committing will pick a sensible `requiredFrom` date; one who
cannot will mark six fields required on a Friday afternoon and mail four hundred
people.

**Whose day `requiredFrom` is read on.** Each person's own (§6.8): a field
required from the 24th is required in Bangalore at 01:30 on the 24th while it
is still the 23rd in Madrid. The preview takes one instant, reads every
person's day off it, and records the instant on the version
(`schema_version.evaluated_at`); the recompute that runs later off
`schema.published` replays that instant, so the number the admin was shown is
the number that happens, whenever the event is consumed. A version published
before the instant was recorded replays its one `evaluated_on` date.

**When a reminder lands.** Between 09:00 and 18:00 on the person's own clock.
The sweep runs hourly for every tenant, so without this a reminder reaches
Auckland at 03:00 because it was morning in Europe. The one-per-week cap stays
in hours (168), which needs no calendar at all.

**Kept current between publishes.** A verdict read only at publish goes
stale the moment anybody writes: a field filled an hour ago is still on the
gap row, and the reminder goes out anyway. So every write to a person — a
field filled, cleared or corrected, a hire, a start, a status a correction
moves (§8.1) — re-judges that one person in the same transaction, with the
same reader, the same function and the same day as the publish recompute.
The stored state, the gap rows and so the reminder's list move with the
write: a filled field leaves the list at once. `profile_incomplete` is raised
when a record that was not incomplete becomes so (a hire with gaps included),
`profile_completed` only when an incomplete one closes, and a write that
leaves the state where it was raises nothing. A sealed value counts as
present by its existence; its plaintext is never read to decide.

Completeness is exposed on the API and in reporting, so a customer who _wants_
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
- A correction that moves the state (§8.1) raises `status_changed` beside the
  `attribute_corrected` that carries `supersedes`, and names that event as its
  cause. A start that arrived is effective from the corrected start date. A
  start that had not is effective from the start date it corrects, the day the
  record wrongly became active, so an "as of" read of that span says pre-hire.
- Withdrawn notice (§8.1) is the same shape: the notice's `last_working_day`
  row is superseded by a null one effective from the same date, tied to the
  `status_changed` (reason `notice_withdrawn`) that is effective the day it
  was withdrawn. The notice stays on record as something that was given; its
  end date stops being a fact about the employment.
- A last working day corrected forward after access ended (§8.1) restores
  access from the day of the correction, on the person's calendar: the
  `access_restored` is effective that day and caused by the
  `attribute_corrected` that carries `supersedes`. The span between the old
  day's end and the correction stays a span without access — it was one.

An attribute marked `effectiveDated: false` — a phone number, a personal email —
keeps only the correction path: history records who changed it and when, but
there is no "as of" query for it, because a phone number had no value "as of
last March" in any sense payroll cares about.

Every read of a person takes an optional `asOf` date. The default is today. A
payroll run for March asks for March, and gets the org chart, the salary and the
cost centre as they were, not as they are. Across a rehire (§8.1) that holds
per period: an "as of" inside the first employment reads its start and no end
yet, one in the gap reads its start and its last working day, and one inside
the second reads the new start and no end — the rehire's null
`last_working_day` row is what closes the old end date at the new start.

"Today" is always the person's own day (§6.8), never the server's: the default
`effectiveFrom` of a change, whether a new value is already in force, whether a
hire date has arrived (so whether the hire is `active` or `pre_hire`), and a
date field's past/future rule are all read on the calendar of the person being
written — their location, else their legal entity, else their own zone, else
the tenant's. A write that moves somebody to another office is judged on the
calendar it moves them to. An import row is judged the same way, on the
calendar of the person the row is about. An export's file date and its "As of"
line are the tenant default's day, because one file has one date.

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
   sentence reading back what was chosen: _"Adam can see and edit this. His
   manager cannot. HR can see it."_
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

- **Legal entities and locations** — each entity's country and default time
  zone; each location's entity, country and time zone, with the date a zone
  change takes effect (§6.8). The tenant's default zone sits here too, and the
  company's slug and name, read-only: the back office owns them, and a
  reminder uses them to link to `<slug>.app…` and to name the company. All of
  it is `people_admin`'s to change and anybody's in the tenant to read, over
  `GET/POST/PATCH /v1/legal-entities`, `/v1/locations`,
  `POST /v1/locations/{id}/zones`, `GET/PATCH /v1/settings`, and the matching
  GraphQL fields.
- **Employee numbering** — per legal entity, `people_admin`'s: a prefix (up to
  ten letters, digits or hyphens), a width the sequence is zero-padded to
  (1–12 digits) and where it starts, so `ES-` and 5 from 100 write `ES-00100`,
  and grow past the width rather than wrapping. `GET/PUT
/v1/legal-entities/{id}/numbering`; each change raises
  `people.employee_numbering.set`. An entity with a scheme numbers every
  person hired into it who has no number yet, in the hire's transaction: the
  entity's row is locked and incremented, so racing hires queue, and a hire
  that is refused hands its number back — no holes, which a database
  sequence could not promise. A number somebody already holds is skipped. A
  number typed or imported in such an entity must be one the scheme would
  write (the dry run says so per row, and the write refuses it), is claimed
  unique, and moves the sequence past itself. An entity with no scheme
  numbers nobody. Numbers are unique in the tenant, and so in each entity,
  and a change to the scheme never moves the sequence back.
- **Directory** — which attributes are searchable, who may see the directory,
  whether photos show.
- **Country packs** — which are enabled, per legal entity.
- **Completeness and reminders** — reminder schedule, cap, who receives the HR
  digest, minimum cohort size for aggregate reporting. The minimum starts at
  10 and can be raised, never lowered: the domain refuses a lower number and a
  trigger on `people.tenant_settings` refuses it again for any path that skips
  the domain.
- **Roles** — who holds `hr`, `finance` and `people_admin` (§6.6), and
  granting or revoking one with a reason; a People administrator's, HR reads
  it. Nobody can tick a role for themselves or untick the last administrator,
  and People refuses both whatever the screen does. A leaver's roles are
  revoked by People when their access ends, and are not given back when access
  is restored — an administrator grants them again (§8.1). `GET /v1/roles`,
  `POST /v1/roles/grants`, `POST /v1/roles/revocations` (Idempotency-Key),
  and in GraphQL `peopleRoles`, `grantRole` and `revokeRole`.
- **Integrations** — webhook endpoints, subscribed events, per-endpoint field
  allowlists, signing secret rotation, delivery log and replay. See §13.
- **Data protection** — retention per classification, DSAR export format, the
  read-only generated list of every field and its policy. This screen is how a
  works council question gets answered in a meeting rather than in a fortnight.

**Where they are, as built (PEO-098).** Every screen is a route in the People
remote's `routes.json`, fetched and wired by the shell:

| Route                           | Screen                     |
| ------------------------------- | -------------------------- |
| `/people`                       | home (PEO-119)             |
| `/people/setup`                 | setup wizard               |
| `/people/settings/fields`       | field registry and publish |
| `/people/settings/integrations` | integrations               |
| `/people/settings/integrations/{id}` | an endpoint's delivery log and replay (PEO-121) |
| `/people/full-values`           | full values: finance asks, HR decides (PEO-121) |
| `/people/settings/roles`        | roles (PEO-112)            |
| `/people/settings/organisation` | organisation (PEO-119)     |
| `/people/onboarding`            | onboarding                 |
| `/people/me`                    | my own profile             |
| `/people/{id}`                  | someone else's profile; HR's lifecycle moves (PEO-120) |
| `/people/directory`             | directory                  |
| `/people/completeness`          | completeness grid          |
| `/people/import`                | import                     |
| `/people/export`                | export builder             |
| `/people/analytics`             | analytics                  |

**Organisation settings, as built (PEO-119).** One screen with four tabs:
legal entities, locations, employee numbering, and the company (the default
zone, the cohort minimum, and the slug and name, read-only). It is drawn from
one read, `peopleOrganisation`, which also says whether the viewer may change
anything. Anybody in the tenant reads it; the controls are offered to a
People administrator, and People refuses anybody else whatever the screen
offers. A zone change is dated from today *in the new zone* unless another
day is chosen, because it is in force once that day has begun there; one
dated after today is listed under the zone in force. The cohort minimum field
will not submit a lower number, as neither the domain nor the trigger accepts
one. People's home (`/people`) lists every area the viewer's roles open,
settings included, so no URL has to be typed. HR sees on each profile whose
day it is for that person (their zone, and today on it), which every
lifecycle move runs on.

**Lifecycle moves, as built (PEO-120).** They are not a settings tab: they
sit on the person's profile, in an Employment section that only HR is sent.
It shows their day, their status and every employment period, and offers the
moves §8.1 allows from the current status: give or withdraw notice, start or
end leave, terminate (with the reason, a note, eligibility for rehire and
ending access now), end access, discard a provisional record, and rehire
(asking why when the last period says not eligible). People refuses anything
else, and the screen shows the refusal.

**The delivery log and full values, as built (PEO-121).** Each endpoint's
card on the integrations screen opens its delivery log: newest first, fifty
at a time, showing the event, the status, the attempts and the last HTTP
status, and never a body. Each delivery has a Replay button, which sends the
stored event again, filtered by the allowlist as it is now; the replay then
appears in the log as a delivery of its own. Full values (§15.2) has one
screen for both parties. Finance chooses from the masked, exportable fields,
says why, and later downloads the one file, once. HR sees every request,
approves or rejects it with a note, and is never handed the link.

Directory, country packs, completeness and reminders (other than the cohort
minimum) and data protection have no screen yet.

**The setup wizard publishes the core fields with the pack.** The core fields
are `country-packs/core.ts`: legal first and family name, preferred name, work
email, employee number and manager. Before this, a fresh tenant's version 1
held only the pack's identifiers.

**The legal entity the wizard confirms is the tenant's first
`people.legal_entity` (PEO-099).** The back office's company wizard usually
creates it. Confirming renames it. A different country creates a new entity
on the tenant's default zone, because a country is not an edit. A tenant with
no entity yet is offered the company as the tenant registry recorded it.

---

## 10. Events

Topic naming, envelope, ordering and the outbox are all as
`packages/contracts/src/event.ts` already defines them: topic per module,
partitioned by `tenantId:aggregateId`, envelope carrying `occurredAt`,
`recordedAt`, `effectiveFrom`, `actor`, `correlationId`, `causationId`.

### 10.1 Schema events

| Event                                 | Payload highlights                                                                                           |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `people.schema.section_created` v1    | sectionKey, labels, order, default visibility                                                                |
| `people.schema.section_updated` v1    | sectionKey, changed field names                                                                              |
| `people.schema.section_archived` v1   | sectionKey                                                                                                   |
| `people.schema.attribute_created` v1  | attributeKey, sectionKey, dataType, cardinality, requiredness, ownership, visibility, classification, origin |
| `people.schema.attribute_updated` v1  | attributeKey, changed field names, requiredness transition                                                   |
| `people.schema.attribute_archived` v1 | attributeKey, whether values were kept                                                                       |
| `people.schema.published` v1          | schemaVersion, checksum, counts, a link to the full artifact                                                 |

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
| `people.person.access_ended` v1 | A leaver's access ended (§5): once, at the end of the last working day on their calendar (on notice or terminated) or at once by HR. `endedAt`, the last working day, the trigger; the account id, null when there is none. Identity suspends on it |
| `people.person.rehire_override` v1 | HR rehired somebody marked not eligible for rehire (§8.1): the person, the new period, HR's reason (free text); who did it is the envelope's actor. The audit record of overriding that judgement |
| `people.person.access_restored` v1 | Access came back (§5, §8.1): a rehired person's new employment started (reason `rehired`), or a notice's last working day was corrected forward to a day not yet ended (reason `last_working_day_corrected`). `restoredAt`, the account id. Identity reinstates on it |
| `people.role.granted` v1 | A tenant role granted (PEO-112): whom, which role, by whom, `via` people or the back office, and why |
| `people.role.revoked` v1 | The reverse, with the same fields; also `via: system`, `by` null and reason `access_ended` for each role a leaver held when their access ended (§8.1) |

A rehire (§8.1) raises `status_changed` with the new reason `rehired` and a
`hired` for the new period — the same event a first hire raises, whose
`employment.from` is the new start. Withdrawing notice raises `status_changed`
with the new reason `notice_withdrawn`.

### 10.2a Calendar events

Legal entities, locations and settings (§6.8). Organisation configuration,
never anybody's values, every field classified like any other.

| Event                              | Payload highlights                                                                                   |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `people.legal_entity.created` v1   | legalEntityId, name, country, default time zone                                                      |
| `people.legal_entity.updated` v1   | legalEntityId, name, default time zone, archived, changed field names                                |
| `people.location.created` v1       | locationId, legalEntityId, name, country, time zone, `effectiveFrom`                                 |
| `people.location.updated` v1       | locationId, name, archived, changed field names                                                      |
| `people.location.zone_changed` v1  | locationId, zoneId, time zone, `effectiveFrom` (also on the envelope), `supersedes` for a correction |
| `people.settings.changed` v1       | default time zone, cohort minimum, changed field names                                               |
| `people.employee_numbering.set` v1 | legalEntityId, prefix, digits, next number                                                           |

`people.person.org_changed` already names the legal entity and location a
person moved to; that event is what tells a consumer a person changed
calendar.

People also consumes two identity events, both about the company rather than
anybody in it: `identity.tenant.provisioned` v1 (slug, display name, country,
time zone — raised in the transaction that creates the tenant) and
`identity.tenant.amended` v1 (slug, display name — raised when the back office
renames or rebrands it). They are how People learns its default zone, its
first legal entity and the company's slug and name without reading
`platform.tenant`. The slug and name are a copy of the back office's facts,
kept newest-`occurredAt`-wins, and raise no People event of their own.

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
                               value_hash bytea, key_id, person_id)
                               UNIQUE (tenant_id, attribute_key, scope_id,
                                       value_hash)      -- HMAC, never the value

people.outbox                 -- same shape as platform.outbox

-- Calendars (§6.8) -------------------------------------------------------------
people.tenant_settings        (tenant_id PK, default_time_zone, cohort_minimum
                               CHECK >= 10, slug, display_name, company_as_of,
                               created_at, updated_at)
                               -- a trigger refuses lowering cohort_minimum;
                               -- slug and display_name are the back office's,
                               -- copied from identity.tenant.*, newest wins
people.legal_entity           (tenant_id, id, name, country char(2), time_zone,
                               archived_at, created_at, updated_at)
people.location               (tenant_id, id, legal_entity_id -> legal_entity,
                               name, country char(2), archived_at, ...)
people.location_zone          (tenant_id, id, location_id -> location,
                               effective_from date, time_zone, supersedes,
                               recorded_at)                   -- append-only
people.schema_version         + evaluated_at timestamptz      -- see §8.4
```

`people.person.legal_entity_id` and `location_id` carry no foreign key to the
new tables: rows written before them hold ids nothing checked, and the
resolver treats an id it cannot find as absent, which is the answer an FK
would force anyway. Zones are checked for shape by the database and against
the IANA database by the domain, because a CHECK cannot reach `Intl`.

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
`(tenant_id, attribute_key, scope_id, value_hash)`, written in the same
transaction as the value. This is the point in the design most likely to be
implemented as `CREATE INDEX` at runtime, and the reason not to is the repository
rule that migrations are expand-contract only. Runtime DDL against a
multi-tenant production database is an outage with a configuration screen in
front of it.

**A unique claim holds a keyed hash, never the value.** `value_hash` is
HMAC-SHA-256 of the normalised value — a national identifier as its country's
rule normalises it, anything else trimmed and casefolded — under a key derived
per tenant, by HKDF, from the master key that wraps secrets. The derived key is
never stored; `key_id` names the master key it came from. Every attribute is
claimed this way, not only encrypted ones: a plaintext index of employee
numbers is needless, and a plaintext index of national identifiers would be the
ciphertext's plaintext stored beside it. An unkeyed hash is not enough — a NIF
is 10^8 guesses. Rotating the master key re-computes every claim from its value
(the person row, or the secret) in bounded, idempotent batches, normalised by
the attribute's definition in the version the record was written under; until a
claim is re-keyed, a claim is looked for under every key the deployment holds,
behind a per-rule lock, so no duplicate slips in between. A write locks every
rule it claims under first, in one order, so two writes naming the same
attributes queue rather than deadlock. A new key is rolled out known before it
is current (`.env.example` has the four steps), so no writer ever claims under
a key another writer cannot look under; the rotation refuses to run when that
step was skipped. A duplicate the rotation finds — two people already holding
one value — is not a failure: the stale claim keeps its old key, so the value
stays unique, and HR sees one `people.unique_claim.conflict` event and a
`unique_conflict` row on the grid naming both people, never the value, until one
of them changes it.

**Secrets are not in the row.** Bank accounts, national identifiers and tax
identifiers live in `people.person_secret` under envelope encryption, with their
own RLS policy and their own grant. The person row keeps `last4` for display.
Nothing in `custom` and nothing in an event ever holds the plaintext. Rotating
the master key re-wraps each secret's data key under the new one — the value
is never decrypted — in the same hourly, bounded, idempotent job shape as the
claims, a batch of people per transaction, logging counts and key ids only;
once no secret and no claim names the old key it can be dropped
(`.env.example`). A secret under a key the deployment no longer holds cannot
be opened by anybody, so the job refuses and says which key rather than
failing half a batch.

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
- Retention jobs read the same source, and erase a value's unique claim with
  the value: a keyed hash of an erased identifier is still that identifier to
  whoever holds the key. A retention due date — the last working day plus the
  policy's months — is a calendar date, and whether it has arrived is read on
  the leaver's own calendar (§6.8): it falls at midnight where they worked,
  not where the server is.
- **Retention and rehire (PEO-110).** The clock runs from the end of the
  person's **latest** employment period, never an earlier one: a person
  rehired is not a leaver, so nothing is due, and a rehire before erasure
  cancels it — the job reads the record locked and in the state the rehire
  left it. When they leave again the clock starts afresh from the new last
  working day. What erasure had already cleared stays cleared; a rehire of a
  record whose name or work email is gone is refused until HR supplies them.

An attribute cannot be created without a policy. There is no "unclassified"
state, no default that means "we will decide later", and no code path that
writes a definition row with a null policy. The field is `NOT NULL` and the
domain refuses before the database gets a chance to.

### 12.3 Where a judgment helps

Priya is an HR operations lead. Asked to pick between "internal" and
"confidential" for a field called _"Accommodation notes"_, she will pick wrong
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
    classification: choice('How sensitive is the data an HR team would put in `attribute`?', {
      public: null, // may appear in a public directory
      internal: null, // ordinary business data about a person
      confidential: null, // would embarrass or harm if disclosed
      'special-category': null, // GDPR Article 9
    }),
    piiKind: choice('What kind of personal data would `attribute` hold?', {
      identity: null,
      financial: null,
      contact: null,
      health: null,
      biometric: null,
      none: null,
    }),
    isArticle9: noul(
      'Could `attribute` routinely hold health, biometric, racial, religious, ' +
        'political, trade-union or sexual-orientation data about the employee?',
    ),
    freeTextRisk: noul(
      'Is `attribute` a free-text field where an HR user could type anything, ' +
        "including a third party's personal data?",
    ),
  },
});
```

**How the answer is used — the gate, in code, not in a habit:**

| Condition                                                               | Behaviour                                                                                                                                              |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `isArticle9` probability ≥ 0.5, or classification is `special-category` | Force `special-category`, `aiEligible: false`, `includeInEvents: false`. Require an explicit tick with the consequence spelled out. Never auto-applied |
| `freeTextRisk` ≥ 0.5                                                    | Floor at `confidential` and `aiEligible: false`, matching what `asFreeText()` already does for static fields                                           |
| Confidence ≥ 0.9 and not the above                                      | Pre-select, clearly marked as a suggestion, one click to change                                                                                        |
| Confidence 0.5–0.9                                                      | Pre-select nothing. Show the top two with their reasons and make her choose                                                                            |
| Confidence < 0.5, or the API is unavailable                             | Fall back to the section default, or to `confidential` / `aiEligible: false` if the section has none. Never block the admin on an inference call       |

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

| Where                              | Judgment                                                                                                                                                  | Gate                                                                                                          |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| **CSV import**                     | Map each spreadsheet column to an attribute key. `Choice` over candidate keys plus `no_match`; code supplies the candidate list from the published schema | ≥ 0.9 auto-maps, below that goes to the manual mapping screen. The mapping is always shown before import runs |
| **SCIM / HRIS mapping**            | Map an external schema's fields to attribute keys, once per integration                                                                                   | Never auto-applied. It drafts a mapping a human approves, because it is applied to every record thereafter    |
| **Duplicate detection**            | `Noul`: are these two records the same human? Code supplies the pairs from cheap blocking on name, email and date of birth                                | A merge is **always** a human decision. The judgment ranks candidates; it never merges                        |
| **Legacy free-text normalisation** | Code finds candidate values in an imported blob; `Choice` selects the intended one. The pre-parsed extraction pattern — select, never generate            | Every selection is shown in the import dry-run diff before anything is written                                |
| **Directory safety screen**        | `Noul`: does this bio or public field contain a third party's personal data, or special-category data about the author?                                   | ≥ 0.5 warns the employee before publishing. Advisory. It never blocks somebody from describing themselves     |

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
Extends federated types rather than owning what People does not own. The
lifecycle moves of §8.1 are mutations — `giveNotice`, `terminatePerson`
(with `endAccessNow`), `endPersonAccess`, `withdrawNotice`, `rehirePerson`,
`startLeave`, `endLeave`,
`discardPerson` — each answering with the person
after, their arguments parsed by the same Zod body REST parses. The query
`employmentPeriods(personId)` lists a person's employments, HR only. Tenant roles
(PEO-112) are the `peopleRoles` query and the `grantRole` and `revokeRole`
mutations, each answering with the account's roles after.

**Through the router (PEO-092).** The Cosmo Router verifies the caller's
token against identity's JWKS (`AUTH_JWKS_URL`, ES256) and refuses a request
without one. It then *sets* — never propagates — two headers on the request to
People: `x-kithena-principal`, built from the token's `sub` and `tid` with no
roles (roles are OpenFGA tuples) and the deployment's `KITHENA_ENTITLEMENTS`,
and `x-internal-token`, People's `PEOPLE_API_TOKEN`. People trusts the first
only beside the second. `apps/gateway/config.yaml` holds the rules, and
`services/people/src/http/router.integration.test.ts` boots that file in the
real router in front of the real subgraph: a verified token reads, no token
and a foreign token are refused, and a principal a client sends is overwritten.

**The token is identity's (PEO-113).** Identity issues a server a
five-minute access token for a signed-in session —
`POST /api/internal/session/token`, behind the internal token, never to a
browser — for the audience `AUTH_TOKEN_AUDIENCE`, carrying `sub`, `tid`,
`amr` and the company's modules as `ent`. The router checks its signature
against identity's JWKS, its expiry and its audience, and refetches the JWKS
on an unknown `kid`, which is what makes key rotation
(`AUTH_VERIFICATION_KEYS`) a publish-then-switch. `router.integration.test.ts`
runs identity itself beside the router: a token identity issued reads; an
expired one, one for another audience and one from a key identity never
published are refused; one from the key identity rotated away from still
passes; and People refuses the token presented to it directly.

**Entitlements are per company (PEO-114).** The back office records which
modules a company bought on `platform.tenant.entitlements` and raises
`identity.tenant.entitlements_changed` with the whole list; People keeps a copy
in `people.tenant_settings` (newest `occurredAt` wins). Every transport's caller
check reads that copy first, so a recorded list — empty included — beats any
list a caller forwards, and a company that dropped People is refused with
`NOT_ENTITLED` whatever the router says. Only a company with nothing recorded
falls back to the forwarded list, which is the deployment's
`KITHENA_ENTITLEMENTS`: a default, never an override. The tenant app reads the
effective list from identity's session answer and shows a module's area only
when it is on it.

**The tenant app's path is GraphQL, through the router (PEO-113).** The shell
reaches People one way: it asks identity for the session's access token and
sends the router one of its own named operations (`apps/web/src/lib/people-operations.ts`)
with the token as a bearer. It holds no People address, no People token and
builds no principal; People's internal token is the router's alone, and People
refuses anything without it, the shell's own internal token included. Each
screen reads one query — `peopleOnboarding`, `peopleProfile`,
`peopleDirectory`, `peopleCompleteness`, `peopleRoleSettings`,
`peopleRegistry`, `peopleSetup`, `peopleIntegrations`, `peopleExportBuilder`,
`peopleAnalytics`, plus `peoplePublishPreview` and
`peopleClassificationAdvice` — and every write a screen makes is a mutation:
the draft, reordering, publishing and the setup pack, section and grid saves,
imports, exports and finance's full values, webhook endpoints, roles, the
lifecycle moves, legal entities, locations, numbering and settings.

- **One implementation per write.** A mutation is the REST write of the same
  name, dispatched in-process to the same route (`viaRest` in
  `graphql/schema.ts`): its arguments are parsed by the route's Zod body, the
  route's caller check runs on the request's own headers, and a refusal comes
  back as a GraphQL error with the domain's code. The subgraph adds types and
  decides nothing.
- **Every write is keyed.** Each mutation takes `idempotencyKey: String!`,
  sent to the route as its `Idempotency-Key`, so a retry is answered as REST
  answers it (§13.2, PEO-116): the version in force for a publish, an
  endpoint's id without its secret, `ALREADY_IMPORTED` for an import. The two
  that change nothing, `proposeImport` and `dryRunImport`, take none; a test
  over the schema fails when any other mutation lacks the key.
- **Field-level absence holds.** A view model already leaves out what the
  viewer may not read, and the schema cannot put it back: a record's values
  are `values: [FormEntry]`, a keyed list of a union (`TextEntry`,
  `FlagEntry`, `ListEntry`, `MoneyEntry`, `SealedEntry`, `EmptyEntry`), never
  an object with a field per attribute — GraphQL answers every field it is
  asked for, so a `salary` field would come back null and say it exists. A
  withheld attribute is absent from `values` and from its section's
  `fields`; `EmptyEntry` is a readable field that holds nothing, which the
  viewer may know. The directory's cells are a keyed list the same way. The
  shell puts the list back into the object the remote draws
  (`lib/people-views.ts`) and invents no key. Proven in
  `server.integration.test.ts` (a manager's `peopleProfile` has no
  `base_salary` anywhere; HR's has it as money) and end to end by the
  acceptance suite's HTML check.
- **Uploads.** An import's file travels as a multipart request (the GraphQL
  multipart request spec, the `Upload` scalar) of up to 100 MB (§14.1,
  PEO-038). The router takes one file of up to 100 MB (`file_upload`) in a
  body of up to 101 MB (`traffic_shaping.router.max_request_body_size`, 5 MB
  before) and gives People 300 seconds rather than everything else's 30, for a
  large commit; People's Yoga stops at the same 101 MiB (`yogaOptions`). The
  subgraph hands the file to the same import route REST serves. Proven through
  the real router with a file over the old limit (`router.integration.test.ts`).
- **Downloads stay links.** An export's files and finance's one full-values
  download are expiring signed links (PEO-089) that a mutation or query
  answers with; the browser opens them, and the signature is their authority.
- **Only the shell's operations.** The router answers persisted operations
  only (the safelist). With no control plane, they are files the router's
  `file_system` storage provider reads — `persisted/operations/<sha256>.json`,
  `{ "version": 1, "body": … }` — generated from the file the shell sends them
  from (`pnpm --filter @kithena/gateway persist`, which validates each against
  People's schema; its `--check` is the gateway's `pnpm test`). An operation
  the shell does not have is refused before People sees it
  (`PERSISTED_QUERY_NOT_FOUND`). A deployment mounts `persisted/` beside the
  router.
- **People's refusal, as People gave it.** The router passes a subgraph's
  error through (`subgraph_error_propagation: pass-through`) with only its
  `code`, `field` and `link` extensions (`link`: a repeated import's stored
  report, PEO-090), so the screen shows People's own sentence;
  a People error never carries more than that (`toGraphQLError`).

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
POST   /v1/people/{id}/notice          HR: on notice until a last working day (§8.1)
POST   /v1/people/{id}/notice/withdraw HR: notice withdrawn before the last day ends
POST   /v1/people/{id}/termination     HR: employment ended, once the last day has come; endAccessNow for cause
POST   /v1/people/{id}/access/end      HR: a leaver's access ends now, not at the end of the last day (§5)
POST   /v1/people/{id}/rehire          HR: a new employment period on the same record (§8.1)
GET    /v1/people/{id}/employment-periods   HR: every employment, first first
POST   /v1/people/{id}/leave/start     HR: on leave from today, on their calendar
POST   /v1/people/{id}/leave/end       HR: back from leave today
POST   /v1/people/{id}/discard         HR: a provisional record that was never a person
POST   /v1/imports                     dry run, then commit
POST   /v1/exports                     run now, or queue over 2,000 rows (202)
GET    /v1/exports/{id}                the requester's own, links signed again; a DSAR package for one person
GET    /v1/exports/files/{key}         a signed link, 24 hours; carries its own authority
POST   /v1/exports/full-values         finance asks for sealed fields in full, with a reason
GET    /v1/exports/full-values/{id}    the requester or HR; the one-use link to the requester only
POST   /v1/exports/full-values/{id}/decision   HR approves or rejects
GET    /v1/roles                       who holds a tenant role; HR and people_admin (PEO-112)
POST   /v1/roles/grants                people_admin: grant a role, with a reason; never to oneself
POST   /v1/roles/revocations           people_admin: revoke one; never the last people_admin (409)
```

OpenAPI generated from the same Zod definitions, per the rule that a derived
artifact is never hand-written. Idempotency keys on every write — an HR
decision on a full-values request included, so a retried approval replays the
request as it stands instead of refusing a second decision. Cursor
pagination. Field-level authorization identical to GraphQL's, because both call
the same application layer.

**What the tenant app's screens use (PEO-098).** Everything that only the
application layer could do before now has a route. Every route passes the same
caller check, and every authorization decision is made in
`application/screens/*`:

```
GET    /v1/views/{setup|onboarding|profile|directory|completeness|registry|integrations|roles|export|analytics}
GET    /v1/views/profile/{id}          one person, as the viewer may see them
POST   /v1/views/me/sections           save one section of my own record
POST   /v1/views/people/{id}/sections  save one section of somebody's record
POST   /v1/views/completeness          HR's grid: one write, and one event, per person
POST   /v1/views/setup/entity          confirm the legal entity: rename the first in that country, or create one
POST   /v1/views/setup/publish         the core fields + a country pack, published as version 1
POST   /v1/schema/draft/sections       add a section to the draft
PUT    /v1/schema/draft/sections/order
PUT    /v1/schema/draft/sections/{key}/order
POST   /v1/schema/draft/attributes     add or change a field; the draft decides whether it may
POST   /v1/schema/draft/advice         the classification suggestion (§12.3; rules for now, see below)
POST   /v1/schema/draft/preview        what publishing would do, with requiredFrom, rolled back
POST   /v1/schema/draft/publish        publish the draft
POST   /v1/webhooks/endpoints          create; alertEmail required; the secret returned once
PATCH  /v1/webhooks/endpoints/{id}     change, enable, disable
POST   /v1/webhooks/endpoints/{id}/rotate
POST   /v1/webhooks/deliveries/{id}/replay
POST   /v1/imports/proposal            upload → the proposed mapping
POST   /v1/imports/dry-run             the five counts, the incomplete warning, the blocked rows and their CSV
POST   /v1/imports                     commit
```

**The directory is searched, filtered and paged in People (PEO-117).**
`GET /v1/views/directory?search=&filter=key:value,…&after=<person id>` answers
one keyset page of 50 in id order, the cursor for the next (`next`, null on
the last), and `active`, counted over everybody the search and filters match
rather than over the page. Before this the view read the first 200 people and
searched those in memory, so nobody past the 200th could be found. `GET
/v1/people` takes the same `search`. Both authorize it as a filter is
authorized, in `PersonAccess.list` and so for every transport: a filter key
the viewer cannot read on **everybody** is refused (`FIELD_NOT_FILTERABLE`,
as PEO-052 already did), and a search matches only the names and work email
the viewer can read on everybody — none of them, and it is refused rather
than quietly matching nothing. Neither combines with `asOf`. The search is a
case-insensitive substring (`%` and `_` are literal) over given, family and
preferred name, work email, and the two full names. A person column such as
the manager is named by reading that person as the viewer, so a manager on
another page is still named. Measured at 50,000 people
(`person-access.integration.test.ts`): a filter page 57 ms, a search page
with its count 101 ms, a search with a filter 27 ms, against 300 ms. There is
no trigram index: the search is a scan of one tenant's rows, which fits the
budget at 50,000; a `pg_trgm` index is the next step when it does not.

`/v1/views/*` answers with a screen's view model. The model is built from reads
that were already authorized, so a withheld field never reaches it. An import
keeps nothing between steps: each step carries the file (base64, up to 100 MB)
and the mapping.

**Every write is keyed and documented (PEO-116).** These routes take an
Idempotency-Key like every other People write, and the router refuses a write
without one before its handler runs, so a new route cannot forget it. Four
POSTs change nothing — advice, the publish preview, the import proposal and
the dry run — and take none. The use cases open their own transactions, so a
keyed write runs them inside the key's transaction (`sharing` in
`unit-of-work.ts`; each joins as a savepoint), and the write and its key
commit together. An import commit's deadlock retry (PEO-106) still holds
inside that transaction: each attempt is its own savepoint, a 40P01 rolls back
to it, and the key is written after, in the outer transaction, so it commits
with the attempt that won or not at all (proven against a real deadlock in
`import.integration.test.ts`). A retry is answered from what exists now, never from a stored
body: a publish answers the version in force, a webhook endpoint's create or
rotate answers `{ id }` without the secret (it is shown once), and a replayed
import commit answers `ALREADY_IMPORTED`, because its report is not kept
(PEO-090). Every one is in `/v1/openapi.json`, its request body generated from
the Zod schema the route parses with. `writes.contract.test.ts` enumerates the
router's own routes and fails when a state-changing one lacks the key or an
OpenAPI operation, or when the document lists a write the router does not
serve. The tenant app sends a fresh key per action.

One thing is a known gap: **the classification advice is a small rule set.**
The TypeSafe judgment §12.3 describes is not built, and the rules only ever err
towards more protection.

**REST is for integrators (PEO-113).** Every route above stays, keyed and
documented, because REST is a headless surface in its own right: an
integrator who will not learn GraphQL, or a script, reaches People here,
through the same caller check (People's internal token beside a forwarded
principal). The tenant app does not use it any more — its
screens read and write through GraphQL (§13.1) — and `/v1/views/*` and the
screen writes are the routes those GraphQL fields dispatch to, so the two
cannot drift.

**The screens render on the server (PEO-094).** Module Federation cannot do
this inside the Next App Router: `@module-federation/nextjs-mf` never supported
the App Router and is being wound down. So the remote publishes a second build
beside `remoteEntry.js`: `ssr/people.cjs`, whose only imports are React, its
JSX runtime and Reach, plus `ssr/people.css`.

- **How the page renders (PEO-115).** The page fetches the server build per
  request, checks it (below), and asks a renderer process for the screen's
  HTML. The shell's own process never evaluates the remote's code. The screen
  is sent in the same response. In the browser a React root of the remote's
  own holds that HTML until the browser build arrives, then hydrates it, and
  a press made before then is replayed.
- **Integrity.** The remote's deploy pipeline signs `ssr/manifest.json`, the
  SHA-384 of `people.cjs` and `people.css` in SRI form, with an Ed25519 key
  only the pipeline holds (`pnpm --filter @kithena/web-people sign`,
  `PEOPLE_REMOTE_SSR_SIGNING_KEY`). The shell pins the public half in its own
  configuration, `PEOPLE_REMOTE_SSR_PUBLIC_KEY`, and renders only a build
  whose bytes match a manifest that key signed. The stylesheet is linked with
  the signed hash as its `integrity`. Anything else — no key, no signature, a
  different byte — and the page renders in the browser, as before PEO-094,
  logging once per build the expected and actual hash and never the code.
- **Why a signed manifest, not a pinned hash.** A hash in the shell's
  environment is exact, but on the platform the shell runs on an environment
  change only takes effect in a new deployment of the shell, so every remote
  release would redeploy it. The signature keeps a remote release a remote
  deploy alone; the shell's configuration changes only when the key rotates.
  The trade: the host may serve any build that was ever signed, not only the
  latest, until the key is rotated.
- **Isolation.** The renderer is a child process started with an empty
  environment, Node's permission model reading only its own bundle (no other
  file, no child process, no worker, no addon), code generation from strings
  disallowed, a 256 MB heap, and one process per build. Inside it the build is
  evaluated in a `node:vm` context whose global has only the language —
  `require` answers React, its JSX runtime and Reach and nothing else, and
  there is no `process`, no timer and no `fetch` — under a one-second CPU
  timeout for evaluation and for each render. The shell gives up on a render
  after five seconds and kills a renderer that has gone quiet. A `vm` context
  alone is not a security boundary: the objects handed into it belong to the
  renderer's realm. The process is the boundary; the context is a first wall.
  `apps/web/src/lib/remote-render.test.ts` proves a build reading
  `process.env`, requiring a module, climbing out through a shared object, or
  looping is refused or stopped, and that the next build still renders.
- **The switch.** `PEOPLE_REMOTE_SSR=off` still turns server rendering off.
- **Residual risk.** What remains, stated plainly:
  - *Network.* The permission model in Node 22 does not cover sockets. The
    renderer removes `fetch` and refuses the network modules, but code that
    escaped the context and the renderer's own lockdown could open a
    connection from the shell's network position — with nothing to
    authenticate with, since the process holds no secret. Deploy the shell
    where that position grants nothing by itself, or move to Node's
    `--allow-net` when the runtime has it.
  - *A signed build is trusted.* A malicious or buggy build that was signed
    by the pipeline renders; so does an older signed one a host chooses to
    serve. The key and the pipeline are the trust anchor.
  - *Shared state within a build.* One renderer serves every request for a
    build, so a hostile build could carry one request's props into another
    request's HTML. It could equally do that from the browser build, which
    runs on the page with every viewer's data.
  - *The browser build is not covered.* `remoteEntry.js` and its chunks run in
    the tenant's origin and are still trusted as they were; the signature
    covers the server build and its stylesheet only.
  - *The signing pipeline does not exist yet.* No workflow deploys the
    remote, so no production build is signed and production renders these
    screens in the browser until one does.
- **Hosting.** `apps/web/people/vercel.json` serves the files that are read
  per load (`remoteEntry.js`, `routes.json`, the server build, its stylesheet
  and signed manifest) with `Cache-Control: no-cache`, so a redeploy is seen
  at once. The hashed chunks are `immutable`. It echoes CORS for
  `https://*.app.kithena.com` and `*.staging.app.kithena.com`, which the
  stylesheet now needs, being fetched with `crossorigin` for its integrity
  check.

### 13.3 Webhooks (Phase 1)

| Property      | Behaviour                                                                                                                                                                                                                                                                                                                           |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Signing       | HMAC over the raw body with a per-endpoint secret, rotatable with an overlap window                                                                                                                                                                                                                                                 |
| Ordering      | Per person, guaranteed. Across people, not                                                                                                                                                                                                                                                                                          |
| Delivery      | At least once. Every payload carries `eventId`; consumers deduplicate on it                                                                                                                                                                                                                                                         |
| Retry         | Exponential backoff to 24 hours, then the endpoint is disabled and the tenant is told: `people.webhook.endpoint_disabled` is raised in the same transaction, once however many deliveries hit the ceiling together, and the endpoint's alert address is emailed through `platform/messaging`                                        |
| Alert address | Required when an endpoint is registered: a request without a valid one is refused, 400, naming `alertEmail`. An endpoint registered before this rule may have none and is told through the event alone                                                                                                                              |
| Durability    | The retry schedule is `next_attempt_at` on each delivery row. A bounded poller passes every known tenant on boot and every minute, so a retry pending across a restart resumes when it falls due. A pass claims a delivery with a short lease before sending, so two replicas never send one twice and a crash mid-send is a resend |
| Replay        | Any delivery re-sendable from the settings screen for the retention window                                                                                                                                                                                                                                                          |
| Filtering     | Per endpoint: which events, and which attributes within them (§10.3)                                                                                                                                                                                                                                                                |
| Payload       | The event envelope, unchanged, minus what the allowlist excludes                                                                                                                                                                                                                                                                    |

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

| Source                       | Produces                                                    | Notes                                                      |
| ---------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------- |
| CSV / TSV                    | People and their attribute values                           | Encoding sniffed, BOM handled, delimiter detected          |
| XLSX                         | The same, plus repeating groups from extra sheets           | First sheet is people unless told otherwise                |
| A Kithena export             | The same file round-tripped after editing                   | The key row (§15.3) is what makes this safe                |
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

| Missing                                                                                              | Outcome                                                                                                                              | Why                                                                                                                                                                                                                     |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A **core identity** field — legal name, work email, hire date, legal entity                          | The **row is blocked**. It is not imported, it is listed in the dry run with the offending column, and the rest of the file proceeds | There is no such thing as a person record without these. Creating one produces a row nobody can find, match or invite                                                                                                   |
| Any other **required** attribute — cost centre, national identifier, a tenant-defined required field | The row **imports and the person is incomplete**, exactly as §8.4 describes                                                          | A migration whose source system never held a cost centre must not be un-importable. Blocking here would mean the customer has to fix their old spreadsheet before they can use the new system, which is the wrong order |
| An **invalid** value — a malformed NIF, an unparseable date, an option not in the list               | The **row is blocked** with the cell named                                                                                           | Wrong is not the same as absent. Importing a bad value is worse than importing nothing, because nothing is visible as a gap and wrong is not                                                                            |

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
  duplicating 400 people, which is the mistake every importer makes once —
  and, while the import's blocked-row report is still kept, a fresh link to
  it, so the admin who lost it can still fix the rows it named. After that it
  says the report has expired, and gives no link.
- **Repeating attributes.** An XLSX's other sheets are read when they carry
  the export's key row (`__person_id`, `employee_number`, `#`, the attribute
  key; §15.2) — recognised by that row, never by the sheet's name, which is a
  label cut to 31 characters. Each row is one item, matched to its person by
  the person id, and held to the attribute's type exactly as a single cell
  is. **The sheet is the whole list for every person it mentions**: their
  list becomes the sheet's items, in sheet order, and a person the sheet
  does not mention keeps theirs untouched. That is the round-trip-safe
  reading — an exported sheet re-imported unedited changes nothing, and an
  item deleted from it is deleted — and the one that cannot silently append
  a duplicate. Its ceiling: a person's last item cannot be removed by
  deleting their last row, because a person with no rows is a person the
  sheet does not mention; that is done on the profile.
  - An invalid item, an unknown person id, or an item for somebody whose row
    on the People sheet does not import is **blocked, named by sheet, row and
    cell** (`Languages!D7`) in the dry run and in the report. It holds back
    that person's list for that attribute — importing the rest would delete
    the bad item — and nothing else on their row.
  - A sheet for an attribute that is unknown, archived, sealed or not the
    importer's to write is listed as not imported, never dropped silently.
- **A hire date on somebody already held is a correction** (§8.5), never an
  overwrite. The dry run shows it as one — old date, new date — and the
  commit writes it through the one correction path, superseding the hire
  date in force: `attribute_corrected` with `supersedes`, the column moved,
  and the state re-read (a start corrected into the future returns the
  person to pre-hire, §8.1). HR only, as every import is, and only where
  the tenant publishes `hire_date` for HR to correct; otherwise the row is
  blocked with the cell named, because dropping the date would be the silent
  overwrite's mirror image. A provisional record given a start date is hired,
  as before.
- **Concurrent imports.** An import is one transaction, and two of them
  claiming the same unique attributes in different orders can deadlock;
  Postgres then aborts one whole. The commit is retried on a deadlock or
  serialization failure, three attempts with backoff, idempotent by the
  checksum key; one that still loses is refused with "nothing from this file
  was imported, upload it again", never half-applied.
- **Partial commit.** Blocked rows never prevent good rows. The report is
  downloadable as a CSV with the original row number, the original values and
  the reason, so it can be fixed and re-imported as a smaller file. A blocked
  item from a repeating sheet is a row of its own at the end, carrying only
  the person id, with `__source_row` naming the sheet and row
  (`Languages!7`) and `__reason` the cell; uploading the report again leaves
  that person unchanged, and the fix is made on the original sheet.
- **The report is kept, sealed, for 7 days, and never past an erasure.** It
  holds employee values, so it is never put on an event or in a table. It is
  stored in the export's object store, AES-256-GCM in the service before it
  leaves (§15.1), keyed by the import's checksum.
  - **7 days, fixed.** Long enough to fix a file and re-upload it after a
    weekend; short enough that a report stays a working copy rather than a
    second register. The hourly export sweep deletes it when the week is out,
    as it deletes an export file after its day — never earlier.
  - **Erasure deletes it.** Beside each report, `people.import_report` keeps
    the ids of the people it contains — the existing people its blocked and
    duplicate rows and blocked items name; ids only, never a value. When a
    person is anonymised (§12, retention), every report containing them is
    deleted, object and row, whatever its age. A DSAR erasure does the same
    through the same call (`forgetImportReports`), once that path exists.
  - It is reached only through a signed link that expires after 24 hours or
    with the report, whichever is sooner, given to the HR user who committed
    the file or re-uploaded it; nothing stores the link. A re-upload after
    the week, or after an erasure deleted it, is `ALREADY_IMPORTED` with no
    link and says the report has expired.
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

| Format   | For                                                                                       | Shape                                                                        |
| -------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| **CSV**  | Another system, a script, a re-import                                                     | One row per person, flat, no styling, keys in the second header row          |
| **XLSX** | A human — finance, a works council, a payroll bureau                                      | Multiple sheets, real types, dropdowns, highlighted gaps, a provenance sheet |
| **PDF**  | A record to hand over, print or file — an employee file, a labour inspection, a DSAR pack | Per person or a roster, with page furniture and explicit "Not provided"      |

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
  financial attributes additionally requires a stated reason, which is
  recorded with it. (Special-category attributes are never in an export to
  need one; see §15.2.)

Anything over 2,000 rows runs as a job. The file lands in object storage,
encrypted, behind a signed link that expires in 24 hours and is delivered as a
notification — never as an email attachment, because an email attachment is a
copy of the employee register in a mailbox nobody controls.

How that is built:

- **The threshold is what the requester may list**, counted through the same
  read the export is. A manager with a team of eight is never queued because
  the company has ten thousand people.
- **The job is a BullMQ job**, keyed by the export id, so a request retried by
  the client is one job and a job retried by the queue is one export. Five
  attempts with exponential backoff; a refusal — a field refused, a reason
  missing — is final, because it would be refused again. A queued export that
  needs a reason is refused **before** it is queued, not by a worker nobody is
  watching.
- **Storage is any S3-compatible bucket**, with two layers of encryption:
  AES-256-GCM in the service before the bytes leave it, and the bucket's own
  server-side encryption beneath. They fail differently — the bucket's key
  protects a disk that leaves the data centre, the service's protects against a
  bucket policy one checkbox too generous.
- **The link is the service's, not the bucket's.** `GET /v1/exports/files/…`
  checks an HMAC over the key and the expiry, and after 24 hours answers `410
Gone`. A presigned bucket URL would hand the requester ciphertext.
- **Files are deleted after the link dies**, by a sweep that runs hourly and
  removes at most a thousand files per run, so a backlog drains over several
  runs instead of one long one.
- **The notification is `people.export.completed`**, which still carries no
  link. The requester — and only the requester — fetches the links from `GET
/v1/exports/{id}`, which signs them again from the file names and expiry in
  the export ledger; no link is stored anywhere. An export-ready email waits on
  `platform/messaging` gaining that message.
- **Nothing configured is a supported mode.** With no bucket and no queue the
  module keeps files in memory and runs large exports in-process, says so at
  boot, and still boots alone.

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
  sheet in XLSX, keyed by person id (with the employee number beside it), and their own file in a CSV export
  bundle. Flattening produces either truncation or a hundred empty columns.
- **Archived attributes** are excluded by default and included on request,
  marked `(archived)` in the label row. Their values still exist, so an export
  that silently omitted them would misreport what is held.
- **Encrypted attributes** — bank accounts, national identifiers — export as
  the masked form (`ES•• •••• 2291`), in every export, for everybody. **Finance
  never downloads a full value directly**; it asks for one, and somebody else
  says yes:
  - **Finance asks** for a named export — the sealed fields it needs, and who —
    and states why. Only the finance relation may ask, and a request must name
    at least one sealed field; anything else it can simply export.
  - **HR decides**, approving or rejecting, with an optional note. Only the HR
    relation may decide, and **nobody decides their own request**, whatever
    relations they hold; the database refuses it as well as the application.
  - **Undecided after seven days, the request expires.** An expiry is an
    answer, and is recorded as one; a decision arriving after it is refused.
  - **An approval issues exactly one download**: one XLSX, built as the
    requester reads — an approval unmasks what they asked for and widens
    nothing else — behind a link that works **once** and for **24 hours**. The
    second click is refused, and so is the first after a day. Only the
    requester is given the link. Sealed values are read inside that build and
    nowhere else: not cached, not logged, not stored.
  - **Every step is an event** — `people.export.full_values_requested`,
    `…_decided`, `…_expired`, `…_issued`, `…_downloaded`, and the ordinary
    `people.export.completed` — carrying the actor, the reason and the field
    keys, never a value and never a link. The download is recorded against the
    person it was issued to, because a bearer link cannot say who clicked it.

  The wait between asking and answering is a Temporal workflow, one per
  request. It holds nothing: it wakes on the decision or when the week runs
  out, and asks the request's row what to do. The same approval rules — a
  stated reason, separation of duties, a deadline, a single use — are the
  primitives the approval workflows on sensitive changes (Phase 3) will reuse.

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
- A repeating attribute's sheet carries the same two header rows — the label,
  then `__person_id`, `employee_number`, `#` and the attribute key — so it
  round-trips by key as the People sheet does, under the §14.5 rule: the
  sheet is the whole list for each person it mentions.

### 15.4 What a missing required value looks like in each format

Absence has to be visible, and it has to be distinguishable from zero, from an
empty string and from "not applicable at this company".

| Format | Missing required                                                                                                                                      | Missing optional    | Not applicable                                           |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | -------------------------------------------------------- |
| CSV    | Empty cell. A `__missing_required` column lists the keys, comma-separated                                                                             | Empty cell          | Empty cell                                               |
| XLSX   | Empty cell with an amber fill and a cell comment naming the field, plus a **Missing information** sheet listing person, field and who owns filling it | Empty cell, no fill | Cell shaded grey, comment "not required for this person" |
| PDF    | Prints **Not provided** in muted type, never a blank                                                                                                  | Omitted entirely    | Omitted entirely                                         |

**Which cells are which is judged on the export's day.** An export `asOf`
March is a picture of March, gaps included: the values in force then — dated
attributes replayed through history — against the schema version that was
published then. Judged against today, a field made required in June would
mark every March row as missing something nobody could have been asked for,
and a gap closed in May would vanish from the March picture. The provenance
sheet names the version the gaps were judged against, and a day before
anything was published has no gaps at all. The Missing information sheet
lists every gap on that day, including one in a field archived since, which
therefore has no column.

**Not applicable** is a blank that some rule could ask for but does not ask of
this person on that day — a conditional rule that does not hold for them, or a
requirement whose `requiredFrom` has not arrived. A field with no rule at all
is optional, not "not applicable", and gets no fill.

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
   The minimum is `people.tenant_settings.cohort_minimum`, set on the
   Completeness and reminders tab (§9.4); a CHECK holds the floor of 10 and a
   trigger refuses any UPDATE that lowers it, so a path that skips the domain
   cannot lower it either. It is also the change threshold below.
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

| Question                                        | Chart                                                                                                         | The relation it shows                                                                                                                 |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Are we growing?                                 | `TrendChart` — headcount by month, with a `Sparkline` in the stat tile above it                               | Level over time. Joiners and leavers sit beneath as a stacked bar so growth is visibly the difference between two flows, not one line |
| Where did the change come from?                 | `WaterfallChart` — opening, joiners, internal moves, leavers, closing                                         | The single most-asked HR number, and the only chart that makes headcount reconcile rather than merely display                         |
| What are we made of?                            | `HorizontalBarChart` by department, location or employment type; `DonutChart` for status                      | One dimension at a time. A second dimension becomes `StackedBarChart`, never a pie of pies                                            |
| Are people leaving faster?                      | `TrendChart` — rolling 12-month attrition, annualised, with the formula stated on the card                    | Rate over time. Shown next to headcount because attrition without a denominator is a vanity number                                    |
| Who is at risk of leaving?                      | `BarChart` — tenure distribution in bands                                                                     | Tenure against leaver counts in the same bands: the classic 6-to-18-month cliff shows up as a shape, not a statistic                  |
| Is the org shaped sensibly?                     | `BarChart` — span of control distribution, plus `OrgChart` for the structure itself                           | How many managers have one report, and how many layers sit between an employee and the top                                            |
| Is our data any good?                           | `HorizontalBarChart` — completeness by section and by field, with a trend since the last publish              | This is what makes §8.4 measurable rather than aspirational, and it is the chart Priya opens most                                     |
| Where do new joiners stall?                     | `FunnelChart` — invited, enrolled, onboarding started, onboarding completed, record complete                  | The drop between "enrolled" and "onboarding completed" is the onboarding form's real completion rate                                  |
| What is about to expire?                        | `TimelineChart` — work permits, fixed-term contracts, probation ends and certifications over the next 90 days | The only genuinely operational chart here. A permit expiring in three weeks is a person who cannot legally work in four               |
| When do people join?                            | `HeatmapChart` — month against department                                                                     | Hiring seasonality, which is what makes a capacity plan arguable                                                                      |
| How is pay distributed?                         | `RangeChart` for band ranges with the actuals inside them; `ScatterChart` for pay against tenure              | Requires the finance relation. Compa-ratio against band midpoint is the relation; a raw salary list is not analysis                   |
| What does the workforce look like in aggregate? | Bar charts over voluntary self-ID                                                                             | Cohort minimum enforced everywhere, per §6.7. Never per person, never to a manager                                                    |

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

**Whose day a snapshot counts.** Each legal entity's own (§6.8). The job
reads one instant, files the run under the tenant default's date, and counts
every person on their legal entity's date at that instant — headcount,
joiners, leavers, tenure, expiries and the completeness grid's missing
fields. Somebody with no legal entity is counted on the tenant's day. **A
tenant-wide figure is the sum of per-entity figures, each on its own day**: at
20:00 UTC on 31 March a joiner starting 1 April in Bangalore is already in the
headcount and one starting 1 April in Madrid is not, and the tenant's number
is their sum. Each entity's flow interval is the run's, anchored on its own
day, so consecutive runs stay contiguous for every entity. The monthly
special-category publication (§16.1) reads the run it follows, never a second
reading of the clock, and counts "who changed since" on each entity's day at
the publication's instant and at this run's. A requested `asOf` is a date and
is the same date for everybody.

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

| Tier                         | Screens                                                                                                              | What "mobile" means                                                                                                                                                                                                                       |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Full parity**              | Onboarding, own profile, a colleague's profile, the directory, tasks and reminders, analytics viewing, notifications | Identical capability. These are the screens an employee uses, and most employees have no other device                                                                                                                                     |
| **Adapted**                  | The field registry, the publish flow, the completeness grid, import mapping, the export builder                      | Same capability, different layout. Reorder gains explicit "move up / move down" actions alongside drag. The completeness grid becomes one card per person with one field on it. Import mapping stacks into a list of column-to-field rows |
| **Initiated, not performed** | A 50,000-row import, a large PDF roster                                                                              | Started and monitored on a phone, executed server-side. Closing the tab does not cancel anything, and the result arrives as a notification                                                                                                |

Nothing is desk-only by design. A rule that says "do this at a computer" is a
rule that gets broken in a car park by somebody who needed it now.

### 17.2 The rules that make it true

- **Tables become lists.** Below the `md` breakpoint, `DataTable` gives way to
  `ListDetail` cards carrying the two or three columns that matter, with the
  rest behind a tap. Reach's `useBreakpoint` decides; the screen does not sniff
  a user agent.
- **Long lists page on the server.** The directory shows 50 people and a
  "Next page" / "First page" pair of Reach `Button`s below the list or cards,
  the same on a phone as at a desk (PEO-117). Each page is a URL, so the
  phone's Back gesture returns to the page before; nothing loads 50,000 rows
  into a browser to scroll or search them.
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
  retries; a failed save says which section and keeps the values. A retry is
  safe because every write carries an Idempotency-Key (§13.2): a save that
  reached People before the connection dropped is answered, not repeated.

### 17.3 How it is checked

Every story renders at a phone viewport as well as a desk one, and
`pnpm test:stories` runs axe over both. Tap targets are asserted against the
44px floor rather than eyeballed. The onboarding flow has an acceptance test
that completes it end to end at 390×844 with a software keyboard raised.

**On a slow network the screen arrives with the page (PEO-094, PEO-115).**
A phone waiting on the remote's JavaScript still shows the screen the server
drew, and a tap made before it loads is replayed once it does. When the
server build is refused, the phone gets the spinner, as before server
rendering.

**The running app has its own check (PEO-098).**
`apps/web/acceptance/people.acceptance.test.ts` drives the shell, the remote
and People as production builds. It completes the setup wizard at 390×844,
with the keyboard raised for each section, and checks that Save is on screen
above the keyboard.

That test found a real defect. `PageLayout`'s `<main>` was `overflow-y: auto`
in a row sized to its content. That made `<main>` a scroll container that
never scrolls, so a `sticky bottom-0` Save stuck to the end of the content
instead of the screen. `<main>` is now `overflow-x: clip`, which keeps a wide
child from scrolling the page sideways and creates no scroll container. The
remote's own phone test had not caught it, because it renders screens without
the shell's layout.

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

**Stopping.** A deploy or a scale-down ends the process with SIGTERM, and the
process ends itself: it stops accepting connections, answers every request
already in flight, lets the background job in hand finish, leaves its Kafka
consumer groups, closes its database pools, flushes its spans (at most 2 s)
and exits 0. The whole stop is bounded by `SHUTDOWN_DEADLINE_MS` (10 s by
default, inside an orchestrator's 30 s grace); past it the process logs which
steps had not finished and exits 1. A step that fails also exits 1. A
write interrupted by the deadline rolls back with its transaction, and its
event with it, because the outbox row is in the same transaction. Every
service started through `@kithena/telemetry` stops this way (PEO-118).

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
tracking. Org chart _editing_ as a visual tool — People owns the data, a future
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
- [x] Enabling People names its first administrator from the company's
      accounts; I cannot enable it without one (PEO-112).

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
| JSONB custom attributes make directory queries slow at 50k people | Medium | Medium | `indexed` promotes to a generated column; GIN for containment; the directory reads a projection, not the person table. *As built (PEO-117): the person table, GIN containment for filters and a scan for search, measured inside budget at 50,000 (§13.2)* |
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

`national_id` (country-typed, encrypted, unique per tenant), `tax_id` (encrypted), `passport_number`
(encrypted), `passport_country`, `passport_expiry`, `visa_type`,
`work_permit_number` (encrypted), `work_permit_expiry`,
`right_to_work_checked_on`, `right_to_work_checked_by`, `driving_licence_number`
(encrypted), `sponsorship_required` (boolean).

### Emergency contacts _(repeating)_

`contact_name`, `relationship`, `primary_phone`, `alternate_phone`,
`contact_email`, `contact_address`, `is_primary`.

### HR information

`employee_number`**core** (numbered per legal entity, unique in the tenant;
§9.4), `status`**core**,
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

### Education & experience _(repeating)_

`institution`, `qualification`, `field_of_study`, `start_year`, `end_year`,
`certification_name`, `certification_issuer`, `certification_expiry`,
`prior_employer`, `prior_role`, `prior_period`.

### Assets & access _(repeating)_

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
  'text',
  'long_text',
  'number',
  'decimal',
  'percentage',
  'money',
  'boolean',
  'date',
  'datetime',
  'duration',
  'select',
  'multi_select',
  'tags',
  'email',
  'phone',
  'url',
  'country',
  'currency',
  'language',
  'time_zone',
  'address',
  'national_id',
  'bank_account',
  'person_ref',
  'org_unit_ref',
  'legal_entity_ref',
  'document_ref',
  'image',
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

export const WriterRole = z.enum(['employee', 'manager', 'hr', 'finance', 'system', 'external']);
export const ViewerScope = z.enum([
  'self',
  'manager',
  'manager_chain',
  'hr',
  'finance',
  'admin',
  'directory',
]);

export const AttributeDefinition = z
  .object({
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
    collectAt: z.enum(['signup', 'enrolment', 'onboarding', 'hr_only', 'anytime']),
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
    (a) =>
      a.classification.classification !== 'special-category' ||
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

_Requirements gathered interactively with quality scoring across business,
functional, UX and technical dimensions. Four architectural questions were
answered here rather than deferred; the reasoning is in place so each can be
argued with rather than merely obeyed._
