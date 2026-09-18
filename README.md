# Beta Nu Pledge HQ

Our pledge class site. Live at https://bn-pledge-hq.github.io/

Three files, no build step:

- `index.html` – layout
- `style.css` – styling
- `app.js` – everything else

Data (cards, tasks, facts, guide, scores) is in a Firebase database, not in this repo. The site reads and writes it directly.

To change the site: edit a file on `main`, wait a minute, hard refresh. Bump the `Build` line at the bottom of `index.html` so we know who's on what.

Firebase rules expire Oct 17, 2026. Set them to `{"rules":{".read":true,".write":true}}` in the console before then.
