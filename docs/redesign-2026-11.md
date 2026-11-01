# Redesign, November 2026

The brief, as given: pages use cards; far fewer tabs, named formally; widgets
and tiles fit what they hold instead of stretching to the window; charts and
icons where they say more than words; one column only where several are not
better; the sidebar simpler; every module and every design-system component
reviewed; nothing left broken. Decisions below were taken without review and
are open to it.

## Principles

1. **Widgets, not stretched boxes.** A dashboard is a `WidgetGrid`: columns of
   one fixed width (19rem, or 13rem for one-figure tiles), as many as the page
   holds, and the rest of the row left empty. A widget spans 1–4 columns by
   what it holds. Nothing grows just because the window is wide.
2. **Cards group.** Every titled group on a page is a card (`Widget`, `Card`,
   or a surfaced `PageSection`). A list or table inside a card is the card's
   body, never a second card.
3. **Few tabs, formal names.** At most three tabs a section, nouns, no first
   person ("I owe", "Mine", "My learning", "Waiting" become "Assigned",
   "Personal", "Enrolled", "Pending"). Anything that is not one of the
   section's views is a page of its own in the header's More menu.
4. **Fewer places.** Configuration (templates, automations, agencies) lives in
   Settings or the More menu, not as sections beside the work.
5. **Figures are tiles of one size; trends are charts.** A number gets a tile;
   a series gets a sparkline or a bar chart, never a sentence.
6. **One component per job.** Screens are built from Reach only; when Reach
   lacks something, Reach gets it.

## Design system (packages/ui)

| Component | Change |
| --- | --- |
| `Widget`, `WidgetGrid` | New. Titled card with icon tile, count, one action, flush body; fixed-width grid. |
| `List` | Flush inside any surface: no card inside a card. |
| `Card` | Marks itself a surface, so lists in it are flush. |
| `PageSection` | A surfaced section marks itself a surface. |
| `DataTable` | The card is as wide as its columns, not the page; column dividers only on hover. |
| `Stat` | Used only as a fixed-size tile (`WidgetGrid size="sm"`). |
| `TertiaryNav` | Formal labels come from the manifests; at most three tabs a section. |

## Navigation, by module

**People**: Directory · Review (Pending · Flagged · Submitted · History) ·
Import and export · Insights (one page, no tabs).

**Time Off**: Overview · Approvals (Pending · Upcoming · History) ·
Calendar (Month · Timeline · Year) · Attendance (Live · Timesheet ·
Exceptions) · Insights.

**Performance**: Overview · Reviews (Assigned · Received · Completed) ·
Cycles (calibration, form templates, automations and unlock requests in its
More menu) · Feedback (Received · Given · Requests; recognition and private
notes in its More menu) · Goals (Personal · Team · Company) · Learning
(Enrolled · Catalogue · Sessions).

**Recruiting**: Overview · Jobs (Open roles · Requisitions) · Candidates
(Candidates · Talent pools) · Interviews · Offers · Analytics. The internal
job board and agencies are in the More menu.

**Onboarding**: Overview · Tasks · Templates · Analytics.

**Documents**: Documents.

## Pages

Every home and overview page becomes a widget dashboard: Home, Time Off's
Overview, Performance's Overview, Recruiting's Overview, Onboarding's
Overview, and each Insights page's figures. Lists of work are flush lists in
widgets; figures are fixed tiles; trends are charts.
