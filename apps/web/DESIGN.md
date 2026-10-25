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

## Colour and motion

- Restrained: neutrals from the canvas and surfaces. The accent is reserved for the primary action, the current stage and progress.
- Stage dots follow `CATEGORY_TONE`. Success marks only an ideal match or a live target.
- Motion is Reach's own: the `ModalPage` slide-in, the `Kanban` lift and settle, and popovers on `popover-motion`. No screen adds keyframes.
