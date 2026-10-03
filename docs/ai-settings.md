# New information in an import

When a spreadsheet being imported has columns that match no employee field,
People proposes a field for each, asks what should happen for the people who
will have no value, and says in one plan everything the import will do. A
People administrator approves the plan once; nothing is written before.

## The flow (design AI9 to AI12; MA8, MA9 on a phone)

The import has five steps: **Upload → Map columns → New fields → Review plan
→ Import**, full pages at `/people/import` under People › Import & export ›
Import. The step, and the field in focus on the people-without-a-value
screen, are in the address: `?step=map|places|fields|existing|review|done` and
`?field=`; no step is the upload. Each step is a new history entry, except
done, which replaces the plan so Back never offers a run that happened. An id
or employee number column shows "Kithena creates this" and has no picker.
Wherever a row or a cell is listed (left empty for HR, skipped, identifiers to
check, the people without a value), its person's name comes first, from the
file's name columns or else its work email; on a phone the name is the card's
title.

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
   Existing fields and sections are never changed by anything below, with
   one exception: **People's own choice fields**, employment type and work
   model, each kept in a column of its own. A column for one ("Employment
   Type", "Contract type", "Work Arrangement"…) maps onto People's field,
   never a second field beside it. Its values map by any spelling
   (`choiceOf` in `domain/import/aliases.ts`: "Fixed-term" is Fixed term,
   "Freelancer" a contractor, "WFH" remote), and a value the field lacks is
   added to its list ("FT" and "Full Time" both become one Full-time). A
   company without the field gets it with People's values and the file's.
   The map step already shows the column going to Employment type, "Adds
   Full-time, Part-time to the list": an administrator's mapping reads the
   file against the version the plan will publish, People's field and its
   new values in (`application/import/choice-fields.ts`), even before the
   field is published. The plan says it in one line ("Employment Type →
   Employment type; added Full-time and Part-time"), the column counts as
   one to a field here, and only an administrator's run changes the field.
   The columns keep only a key's shape
   (`20261003090000_people_choice_columns.sql`); the published options are
   the list, and a requiredness or visibility rule may name any of them, or
   People's own (`unknownChoice` in `domain/schema/draft.ts`).

   **The employment lifecycle columns are People's own too**, and never
   fields: "Employment Status", "Termination Date" (or "Last working day"),
   "Termination Reason" and "Eligible for Rehire" map onto the lifecycle
   (`SYSTEM_COLUMNS`, read by `domain/import/lifecycle.ts`). Once a new
   person is hired from their start date, the import runs People's own moves,
   each effective from its date and raising its usual typed events:
   - a termination date on or before today: **offboarded** from it
     (`terminate`), the reason as one of People's three (Resignation and
     Retirement are resigned; Involuntary, Restructuring, Redundancy are
     dismissed; End of contract is end of contract; a closed set, because
     reports count it), the file's words as HR's note, the rehire flag on the
     employment period, and access ended at the end of that day, as the hourly
     job would have. Insights and turnover count them from their last
     working day, as every leaver;
   - a termination date ahead: **on notice** until it (`giveNotice`), so
     access ends at the end of that day. Notice keeps no rehire flag or note;
     HR gives both when confirming the termination;
   - "On leave": **on leave** (`startLeave`) from the column headed "Leave
     Start Date" (or today). People keeps no leave record (Time off is its
     own module), so Leave Type, Leave Start Date and Expected Return Date
     stay fields;
   - "Active" and "Pre-hire" still come from the start date.

   Where the word and the dates disagree, the dates decide ("Active" with a
   start date ahead is pre-hire; "Terminated" with a day ahead is on notice;
   "Terminated" with no date stays active, for HR), one line each in the
   plan. The plan says it in one line: "58 people already left (offboarded
   from their termination date); 6 are serving notice (offboarding
   scheduled); 29 are on leave". Nobody is notified (People sends no notice
   for these moves) and nobody is invited: an import never invites, and a
   leaver's access has ended before anyone could. A person already here
   keeps their status; change it from their record.
1. **Work locations in this file** (`?step=places`, still under Map columns
   in the stepper) appears when a column maps to Work location. The dry run
   lists each value the file holds (`domain/import/workplaces.ts`) with its
   people by name and a proposal: the work location here it already is; a
   close name ("Scranton Branch" → Scranton) as a suggestion; else a new one
   by the file's name, filled in from the file (`domain/import/place-hints.ts`):
   its country and zone from the rows' time zone column, else the work
   location's address, else a city in its name (Chicago → United States,
   America/Chicago; Bengaluru → India, Asia/Kolkata), and its legal entity
   the one the file's Legal Entity column names, else the only one in that
   country, else the first. Home addresses are never read. A place nothing
   resolves, or a file that disagrees with itself (a city in one country, a
   zone in another), still gets the best suggestion, with a note beside its
   editable country and zone; nothing blocks. Rules and lookups only: no
   model. For another system's id, empty. A People administrator maps each, adds it
   (name, country, time zone, and legal entity where there are several, as
   Settings › Organisation asks) or leaves it empty, its people then listed
   for HR. The choices go with the plan ("Add 2 work locations: Scranton and
   Stamford; map “NYC HQ” to New York") and the run, which adds through
   Organisation's own `createLocation` before the rows go in. HR without
   administrator rights sees the suggestions read-only, and the server reads
   only an administrator's choices.
2. **New fields** appears only when columns match nothing. One card per
   column: its proposed name, type, section, who sees it, how it is
   classified (special category, confidential, sealed, approval required),
   why, how sure the rules are of the type, the choices or the shape of the
   values, how many rows have a value, a switch, and Edit for all of it.
   Every card is on: **every column of the file is imported** somewhere, an
   existing field, a new field, or a value HR is told about. Nothing needs a
   click, and nothing is held back:
   - **Special category** (ethnicity, religion, disability, veteran status,
     union membership, diet, health…) is imported, at the customer's choice
     as data controller: special-category, HR's alone, never the
     assistant's, never required, a change approved by a second HR member,
     and sealed where its type can be (free text, a date); a list or a yes
     or no is kept unsealed with the same restrictions. A model cannot lower
     it.
   - **Identifiers** (national ID, passport, tax ID, driving licence and
     work permit numbers, bank account, IBAN, routing or sort code): sealed
     text, the person's and HR's. A file mixing countries' identifiers has
     no one country's check, so it is text; a one-country IBAN column is a
     bank account with that country's check.
   - **Pay** (salary, hourly rate, bonus, commission, equity, raises, tax
     filing status): confidential, HR's and finance's, approval required. A
     salary with a Currency column is money in each row's currency;
     percentages are percentages; numbers keep the decimals the file has.
   - **Personal contact and address**: confidential, the person's and HR's.
   - The rest is ordinary.

   **Proposals are valid by construction** (`fitted` in
   `domain/import/new-fields.ts`): whatever proposed a field, People's rules,
   a model or HR's edit, it is fitted to what the settings take before
   anybody sees it, and the note says what changed ("Stored as
   confidential, with changes approved, not encrypted, because it's a
   list"). A choice, a yes or no or a percentage is never sealed; financial
   data that cannot be sealed is not called financial (financial data must
   be); an identifier needs its country's scheme, so a model's
   `national_id` is sealed text. A model names a field, but cannot change a
   type the values decided (a date, a number, an amount, a code) or lower
   the protection the rules give. Proposing then checks every proposal
   against the draft, and one it would still refuse is kept as confidential
   text with the reason. A new field never takes a key People keeps in a
   column of its own (`employment_type`, `seniority_date`, `hire_date`…).
   When no assistant answered, the card says the proposal is People's own
   rules.
3. **People without a value**: for each kept field, how many people will
   have none once the file is in, and what happens for them, one suggested
   with its reason and each with what it does:
   - *Ask them*: theirs to fill in and required, so they show as incomplete
     and the weekly reminder asks (an optional ask is PEO-148);
   - *HR fills it in*: HR's and required, on Data health's list;
   - *Only new joiners*: required of people added from now on;
   - *Leave it empty*: optional, nobody asked;
   - *One value for everyone* (only when every row holds the same value).
4. **Review plan** (`POST /v1/imports/plan`, writes nothing): a dry run
   against the version the kept fields would make, and every consequence in
   words (`domain/import/plan.ts`): setup, the fields and where they go, the
   people created and updated (with the blocked rows a click away), who is
   asked, what HR fills in, what is left out. On a phone, the plan is one
   sentence under the choices. **Approve and run is never off without its
   reason beside it**, announced and named by the button's description: the
   server's `blocked` message, each refused field by its header with "Leave
   it out", or nobody to import.
5. **Approve and run** (`POST /v1/imports/run`): the plan is worked out again
   on the server, then setup's seeding if nothing is published, the fields and
   any new sections into the draft, one publish, the defaults, all in one
   transaction refused whole if the settings refuse a field; then the import
   commits with every new column mapped to its new field. Approving the plan
   is the approval: sensitive values are written, not held one by one for a
   second HR member (changes made later are). The done screen says what it
   did, where every column went ("102 columns → existing fields and new
   fields, 0 left out", ids "Kithena creates this"), and lists the new
   fields, each a link to edit.

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
live region, and the address keeping the filters and the row the reader is on
(`?row=`, below).

## Smart search (AI1–AI4, MA1–MA3)

The Directory's search is one prompt bar for names and for questions
(`apps/web/people/src/directory/smart-search.tsx`, Reach's `SearchField
variant="prompt"`). Typing searches nothing; Enter does.

- **A name or an email that finds one person opens them**, with no model
  (`isEmail`, `isPlainSearch`, then the list as the viewer may read it,
  two at most). Several, and the names are listed (`?q=`).
- **Focused and empty, it offers "Try asking"**: up to four questions built
  from the company's own fields and options (`suggestions` in
  `domain/assistant/clarify.ts`, on the Directory view), each one People's
  rules read in full, so a suggestion never meets "not understood"; options
  only of fields the assistant may use. Below them, "Recent": the searches
  made in this browser (local storage, five).
- **The question becomes "Understood as"**: the directory's own conditions,
  in the address (`?ask=` holds the question, `?conditions=` what it became),
  each a removable chip, the parts not used dashed, "Edit as filters" opening
  the same Filters sheet. Same filters as the manual ones, so permissions
  apply exactly as before. A question's results are ordered by name unless it
  asked for an order. Who read it is said when it was not the assistant.
- **It asks instead of guessing** (`sift`, `clarify.ts`): "leaving soon",
  "new joiners" and "starting soon" each have readings this company's fields
  can run (given notice, a date field named like an end within 90 days; the
  last 30 or 90 days or this year; not started yet, or a start in 30 days),
  offered with how many people each finds, "Both" only when nothing else was
  asked (all of one and any of the other is not one query). One reading is no
  question. The model may ask too (`ask` in its answer, read as strictly as
  its conditions). A pick applies the reading and is remembered in this
  browser by topic, sent with the next question (`remembered`).
- **It refuses judgements**: how good somebody is at something, how well they
  work, what they will do, health and other special-category data. The part
  is taken out of the sentence before the rules or a model read it, shown
  dashed, and explained; where a text field records something close (Skills
  for "good at Go") it is offered with its count, never applied.
- **Remind all N** (HR, when the conditions find a detail empty that people
  fill in themselves): everybody found is asked for it through the profile's
  own request path (`requestDetailsOfMany`, one transaction, emails after,
  at most 500 a press). **Save as view** saves the conditions as a segment
  (`people.segment.conditions`, expand-only); the directory and the export
  apply them, a chart or a schedule refuses such a view (PEO-132).
  **Export** carries the conditions as before.
- **Where you are**: results stream in 50 at a time with a counter ("150 of
  388") and Back to top (Reach's `ScrollPosition`) once the reader has
  scrolled; the first row in view is noted in the address as the scroll
  settles (`?row=`, rewriting the entry, never while a navigation is on its
  way), so Back or a reload loads as many pages as it takes and returns to
  that row.

What the model sees here is what it saw before, less anything refused: the
sentence without the refused parts, today's date, and the field keys,
labels and kinds, with options only for configuration it may use. Checked in
`application/assistant/selection.test.ts` and, against a fake model, in the
browser (the logged request held "senior people in Engineering" for "senior
people in Engineering who are good at Go", and no record's value).

# An export sent to somebody

The export page (design AI13, AI14, MA10) is the plan above, then where the
file goes: **Download** it, **Send** it to a colleague, or **Schedule** it
monthly. The use cases are `application/export/share.ts`, the rules
`domain/export/share.ts`, behind `POST /v1/exports/share/preview` (writes
nothing), `POST /v1/exports/share`, `GET` and `POST …/share/{id}/decision`,
and `GET /v1/exports/{id}/record`.

- **Whom it is for is People's to read, never the model's.** A full name in
  the sentence, a first name after "for" or "to", or a role after them
  ("for Finance") held, as granted, by one person only, matched against the
  accounts that sign in here; two who fit is nobody, and the person picks.
  The model's prompt is the plan's, unchanged — the sentence, the date, field
  names, audiences and filters — and never the account, name or address of
  anybody it could go to.
- **Same permissions, both ways.** The file is built as the person asking.
  Before it exists, it is read again as the recipient would read it: each
  field they could not see on somebody in it, and anybody they could not list
  ("Base salary needs Grace's access"). Nothing more: it goes now, kept a week
  under `shared/`, and the recipient is emailed a link to the export page.
  More: it waits for a People administrator who is neither asking nor
  receiving (the domain and a table constraint both say so), who sees what it
  holds and what the recipient could not read, and approves or rejects that
  one file. Approved, it is built then, as the requester reads it then, and
  sent. Nobody's standing access changes.
- **The link opens only for them.** The email names nobody, no field and no
  reason (`docs/messaging.md`); its button is the export page, signed in,
  which answers only the requester and the recipient, records the
  recipient's first look as when it was opened, and signs the file's own
  link for fifteen minutes at a time. A forwarded email opens nothing.
- **Every file explains itself.** An About comes first in every export —
  a workbook's first sheet, a text file beside a CSV, lines under a roster's
  title: what it holds, as of when, made by whom for whom, and why, with its
  export id. The importer passes over the About sheet, so an export still
  re-imports as it is. The finished export's page shows the same About, and
  what was recorded: the reason, how many people, how many fields and how
  many sensitive, who approved it, and how long the record is kept (no period
  is decided yet, PEO-129).
- **Suggestions are People's rules**: one more field beside a sensitive one,
  names left out (the employee number kept), the other file format. Each is a
  change in the address, shown before anything runs.
- **Every choice is in the address**: the sentence, who read it, who, the
  fields, the date, the format, the reason, the recipient, the mode and the
  builder by hand.
- **Events**: `people.export.share_requested`, `people.export.share_decided`
  and `people.export.shared`, with accounts, field keys and the reason —
  never a value or a link — beside `people.export.completed`.
- **Not yet** (tickets): a grant for a period and a department rather than
  one file (PEO-135), splitting a file by a field (PEO-136), these requests in
  the Approvals inbox and the decision emailed (PEO-137), sending more than
  2,000 people (PEO-138), and a schedule from any described audience
  (PEO-139).

<!-- What changed (AI rework, lane I): its own block. -->
# What changed

The first tab of Insights (`/people/insights/what-changed`, design AI5, AI6,
MA4, MA5). A period's changes as a handful of points, each with its figure,
its sentence and the records it came from; a follow-up question; and the
summary exported or sent, rewritten for whoever receives it. The domain is
`domain/insights/what-changed.ts`; the use cases `application/screens/what-changed.ts`.
It replaces the one-line "what changed" note that used to open every tab.

- **The period** is in the address: `?period=week|month|quarter|custom`
  (month when absent), `from` and `to` for a custom one. "This month" is the
  month holding yesterday, the last night with a snapshot, so on the 1st it is
  last month, whole; it is compared with the month before (a custom range with
  as many days before it).
- **The points** come from the charts' own queries, as the viewer, under the
  segment in the address: headcount at either end and who joined, who left
  (against the period before), missing details at either end and the biggest
  gap, managers over 8 direct reports, and grades whose median sits outside
  their band (finance's). A team is named only when it holds at least the
  cohort minimum at the period's end and most of the change. Every filled-in
  figure and name is drawn bold; each point's sources link to the Directory
  filtered to them, or to the tab or page that holds them.
- **What the model sees**: each point's sentence with every figure and name a
  placeholder (`{n1}`, `{g1}`), and for a follow-up the viewer's question,
  through the gateway's `aggregates` mode, which refuses any number. Its answer
  is one strict JSON object; a key it was not given, a placeholder invented,
  moved or dropped, a digit or a number word People's own words did not use,
  and the answer is dropped and People's words stand. The assistant words the
  points (`/worded`, asked after the page is drawn) and answers follow-ups;
  it never computes anything. Budget `INSIGHTS_PHRASES_PER_HOUR` (60), 8 s.
- **The rules**: People's own sentences are the page with no model at all. A
  follow-up is answered by the points it is about (by topic, or a team it
  names); a "why" is told the figures are all there is; a question about
  performance, health or other special-category data is refused and never
  sent to a model.
- **For somebody else** (HR's, as scheduled reports are): the same figures
  are read again *as the recipient*; a point is kept only where theirs has the
  same numbers, in their words, never naming a team or section the sender
  could not; every point left out says why ("Pay is left out, because Nora
  can't see pay in aggregate"). Short is the first three points; Detailed all.
  Every sentence can be edited in the preview; the edits apply only to points
  the recipient gets.
- **Download** is a PDF (pdfkit, `application/export/pdf.ts`). **Send** stores
  the document as approved (`people.shared_summary`, seven days, RLS) and
  messaging emails the recipient a link (`summary_shared`, docs/messaging.md),
  never the summary; it opens for the recipient and the sender only, signed
  in, at `?shared=<id>`, with the same PDF. Without a messaging mailer and a
  tenant app base, Send is not offered. Slides is not offered (PEO-140).

# Flagged approvals

A change waiting on Approvals that looks unusual is flagged for whoever
decides it (design AI7, AI8, MA6, MA7). **Rules only, no model**: the reasons
are already plain words, and nothing here sends anybody's value anywhere. The
rules are `domain/approval/unusual.ts`; what they read and what the decider
does with a flag are `application/person/approval-flags.ts`.

## The checks

Six, each switched on or off by a People administrator on Approvals ›
Flagged ("What Kithena checks"; `PUT /v1/approval-checks/{code}`); HR sees
them, switches disabled. No row is the default: all on but the time of day.

| Check | Flags | Compared against |
| --- | --- | --- |
| `raise` | pay moves more than 20 % **and** more than any raise in the person's team this year (sealed pay: more than 20 %); a cut over 20 % | the team's other raises this calendar year, from history as its chain stands (median and largest, drawn as bars) |
| `band` | the new pay is outside the band of the person's grade | the band in force on the effective date, same currency |
| `bank_after_contact` | bank details asked for within 14 days after an address or email change | recorded history, and changes still waiting |
| `close_colleagues` | the decider and the requester share a manager, within an hour of the request | the two records' managers, at the moment the decider looks |
| `payroll_closing` | pay or bank details landing in this month's payroll with under 5 days left, or reaching back into a month already paid | a monthly payroll closing on the month's last day (PEO-147) |
| `unusual_time` (off) | asked for outside 07:00–20:00 Monday to Friday, by someone other than the employee | the requester's own zone |

Each reason has a title ("A 38% raise"), what it compared against ("Sales
raises this year had a median of 4%, and the largest was 12%"), and the card
ends with an honest note: "This might be fine: a promotion would explain
both. Check the reason before you decide."

## Who sees what

- **Only whoever may decide the change** sees its flags; the requester never
  learns which rule their change tripped.
- **Pay is compared only where the decider may read the field** — the rule
  a profile shows it to them by. A decider who may not gets no pay flag and
  no hint that one exists.
- **Sealed pay (PEO-145)** is opened in memory for that request only: the
  value in force through the audited `SecretStore.reveal`, the value asked
  for from the change's own seal. The reasons say percentages and the band's
  limits ("It is over the top of the L3 band (€62k–€78k)"), never an amount.
  Nothing decrypted is stored, cached or logged; a decided change keeps the
  checks' codes and "Not unusual" keeps a percentage
  (`http/sealed-flags.integration.test.ts` reads every People table and log
  line for either amount). A sealed field's history keeps no amounts, so
  there is no team comparison for it: the raise is judged against 20 %.
- The band's limits are named only to a decider who may read pay bands (HR
  or finance).

## What the decider does

- **Approve with note**: approving a flagged change needs a note (a domain
  rule, `NOTE_REQUIRED`, checked again on the server at decision time).
  Rejecting needs none. The checks that flagged it are kept with the decision
  (`pending_change.flags`) for the Decided tab and the last 90 days.
- **Not unusual**: marks each reason on the change. For 90 days the same check
  stays quiet for the same requester — for a raise, only up to the size that
  was marked. Marks are the company's own. It decides nothing.
- **Ask the requester**: a question kept with the change; the requester sees
  it on their bell and Inbox ("HR asked about your … change") and answers once,
  beside the change. Nobody is emailed yet (PEO-146).

## The last 90 days

Changes asked for in the last 90 days that a check flagged (decided with
flags, or marked), how many of those were rejected, and how many were marked
not unusual. A flagged change withdrawn or left to expire is not counted.

## On a phone

The Inbox has To do, Flagged and Updates (`/inbox?view=`). A flagged row
carries its reason and opens the change on Approvals
(`?tab=flagged&change=`), where Reject and Approve sit in a pinned footer; the
assistant's floating button rises above any pinned bar (`PINNED_BAR`).
