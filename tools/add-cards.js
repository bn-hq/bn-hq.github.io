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
// Safe to run twice: anyone who already has a card for that class is skipped, matched
// on official full name ignoring accents, capitals, punctuation and spacing. It never
// edits or deletes an existing card.
//
// A brother who serves as VPPE of a younger class is filed under that class, not their
// own pledge class. They get a second card so they're studied in both decks and count
// twice, and the headshot is copied across. The two cards are independent after that:
// editing one, or adding a photo to one, won't update the other.
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
  // every card a person already has, grouped by name — a brother can hold more than one
  // (his own pledge class, plus any younger class he serves as VPPE)
  const existing = new Map();
  for (const c of Object.values(cards)) {
    for (const n of new Set([norm(c.full), norm(c.name)])) {
      if (!n) continue;
      if (!existing.has(n)) existing.set(n, []);
      existing.get(n).push(c);
    }
  }
  const maxOrder = Object.values(cards).reduce((m, c) => Math.max(m, c.order ?? -1), -1);

  const skip = [], make = [];
  for (const b of wanted) {
    const held = existing.get(norm(b.full)) || [];
    // already has a card for THIS class? nothing to do. Has one for another class
    // (he's a VPPE of a younger class)? he needs a second card so he's studied in both.
    if (held.some(c => norm(c.cls) === norm(b.cls))) { skip.push({ ...b, as: `${b.cls}` }); continue; }
    make.push({ ...b, copyFrom: held[0] || null });
  }

  console.log(`Already have a ${classes.join('/')} card — skipping ${skip.length}`);
  skip.forEach(b => console.log(`   ${b.cls} ${b.role.padEnd(4)} ${b.full}`));
  console.log(`${write ? 'Creating' : 'Would create'} ${make.length} card${make.length === 1 ? '' : 's'}`);
  make.forEach(b => console.log(`   ${b.cls} ${b.role.padEnd(4)} ${shortName(b.full).padEnd(22)}`
    + (b.copyFrom ? `2nd card — also on a ${b.copyFrom.cls} card, headshot copied across` : '')));

  if (!make.length) return console.log('Nothing to create.');
  if (!write) return console.log('\nDry run. Nothing was written. Run  addCards({write:true})  to create these.');

  let n = 0, pics = 0;
  for (const b of make) {
    // a card's id doubles as its headshot key, so a second card needs its own id
    const photo = b.copyFrom ? `${slug(b.full)}-${slug(b.cls)}` : slug(b.full);
    const card = { photo, name: shortName(b.full), full: b.full, cls: b.cls, order: maxOrder + 1 + n, extra: {} };
    const res = await fetch(`${DB}/cards/${encodeURIComponent(photo)}.json`, { method: 'PUT', body: JSON.stringify(card) });
    if (!res.ok) { console.error(`FAILED ${b.full}: HTTP ${res.status}`); continue; }
    n++;
    // carry the headshot over to the new id, so the second card isn't a blank initials tile
    if (b.copyFrom && b.copyFrom.photo) {
      const src = await (await fetch(`${DB}/photos/${encodeURIComponent(b.copyFrom.photo)}.json`, { cache: 'no-store' })).json();
      if (src) { await fetch(`${DB}/photos/${encodeURIComponent(photo)}.json`, { method: 'PUT', body: JSON.stringify(src) }); pics++; }
      else console.warn(`   no headshot stored for ${b.full} — the ${b.cls} card will show initials too`);
    }
  }
  const v = (await (await fetch(DB + '/version.json', { cache: 'no-store' })).json()) || 0;
  await fetch(DB + '/version.json', { method: 'PUT', body: JSON.stringify(v + 1) });
  if (pics) { // force everyone's cached photo blob to refresh
    const pv = (await (await fetch(DB + '/photosVersion.json', { cache: 'no-store' })).json()) || 1;
    await fetch(DB + '/photosVersion.json', { method: 'PUT', body: JSON.stringify(pv + 1) });
  }
  console.log(`Created ${n} card${n === 1 ? '' : 's'}${pics ? `, copied ${pics} headshot${pics === 1 ? '' : 's'}` : ''}. Reload the page to see them.`);
}
