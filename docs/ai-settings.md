# New information in an import

When a spreadsheet being imported has columns that match no employee field,
People proposes a field for each, asks what should happen for the people who
will have no value, and says in one plan everything the import will do. A
People administrator approves the plan once; nothing is written before.

## The flow (design AI9 to AI12; MA8, MA9 on a phone)

The import has five steps: **Upload → Map columns → New fields → Review plan
→ Import**. The step, and the field in focus on the people-without-a-value
screen, are in the address (`?step=`, `?field=`).

0. **Nothing published yet is not a detour.** A company the back office has
   just made (one legal entity, nothing published) imports straight away: its
   file is read against what setup would publish, held in memory
   (`setupDraft` in `application/screens/schema.ts`: the core fields and every
   section of the entity's country pack), and the plan's first step says
   "Set up the employee record with the United States pack". Approving it
   seeds setup and publishes the pack and the file's new fields together as
   version 1. HR who is not an administrator is told an administrator imports
   the first file. The setup wizard still exists for a company that wants to
   choose its sections first.
1. **Upload and map.** Columns map by key, by label, by the usual names other
   systems export (`domain/import/aliases.ts`: "First Name", "Email",
   "Employee ID", "Hire Date"…), then by the column-mapping judgment.
   Existing fields and sections are never changed by anything below.
2. **New fields** appears only when columns match nothing. One card per
   column: its proposed name, type, section, who sees it, how sensitive it is,
   how sure the rules are of the type, the choices or the shape of the values,
   how many rows have a value, a switch, and Edit for all of it. Accept all.
   A column that can reveal health, religion or the like (special category:
   allergies, diet, religion…) is **held back** with its reason and "Import
   anyway"; a model cannot put it back. When no assistant answered, the card
   says the proposal is People's own rules.
3. **People without a value**: for each kept field, how many people will
   have none once the file is in, and what happens for them, one suggested
   with its reason and each with what it does:
   - *Ask them*: theirs to fill in and required, so they show as incomplete
     and the weekly reminder asks (an optional ask is PEO-140);
   - *HR fills it in*: HR's and required, on Data health's list;
   - *Only new joiners*: required of people added from now on;
   - *Leave it empty*: optional, nobody asked;
   - *One value for everyone* (only when every row holds the same value).
4. **Review plan** (`POST /v1/imports/plan`, writes nothing): a dry run
   against the version the kept fields would make, and every consequence in
   words (`domain/import/plan.ts`): setup, the fields and where they go, the
   people created and updated (with the blocked rows a click away), who is
   asked, what HR fills in, what is left out. On a phone, the plan is one
   sentence under the choices.
5. **Approve and run** (`POST /v1/imports/run`): the plan is worked out again
   on the server, then setup's seeding if nothing is published, the fields and
   any new sections into the draft, one publish, the defaults, all in one
   transaction refused whole if the settings refuse a field; then the import
   commits with every new column mapped to its new field. The done screen
   says what it did and lists the new fields, each a link to edit.

## Where it runs, and what the model sees

- Everything is People's, server-side (`application/assistant/import-fields.ts`).
  The browser never calls a model.
- The model is **the assistant's own**: the OpenAI-compatible chat API in
  `infrastructure/assistant/model.ts`, configured by `ASSISTANT_BASE_URL`,
  `ASSISTANT_API_KEY` and `ASSISTANT_MODEL`, the same settings the People
  assistant already uses. **No new key or provider is needed**; where the
  assistant runs, this runs. It is reached only through the AI gateway.
- It answers **one JSON object** (`response_format: json_object`): proposals,
  skipped columns and a summary, in the shape the instruction spells out.
  People reads it with a strict Zod schema (`ModelAnswer`, `ProposeField`,
  `SkipColumn` in `domain/import/new-fields.ts`), item by item, so one
  malformed proposal is dropped and counted rather than costing the rest.
  Nothing it answers writes anything.
- **It is shown each column's header and the shape of its values, never a
  value**: "dates, dd/mm/yyyy", "8 digits + letter", "4 distinct short
  values", "IBAN-like, country ES" (`domain/import/column-shape.ts`), and the
  names of the company's sections and fields. Choices and a default's value
  come from the file on the server and are shown on the review only.
- The prompt is marked `about: 'configuration'` for the gateway: the key
  check runs, and any free text shaped like a value (an email address, six or
  more digits in a run) is refused (`AI_VALUE_SHAPED`), so a header that is
  really a pasted value never leaves.
- A wide file is sent in chunks of 12 columns, side by side, each with room
  for 6,000 tokens of answer and a 60-second timeout, so the whole answers
  well inside the shell's two-minute write. A chunk that fails or does not
  answer in JSON keeps People's own proposal for its columns.
- With no model configured, when the company's budget is spent (20 proposals an hour,
  `IMPORT_FIELDS_PLANS_PER_HOUR`; in memory per process), or when the answer
  cannot be read, People's own rules propose (`domain/import/new-fields.ts`):
  an IBAN is financial, encrypted and never the assistant's; an emergency
  contact is contact data the employee fills in; a cost centre is HR's; a
  T-shirt size is ordinary. The model's answer is laid over them per column
  and read strictly; a column it skipped is left out, with its reason.

## Safety and permissions

- **Nothing is written before the OK.** Proposing and planning read only;
  the new fields are held in memory, not written to the draft, so an
  abandoned import leaves nothing behind to block the next publish.
- **Applying is one transaction**: setup's seeding when nothing is
  published, then sections and fields checked against the draft (the field
  editor's own rules, `fieldChange`), stored, published and the defaults
  written; anything refused refuses the lot. The import commits after it;
  if that fails, the fields stay published and the error says so, and
  running it again maps the columns to them.
- It is refused while the draft holds other unpublished changes, because
  publishing would publish those too.
- **Creating fields is a People administrator's** (administrators hold HR's
  rights; Kithena support is a full administrator). HR without it sees the
  whole proposal and the review, is told an administrator adds fields, and
  the import goes on without those columns. A hand-off to administrators
  (a prepared proposal approved from Approvals, HR notified, the same upload
  resumed) was judged disproportionate for now: Approvals today decides
  changes to one person's record, so it would need a new kind of approval
  with its own storage, notices and resume, while the upload lasts only as
  long as its intent. Nothing lets HR bypass the rule: the application layer
  refuses anybody who is not an administrator.
- **Audit**: one settings-log entry, "Added N fields from an import, with the
  AI assistant", naming the fields, never the file; an import that adds no
  field is in Import & export's history only. The
  publish, the defaults (as profile updates) and completeness are recorded as
  they always are.
- Every new field carries a classification policy; `classificationSource` is
  `suggested`, the audit's word for "proposed, accepted by a person".

## Afterwards

The fields are ordinary published fields, with nothing special about where
they came from: profiles, the export builder (tested: an imported field
exports with its label, key and values), completeness and its reminders for
required ones, and wherever else the published schema is read, each within
the field's visibility.

## Limits

- Proposals and the review cross GraphQL as JSON text; their shape is the Zod
  schema in `domain/import/new-fields.ts`, checked again on the way in.
- The budget is per process until People runs more than one.
- Not checked against how BambooHR, HiBob, Personio or Rippling handle
  unknown columns today; the flow follows the pattern the brief describes
  (detect, propose a field, decide what happens to existing records).

# Search and export in words

Two places take a sentence and turn it into a selection People already runs:
the Directory's search field ("engineers in Barcelona starting next month",
"people missing an emergency contact") and the export builder's "Describe the
export" ("everything payroll needs for the Madrid entity as of 1 October").
The planner is `domain/assistant/selection.ts`; the use cases are
`application/assistant/selection.ts`, behind `POST /v1/views/directory/plan`
and `POST /v1/views/export/plan` (both write nothing).

- **The result is the screen's own state, in the address.** The Directory gets
  its `conditions`, `match` and `sort`, shown as the chips it always shows and
  edited in its Filters sheet; the builder gets `who`, `conditions`, `fields`,
  `asOf`, `format` and a drafted `reason`, and starts from them. Nothing runs
  until the person looks: the directory authorizes the conditions as it
  always does, and the export runs through its own path, with its reason and
  its log, when they press Export.
- **A name alone is a name search**, with no model: a few words, no number,
  nothing the rules recognise (`isPlainSearch`).
- **What the model sees**: the sentence, today's date in words, and the fields
  the person may filter by (key, label, kind), with options only where they
  are configuration and the field is the assistant's (`aiEligible`). A field
  that is not the assistant's is named with kind `presence`, for "is empty"
  only, and no options. The export adds the fields the builder offers, by
  label and section, and its audiences. Never a value from anybody's record.
  The prompt is `about: 'configuration'`, so the gateway's key check runs and
  anything shaped like a value (an email address, six digits in a run) is
  refused before it leaves (`AI_VALUE_SHAPED`); People's rules then read it.
- **Read strictly**: one JSON object, `z.strictObject` throughout. A field it
  was not shown, an operator the field does not take, a date that is not a
  date, an audience not offered, a field not offered: the whole answer is
  dropped and the rules stand. A reason with markup or a long number is not
  kept; People drafts one. A date still to come is today, and it says so.
- **The rules** read option names ("Barcelona", "Sales or Engineering", a
  long company name by one telling word beside its field: "the Madrid
  entity"), a field after "missing", "without" or "with", date phrases after
  "hired", "joined" or "starting" (next month, before 2024, since March 2025,
  between two dates), an order ("newest"), and a role in the plural
  ("engineers") as the job title mentioning it. What they make nothing of is
  said: "Not understood: …". For an export, "payroll" picks the fields whose
  names payroll needs (names, employee number, start date, entity, pay, bank,
  tax and social-security identifiers, address).
- **The model** is the assistant's own (`ASSISTANT_*`), with 8 seconds to
  answer and room for 2,048 tokens. With no model, when the company's budget
  is spent (`SEARCH_PLANS_PER_HOUR`, 120; `EXPORT_PLANS_PER_HOUR`, 30; in
  memory per process), on a refusal, a timeout or an answer that cannot be
  read, the rules read the sentence, and the screen says which read it and why.
- **An audience of conditions**: the export takes the directory's own
  conditions (`conditions`, `match` on `POST /v1/exports`), authorized by the
  list as the directory's are, and the builder offers them as "Everybody
  whose department is Sales", counted as the person may list them. The
  Directory's Export button carries the conditions in force.

The directory's list and cards load the next page as the reader nears the end
(the table's `onEndReached`; a sentinel for cards and the phone's list), with a
row or a card in its final shape while it loads, "50 more loaded" said in a
live region, and the address keeping the filters, never the scroll position.
