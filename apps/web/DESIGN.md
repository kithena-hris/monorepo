# Design

The tenant app draws only from Reach (`packages/ui`): its tokens, components and motion. This file records how screens compose Reach, not a second system. When a screen needs something Reach lacks, Reach gets a variant first.

## The sidebar

- **A rail** (`shell-sidebar.tsx`, Reach's `PageLayout sidebarRail` with no panel): the company's mark, Search, every area as an icon named by its tooltip, then Settings and you at the foot. It is fixed while the page scrolls, and it never collapses, because there is nothing beside it to put away.
- **An area's sections fly out of its icon** on hover (Reach's 50 ms), on focus, on a tap, or with →: its name, its sections, and at the foot its settings and anything it pins (Time Off's clock). They come out over the page, never beside it, so the page keeps its whole width. An area with one page is named by its tooltip.
- **Never scrolls, never cuts a word**: the rail holds one icon per area, a flyout only one area's sections, and section names wrap (`NavItem wrap`).
- **No keys on rows**: shortcuts live in the rail's tooltips, the search palette and the help sheet.
- **A press is never ignored**: the item is marked on its way at once (`NavItem pending`); every page a flyout leads to is fetched as the pointer or keyboard comes into it; a press whose page has not come after 8 seconds is loaded the ordinary way.

## One scroll

- **The window is the only scroll.** No page holds its content in a box of its own height: a long table grows the page (`DataTable fill` scrolls with the window, its rows virtualized against it and the next page asked for as the page nears its end), and the board's columns are as tall as their cards.
- **The page's header sticks** (`PageHeader`, at a desk): the breadcrumb rides away above it, the description folds as it lands, and the title, its status, the actions and the tabs stay. It spans the content column edge to edge (`--reach-page-gutter`), on the chrome material with a hairline once stuck. Nothing under it moves as it folds.
- **What sticks under it reads `--reach-sticky-top`**: a table's header, a toolbar, the Inbox's list toolbar, the directory's quick look and a list-detail's detail pane, which is the one thing that scrolls on its own, and only when it is taller than the window.
- **A table wider than the page scrolls sideways in its own box**, and its header still pins: it rides down the box under the page's header (`table-pin-head`). The row's box and its pinned column (the name) stay at the start while the rest scrolls past. The browser does the scrolling, never script: a gesture that starts sideways only keeps the page from sliding down under it.
- **A long list says how many it holds and where the reader is in it.** Under every table and virtual list, short or long, one pill (`ScrollPosition`): a map of the list on its side (every row, the rows loaded, a bright segment for the rows on screen that glides with the scroll and back), "Showing 200 of 1,003" running up as pages land, and Back to top once the first row is gone. It floats at the window's foot while the list runs past it and settles under the last row. Picking rows turns that same place into the selection's bar (inverted, as a mode the page is in), still led by the map and "150 of 1,000", then the count picked, the actions and the way out: one thing at the window's foot, the way a phone's toolbar becomes the selection's, so the reader never loses their place to it. Nothing marks scroll progress across the top of the window.
- **Sticky bars are solid.** A page's header and toolbar hide what scrolls under them rather than blurring it; glass is for what floats over the page (the phone's tab bar), not for bars the page passes beneath.
- **The directory's quick look opens on a click**, never by itself: until then the table has the page's width.

## Widgets and cards

- **A dashboard is a `WidgetGrid`**: columns of one fixed width (19rem, or 13rem for one-figure tiles with `size="sm"`), as many as the page holds, and the rest of the row left empty. Nothing grows because the window is wide. A `Widget` spans one to four columns by what it holds (`span`), falling back to fewer where the container is narrower; anything else laid out beside widgets (a `ChartCard`, an assistant card) takes `widgetSpan(n)`.
- **A figure is a `Stat` tile on `WidgetGrid size="sm"`**, all tiles one size, with an icon. A trend is a chart, never a sentence.
- **A widget is a card with a header**: an icon in a tinted tile, the title (wrapped, never cut), a count or state as `meta`, and one way on. A list or a table inside it is its body, flush to its edges (`flush`); a card never holds a second card. `Card`, a surfaced `PageSection` and `Widget` mark themselves `data-surface`, and `List` and `Table` drop their own card inside one.
- **A table's card is as wide as its columns**, not as wide as the page.
- **Every titled group on a page is a card.** One column only where several would not read better; a profile's sections sit two to a row on a wide page.

## Navigation

- **Few places, few tabs, formal names.** At most three tabs a section, named as nouns with no first person (Pending, Upcoming, History; Assigned, Received, Completed), and a section with one view draws no tab row. Anything that is not one of a section's views is a page of its own in the header's More menu (manifest actions with `menu: true`). The places of every module are listed in `docs/redesign-2026-11.md`.
- **A page is one page, not a set of tabs.** Insights, Recruiting's Analytics and People's Organisation settings draw every part on one page; an address that names a part scrolls to it. Integrations is a directory whose cards open each integration as a page of its own, with one way back.

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
- **Board** (`pipeline.tsx`): the `Kanban` is as tall as its longest column and the window scrolls it; no column scrolls on its own. A sideways swipe anywhere on the board scrolls the board, the scrollbar sits under the columns rather than on their edge, and columns snap only under a finger. The whole card drags (`dragActivator: { mode: 'card' }`), and a press opens the spotlight (`onCardOpen`). A card reads:
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
- **The item opens beside the list** (`ListDetail`, list 30rem), riding beside it as the page scrolls, and is done there: each module's kind has its own body, and Open in … is the fallback, never the first action.
- **Push** (Settings › Notifications): one card, "Push notifications on this device", above the rows; the rows' Phone switches route to every device a person turned push on for.

## Time Off

- **Five places, by who uses them.** Overview (everyone), Approvals (managers and HR), Calendar (everyone), Attendance (everyone), Insights (managers and HR). An employee sees three.
- **At most three tabs, in fixed places.** Approvals: Pending, Upcoming, History. Calendar: Month, Timeline, Year. Attendance: Live (managers, HR), Timesheet, Exceptions (HR). A section with one tab draws no tab row. `routes.test.tsx` holds the limit.
- **One header per section.** Every tab of a section shows the section's title and its one line from `routes.json` (`Header` in `frame.tsx`), so switching tabs never moves the tabs. What a view adds ("Week of 28 Sept · 40h scheduled", an export) sits in a row under the tabs, never in the header.
- **What is not the page's one thing goes under More.** Delegate approvals, Adjust a balance, Parental leave cases; Overtime and corrections, Kiosk code, Close the pay period: manifest actions with `menu: true`, drawn as the header's More menu. Each opens a page of its own, which carries its own title.
- **Your requests is one list**, `/time-off/requests`, with Upcoming, Past and Cancelled as a switch over it (`?show=`), reached from Overview's Coming up.
- **Overview leads with the balances**, tiles of one size in a row that scrolls rather than stretches. Under them, a widget grid: the clock, the days worth taking, Coming up and Team today.
- **Insights is one page**, read top to bottom: what changed, then time off, attendance and balances, each section named for what it measures.
- **One way through time** (`PeriodNav` in `period.tsx`): "Today ‹ › October 2026" at the start of the page's one toolbar row, on the calendar, Timesheet, Exceptions and Pay period alike. What filters the view (whose time off, which holidays, week or month) and what leaves it (a feed, an export) share that row, at its end.
- **A count is a filter.** Today's In, On a break, Not in yet and Away are one switch with their counts that narrows the list (`?show=`), not four tiles beside it.
- **The decision where the eye lands.** On a request waiting for you, Approve, Suggest other dates and Decline sit under the person at a desk and at the foot of a phone, and What to know comes before the team it summarises.
- **The request panel** puts the types beside the dates at a desk; under a finger it is a step at a time.
- **Settings are one column**: the form in a padded card (`FormSections`), anything beside it stacked under it, one field per row.

## People › Review

- **All sums up, the chip lists.** Under All, missing details are one card (`MissingSummary`): how many HR fills in, how many wait on employees, how complete the records are, and Open missing details. The list lives under its own chip, never stacked under the decisions.
- **One figure, not four**: a `Progress` with "79% complete", and a warning `Badge` for what blocks payroll. No stat grid, no sparkline.
- **Two lanes, by who fills the gap in** (`SegmentedControl` with counts): For you to fill in (the default) and Waiting on employees (the default only when HR has nothing). Each lane has its one bulk action at the line's end: Fill in for all (the grid) or Remind N waiting.
- **A column to read, not a table to cross** (`VirtualList`, `max-w-3xl`): a row is the face, the name, "Missing: a, b, c +N", team · manager, and its one action beside it. Nothing scrolls sideways.
- **Find, narrow, group** (`Toolbar`): search by name, a team and a missing-field `Select` built from what the lane holds, and Group by team, manager or missing field. By missing field a person is under each field they lack, the largest group first. Every part is in the address (`lane`, `q`, `team`, `field`, `group`).

## Colour and motion

- Restrained: neutrals from the canvas and surfaces. The accent is reserved for the primary action, the current stage and progress.
- Stage dots follow `CATEGORY_TONE`. Success marks only an ideal match or a live target.
- Motion is Reach's own: the `ModalPage` slide-in, the `Kanban` lift and settle, and popovers on `popover-motion`. No screen adds keyframes.
- Every overlay (dialog, alert, sheet, modal page, palette) blurs what is behind it by one Reach token, `--reach-overlay-blur`, so the modal is the only thing to read.
- A card's description sits under its title, never beside it (Reach's `CardHeader`); an action stays on the title's line.
- Choices that a contract carries are picked, never typed: the region from the country pack's list, the collective agreement and group from the company's list in Settings, Pay bands.
