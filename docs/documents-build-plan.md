# Documents module — build plan

Every ticket needed to ship the Documents module, in an order that works. Tick
each box as it lands, in the same commit as the work.

**This file, in the repository, is the record of progress.**

| What                  | Where                                                                                      |
| --------------------- | ------------------------------------------------------------------------------------------ |
| Requirements          | [`docs/documents-prd.md`](./documents-prd.md)                                              |
| Screens, web          | Claude Design project `6fed6ac8…`, page **Kithena Documents**                              |
| Screens, mobile       | Same project, page **Kithena Documents Mobile** (ids prefixed `M` here)                    |
| Screen source on disk | `.claude/design/documents/` (`dc-web.js`); `_build/dc-core.js`, `dc-mob.js` via DesignSync |
| The plan this mirrors | [`docs/timeoff-build-plan.md`](./timeoff-build-plan.md)                                    |

### How the work lands

Everything is built on the branch **`documents`**, one commit per ticket or
small group, and goes to `main` as **one pull request**.

### Rules no ticket restates

- `dependsOn: []`. People and Time Off are joined by the shell (PRD §5.4).
- Zod is the single schema source; every contract field is classified.
- `occurredAt` and `effectiveFrom` on every event.
- No `new Date()` in the domain; calendar dates are `date`.
- Screens are built from Reach; what Reach lacks is added to Reach first.
- Authorization in the application layer, never only in a resolver.
- Every filter and view in the URL; server-rendered first page.
- The domain computes every number; a model reads, cites and writes (PRD §14).

---

## Phase 0 — unblock

- [x] **DOC-001** Schema bootstrap: `documents` schema, `svc_documents NOBYPASSRLS`,
      `init-db.sql`, `atlas.sum`. Integration test: no tenant, no rows.
- [x] **DOC-002** Outbox and Debezium: `documents.outbox`, Debezium table list.
- [x] **DOC-003** `services/documents` boots like Time Off: `main.ts`, `/healthz`,
      `/graphql`, `DOCUMENTS_PORT` 4003, `module.manifest.ts` (`dependsOn: []`,
      `requiresPeopleSource: 'either'`).
- [x] **DOC-004** Dockerfile; `module.documents` offered (`OFFERED_MODULES`).
- [x] **DOC-005** Codegen walks `documentsEvents`.

## Phase 1 — boots alone, does the job

### Contracts

- [x] **DOC-006** Primitives and views: access level, grant, document, version,
      type, section, request, queue counts (`packages/contracts/src/documents`).
- [x] **DOC-007** Events (PRD §13), each payload classified.

### Domain (test first)

- [x] **DOC-008** Access rules (PRD §6.2): who opens, downloads, shares, lowers
      Confidential, deletes; about-me documents.
- [x] **DOC-009** Document aggregate: file, version, share, grants with end
      dates, Private ends grants, Confidential with its setter, delete, restore.
- [x] **DOC-010** Document types: the sentence parts, required-for, expiry,
      retention rule; the fourteen seeded types.
- [x] **DOC-011** Retention: deletion date from rule and member dates; holds win;
      30-day trash.
- [x] **DOC-012** A person's checklist: required types, what they have, next action.
- [x] **DOC-013** Queues: to sign, expiring (60 days), missing, to delete.
- [x] **DOC-014** Sections: company and personal; entries never change access.
- [x] **DOC-015** Document requests and access requests.

### Storage and application

- [x] **DOC-016** Tables and RLS (PRD §17), Drizzle definitions, unit of work.
- [x] **DOC-017** Blob store: sealed S3 (copied from People), in-memory; SeaweedFS
      locally.
      As built: sealed S3 (`infrastructure/blobs.ts`), memory without a bucket; presigned transfers (`transfers.ts`) carry files past the shell, `incoming/` and `outgoing/` kept a day.
- [x] **DOC-018** Members: projection from People events and an import; HR from
      identity's administrator events.
- [x] **DOC-019** Use cases: upload, version, share, protect, view (with log),
      download, delete, restore, sections, requests, access requests, settings.
- [x] **DOC-020** Confidential rendering: watermark PDFs and images per viewer.
- [x] **DOC-021** Screen reads: library, viewer, person file, settings pages.

### Transports

- [x] **DOC-022** REST and OpenAPI with idempotency keys; upload as a raw body.
      As built: files are presigned uploads (`startDocumentUpload`) and links (`documentsFile`); base64 in the request only without a bucket.
- [x] **DOC-023** Subgraph generated from the routes; `just supergraph` composes.
- [x] **DOC-024** OpenFGA model: `owner`, `subject`, `viewer`, `editor`, `hr`.
      As built: no OpenFGA — access is decided by the domain over Documents' own rows, agreed 2026-10-12 (`docs/tech-stack.md`, "Documents").
- [x] **DOC-025** Inbox source: to sign, to acknowledge, requested, access requests.
- [x] **DOC-026** Composition root, seed for Acme (the design's documents).
- [x] **DOC-027** Standalone acceptance: People absent, AI keys unset; a member
      cannot open, list, download or find what they may not open.
- [x] **DOC-028** CI standalone matrix, deploy (compose, `deploy.sh`, router),
      `docs/environments.md` names for a person.

### Web

- [x] **DOC-029** Reach: `SignaturePad`, `PageStage`, `CodeInput`, document icon
      tones on `Avatar`.
      As built: nothing to add yet — Reach already has `SignaturePad`, `PinInput`, `Dropzone`, `Stepper`; the document icon is `Avatar shape="rounded"` with a tone. `PageStage` comes with K2 (DOC-045).
- [x] **DOC-030** The shell loads a third remote; `apps/web/documents` (port 3004);
      sidebar item; persisted operations.
      As built: `/documents` opens `/documents/all`; the shell's area, `lib/documents-*.ts`, `components/documents-screen.tsx`, Inbox source and phone route all take `documents`.
- [x] **DOC-031** Library B1, B2, B6, H1, H3 (queues and Deleted in place).
- [x] **DOC-032** Upload C1 (type, person) and the share question C3; new version C4.
- [x] **DOC-033** Viewer D1 without AI; confidential E2; access request E3.
- [x] **DOC-034** Share E1.
- [x] **DOC-035** Personal sections B5; a person's file B3; asking for a document H2.
- [x] **DOC-036** Settings S1, S2, S3, S5, S6.

### Mobile

- [x] **DOC-037** Documents tab replaces Me (MD1); Me moves to the avatar on Home.
- [x] **DOC-038** MD2, MD4, MD5, MD6, MA1, MA2, MR1, MR4 without AI; scan to upload.
- [x] **DOC-039** HR: MH1, MH2, MH3, MH6; settings MS1–MS3, MS5, MS6.
- [x] **DOC-040** Coverage gate: every web operation in the app or `desktop-only.json`.

## Phase 2 — signatures and acknowledgements

- [x] **DOC-041** Envelope domain: signers in order, fields, states, correct,
      void, reassign, decline, expiry (test first).
- [x] **DOC-042** Sealing: stamp fields on the PDF, certificate of completion,
      file the signed version.
- [x] **DOC-043** Identity check: Kithena login, or an emailed code through
      messaging (hashed, 10 minutes, 5 attempts).
      As built: outside signers get a link (`<tenant>.<random>`, stored as its SHA-256) and a six-digit code, both emailed by messaging (`signature_requested`, `signing_code`); the shell's `/sign/<token>` page reaches Documents' public routes.
- [x] **DOC-044** Envelope storage, use cases, routes, events, Inbox items.
- [x] **DOC-045** Web K1–K3: signers, placing fields, review and send.
      As built: placing fields is page and side per signer, plus initials on every page; Kithena's defaults otherwise. Dragging fields onto a rendered page (`PageStage`) is left for a follow-up.
- [x] **DOC-046** Web K4–K7: the signer's page, adopt a signature, code, ⋯ menu;
      the public `/sign/<token>` page.
- [x] **DOC-047** Web K8–K11: tracking, sealed, every request, settings.
- [x] **DOC-048** Acknowledgement campaigns: domain, routes, Inbox, F2, F3.
- [x] **DOC-049** Mobile MX1–MX7, MH5.

## Phase 3 — AI

- [x] **DOC-050** Decision recorded in `docs/tech-stack.md`; text extraction per
      page; AI ports (`Reader`, `Writer`) through the gateway; medical dates only.
      As built: one `Reader` port (`infrastructure/reader.ts`), the assistant's
      OpenAI-compatible endpoint rather than the AI gateway, whose free-text rule
      refuses document text; unpdf reads pages (`application/text.ts`); a medical
      type is read for dates by code (`datesIn`) and never sent. Every limit is
      enforced in `application/ai.ts`; no key means every feature answers "not
      available" and the screens work without it.
- [x] **DOC-051** Summary with page citations D1, MR1; payslip explained MR4.
      As built: `keepCited` drops any claim citing a page the document lacks; a
      payslip gets the same summary, its type's `aiReads` naming what matters.
- [ ] **DOC-052** Follow-ups D2, MR2 through Ask Kithena's window; assistant
      capabilities for Documents. Built: questions about one document inside its
      summary card, web and phone (`askDocument`). Left: the same in the
      assistant's window, and Documents' assistant capabilities.
- [x] **DOC-053** Ask across documents B4, MR5 (only what the asker can open).
      As built: a search that reads as a question offers Ask Kithena; code picks
      passages (`passages`) from the 40 most recent documents the asker may open,
      never a medical one, and the model answers from those alone.
- [x] **DOC-054** Version compare D3, "what changed" in C4. As built: the
      previous version against the current one, lines by code (`changedLines`)
      and a sentence each by the model; the phone leaves it to the web.
- [ ] **DOC-055** Sort uploads C1, MD3; bulk split C2. Built: C1, HR's PDF
      read as it is chosen, type, person, name and expiry filled for HR to check.
      Left: MD3 (phone scans are images; needs OCR) and the bulk split C2.
- [ ] **DOC-056** Describe a type S4, MS4; AI settings S7, MS7; field placement K2.
      Built: S4 (the draft opens the type editor), S7 and MS7 (switches in
      `documents.settings`, read with Settings › Documents); MS4 is the web's.
      Left: K2, suggesting where signature fields go.

## Phase 4 — with People and Time Off

- [ ] **DOC-057** People's ⋯ menu G1, MP1; export to Documents G2, MP2.
- [ ] **DOC-058** Import from Documents G4.
- [ ] **DOC-059** Generate letters G3 (templates and merge).
- [ ] **DOC-060** Fill a record from a document G5, MP3, K9.
- [ ] **DOC-061** Documents on a profile G6, MP4.
- [ ] **DOC-062** Uploads that answer HR J1, J2, J6, MJ1, MJ2, MJ5.
- [ ] **DOC-063** Notes for time off J3, J4, J5, MJ3, MJ4; HR files a photo MH4.
- [ ] **DOC-064** A letter that changes a record J7, MJ6.

## Blocked / left for a person

- Environment secrets and the Vercel project for `apps/web/documents`, the S3
  bucket and `DOCUMENTS_*` settings (named in `docs/environments.md` by DOC-028).
