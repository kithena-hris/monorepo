# Design

The tenant app draws only from Reach (`packages/ui`): its tokens, components and motion. This file records how screens compose Reach, not a second system. When a screen needs something Reach lacks, Reach gets a variant first.

## Headers stay lean

- A page header holds a title, its status as `meta`, at most one primary action (`variant="primary"`), at most one secondary decision, and a `MoreMenu` (`apps/web/recruiting/src/shared.tsx`) for everything else.
- A view switch, search, sort and filters belong to a toolbar row under the header, never to the header.
- Inside a `ModalPage`, the header holds navigation (close, previous, next) and the `MoreMenu`. The decision (primary and Reject) sits in `ModalPageFooter`, where a thumb is.

## Recruiting surfaces

- **Spotlight** (`Spotlight` in `candidate.tsx`): one application, one surface, opened as a page from a link or over the board as a full-screen `ModalPage` (its content centred, `max-w-7xl`), so an offer can open over it. Its order:
  - an identity strip: `Avatar 2xl`, then the job on a line of its own, "Via Kithena Jobs · Applied 24 Oct" under it, then contact links (the header already names the person);
  - the stage rail: a `Stepper` with `free`, `size="sm"`, inside a padded `Card`; pressing a stage moves the candidate there through the move dialog;
  - a work column: up-next cards, Interviews and scorecards, Questionnaire, Evidence, Pre-hire, References, Messages (a `ChatLog` thread that scrolls in its own box), Journey;
  - the overlay's body is padded (`px-4 py-5`, `@2xl:px-8 @2xl:py-7`): `ModalPageBody` leaves page padding to its caller.
  - a sticky side column, `lg:` and `22rem` wide: Notes, Details, Read from the CV.

  Each section is a `Card` with a `CardHeader` and at most one action. Cards are never nested. J and K walk the board behind the overlay.

  A stage's work belongs to it. Before the offer stage, the spotlight books interviews and shows the time requests still open; from the offer stage on, those actions are gone and the interviews read as history. Leaving a stage closes its open time requests; going back before the offer stage withdraws the open offer; arriving at the offer stage drafts a new one from the job (`stage-work.ts` in the service). Coming back to a stage is a new visit with new work.

- **Journey** (`journey.tsx`): Reach's `Timeline`, one item per visit to a stage, newest first, the current one pulsing with "Now". Inside each visit, what happened while the candidate was there: emails, time requests and their answers, interviews (upcoming ones marked), scorecards, offers. Offered times show under their day as badges, the chosen one in success.
- **Offer** (`offers.tsx`): one centred column, no tabs and no steps: the checks and the total first, then Pay, Dates, Contract, Time and place, Probation and notice, Clauses and Benefits, each filled from the job and the country pack, and the rules that applied last. It opens as a `ModalPage size="column"` over the page it came from (`?offer=` on the offers list, the board or a candidate), and as a page of its own from a link. Money is a `CurrencyField` (the currency inside); every other number is a `NumberField` with its unit inside, a length in the unit the law gives it. There is no Save button: a press saves at once, typing saves once it pauses, and "Saved" sits beside the title. Benefits use the job's `BenefitPicker`, with a `TagsInput` for benefits written in for this offer alone.
- **Board** (`pipeline.tsx`): the `Kanban` fills from its top to the window's bottom (`useFillHeight`), so each column scrolls on its own. A sideways swipe anywhere on the board scrolls the board (the column lists contain only vertical scrolling), the scrollbar sits under the columns rather than on their edge, and columns snap only under a finger. The whole card drags (`dragActivator: { mode: 'card' }`), and a press opens the spotlight (`onCardOpen`). A card reads:
  - name and days in stage;
  - one badge row: ideal, match, knockout, duplicate;
  - an optional footer line: the next interview, or the scorecards owed.
- **Jobs list** (`home.tsx`): a `SegmentedControl` of states (Open, Drafts, Closed, Archived, All) with counts, a search, and a `DataTable` with these columns:
  - the job, with its team and place;
  - its pipeline as accent bars, plus its active and new counts;
  - where it is live, as success badges;
  - its hiring manager as an avatar;
  - its state.

  A row opens the board. Its `RowMenu` carries the lifecycle from `job-actions.tsx`: edit, dashboard, archive, bring back, and delete for a job nobody applied to.

## Inbox

- **One feed** (`components/inbox/screen.tsx`, `lib/inbox/model.ts` `feedOf`), never lanes in tabs. Sections, in order, each a lean heading with its count:
  - **New**: arrived and not opened, newest first. A task is new until opened, for a week; an update until read. Its heading carries **Mark all seen**, its count is the one accent badge, and a task in it says **Needs you** on its row.
  - **Needs you**: tasks, overdue first, somebody else's last.
  - **Waiting on others**: the person's requests.
  - **For your information**: read updates, newest first.
- **Three of one kind stack** under one row (`StackRow`): the first item, "and N more like it", and its count; pressing it opens the rest beneath it.
- **The toolbar**: search, a filter menu for the module (an icon until one is chosen, then its name), the view menu (Inbox, Snoozed, Done) and Select. Under a finger, Select is gone: rows swipe instead. Under it, choice chips with counts: All, Needs you, Waiting, Updates.
- **Every view is an address**: `/inbox`, `/inbox/todo`, `/inbox/requests`, `/inbox/updates`, `/inbox/snoozed`, `/inbox/done`, each with `?item=`.
- **An item stays where it was while you are there**: opening one marks it seen without moving it; the next visit, or Mark all seen, sorts again.
- **The item opens beside the list** (`ListDetail`, list 30rem) and is done there: each module's kind has its own body, and Open in … is the fallback, never the first action.
- **Push** (Settings › Notifications): one card, "Push notifications on this device", above the rows; the rows' Phone switches route to every device a person turned push on for.

## Colour and motion

- Restrained: neutrals from the canvas and surfaces. The accent is reserved for the primary action, the current stage and progress.
- Stage dots follow `CATEGORY_TONE`. Success marks only an ideal match or a live target.
- Motion is Reach's own: the `ModalPage` slide-in, the `Kanban` lift and settle, and popovers on `popover-motion`. No screen adds keyframes.
- Every overlay (dialog, alert, sheet, modal page, palette) blurs what is behind it by one Reach token, `--reach-overlay-blur`, so the modal is the only thing to read.
- A card's description sits under its title, never beside it (Reach's `CardHeader`); an action stays on the title's line.
- Choices that a contract carries are picked, never typed: the region from the country pack's list, the collective agreement and group from the company's list in Settings, Pay bands.
