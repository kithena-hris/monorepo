# Kithena Performance — design inventory (from Claude Design `_build/pf-*.js`, 2026-10-17)

Source files: `_build/pf-core.js`, `pf-w1..w6.js` (web), `pf-mob.js` (mobile) in project
6fed6ac8-1267-4f58-b7be-3b845ed13224. Fetch again with DesignSync get_file if detail is needed.

Sidebar: Performance with sub-items by role. HR(Ada): My reviews, Cycles, Templates, Feedback, Goals,
Learning, Calibration, Automations, Analytics. Manager(Marco): My reviews, Feedback, Goals, Learning, Notes,
Calibration. Employee: My reviews, Feedback, Goals, Learning. Exec: + Calibration, Analytics.

Principles: steps in a centred dialog (Stepper) for setup/feedback/nominations/new goal/assign/automation/
late joiner/export; detail panel beside a review is part of the page (resizable, closable).
Kithena computes every number (score always computed; AI suggests, marked "Suggested · confirm").
Private means absent. Versions pinned. Confidential min 3. One button: schedule or launch.

Cycle states badge tones: draft neutral, scheduling info, scheduled accent, launching info(dot),
launch_failed danger, in_progress success(dot), closing warning, closed neutral, archived neutral outline.
Review badges: Not started, Draft(warning), Submitted(success), Unlock requested(warning), Unlocked(info),
Released(accent), Acknowledged(success), Detached, Overdue(danger).
Question types: Rating(gauge), Written answer(align-left), One of a list(circle-dot),
Several of a list(list-checks), Number(hash), Performance score(trophy).
Activity kinds: self(user) Self review, manager(user-check), peer(users), upward(arrow-up-right),
skip(git-fork) Skip-level, goals(target) Goals review.
Scale 1–5: Below expectations, Partly meets, Meets, Exceeds, Outstanding.

## Web
- PF1 Home HR: head "Performance" + Give feedback / New cycle; 4 stats (Self reviews submitted, Manager reviews,
  Overdue, Feedback this month); "Needs you" task list (unlocks, failed launch Open, approve nominations, write review);
  "Cycles running" live list with progress / Retry launch.
- PF1b Home employee: Request/Give feedback; To do list; Your goals (progress + badge); Recent praise.
- PF13 My reviews tabs To write(n)/About me/Written: table Review, About, Cycle, Kind, Due, State; info alert on confidentiality.
- PF13b About me: per cycle card (state, self review continue, peers nominated, manager review), released cycle (score, read, PDF).
- PF3 Templates: search, chips All/Reviews/Feedback/Quizzes/Archived; table Template, Used for, Version, State, In cycles, Updated, menu
  (Edit draft, Publish, Duplicate, Delete only if never used). Head: Write with AI, New template.
- PF3b Archive instead of delete dialog (lists cycles using it).
- PF2 Builder: 3 cols: Sections outline (sortable, Add section, question types list) | section editor (question rows,
  selected question form: Question, Type, Help text, scale anchors, switches Required/Comment box/Private, Shown in activities)
  | Preview (seg Manager/Self/Subject). Head: Draft v4 badge, saved indicator, History, Preview form, Publish v4.
- PF2b Whole-form preview as subject (removed list; View as reviewer/subject/calibrator).
- PF2c History: versions list + diff (added/changed/removed).
- PF2d Publish dialog: cycles that move (draft/scheduled) vs stay (launched).
- PF2e AI checks panel (double-barrelled, leading, no anchors; rewrite Replace/Keep mine; Translate).
- PF2f Write a template with AI: 3-step dialog Describe/Outline/Check.
- PF6 Cycles: search + state chips + Live; table Cycle(owner), State, Who, Activities icons, Dates, Progress. Copy a cycle / New cycle.
- PF4..PF4f Cycle setup dialog 6 steps: Basics (name, copy from, description, starts, at, time zone, info schedule vs launch,
  goals: not included / context / scored) · Participants (filter chips, table, keep in step, no longer matches, exclusions w/ reason)
  · Activities (6 kinds w/ switch + template select; peer config: who picks, min–max, manager approves, decline&replace, all peers)
  · Deadlines (table Opens/Due/Works out to; holiday warning; reminders chips; Inbox always, Email, Chat)
  · Visibility (per activity names shown & who else; release mode radio; after release switches; response minimum)
  · Check and launch (issues danger/warning/success + summary; button "Schedule for …" or "Launch now", disabled on block).
- PF4h participants by chat as diff (proposal + Apply to the draft).
- PF4g toast Scheduled with Unschedule.
- PF5 Overview: head badge, sub (who, dates, versions), Live, Export PDFs, Remind, menu; tabs Overview/Nominations/Analytics/Changes/Settings;
  tiles per activity; table with checkbox, Person, Manager, Self, Peers, Manager, Release; "Showing 1–50 of N"; bulk bar
  Remind/Extend deadline/Release/Remove from cycle.
- PF5b Extend deadline dialog (activity, new date, warning, reason). PF5c launch failed (steps, Retry, Back to draft).
- PF5d late joiner wizard; PF5e remove (detach) wizard; PF5f manager change handover dialog; PF5g close dialog (mapping table,
  unreleased: release now / keep); PF5h export PDFs wizard (subject view vs full HR, include checkboxes).
- PF9 Nominations tab: chips, Remind N; table Subject, Peers avatars, count badge, State. PF9b picker (team, works with, search; max).
  PF9c approve dialog (approve/decline w/ reason, replace with).
- PF10 Writing: title + saved + Request unlock + Submit; form (progress n of m, sections, questions) | panel tabs Context/Earlier
  reviews (goals, peer reviews, feedback, your notes, self review).
- PF10b AI: Summary tab with citations, prefill marker, suggested rating with reason; sentiment bar.
- PF10c How it reads tab + writing checks. PF10d peer review confidential with alerts; Decline. PF10e self review w/ goals
  section + revision conflict alert (Load revision and re-apply / Show both). PF10f detached dialog Keep/Delete.
- PF12 Submit dialog: required answered; confirm each AI suggestion (Confirm/Change); score computed.
- PF11 Read & release (manager): tabs Manager/Self/Peer(3); per question bars; release card (ask to acknowledge, Release to X).
- PF11b subject reads released review + Acknowledge with comment + PDF.
- PF20 Unlock requests table (HR only): Decline/Unlock. PF20b ask for unlock dialog (reason).
- PF14 Feedback tabs Received/Sent/Requests/Praise; list w/ visibility; side Open requests, You asked.
- PF14b/c give feedback 3 steps To/Write/Who sees it (kind seg Feedback/Praise/Template; tone check); undo 10 min.
- PF14d Sent with undo badge. PF14e request feedback (From, Ask with question/template, About, Note). PF14f praise wall with values.
- PF21 Notes: people list | notes (private/shared) + composer w/ Share with.
- PF18 Goals tabs List/Alignment/Check-ins due; table Goal, Owner, Progress, State, Weight, Aligned to. PF18b goal detail (KRs, check-ins,
  owner/period/weight/commitment/aligned/goal score, Check in). PF18c New goal 4 steps. PF18d alignment tree. PF18e check-in dialog.
  PF18f attach goals to cycle.
- PF15 Learning tabs Assigned to me/Catalogue/Sessions; table + AI suggestions. PF15b course parts + acknowledgement. PF15c assign
  wizard (people/filter/cycle). PF15d session attendance + QR. PF15e quiz. PF15f catalogue + providers + Import CSV.
- PF16 Automations calendar bars (6 months) + overlap warning; Describe one / New automation. PF16b new automation 4 steps.
  PF16c probation grouped by week. PF16d in words via Ask Kithena proposal.
- PF19 Calibration sessions table. PF19b session: 9-box grid + people table (Was/Now/Reason) + against guide bullets; Suggestions/Finalise.
  PF19c change score dialog (reason required). PF19d finalise. PF19e AI suggestions.
- PF7 Analytics tabs Cycle/Raters/Trends/Fairness/Ask; cycle select; stats + completion by dept + score distribution + submitted/day.
  PF7b raters (bullet avg vs company, spread stacked, notes). PF7c trends + person timeline. PF7d fairness (groups ≥5; with/without prefill).
  PF8 ask for a chart (plan chips, chart, insights).
- Settings (Settings › Performance, left nav): S1 General (scale, decimals, parts on), S2 Reviews (defaults, default templates,
  locked rules), S3 Feedback (who can give, who sees, praise values, writing), S4 Goals (periods, scoring, alignment), S5 Learning
  (providers, xAPI, records), S6 Calibration (grid axes, guide distribution), S7 AI (sign-off alert, feature switches, always on, log),
  S7b AI output log, S8 Integrations (connections, evidence sources), S9 Privacy & retention (+ works council per entity),
  S10 Access (roles, who sees which review), S11 Audit log (When, Actor, As, Action, Target, Where, Outcome), S12 My connected tools.
- X1 Inbox items; X2 People person page Performance tab; X3 Documents filing; X4 Slack; X5 Onboarding link; X6 Ask Kithena.

## Mobile (Performance under More)
PFM0 More list; PFM1 home (To do list, 2 minis Goals on track / Praise, Request / Give feedback); PFM2 My reviews pills;
PFM3 write one question per screen (bar, scale options as big radios, comment, saved); PFM3b submit dialog;
PFM4 nominate peers (2-step dialog); PFM5 read & acknowledge; PFM6 feedback list; PFM6b/c give feedback 3 steps; PFM6d undo toast;
PFM7 goals; PFM7b check-in dialog; PFM8 learning course + acknowledgement; PFM8b QR attendance; PFM9 manager approvals;
PFM10 notes; PFM11 desktop only dialog; PFM12 Ask Kithena card; PFS1 notifications; PFS2 connected tools; PFS3 admin settings.

## v2 (2026-10-17, `_build/pf2/*`) — WINS over v1 on any clash
Pages: "Kithena Performance v2" (reviews & cycles), "v2 Development" (feedback..settings), "Mobile v2".
Personas: Ada HR, Marco manager, Adam engineer, Mei probation, Sofia Conti skip-level (head of eng).
Sidebar subs: Ada: My reviews, Cycles, Feedback, Goals, Learning, Calibration, Analytics, Form templates, Automations.
Marco: My reviews, Cycles, Feedback, Goals, Learning, Calibration. Employee: My reviews, Feedback, Goals, Learning. Icon target.
Scale 5 = Exceptional. Review badges: Not started, In progress(warning), Submitted(success), Unlock requested, Unlocked,
Abandoned, Withdrawn, Completed, Cancelled, Released, Acknowledged, Detached, Overdue, Handed over.
Question types addable: Text, Scale, Yes or no, Choice, Performance score; Goals (generated). No Number.
Activities: self, manager, peer, upward, goals, learning (no skip-level).
- PF1/PF1b home for everyone: "You owe" tasks | "Owed to you" (about you this cycle) + "My goals"; HR adds "Cycles you own" live.
- PF13 My reviews tabs: I owe / Owed to me / Nominations / Done; detached banner (Keep/Delete) on I owe.
- PF3 Form templates: chips All / Has a performance score / Usable for feedback / Archived; cols Template(+badges), Status,
  Latest, Cycles per version, Owner, Edited, menu (Edit, Preview, Duplicate, Delete template only if never used else Archive).
- PF2 builder two panes: left sections+questions, selected question expands inline (prompt, type, help, options value/label/
  description, row|list layout, Required/Allow comment/Private, quick preview); "Performance score" section locked last,
  company scale, always required. Right: live preview (Web|Phone, Reviewer|Subject). PF2g empty-section toast with undo.
  PF2h private-on-self warning. PF2c history (preview, restore into new draft, delete draft). PF2d publish (moves/keeps).
  PF2e AI check/rewrite/translate (per-language approval). PF2f write with AI 3 steps (Describe, Draft, Open in builder).
- PF6 cycles: chips + Live; New cycle; row menu Open / Copy to a new cycle / Unarchive.
- PF4 setup FIVE steps: Basics (name, copied from, description, starts, time zone, review period, cycle owners, "Calibration
  follows" switch) · Participants (filter chips: department, employment type, probation, hired before…; AI chat diff; by hand
  include/exclude with who/when/reason; keep in step OFF default) · Activities (6 kinds w/ switch, settings in place: form picker
  with version/questions/score/preview + "Keep using vN"; deadline relative/exact shown as both; peer: selection All peers|
  Nominations, min–max, nominations due, who nominates (subject+manager approves | manager | HR), confidentiality
  (Confidential|Not confidential|Reviewer chooses) & sharing (Shared|Not shared|Reviewer chooses); upward all reports or
  nominate; goals periods + attach auto|manager chooses + rate in manager review; learning items + every subject|manager;
  reminders chips 7d,2d,on deadline,every 3d ×3,on open) · Release (close/after calibration default | on a date | each submitted;
  share score, ask acknowledgement, allow response) · Review (checks incl. set a reviewer, works council, fewer peers,
  holiday, workload, newer version; counts per activity; "Launch cycle" / "Schedule cycle").
- PF5 overview: tabs Overview/Nominations/Analytics/Changes; timeline (bars per activity, today line); tiles Participants,
  Submitted, Overdue, Nominations open, Average score, Unlocks open; table Self, Manager, Peers, Upward, Goals(attach),
  Learning(attach), Score, Calibrated; saved view select; bulk Remind/Extend/Attach goals/Attach training/Change reviewer/
  Remove/Export. Actions Edit, Open calibration, Release, Export, Close. PF5k manager scope. PF5i peek a review (dialog, audited).
  PF5b extend (these people | whole activity). PF5d late joiner (+7 days). PF5e remove (cancel/detach). PF5j Changes tab:
  reviewer left (assign replacement), no longer matches (remove/keep), added by keep in step. PF5f handover note dialog.
  PF5g close (Now|On a date). PF5h release wizard Who/What/File. PF5l export wizard What/View/Where (zip or file to Documents).
  PF5m archive. PF5n change reviewer. PF9 nominations (peers + direct reports). PF9b picker. PF9c approve (kept/removed/added).
  PF9d nominee declines with reason. PF9e nominate direct reports (upward).
- PF10 writing: Evidence panel right: AI summary fixed on top with citations, filter chips All/Feedback/Peer/Manager/Self/
  Upward/Goals/Learning/Tools, group by kind|cycle, sort; evidence items. Submit at bottom with "Missing: …". PF10h no AI.
  PF10b manager: summaries + sentiment per review, chips Positive/Negative. PF10c connected tools evidence (include/dismiss).
  PF10i goals section (rating+comment per goal, changed-since-attached, goal score computed) + training read-only.
  PF10d peer: "Before you submit, choose": Show my name switch, Who sees (Omar and Marco | Only Marco) + sentence.
  PF10e self: offline indicator, conflict "see both". PF10g handed over banner.
- PF12 submit 3 steps: Summary (score + label + description + previous; sentiment; answered/who sees/name/when) · How it will
  read + advisory checks · Confirm AI suggestions (Confirm/Change each, Confirm all; Submit disabled until done).
- PF11 reading about a report: tabs Self/Peer/Manager; per-question bars; sentiment per peer; Release card (when: set by
  cycle; early: HR); AI summary. PF11b released results + acknowledge with response + PDF; peers together; upward not enough.
  PF11c revisions for HR. PF20 unlocks (+ "Unlock a review" without request PF20d, decline with note PF20c).
- PF14 feedback (Received/Sent/Requests/Praise); "Someone at Acme"; sent "Delete for 9:41"; give 3 steps (How: Write|Use a
  template|Praise; tone check) ; who sees: show-my-name switch + Omar and his manager | Only his manager; request (About: Me|A
  report; question|template); PF14g word-filter hold; PF14h HR reveal writer with reason (audited).
- PF21 notes: own work + each report, never shared, "Turn into feedback", saved from Slack.
- PF18 goals tabs Mine/My team/Company(tree); status chips Active/Draft/Completed/Missed/Cancelled; cols Goal, Owner,
  Measured by, Progress, Confidence, Weight. PF18b goal: KRs w/ weights, check-in trend, owner/contributors/period/visibility/
  aligned/weight committed. PF18c new goal 3 steps (Goal, Measure: KRs|Number|Percentage|Amount|Done or not|Milestones +
  overachievement + follow Linear, Align and share). PF18h commit weighted set. PF18g pro-rate for leave. PF18f attach goals.
- PF15 learning tabs My learning/Catalogue/Sessions; statuses Assigned/Acknowledged/In progress/Completed/Expired/Excused;
  kinds Live session/Recording/External course/Document/Quiz/Path. PF15c assign 3 steps (What/Who/Due and repeat: date|after
  hire|after assignment, acknowledge, repeat, expires). PF15d session attendance (required share 75%). PF15g unmatched
  completions. PF15h suggestions for manager. PF15i attach training.
- PF16 automations table (Automation, Rule, Names cycles pattern, Next, State) + overlap warning; new 5 steps Schedule/
  Participants/Activities/Release/Preview; name pattern H{half} {year}; leave out probation/hired<30d/contractors/long leave.
  PF16c probation by week. PF16d in words.
- PF19 calibration (as Sofia); PF19f new session 3 steps Group/Calibrators/Confirm; PF19b axis select, N-box with company
  labels, distribution w/ guide, people cards (score, was, goal score, sentiment, summary). PF19c change, PF19e AI, PF19d finalise.
- PF7 analytics tabs Cycle/Questions/Raters/N-box/Across cycles/Fairness/Ask; dept filter. Fairness needs separate grant.
- Settings left nav: General(scale, peers are, minimum, workload, N-box labels) · Feedback(names: always hidden/always
  shown/writer chooses; receiver sees: never→manager/shown/writer chooses; praise to chat; tone; word list) · Goals(periods
  with weighting+cadence; check-in reminder; leave pro-rate threshold) · Learning(platforms, attendance share) · Release
  defaults · Notifications matrix (Inbox always, Email, Chat per event) · AI (features per company/entity; always on; log) ·
  Connections · Works councils · Retention (after leaving, deletion batches HR confirms, holds, export for a person) · Access
  (roles/scopes) · My connected tools. S13 activity log (When, Who, As whom, AI, What, On what, Parts, Where, Outcome).
- Mobile v2: PFM0 More; PFM1 My reviews with quick chips Feedback/Goals/Learning + pills I owe/Owed to me/Nominations;
  PFM2 read+ack; PFM3 one question per screen + Evidence button → centred dialog PFM3b; PFM3c submit; PFM4 nominate,
  PFM4b approve; PFM5 feedback (+give/who sees/request); PFM6 goals + check-in; PFM7 learning + QR; PFM8 manager team
  progress; PFM9 unlocks (HR) + decide; PFM10 desktop only; PFM11 Ask Kithena; PFS1–3 settings.
