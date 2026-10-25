# Design

The tenant app draws only from Reach (`packages/ui`): its tokens, components and motion. This file records how screens compose Reach, not a second system. When a screen needs something Reach lacks, Reach gets a variant first.

## Headers stay lean

- A page header holds a title, its status as `meta`, at most one primary action (`variant="primary"`), at most one secondary decision, and a `MoreMenu` (`apps/web/recruiting/src/shared.tsx`) for everything else.
- A view switch, search, sort and filters belong to a toolbar row under the header, never to the header.
- Inside a `ModalPage`, the header holds navigation (close, previous, next) and the `MoreMenu`. The decision (primary and Reject) sits in `ModalPageFooter`, where a thumb is.

## Recruiting surfaces

- **Spotlight** (`Spotlight` in `candidate.tsx`): one application, one surface, opened as a page from a link or over the board as a `ModalPage size="inset"`. Its order:
  - an identity strip: `Avatar 2xl`, then job · source · applied, then contact links;
  - the stage rail: a `Stepper` with `free`, `size="sm"`, inside a padded `Card`; pressing a stage moves the candidate there through the move dialog;
  - a work column: up-next cards, Interviews and scorecards, Questionnaire, Evidence, Offers, References, Messages, Activity;
  - a sticky side column, `lg:` and `22rem` wide: Notes, Details, Read from the CV.

  Each section is a `Card` with a `CardHeader` and at most one action. Cards are never nested. J and K walk the board behind the overlay.
- **Board** (`pipeline.tsx`): the `Kanban` fills from its top to the window's bottom (`useFillHeight`), so each column scrolls on its own. The whole card drags (`dragActivator: { mode: 'card' }`), and a press opens the spotlight (`onCardOpen`). A card reads:
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
