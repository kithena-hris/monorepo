# Kithena Inbox Mobile — screens (from `_build/ib-mob.js`)

Segmented control: `To do N` · `Updates N` · `Requests` · `Done` (full width, small). Inbox is the 4th tab; tab badge = task count only.
Rows: 40px lead (avatar for updates from a person, else tinted icon tile), title (bold for tasks/requests/unread), summary, meta row (module › area tag, due badge, status badge with dot, outcome badge), age or count on the right; unread = 8px accent dot at left.
Group headers: To do "Due this week"/"Later" (also "Overdue", "This week", "Today", "Queues"); Updates "Today"/"Yesterday"/"Earlier"; Done by month.
Detail page: back "Inbox" (or "Requests"), right: open-in (arrow-up-right) + ellipsis; kind tag + module tag; 26px title; avatar + "who" line + due badge + status; sender's message as a quote bubble; body; pinned foot buttons above the tab bar (full-width, flex:1).

- A1 Inbox tab: To do lane, counts [4,3].
- A2 Phone notifications: tasks one by one with actions (Open / Remind me tomorrow); updates grouped ("3 updates · Marco approved your time off, and 2 more"). Quiet hours hold both except tasks due today.
- B1 Task done in place: emergency contact form (Full name, Relationship select, Phone; lock note "Only you and HR see this. It goes on your record straight away.") foot "Add to my record".
- B2 Correct a refused value: National ID field with live validation ("The check letter matches."), hint "You sent 12345678A on 29 Sep", foot "Send to HR".
- B3 Sign a document: file card (eye to open full screen), "What changes" card with AI note "Summary by Kithena. The document is what you sign.", foot "Ask Ada" + "Sign" (Sign enabled after every page shown).
- B4 Signing: centred dialog "Sign the addendum" / "Your signature goes on page 3."; Type|Draw; name field; signature preview; checkbox "I agree this is my signature"; Cancel / Sign.
- B5 Task menu anchored to …: Ask Ada a question · Remind me later › · I can't do this · — · Open in People · Copy link.
- B6 Ask a question: thread (quotes and own bubbles); pinned bar becomes reply box ("Reply to Ada…" + send).
- B7 Done: back to list, toast above tab bar "Emergency contact added · Ada gets an update · Undo"; count drops.
- C1 Updates: blue dots, no numbers; long-press a row: Mark read, Mute, Move to Done.
- C2 Time off approved: date card "22–23 Oct / Thu and Fri · 2 working days", kv (Left this year, Marco's note); foot "Open in Time off" (secondary). Opening reads it.
- C3 Document shared: file card, hint "Also kept in your profile under Documents."; foot Preview / Download.
- C4 Declined with shortcut: quote, date card "24 Dec · Declined"; foot "Request other dates" (opens Time off prefilled; once used, links to the new request).
- C5 Swipe to tidy: updates only; actions Mute (fill) and Read (accent), 84px each.
- D1 My requests: rows with status "With Ada"; hint "Decided requests move to Done, and you get an update."
- D2 Request detail: before/after (On your record / You asked for), stepper (Sent · HR decides · On your record); foot Withdraw / Nudge Ada.
- E1 Done: search field; groups by month; outcome badge on each row; read-only receipts.
- F1 Manager To do: right "Hand over"; groups This week / Later: time off approvals, bundled Review row, onboarding task.
- F2 Approve time off: title "Adam wants 28–30 Dec off"; date card; "Engineering that week" 3-day strip with avatars; kv (Left after this, Asked first for); foot Decline / Approve.
- F3 Hand over dialog: From/Until; Hand to (person picker); checks Time off approvals, People › Review items; Cancel / Hand over.
- G1 HR inbox: team task row with Take it / Open buttons under it; groups Today / This week / Queues (bundled Review).
- S1 Before your first day: progress "Your checklist 3 of 7"; steps with Add / Upload / Fill in / Read buttons.
- I1 Notification settings (Me › Settings › Notifications): Tasks (In the Inbox: Always on (lock); Phone: switch; Email: Right away ›); Updates (per kind rows ›); Quiet hours (Hold phone notifications 19:00–8:00 and weekends).
- Z1 Nothing to do: empty "Nothing needs you" / "New tasks appear here and on the tab. You have 3 unread updates." + See updates; tab shows no number.
- Z2 Ask Kithena: compact card above the tab bar; chips open tasks; never finishes one.
