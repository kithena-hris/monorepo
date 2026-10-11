# Product Requirements Document: The Documents module

The document center: every document at a company, with access anyone can read at
a glance, signatures and acknowledgements built in, and AI that cites its pages.

## How to read this

- **Screens** are in the Claude Design project `6fed6ac8…`, pages **Kithena
  Documents** (web, ids `A1`–`S7`, `J1`–`J7`, `K1`–`K11`) and **Kithena Documents
  Mobile** (ids prefixed `M` here: `MD1`–`MD6`, `MR1`–`MR5`, `MX1`–`MX7`,
  `MA1`–`MA2`, `MH1`–`MH6`, `MP1`–`MP4`, `MS1`–`MS7`, `MJ1`–`MJ6`). The readable
  source is `_build/dc-*.js`; the web half is on disk at
  `.claude/design/documents/dc-web.js`.
- **The build plan** is [`documents-build-plan.md`](./documents-build-plan.md).
  It is the only record of progress.
- **Repo rules** are in [`CLAUDE.md`](../CLAUDE.md). This document does not
  restate them.

---

## 1. Executive summary

Documents is the fourth sellable module (`ModuleKey` `documents`, entitlement
`module.documents`). It owns files and everything about them: who may open them,
their versions, the signatures and acknowledgements they collect, how long they
are kept, and what Kithena may read from them.

It boots alone. Without People it learns who works at the company from the
same member import Time Off uses; with People it mirrors People's events. It
never imports another module. Where the design joins Documents to People or
Time Off (export to Documents, fill a record from a contract, attach a note to
a leave request), **the shell composes the two modules' own operations**; no
module calls another.

## 2. Problem statement

Today a contract lives in an email, a payslip in a payroll portal, a policy in
a shared drive and a signed offer in a third-party e-signature tool. HR cannot
answer "who has not signed?", "what expires next month?" or "what must we
delete?" without opening four systems. People's `document_ref` fields have
nowhere durable to point (People PRD §6.4, PEO-063). Exports sit in laptops'
Downloads folders.

## 3. Success metrics

- An employee finds and opens any document they may open in two actions.
- HR sees every unsigned, expiring, missing and due-for-deletion document on one
  screen, filtered in place.
- A contract goes from upload to sealed and filed without leaving Kithena.
- `just standalone documents` is green with People absent and with the AI keys
  unset.

## 4. Personas

- **Adam Novak**, backend engineer: reads, signs and acknowledges; keeps his own
  documents private; shares a few by name.
- **Marco Ruiz**, engineering manager: everything Adam does, plus shared team
  documents and access requests.
- **Ada Lovelace**, HR: document types, people files, requests, signatures,
  acknowledgements, retention, legal holds.
- **Yuki Sato**, a candidate outside Acme: signs from a link after an emailed
  code.
- **Mei Tanaka**, a new starter: uploads what onboarding asks for.

## 5. Where the boundary sits

### 5.1 What Documents owns

Documents, their versions and bytes, document types, company and personal
sections, sharing grants, confidential protection and its view log, access
requests, document requests, acknowledgement campaigns, signature envelopes,
retention rules, legal holds, the trash and the activity log.

### 5.2 What it learns

- **Members** (who works here, their team, manager, location, status, account):
  from `people.person.*` events when People is present, from a member import
  when it is not. Exactly Time Off's member projection, copied, not shared.
- **HR**: whoever identity names administrator for `module.documents`.
- **Away today**: Time Off is optional; the signature tracker's "away" line
  (K8) comes from the shell passing Time Off's answer, never from Documents
  calling Time Off.

### 5.3 What it tells others

Events on `kithena.documents.v1` (§13). Inbox items through the Inbox contract
(`packages/contracts/src/inbox`): a document to sign, a policy to
acknowledge, a document HR asked for, an access request. Assistant
capabilities (`packages/contracts/src/assistant/documents.ts`).

### 5.4 Shell-composed flows

| Flow                           | Screens             | The shell does                                                                                  |
| ------------------------------ | ------------------- | ----------------------------------------------------------------------------------------------- |
| Export to Documents            | G2, MP2             | Runs People's export, then Documents' `fileExport` with the bytes, a 90-day deletion date       |
| Import from Documents          | G4                  | Reads the file from Documents and hands it to People's import as an upload                      |
| Generate letters               | G3                  | Reads People's values for each person, Documents merges them into the template                  |
| Fill a record from a document  | G5, MP3, K9         | Documents extracts values; the shell shows them beside People's; People's own mutation applies  |
| Documents on a profile         | G6, MP4             | People's profile renders Documents' list for that person as plain rows (remote props are JSON)  |
| A document answers HR          | J1, J2, J6, MJ1–MJ5 | Documents extracts; the shell matches against People's pending asks; People's mutation applies  |
| Notes for time off             | J3, J5, MJ3         | Time Off's request names a missing note; the shell offers Documents' matching file and attaches |
| A letter that changes a record | J7, MJ6             | Documents extracts the last day; the shell runs People's and Time Off's own writes, each ticked |

## 6. Access (A1)

### 6.1 Three levels

| Level            | Who can open                                  | Extra protection                                          |
| ---------------- | --------------------------------------------- | --------------------------------------------------------- |
| **Private**      | The owner, and the person it is about with HR | —                                                         |
| **Shared**       | Plus each grant: people, teams, everyone      | —                                                         |
| **Confidential** | As Private or Shared                          | Viewer watermark, no download or print, every open logged |

"Everyone at Acme" is a grant, shown with its own badge. Confidential is a flag
on top of who can open, not a fourth audience.

### 6.2 Who may change it

- The **owner** (whoever created it) may switch between Private and Shared,
  change grants, and turn Confidential on.
- Confidential set **by HR or by the document type** may be lowered only by HR.
- A document **about a person** (contract, payslip, letter) belongs to the
  company. The person may always open and download it (their right of access,
  even when Confidential) but may not hide, delete or reshare it.
- **HR** may open every document filed to a person and every company document;
  never another person's own private document.

The domain decides every one of these (`domain/access/`); OpenFGA holds the
relations (`owner`, `subject`, `viewer`, `editor`, `hr`) and the application
asks it; the resolver never decides.

### 6.3 Grants

A grant names a member, a team, or everyone; `view` or `edit`; and an optional
end date. Switching to Private ends every grant at once. Kithena points out
people the document mentions who cannot open it (E1, AI, Phase 3).

### 6.4 Asking for access (E3, MA2)

Opening a document you cannot open shows its owner (never its title) and one
button. The request becomes an Inbox task for the owner; the answer returns as
an update.

## 7. The library

### 7.1 One screen (B1, B2, MD1, MH1)

Documents is one sidebar item and one phone tab. The screen is: a search box
that also takes questions, what needs you (to sign, to acknowledge, requested
of you), then every document you can open. One dropdown (B6, MD6) sets what the
list shows: All, About me, Shared with me, then company sections (set up by
HR), then your own sections. HR sees four tiles (To sign, Expiring, Missing,
To delete) that filter the same list in place; Deleted is a filter in the ⋯
menu (H3). Every filter is in the URL.

The list's columns are Name, Access, Who can see it, Updated, Status.

### 7.2 Sections (B5, MD5)

- **Company sections** (HR): a named list a document can be in. Shown to anyone
  who can open at least one document in it.
- **Personal sections**: anyone may create them; only they see them. Adding a
  document is a shortcut, never a copy, and never changes its access.

### 7.3 A person's file (B3, MH2)

Every member has a file: the documents filed to them, and the checklist their
document types require ("Required before day one", 3 of 5), each row with its
next action: sign, remind, ask, view. HR and the person see it.

### 7.4 Document requests (H2, MH3)

HR asks a person for a document type by a date, with a message and an optional
blank form. The request is an Inbox task for the person; their upload files
itself against it and ticks it off.

## 8. Adding documents

### 8.1 Upload (C1, MD2)

Any file up to 100 MB: PDF, image (JPEG, PNG, HEIC converted on the phone),
Office documents, CSV. Stored sealed (AES-256-GCM) in the documents bucket;
Postgres holds the metadata and a SHA-256. Page count is read from PDFs.

New documents start **Private** (C3, MD4). One modal follows: keep it private or
share it, with suggested people. People can switch the question off.

HR uploads choose a type and, when the type is filed to each person, a person;
the type's access rules apply.

### 8.2 Versions (C4)

An upload whose name and type match an existing document the uploader may edit
is offered as a new version. Versions are immutable; the document points at its
current one; an envelope or acknowledgement names the version it is about.

### 8.3 Scanning (MD2, MD3)

The phone's + offers scanning first. The camera captures; the photo is uploaded
as an image document. Edge detection and straightening are the device's (Expo
`ImagePicker` with editing); reading the scan is AI (Phase 3).

### 8.4 Bulk split (C2)

One PDF for many people (payslips): Documents splits it by page ranges and
matches each slice to a member (AI, Phase 3); only unmatched slices are asked.

## 9. Viewing

### 9.1 The viewer (D1, MR1)

The document's pages (PDF rendered by the browser's own viewer in an `<iframe>`
on web and by a WebView on the phone; images as images), its access badge,
status, version, and actions: Download (unless Confidential and not yours),
Share, New version, Request signature, Send as policy, Delete.

### 9.2 Confidential viewing (E2, MR4)

The server renders a watermarked copy for the viewer (name and date tiled
across each page) for PDFs and images; the original is never sent. Download
and print are refused unless the viewer is the person it is about. Every open
is logged (who, when, device) and shown to the owner and HR.

## 10. Signatures (K1–K11, MX1–MX7)

### 10.1 The envelope

An envelope names a document version, signers in order (member or external
email), each signer's identity check (Kithena login, or an emailed six-digit
code for people outside the company: §10.4), fields per signer (signature,
initials, date signed, full name, name and title, checkbox, a People value
read-only), a message, a due date, reminders and an expiry.

States: `draft → sent → completed | declined | voided | expired`. Each signer:
`waiting → sent → opened → verified → signed | declined`. Correcting changes
signers or fields without restarting; voiding cancels with a reason;
reassigning hands a signer's turn to someone else when the sender allowed it.

### 10.2 Signing (K4–K7, MX1–MX4)

One field at a time; "Sign here" points at the next one. The first signature
field opens Adopt a signature: type, draw or upload, with initials. Date fields
fill when you sign. Fields of other signers are greyed. The ⋯ menu: ask the
sender, pass it on (if allowed), decline with a reason.

### 10.3 Sealing (K9, MX3)

When the last signer signs, the server stamps each field's value onto the PDF,
appends a certificate of completion page (every step, time, IP, device, and
the identity check used), records the SHA-256 of the result, and files it as a
new, immutable version, Confidential, to the person the document is about.
Copies go to the envelope's copy list.

The signature level is a **simple electronic signature** (eIDAS Art. 3(10)).
A provider setting (K11) leaves room for DocuSign; only the built-in provider
is implemented.

### 10.4 External signers' code

Sent by email through `platform/messaging` (Resend), not SMS: no SMS provider
exists and none is paid for. The code is six digits, valid ten minutes, five
attempts, stored hashed. The port (`IdentityCheck`) takes `email` today and
`sms` later without changing callers.

## 11. Policies and acknowledgements (F2, F3, MH5)

A policy document is sent to an audience (people, teams, locations, everyone)
for acknowledgement or signature, with a due date and reminders. Each person
gets an Inbox task; reading and pressing Acknowledge records it against the
version. New joiners matching the audience get it in onboarding. Tracking shows
done of total, who is left, reminders.

## 12. HR operations

### 12.1 Document types (S2, S3, MS2, MS3)

A type reads as a sentence: filed to (each person / the company), who sees it
(the employee and HR / HR only / everyone / plus named roles), Confidential or
not, signatures (their signature, then HR's), required for (new starters, a
location, everyone) and by when (before day one), expiry and its reminders,
retention, and what Kithena reads from it. Each highlighted part is a menu.
Seeded with the design's fourteen types.

### 12.2 Queues (H1, MH6)

- **To sign**: open envelopes, those needing HR first.
- **Expiring**: documents with an expiry date in the next 60 days, or past.
- **Missing**: required types a member does not have, by their deadline.
- **To delete**: documents whose retention has ended; HR confirms each batch.

### 12.3 Retention, trash and legal holds (H3, S6, MS6)

One rule per type: "4 years after they leave", "5 years", "until they leave
plus 1 year", "every version, forever". A document's deletion date is computed
by the domain from the rule and the member's dates. Nothing is deleted without
HR confirming. Deleted documents wait 30 days in the trash, then their bytes
are destroyed. A legal hold (a case name, who set it, the documents) overrides
both and says so.

### 12.4 Settings (S1, S5, MS1, MS5)

Settings › Documents: document types, company sections, templates, access and
sharing, confidential documents, signatures, acknowledgements, retention,
expiry reminders, AI, files and integrations, activity log. Logging confidential
views cannot be turned off.

### 12.5 Activity log

Every upload, version, share, grant change, confidential view, download,
signature step, acknowledgement and deletion, append-only, readable by HR and
by the owner for their own documents.

## 13. Events

`documents.document.filed`, `.versioned`, `.shared`, `.access_changed`,
`.viewed_confidential`, `.deleted`, `.restored`, `.destroyed`;
`documents.request.created`, `.fulfilled`, `.cancelled`;
`documents.acknowledgement.sent`, `.acknowledged`;
`documents.envelope.sent`, `.signed`, `.declined`, `.completed`, `.voided`;
`documents.type.changed`; `documents.hold.placed`, `.lifted`;
`documents.access.requested`, `.decided`.

Every event carries `occurredAt` and `effectiveFrom`. No event carries a file's
bytes, its text or a value read from it: a document's title is `confidential`,
a signer's email `personal`.

## 14. AI

### 14.1 The rule, and the new decision

People's and the assistant's rule is that a model sees names, never values.
**Documents is the one place a model reads content**, because reading the
document is the feature. Recorded in `docs/tech-stack.md`:

- A model reads a document's text only for someone who may open it, and only
  for that request. Nothing is stored except the answer, keyed to the version.
- Medical documents (a type flagged medical): dates only. The text never leaves
  Documents; a date parser runs locally.
- Types may switch AI off entirely (S7: "Off for investigation notes").
- Documents are never used to train a model; processing is in the EU when the
  provider offers it.
- **The domain still computes every number.** A model cites pages and writes
  sentences; a salary mismatch (K3) is the domain comparing two extracted
  values, not a model's opinion.

### 14.2 The features

| Feature                | Screens       | Domain does                                            | AI does                                            |
| ---------------------- | ------------- | ------------------------------------------------------ | -------------------------------------------------- |
| Summary with citations | D1, MR1       | Extracts text per page; checks every cited page exists | Writes the summary, key facts, the clause to know  |
| Follow-up questions    | D2, MR2       | Restricts to this document                             | Answers with page citations                        |
| Ask across documents   | B4, MR5       | Searches only what the asker can open                  | Answers from the top passages, cited               |
| What changed           | C4, D3        | Diffs the two versions' text                           | Writes one sentence per change                     |
| Sort uploads           | C1, MD3       | Validates type, person, dates against the tenant's own | Suggests type, person, dates, sensitivity          |
| Split a bulk PDF       | C2            | Splits pages, matches by employee number or name       | Suggests a member for ambiguous pages              |
| Read fields            | G5, K9, J1–J7 | Compares extracted values with what the shell passes   | Extracts typed values with their page              |
| Describe a type        | S4, MS4       | Validates the structured type                          | Parses prose into the type; asks the open question |
| Place signature fields | K2            | Places default fields on the last page                 | Suggests positions from the text                   |

Every feature degrades to a working screen without the key. CI runs the
standalone suite with and without it.

## 15. Screens and navigation

### 15.1 Shell

Web: "Documents" (`folder-open`) after People in the sidebar, no sub-items.
Phone: Documents takes the last tab; Me moves to the avatar on Home (MD1).
Settings gains a Documents tab.

### 15.2 Routes (web remote `apps/web/documents`, port 3004)

| Route                                 | Screen         |
| ------------------------------------- | -------------- |
| `/documents`                          | B1, B2, H1, H3 |
| `/documents?show=<section>&q=&queue=` | B6, H1         |
| `/documents/d/<id>`                   | D1, E2         |
| `/documents/d/<id>/versions`          | D3             |
| `/documents/d/<id>/share` (modal)     | E1             |
| `/documents/people/<memberId>`        | B3             |
| `/documents/sign/<envelopeId>`        | K4–K7          |
| `/documents/envelopes/new?doc=`       | K1–K3          |
| `/documents/envelopes/<id>`           | K8, K9         |
| `/documents/policies/<campaignId>`    | F3             |
| `/documents/settings/<page>`          | S1–S7, K11     |
| `/sign/<token>` (public, no shell)    | K4–K6 external |

### 15.3 Reach additions

- `DocumentTile` is not a component: a document's icon is `Avatar shape="rounded"`
  with an icon and a tone.
- `SignaturePad` (draw with pointer or finger, keyboard alternative: type).
- `PageStage`: a page image with absolutely positioned, draggable, resizable
  overlays (dnd-kit), for K2 and K4.
- `CodeInput` (six boxes) if Reach has none.

Each is added to Reach first, presentational, without knowing what a document is.

## 16. Mobile

`apps/tenant-mobile` gets a Documents tab with every operation the web has, or
a reason in `desktop-only.json` (placing fields by hand, K2, is web-only;
the version redline D3 is web-only). Scanning uses the camera.

## 17. Storage

Schema `documents`, role `svc_documents NOBYPASSRLS`, RLS on `tenant_id`, an
outbox relayed by Debezium. Tables: `member`, `document_type`, `section`,
`section_entry`, `document`, `version`, `grant`, `view_log`, `access_request`,
`doc_request`, `campaign`, `acknowledgement`, `envelope`, `signer`, `field`,
`envelope_event`, `retention_rule`, `legal_hold`, `hold_entry`, `activity`,
`settings`, `ai_answer`, `idempotency_key`, `outbox`. Bytes in S3
(`DOCUMENTS_BUCKET`, `DOCUMENTS_S3_*`), sealed with `DOCUMENTS_ENCRYPTION_KEY`;
SeaweedFS locally; in memory in the standalone suite.

## 18. Headless surfaces

GraphQL subgraph `documents` (one query per screen), REST `/v1/documents/...`
with OpenAPI and idempotency keys, webhooks per published event, the public
signing page.

## 19. Non-functional requirements

- Upload ≤ 100 MB; the list answers in under 300 ms for 10,000 documents.
- Watermarked rendering under 2 s for a 10-page PDF.
- Every route enforces access in the application layer; acceptance proves a
  member cannot open, list, download or search a document they may not open.

## 20. Scope and phasing

- **Phase 0 — unblock**: schema, role, outbox, boot, Dockerfile, codegen.
- **Phase 1 — boots alone, does the job**: contracts, domain, storage,
  application, transports, standalone; the web remote and the phone tab with
  the library, upload, viewer, sharing, confidential, sections, people files,
  requests, queues, trash, holds, settings.
- **Phase 2 — signatures and acknowledgements**: K1–K11, F2–F3, MX1–MX7, MH5.
- **Phase 3 — AI**: §14.
- **Phase 4 — with People and Time Off**: §5.4.

Out of scope: DocuSign as a provider, SMS codes, qualified electronic
signatures, OCR without a model, Google Drive import (shown in MD2's menu,
disabled until an integration exists).
