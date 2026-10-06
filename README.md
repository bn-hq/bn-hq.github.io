Three files, no build step:

- `index.html` – layout, plus seed JSON (`passages`, `roster` of the 11 pledges, official `rolls` of 4 classes)
- `style.css` – styling
- `app.js` – everything else

Tabs:

- **Today** – Weekly progress (informals per pledge vs target, this week's goals, tasks done this week; visible to everyone), then your plan for the days ahead: catch-up items, a checklist per day, ongoing (undated) tasks folded below, your % done this period (resets after each meeting: "Meeting #n" tasks at 8:30 PM, else Sunday 11:59 PM), streak, whole-class bar, milestones due 10/12, sig tasks you own, Start drill.
- **Study** – Flashcards (cards, all faces, directory; after flipping rate Didn't know / Partly / Knew it; Smart or In order; classes Upsilon → Phi → Chi → Psi → Omega in official roll order) Spell (type a class roll from memory, same order) and Quizzes (question sets; In order / Shuffle / Missed only).
- **Tasks** – Tasks: everyone sees their own board (their tasks + whole-class tasks). The PCP can switch to anyone's board and is the only one who can add (one-line adder: `@4`/`@Tim`/`@me`, `fri`/`10/12`/`in 3 days`, no date = ongoing; on a person's board no `@` means that person, or tap Add to all; paste many lines at once) and Sig tasks (To request / In progress / Signed).
- **Scores** – grades (half tasks completed of everything due before today, half informals Done vs target; A+ 97, A 93, A− 90 … F under 60), milestones (All names = every face solid; Quiz 100% = Spell 100% on all 4 rolls; due 10/12, set in `MILESTONES` in app.js), weekly ranking (meeting to meeting, this week / last week; tasks, 100% Spell attempts, faces turning solid), then the proficiency table.
- **Info** – Guide, Facts, Edit history.

Data (cards, tasks, facts, guide, scores) is in a Firebase database, not in this repo. The site reads and writes it directly; every write goes through `commit()` in app.js and is logged.

- `cards/<photo>` – one per brother: `name`, `full` (official name), `cls`, facts fields, `extra`, and an optional `sig`: `{status: none|requested|confirmed|done|signed, task, difficulty (1-10), requestedAt, confirmedAt, doneAt, signedAt, notes}`. Only `signed` counts as complete. Sig tasks have no owner: the whole class does each one together.
- `tasks/<id>` – `{id, title, due, notes, by, at, done: {name: isoTime}, who?: [names]}`. Missing or empty `who` means the whole class. Missing `due` means ongoing (never overdue, not in weekly %).
- `recitals` – `{who, at, passage, pct}`. `passage` is `roll:<class>` for Spell (older entries are from the removed Recite page).
- `quiz` – `{sets: {setId: {title, order, both?, note?, items: {id: {q, a, alt?: [..], order}}}}}`. The PCP edits it in the app; items with an empty answer are hidden from quizzes. `both` sets are asked both ways. Attempts are `recitals` with passage `quiz:<set>:<item>`.

Grading (Spell and Quizzes): not case-sensitive and extra spaces don't matter; spelling, punctuation, word order and grammar do. Spell also ignores accents and `*`. Curly and straight quotes count as the same.
- `drill/<name>` – per-card Flashcards ratings (1 / 3 / 5, streak, at); solid = Knew it twice in a row. `log`, `facts`, `guide`, `passages`, `version` as before.

Only the PCP (the roster entry whose role is "Pledge Class President") can add or delete tasks. That is a UI rule only: the database is open to anyone with the URL, so it is not real security.

Daily goals are computed live too: informals left to the target ÷ days until the next meeting (shown on each day of Today's plan, on Weekly progress and on the PCP's view of a person's board, with "emails to send" = brothers not yet emailed), and for tasks with a numeric `target` (per-person progress in `prog`), what's left ÷ days until the due date.

Plans, weekly %, streaks and rankings are computed from these timestamps; nothing extra is stored.

A task for several people (or the whole class) stays open until every assignee has checked it on their own board. The PCP can view anyone's board (read-only) and sees who each task is waiting on.

Google Sheets with personal data (brothers' emails, exam schedules) are never published or read by the browser. A nightly 10 PM sync (run from Savi's Claude session with his Drive access) writes only aggregates to Firebase:
- `informals` – `{updatedAt, counts: {pledgeName: {done, confirmed, emailed}}}` from the Informals Tracker (Signups). Target 25 each, Ali 30.
- `recaps` – `{YYYY-MM-DD: {sentAt, checkedAt, replied: {pledgeName: true|false}}}` from the daily noon recap email job; the PCP sees the latest as "Replied?" on Today. No email content is stored.
- `exams` – `{pledgeName: [{date, course, time}]}` from the Class and Exam Schedule. Used for the PCP's "Exams tomorrow" card and "exam that day" flags.

The Signature Tasks Tracker can still override sig status client-side if it is shared for viewing (see `SHEETS` in app.js); otherwise the site keeps its own sig data.

Tasks can have a `time` ("HH:MM"): the adder reads `7am`, `8:30pm`, `noon` or `at 7` before the date (no am/pm: 1–7 and 12 are PM, 8–11 AM). `@all` means the whole class.

To change the site: edit a file on `main`, wait a minute, hard refresh. Bump the `Build` line at the bottom of `index.html` so we know who's on what.

Firebase rules expire Oct 17, 2026. Set them to `{"rules":{".read":true,".write":true}}` in the console before then.
