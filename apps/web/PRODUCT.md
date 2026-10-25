# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Kithena is a headless, module-per-service HRIS sold to companies module by module. This record covers the tenant app (`apps/web`) and its module remotes.

- **Recruiting, primary:** an in-house recruiter or HR generalist at a small or mid-size company, on a laptop, working through many candidates a day: moving them through stages, booking interviews, chasing scorecards, making offers. (Confirmed 2026-10-25.)
- **Recruiting, occasional:** hiring managers and interviewers who drop in to score an interview, read a debrief and decide. Every screen must be clear to someone who opens it once a month.
- Elsewhere in the app: employees, managers and HR administrators using People, Time Off, Documents, Performance and Onboarding.

## Product Purpose

One place for a company's people work, where each module is sellable on its own. Recruiting covers hiring from "we need someone" to a signed contract: requisitions, job ads, a public job site (Kithena Jobs), applications, a pipeline, interviews and scorecards, offers built on each country's employment law, and the contract signed in Kithena. Success for the recruiter is moving a candidate forward without hunting for the next action.

## Positioning

- Offers and contracts are composed on a versioned, country-specific terms pack (DE, ES, GB, IN, US): the screen only offers what is lawful, and the domain computes every limit.
- AI reads, cites and ranks but never rejects; a person decides every rejection, and numbers from a model are suggestions a person confirms.
- Each module boots alone; Recruiting hires with or without People, Documents or Time Off.

## Operating Context

- Desktop-first for recruiters; the phone app (`apps/tenant-mobile`) covers People and Time Off at web parity, Recruiting on the phone has its own RM screens.
- Work arrives through the Inbox (tasks such as "Choose a time", "Submit your scorecard") and company-branded emails whose buttons open the task.
- Interviews are booked on connected calendars (Google, Microsoft) or by link; scorecards are owed at each interview's end.
- A candidate may hold several applications; each application has its own stage, interviews, scorecards, questionnaire answers and offer.
- Companies use 11+ languages; every screen word goes through `t()`.

## Capabilities and Constraints

- Screens are built only from Reach (`@reach/ui`, `packages/ui`): Radix behaviour, CVA variants, Tailwind v4 tokens. A missing need becomes a Reach variant first, never a hand-rolled control. Drag and drop is `@dnd-kit` inside Reach; rich text is Tiptap inside Reach.
- Everything that pops over the page uses Reach's `popover-motion` and the shared hover timings.
- Client navigation, server-rendered first page, no skeletons, no blink; every filter, search, tab and view lives in the query string and is bookmarkable. Pre-launch: no redirects for old URLs.
- Per-row actions live in a RowMenu, selections in a BulkBar; people appear as linked avatars; choices are picked from lists, never typed as ids. Dates and times use Reach pickers.
- Settings pages are flat and single-column.
- **Jobs:** a job with no applications (typically a draft) may be deleted for good; a job with applications can only be archived: closed, hidden from the list by default, its candidates and records kept for retention and audit. (Confirmed 2026-10-25.)
- **Candidate spotlight:** an application opens as a large overlay over the board or list it came from, with its own URL and next/previous candidate one key away; the same view opens as a full page from a direct link or an email. (Confirmed 2026-10-25.)

## Brand Commitments

- Two names, never interchangeable: the product is **Kithena**; the design system is **Reach**, which must never learn that Kithena exists.
- Candidates hear from the company they applied to, in its brand, never from Kithena.
- Voice: plain, precise, British-leaning English sentences; labels say what happens ("Add link and send"), never "Submit".

## Evidence on Hand

- Requirements: `docs/recruiting-prd.md` (screen ids R1–, RM1–, J1–, O1–), tickets in `docs/recruiting-build-plan.md`.
- Screens: the Kithena Recruiting, Jobs and Onboarding pages in the Claude Design project `6fed6ac8…`.
- No customer testimonials, logos or metrics exist; none may be invented.

## Product Principles

1. The next action is always visible: a recruiter never hunts for how to move, book, score or offer.
2. One application, one place: everything about an application is on its page, not behind tabs that hide work.
3. The law and the domain decide limits; the screen offers only what is lawful and says why.
4. People decide; AI suggests with its reasons.
5. Fast and still: no skeletons, no layout shift, motion only to explain change.

## Accessibility & Inclusion

Every Storybook story is gated by axe; screens target WCAG 2.2 AA, with keyboard paths for every drag (dnd-kit's keyboard sensor and live announcements) and the 44px tap floor on coarse pointers.
