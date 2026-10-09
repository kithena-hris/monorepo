# Inbox: build plan

The task inbox, web and phone, from the Claude Design project (`Kithena Inbox.dc.html`, ids A1–Z4;
`Kithena Inbox Mobile.dc.html`, ids A1–Z2 prefixed **M** here). The design's source is
`_build/ib-*.js`; the web part is kept in `.claude/design/inbox/ib-web.js`.

This file is the record of progress: tick a ticket when it lands. Everything is built on the
`inbox` branch and goes to `main` in one pull request.

## What the Inbox is

One place for everything that reaches a person, in two lanes plus two trackers:

| Lane             | Means                                            | Counted                    | Leaves when                                        |
| ---------------- | ------------------------------------------------ | -------------------------- | -------------------------------------------------- |
| **To do** (task) | Something would go wrong if they never opened it | The red number, everywhere | Done, sent back, handed over, snoozed, cancelled   |
| **Updates**      | Something happened; nothing is owed              | A blue dot, never a number | Read; tidied into Done after 30 days               |
| **My requests**  | Something they started, waiting on someone       | No                         | Decided, withdrawn or lapsed: it becomes an update |
| **Done**         | Finished tasks, decided requests, old updates    | No                         | Never (kept with the record)                       |

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

- [x] **INB-001** The contract: `InboxItem` (lane, kind, module, area, title, summary, from,
      dates, due and its tone, status, outcome, unread, count, team, actions, link, detail) in
      `packages/contracts/src/inbox`, every field classified; per-kind detail schemas.
- [x] **INB-002** Shell sources registry and merge (`lib/inbox`): ask each entitled module at
      once, merge, group by due (Overdue, Due this week, Later; Today/Yesterday/Earlier for
      updates; by month for Done), count tasks only, source filter and sort. Unit tests.
- [x] **INB-003** Person state in identity preferences: read, unread again, snoozed until (never
      past the due date), moved to Done, muted kinds and channels; 30-day tidy of updates.
- [x] **INB-004** Actions router: one server action / mobile route per action, dispatched by
      the item's kind to its module's operation; results re-read the lists.

### Time Off as a source (A2 rows "Time off")

- [x] **INB-010** `timeOffInbox` read: approvals waiting on the caller as tasks (dates, who
      else is out that week, balance after, first ask), with Decide by from the escalation
      rules (G1).
- [x] **INB-011** The caller's own pending requests as My requests (steps, who has it and since
      when, cover shown when delegated) and decided ones as updates and in Done (D1, D4, E3, F1).
- [x] **INB-012** Days about to expire as a task; a holiday calendar published as an update
      (C9, D6 holiday calendar).
- [x] **INB-013** Nudge an approver once after 48 hours; withdraw (E1, E3).

### People as a source

- [x] **INB-020** `peopleInbox` read: details HR asked for, as tasks with the fields inline (C1);
      a refused value as a task with the reason and the old value (C2).
- [x] **INB-021** Own pending changes as My requests with steps (E1, D3), decided ones as
      updates, withdraw (E2).
- [x] **INB-022** Review as one bundled task per viewer, counted once (G2, H1).
- [x] **INB-023** Onboarding as a task with steps for the starter (S1, M:S1) and for the
      manager (G5).
- [x] **INB-024** Import stopped (task for whoever ran it), export ready and a scheduled report
      ready (updates); someone joins or leaves your team (update).
- [x] **INB-025** Questions on a task: a thread on a details request, reply count on the row
      (C7, M:B6).
- [x] **INB-026** Send back with a reason (C8), cancelled by the sender with the fields locked
      (Z2), due dates and reminders on details requests.
- [x] **INB-027** Track what you asked for: a request to many people as one row with progress,
      remind the ones left, change the due date, cancel for everyone (H2, H4).
- [x] **INB-028** Documents: send a document to keep, acknowledge or sign (H3); shared to keep is
      an update (D2); acknowledge and sign are tasks (C3); signing by typing or drawing with time,
      place and name recorded (C4); countersign task for the sender; kept in the profile; receipts
      in Done (F1).
- [x] **INB-029** Team tasks: an integration failing three times is a task for every admin;
      Take it, Take it over, and it stops counting for the others (H1, Z3).

### Web

- [x] **INB-030** `/inbox/todo`, `/inbox/updates`, `/inbox/requests`, `/inbox/done` with the
      selected item in the address (`?item=`); list card with search, source filter and sort;
      detail pane with kind, module, ask, fields, activity and one primary action (C1).
- [x] **INB-031** Task details per kind: fill in (C1), correct (C2), sign and the signing
      dialog (C3, C4), approve time off (G1), bundled queue (G2), steps (G5, S1), team task (H1).
- [x] **INB-032** Done → next task with Undo (C5); the task menu: ask, remind me later (capped at
      the due date), I can't do this, open in, copy link (C6); overdue and snoozed groups (C9).
- [x] **INB-033** Updates: read on open, mark unread, mark all read, select and tidy, move to
      Done, mute like this (D1–D6).
- [x] **INB-034** My requests and Done (E1–E3, F1, H4).
- [x] **INB-035** Manager: bulk approve same-kind tasks with the warning (G3); hand over while
      away (G4).
- [x] **INB-036** Sidebar Inbox with the task count (dot when only updates are unread), the bell
      peek with both lanes, `G N`, a toast when a task arrives, Home's To do card (B1–B3).
- [x] **INB-037** HR: Ask for details and Send a document from a profile (H2, H3).
- [x] **INB-038** Settings › You › Notifications (P1) and Settings › Organisation › Inbox rules
      (P2).
- [x] **INB-039** Empty To do (Z1); Ask Kithena about your inbox (Z4).

### Phone

- [x] **INB-040** Inbox tab with the segmented lanes and the task count on the tab (M:A1).
- [x] **INB-041** Task pages with the pinned button: fill in, correct, sign and the signing
      dialog (M:B1–B4); the anchored menu, questions, done with Undo (M:B5–B7).
- [x] **INB-042** Updates with swipe to read or mute (updates only), details and shortcuts
      (M:C1–C5).
- [x] **INB-043** My requests with the tracker, Nudge and Withdraw (M:D1, M:D2); Done with search
      (M:E1).
- [x] **INB-044** Manager and HR: To do, approve time off, hand over, team task with Take it,
      bundled Review (M:F1–F3, M:G1); the starter's checklist (M:S1).
- [x] **INB-045** Notification settings with tasks locked on (M:I1); empty To do and Ask Kithena
      (M:Z1, M:Z2).

### Reaching people

- [x] **INB-050** Email: tasks right away, updates in a daily digest, per kind and channel;
      quiet hours hold both except tasks due today.
- [x] **INB-051** Phone push: tasks one by one with their actions, updates grouped (M:A2).

### Speed and checks

- [x] **INB-060** Each module's read measured on the production VM under 300 ms cold; the phone
      reads the Inbox ahead at sign-in; the web list and selected item are server-rendered.
- [x] **INB-061** Browser acceptance: an employee fills in a task, a manager approves time off
      in place, HR sends a document and the employee signs it.

## Progress notes

Each ticket's notes go here as it lands: what was built, where, and anything left on purpose.

- **INB-001** `packages/contracts/src/inbox`: `InboxItem` and `InboxAnswer`, and a detail schema per
  kind (`detail.ts`). Row icons are the design system's words (`edit`, `document`, `leave`), so a
  module never picks a glyph.
- **INB-002 to INB-004** `apps/web/src/lib/inbox`: `sources.ts` (one line per module), `model.ts`
  (merge, the person's state laid over it, groups, counts, filters, prune, the state changes the
  web's actions and the phone's route share), `server.ts` (once per request), and
  `app/(app)/inbox/actions.ts`, each acting on an item through its module's own operation.
- **INB-010 to INB-013** `services/timeoff/src/application/screens/inbox.ts`, `GET
/v1/timeoff/inbox`; nudge once after 48 hours.
- **INB-020 to INB-027** `services/people/src/application/inbox`: `inbox.ts` reads People's items;
  `asks.ts` keeps an ask for details as one row per person and batch (`people.detail_ask`, with its
  thread), filled in, answered, sent back, cancelled, reminded and re-dated; a change of one's own
  can be nudged once (`people.change_nudge`). Exports ready are news while their links last.
- **INB-028** `documents.ts` and `people.document`: keep, acknowledge or sign (typed, or drawn with
  Reach's new `SignaturePad`), the time, place and name recorded; whoever sends it countersigns
  where asked. Listed under the person's Documents on the web and the phone.
- **INB-029** `team.ts` and `people.inbox_claim`: an integration failing is every People
  administrator's task until one takes it.
- **INB-030 to INB-039** `apps/web/src/components/inbox`: the four lanes as addresses with the open
  item in `?item=`, every kind's pane, the menus, snooze, bulk decisions, hand over (Time Off's
  cover), the bell and its count streamed into the layout, Home's To do card (People's Home takes
  the shell's card in its slot), Settings > Notifications, Settings > People > Organisation > Inbox
  rules (`tenant_settings.inbox_rules`: reminders, escalation to the manager, default due dates, the
  team-task threshold), Ask Kithena about your inbox, answered from the Inbox itself.
- **INB-040 to INB-045** `apps/tenant-mobile/src/inbox`: the tab, each item on its own page with
  pinned buttons, swipe and long press on updates, the phone's hand over, notification settings,
  Ask Kithena; `/api/mobile/inbox` answers the web's merge, already grouped.
- **INB-050** `platform/messaging`: `inbox_task`, `inbox_update` and `inbox_digest` notices, each
  person's choices read from identity, updates held in `messaging.inbox_digest` for one daily
  digest (Vercel cron). People sends them for documents and answered asks. Left on purpose:
  Time Off's own email waits until Time Off knows a company's name and address (it consumes no
  `identity.tenant.*` yet); its tasks still reach the Inbox, the bell and the phone. Messaging needs
  `INTERNAL_API_URL` to follow each person's choices and `CRON_SECRET` for the cron; without them
  the defaults apply and the digest can be started with the internal token.
- **INB-051** The phone raises its own notifications from its Inbox read (`expo-notifications`): a
  task one by one with Open and Remind me tomorrow, updates grouped, quiet hours holding all but a
  task due today. Server push through Expo is the upgrade once the app ships a build with a push
  credential.
- **INB-060** Measured on the acceptance stack (production builds): People's read 84 ms, Time
  Off's 11 ms (median warm), the Inbox page drawn on the server with its item in 278 ms.
- **INB-061** `apps/web/acceptance/inbox.acceptance.test.ts`: fill in, approve in place, sign and
  countersign, and the speed check, in a browser against the real stack.
- Not built, by the product's own rule: the phone's "What changes" summary of a document (M:B3)
  would need a model to read the document, and the assistant's model never sees a value.
