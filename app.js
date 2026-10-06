// ---------- state (Firebase Realtime Database via REST) ----------
const DB='https://pledge-675b2-default-rtdb.firebaseio.com';
const SEED = JSON.parse(document.getElementById('seed').textContent);
let S = {version:0,cards:[],log:[],facts:[],tasks:[],recitals:[],passages:SEED.passages,drill:{},guide:[]};
let loaded=false;
const key = s => String(s).replace(/[.#$\[\]\/]/g,'_');
const objToArr = (o,sortKey) => { const a=Object.entries(o||{}).map(([k,v])=>Object.assign({_k:k},v)); if(sortKey) a.sort((x,y)=>(x[sortKey]??0)-(y[sortKey]??0)); return a; };
function fromDb(d){
  d=d||{};
  const cards=objToArr(d.cards,'order'); cards.forEach(c=>{ c.extra=c.extra||{}; });
  const byAtDesc=(a,b)=>(a.at<b.at?1:-1);
  return { version:d.version||0, cards, log:objToArr(d.log).sort(byAtDesc), facts:objToArr(d.facts,'order'), tasks:objToArr(d.tasks).sort((a,b)=>(a.due||'9999')<(b.due||'9999')?-1:1), recitals:objToArr(d.recitals).sort(byAtDesc), guide:objToArr(d.guide,'order'), passages: d.passages? objToArr(d.passages,'order') : SEED.passages, drill:d.drill||{}, informals:d.informals||null, exams:d.exams||{}, quiz:d.quiz||null, recaps:d.recaps||{}, pending:objToArr(d.pending).sort((a,b)=>(a.at<b.at?-1:1)), commitments:objToArr(d.commitments), suggestions:objToArr(d.suggestions).sort(byAtDesc) };
}
async function dbGet(path){ const r=await fetch(DB+'/'+path+'.json',{cache:'no-store'}); if(!r.ok) throw new Error('read '+r.status); return r.json(); }
async function dbWrite(method,path,body){ const r=await fetch(DB+'/'+path+'.json',{method,body:body===undefined?undefined:JSON.stringify(body)}); if(!r.ok) throw new Error('write '+r.status); return r.json(); }
const KEYS=['version','cards','log','facts','tasks','recitals','passages','drill','guide','informals','exams','quiz','recaps','pending','commitments','suggestions'];
async function loadPhotos(){
  if(Object.keys(URIS).length) return;
  try{ const c=localStorage.getItem('bn-photos'); if(c){ URIS=JSON.parse(c); if(Object.keys(URIS).length) { checkPhotoVersion(); return; } } }catch(e){}
  try{ URIS=await dbGet('photos')||{}; try{ localStorage.setItem('bn-photos',JSON.stringify(URIS)); localStorage.setItem('bn-photos-v',String(await dbGet('photosVersion')||1)); }catch(e){} }catch(e){}
}
async function checkPhotoVersion(){ try{ const v=String(await dbGet('photosVersion')||1); if(localStorage.getItem('bn-photos-v')!==v){ URIS=await dbGet('photos')||{}; localStorage.setItem('bn-photos',JSON.stringify(URIS)); localStorage.setItem('bn-photos-v',v); render(); } }catch(e){} }
async function refresh(){ try{ const vals=await Promise.all(KEYS.map(k=>dbGet(k))); const d={}; KEYS.forEach((k,i)=>d[k]=vals[i]); if(d && d.cards){ S=fromDb(d); } loaded=true; setStatus(''); }catch(e){ setStatus('Offline: could not reach the database ('+e.message+'). Showing last loaded data.'); loaded=true; } }

function setStatus(t){ const el=document.getElementById('sync'); if(el){ el.textContent=t; el.hidden=!t; } }
const FIELDS = [['full','Full name (official)'],['cls','Pledge class'],['home','Hometown'],['major','Year / major'],['hs','High school'],['summer','Summer 2026'],['past','Past internships'],['clubs','Clubs'],['notes','Fun facts / openers'],['pets','Pets'],['siblings','Siblings'],['parents','Parents'],['grandparents','Grandparents'],['lineage','DSP lineage (big / little)']];
let URIS = {};
const initials = s => { const c=S.cards.find(x=>x.photo===s); const n=(c&&c.name)||s||'?'; return n.split(/[\s-]+/).filter(Boolean).slice(0,2).map(w=>w[0].toUpperCase()).join(''); };
const IMG = s => URIS[s] || 'data:image/svg+xml,'+encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#F1DFA8"/><text x="50" y="63" font-size="36" font-weight="700" text-anchor="middle" font-family="sans-serif" fill="#4B2A7B">${esc(initials(s))}</text></svg>`);
const esc = s => String(s??'').replace(/[&<>"]/g, m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));
const uid = () => Math.random().toString(36).slice(2,9);

let stars = {}; try { stars = JSON.parse(localStorage.getItem('bn-stars')||'{}'); } catch(e){}
const saveStars = () => { try { localStorage.setItem('bn-stars', JSON.stringify(stars)); } catch(e){} };
let me = ''; try { me = localStorage.getItem('bn-user')||''; } catch(e){}

let filter='all', mode='today', view='cards', qkind='fn', order=[], idx=0, flipped=false, editing=false;
let score={ok:0,n:0}, qi=0, answered=false;

// ---------- capability ----------
let readOnly = false;

function toast(t){ const d=document.createElement('div'); d.className='toast'; d.textContent=t; document.body.appendChild(d); setTimeout(()=>d.remove(),3000); }

// Every write goes through commit(). It builds field-level ops; "info" ops (brother cards, facts, passages, the quiz bank,
// task edits other than check-offs) from anyone but the PCP go to `pending` for review instead of applying.
const fieldPatch = (b, a) => { const o={}; for(const k of new Set([...Object.keys(b||{}),...Object.keys(a||{})])){ if(k==='_k') continue; if(JSON.stringify((b||{})[k])!==JSON.stringify((a||{})[k])) o[k]=(a||{})[k]===undefined?null:a[k]; } return o; };
function buildOps(next){
  const ops=[], add=(m,path,body,info)=>ops.push({m,path,body,info});
  // cards: PATCH the fields that changed (new card: PUT)
  const before=Object.fromEntries(S.cards.map(c=>[c.photo,c]));
  next.cards.forEach((c,i)=>{ const b=before[c.photo], cc=Object.assign({},c); delete cc._k;
    if(!b){ cc.order=i; add('PUT','cards/'+key(c.photo),cc,true); return; }
    const pt=fieldPatch(Object.assign({},b,{order:undefined}),Object.assign({},cc,{order:undefined})); if(Object.keys(pt).length) add('PATCH','cards/'+key(c.photo),pt,true); });
  // tasks: check-offs are per-person writes (not reviewed); any other change is an info edit
  const tb=Object.fromEntries(S.tasks.map(t=>[t.id,t])), tn=Object.fromEntries(next.tasks.map(t=>[t.id,t]));
  for(const id of Object.keys(tn)){ const t=Object.assign({},tn[id]); delete t._k; const o=tb[id];
    if(!o){ add('PUT','tasks/'+key(id),t,true); continue; }
    const pt=fieldPatch(o,t), dn=pt.done!==undefined; delete pt.done;
    if(dn){ const bd=o.done||{}, ad=t.done||{}; for(const n of new Set([...Object.keys(bd),...Object.keys(ad)])) if(bd[n]!==ad[n]) add(ad[n]===undefined?'DELETE':'PUT','tasks/'+key(id)+'/done/'+key(n),ad[n],false); }
    if(Object.keys(pt).length) add('PATCH','tasks/'+key(id),pt,true); }
  for(const id of Object.keys(tb)) if(!tn[id]) add('DELETE','tasks/'+key(id),undefined,true);
  // facts / passages / quiz bank: small, rewrite whole
  if(JSON.stringify(S.facts)!==JSON.stringify(next.facts)){ const o={}; next.facts.forEach((f,i)=>{ o[f._k||('f'+Date.now().toString(36)+i)]={q:f.q,a:f.a,order:i}; }); add('PUT','facts',o,true); }
  if(JSON.stringify(S.passages)!==JSON.stringify(next.passages)){ const o={}; next.passages.forEach((p,i)=>{ o[p.id]={id:p.id,title:p.title,text:p.text,order:i}; }); add('PUT','passages',o,true); }
  if(JSON.stringify(S.quiz||null)!==JSON.stringify(next.quiz||null)) add('PUT','quiz',next.quiz,true);
  // personal: my drill ratings and new quiz/spell attempts
  if(JSON.stringify(S.drill[me]||{})!==JSON.stringify(next.drill[me]||{})) add('PUT','drill/'+key(me),next.drill[me]||{},false);
  for(const r of next.recitals) if(!r._k) add('POST','recitals',r,false);
  return ops;
}
const reviewer = () => { const p=PCP(); return p?('#'+PNUM(p)+' '+first(p)):'the PCP'; };
async function commit(entry, mutate){
  if(!me){ askName(); return false; }
  const next = JSON.parse(JSON.stringify(S));
  mutate(next);
  try{
    const ops=buildOps(next), info=ops.filter(o=>o.info), review=info.length&&!isPCP(), run=review?ops.filter(o=>!o.info):ops;
    if(!ops.length&&!entry) return true;
    const w=run.map(o=>dbWrite(o.m,o.path,o.body));
    if(review) w.push(dbWrite('POST','pending',{who:me,at:when(),entry:entry||{card:'Edit',changes:[]},ops:info.map(({m,path,body})=>body===undefined?{m,path}:{m,path,body})}));
    else if(entry) w.push(dbWrite('POST','log',entry));  // reviewed edits are logged when approved
    if(run.length) w.push(dbWrite('PUT','version',(S.version||0)+1));
    await Promise.all(w);
    await refresh();
    toast(review?`Sent to ${reviewer()} for review`:'Saved for everyone'); return true;
  }catch(e){ toast('Save failed: '+(e.message||e)+'. Check your connection and try again.'); await refresh(); return false; }
}
async function decidePending(p, approve){
  // PCP only: apply (or drop) a pending info edit; both are logged
  if(!isPCP()) return false;
  try{
    if(approve) await Promise.all((p.ops||[]).map(o=>dbWrite(o.m,o.path,o.body)));
    const e=p.entry||{}; await Promise.all([dbWrite('POST','log',Object.assign({},e,{who:p.who,at:approve?when():p.at,card:(approve?'':'Rejected · ')+(e.card||'Edit'),changes:e.changes||[],reviewedBy:me})), dbWrite('DELETE','pending/'+key(p._k)), dbWrite('PUT','version',(S.version||0)+1)]);
    await refresh(); toast(approve?'Approved and applied':'Rejected'); return true;
  }catch(err){ toast('Failed: '+(err.message||err)); await refresh(); return false; }
}

// ---------- username ----------
function renderWho(){
  const w=document.getElementById('who');
  w.innerHTML = me ? `Signed in as <b>${esc(me)}</b> · <button id="chname">change</button>` : `<button id="chname">Pick your name to start</button>`;
  document.getElementById('chname').onclick=askName;
}
function askName(){
  const names=PC();
  const m=document.createElement('div'); m.className='modal';
  m.innerHTML=`<div><h2>Which pledge are you?</h2><p>Your name goes on every edit, task check-off, and spell score.</p><select id="nm" style="width:100%;border:1px solid var(--line);background:var(--bg);color:var(--ink);border-radius:10px;padding:10px;font:15px 'Public Sans',sans-serif"><option value="">Pick your name</option>${names.map(n=>`<option value="${esc(n)}" ${n===me?'selected':''}>${esc(n)}</option>`).join('')}</select><div class="ctrl"><button class="btn primary" id="ok">Continue</button></div></div>`;
  document.body.appendChild(m);
  const sel=m.querySelector('#nm'); sel.focus();
  const done=()=>{ const v=sel.value; if(!v){ sel.focus(); return; } me=v; try{localStorage.setItem('bn-user',me);}catch(e){} m.remove(); renderWho(); render(); };
  m.querySelector('#ok').onclick=done; sel.addEventListener('change',()=>{ if(sel.value) done(); });
}

// ---------- helpers ----------
const CLASS_ORDER=['Beta Upsilon','Beta Phi','Beta Chi','Beta Psi','Beta Omega'];
const clsRank = cls => { const i=CLASS_ORDER.findIndex(k=>String(cls||'').startsWith(k)); return i<0?99:i; };
function rollIndex(c){
  const r=(SEED.rolls||[]).find(x=>String(c.cls||'').startsWith(x.cls)); if(!r) return 999;
  const f=String(c.full||'').trim(); if(f&&f===r.vppe) return 0; const i=r.members.findIndex(m=>m.replace(/^\*/,'')===f); return i<0?998:i+1;
}
const byRoll = (a,b) => clsRank(a.cls)-clsRank(b.cls) || rollIndex(a)-rollIndex(b) || a.name.localeCompare(b.name);
function pool(){
  const p = filter==='starred' ? S.cards.filter(c=>stars[c.photo]) : filter==='all' ? S.cards.slice() : S.cards.filter(c=>c.cls===filter);
  return p.sort(byRoll);
}
function shuffle(a){ for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];} return a; }
function resetOrder(){ order = fcSmart&&me ? smartOrder(pool()) : pool(); idx = 0; flipped=false; editing=false; document.getElementById('editor').hidden=true; }
const when = () => new Date().toISOString();
const fmt = iso => { const d=new Date(iso); return d.toLocaleDateString(undefined,{month:'short',day:'numeric'})+' '+d.toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'}); };
const PC = () => (SEED.roster||[]).map(r=>r.name);
const PNUM = n => { const r=(SEED.roster||[]).find(x=>x.name===n); return r?r.n:''; };
const isoDay = ts => { const d=new Date(ts); return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10); };
const today = () => isoDay(Date.now());
const addDays = (iso,k) => { const d=new Date(iso+'T12:00:00'); d.setDate(d.getDate()+k); return d.toISOString().slice(0,10); };
const dayLabel = iso => { const t=today(); if(iso===t) return 'Today'; if(iso===addDays(t,1)) return 'Tomorrow'; return new Date(iso+'T12:00:00').toLocaleDateString(undefined,{weekday:'long',month:'short',day:'numeric'}); };
const isFor = (t,n) => !t.who || !t.who.length || t.who.includes(n);
const dayOf = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? String(v) : isoDay(v);
const quizOn = (n,d) => S.recitals.some(r=>r.who===n&&/^(roll|quiz):/.test(String(r.passage||''))&&r.at&&isoDay(r.at)===d);
const autoDone = (t,n,d) => t.auto==='quiz' && quizOn(n,d);
// repeat:'daily' tasks reset every day: done[name] holds the date it was done; auto:'quiz' ones tick themselves when you do a Quizzes or Spell attempt that day
const doneOn = (t,n,d) => { const x=(t.done||{})[n]; return autoDone(t,n,d) || (!!x && dayOf(x)===d); };
const isDone = (t,n) => t.repeat==='daily' ? doneOn(t,n,today()) : !!(t.done||{})[n];

// ---------- chips / tabs ----------
const chipsEl = document.getElementById('chips');
function renderChips(){
  const cls=[...new Set(S.cards.map(c=>c.cls))].sort((a,b)=>clsRank(a)-clsRank(b)||a.localeCompare(b));
  const items=[['all','All'],...cls.map(k=>[k,k.replace(/^Beta /,'').replace(/ \(.*\)$/,'')]),['starred','★']];
  chipsEl.innerHTML = items.map(([k,l])=>`<button class="chip" data-f="${esc(k)}" aria-pressed="${filter===k}" title="${esc(k==='starred'?'Starred':k)}">${esc(l)}</button>`).join('');
}
chipsEl.addEventListener('click', e=>{ const b=e.target.closest('.chip'); if(!b) return; filter=b.dataset.f; renderChips(); saveDrill(); resetOrder(); render(); });
const STUDY=['learn','quizzes','roll'], INFO=['guide','ideas','log'], TASKS=['tasks','sigs','dash'];
let lastStudy='learn', lastInfo='guide', lastTasks='tasks'; try{ const v=JSON.parse(localStorage.getItem('bn-sub')||'{}'); if(STUDY.includes(v.s)) lastStudy=v.s; if(INFO.includes(v.i)) lastInfo=v.i; if(TASKS.includes(v.t)) lastTasks=v.t; }catch(e){}
const tabOf = m => STUDY.includes(m)?'study':INFO.includes(m)?'info':TASKS.includes(m)?'tasks':m;
function setMode(m){
  if(mode==='learn'&&m!=='learn') saveDrill(); resetOrder(); mode=m;
  if(STUDY.includes(m)) lastStudy=m; if(INFO.includes(m)) lastInfo=m; if(TASKS.includes(m)) lastTasks=m; try{ localStorage.setItem('bn-sub',JSON.stringify({s:lastStudy,i:lastInfo,t:lastTasks})); }catch(e){}
  render(); window.scrollTo({top:0});
  refresh().then(()=>{ order=order.map(c=>S.cards.find(x=>x.photo===c.photo)||c); if(mode!=='learn') render(); });
}
document.querySelector('.tabs').addEventListener('click', e=>{
  const b=e.target.closest('[role=tab]'); if(!b) return; const t=b.dataset.tab;
  setMode(t==='study'?lastStudy:t==='info'?lastInfo:t==='tasks'?lastTasks:t);
});
for(const id of ['studysub','infosub','tasksub']) document.getElementById(id).addEventListener('click', e=>{ const b=e.target.closest('[data-m]'); if(b) setMode(b.dataset.m); });
document.getElementById('dirq').addEventListener('input',renderDir);
// ---------- learn ----------
const cardEl=document.getElementById('card');
function renderCard(){
  const c=order[idx];
  if(!c){ cardEl.innerHTML='<div style="padding:40px;text-align:center;color:var(--ink2)">Nothing here. Star some brothers first.</div>'; document.getElementById('editor').hidden=true; return; }
  if(!flipped){
    cardEl.innerHTML=`<div class="front"><img src="${IMG(c.photo)}" alt="brother photo"><div class="hint">Tap to reveal · ${idx+1} / ${order.length}</div></div>`;
  } else {
    const rows=FIELDS.filter(([k])=>k!=='full').map(([k,l])=>[l,c[k]]);
    for(const [k,v] of Object.entries(c.extra||{})) rows.push([k,v]);
    rows.push(['LinkedIn', c.li?`<a href="https://www.linkedin.com/in/${esc(c.li)}/" target="_blank" rel="noopener">linkedin.com/in/${esc(c.li)}</a>`:'', true]);
    cardEl.innerHTML=`<div class="back"><img src="${IMG(c.photo)}" alt=""><div><h2>${esc(c.name)}</h2>${c.full?`<div class="fullname"><small>Full name (official)</small>${esc(c.full)}</div>`:''}${c.alias?`<div class="alias">${esc(c.alias)}</div>`:''}<span class="tag">${esc(c.cls)}</span></div><div class="facts">${rows.map(([k,v,raw])=>`<div><b>${esc(k)}</b><span>${v?(raw?v:esc(v)):'<span class="empty">not filled in yet</span>'}</span></div>`).join('')}</div>${sigHtml(c)}</div>`;
    bindSig(cardEl, ()=>{ order=order.map(x=>S.cards.find(y=>y.photo===x.photo)||x); renderCard(); });
  }
  const rt=document.getElementById('rate3'); rt.hidden=!flipped;
  if(flipped) rt.innerHTML=[[1,"Didn't know"],[3,'Partly'],[5,'Knew it']].map(([r,l],i)=>`<button class="btn r${r}" data-rate="${r}"><b>${i+1}</b> ${l}</button>`).join('');
  const p=pool(), solid=p.filter(x=>isSolid(recOf(x.photo))).length, rc=recOf(c.photo);
  document.getElementById('fcprog').innerHTML = (me ? `Learned ${solid} of ${p.length}${rc.r?` · last time: ${rc.r===5?'knew it':rc.r>=3?'partly':"didn't know"}`:''}` : 'Pick your name to save your progress.');
  const s=document.getElementById('star'); const on=!!stars[c.photo]; s.setAttribute('aria-pressed',on); s.textContent=on?'★ Starred':'☆ Star';
  document.getElementById('editor').hidden=true;
}
let lastFlip=0;
cardEl.addEventListener('pointerdown', e=>{ if(e.button&&e.button!==0) return; if(e.target.closest('a,.sig')) return; const t=Date.now(); if(t-lastFlip<250) return; lastFlip=t; flipped=!flipped; renderCard(); });
cardEl.addEventListener('click', e=>{ if(e.target.closest('a,.sig')) return; e.preventDefault(); });
cardEl.addEventListener('keydown', e=>{ if(e.target!==cardEl) return; if(e.key===' '||e.key==='Enter'){e.preventDefault();flipped=!flipped;renderCard();} });
document.getElementById('next').onpointerdown=e=>{ if(e.button) return; if(!order.length) return; idx=(idx+1)%order.length; flipped=false; editing=false; renderCard(); };
document.getElementById('prev').onpointerdown=e=>{ if(e.button) return; if(!order.length) return; idx=(idx-1+order.length)%order.length; flipped=false; editing=false; renderCard(); };
document.getElementById('rate3').addEventListener('click', e=>{ const b=e.target.closest('[data-rate]'); if(b) rateCard(+b.dataset.rate); });
const setSmart = v => { saveDrill(); fcSmart=v; try{ localStorage.setItem('bn-fc', v?'smart':'order'); }catch(e){} resetOrder(); render(); };
document.getElementById('star').onclick=()=>{ const c=order[idx]; if(!c) return; if(stars[c.photo]) delete stars[c.photo]; else stars[c.photo]=1; saveStars(); renderCard(); };
document.getElementById('edit').onclick=()=>{ if(!order[idx]) return; if(!me){ askName(); return; } openInDir(order[idx].photo, true); };
document.addEventListener('keydown', e=>{ if(mode!=='learn'||view!=='cards'||editing||['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)) return;
  if(e.key===' '&&e.target!==cardEl){ e.preventDefault(); flipped=!flipped; renderCard(); return; }
  if(flipped&&'123'.includes(e.key)&&e.key){ rateCard([1,3,5][+e.key-1]); return; }
  if(e.key==='ArrowRight') document.getElementById('next').onpointerdown({button:0}); if(e.key==='ArrowLeft') document.getElementById('prev').onpointerdown({button:0}); });

// ---------- editor ----------
function renderEditor(){ const ed=document.getElementById('editor'); ed.hidden=false; renderEditorInto(ed, order[idx], ()=>{ editing=false; const p=pool(); order=p; idx=Math.max(0,p.findIndex(x=>x.photo===order[idx]?.photo)); flipped=true; render(); }); }
function renderEditorInto(ed, c, onDone){
  if(!ed||!c) return; ed.hidden=false;
  const extra=Object.entries(c.extra||{});
  ed.innerHTML=`<div class="editor"><h2>Edit ${esc(c.name)}</h2>
    <div class="field"><label>Name</label><input data-k="name" value="${esc(c.name)}"></div>
    ${FIELDS.map(([k,l])=>`<div class="field"><label>${esc(l)}</label><textarea data-k="${k}">${esc(c[k]||'')}</textarea></div>`).join('')}
    <div class="extras">${extra.map(([k,v])=>`<div class="field extra"><label>Custom field</label><div class="row"><input class="xk" placeholder="Field name" value="${esc(k)}"><input class="xv" placeholder="Value" value="${esc(v)}"></div></div>`).join('')}</div>
    <div class="ctrl"><button class="small addf">+ Add a field</button></div>
    <div class="ctrl"><button class="btn cancel">Cancel</button><button class="btn primary save">${isPCP()?"Save for everyone":"Send for review"}</button></div>
    <div class="status">${isPCP()?"Saved edits are visible to the whole PC and logged under your name.":`Your edit goes to ${esc(reviewer())} for review before it shows for everyone.`}</div></div>`;
  ed.querySelector('.addf').onclick=()=>{ const d=document.createElement('div'); d.className='field extra'; d.innerHTML='<label>Custom field</label><div class="row"><input class="xk" placeholder="Field name (e.g. Favorite bar)"><input class="xv" placeholder="Value"></div>'; ed.querySelector('.extras').appendChild(d); d.querySelector('.xk').focus(); };
  ed.querySelector('.cancel').onclick=()=>{ ed.hidden=true; onDone(false); };
  ed.querySelector('.save').onclick=async()=>{
    const btn=ed.querySelector('.save'); btn.disabled=true;
    const changes=[]; const upd={};
    const nm=ed.querySelector('[data-k=name]').value.trim(); if(nm && nm!==c.name){ changes.push({field:'Name',from:c.name,to:nm}); upd.name=nm; }
    for(const [k,l] of FIELDS){ const v=ed.querySelector(`[data-k=${k}]`).value.trim(); if(v!==(c[k]||'')){ changes.push({field:l,from:c[k]||'',to:v}); upd[k]=v; } }
    const nx={}; ed.querySelectorAll('.extra').forEach(d=>{ const k=d.querySelector('.xk').value.trim(), v=d.querySelector('.xv').value.trim(); if(k) nx[k]=v; });
    const ox=c.extra||{};
    for(const k of new Set([...Object.keys(ox),...Object.keys(nx)])){ if((ox[k]||'')!==(nx[k]||'')) changes.push({field:k,from:ox[k]||'',to:nx[k]||''}); }
    if(!changes.length){ ed.hidden=true; onDone(false); return; }
    const ok=await commit({who:me,at:when(),card:c.name,changes},(st)=>{ const t=st.cards.find(x=>x.photo===c.photo); Object.assign(t,upd); t.extra=nx; });
    if(ok){ ed.hidden=true; onDone(true); } else btn.disabled=false;
  };
}

// ---------- drill (self-graded flashcards) ----------
let dres={}, fcSmart=true, saveT=null;
function weight(c){ const x=(S.drill[me]||{})[c.photo]; if(!x) return 3; const r=x.r||(x.last==='ok'?5:x.last==='some'?3:1); const s=x.streak||0; if(r<=1) return 4.5; if(r===2) return 3.5; if(r===3) return 2.5; if(r===4) return 1.4; return s>=4?0.25:s>=2?0.6:1.2; }
function smartOrder(p){
  // weighted sample without replacement: missed and never-seen first, solid ones (knew it 2+ in a row) less often
  const items=p.map(c=>({c,w:weight(c)})), out=[];
  while(items.length){ const tot=items.reduce((a,b)=>a+b.w,0); let r=Math.random()*tot, i=0; for(;i<items.length;i++){ r-=items[i].w; if(r<=0) break; } out.push(items.splice(Math.min(i,items.length-1),1)[0].c); }
  return out;
}
function recOf(photo){
  // saved record with this session's unsaved ratings applied, for the progress line
  let x=Object.assign({},(S.drill[me]||{})[photo]||{}); const r=dres[photo]; if(r){ x.r=r; x.streak=r===5?(x.streak||0)+1:0; x.last=r>=4?'ok':r>=2?'some':'miss'; } return x;
}
const isSolid = x => x&&x.last==='ok'&&(x.streak||0)>=2;
function rateCard(r){
  const c=order[idx]; if(!c) return; if(!me){ askName(); return; }
  if(dres[c.photo]){ saveDrill(); } // second rating of the same card in a batch: save the first one before overwriting
  dres[c.photo]=r; idx=(idx+1)%order.length; flipped=false; renderCard();
  clearTimeout(saveT); if(Object.keys(dres).length>=5) saveDrill(); else saveT=setTimeout(saveDrill,8000);
}
document.addEventListener('visibilitychange',()=>{ if(document.visibilityState==='hidden') saveDrill(); });
function myDrill(){ return (S.drill[me]=S.drill[me]||{}); }
async function saveDrill(){
  if(!Object.keys(dres).length) return true;
  const snap=dres; dres={};
  const ok=await commit(null, st=>{ st.drill=st.drill||{}; const d=st.drill[me]=st.drill[me]||{}; for(const [p,r] of Object.entries(snap)){ const x=d[p]=d[p]||{ok:0,some:0,miss:0}; const rt=typeof r==='number'?r:(r==='ok'?5:r==='some'?3:1); x.r=rt; x.n=(x.n||0)+1; x.sum=(x.sum||0)+rt; if(rt>=4){x.ok++; x.streak=rt===5?(x.streak||0)+1:0;} else if(rt>=2){x.some=(x.some||0)+1; x.streak=0;} else {x.miss++; x.streak=0;} x.last=rt>=4?'ok':rt>=2?'some':'miss'; x.at=when(); } });
  if(!ok) dres=Object.assign(snap,dres);
  return ok;
}
// ---------- directory ----------
function renderDir(){
  const q=document.getElementById('dirq').value.trim().toLowerCase(); const out=document.getElementById('dirres');
  const hay=c=>[c.name,c.alias,c.cls,...FIELDS.map(([k])=>c[k]||''),...Object.values(c.extra||{})].filter(Boolean).join(' · ').toLowerCase();
  const list=q?S.cards.filter(c=>hay(c).includes(q)).sort((a,b)=>a.name.localeCompare(b.name)):[];
  out.innerHTML=(dirOpen?renderDirDetail():'')+(q?`<div class="count">${list.length} match${list.length===1?'':'es'}</div>`:'')+list.map(c=>{ const h=hay(c); let snip=''; if(q){ const i=h.indexOf(q); if(i>=0) snip=h.slice(Math.max(0,i-40),i+60).replace(/^\S*\s/,'').replace(/\s\S*$/,''); }
    return `<button class="tile" data-p="${c.photo}" style="display:flex;width:100%;align-items:center;gap:12px;margin-top:8px;padding:8px"><img src="${IMG(c.photo)}" alt="" style="width:56px;height:56px;border-radius:10px;flex:none"><div style="padding:0"><div>${esc(c.name)}</div><small>${esc(c.cls)}${c.home?' · '+esc(c.home):''}</small>${snip?`<small style="color:var(--ink2)">…${esc(snip)}…</small>`:''}</div></button>`; }).join('');
  out.querySelectorAll('.tile').forEach(t=>t.onclick=()=>{ openInDir(t.dataset.p); });
  bindSig(out, renderDir);
  const dc=out.querySelector('#dirclose'); if(dc) dc.onclick=()=>{ dirOpen=null; dirEdit=false; renderDir(); };
  const de=out.querySelector('#diredit'); if(de) de.onclick=()=>{ if(!me){askName();return;} dirEdit=!dirEdit; renderDir(); };
  if(dirOpen&&dirEdit) renderEditorInto(out.querySelector('#direditor'), S.cards.find(x=>x.photo===dirOpen), ()=>{ dirEdit=false; renderDir(); });
}

let dirOpen=null, dirEdit=false;
function openInDir(photo, edit){
  dirOpen=photo; dirEdit=!!edit; view='cards'; mode='learn'; lastStudy='learn';
  render(); const c=S.cards.find(x=>x.photo===photo); document.getElementById('dirq').value=c?c.name:''; renderDir();
  const el=document.getElementById('dirdetail'); if(el) el.scrollIntoView({block:'start',behavior:'smooth'});
}
function renderDirDetail(){
  const c=S.cards.find(x=>x.photo===dirOpen); if(!c) return '';
  const rows=FIELDS.filter(([k])=>k!=='full').map(([k,l])=>[l,c[k]]).concat(Object.entries(c.extra||{}));
  rows.push(['LinkedIn', c.li?`<a href="https://www.linkedin.com/in/${esc(c.li)}/" target="_blank" rel="noopener">linkedin.com/in/${esc(c.li)}</a>`:'', true]);
  return `<div id="dirdetail" class="card" style="margin-top:12px;cursor:default"><div class="back"><img src="${IMG(c.photo)}" alt=""><div><h2>${esc(c.name)}</h2>${c.full?`<div class="fullname"><small>Full name (official)</small>${esc(c.full)}</div>`:''}${c.alias?`<div class="alias">${esc(c.alias)}</div>`:''}<span class="tag">${esc(c.cls)}</span></div><div class="facts">${rows.map(([k,v,raw])=>`<div><b>${esc(k)}</b><span>${v?(raw?v:esc(v)):'<span class="empty">not filled in yet</span>'}</span></div>`).join('')}</div>${sigHtml(c)}</div></div>
    <div class="ctrl"><button class="btn" id="dirclose">Close</button><button class="btn primary" id="diredit">${dirEdit?'Close editor':'✎ Edit this brother'}</button></div><div id="direditor" ${dirEdit?'':'hidden'}></div>`;
}

// ---------- grid ----------

// ---------- Google Sheets (read-only, client-side) ----------
// Each sheet must be shared "anyone with the link can view", or swap src for its File > Share > Publish to web > CSV link.
const SHEETS={
  sigs:{src:'https://docs.google.com/spreadsheets/d/1cMJ35jVmLAj84479Zo0r64K3AMh0KpQaeyrbZUI1bNk/gviz/tq?tqx=out:csv', name:'Signature Tasks Tracker'}};
const INFORMALS={target:25, targets:{'Ali-Anass Mazouzi':30}, by:'2026-10-11'};
const SH={};
function parseCSV(t){ const rows=[]; let row=[], f='', q=false; for(let i=0;i<t.length;i++){ const ch=t[i]; if(q){ if(ch==='"'){ if(t[i+1]==='"'){ f+='"'; i++; } else q=false; } else f+=ch; } else if(ch==='"') q=true; else if(ch===','){ row.push(f); f=''; } else if(ch==='\n'||ch==='\r'){ if(ch==='\r'&&t[i+1]==='\n') i++; row.push(f); rows.push(row); row=[]; f=''; } else f+=ch; } if(f!==''||row.length){ row.push(f); rows.push(row); } return rows; }
async function loadSheet(k){
  const x=SH[k]; if(x&&Date.now()-x.t<300000) return x;
  try{ const r=await fetch(SHEETS[k].src,{cache:'no-store'}); if(!r.ok) throw new Error('HTTP '+r.status); const txt=await r.text(); if(/^\s*</.test(txt)) throw new Error('the sheet is not shared or published'); SH[k]={rows:parseCSV(txt),t:Date.now()}; }
  catch(e){ SH[k]={err:(e&&e.message)||String(e),t:Date.now()}; }
  if(k==='sigs') buildSigSheet(); return SH[k];
}
const loadSheets = () => Promise.all(Object.keys(SHEETS).map(loadSheet));
const sheetNote = k => SH[k]&&SH[k].err ? `Couldn't read the ${SHEETS[k].name} (${esc(SH[k].err)}). In the sheet: Share → anyone with the link can view, or File → Share → Publish to web → CSV, then put that link in SHEETS.${k}.src in app.js.` : !SH[k] ? 'Loading the '+SHEETS[k].name+'…' : '';
function informals(){
  // per-pledge counts synced nightly from the Informals Tracker into Firebase `informals` (no brother names or emails)
  const x=S.informals; if(!x||!x.counts) return null; const out={};
  for(const n of PC()){ const c=x.counts[key(n)]||x.counts[n]||{}; out[n]={done:+c.done||0, confirmed:+c.confirmed||0, emailed:+c.emailed||0, target:INFORMALS.targets[n]||INFORMALS.target}; }
  return out;
}
const examOn = (n, iso) => { const x=(S.exams||{})[key(n)]||(S.exams||{})[n]; return (Array.isArray(x)?x:Object.values(x||{})).filter(e=>e&&e.date===iso); };
function recapRepliesHtml(){
  // PCP only: who replied to the latest daily recap email (written by the noon recap job: recaps/<date> = {sentAt, replied: {name: true|false}})
  const R=S.recaps||{}, d=Object.keys(R).sort().pop(); if(!isPCP()||!d) return '';
  const rep=R[d].replied||{}, yes=PC().filter(n=>rep[n]), no=PC().filter(n=>!rep[n]);
  return `<div class="editor"><h2>Replied? <small class="status">recap of ${esc(shortDay(d))}</small></h2><ul class="goals">${PC().map(n=>`<li><span>${esc(first(n))}</span><b class="${rep[n]?'ok':'no'}">${rep[n]?'Replied':'Not yet'}</b></li>`).join('')}</ul><div class="status">${yes.length} of ${PC().length} replied${R[d].checkedAt?` · checked ${esc(fmt(R[d].checkedAt))}`:''}</div></div>`;
}
let cmtOpen=false;
function examsTomorrowHtml(){
  // commitments: anyone can add a busy time (instant, no review); exams tomorrow are PCP-only
  const t0=today(), d1=addDays(t0,1), C=(S.commitments||[]).filter(c=>c.date&&c.date>=t0).sort((a,b)=>(a.date+(a.time||''))<(b.date+(b.time||''))?-1:1);
  const ex=isPCP()&&S.exams&&Object.keys(S.exams).length?PC().flatMap(n=>examOn(n,d1).map(e=>[n,e])):null;
  return `<div class="editor" id="cmts"><h2>Exams + commitments</h2>
    ${ex?`<h3 class="wh">Exams tomorrow</h3>${ex.length?`<ul class="goals">${ex.map(([n,e])=>`<li><span>${esc(first(n))} · ${esc(e.course||'Exam')}</span><b>${esc(e.time||'')}</b></li>`).join('')}</ul>`:'<div class="status">Nobody has an exam tomorrow.</div>'}<h3 class="wh">Commitments</h3>`:''}
    ${C.length?`<ul class="goals">${C.map(c=>`<li><span>${esc(dueText(c.date))}${c.time?' · '+esc(c.time):''} · ${esc(c.text)} <small class="status">(${esc(first(c.who||''))})</small></span>${c.who===me||isPCP()?`<button class="x" data-cdel="${esc(c._k)}" aria-label="Delete commitment">×</button>`:''}</li>`).join('')}</ul>`:'<div class="status">No upcoming commitments.</div>'}
    ${cmtOpen?`<div class="field" style="margin-top:10px"><input id="ctext" placeholder="What (e.g. Interview)" autocomplete="off"></div><div class="row cform"><input id="cdate" type="date" value="${d1}" aria-label="Date"><input id="ctime" placeholder="Time (optional, e.g. 2–3 PM)" autocomplete="off" aria-label="Time"></div><div class="ctrl"><button class="btn" id="ccancel">Cancel</button><button class="btn ok" id="cadd">Add</button></div>`
      :`<div class="ctrl"><button class="btn" id="copen">+ Add a commitment</button></div>`}</div>`;
}
function bindCommitments(root, rerender){
  const o=root.querySelector('#copen'); if(o) o.onclick=()=>{ if(!me){ askName(); return; } cmtOpen=true; rerender(); const t=root.querySelector('#ctext'); if(t) t.focus(); };
  const cc=root.querySelector('#ccancel'); if(cc) cc.onclick=()=>{ cmtOpen=false; rerender(); };
  const ad=root.querySelector('#cadd'); if(ad) ad.onclick=async()=>{ const text=root.querySelector('#ctext').value.trim(), date=root.querySelector('#cdate').value, time=root.querySelector('#ctime').value.trim(); if(!text||!date){ toast('Add what and when.'); return; }
    ad.disabled=true; try{ await dbWrite('POST','commitments',Object.assign({who:me,text,date,at:when()},time?{time}:{})); cmtOpen=false; await refresh(); toast('Added for everyone'); }catch(e){ toast('Save failed: '+(e.message||e)); ad.disabled=false; return; } rerender(); };
  root.querySelectorAll('[data-cdel]').forEach(b=>b.onclick=async()=>{ const c=(S.commitments||[]).find(x=>x._k===b.dataset.cdel); if(!c||!(c.who===me||isPCP())) return; b.disabled=true; try{ await dbWrite('DELETE','commitments/'+key(c._k)); await refresh(); }catch(e){ toast('Delete failed'); } rerender(); });
}
const informalsUpdated = () => S.informals&&S.informals.updatedAt ? 'Updated '+fmt(S.informals.updatedAt) : '';
function informalsHtml(){
  const I=informals();
  if(!I) return `<div class="editor" style="margin-top:12px"><h2>Informals</h2><div class="status">Counts sync from the Informals Tracker every night at 10 PM. Not synced yet.</div></div>`;
  const rows=PC().map(n=>[n,I[n]]), hit=rows.filter(([,c])=>c.done>=c.target).length;
  return `<div class="editor" style="margin-top:12px"><h2>Informals · ${esc(dueText(INFORMALS.by))}</h2>
    <div class="status">From the Informals Tracker · ${esc(informalsUpdated())} · at target: <b>${hit} of ${rows.length}</b>. Expected = straight-line pace from induction (${esc(shortDay(PACE_START))}).</div>
    <div style="overflow-x:auto"><table class="lb"><tr><th>Pledge</th><th class="n">Done</th><th class="n">Expected</th><th>Pace</th><th class="n">Conf.</th><th class="n">Emailed</th></tr>
    ${rows.map(([n,c])=>{ const pc=pace(c.done,c.target,INFORMALS.by); return `<tr><td>${esc(first(n))}${n===me?' <b>(you)</b>':''}</td><td class="n${c.done>=c.target?' hit':''}">${c.done}/${c.target}</td><td class="n">${pc.exp}</td><td>${paceTag(pc)}</td><td class="n">${c.confirmed}</td><td class="n">${c.emailed}</td></tr>`; }).join('')}</table></div></div>`;
}
let SIGSHEET={};
function sheetCard(name, cls){
  const t=words(name).map(nw).filter(Boolean); if(!t.length) return null; const k=String(cls||'').trim().toLowerCase();
  const hits=S.cards.filter(c=>c.cls!=='Beta Omega'&&!c.photo.startsWith('vppe-')&&(!k||c.cls.toLowerCase().startsWith(k))&&(()=>{ const a=words(c.name).map(nw), f=words(c.full||'').map(nw); return (a[0]===t[0]||f[0]===t[0])&&a.concat(f).includes(t[t.length-1]); })());
  return hits.length===1?hits[0]:null;
}
const sheetStatus = v => { v=String(v||'').toLowerCase(); return /sign/.test(v)?'signed':/done|complete/.test(v)?'done':/confirm/.test(v)?'confirmed':/request|email|sent|ask/.test(v)?'requested':'none'; };
function buildSigSheet(){
  // the Signature Tasks Tracker is the source of truth for status (and task text) when it can be read; columns found by header
  SIGSHEET={}; const x=SH.sigs; if(!x||!x.rows) return;
  const hi=x.rows.findIndex(r=>r.some(c=>/^brother$/i.test(c.trim()))&&r.some(c=>/^status$/i.test(c.trim()))); if(hi<0){ x.err='no Brother / Status header row'; return; }
  const h=x.rows[hi].map(c=>c.trim().toLowerCase()), ib=h.indexOf('brother'), is=h.indexOf('status'), it=h.indexOf('task'), ic=h.indexOf('class');
  for(const r of x.rows.slice(hi+1)){ const c=sheetCard(r[ib]||'', ic>=0?r[ic]:''); if(!c) continue; const task=it>=0?String(r[it]||'').trim():''; SIGSHEET[c.photo]=Object.assign({status:sheetStatus(r[is])}, task?{task}:{}); }
}
const fromSheet = c => !!(c&&SIGSHEET[c.photo]);

// ---------- sig tasks (stored on each brother's card as c.sig) ----------
const SIG=['none','requested','confirmed','done','signed'];
const SIGL={none:'Not asked',requested:'Requested',confirmed:'Confirmed',done:'Done, needs signature',signed:'Signed'};
const SIG_TARGET={pct:75, by:'2026-10-11'};
const sigOf = c => { const b=(c&&c.sig)||{status:'none'}, o=c&&SIGSHEET[c.photo]; return o?Object.assign({},b,o):b; };
const sigCards = () => S.cards.filter(c=>c.sig||SIGSHEET[c.photo]);
const mdy = iso => +iso.slice(5,7)+'/'+ +iso.slice(8,10);
function sigProgress(){ const all=sigCards(), k=all.filter(c=>sigOf(c).status==='signed').length, tgt=Math.ceil(all.length*SIG_TARGET.pct/100); return `Signed ${k} of ${all.length} · target ${SIG_TARGET.pct}% (${tgt}) by ${mdy(SIG_TARGET.by)}`+(Object.keys(SIGSHEET).length?' · statuses from the '+SHEETS.sigs.name:''); }
function sigSet(photo, upd){
  const c=S.cards.find(x=>x.photo===photo), b=sigOf(c);
  const changes=Object.keys(upd).filter(k=>!k.endsWith('At')).map(k=>({field:'Sig task · '+k,from:String(k==='status'?SIGL[b[k]]:b[k]??''),to:String(k==='status'?SIGL[upd[k]]:upd[k]??'')}));
  return commit({who:me,at:when(),card:c.name,changes}, st=>{ const t=st.cards.find(x=>x.photo===photo); const g=Object.assign({status:'none'},t.sig||{},upd); for(const k of Object.keys(g)) if(g[k]===''||g[k]==null) delete g[k]; t.sig=g; });
}
function sigStep(photo, dir){ const st=sigOf(S.cards.find(x=>x.photo===photo)).status, i=SIG.indexOf(st)+dir; if(i<0||i>=SIG.length) return Promise.resolve(false);
  return sigSet(photo, dir>0 ? {status:SIG[i],[SIG[i]+'At']:when()} : {status:SIG[i],[st+'At']:''}); }
const sigChip = st => `<span class="schip s-${st}">${esc(SIGL[st]||st)}</span>`;
const sigDiff = d => d?`<span class="diff" title="Difficulty">${+d}/10</span>`:'';
function sigHtml(c){
  if(!c||c.cls==='Beta Omega') return ''; const g=sigOf(c), i=SIG.indexOf(g.status);
  return `<div class="sig" data-sig="${esc(c.photo)}"><div class="sigtop"><b>Sig task</b>${sigChip(g.status)}${sigDiff(g.difficulty)}</div>
    <button class="sigtask" ${fromSheet(c)&&SIGSHEET[c.photo].task?'disabled':'data-sigtask'} title="Edit the task">${g.task?esc(g.task):'<span class="empty">No task text yet</span>'} <span class="pen">✎</span></button>${g.notes?`<div class="status">${esc(g.notes)}</div>`:''}
    <div class="sigedit"><label>Difficulty<select data-sigdiff><option value="">—</option>${[1,2,3,4,5,6,7,8,9,10].map(d=>`<option ${+g.difficulty===d?'selected':''}>${d}</option>`).join('')}</select></label></div>
    ${fromSheet(c)?`<div class="status">Status comes from the ${SHEETS.sigs.name}; update it there.</div>`:`<div class="ctrl">${i>0?`<button class="btn" data-sigback style="flex:0 0 auto">← Back</button>`:''}${i<SIG.length-1?`<button class="btn" data-signext>Next step → ${esc(SIGL[SIG[i+1]])}</button>`:''}</div>`}</div>`;
}
function bindSig(root, rerender){
  const ph=el=>el.closest('[data-sig]').dataset.sig, run=async p=>{ if(await p) rerender(); };
  root.querySelectorAll('[data-signext]').forEach(b=>b.onclick=()=>{ b.disabled=true; run(sigStep(ph(b),1)); });
  root.querySelectorAll('[data-sigback]').forEach(b=>b.onclick=()=>{ b.disabled=true; run(sigStep(ph(b),-1)); });
  root.querySelectorAll('[data-sigdiff]').forEach(x=>x.onchange=()=>run(sigSet(ph(x),{difficulty:x.value?+x.value:''})));
  root.querySelectorAll('[data-sigtask]').forEach(b=>b.onclick=()=>{ const g=sigOf(S.cards.find(x=>x.photo===ph(b))); const v=prompt('Sig task',g.task||''); if(v===null||v.trim()===(g.task||'')) return; run(sigSet(ph(b),{task:v.trim()})); });
  root.querySelectorAll('[data-open]').forEach(b=>b.onclick=()=>openInDir(ph(b)));
}
const sigRow = (c,long) => { const g=sigOf(c); return `<div class="sigr" data-sig="${esc(c.photo)}"><button class="nm" data-open>${esc(c.name)}<small>${esc(c.cls.split(' (')[0])}</small></button>${sigDiff(g.difficulty)}${sigChip(g.status)}${g.status==='signed'||fromSheet(c)?'':long?`<button class="small nxl" data-signext>Next step →</button>`:`<button class="nx" data-signext aria-label="Next step">→</button>`}</div>`; };
const sigsEl=document.getElementById('sigs');
function renderSigs(){
  const list=sigCards(), nm=(a,b)=>a.name.localeCompare(b.name);
  const cols=[['To request',['none','requested'],(a,b)=>SIG.indexOf(sigOf(a).status)-SIG.indexOf(sigOf(b).status)||nm(a,b)],
    ['In progress',['confirmed','done'],(a,b)=>(+sigOf(a).difficulty||99)-(+sigOf(b).difficulty||99)||nm(a,b)],
    ['Signed',['signed'],(a,b)=>(sigOf(b).signedAt||'')<(sigOf(a).signedAt||'')?-1:1]];
  const row=c=>sigRow(c);
  sigsEl.innerHTML=`<div class="status" style="margin-top:14px"><b>${esc(sigProgress())}</b></div>
    <div class="sigcols">${cols.map(([h,sts,sort])=>{ const xs=list.filter(c=>sts.includes(sigOf(c).status)).sort(sort); return `<div><h3 class="sec">${h} <small>${xs.length}</small></h3>${xs.map(row).join('')||'<div class="status">None</div>'}</div>`; }).join('')}</div>
    <div class="status">Every sig task is done by the whole class together. Tap a name to open the brother. → moves the sig task to its next step.</div>`;
  bindSig(sigsEl, renderSigs);
}

// ---------- tasks ----------
const tasksEl=document.getElementById('tasks');
const WDAYS=['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
const dow = iso => new Date(iso+'T12:00:00').getDay();
const repText = t => t.repeat==='daily' ? 'Every day'+(t.time?' by '+timeText(t.time):'') : '';
const dueText = iso => { if(!iso) return 'Ongoing'; const t=today(); if(iso===t) return 'Today'; if(iso===addDays(t,1)) return 'Tomorrow'; return new Date(iso+'T12:00:00').toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'}).replace(',',''); };
const first = n => String(n).split(' ')[0];
const PCP = () => ((SEED.roster||[]).find(r=>/(^|pledge class )president\b/i.test(r.role||''))||{}).name||'';
const isPCP = () => !!me && me===PCP();
const whoText = who => who&&who.length ? who.map(n=>`#${PNUM(n)} ${first(n)}`).join(', ') : 'Whole class';
function atWho(t){
  t=t.toLowerCase().replace(/[^a-z0-9-]/g,''); const R=SEED.roster||[];
  if(t==='me') return me||null;
  if(t==='all') return '*';
  if(/^\d+$/.test(t)){ const r=R.find(x=>x.n===+t); return r?r.name:null; }
  const hits=R.filter(x=>x.name.toLowerCase().split(' ')[0].startsWith(t)); return t&&hits.length===1?hits[0].name:null;
}
function parseDue(ws, base){
  // reads a date phrase off the end of ws; returns {due, n: words used} or null
  const L=ws.map(w=>w.toLowerCase().replace(/[.,!]+$/,'')), k=L.length, w=L[k-1]; if(!k) return null; let r=null;
  if(k>=3 && L[k-3]==='in' && /^\d+$/.test(L[k-2]) && /^days?$/.test(w)) r={due:addDays(base,+L[k-2]),n:3};
  else if(w==='today') r={due:base,n:1};
  else if(/^(tmr|tmrw|tomorrow)$/.test(w)) r={due:addDays(base,1),n:1};
  else if(w.length>=3 && WDAYS.some(d=>d.startsWith(w))){ const i=WDAYS.findIndex(d=>d.startsWith(w)); r={due:addDays(base,((i-dow(base)+7)%7)||7),n:1}; }
  else { const m=w.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?$/); if(m&&+m[1]>=1&&+m[1]<=12&&+m[2]>=1&&+m[2]<=31){ let y=m[3]?(m[3].length===2?2000+ +m[3]:+m[3]):+base.slice(0,4); const iso=(y,mo,d)=>`${y}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`; let d=iso(y,+m[1],+m[2]); if(!m[3]&&d<addDays(base,-182)) d=iso(y+1,+m[1],+m[2]); r={due:d,n:1}; } }
  if(r && k>r.n && L[k-r.n-1]==='due') r.n++;
  return r;
}
function parseTime(ws){
  // reads "7am", "8:30pm", "7 pm", "noon", "midnight" (11:59 PM) or "at 7" off the end of ws; no am/pm: 1-7 and 12 are PM, 8-11 AM. Returns {time:'HH:MM', n} or null
  const L=ws.map(w=>w.toLowerCase().replace(/[.,!]+$/,'')), k=L.length; if(!k) return null; let m, n=1;
  if(L[k-1]==='noon') m=['','12','00','pm'];
  else if(L[k-1]==='midnight') m=['','11','59','pm'];
  else if(k>=2&&/^(am|pm)$/.test(L[k-1])&&/^\d{1,2}(:\d{2})?$/.test(L[k-2])){ m=(L[k-2]+L[k-1]).match(/^(\d{1,2})(?::(\d{2}))?(am|pm)$/); n=2; }
  else m=L[k-1].match(/^(\d{1,2})(?::(\d{2}))?(am|pm)$/);
  if(!m&&k>=2&&L[k-2]==='at') { m=L[k-1].match(/^(\d{1,2})(?::(\d{2}))?()$/); }
  if(!m) return null; let h=+m[1], mi=+(m[2]||0); if(h<1||h>12||mi>59) return null;
  const ap=m[3]||(h===12||h<=7?'pm':'am'); if(ap==='pm'&&h<12) h+=12; if(ap==='am'&&h===12) h=0;
  if(k>n&&(L[k-n-1]==='at'||L[k-n-1]==='by')) n++;
  return {time:String(h).padStart(2,'0')+':'+String(mi).padStart(2,'0'), n};
}
const timeText = t => { if(!t) return ''; if(t==='23:59') return 'midnight'; let [h,m]=t.split(':').map(Number); const ap=h>=12?'pm':'am'; h=h%12||12; return h+(m?':'+String(m).padStart(2,'0'):'')+ap; };
function parseTask(line, base){
  base=base||today(); const who=[], bad=[], rest=[]; let all=false;
  for(const w of String(line).replace(/^\s*([-*•]|\d+[.)])\s+/,'').trim().split(/\s+/)){ if(/^@\S+/.test(w)){ const n=atWho(w.slice(1)); if(n==='*') all=true; else if(n){ if(!who.includes(n)) who.push(n); } else bad.push(w); } else if(w) rest.push(w); }
  const d=parseDue(rest, base); if(d) rest.splice(rest.length-d.n);
  const tm=parseTime(rest); if(tm) rest.splice(rest.length-tm.n);
  return {title:rest.join(' '), who:all?[]:who, all, due:d?d.due:'', time:tm?tm.time:'', bad};
}
const previewText = p => p.bad.length ? `Unknown: ${p.bad.join(' ')} (use @number, @first name or @me)` : `For: ${whoText(p.who)} · ${p.due?'Due '+dueText(p.due):'Ongoing'}${p.time?', '+timeText(p.time):''}`;
const newTask = p => Object.assign({id:uid(),title:p.title,notes:'',by:me,at:when(),done:{}}, p.due?{due:p.due}:{}, p.time?{time:p.time}:{}, p.who.length?{who:p.who}:{});
// duplicate guard: same normalized title + same assignees (empty = whole class) is never added twice
const taskKey = (title, who) => String(title||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9$%]+/g,' ').trim()+'|'+(who||[]).slice().sort().join(',');
async function addTasks(ps){
  if(!isPCP()){ toast('Only the PCP can add tasks.'); return false; }
  const seen=new Set(S.tasks.map(t=>taskKey(t.title,t.who))), fresh=[];
  for(const p of ps){ const k=taskKey(p.title,p.who); if(!seen.has(k)){ seen.add(k); fresh.push(p); } }
  const dup=ps.length-fresh.length;
  if(!fresh.length){ toast(ps.length===1?'That task already exists.':'All of these tasks already exist.'); return false; }
  if(dup) toast(`Skipped ${dup} duplicate${dup===1?'':'s'}.`);
  ps=fresh;
  const ok=await commit({who:me,at:when(),card:'Tasks',changes:ps.map(p=>({field:'Added task',from:'',to:p.title+' ('+whoText(p.who)+', due '+p.due+')'}))}, st=>{ for(const p of ps) st.tasks.push(newTask(p)); });
  if(ok){ tDraft=''; render(); } return ok;
}
let tDraft='', tEdit=null, tWho=[], tBoard='', tAll=false, tView='';
function undoToast(text, onUndo){
  document.querySelectorAll('.toast').forEach(x=>x.remove()); const d=document.createElement('div'); d.className='toast'; d.innerHTML=`${esc(text)} <button>Undo</button>`; document.body.appendChild(d);
  const t=setTimeout(()=>d.remove(),5000); d.querySelector('button').onclick=()=>{ clearTimeout(t); d.remove(); onUndo(); };
}
function taskHtml(t){
  // a task is complete only when every assignee has checked it; v is whose board is being shown (others' boards are read-only)
  const v=tView||me, as=t.who&&t.who.length?t.who:PC(), n=as.filter(x=>isDone(t,x)).length, mine=!!v&&isFor(t,v), meDone=isDone(t,v), all=n>=as.length, ro=v!==me;
  const late=t.due&&t.due<today()&&(mine?!meDone:!all);
  if(tEdit===t.id) return `<div class="task" data-id="${esc(t.id)}"><div class="field"><label>Task</label><input id="et" value="${esc(t.title)}"></div>
    <div class="field"><label>Due</label><div class="row"><input id="ed" type="date" value="${esc(t.due||'')}"><input id="etm" type="time" value="${esc(t.time||'')}"></div></div>
    <div class="field"><label>Who</label><div class="chips" style="margin-top:0"><button class="chip" data-ew="" aria-pressed="${!tWho.length}">Whole class</button>${(SEED.roster||[]).map(r=>`<button class="chip" data-ew="${esc(r.name)}" aria-pressed="${tWho.includes(r.name)}">#${r.n} ${esc(first(r.name))}</button>`).join('')}</div></div>
    <div class="field"><label>Notes</label><textarea id="en">${esc(t.notes||'')}</textarea></div>
    <div class="ctrl"><button class="btn" id="ecancel">Cancel</button><button class="btn primary" id="esave">Save</button></div></div>`;
  return `<div class="task ${all?'done':''}" data-id="${esc(t.id)}"><div class="t">${mine?`<label class="ck"><input type="checkbox" data-tog ${meDone?'checked':''} ${ro?'disabled':''} aria-label="${ro?esc(first(v))+(meDone?' is done':' is not done'):'Mark done'}"></label>`:''}<button class="ttl" data-edit>${esc(t.title)}</button>${isPCP()?'<button class="x" data-del aria-label="Delete task">×</button>':''}</div>
    ${t.notes?`<div class="notes">${esc(t.notes)}</div>`:''}
    <div class="meta"><span class="due ${late?'late':''}">${t.repeat?esc(repText(t))+(autoDone(t,v,today())?' · done via quiz today':''):`${late?'Overdue · ':t.due?'Due ':''}${esc(dueText(t.due))}${t.time?' · '+timeText(t.time):''}`}${mine?esc(countText(countGoal(t,v))):''}${mine&&t.due&&examOn(v,t.due).length?' · exam that day':''}</span>${as.length>1?`<button class="small" data-show aria-label="Who's done">${t.who&&t.who.length?'':'Class · '}${n}/${as.length} done ▾</button>`:''}</div>
    <div class="who" data-who hidden>${as.map(x=>`<span class="${isDone(t,x)?'':'no'}">${isDone(t,x)?'✓ ':''}${esc(first(x))}</span>`).join('')}</div></div>`;
}
function bindTasks(el, rerender){
  const T=id=>S.tasks.find(x=>x.id===id), idOf=b=>b.closest('[data-id]').dataset.id;
  el.querySelectorAll('[data-tog]').forEach(b=>b.onchange=async()=>{ if(!me){askName();return;} const t=T(idOf(b)), was=isDone(t,me); b.disabled=true;
    if(was&&autoDone(t,me,today())){ toast('Done automatically: you did a quiz today.'); b.checked=true; b.disabled=false; return; }
    await commit({who:me,at:when(),card:'Tasks',changes:[{field:t.title,from:was?'done':'not done',to:was?'not done':'done'}]},st=>{ const x=st.tasks.find(y=>y.id===t.id); x.done=x.done||{}; if(was) delete x.done[me]; else x.done[me]=t.repeat==='daily'?today():when(); }); rerender(); });
  el.querySelectorAll('[data-show]').forEach(b=>b.onclick=()=>{ const w=b.closest('.task').querySelector('[data-who]'); w.hidden=!w.hidden; });
  el.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>{ const t=T(idOf(b)); tEdit=t.id; tWho=(t.who||[]).slice(); rerender(); const i=el.querySelector('#et'); if(i){ i.focus(); i.setSelectionRange(i.value.length,i.value.length); } });
  el.querySelectorAll('[data-del]').forEach(b=>b.onclick=async()=>{ if(!isPCP()){ toast('Only the PCP can remove tasks.'); return; } const t=T(idOf(b)), keep=Object.assign({},t); delete keep._k;
    const ok=await commit({who:me,at:when(),card:'Tasks',changes:[{field:'Deleted task',from:t.title,to:''}]},st=>{ st.tasks=st.tasks.filter(x=>x.id!==t.id); }); rerender();
    if(ok) undoToast('Deleted "'+t.title+'"', async()=>{ await commit({who:me,at:when(),card:'Tasks',changes:[{field:'Restored task',from:'',to:t.title}]},st=>{ st.tasks.push(keep); }); rerender(); }); });
  const ed=el.querySelector('[data-id] #et'); if(!ed) return;
  el.querySelectorAll('[data-ew]').forEach(b=>b.onclick=()=>{ const n=b.dataset.ew; if(!n) tWho=[]; else tWho=tWho.includes(n)?tWho.filter(x=>x!==n):tWho.concat(n);
    el.querySelectorAll('[data-ew]').forEach(c=>c.setAttribute('aria-pressed', c.dataset.ew ? tWho.includes(c.dataset.ew) : !tWho.length)); });
  const save=async()=>{ const t=T(tEdit); if(!t){ tEdit=null; rerender(); return; } const title=ed.value.trim(), due=el.querySelector('#ed').value, time=el.querySelector('#etm').value, notes=el.querySelector('#en').value.trim(); if(!title){ ed.focus(); return; }
    const who=(SEED.roster||[]).map(r=>r.name).filter(n=>tWho.includes(n)), ch=[];
    if(title!==t.title) ch.push({field:'Task',from:t.title,to:title}); if(due!==(t.due||'')) ch.push({field:t.title+' · due',from:t.due||'',to:due}); if(time!==(t.time||'')) ch.push({field:t.title+' · time',from:t.time||'',to:time}); if(notes!==(t.notes||'')) ch.push({field:t.title+' · notes',from:t.notes||'',to:notes});
    if(whoText(who)!==whoText(t.who)) ch.push({field:t.title+' · who',from:whoText(t.who),to:whoText(who)});
    if(ch.length){ const ok=await commit({who:me,at:when(),card:'Tasks',changes:ch},st=>{ const x=st.tasks.find(y=>y.id===t.id); Object.assign(x,{title,notes}); if(due) x.due=due; else delete x.due; if(time) x.time=time; else delete x.time; if(who.length) x.who=who; else delete x.who; }); if(!ok) return; }
    tEdit=null; rerender(); };
  el.querySelector('#esave').onclick=save; el.querySelector('#ecancel').onclick=()=>{ tEdit=null; rerender(); };
  ed.onkeydown=e=>{ if(e.key==='Enter'){ e.preventDefault(); save(); } if(e.key==='Escape'){ tEdit=null; rerender(); } };
}
function renderTasks(){
  // everyone sees their own board; the PCP picks whose board (one person at a time, default themselves) and is the only one who can add
  const pcp=isPCP(), who=pcp?(tBoard||me):me, fn=who?first(who):'', other=who&&who!==me; tView=who||me;
  const byDue=(a,b)=>{ const x=(a.due||'9999')+(a.time||'99:99'), y=(b.due||'9999')+(b.time||'99:99'); return x<y?-1:x>y?1:0; };
  const L=S.tasks.slice().sort(byDue), all=L.filter(t=>!(t.who||[]).length);
  const sec=(h,ts,empty)=>{ const dated=ts.filter(t=>t.due), og=ts.filter(t=>!t.due); return ts.length||empty?`<h3 class="sec">${h} <small>${ts.length}</small></h3>${dated.map(taskHtml).join('')}${og.length?`<div class="ongo">Ongoing <small>${og.length}</small></div>${og.map(taskHtml).join('')}`:''}${ts.length?'':`<div class="reveal">${empty}</div>`}`:''; };
  const target=p=>{ if(!p.who.length&&!p.all&&other&&!tAll) p.who=[who]; return p; }; // own board: no @ = whole class; someone else's: that person
  const hint=`Enter to add · @Tim assigns it (none = ${other&&!tAll?esc(fn):'whole class'}) · "fri" or "10/11" sets the due date`;
  const focused=document.activeElement&&document.activeElement.id==='tq';
  const board = !me ? '<div class="reveal" style="margin-top:14px">Pick your name to see your tasks.</div>'
    : sec(who===me?'Just for you':'Just for '+esc(fn),L.filter(t=>(t.who||[]).includes(who)),'Nothing assigned just to '+(who===me?'you':esc(fn))+'.')+sec('Whole class',all,'No class tasks yet.')
  tasksEl.innerHTML=(pcp?`<label class="whose">Whose tasks: <select id="tbd" aria-label="Whose tasks">${(SEED.roster||[]).map(r=>`<option value="${esc(r.name)}"${r.name===who?' selected':''}>${r.name===me?'Me':'#'+r.n+' '+esc(first(r.name))}</option>`).join('')}</select></label>
    <div class="field" style="margin-top:12px"><input id="tq" placeholder="${other?'Add a task for '+esc(fn)+'…':'Add a task for the whole class…'}" autocomplete="off" enterkeyhint="done" value="${esc(tDraft)}">
    ${other?`<div class="chips" style="margin-top:6px"><button class="chip" id="tall" aria-pressed="${tAll}">Add to all</button></div>`:''}${who&&who!==me?`<div class="status">Viewing ${esc(fn)}'s board. Their checkboxes are read-only.${(g=>g?`<br>Informals: ${g.done}/${g.target} done · ${g.left?`do ${g.per}/day until the meeting`:'target hit'}${g.toEmail?` · emails to send: ${g.toEmail}`:''}`:'')(informalGoal(who))}</div>`:''}
    <div class="status" id="tprev">${tDraft.trim()?esc(previewText(target(parseTask(tDraft)))):hint}</div></div>`
    :'')+board;
  bindTasks(tasksEl, renderTasks);
  if(!pcp) return;
  const bd=tasksEl.querySelector('#tbd'); if(bd) bd.onchange=()=>{ tBoard=bd.value===me?'':bd.value; tAll=false; renderTasks(); };
  const ta=tasksEl.querySelector('#tall'); if(ta) ta.onclick=()=>{ tAll=!tAll; renderTasks(); };
  const q=tasksEl.querySelector('#tq'), pv=tasksEl.querySelector('#tprev');
  if(focused){ q.focus(); q.setSelectionRange(q.value.length,q.value.length); }
  q.oninput=()=>{ tDraft=q.value; pv.textContent=tDraft.trim()?previewText(target(parseTask(tDraft))):''; };
  q.onkeydown=async e=>{ if(e.key!=='Enter') return; e.preventDefault(); const p=target(parseTask(q.value)); if(p.bad.length){ toast(previewText(p)); return; } if(!p.title) return; q.disabled=true; if(!await addTasks([p])) q.disabled=false; };
  q.onpaste=async e=>{ const lines=(e.clipboardData||window.clipboardData).getData('text').split(/\r?\n/).map(x=>x.trim()).filter(Boolean); if(lines.length<2) return; e.preventDefault();
    const ps=lines.map(l=>target(parseTask(l))).filter(p=>p.title); const bad=ps.filter(p=>p.bad.length);
    if(!confirm(`Add ${ps.length} tasks?\n\n`+ps.map(p=>`• ${p.title} (${previewText(p)})`).join('\n')+(bad.length?`\n\n${bad.length} line(s) have unknown @names; those are ignored.`:''))) return;
    ps.forEach(p=>p.bad=[]); await addTasks(ps); };
}

// ---------- milestones ----------
// what "done" means for each milestone; change the date or tests here
const PACE_START='2026-09-16'; // induction day: informals and milestones are cumulative from here
function pace(done, target, due){ const span=Math.max(1,daysTo(PACE_START,due)-1), gone=Math.min(span,Math.max(0,daysTo(PACE_START,today())-1)), exp=Math.round(target*gone/span); return {exp, ok:done>=exp, frac:gone/span}; }
const paceTag = pc => pc.ok?'<span class="tag-ok">On pace</span>':'<span class="tag-bad">Behind</span>';
const MILESTONES={by:'2026-10-11', items:[
  {id:'names', label:'All names', how:'Spell 100% on all 4 classes, plus every flashcard solid (Knew it twice in a row)', val:n=>[ROLLS.filter(r=>rollBest(n,r.cls)===100).length+Object.values(S.drill[n]||{}).filter(x=>x.last==='ok'&&(x.streak||0)>=2).length, ROLLS.length+S.cards.length]},
  {id:'quiz', label:'Quiz 100%', how:'100% on every filled-in official question (Q1–19)', val:n=>officialQuiz(n)}]};
function officialQuiz(n){ const set=qSets().find(x=>x.id==='official'); if(!set) return [0,0]; const xs=qItems(set); return [xs.filter(x=>qBest(n,set.id,x.id)===100).length, xs.length]; }
function msLeft(){ const d=Math.round((new Date(MILESTONES.by+'T12:00:00')-new Date(today()+'T12:00:00'))/864e5); return d>1?d+' days left':d===1?'1 day left':d===0?'due today':'past due'; }
function milestonesHtml(){
  const M=MILESTONES.items, rows=PC().map(n=>({n,v:M.map(m=>m.val(n))})), met=([a,b])=>b>0&&a>=b, late=today()>MILESTONES.by;
  return `<div class="editor" style="margin-top:12px"><h2>Milestones · ${esc(dueText(MILESTONES.by))}</h2>
    <div class="status">${M.map((m,i)=>`${esc(m.label)}: <b>${rows.filter(r=>met(r.v[i])).length} of ${rows.length}</b> done`).join(' · ')} · ${msLeft()}</div>
    <div style="overflow-x:auto"><table class="lb"><tr><th>Pledge</th>${M.map(m=>`<th class="n">${esc(m.label)}</th>`).join('')}<th class="n">Both</th></tr>
    ${rows.map(r=>`<tr><td>${esc(first(r.n))}${r.n===me?' <b>(you)</b>':''}</td>${r.v.map(v=>{ const pc=pace(v[0],v[1],MILESTONES.by); return `<td class="n${met(v)?' hit':late?' miss':''}">${v[0]}/${v[1]}<small class="pc ${pc.ok?'ok':'bad'}">exp ${pc.exp}</small></td>`; }).join('')}<td class="n${r.v.every(met)?' hit':''}">${r.v.every(met)?'✓':'—'}</td></tr>`).join('')}</table></div>
    <div class="status">"exp" = where you should be by today. ${M.map(m=>`${esc(m.label)} = ${esc(m.how)}`).join('. ')}.</div></div>`;
}
function myMilestonesHtml(){
  // one goals card: your progress + pace on each of this week's goals, with the class count beside it
  if(!me) return ''; const M=MILESTONES.items, pc=PC(), I=informals(), c=I&&I[me], all=sigCards(), signed=all.filter(x=>sigOf(x).status==='signed').length;
  const row=(label,a,b,by,extra,cls)=>{ const p=pace(a,b,by); return `<div class="ms"><div><b>${esc(label)}</b><span>${a}/${b}</span></div><div class="bar"><i style="width:${b?Math.min(100,Math.round(100*a/b)):0}%"></i></div><div class="status" style="margin-top:2px">${paceTag(p)} · on pace = ${p.exp} by today${extra?' · '+extra:''}${cls?` · class: ${cls}`:''}</div></div>`; };
  const there=m=>pc.filter(n=>{ const [a,b]=m.val(n); return b>0&&a>=b; }).length;
  return `<div class="editor"><h2>This week's goals <small class="status">${esc(dueText(MILESTONES.by))} · ${msLeft()}</small></h2>
    ${c?row(`Informals`,c.done,c.target,INFORMALS.by,`${c.confirmed} confirmed`,`${pc.filter(n=>I[n].done>=I[n].target).length} of ${pc.length} there`):''}
    ${M.map(m=>{ const [a,b]=m.val(me); return row(m.label,a,b,MILESTONES.by,'',`${there(m)} of ${pc.length} there`); }).join('')}
    ${all.length?`<div class="ms"><div><b>Sig tasks signed (class, ${SIG_TARGET.pct}% by ${esc(mdy(SIG_TARGET.by))})</b><span>${signed}/${all.length}</span></div><div class="bar"><i style="width:${Math.round(100*signed/all.length)}%"></i></div></div>`:''}</div>`;
}

// ---------- accountability ----------
const acctEl=document.getElementById('acct');
// ---------- grades: tasks completed + informals, school scale ----------
const LETTERS=[[97,'A+'],[93,'A'],[90,'A−'],[87,'B+'],[83,'B'],[80,'B−'],[77,'C+'],[73,'C'],[70,'C−'],[67,'D+'],[63,'D'],[60,'D−'],[20,'F'],[0,'F−']];
const letter = pct => LETTERS.find(([min])=>pct>=min)[1];
function gradeFor(n){
  // tasks: share done of everything due before today (tasks finished early count too); informals: Done vs where you should be today on pace, capped at 100%. Equal weight.
  const t0=today(), xs=S.tasks.filter(t=>isFor(t,n)&&!t.repeat&&(isDone(t,n)||(t.due&&t.due<t0))), td=xs.filter(t=>isDone(t,n)).length;
  const I=informals(), c=I&&I[n], parts=[];
  const tp=xs.length?td/xs.length:null; if(tp!==null) parts.push(tp);
  const ip=c?Math.min(1,c.done/Math.max(1,pace(c.done,c.target,INFORMALS.by).exp)):null; if(ip!==null) parts.push(ip);
  if(!parts.length) return null;
  const pct=Math.round(100*parts.reduce((a,b)=>a+b,0)/parts.length);
  const up=S.tasks.filter(t=>isFor(t,n)&&!t.repeat&&!isDone(t,n)&&!(t.due&&t.due<t0)).length;
  return {pct, letter:letter(pct), tasks:[td,xs.length], up, inf:c?[c.done,c.target]:null};
}
function gradesHtml(){
  const rows=PC().map(n=>[n,gradeFor(n)]).sort((a,b)=>(b[1]?b[1].pct:-1)-(a[1]?a[1].pct:-1)||a[0].localeCompare(b[0]));
  return `<div class="editor" style="margin-top:12px"><h2>Grades</h2>
    <div class="status">Half tasks done (of what's due so far), half informals vs pace (target 25, Ali 30, by 10/11; pace = where you should be by today). ${informals()?esc(informalsUpdated())+'.':'Informals not synced yet, so tasks only.'}</div>
    <div style="overflow-x:auto"><table class="lb grades"><tr><th>Pledge</th><th class="n">Tasks</th><th class="n">Informals</th><th class="n">Grade</th></tr>
    ${rows.map(([n,g])=>`<tr><td>${esc(first(n))}${n===me?' <b>(you)</b>':''}</td><td class="n">${g&&g.tasks[1]?g.tasks[0]+'/'+g.tasks[1]+' due':'none due'}${g&&g.up?`<small style="display:block;color:var(--ink2);font-size:12px">${g.up} upcoming</small>`:''}</td><td class="n">${g&&g.inf?`${g.inf[0]}/${g.inf[1]}<small style="display:block;color:var(--ink2);font-size:12px">pace: ${pace(g.inf[0],g.inf[1],INFORMALS.by).exp} by today</small>`:'—'}</td><td class="n grade${g&&g.pct>=90?' hit':''}">${g?`${g.letter}<small style="display:block;color:var(--ink2);font-size:12px;font-weight:400">${g.pct}%</small>`:'—'}</td></tr>`).join('')}</table></div></div>`;
}

function renderAcct(){
  const pc=PC(); const total=S.cards.length;
  const solidOf=n=>Object.values(S.drill[n]||{}).filter(x=>x.last==='ok'&&(x.streak||0)>=2).length;
  const rows=pc.map(n=>{
    const solid=solidOf(n);
    const spell=ROLLS.map(r=>rollBest(n,r.cls));
    const mine=S.tasks.filter(t=>isFor(t,n)), done=mine.filter(t=>isDone(t,n)).length;
    const hits=(solid>=total?1:0)+spell.filter(b=>b===100).length+(mine.length&&done===mine.length?1:0);
    return {n,solid,spell,done,assigned:mine.length,hits};
  }).sort((a,b)=>b.hits-a.hits||b.solid-a.solid);
  const pctCell=b=>`<td class="n${b===100?' hit':''}">${b===null?'—':b+'%'}</td>`;
  acctEl.innerHTML=gradesHtml()+milestonesHtml()+`<details class="ogd more" style="margin-top:12px"><summary><h3 class="sec">More detail <small>informals, faces, spell</small></h3></summary>`+informalsHtml()+`<div class="editor" style="margin-top:12px"><h2>Where everyone stands</h2>
    <div class="status">Green = done. Faces = flashcards you knew twice in a row. Spell = best score per roll.</div>
    <div style="overflow-x:auto"><table class="lb"><tr><th>Pledge</th><th class="n">Faces</th>${ROLLS.map(r=>`<th class="n">${esc(r.cls.replace('Beta ',''))}</th>`).join('')}<th class="n">Quiz Q1–19</th></tr>
    ${rows.map(r=>`<tr><td>${esc(r.n.split(' ')[0])}${r.n===me?' <b>(you)</b>':''}</td><td class="n${r.solid>=total?' hit':''}">${r.solid}/${total}</td>${r.spell.map(pctCell).join('')}${(()=>{ const [a,b]=officialQuiz(r.n); return `<td class="n${b&&a===b?' hit':''}">${b?a+'/'+b:'—'}</td>`; })()}</tr>`).join('')}</table></div></div></details>
`;
}

// ---------- pledge guide ----------
const guideEl=document.getElementById('guide');
let gq='';
function renderGuide(){
  const pages=S.guide||[]; const q=gq.trim().toLowerCase();
  const hl=t=>{ let s=esc(t); if(q){ const re=new RegExp('('+q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+')','ig'); s=s.replace(re,'<mark>$1</mark>'); } return s; };
  const list=pages.filter(p=>!q||(p.title+' '+p.body).toLowerCase().includes(q));
  guideEl.innerHTML=`<div class="field" style="margin-top:12px"><label>Search the pledge guide</label><input id="gq" placeholder="e.g. hazing, big brother, 1907" value="${esc(gq)}" autocomplete="off"></div>
    ${q?`<div class="count">${list.length} of ${pages.length} pages match</div>`:''}
    ${list.map(p=>`<div class="passage" id="g${p.order}" style="user-select:text"><h3 style="margin:0 0 8px;font-size:18px">${hl(p.title)}</h3>${p.body.split(/\n\n+/).map(par=>`<p style="margin:0 0 10px;white-space:pre-line">${hl(par)}</p>`).join('')}</div>`).join('')||'<div class="reveal" style="margin-top:12px">No matches.</div>'}`;
  const inp=guideEl.querySelector('#gq'); inp.addEventListener('input',()=>{ const pos=inp.selectionStart; gq=inp.value; renderGuide(); const n=guideEl.querySelector('#gq'); n.focus(); n.setSelectionRange(pos,pos); });
}

// ---------- DSP facts ----------
const factsEl=document.getElementById('facts');
function renderFacts(){
  factsEl.innerHTML=`<div class="factlist">${S.facts.length?S.facts.map((f,i)=>`<div class="fact"><b>${esc(f.q)}</b><div class="a hide" title="tap to reveal">${esc(f.a)}</div><div class="ctrl" style="margin-top:6px"><button class="small" data-e="${i}">Edit</button>${isPCP()?`<button class="small" data-d="${i}">Delete</button>`:''}</div></div>`).join(''):'<div class="reveal">No DSP facts yet. Add the ones the brothers give you.</div>'}</div>
  <div class="editor" id="fed"><h2>Add a fact</h2><div class="field"><label>Question / prompt</label><input id="fq" placeholder="e.g. DSP founding date"></div><div class="field"><label>Answer</label><textarea id="fa" placeholder="e.g. November 7, 1907, NYU"></textarea></div><div class="ctrl"><button class="btn primary" id="fadd">Save for everyone</button></div></div>`;
  factsEl.querySelectorAll('.a').forEach(a=>a.onclick=()=>a.classList.toggle('hide'));
  factsEl.querySelector('#fadd').onclick=async()=>{ const q=factsEl.querySelector('#fq').value.trim(), a=factsEl.querySelector('#fa').value.trim(); if(!q||!a) return; const ok=await commit({who:me,at:when(),card:'DSP facts',changes:[{field:q,from:'',to:a}]},st=>st.facts.push({q,a})); if(ok) renderFacts(); };
  factsEl.querySelectorAll('[data-d]').forEach(b=>b.onclick=async()=>{ const i=+b.dataset.d, f=S.facts[i]; if(!confirm('Delete "'+f.q+'"?')) return; const ok=await commit({who:me,at:when(),card:'DSP facts',changes:[{field:f.q,from:f.a,to:'(deleted)'}]},st=>st.facts.splice(i,1)); if(ok) renderFacts(); });
  factsEl.querySelectorAll('[data-e]').forEach(b=>b.onclick=()=>{ const i=+b.dataset.e, f=S.facts[i]; const q=prompt('Question',f.q); if(q===null) return; const a=prompt('Answer',f.a); if(a===null) return; if(q===f.q&&a===f.a) return; commit({who:me,at:when(),card:'DSP facts',changes:[{field:q,from:f.a,to:a}]},st=>{st.facts[i]={q,a};}).then(ok=>{ if(ok) renderFacts(); }); });
}

// ---------- suggestions: anyone posts an idea for the site; the PCP marks it done ----------
const ideasEl=document.getElementById('ideas');
let ideaDraft='', ideasDoneOpen=false;
function renderIdeas(){
  const L=S.suggestions||[], open=L.filter(x=>!x.done), done=L.filter(x=>x.done), pcp=isPCP();
  const row=x=>`<li data-k="${esc(x._k)}"><span>${esc(x.text)} <small class="status">· ${esc(first(x.who||''))}, ${esc(fmt(x.at))}</small></span><span class="iact">${pcp&&!x.done?'<button class="small" data-idone>Done</button>':''}${pcp||x.who===me?'<button class="x" data-idel aria-label="Remove">×</button>':''}</span></li>`;
  ideasEl.innerHTML=`<div class="editor" style="margin-top:12px"><h2>Suggestions</h2>
    <div class="field"><textarea id="itext" rows="3" placeholder="Something confusing, missing or annoying on the site? Say it here.">${esc(ideaDraft)}</textarea></div>
    <div class="ctrl"><button class="btn primary" id="isend">Send</button></div></div>
    ${open.length?`<ul class="goals ideas">${open.map(row).join('')}</ul>`:'<div class="status" style="margin-top:10px">No open suggestions.</div>'}
    ${done.length?`<details class="ogd" ${ideasDoneOpen?'open':''}><summary><h3 class="sec">Done <small>${done.length}</small></h3></summary><ul class="goals ideas">${done.map(row).join('')}</ul></details>`:''}`;
  const t=ideasEl.querySelector('#itext'); t.oninput=()=>{ ideaDraft=t.value; };
  const dd=ideasEl.querySelector('details'); if(dd) dd.ontoggle=()=>{ ideasDoneOpen=dd.open; };
  ideasEl.querySelector('#isend').onclick=async e=>{ if(!me){ askName(); return; } const text=t.value.trim(); if(!text){ t.focus(); return; } e.target.disabled=true;
    try{ await dbWrite('POST','suggestions',{who:me,text,at:when()}); ideaDraft=''; await refresh(); toast('Sent. Thanks!'); }catch(err){ toast('Send failed: '+(err.message||err)); e.target.disabled=false; return; } renderIdeas(); };
  const K=b=>L.find(x=>x._k===b.closest('[data-k]').dataset.k);
  ideasEl.querySelectorAll('[data-idone]').forEach(b=>b.onclick=async()=>{ const x=K(b); if(!x||!pcp) return; b.disabled=true; try{ await dbWrite('PATCH','suggestions/'+key(x._k),{done:when()}); await refresh(); }catch(e){ toast('Save failed'); } render(); });
  ideasEl.querySelectorAll('[data-idel]').forEach(b=>b.onclick=async()=>{ const x=K(b); if(!x||!(pcp||x.who===me)) return; b.disabled=true; try{ await dbWrite('DELETE','suggestions/'+key(x._k)); await refresh(); }catch(e){ toast('Remove failed'); } render(); });
}

// ---------- log ----------
const logEl=document.getElementById('log');
function renderLog(){
  logEl.innerHTML=`<div class="log">${S.log.length?S.log.map(e=>`<div class="entry"><div class="top"><span><b>${esc(e.who)}</b> · <b>${esc(e.card)}</b></span><span>${fmt(e.at)}</span></div>${e.changes.map(ch=>`<div class="diff"><span style="font-weight:600">${esc(ch.field)}</span>${ch.from?`<span class="from">${esc(ch.from)}</span>`:''}<span class="to">${esc(ch.to)||'(cleared)'}</span></div>`).join('')}</div>`).join(''):'<div class="reveal">No edits yet.</div>'}</div>`;
}

// ---------- today ----------
const todayEl=document.getElementById('today');
const folds={};
// the "week" runs from one meeting to the next: meetings are tasks titled "Meeting #n" (8:30 PM unless the task has a time); no upcoming meeting -> Sunday 11:59 PM
const MEETING_RE=/^Meeting #(\d+)/;
const localTs = (iso, hm) => new Date(iso+'T'+(hm||'20:30')+':00').getTime();
const meetings = () => S.tasks.filter(t=>t.due&&MEETING_RE.test(t.title||'')).map(t=>({n:+t.title.match(MEETING_RE)[1], due:t.due, ts:localTs(t.due,t.time||'20:30')})).sort((a,b)=>a.ts-b.ts);
const shortDay = iso => new Date(iso+'T12:00:00').toLocaleDateString('en-US',{weekday:'short'})+' '+mdy(iso);
function periodAt(ts){
  ts=ts||Date.now(); const M=meetings(), nx=M.find(m=>m.ts>ts), pv=M.filter(m=>m.ts<=ts).pop();
  let end; if(nx) end=nx.ts; else { const d=isoDay(ts); end=localTs(addDays(d,(7-dow(d))%7),'23:59'); if(end<=ts) end=localTs(addDays(d,((7-dow(d))%7)+7),'23:59'); }
  const start=pv?pv.ts:end-7*864e5;
  return mkPeriod(start, end, nx);
}
function prevPeriod(P){ const pv=meetings().filter(m=>m.ts<P.start).pop(); return mkPeriod(pv?pv.ts:P.start-7*864e5, P.start, null); }
function mkPeriod(start, end, nx){
  return {start, end, startDay:isoDay(start), endDay:isoDay(end), label: nx?`Resets after Meeting #${nx.n} · ${shortDay(nx.due)}`:`Resets ${shortDay(isoDay(end))}, 11:59 PM`};
}
const doneDay = (t,n) => { const x=(t.done||{})[n]; return x?isoDay(x):null; };
function planFor(n, base){
  // day-by-day plan computed from tasks: dated on their date, overdue under catch up; undated tasks are ongoing and sit in their own list
  base=base||today(); const days={}, catchup=[], ongoing=[], put=(d,t)=>(days[d]=days[d]||[]).push(t);
  for(const t of S.tasks.filter(t=>isFor(t,n))){ const dd=doneDay(t,n);
    if(t.repeat==='daily'){ for(let d=base, end=periodAt().endDay; d<=end; d=addDays(d,1)) put(d,t); continue; }
    if(!t.due){ if(!dd||dd===base) ongoing.push(t); }
    else if(t.due>=base) put(t.due,t); else if(!dd||dd===base) catchup.push(t); }
  return {catchup, ongoing, days:Object.keys(days).sort().map(d=>[d,days[d].sort((a,b)=>(a.time||'99:99')<(b.time||'99:99')?-1:1)])};
}
function weekStats(names, P){
  // this period (meeting to meeting): dated tasks still open and due by the next meeting, plus dated ones finished this period; ongoing tasks don't count
  P=P||periodAt(); let tot=0, done=0;
  for(const n of names) for(const t of S.tasks){ if(!isFor(t,n)||!t.due) continue; const x=(t.done||{})[n], dt=x?Date.parse(x):0; if(x&&dt<=P.start) continue; if(!x&&t.due>P.endDay) continue; tot++; if(x) done++; }
  return {tot, done, pct: tot?Math.round(100*done/tot):null};
}
function streakFor(n, base){
  // consecutive days (back from today, within this meeting period) where every task due that day was done by that day; days with nothing due are skipped
  base=base||today(); const from=periodAt().startDay; let s=0;
  for(let i=0;i<90;i++){ const d=addDays(base,-i); if(d<from) break; const planned=S.tasks.filter(t=>isFor(t,n)&&t.due===d); if(!planned.length) continue;
    if(planned.every(t=>{ const dd=doneDay(t,n); return dd&&dd<=d; })) s++; else if(i) break; }
  return s;
}
const ring = pct => { const C=2*Math.PI*26, p=pct===null?0:pct; return `<svg class="ring" viewBox="0 0 64 64" width="64" height="64" aria-hidden="true"><circle cx="32" cy="32" r="26" fill="none" stroke="var(--line)" stroke-width="7"/>${p?`<circle cx="32" cy="32" r="26" fill="none" stroke="var(--ink)" stroke-width="7" stroke-linecap="round" stroke-dasharray="${(C*p/100).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 32 32)"/>`:''}<text x="32" y="37" text-anchor="middle" font-size="15" font-weight="700" fill="var(--ink)">${pct===null?'—':pct+'%'}</text></svg>`; };
const BROTHERS=40;
const daysTo = (from, to) => Math.max(1, Math.round((new Date(to+'T12:00:00')-new Date(from+'T12:00:00'))/864e5)+1);
function informalGoal(n){
  // what's left to the target, spread over the days left until the next meeting (today included)
  const I=informals(), c=I&&I[n]; if(!c) return null; const P=periodAt(), left=Math.max(0,c.target-c.done), days=daysTo(today(),P.endDay);
  return {per:Math.ceil(left/days), left, done:c.done, target:c.target, toEmail:Math.max(0,BROTHERS-c.done-c.confirmed-c.emailed), days};
}
function countGoal(t, n){
  // tasks with a numeric target: split what's left evenly over the days until the due date
  if(!t.target||!t.due||t.due<today()) return null; const p=+((t.prog||{})[n])||0, left=Math.max(0,+t.target-p);
  return {per:Math.ceil(left/daysTo(today(),t.due)), left, prog:p, target:+t.target};
}
const countText = g => g ? (g.left?` · do ${g.per} today (${g.prog}/${g.target})`:` · ${g.prog}/${g.target} done`) : '';
const checkRow = (t,n,late,day) => { const rep=t.repeat==='daily', d=day||today(), dn=rep?doneOn(t,n,d):isDone(t,n); return `<div class="task" data-id="${esc(t.id)}"><div class="t"><label class="ck"><input type="checkbox" data-tog ${dn?'checked':''} ${rep&&d!==today()?'disabled':''} aria-label="Mark done"></label><span class="ttl">${esc(t.title)}</span><span class="due ${late?'late':''}">${rep?esc(repText(t))+(autoDone(t,n,d)?' · done via quiz':''):esc(dueText(t.due))+(t.time?' · '+timeText(t.time):'')}${esc(countText(countGoal(t,n)))}${t.due&&examOn(n,t.due).length?'<br>exam that day':''}</span></div></div>`; };
function renderToday(){
  if(!me){ todayEl.innerHTML=`<div class="editor"><h2>Hi there</h2><div class="status">Pick your name to see your plan.</div><div class="ctrl"><button class="btn primary" id="tpick">Pick your name</button></div></div>`+weeklyHtml(); todayEl.querySelector('#tpick').onclick=askName; return; }
  const t0=today(), t1=addDays(t0,1), plan=planFor(me,t0), P=periodAt(), wk=weekStats([me],P);
  const now=S.tasks.filter(t=>isFor(t,me)&&!isDone(t,me)&&t.due&&t.due<=t0).length;
  const ig=informalGoal(me), dm=new Map(plan.days); if(ig) for(let d=t0; d<=P.endDay; d=addDays(d,1)) if(!dm.has(d)) dm.set(d,[]);
  const days=[...dm.entries()].sort((a,b)=>a[0]<b[0]?-1:1);
  const dayName = d => d===t0?'Today':d===t1?'Tomorrow':dayLabel(d);
  const P2=P.endDay, real=days.filter(([d,ts])=>d===t0||ts.some(t=>t.repeat!=='daily')), near=real.filter(([d])=>d<=t1), week=real.filter(([d])=>d>t1&&d<=P2), later=real.filter(([d])=>d>P2);
  const daySec=([d,ts])=>{ const xs=ts.filter(t=>t.repeat!=='daily'||d===t0); return `<h3 class="sec">${esc(dayName(d))}${xs.length?` <small>${xs.filter(t=>isDone(t,me)).length} of ${xs.length} done</small>`:''}</h3>${ig&&d===t0?`<div class="infg">${ig.left?`Informals: do ${ig.per} today`:'Informals: target hit'} (${ig.done}/${ig.target})${ig.toEmail?` · ${ig.toEmail} brothers not emailed yet`:''}</div>`:''}${xs.map(t=>checkRow(t,me,false,d)).join('')||(d===t0?'<div class="status">Nothing else due today.</div>':'')}`; };
  const fold=(id,label,list)=>{ const n=list.reduce((k,[d,ts])=>k+ts.filter(t=>t.repeat!=='daily').length,0); return n?`<details class="ogd" data-fold="${id}" ${folds[id]?'open':''}><summary><h3 class="sec">${label} <small>${n}</small></h3></summary>${list.map(daySec).join('')}</details>`:''; };
  const sigN=sigCards().filter(c=>['confirmed','done'].includes(sigOf(c).status)).length;
  todayEl.innerHTML=`<h2 class="hi">Hi ${esc(first(me))}</h2>
    <div class="meter">${ring(wk.pct)}<div><b>${now?`${now} due today or overdue`:'Nothing due today'}</b><div class="status" style="margin:0">This week: ${wk.done} of ${wk.tot} done</div><div class="status" style="margin:2px 0 0">${esc(P.label)}</div></div></div>
    ${recapRepliesHtml()}
    ${plan.catchup.length?`<h3 class="sec late">Catch up <small>${plan.catchup.filter(t=>isDone(t,me)).length} of ${plan.catchup.length} done</small></h3>${plan.catchup.map(t=>checkRow(t,me,true)).join('')}`:''}
    ${near.length?near.map(daySec).join(''):`<h3 class="sec">Today</h3><div class="status">Nothing due. <button class="small" id="tstudy">Study</button></div>`}
    ${fold('week','Rest of this week',week)}${fold('later','Later',later)}
    ${plan.ongoing.length?`<details class="ogd" data-fold="ongoing" ${folds.ongoing?'open':''}><summary><h3 class="sec">Ongoing <small>${plan.ongoing.length}</small></h3></summary>${plan.ongoing.map(t=>checkRow(t,me,false)).join('')}</details>`:''}
    ${examsTomorrowHtml()}
    ${myMilestonesHtml()}
    ${weeklyHtml()}
    ${sigN?`<div class="status" style="margin-top:12px">${sigN} sig tasks in progress · <button class="small" id="allsigs">Sig tasks</button></div>`:''}`;
  todayEl.querySelectorAll('details[data-fold]').forEach(d=>d.ontoggle=()=>{ folds[d.dataset.fold]=d.open; });
  const sb=todayEl.querySelector('#tstudy'); if(sb) sb.onclick=()=>setMode(lastStudy);
  const as=todayEl.querySelector('#allsigs'); if(as) as.onclick=()=>setMode('sigs');
  bindTasks(todayEl, renderToday); bindSig(todayEl, renderToday); bindCommitments(todayEl, renderToday);
}

function weeklyHtml(){
  const I=informals(), t0=today(), pc=PC(), all=sigCards(), signed=all.filter(c=>sigOf(c).status==='signed').length;
  const scale=I?Math.max(...pc.map(n=>Math.max(I[n].done,I[n].target))):1;
  const bars=I?pc.map(n=>{ const c=I[n]; return `<div class="hb"><span class="hl">${esc(first(n))}</span><div class="ht"><i style="width:${(100*c.done/scale).toFixed(1)}%"></i><b style="left:${(100*c.target/scale).toFixed(1)}%" title="Target ${c.target}"></b></div><span class="hv${c.done>=c.target?' ok':''}">${c.done}/${c.target}${(g=>g&&g.left?`<small> · ${g.per}/day</small>`:'')(informalGoal(n))}</span></div>`; }).join('')
    :'<div class="status">Informal counts sync from the tracker every night at 10 PM. Not synced yet.</div>';
  const atInf=I?pc.filter(n=>I[n].done>=I[n].target).length:0, ms=MILESTONES.items.map(m=>[m, pc.filter(n=>{ const [a,b]=m.val(n); return b>0&&a>=b; }).length]);
  const goals=[[`${INFORMALS.target} informals each (${Object.entries(INFORMALS.targets).map(([n,v])=>esc(first(n))+' '+v).join(', ')}) by ${mdy(INFORMALS.by)}`, I?`${atInf} of ${pc.length} there`:'not synced yet'],
    [`${SIG_TARGET.pct}% of sig tasks signed by ${mdy(SIG_TARGET.by)}`, all.length?`${signed} of ${all.length} signed`:'none tracked yet']].concat(ms.map(([m,k])=>[`${m.label} by ${mdy(MILESTONES.by)}`, `${k} of ${pc.length} there`]));
  const P=periodAt();
  return `<div class="editor weekly"><h2>Weekly progress</h2><div class="status" style="margin-top:-6px">${esc(P.label)}</div>
    ${I?`<div class="status" style="margin:0 0 8px">${esc(informalsUpdated())} · line = target</div>`:''}${bars}
    ${me?'':`<h3 class="wh">This week's goals</h3><ul class="goals">${goals.map(([g,v])=>`<li><span>${g}</span><b>${esc(v)}</b></li>`).join('')}</ul>`}</div>`;
}

// ---------- PCP dashboard: every pledge's open tasks, copyable ----------
const dashEl=document.getElementById('dash');
function openTasksOf(n){
  // everything assigned to n (incl. whole-class) not yet checked by n, grouped by due day; undated last as Ongoing
  const t0=today(), xs=S.tasks.filter(t=>isFor(t,n)&&!isDone(t,n)).sort((a,b)=>((a.due||'9999')+(a.time||'99:99'))<((b.due||'9999')+(b.time||'99:99'))?-1:1), g=[];
  for(const t of xs){ const k=t.repeat?'Every day':!t.due?'Ongoing':t.due<t0?'Overdue':t.due===t0?'Today':t.due===addDays(t0,1)?'Tomorrow':shortDay(t.due); const l=g[g.length-1]; if(l&&l[0]===k) l[1].push(t); else g.push([k,[t]]); }
  return g;
}
const dueBit = t => t.repeat ? repText(t).toLowerCase() : !t.due ? 'ongoing' : (t.due<today()?'overdue, due ':'due ')+shortDay(t.due)+(t.time?', '+timeText(t.time):'');
function dashText(r){ const g=openTasksOf(r.name); return `#${r.n} ${first(r.name)} — tasks\n`+(g.length?g.flatMap(([,ts])=>ts).map(t=>`• ${t.title} (${dueBit(t)})`).join('\n'):'• Nothing open'); }
async function copyText(txt){
  try{ await navigator.clipboard.writeText(txt); }catch(e){ const ta=document.createElement('textarea'); ta.value=txt; ta.style.position='fixed'; ta.style.opacity='0'; document.body.appendChild(ta); ta.select(); try{ document.execCommand('copy'); }catch(x){} ta.remove(); }
  toast('Copied');
}
function editsHtml(P){
  return `<div class="editor edits"><h2>Edits to review <small class="status">${P.length?P.length+' pending':'none pending'}</small></h2>
    ${P.map(p=>{ const e=p.entry||{}; return `<div class="pend"><div class="ptop"><b>${esc(first(p.who||'?'))}</b> · ${esc(e.card||'Edit')} <span class="status" style="margin:0">${esc(fmt(p.at))}</span></div>
      ${(e.changes||[]).map(c=>`<div class="pchg"><b>${esc(c.field)}</b><span class="from">${esc(c.from||'(empty)')}</span> → <span class="to">${esc(c.to||'(cleared)')}</span></div>`).join('')||'<div class="status">'+(p.ops||[]).length+' change(s)</div>'}
      <div class="ctrl"><button class="btn" data-pend="${esc(p._k)}" data-ok="0">Reject</button><button class="btn ok" data-pend="${esc(p._k)}" data-ok="1">Approve</button></div></div>`; }).join('')}</div>`;
}
function renderDash(){
  const R=SEED.roster||[], I=informals(), P=periodAt();
  const PEND=S.pending||[];
  dashEl.innerHTML=`${editsHtml(PEND)}<div class="ctrl" style="align-items:center"><button class="btn primary" id="dcopyall">Copy all</button></div>
    <div class="status">${esc(P.label)}</div>
    <div class="dash">${R.map(r=>{ const c=I&&I[r.name], w=weekStats([r.name],P), g=openTasksOf(r.name), open=g.reduce((a,[,ts])=>a+ts.length,0);
      return `<div class="dcard" data-n="${r.n}"><div class="dtop"><b>#${r.n} ${esc(r.name)}</b><button class="small" data-dcopy="${r.n}">Copy tasks</button></div>
        <div class="dstat">${c?`Informals: <b>${c.done}/${c.target}</b> done · ${c.confirmed} confirmed · ${c.emailed} emailed`:'Informals: not synced yet'}<br>Yesterday's quiz: ${quizOn(r.name,addDays(today(),-1))?'<b>done</b>':'<b class="miss">missed</b>'} · today: ${quizOn(r.name,today())?'<b>done</b>':'not yet'}<br>This week: <b>${w.done}</b> done · <b>${w.tot-w.done}</b> open</div>
        ${(()=>{ if(!g.length) return '<div class="dstat">Nothing open.</div>'; const grp=([k,ts])=>`<div class="dday${k==='Overdue'?' late':''}">${esc(k)}</div><ul>${ts.map(t=>`<li>${esc(t.title)}${t.due?` <span>· ${esc(shortDay(t.due))}${t.time?' · '+timeText(t.time):''}</span>`:''}</li>`).join('')}</ul>`, soon=g.filter(([k])=>/^(overdue|today|tomorrow)$/i.test(k)), rest=g.filter(([k])=>!/^(overdue|today|tomorrow)$/i.test(k)), rn=rest.reduce((a,[,ts])=>a+ts.length,0);
          return soon.map(grp).join('')+(rn?`<details><summary class="dday">Later · ${rn} open</summary>${rest.map(grp).join('')}</details>`:''); })()}</div>`; }).join('')}</div>`;
  dashEl.querySelectorAll('[data-pend]').forEach(b=>b.onclick=async()=>{ const pe=PEND.find(x=>x._k===b.dataset.pend); if(!pe) return; dashEl.querySelectorAll('[data-pend]').forEach(x=>x.disabled=true); await decidePending(pe, b.dataset.ok==='1'); renderDash(); });
  dashEl.querySelector('#dcopyall').onclick=()=>copyText(R.map(dashText).join('\n\n'));
  dashEl.querySelectorAll('[data-dcopy]').forEach(b=>b.onclick=()=>copyText(dashText(R.find(r=>r.n===+b.dataset.dcopy))));
}

// ---------- quizzes (question bank in Firebase `quiz`, attempts in recitals as quiz:set:item) ----------
const quizEl=document.getElementById('quizzes');
const byOrder=(a,b)=>(a.order??0)-(b.order??0);
const qSets = () => Object.entries((S.quiz&&S.quiz.sets)||{}).map(([id,x])=>Object.assign({id},x)).sort(byOrder).concat(funSet()||[]);
// Fun facts: built live from the "Fun facts:" bullets in brothers' card notes (not stored in `quiz`, so not editable here; edit the card instead)
const strHash = t => { let h=0; for(const ch of t) h=(h*31+ch.charCodeAt(0))|0; return (h>>>0).toString(36); };
function funSet(){
  const items={}; let o=0;
  (S.cards||[]).forEach(c=>{ const nt=String(c.notes||''), m=nt.match(/Fun facts?:\s*([\s\S]*)$/i); if(!m||!c.name) return;
    const lines=/^\s*•/m.test(m[1])?m[1].split('\n').filter(l=>/^\s*•/.test(l)):[m[1]];
    const fn=c.name.split(' ')[0].toLowerCase();
    lines.forEach(l=>{ const f=l.replace(/^\s*•\s*/,'').replace(/\s*\((tracker|email|tracker, email|email, tracker)\)\s*$/i,'').trim(); if(f.length<8||f.toLowerCase().includes(fn)) return;
      items[(c.photo||key(c.name))+'-'+strHash(f)]={q:`Which brother? "${f}"`, a:c.name, alt:c.full&&c.full!==c.name?[c.full]:[], order:o++}; }); });
  return o?{id:'funfacts', title:'Fun facts', virtual:true, order:999, note:'From the brothers\' cards', items}:null;
}
const qFilled = set => Object.entries(set.items||{}).map(([id,x])=>Object.assign({id},x)).filter(x=>String(x.a||'').trim()).sort(byOrder);
function qItems(set){
  // "both" sets (e.g. executive board) are asked both ways
  const xs=qFilled(set); if(!set.both) return xs.map(x=>({id:x.id,q:x.q,a:x.a,alt:x.alt||[],anyOrder:!!x.anyOrder}));
  return xs.flatMap(x=>[{id:x.id,q:`Who is the ${x.q}?`,a:x.a,alt:x.alt||[]},{id:x.id+'~r',q:`What position does ${x.a} hold?`,a:x.q,alt:[x.q.replace(/^Beta Nu /,'')]}]);
}
const qBest = (n,setId,itemId) => { const rs=S.recitals.filter(r=>r.who===n&&r.passage===`quiz:${setId}:${itemId}`); return rs.length?Math.max(...rs.map(r=>r.pct)):null; };
function qScore(n,set){ const xs=qItems(set); if(!xs.length) return null; const b=xs.map(x=>qBest(n,set.id,x.id)||0); return {pct:Math.round(b.reduce((s,v)=>s+v,0)/xs.length), mastered:b.every(v=>v===100), perfect:b.filter(v=>v===100).length, total:xs.length}; }
function anyOrderGrade(ans, typed){
  // items listed in the answer (comma-separated) can come in any order; each must be spelled right. Case and spacing don't matter.
  const parts=ans.split(/\s*[,;]\s*|\s+and\s+/i).filter(Boolean), T=qtoks(typed).map(w=>qkey(w,false)).filter(w=>/[\p{L}\p{N}]/u.test(w)&&w!=='and'), used=new Array(T.length).fill(false);
  const hits=parts.map(pt=>{ const P=qtoks(pt).map(w=>qkey(w,false)).filter(w=>/[\p{L}\p{N}]/u.test(w)); for(let i=0;i+P.length<=T.length;i++){ if(P.every((w,j)=>!used[i+j]&&T[i+j]===w)){ P.forEach((_,j)=>used[i+j]=true); return true; } } return false; });
  const toks=qtoks(ans), ok=[]; let pi=0; for(const t of toks){ if(/^[,;]$/.test(t)){ ok.push(true); pi++; } else ok.push(hits[pi]); }
  const hit=hits.filter(Boolean).length, extras=used.filter(u=>!u).length;
  return {ok, hit, total:parts.length, extras, pct:Math.max(0,Math.floor(100*hit/parts.length-0.5*extras)), ans};
}
function qGrade(item, typed){ if(item.anyOrder) return anyOrderGrade(item.a, typed); let best=null; for(const ans of [item.a].concat(item.alt||[])){ const g=lcsGrade(qtoks(ans),qtoks(typed),false); g.ans=ans; if(!best||g.pct>best.pct) best=g; } return best; }
let qz={phase:'pick', mode:'order', set:null, run:[], i:0, res:{}, input:'', g:null, draft:null};
function qStart(set, mode){
  let xs=qItems(set); if(mode==='missed') xs=xs.filter(x=>(qBest(me,set.id,x.id)||0)<100); if(mode==='shuffle') xs=shuffle(xs.slice());
  if(!xs.length){ toast(mode==='missed'?'Nothing missed. Every question is at 100%.':'No questions in this set yet.'); return; }
  qz=Object.assign(qz,{phase:'ask', set:set.id, run:xs, i:0, res:{}, input:'', g:null}); renderQuizzes(); setTimeout(()=>{ const t=quizEl.querySelector('#qa'); if(t) t.focus(); },50);
}
const tokHtml = (toks, ok) => toks.map((w,i)=>`<span class="tk ${ok[i]?'ok':'miss'}">${esc(w)}</span>`).join(' ').replace(/ (<span class="tk [a-z]+">[,.;:!?)]<\/span>)/g,'$1');
function renderQuizzes(){
  const sets=qSets(), set=sets.find(x=>x.id===qz.set), pcp=isPCP();
  if(!S.quiz){ quizEl.innerHTML='<div class="reveal" style="margin-top:14px">The question bank isn\'t set up yet.</div>'; return; }
  if(qz.phase==='edit'&&set) return renderQuizEdit(set);
  if(qz.phase==='ask'||qz.phase==='checked'){
    const it=qz.run[qz.i], g=qz.g;
    quizEl.innerHTML=`<div class="ctrl" style="justify-content:space-between;align-items:center"><span class="status" style="margin:0">${esc(set.title)} · question ${qz.i+1} of ${qz.run.length}</span><button class="small" id="qback">Back to sets</button></div>
      <div class="editor"><h2 class="qq">${esc(it.q)}</h2>
        <div class="field"><textarea id="qa" rows="3" placeholder="Type the answer exactly. Capitals don't matter; spelling and punctuation do." ${qz.phase==='checked'?'readonly':''}>${esc(qz.input)}</textarea></div>
        ${qz.phase==='checked'?`<div class="big">${g.pct}%<small> · ${g.hit}/${g.total} · ${g.extras} extra</small></div><div class="passage" style="margin-top:6px">${tokHtml(qtoks(g.ans),g.ok)}</div><div class="legend"><span class="tk ok">green</span> matched <span class="tk miss">red</span> missed</div><div class="status" id="qlog">Saving…</div>`:''}
        <div class="ctrl"><button class="btn primary" id="qgo">${qz.phase==='checked'?(qz.i+1<qz.run.length?'Next':'Finish'):'Check'}</button></div></div>`;
    const ta=quizEl.querySelector('#qa'); ta.oninput=()=>{ qz.input=ta.value; };
    ta.onkeydown=e=>{ if(e.key==='Enter'&&(e.metaKey||e.ctrlKey)){ e.preventDefault(); quizEl.querySelector('#qgo').click(); } };
    quizEl.querySelector('#qback').onclick=()=>{ qz.phase='pick'; renderQuizzes(); };
    quizEl.querySelector('#qgo').onclick=async()=>{
      if(qz.phase==='ask'){ if(!qz.input.trim()){ ta.focus(); return; } if(!me){ askName(); return; }
        qz.g=qGrade(it, qz.input); qz.res[it.id]=qz.g.pct; qz.phase='checked'; renderQuizzes(); const pct=qz.g.pct;
        const ok=await commit(null, st=>{ st.recitals.unshift({who:me,at:when(),passage:`quiz:${set.id}:${it.id}`,pct}); });
        const l=quizEl.querySelector('#qlog'); if(l) l.textContent=ok?'Saved to your record.':'Not saved (see message).';
      } else if(qz.i+1<qz.run.length){ qz.i++; qz.input=''; qz.g=null; qz.phase='ask'; renderQuizzes(); quizEl.querySelector('#qa').focus(); }
      else { qz.phase='done'; renderQuizzes(); }
    };
    return;
  }
  if(qz.phase==='done'&&set){
    const vals=Object.values(qz.res), avg=vals.length?Math.round(vals.reduce((a,b)=>a+b,0)/vals.length):0, missed=vals.filter(v=>v<100).length;
    quizEl.innerHTML=`<div class="editor"><h2>${esc(set.title)}</h2><div class="big">${avg}%<small> average this run · ${missed} below 100%</small></div>
      <div class="ctrl">${missed?'<button class="btn primary" id="qmiss">Re-quiz missed</button>':''}<button class="btn" id="qsets">Back to sets</button></div></div>`;
    const qm=quizEl.querySelector('#qmiss'); if(qm) qm.onclick=()=>qStart(set,'missed');
    quizEl.querySelector('#qsets').onclick=()=>{ qz.phase='pick'; renderQuizzes(); };
    return;
  }
  qz.phase='pick';
  quizEl.innerHTML=`<div class="sub" style="margin-top:14px">${[['order','In order'],['shuffle','Shuffle'],['missed','Missed only']].map(([k,l])=>`<button data-qm="${k}" aria-pressed="${qz.mode===k}">${l}</button>`).join('')}</div>
    ${sets.map(x=>{ const sc=me&&qScore(me,x), n=qItems(x).length; return `<div class="qset" data-set="${esc(x.id)}"><div><b>${esc(x.title)}</b><small>${n?`${n} question${n===1?'':'s'}${sc?` · your score ${sc.pct}%${sc.mastered?' · Mastered':''}`:''}`:esc(x.note||'No questions yet.')}</small></div>${pcp&&!x.virtual?'<button class="small" data-qedit>Edit</button>':''}${n?'<button class="btn" data-qstart style="flex:0 0 auto">Start</button>':''}</div>`; }).join('')}
    <div class="qset"><div><b>Class rolls (Spell)</b><small>Type each class roll from memory</small></div><button class="btn" id="qspell" style="flex:0 0 auto">Start</button></div>
    <div class="status">Spelling and punctuation count; capitals don't.</div>`;
  quizEl.querySelectorAll('[data-qm]').forEach(b=>b.onclick=()=>{ qz.mode=b.dataset.qm; renderQuizzes(); });
  quizEl.querySelectorAll('[data-qstart]').forEach(b=>b.onclick=()=>qStart(sets.find(x=>x.id===b.closest('[data-set]').dataset.set), qz.mode));
  quizEl.querySelectorAll('[data-qedit]').forEach(b=>b.onclick=()=>{ const x=sets.find(y=>y.id===b.closest('[data-set]').dataset.set); qz.set=x.id; qz.draft=Object.entries(x.items||{}).map(([id,v])=>Object.assign({id},v)).sort(byOrder).map(v=>({id:v.id,q:v.q||'',a:v.a||'',alt:(v.alt||[]).join(' | '),any:!!v.anyOrder})); qz.phase='edit'; renderQuizzes(); });
  quizEl.querySelector('#qspell').onclick=()=>setMode('roll');
}
function renderQuizEdit(set){
  // PCP only: add, edit and reorder questions; saved through commit() and logged
  if(!isPCP()){ qz.phase='pick'; return renderQuizzes(); }
  const D=qz.draft;
  quizEl.innerHTML=`<div class="editor"><h2>Edit · ${esc(set.title)}</h2>${D.map((x,i)=>`<div class="qedit" data-i="${i}"><div class="ctrl" style="margin:0 0 4px;align-items:center"><b style="flex:1">${set.both?'':'Q'}${i+1}</b><button class="small" data-up ${i?'':'disabled'}>↑</button><button class="small" data-dn ${i<D.length-1?'':'disabled'}>↓</button><button class="small" data-rm>×</button></div>
      <div class="field"><label>${set.both?'Position':'Question'}</label><textarea data-k="q" rows="2">${esc(x.q)}</textarea></div>
      <div class="field"><label>${set.both?'Name':'Answer (leave empty to hide from quizzes)'}</label><textarea data-k="a" rows="2">${esc(x.a)}</textarea></div>
      <div class="field"><label>Also accept (separate with |)</label><input data-k="alt" value="${esc(x.alt)}"></div><label class="qany"><input type="checkbox" data-any ${x.any?"checked":""}> Any order (comma-separated items)</label></div>`).join('')}
    <div class="ctrl"><button class="small" id="qadd">+ Add question</button></div>
    <div class="ctrl"><button class="btn" id="qcancel">Cancel</button><button class="btn primary" id="qsave">Save for everyone</button></div></div>`;
  quizEl.querySelectorAll('.qedit').forEach(el=>{ const i=+el.dataset.i;
    el.querySelectorAll('[data-k]').forEach(f=>f.oninput=()=>{ D[i][f.dataset.k]=f.value; });
    el.querySelector('[data-any]').onchange=e=>{ D[i].any=e.target.checked; };
    el.querySelector('[data-up]').onclick=()=>{ [D[i-1],D[i]]=[D[i],D[i-1]]; renderQuizEdit(set); };
    el.querySelector('[data-dn]').onclick=()=>{ [D[i+1],D[i]]=[D[i],D[i+1]]; renderQuizEdit(set); };
    el.querySelector('[data-rm]').onclick=()=>{ if(D[i].q.trim()&&!confirm('Remove this question?')) return; D.splice(i,1); renderQuizEdit(set); }; });
  quizEl.querySelector('#qadd').onclick=()=>{ D.push({id:'i'+uid(),q:'',a:'',alt:''}); renderQuizEdit(set); const t=quizEl.querySelectorAll('.qedit textarea[data-k=q]'); t[t.length-1].focus(); };
  quizEl.querySelector('#qcancel').onclick=()=>{ qz.phase='pick'; renderQuizzes(); };
  quizEl.querySelector('#qsave').onclick=async()=>{
    const items={}, old=set.items||{}, ch=[];
    D.filter(x=>x.q.trim()).forEach((x,i)=>{ const alt=x.alt.split('|').map(v=>v.trim()).filter(Boolean); items[x.id]=Object.assign({q:x.q.trim(),a:x.a.trim(),order:i+1},alt.length?{alt}:{},x.any?{anyOrder:true}:{});
      const o=old[x.id]; if(!o) ch.push({field:'Added question',from:'',to:x.q.trim()}); else if(o.q!==items[x.id].q||(o.a||'')!==items[x.id].a||JSON.stringify(o.alt||[])!==JSON.stringify(alt)||!!o.anyOrder!==!!x.any) ch.push({field:x.q.trim(),from:o.a||'',to:items[x.id].a}); });
    for(const id of Object.keys(old)) if(!items[id]) ch.push({field:'Removed question',from:old[id].q,to:''});
    if(!ch.length&&JSON.stringify(Object.keys(old).sort((a,b)=>old[a].order-old[b].order))===JSON.stringify(Object.keys(items))){ qz.phase='pick'; return renderQuizzes(); }
    if(!ch.length) ch.push({field:'Reordered questions',from:'',to:D.length+' questions'});
    const ok=await commit({who:me,at:when(),card:'Quiz · '+set.title,changes:ch}, st=>{ st.quiz.sets[set.id].items=items; });
    if(ok){ qz.phase='pick'; renderQuizzes(); }
  };
}

// ---------- spell (roll call) ----------
const rollEl=document.getElementById('roll');
const ROLLS=(SEED.rolls||[]).slice().sort((a,b)=>clsRank(a.cls)-clsRank(b.cls));
let rIdx=0, rDraft={};
const nw = w => w.normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
const words = t => String(t||'').replace(/\*/g,'').split(/[\s\-]+/).filter(w=>nw(w));
const qtoks = t => String(t||'').match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*|[^\s\p{L}\p{N}]/gu)||[];
const qkey = (w, accents) => { w=String(w).replace(/[“”]/g,'"').replace(/[‘’]/g,"'"); if(accents) w=w.normalize('NFD').replace(/[\u0300-\u036f]/g,''); return w.toLowerCase(); };
function lcsGrade(E, T, accents){
  // order-aware LCS on tokens (words and punctuation); case-insensitive, everything else must match
  const a=E.map(w=>qkey(w,accents)), b=T.map(w=>qkey(w,accents)), m=a.length, n=b.length, dp=Array.from({length:m+1},()=>new Int32Array(n+1));
  for(let i=m-1;i>=0;i--) for(let j=n-1;j>=0;j--) dp[i][j]= a[i]===b[j] ? dp[i+1][j+1]+1 : Math.max(dp[i+1][j],dp[i][j+1]);
  const ok=new Array(m).fill(false); let i=0,j=0; while(i<m&&j<n){ if(a[i]===b[j]){ ok[i]=true; i++; j++; } else if(dp[i+1][j]>=dp[i][j+1]) i++; else j++; }
  const hit=ok.filter(Boolean).length, extras=n-hit;
  return {ok, hit, total:m, extras, pct:m?Math.max(0, Math.floor(100*hit/m - 0.5*extras)):0};
}
function rollWords(r){ return [['Class',[r.cls]],['VPPE',[r.vppe]],['Members',r.members]].map(([l,xs])=>[l,xs.map(x=>qtoks(x.replace(/\*/g,'')))]); }
function gradeRoll(r, typed){
  // Spell: not case-sensitive, accents optional, * ignored; spelling, punctuation and order all count
  return lcsGrade(rollWords(r).flatMap(([,ls])=>ls.flat()), qtoks(typed), true);
}
const rollBest = (n,cls) => { const rs=S.recitals.filter(x=>x.who===n&&x.passage==='roll:'+cls); return rs.length?Math.max(...rs.map(x=>x.pct)):null; };
function renderRoll(){
  const r=ROLLS[rIdx]; if(!r){ rollEl.innerHTML='<div class="reveal">No rolls loaded.</div>'; return; }
  const d=rDraft[r.cls]=rDraft[r.cls]||{c:'',v:'',m:''};
  rollEl.innerHTML=`<div class="ctrl" style="margin-top:10px"><button class="small" id="rback">← Quizzes</button></div><div class="chips">${ROLLS.map((x,i)=>{ const b=rollBest(me,x.cls); return `<button class="chip" data-ri="${i}" aria-pressed="${i===rIdx}">${esc(x.cls)}${b===null?'':' · '+b+'%'}</button>`; }).join('')}</div>
    <div class="editor"><h2>Spell the ${esc(r.cls)} roll</h2>
      <div class="field"><label>Class name</label><input id="rc" autocomplete="off" autocapitalize="words" value="${esc(d.c)}"></div>
      <div class="field"><label>VPPE</label><input id="rv" autocomplete="off" autocapitalize="words" value="${esc(d.v)}"></div>
      <div class="field"><label>Members (one per line, in order)</label><textarea id="rm" autocapitalize="words" style="min-height:220px">${esc(d.m)}</textarea></div>
      <div class="ctrl"><button class="btn primary" id="rcheck">Check it</button></div>
      <div class="status">Full official names, in order. Capitals and accents don't matter; spelling, punctuation and order do. Target: 100% on all four classes.</div></div>
    <div id="rres"></div><div id="rboard"></div>`;
  rollEl.querySelector('#rback').onclick=()=>setMode('quizzes');
  rollEl.querySelectorAll('[data-ri]').forEach(b=>b.onclick=()=>{ rIdx=+b.dataset.ri; renderRoll(); });
  for(const [id,k] of [['rc','c'],['rv','v'],['rm','m']]) rollEl.querySelector('#'+id).oninput=e=>{ d[k]=e.target.value; };
  rollEl.querySelector('#rcheck').onclick=async()=>{
    const typed=[d.c,d.v,d.m].join('\n'); if(!words(typed).length){ toast('Type the roll first.'); return; }
    const g=gradeRoll(r,typed); let k=0;
    const line=ws=>ws.map(w=>`<span class="tk ${g.ok[k++]?'ok':'miss'}">${esc(w)}</span>`).join(' ').replace(/ (<span class="tk [a-z]+">[,.;:!?)]<\/span>)/g,'$1');
    rollEl.querySelector('#rres').innerHTML=`<div class="reveal"><div class="big">${g.pct}%<small> · ${g.hit}/${g.total} words · ${g.extras} extra</small></div>
      <div class="passage" style="margin-top:8px">${rollWords(r).map(([l,ls])=>`<div><b style="font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--ink2)">${l}</b>${ls.map((ws,i)=>`<div>${l==='Members'?(i+1)+'. ':''}${line(ws)}</div>`).join('')}</div>`).join('')}</div>
      <div class="legend"><span class="tk ok">green</span> exact <span class="tk miss">red</span> missed</div>
      <div class="status" id="rlog">Logging this attempt…</div></div>`;
    const ok=await commit(null, st=>{ st.recitals.unshift({who:me,at:when(),passage:'roll:'+r.cls,pct:g.pct}); });
    const ls=rollEl.querySelector('#rlog'); if(ls) ls.textContent = ok ? 'Logged ('+g.pct+'%).' : 'Not logged (see message).';
    renderRollBoard(); rollEl.querySelectorAll('[data-ri]').forEach((b,i)=>{ const x=rollBest(me,ROLLS[i].cls); b.textContent=ROLLS[i].cls+(x===null?'':' · '+x+'%'); });
  };
  renderRollBoard();
}
function renderRollBoard(){
  const r=ROLLS[rIdx], id='roll:'+r.cls, mine=S.recitals.filter(x=>x.who===me&&x.passage===id), best=rollBest(me,r.cls);
  rollEl.querySelector('#rboard').innerHTML=`<div class="editor"><h2>Scoreboard · ${esc(r.cls)}</h2>${best!==null?`<div class="status">Your best: <b>${best}%</b> over ${mine.length} attempt${mine.length===1?'':'s'}</div>`:'<div class="status">No attempts yet. Every Check is logged.</div>'}
    <table class="lb"><tr><th>Pledge</th><th class="n">Best</th><th class="n">Attempts</th></tr>${PC().map(n=>{ const b=rollBest(n,r.cls); return `<tr><td>${esc(n)}</td><td class="n${b===100?' hit':''}">${b===null?'—':b+'%'}</td><td class="n">${S.recitals.filter(x=>x.who===n&&x.passage===id).length}</td></tr>`; }).join('')}</table></div>`;
}

// ---------- error safety net ----------
function showErr(msg){ try{ fetch(DB+'/errors.json',{method:'POST',body:JSON.stringify({msg:String(msg).slice(0,500),at:new Date().toISOString(),who:me,mode,view,ua:navigator.userAgent.slice(0,120),build:'2026-10-06z2'})}); }catch(e){} let b=document.getElementById('errbar'); if(!b){ b=document.createElement('div'); b.id='errbar'; b.style.cssText='position:fixed;left:0;right:0;bottom:0;z-index:70;background:#B23A3A;color:#fff;padding:10px 14px;font:600 13px "Public Sans",sans-serif;display:flex;gap:10px;align-items:center;justify-content:space-between'; document.body.appendChild(b); }
  b.innerHTML='<span style="flex:1;word-break:break-word">Something broke: '+esc(msg)+'</span><button onclick="location.reload()" style="border:0;background:#fff;color:#B23A3A;border-radius:8px;padding:6px 10px;font:600 13px \'Public Sans\',sans-serif;cursor:pointer">Reload</button><button onclick="document.getElementById(\'errbar\').remove()" style="border:0;background:transparent;color:#fff;font-size:18px;cursor:pointer">×</button>'; }
window.addEventListener('error', e=>{ showErr((e.message||'error')+' @'+(e.lineno||'?')); try{ render(); }catch(x){} });
window.addEventListener('unhandledrejection', e=>{ showErr('async: '+((e.reason&&e.reason.message)||e.reason||'error')); });

// ---------- render ----------
function render(){
  if(mode==='facts') mode='guide';
  if(!['today','learn','roll','quizzes','tasks','sigs','dash','guide','facts','ideas','acct','log'].includes(mode)) mode='today';
  const showChips = mode==='learn';
  chipsEl.hidden=!showChips;
  for(const id of ['today','learn','roll','quizzes','tasks','sigs','dash','guide','facts','ideas','acct','log']) document.getElementById(id).hidden = mode!==id;
  if(mode==='dash'&&!isPCP()){ mode='tasks'; lastTasks='tasks'; }
  const sg=document.querySelector('#infosub [data-m=ideas]'), openIdeas=(S.suggestions||[]).filter(x=>!x.done).length; sg.textContent='Suggestions'+(isPCP()&&openIdeas?` (${openIdeas})`:'');
  const db=document.querySelector('#tasksub [data-m=dash]'); db.hidden=!isPCP(); db.textContent='Dashboard'+(isPCP()&&(S.pending||[]).length?` (${S.pending.length})`:'');
  const tab=tabOf(mode);
  document.querySelectorAll('[role=tab]').forEach(t=>t.setAttribute('aria-selected', t.dataset.tab===tab));
  document.getElementById('studysub').hidden = tab!=='study'; document.getElementById('infosub').hidden = tab!=='info'; document.getElementById('tasksub').hidden = tab!=='tasks';
  document.querySelectorAll('#studysub [data-m],#infosub [data-m],#tasksub [data-m]').forEach(b=>b.setAttribute('aria-pressed', b.dataset.m===mode||(mode==='roll'&&b.dataset.m==='quizzes')));
  if(mode==='learn'){ renderCard(); renderDir(); }
  else if(mode==='today') renderToday();
  else if(mode==='roll') renderRoll();
  else if(mode==='quizzes') renderQuizzes();
  else if(mode==='acct') renderAcct();
  else if(mode==='tasks') renderTasks();
  else if(mode==='sigs') renderSigs();
  else if(mode==='dash') renderDash();
  else if(mode==='facts') renderFacts();
  else if(mode==='guide') renderGuide();
  else if(mode==='log') renderLog();
  else if(mode==='ideas') renderIdeas();
}
renderWho(); setStatus('Loading…');
Promise.all([loadPhotos(),refresh()]).then(()=>{ renderChips(); resetOrder(); render(); if(!me) setTimeout(askName, 300); loadSheets().then(()=>{ if(['today','acct','sigs'].includes(mode)) render(); }); });
setInterval(()=>{ const ae=document.activeElement, typing=ae&&(ae.tagName==='TEXTAREA'||(ae.tagName==='INPUT'&&ae.type!=='checkbox')); if(document.visibilityState==='visible' && !typing && !tEdit && !editing && !dirEdit && mode!=='learn' && mode!=='quiz') refresh().then(()=>{ order=order.map(c=>S.cards.find(x=>x.photo===c.photo)||c); if(['today','tasks','sigs','dash','acct','log','facts','guide','ideas'].includes(mode)) render(); }); loadSheets(); }, 30000);
