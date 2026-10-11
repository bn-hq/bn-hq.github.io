// One-time importer: creates flashcard entries for a pledge class that's in the roll
// (index.html's seed data) but has no cards yet.
//
// HOW TO RUN
//   1. Open https://bn-hq.github.io in Chrome or Safari on a laptop.
//   2. Open the console:  Chrome  View > Developer > JavaScript Console   (Cmd+Option+J)
//                         Safari  Develop > Show JavaScript Console       (Cmd+Option+C)
//                                 (turn on Safari > Settings > Advanced > Show features for web developers first)
//   3. Paste this whole file, press Enter. That only defines addCards(); nothing is written yet.
//   4. Run   addCards()               -> dry run, prints exactly what it would create
//   5. Run   addCards({write:true})   -> actually creates them
//
// Safe to run twice: anyone who already has a card is skipped, matched on official
// full name ignoring accents, capitals, punctuation and spacing. It never edits or
// deletes an existing card.
//
// Note: this writes straight to the database, bypassing the PCP review queue that
// in-app edits go through. Worth a heads up to the PCP before running it.

async function addCards(opts) {
  const { classes = ['Beta Tau', 'Beta Sigma'], write = false } = opts || {};
  const DB = 'https://pledge-675b2-default-rtdb.firebaseio.com';
  const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const slug = s => norm(s).replace(/ /g, '-');
  // display name: first and last word, like the cards already in the deck ("Max Chen")
  const shortName = full => { const w = full.split(/\s+/); return w.length < 3 ? full : w[0] + ' ' + w[w.length - 1]; };

  // Build the roster straight from the roll in the page, so names can't drift from the roll.
  const wanted = [];
  for (const cls of classes) {
    const r = (SEED.rolls || []).find(x => x.cls === cls);
    if (!r) { console.warn(`No roll found for "${cls}" — skipping.`); continue; }
    wanted.push({ cls, full: r.vppe, role: 'VPPE' });
    r.members.forEach((m, i) => wanted.push({ cls, full: m.replace(/^\*/, ''), role: `#${i + 1}` }));
  }
  if (!wanted.length) return console.error('Nothing to do.');

  const cards = (await (await fetch(DB + '/cards.json', { cache: 'no-store' })).json()) || {};
  const existing = new Map();
  for (const c of Object.values(cards)) {
    for (const n of [norm(c.full), norm(c.name)]) if (n && !existing.has(n)) existing.set(n, c);
  }
  const maxOrder = Object.values(cards).reduce((m, c) => Math.max(m, c.order ?? -1), -1);

  const skip = [], make = [];
  for (const b of wanted) {
    const hit = existing.get(norm(b.full));
    if (hit) skip.push({ ...b, as: `${hit.name} (${hit.cls})` });
    else make.push(b);
  }

  console.log(`Already have cards — skipping ${skip.length}`);
  skip.forEach(b => console.log(`   ${b.cls} ${b.role.padEnd(4)} ${b.full}  ->  already on a card as ${b.as}`));
  console.log(`${write ? 'Creating' : 'Would create'} ${make.length} new card${make.length === 1 ? '' : 's'}`);
  make.forEach(b => console.log(`   ${b.cls} ${b.role.padEnd(4)} ${shortName(b.full)}  <-  ${b.full}`));

  if (!make.length) return console.log('Nothing to create.');
  if (!write) return console.log('\nDry run. Nothing was written. Run  addCards({write:true})  to create these.');

  let n = 0;
  for (const b of make) {
    const photo = slug(b.full);
    const card = { photo, name: shortName(b.full), full: b.full, cls: b.cls, order: maxOrder + 1 + n, extra: {} };
    const res = await fetch(`${DB}/cards/${encodeURIComponent(photo)}.json`, { method: 'PUT', body: JSON.stringify(card) });
    if (!res.ok) { console.error(`FAILED ${b.full}: HTTP ${res.status}`); continue; }
    n++;
  }
  const v = (await (await fetch(DB + '/version.json', { cache: 'no-store' })).json()) || 0;
  await fetch(DB + '/version.json', { method: 'PUT', body: JSON.stringify(v + 1) });
  console.log(`Created ${n} card${n === 1 ? '' : 's'}. Reload the page to see them.`);
}
