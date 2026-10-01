# New information in an import

When a spreadsheet being imported has columns that match no employee field,
People proposes a field for each, asks what should happen for the people
already here that the file gives no value, and adds the lot in one
administrator's OK. The assistant does the proposing; HR reviews; nothing is
written before the OK.

## The flow

0. **Nothing published yet**: setup comes first, because the legal entity
   and its country pack decide which fields the law requires. The import page
   says so in place of the uploader and links an administrator to setup
   (`/people/setup?then=/people/import`), whose last step goes back to the
   import; HR without administrator rights is told an administrator sets it
   up. Setup publishes everything in the draft, so the import that follows
   finds no other unpublished changes, and the file's other columns arrive
   here as new fields (version 2).
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
