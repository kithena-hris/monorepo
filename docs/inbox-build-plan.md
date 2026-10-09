# Inbox: build plan

The task inbox, web and phone, from the Claude Design project (`Kithena Inbox.dc.html`, ids A1–Z4;
`Kithena Inbox Mobile.dc.html`, ids A1–Z2 prefixed **M** here). The design's source is
`_build/ib-*.js`; the web part is kept in `.claude/design/inbox/ib-web.js`.

This file is the record of progress: tick a ticket when it lands. Everything is built on the
`inbox` branch and goes to `main` in one pull request.

## What the Inbox is

One place for everything that reaches a person, in two lanes plus two trackers:

| Lane | Means | Counted | Leaves when |
| --- | --- | --- | --- |
| **To do** (task) | Something would go wrong if they never opened it | The red number, everywhere | Done, sent back, handed over, snoozed, cancelled |
| **Updates** | Something happened; nothing is owed | A blue dot, never a number | Read; tidied into Done after 30 days |
| **My requests** | Something they started, waiting on someone | No | Decided, withdrawn or lapsed: it becomes an update |
| **Done** | Finished tasks, decided requests, old updates | No | Never (kept with the record) |

The sender always says which: Kithena never guesses whether something needs action (A2).

## Decisions

1. **No inbox service and no copy of items.** Each module answers one read, in one shape
   (`packages/contracts/src/inbox`), from what it already keeps: People's details requests,
   pending changes, documents, onboarding; Time Off's requests and approvals. An item's state
   (open, done, cancelled) is the module's own row, so the Inbox can never disagree with the
   module, and there is no dual write to keep in step. A new module joins by answering the same
   read and adding one line to the shell's sources (`apps/web/src/lib/inbox/sources.ts`).
2. **The shell merges.** `apps/web/src/lib/inbox` asks every module the company has, at once,
   and merges: lanes, the due-date groups, the count (tasks only), the source filter. The web
   page and the phone (`/api/mobile/inbox`) run the same code.
3. **What is the person's alone lives with their account.** Read, snoozed until, moved to Done
   early, muted kinds, channels and quiet hours are identity's account preferences (`inbox`,
   `notifications`), the same store as the sidebar and shortcuts. They follow the person across
   devices and never reach a module.
4. **Acting where you read runs the module's own write.** Approve, decline, withdraw, sign,
   fill in, send back: each is the owning module's operation, through the router, as the
   person. The Inbox decides nothing; the module still decides who may.
5. **Ids are stable and say where they come from**: `<module>:<kind>:<id>`, so state written
   against an item survives every read, and "Open in …" and links resolve without a lookup.
6. **Fast**: one read per module, in parallel, answered from indexes; the phone keeps the last
   answer (`useRead`) and reads it ahead at sign-in; the web lists are server-rendered with the
   selected item, and moving between items is client-side.

## Tickets

### Foundation

- [ ] **INB-001** The contract: `InboxItem` (lane, kind, module, area, title, summary, from,
      dates, due and its tone, status, outcome, unread, count, team, actions, link, detail) in
      `packages/contracts/src/inbox`, every field classified; per-kind detail schemas.
- [ ] **INB-002** Shell sources registry and merge (`lib/inbox`): ask each entitled module at
      once, merge, group by due (Overdue, Due this week, Later; Today/Yesterday/Earlier for
      updates; by month for Done), count tasks only, source filter and sort. Unit tests.
- [ ] **INB-003** Person state in identity preferences: read, unread again, snoozed until (never
      past the due date), moved to Done, muted kinds and channels; 30-day tidy of updates.
- [ ] **INB-004** Actions router: one server action / mobile route per action, dispatched by
      the item's kind to its module's operation; results re-read the lists.

### Time Off as a source (A2 rows "Time off")

- [ ] **INB-010** `timeOffInbox` read: approvals waiting on the caller as tasks (dates, who
      else is out that week, balance after, first ask), with Decide by from the escalation
      rules (G1).
- [ ] **INB-011** The caller's own pending requests as My requests (steps, who has it and since
      when, cover shown when delegated) and decided ones as updates and in Done (D1, D4, E3, F1).
- [ ] **INB-012** Days about to expire as a task; a holiday calendar published as an update
      (C9, D6 holiday calendar).
- [ ] **INB-013** Nudge an approver once after 48 hours; withdraw (E1, E3).

### People as a source

- [ ] **INB-020** `peopleInbox` read: details HR asked for, as tasks with the fields inline (C1);
      a refused value as a task with the reason and the old value (C2).
- [ ] **INB-021** Own pending changes as My requests with steps (E1, D3), decided ones as
      updates, withdraw (E2).
- [ ] **INB-022** Review as one bundled task per viewer, counted once (G2, H1).
- [ ] **INB-023** Onboarding as a task with steps for the starter (S1, M:S1) and for the
      manager (G5).
- [ ] **INB-024** Import stopped (task for whoever ran it), export ready and a scheduled report
      ready (updates); someone joins or leaves your team (update).
- [ ] **INB-025** Questions on a task: a thread on a details request, reply count on the row
      (C7, M:B6).
- [ ] **INB-026** Send back with a reason (C8), cancelled by the sender with the fields locked
      (Z2), due dates and reminders on details requests.
- [ ] **INB-027** Track what you asked for: a request to many people as one row with progress,
      remind the ones left, change the due date, cancel for everyone (H2, H4).
- [ ] **INB-028** Documents: send a document to keep, acknowledge or sign (H3); shared to keep is
      an update (D2); acknowledge and sign are tasks (C3); signing by typing or drawing with time,
      place and name recorded (C4); countersign task for the sender; kept in the profile; receipts
      in Done (F1).
- [ ] **INB-029** Team tasks: an integration failing three times is a task for every admin;
      Take it, Take it over, and it stops counting for the others (H1, Z3).

### Web

- [ ] **INB-030** `/inbox/todo`, `/inbox/updates`, `/inbox/requests`, `/inbox/done` with the
      selected item in the address (`?item=`); list card with search, source filter and sort;
      detail pane with kind, module, ask, fields, activity and one primary action (C1).
- [ ] **INB-031** Task details per kind: fill in (C1), correct (C2), sign and the signing
      dialog (C3, C4), approve time off (G1), bundled queue (G2), steps (G5, S1), team task (H1).
- [ ] **INB-032** Done → next task with Undo (C5); the task menu: ask, remind me later (capped at
      the due date), I can't do this, open in, copy link (C6); overdue and snoozed groups (C9).
- [ ] **INB-033** Updates: read on open, mark unread, mark all read, select and tidy, move to
      Done, mute like this (D1–D6).
- [ ] **INB-034** My requests and Done (E1–E3, F1, H4).
- [ ] **INB-035** Manager: bulk approve same-kind tasks with the warning (G3); hand over while
      away (G4).
- [ ] **INB-036** Sidebar Inbox with the task count (dot when only updates are unread), the bell
      peek with both lanes, `G N`, a toast when a task arrives, Home's To do card (B1–B3).
- [ ] **INB-037** HR: Ask for details and Send a document from a profile (H2, H3).
- [ ] **INB-038** Settings › You › Notifications (P1) and Settings › Organisation › Inbox rules
      (P2).
- [ ] **INB-039** Empty To do (Z1); Ask Kithena about your inbox (Z4).

### Phone

- [ ] **INB-040** Inbox tab with the segmented lanes and the task count on the tab (M:A1).
- [ ] **INB-041** Task pages with the pinned button: fill in, correct, sign and the signing
      dialog (M:B1–B4); the anchored menu, questions, done with Undo (M:B5–B7).
- [ ] **INB-042** Updates with swipe to read or mute (updates only), details and shortcuts
      (M:C1–C5).
- [ ] **INB-043** My requests with the tracker, Nudge and Withdraw (M:D1, M:D2); Done with search
      (M:E1).
- [ ] **INB-044** Manager and HR: To do, approve time off, hand over, team task with Take it,
      bundled Review (M:F1–F3, M:G1); the starter's checklist (M:S1).
- [ ] **INB-045** Notification settings with tasks locked on (M:I1); empty To do and Ask Kithena
      (M:Z1, M:Z2).

### Reaching people

- [ ] **INB-050** Email: tasks right away, updates in a daily digest, per kind and channel;
      quiet hours hold both except tasks due today.
- [ ] **INB-051** Phone push: tasks one by one with their actions, updates grouped (M:A2).

### Speed and checks

- [ ] **INB-060** Each module's read measured on the production VM under 300 ms cold; the phone
      reads the Inbox ahead at sign-in; the web list and selected item are server-rendered.
- [ ] **INB-061** Browser acceptance: an employee fills in a task, a manager approves time off
      in place, HR sends a document and the employee signs it.

## Progress notes

Each ticket's notes go here as it lands: what was built, where, and anything left on purpose.
