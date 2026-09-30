# New information in an import

When a spreadsheet being imported has columns that match no employee field,
People proposes a field for each, asks what should happen for the people
already here that the file gives no value, and adds the lot in one
administrator's OK. The assistant does the proposing; HR reviews; nothing is
written before the OK.

## The flow

1. **Upload and map**, as before. Columns map to existing fields by key, by
   label, or by the column-mapping judgment. Existing fields and sections are
   never changed by anything below.
2. **New information in this file** appears only when columns match nothing
   (and HR did not map them by hand). One card per column: the proposed name
   and section (existing or new), the type and format, choices read from the
   file, who fills it in and who can see it, how sensitive it is, whether it
   is encrypted, whether the assistant may use it, and whether new people
   must have it, each with a one-line reason. Any of it can be changed, or the
   column left out ("Don't import this column").
3. **People not in this file**: for each new field, how many people already
   here get no value from the file, and what happens for them, with one
   option recommended and why:
   - *Ask them to fill it in*: the field becomes theirs and required, so it
     shows on their profile as missing and the weekly completeness reminder
     asks for it (the existing machinery; nothing new sends email).
   - *HR will fill it in*: HR's and required, so it is on HR's completeness
     list and bulk-edit grid.
   - *Leave it empty*: optional; if marked required, required of people
     added from now on only (`appliesTo: new_records`).
   - *Use one value for everyone missing it*: written now, for each of them,
     through the bulk-edit write path. Recommended only when every row of the
     file holds the same value.
4. **Review**: one paragraph, for example "Adds 4 fields: 1 to a new
   Emergency contact section, 1 to Employment… Values for 128 people from
   this file. 342 people will be asked for their emergency contact. HR will
   fill in 60 cost centre values." Sensitive fields are named. The primary
   action is **Add fields and continue**; it creates the fields and any new
   sections, publishes, writes the defaults, then the import goes on to the
   dry run with those columns mapped to the new fields, and then the commit.
   "Import without these columns" goes on without them at any point.

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

- **Nothing is written before the OK.** Proposing and reviewing read only.
- **Applying is one transaction**: sections and fields are checked against
  the draft first (the field editor's own rules, `fieldChange`), then stored,
  published and the defaults written; anything refused refuses the lot.
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
  AI assistant", with the review's words as its detail, never the file. The
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
