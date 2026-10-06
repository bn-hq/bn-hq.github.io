Three files, no build step:

- `index.html` – layout, plus seed JSON (`passages`, `roster` of the 11 pledges, official `rolls` of 4 classes)
- `style.css` – styling
- `app.js` – everything else

Tabs:

- **Today** – your plan for the days ahead: catch-up items, a checklist per day, your % done this week (resets Monday), streak, whole-class bar, sig tasks you own, Start drill.
- **Study** – Faces (cards, all faces, directory), Drill, Spell (type a class roll from memory), Recite.
- **Tasks** – Tasks (one-line adder: `@4`/`@Tim`/`@me`, `fri`/`10/12`/`in 3 days`; paste many lines at once) and Sig tasks (To request / In progress / Signed).
- **Scores** – weekly ranking (this week / last week), then the proficiency table.
- **Info** – Guide, Facts, Edit history.

Data (cards, tasks, facts, guide, scores) is in a Firebase database, not in this repo. The site reads and writes it directly; every write goes through `commit()` in app.js and is logged.

- `cards/<photo>` – one per brother: `name`, `full` (official name), `cls`, facts fields, `extra`, and an optional `sig`: `{status: none|requested|confirmed|done|signed, task, owner, difficulty (1-10), requestedAt, confirmedAt, doneAt, signedAt, notes}`. Only `signed` counts as complete.
- `tasks/<id>` – `{id, title, due, notes, by, at, done: {name: isoTime}, who?: [names]}`. Missing or empty `who` means the whole class.
- `recitals` – `{who, at, passage, pct}`. `passage` is a recital id, or `roll:<class>` for Spell.
- `drill/<name>` – per-card self-ratings. `log`, `facts`, `guide`, `passages`, `version` as before.

Plans, weekly %, streaks and rankings are computed from these timestamps; nothing extra is stored.

To change the site: edit a file on `main`, wait a minute, hard refresh. Bump the `Build` line at the bottom of `index.html` so we know who's on what.

Firebase rules expire Oct 17, 2026. Set them to `{"rules":{".read":true,".write":true}}` in the console before then.
