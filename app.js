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
  return { version:d.version||0, cards, log:objToArr(d.log).sort(byAtDesc), facts:objToArr(d.facts,'order'), tasks:objToArr(d.tasks).sort((a,b)=>(a.due||'9999')<(b.due||'9999')?-1:1), recitals:objToArr(d.recitals).sort(byAtDesc), guide:objToArr(d.guide,'order'), passages: d.passages? objToArr(d.passages,'order') : SEED.passages, drill:d.drill||{}, informals:d.informals||null, exams:d.exams||{}, quiz:d.quiz||null };
}
async function dbGet(path){ const r=await fetch(DB+'/'+path+'.json',{cache:'no-store'}); if(!r.ok) throw new Error('read '+r.status); return r.json(); }
async function dbWrite(method,path,body){ const r=await fetch(DB+'/'+path+'.json',{method,body:body===undefined?undefined:JSON.stringify(body)}); if(!r.ok) throw new Error('write '+r.status); return r.json(); }
const KEYS=['version','cards','log','facts','tasks','recitals','passages','drill','guide','informals','exams','quiz'];
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

async function commit(entry, mutate){
  if(!me){ askName(); return false; }
  const next = JSON.parse(JSON.stringify(S));
  mutate(next);
  try{
    const ops=[];
    // cards: PUT changed cards
    const before=Object.fromEntries(S.cards.map(c=>[c.photo,c]));
    next.cards.forEach((c,i)=>{ const b=before[c.photo]; const cc=Object.assign({},c); delete cc._k; if(!b||JSON.stringify(Object.assign({},b,{_k:undefined,order:undefined}))!==JSON.stringify(Object.assign({},cc,{order:undefined}))){ cc.order=i; ops.push(dbWrite('PUT','cards/'+key(c.photo),cc)); } });
    // tasks: PUT changed / DELETE removed
    const tb=Object.fromEntries(S.tasks.map(t=>[t.id,t])); const tn=Object.fromEntries(next.tasks.map(t=>[t.id,t]));
    for(const id of Object.keys(tn)){ const t=Object.assign({},tn[id]); delete t._k; if(JSON.stringify(tb[id]&&Object.assign({},tb[id],{_k:undefined}))!==JSON.stringify(t)) ops.push(dbWrite('PUT','tasks/'+key(id),t)); }
    for(const id of Object.keys(tb)) if(!tn[id]) ops.push(dbWrite('DELETE','tasks/'+key(id)));
    // facts: rewrite whole list (small)
    if(JSON.stringify(S.facts)!==JSON.stringify(next.facts)){ const o={}; next.facts.forEach((f,i)=>{ o[f._k||('f'+Date.now().toString(36)+i)]={q:f.q,a:f.a,order:i}; }); ops.push(dbWrite('PUT','facts',o)); }
    // passages
    if(JSON.stringify(S.passages)!==JSON.stringify(next.passages)){ const o={}; next.passages.forEach((p,i)=>{ o[p.id]={id:p.id,title:p.title,text:p.text,order:i}; }); ops.push(dbWrite('PUT','passages',o)); }
    // quiz bank (PCP edits): small, rewrite whole
    if(JSON.stringify(S.quiz||null)!==JSON.stringify(next.quiz||null)) ops.push(dbWrite('PUT','quiz',next.quiz));
    // drill: PATCH my subtree only
    if(JSON.stringify(S.drill[me]||{})!==JSON.stringify(next.drill[me]||{})) ops.push(dbWrite('PUT','drill/'+key(me),next.drill[me]||{}));
    // recitals: POST new ones (those without _k)
    for(const r of next.recitals) if(!r._k) ops.push(dbWrite('POST','recitals',r));
    if(entry) ops.push(dbWrite('POST','log',entry));
    ops.push(dbWrite('PUT','version',(S.version||0)+1));
    await Promise.all(ops);
    await refresh();
    toast('Saved for everyone'); return true;
  }catch(e){ toast('Save failed: '+(e.message||e)+'. Check your connection and try again.'); await refresh(); return false; }
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
const isDone = (t,n) => !!(t.done||{})[n];

// ---------- chips / tabs ----------
const chipsEl = document.getElementById('chips');
function renderChips(){
  const cls=[...new Set(S.cards.map(c=>c.cls))].sort((a,b)=>clsRank(a)-clsRank(b)||a.localeCompare(b));
  const items=[['all',`All ${S.cards.length}`],...cls.map(k=>[k,k]),['starred','★ Starred']];
  chipsEl.innerHTML = items.map(([k,l])=>`<button class="chip" data-f="${esc(k)}" aria-pressed="${filter===k}">${esc(l)}</button>`).join('');
}
chipsEl.addEventListener('click', e=>{ const b=e.target.closest('.chip'); if(!b) return; filter=b.dataset.f; renderChips(); saveDrill(); resetOrder(); render(); });
const STUDY=['learn','roll','quizzes'], INFO=['guide','facts','log'], TASKS=['tasks','sigs'];
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
document.getElementById('v-cards').onclick=()=>{ view='cards'; render(); };
document.getElementById('v-grid').onclick=()=>{ view='grid'; render(); };
document.getElementById('v-dir').onclick=()=>{ view='dir'; render(); setTimeout(()=>document.getElementById('dirq').focus(),50); };
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
  document.getElementById('fcprog').textContent = me ? `Solid ${solid}/${p.length} in this ${filter==='all'?'set':filter==='starred'?'starred set':'class'}${rc.r?` · last time: ${rc.r===5?'knew it':rc.r>=3?'partly':"didn't know"}`:' · new card'}` : 'Pick your name to save your progress.';
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
document.getElementById('o-smart').onclick=()=>setSmart(true);
document.getElementById('o-order').onclick=()=>setSmart(false);
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
    <div class="ctrl"><button class="btn cancel">Cancel</button><button class="btn primary save">Save for everyone</button></div>
    <div class="status">Saved edits are visible to the whole PC and logged under your name.</div></div>`;
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
let dres={}, fcSmart=true, saveT=null; try{ fcSmart=localStorage.getItem('bn-fc')!=='order'; }catch(e){}
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
  const list=S.cards.filter(c=>!q||hay(c).includes(q)).sort((a,b)=>a.name.localeCompare(b.name));
  out.innerHTML=(dirOpen?renderDirDetail():'')+`<div class="count">${list.length} match${list.length===1?'':'es'}</div>`+list.map(c=>{ const h=hay(c); let snip=''; if(q){ const i=h.indexOf(q); if(i>=0) snip=h.slice(Math.max(0,i-40),i+60).replace(/^\S*\s/,'').replace(/\s\S*$/,''); }
    return `<button class="tile" data-p="${c.photo}" style="display:flex;width:100%;align-items:center;gap:12px;margin-top:8px;padding:8px"><img src="${IMG(c.photo)}" alt="" style="width:56px;height:56px;border-radius:10px;flex:none"><div style="padding:0"><div>${esc(c.name)}</div><small>${esc(c.cls)}${c.home?' · '+esc(c.home):''}</small>${snip?`<small style="color:var(--ink2)">…${esc(snip)}…</small>`:''}</div></button>`; }).join('');
  out.querySelectorAll('.tile').forEach(t=>t.onclick=()=>{ openInDir(t.dataset.p); });
  bindSig(out, renderDir);
  const dc=out.querySelector('#dirclose'); if(dc) dc.onclick=()=>{ dirOpen=null; dirEdit=false; renderDir(); };
  const de=out.querySelector('#diredit'); if(de) de.onclick=()=>{ if(!me){askName();return;} dirEdit=!dirEdit; renderDir(); };
  if(dirOpen&&dirEdit) renderEditorInto(out.querySelector('#direditor'), S.cards.find(x=>x.photo===dirOpen), ()=>{ dirEdit=false; renderDir(); });
}

let dirOpen=null, dirEdit=false;
function openInDir(photo, edit){
  dirOpen=photo; dirEdit=!!edit; view='dir'; mode='learn'; lastStudy='learn';
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
const gridEl=document.getElementById('grid');
function renderGrid(){
  gridEl.innerHTML=pool().map(c=>`<button class="tile" data-p="${c.photo}" data-star="${stars[c.photo]?1:0}"><img src="${IMG(c.photo)}" alt=""><div>${esc(c.name)}<small>${esc(c.cls)}</small></div></button>`).join('');
}
gridEl.addEventListener('click', e=>{ const t=e.target.closest('.tile'); if(!t) return; view='cards'; resetOrder(); idx=order.findIndex(c=>c.photo===t.dataset.p); flipped=true; render(); window.scrollTo({top:0}); });

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
function examsTomorrowHtml(){
  if(!isPCP()||!S.exams||!Object.keys(S.exams).length) return ''; const d=addDays(today(),1), rows=PC().flatMap(n=>examOn(n,d).map(e=>[n,e]));
  return `<div class="editor"><h2>Exams tomorrow</h2>${rows.length?`<ul class="goals">${rows.map(([n,e])=>`<li><span>${esc(first(n))} · ${esc(e.course||'Exam')}</span><b>${esc(e.time||'')}</b></li>`).join('')}</ul>`:'<div class="status">Nobody has an exam tomorrow.</div>'}</div>`;
}
const informalsUpdated = () => S.informals&&S.informals.updatedAt ? 'Updated '+fmt(S.informals.updatedAt) : '';
function informalsHtml(){
  const I=informals();
  if(!I) return `<div class="editor" style="margin-top:12px"><h2>Informals</h2><div class="status">Counts sync from the Informals Tracker every night at 10 PM. Not synced yet.</div></div>`;
  const rows=PC().map(n=>[n,I[n]]), hit=rows.filter(([,c])=>c.done>=c.target).length;
  return `<div class="editor" style="margin-top:12px"><h2>Informals · ${esc(dueText(INFORMALS.by))}</h2>
    <div class="status">From the Informals Tracker · ${esc(informalsUpdated())}. At target: <b>${hit} of ${rows.length}</b>. Target ${INFORMALS.target}${Object.entries(INFORMALS.targets).map(([n,v])=>`, ${esc(first(n))} ${v}`).join('')}.</div>
    <div style="overflow-x:auto"><table class="lb"><tr><th>Pledge</th><th class="n">Done</th><th class="n">Confirmed</th><th class="n">Emailed</th></tr>
    ${rows.map(([n,c])=>`<tr><td>${esc(first(n))}${n===me?' <b>(you)</b>':''}</td><td class="n${c.done>=c.target?' hit':''}">${c.done}/${c.target}</td><td class="n">${c.confirmed}</td><td class="n">${c.emailed}</td></tr>`).join('')}</table></div></div>`;
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
  // reads "7am", "8:30pm", "7 pm", "noon" or "at 7" off the end of ws; no am/pm: 1-7 and 12 are PM, 8-11 AM. Returns {time:'HH:MM', n} or null
  const L=ws.map(w=>w.toLowerCase().replace(/[.,!]+$/,'')), k=L.length; if(!k) return null; let m, n=1;
  if(L[k-1]==='noon') m=['','12','00','pm'];
  else if(k>=2&&/^(am|pm)$/.test(L[k-1])&&/^\d{1,2}(:\d{2})?$/.test(L[k-2])){ m=(L[k-2]+L[k-1]).match(/^(\d{1,2})(?::(\d{2}))?(am|pm)$/); n=2; }
  else m=L[k-1].match(/^(\d{1,2})(?::(\d{2}))?(am|pm)$/);
  if(!m&&k>=2&&L[k-2]==='at') { m=L[k-1].match(/^(\d{1,2})(?::(\d{2}))?()$/); }
  if(!m) return null; let h=+m[1], mi=+(m[2]||0); if(h<1||h>12||mi>59) return null;
  const ap=m[3]||(h===12||h<=7?'pm':'am'); if(ap==='pm'&&h<12) h+=12; if(ap==='am'&&h===12) h=0;
  if(k>n&&(L[k-n-1]==='at'||L[k-n-1]==='by')) n++;
  return {time:String(h).padStart(2,'0')+':'+String(mi).padStart(2,'0'), n};
}
const timeText = t => { if(!t) return ''; let [h,m]=t.split(':').map(Number); const ap=h>=12?'pm':'am'; h=h%12||12; return h+(m?':'+String(m).padStart(2,'0'):'')+ap; };
function parseTask(line, base){
  base=base||today(); const who=[], bad=[], rest=[]; let all=false;
  for(const w of String(line).replace(/^\s*([-*•]|\d+[.)])\s+/,'').trim().split(/\s+/)){ if(/^@\S+/.test(w)){ const n=atWho(w.slice(1)); if(n==='*') all=true; else if(n){ if(!who.includes(n)) who.push(n); } else bad.push(w); } else if(w) rest.push(w); }
  const d=parseDue(rest, base); if(d) rest.splice(rest.length-d.n);
  const tm=parseTime(rest); if(tm) rest.splice(rest.length-tm.n);
  return {title:rest.join(' '), who:all?[]:who, all, due:d?d.due:'', time:tm?tm.time:'', bad};
}
const previewText = p => p.bad.length ? `Unknown: ${p.bad.join(' ')} (use @number, @first name or @me)` : `For: ${whoText(p.who)} · ${p.due?'Due '+dueText(p.due):'Ongoing'}${p.time?', '+timeText(p.time):''}`;
const newTask = p => Object.assign({id:uid(),title:p.title,notes:'',by:me,at:when(),done:{}}, p.due?{due:p.due}:{}, p.time?{time:p.time}:{}, p.who.length?{who:p.who}:{});
async function addTasks(ps){
  if(!isPCP()){ toast('Only the PCP can add tasks.'); return false; }
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
  const waiting=as.filter(x=>!isDone(t,x));
  return `<div class="task ${all?'done':''}" data-id="${esc(t.id)}"><div class="t">${mine?`<label class="ck"><input type="checkbox" data-tog ${meDone?'checked':''} ${ro?'disabled':''} aria-label="${ro?esc(first(v))+(meDone?' is done':' is not done'):'Mark done'}"></label>`:''}<button class="ttl" data-edit>${esc(t.title)}</button>${isPCP()?'<button class="x" data-del aria-label="Delete task">×</button>':''}</div>
    ${t.notes?`<div class="notes">${esc(t.notes)}</div>`:''}
    <div class="bar"><i style="width:${Math.round(100*n/as.length)}%"></i></div>
    <div class="meta"><span class="due ${late?'late':''}">${late?'Overdue · ':t.due?'Due ':''}${esc(dueText(t.due))}${t.time?' · '+timeText(t.time):''}${mine&&t.due&&examOn(v,t.due).length?' · exam that day':''}${mine&&meDone&&!all?` · ${ro?esc(first(v))+' is':"you're"} done, open until everyone is`:''}</span><button class="small" data-show aria-label="Who's done">${n}/${as.length} done · ${esc(whoText(t.who))} ▾</button></div>
    ${isPCP()&&waiting.length&&!all?`<div class="notes">Waiting on: ${waiting.map(x=>esc(first(x))).join(', ')}</div>`:''}
    <div class="who" data-who hidden>${as.map(x=>`<span class="${isDone(t,x)?'':'no'}">${isDone(t,x)?'✓ ':''}${esc(first(x))}</span>`).join('')}</div></div>`;
}
function bindTasks(el, rerender){
  const T=id=>S.tasks.find(x=>x.id===id), idOf=b=>b.closest('[data-id]').dataset.id;
  el.querySelectorAll('[data-tog]').forEach(b=>b.onchange=async()=>{ if(!me){askName();return;} const t=T(idOf(b)), was=isDone(t,me); b.disabled=true;
    await commit({who:me,at:when(),card:'Tasks',changes:[{field:t.title,from:was?'done':'not done',to:was?'not done':'done'}]},st=>{ const x=st.tasks.find(y=>y.id===t.id); x.done=x.done||{}; if(was) delete x.done[me]; else x.done[me]=when(); }); rerender(); });
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
  // everyone sees their own board; the PCP can switch to anyone's board (or Everyone) and is the only one who can add
  const pcp=isPCP(), who=pcp?tBoard:me, fn=who?first(who):''; tView=who||me;
  const byDue=(a,b)=>{ const x=(a.due||'9999')+(a.time||'99:99'), y=(b.due||'9999')+(b.time||'99:99'); return x<y?-1:x>y?1:0; };
  const L=S.tasks.slice().sort(byDue), all=L.filter(t=>!(t.who||[]).length);
  const sec=(h,ts,empty)=>{ const dated=ts.filter(t=>t.due), og=ts.filter(t=>!t.due); return ts.length||empty?`<h3 class="sec">${h} <small>${ts.length}</small></h3>${dated.map(taskHtml).join('')}${og.length?`<div class="ongo">Ongoing <small>${og.length}</small></div>${og.map(taskHtml).join('')}`:''}${ts.length?'':`<div class="reveal">${empty}</div>`}`:''; };
  const target=p=>{ if(!p.who.length&&!p.all&&who&&!tAll) p.who=[who]; return p; };
  const hint=`@4 or @Tim to assign (none = ${who&&!tAll?esc(fn):'whole class'}) · fri, 10/12, in 3 days to set a due date (none = ongoing) · Enter to add`;
  const focused=document.activeElement&&document.activeElement.id==='tq';
  const board = !me ? '<div class="reveal" style="margin-top:14px">Pick your name to see your tasks.</div>'
    : who ? sec(who===me?'Just for you':'Just for '+esc(fn),L.filter(t=>(t.who||[]).includes(who)),'Nothing assigned just to '+(who===me?'you':esc(fn))+'.')+sec('Whole class',all,'No class tasks yet.')
    : sec('Mine',L.filter(t=>(t.who||[]).includes(me)),'Nothing assigned just to you.')+sec('Whole class',all,'No class tasks yet.')+sec('Assigned to others',L.filter(t=>(t.who||[]).length&&!(t.who||[]).includes(me)));
  tasksEl.innerHTML=(pcp?`<div class="status" style="margin-top:14px">View as</div><div class="chips" style="margin-top:4px"><button class="chip" data-bd="" aria-pressed="${!tBoard}">Everyone</button>${(SEED.roster||[]).map(r=>`<button class="chip" data-bd="${esc(r.name)}" aria-pressed="${tBoard===r.name}">#${r.n} ${esc(first(r.name))}</button>`).join('')}</div>
    <div class="field" style="margin-top:12px"><input id="tq" placeholder="${who?'Add a task for '+esc(fn)+'…':'Add a task for the whole class…'}" autocomplete="off" enterkeyhint="done" value="${esc(tDraft)}">
    ${who?`<div class="chips" style="margin-top:6px"><button class="chip" id="tall" aria-pressed="${tAll}">Add to all</button></div>`:''}${who&&who!==me?`<div class="status">Viewing ${esc(fn)}'s board. Their checkboxes are read-only.</div>`:''}
    <div class="status" id="tprev">${tDraft.trim()?esc(previewText(target(parseTask(tDraft)))):hint}</div></div>`
    :`<div class="status" style="margin-top:14px">Your tasks. Only the PCP (${esc(PCP()||'not set')}) can add or remove tasks.</div>`)+board;
  bindTasks(tasksEl, renderTasks);
  if(!pcp) return;
  tasksEl.querySelectorAll('[data-bd]').forEach(b=>b.onclick=()=>{ tBoard=b.dataset.bd; tAll=false; renderTasks(); });
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
const MILESTONES={by:'2026-10-12', items:[
  {id:'names', label:'All names', how:'Spell 100% on all 4 classes, plus every flashcard solid (Knew it twice in a row)', val:n=>[ROLLS.filter(r=>rollBest(n,r.cls)===100).length+Object.values(S.drill[n]||{}).filter(x=>x.last==='ok'&&(x.streak||0)>=2).length, ROLLS.length+S.cards.length]},
  {id:'quiz', label:'Quiz 100%', how:'100% on every filled-in official question (Q1–19)', val:n=>officialQuiz(n)}]};
function officialQuiz(n){ const set=qSets().find(x=>x.id==='official'); if(!set) return [0,0]; const xs=qItems(set); return [xs.filter(x=>qBest(n,set.id,x.id)===100).length, xs.length]; }
function msLeft(){ const d=Math.round((new Date(MILESTONES.by+'T12:00:00')-new Date(today()+'T12:00:00'))/864e5); return d>1?d+' days left':d===1?'1 day left':d===0?'due today':'past due'; }
function milestonesHtml(){
  const M=MILESTONES.items, rows=PC().map(n=>({n,v:M.map(m=>m.val(n))})), met=([a,b])=>b>0&&a>=b, late=today()>MILESTONES.by;
  return `<div class="editor" style="margin-top:12px"><h2>Milestones · ${esc(dueText(MILESTONES.by))}</h2>
    <div class="status">${M.map((m,i)=>`${esc(m.label)}: <b>${rows.filter(r=>met(r.v[i])).length} of ${rows.length}</b> done`).join(' · ')} · ${msLeft()}</div>
    <div style="overflow-x:auto"><table class="lb"><tr><th>Pledge</th>${M.map(m=>`<th class="n">${esc(m.label)}</th>`).join('')}<th class="n">Both</th></tr>
    ${rows.map(r=>`<tr><td>${esc(first(r.n))}${r.n===me?' <b>(you)</b>':''}</td>${r.v.map(v=>`<td class="n${met(v)?' hit':late?' miss':''}">${v[0]}/${v[1]}</td>`).join('')}<td class="n${r.v.every(met)?' hit':''}">${r.v.every(met)?'✓':'—'}</td></tr>`).join('')}</table></div>
    <div class="status">${M.map(m=>`${esc(m.label)} = ${esc(m.how)}`).join('. ')}.</div></div>`;
}
function myMilestonesHtml(){
  if(!me) return ''; const M=MILESTONES.items;
  const I=informals(), c=I&&I[me];
  return `<div class="editor"><h2>By ${esc(dueText(MILESTONES.by))} <small class="status">${msLeft()}</small></h2>${M.map(m=>{ const [a,b]=m.val(me); return `<div class="ms"><div><b>${esc(m.label)}</b><span>${a}/${b}</span></div><div class="bar"><i style="width:${b?Math.round(100*a/b):0}%"></i></div></div>`; }).join('')}
    ${c?`<div class="ms"><div><b>Informals by ${esc(dueText(INFORMALS.by))}</b><span>${c.done}/${c.target}</span></div><div class="bar"><i style="width:${Math.min(100,Math.round(100*c.done/c.target))}%"></i></div><div class="status" style="margin-top:2px">${c.confirmed} confirmed · ${c.emailed} emailed</div></div>`:''}</div>`;
}

// ---------- accountability ----------
const acctEl=document.getElementById('acct');
let rankWeek=0;
function weekPoints(n, P){
  // points for one meeting-to-meeting period, from timestamps already stored
  const inWk=ts=>{ if(!ts) return false; const t=Date.parse(ts); return t>P.start&&t<=P.end; };
  const tasks=S.tasks.filter(t=>inWk((t.done||{})[n])).length;
  const perfect=S.recitals.filter(r=>r.who===n&&String(r.passage).startsWith('roll:')&&r.pct===100&&inWk(r.at)).length;
  const faces=Object.values(S.drill[n]||{}).filter(x=>x.last==='ok'&&(x.streak||0)>=2&&inWk(x.at)).length;
  return {n, tasks, perfect, faces, pts:tasks+perfect+faces};
}
function rankHtml(){
  const cur=periodAt(), P=rankWeek?prevPeriod(cur):cur, rows=PC().map(n=>weekPoints(n,P)).sort((a,b)=>b.pts-a.pts||a.n.localeCompare(b.n));
  const why=r=>[r.tasks&&r.tasks+' task'+(r.tasks===1?'':'s'),r.perfect&&r.perfect+' perfect',r.faces&&r.faces+' face'+(r.faces===1?'':'s')].filter(Boolean).join(' · ');
  return `<div class="editor" style="margin-top:12px"><h2>Weekly ranking</h2>
    <div class="sub" style="margin-top:0"><button data-rw="0" aria-pressed="${!rankWeek}">This week</button><button data-rw="1" aria-pressed="${!!rankWeek}">Last week</button></div>
    <div class="status">${esc(shortDay(P.startDay))} – ${esc(shortDay(P.endDay))} (meeting to meeting). 1 point per task checked off, 1 per 100% Spell, 1 per face that turns solid.</div>
    ${rows[0].pts?'':'<div class="status">No points yet. The top 3 show once someone scores.</div>'}<div class="podium">${rows.slice(0,rows[0].pts?3:0).map((r,i)=>`<div class="pod"><span class="pl">${i+1}</span><div><b>${esc(r.n)}${r.n===me?' (you)':''}</b><small>${esc(why(r))||'No points yet'}</small></div><span class="pts">${r.pts}</span></div>`).join('')}</div>
    <table class="lb">${rows.slice(rows[0].pts?3:0).map((r,i)=>`<tr><td class="n" style="width:2em;text-align:left">${i+(rows[0].pts?4:1)}</td><td>${esc(r.n)}${r.n===me?' <b>(you)</b>':''}</td><td class="n">${r.pts}</td></tr>`).join('')}</table></div>`;
}
// ---------- grades: tasks completed + informals, school scale ----------
const LETTERS=[[97,'A+'],[93,'A'],[90,'A−'],[87,'B+'],[83,'B'],[80,'B−'],[77,'C+'],[73,'C'],[70,'C−'],[67,'D+'],[63,'D'],[60,'D−'],[0,'F']];
const letter = pct => LETTERS.find(([min])=>pct>=min)[1];
function gradeFor(n){
  // tasks: share done of everything due before today (tasks finished early count too); informals: Done vs target, capped at 100%. Equal weight.
  const t0=today(), xs=S.tasks.filter(t=>isFor(t,n)&&(isDone(t,n)||(t.due&&t.due<t0))), td=xs.filter(t=>isDone(t,n)).length;
  const I=informals(), c=I&&I[n], parts=[];
  const tp=xs.length?td/xs.length:null; if(tp!==null) parts.push(tp);
  const ip=c?Math.min(1,c.done/c.target):null; if(ip!==null) parts.push(ip);
  if(!parts.length) return null;
  const pct=Math.round(100*parts.reduce((a,b)=>a+b,0)/parts.length);
  return {pct, letter:letter(pct), tasks:[td,xs.length], inf:c?[c.done,c.target]:null};
}
function gradesHtml(){
  const rows=PC().map(n=>[n,gradeFor(n)]).sort((a,b)=>(b[1]?b[1].pct:-1)-(a[1]?a[1].pct:-1)||a[0].localeCompare(b[0]));
  return `<div class="editor" style="margin-top:12px"><h2>Grades</h2>
    <div class="status">Half tasks completed (of everything due before today, plus anything finished early), half informals (Done vs target, ${INFORMALS.target}; ${Object.entries(INFORMALS.targets).map(([n,v])=>esc(first(n))+' '+v).join(', ')}). ${informals()?esc(informalsUpdated())+'.':'Informals not synced yet, so tasks only.'}</div>
    <table class="lb"><tr><th>Pledge</th><th class="n">Tasks</th><th class="n">Informals</th><th class="n">Score</th><th class="n">Grade</th></tr>
    ${rows.map(([n,g])=>`<tr><td>${esc(first(n))}${n===me?' <b>(you)</b>':''}</td><td class="n">${g&&g.tasks[1]?g.tasks[0]+'/'+g.tasks[1]:'—'}</td><td class="n">${g&&g.inf?g.inf[0]+'/'+g.inf[1]:'—'}</td><td class="n">${g?g.pct+'%':'—'}</td><td class="n grade${g&&g.pct>=90?' hit':''}">${g?g.letter:'—'}</td></tr>`).join('')}</table></div>`;
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
  const clsSigs=sigCards().filter(c=>sigOf(c).status==='signed').length+'/'+sigCards().length;
  const pctCell=b=>`<td class="n${b===100?' hit':''}">${b===null?'—':b+'%'}</td>`;
  acctEl.innerHTML=gradesHtml()+milestonesHtml()+informalsHtml()+rankHtml()+`<div class="editor" style="margin-top:12px"><h2>Where everyone stands</h2>
    <div class="status">Green = target hit. Faces = cards marked Knew it twice in a row on Flashcards. Spell = best score (target 100%). Quiz = official questions at 100%. Tasks = done / assigned. Sigs signed = the class's signed sig tasks (done together).</div>
    <div style="overflow-x:auto"><table class="lb"><tr><th>Pledge</th><th class="n">Faces</th>${ROLLS.map(r=>`<th class="n">${esc(r.cls.replace('Beta ',''))}</th>`).join('')}<th class="n">Quiz Q1–19</th><th class="n">Tasks</th><th class="n">Sigs signed</th></tr>
    ${rows.map(r=>`<tr><td>${esc(r.n.split(' ')[0])}${r.n===me?' <b>(you)</b>':''}</td><td class="n${r.solid>=total?' hit':''}">${r.solid}/${total}</td>${r.spell.map(pctCell).join('')}${(()=>{ const [a,b]=officialQuiz(r.n); return `<td class="n${b&&a===b?' hit':''}">${b?a+'/'+b:'—'}</td>`; })()}<td class="n${r.assigned&&r.done===r.assigned?' hit':''}">${r.done}/${r.assigned}</td><td class="n">${clsSigs}</td></tr>`).join('')}</table></div>
    <div class="status">Spell columns: Upsilon, Phi, Chi, Psi rolls.</div></div>
    ${me&&S.drill[me]?`<div class="editor" style="margin-top:12px"><h2>Your weak spots</h2><div class="grid" style="margin-top:6px">${S.cards.filter(c=>{const x=S.drill[me][c.photo]; return x&&x.last!=='ok';}).map(c=>{const x=S.drill[me][c.photo]; return `<div class="tile"><img src="${IMG(c.photo)}" alt=""><div>${esc(c.name)}<small>${x.last==='miss'?'name wrong':'facts shaky'} · ${x.miss} wrong · ${x.some||0} partial</small></div></div>`;}).join('')||'<div class="status">No misses on record. Either you are cracked or you have not drilled.</div>'}</div></div>`:''}`;
  acctEl.querySelectorAll('[data-rw]').forEach(b=>b.onclick=()=>{ rankWeek=+b.dataset.rw; renderAcct(); });
}

// ---------- pledge guide ----------
const guideEl=document.getElementById('guide');
let gq='';
function renderGuide(){
  const pages=S.guide||[]; const q=gq.trim().toLowerCase();
  const hl=t=>{ let s=esc(t); if(q){ const re=new RegExp('('+q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+')','ig'); s=s.replace(re,'<mark>$1</mark>'); } return s; };
  const list=pages.filter(p=>!q||(p.title+' '+p.body).toLowerCase().includes(q));
  guideEl.innerHTML=`<div class="field" style="margin-top:12px"><label>Search the pledge guide</label><input id="gq" placeholder="e.g. hazing, big brother, 1907" value="${esc(gq)}" autocomplete="off"></div>
    <div class="count">${pages.length} pages · ${list.length} shown</div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">${pages.map((p,i)=>`<a href="#g${i}" class="chip" style="text-decoration:none">${i+1}. ${esc(p.title)}</a>`).join('')}</div>
    ${list.map(p=>`<div class="passage" id="g${p.order}" style="user-select:text"><h3 style="margin:0 0 8px;font-size:18px">${hl(p.title)}</h3>${p.body.split(/\n\n+/).map(par=>`<p style="margin:0 0 10px;white-space:pre-line">${hl(par)}</p>`).join('')}</div>`).join('')||'<div class="reveal" style="margin-top:12px">No matches.</div>'}`;
  const inp=guideEl.querySelector('#gq'); inp.addEventListener('input',()=>{ const pos=inp.selectionStart; gq=inp.value; renderGuide(); const n=guideEl.querySelector('#gq'); n.focus(); n.setSelectionRange(pos,pos); });
}

// ---------- DSP facts ----------
const factsEl=document.getElementById('facts');
function renderFacts(){
  factsEl.innerHTML=`<div class="factlist">${S.facts.length?S.facts.map((f,i)=>`<div class="fact"><b>${esc(f.q)}</b><div class="a hide" title="tap to reveal">${esc(f.a)}</div><div class="ctrl" style="margin-top:6px"><button class="small" data-e="${i}">Edit</button><button class="small" data-d="${i}">Delete</button></div></div>`).join(''):'<div class="reveal">No DSP facts yet. Add the ones the brothers give you.</div>'}</div>
  <div class="editor" id="fed"><h2>Add a fact</h2><div class="field"><label>Question / prompt</label><input id="fq" placeholder="e.g. DSP founding date"></div><div class="field"><label>Answer</label><textarea id="fa" placeholder="e.g. November 7, 1907, NYU"></textarea></div><div class="ctrl"><button class="btn primary" id="fadd">Save for everyone</button></div></div>`;
  factsEl.querySelectorAll('.a').forEach(a=>a.onclick=()=>a.classList.toggle('hide'));
  factsEl.querySelector('#fadd').onclick=async()=>{ const q=factsEl.querySelector('#fq').value.trim(), a=factsEl.querySelector('#fa').value.trim(); if(!q||!a) return; const ok=await commit({who:me,at:when(),card:'DSP facts',changes:[{field:q,from:'',to:a}]},st=>st.facts.push({q,a})); if(ok) renderFacts(); };
  factsEl.querySelectorAll('[data-d]').forEach(b=>b.onclick=async()=>{ const i=+b.dataset.d, f=S.facts[i]; if(!confirm('Delete "'+f.q+'"?')) return; const ok=await commit({who:me,at:when(),card:'DSP facts',changes:[{field:f.q,from:f.a,to:'(deleted)'}]},st=>st.facts.splice(i,1)); if(ok) renderFacts(); });
  factsEl.querySelectorAll('[data-e]').forEach(b=>b.onclick=()=>{ const i=+b.dataset.e, f=S.facts[i]; const q=prompt('Question',f.q); if(q===null) return; const a=prompt('Answer',f.a); if(a===null) return; if(q===f.q&&a===f.a) return; commit({who:me,at:when(),card:'DSP facts',changes:[{field:q,from:f.a,to:a}]},st=>{st.facts[i]={q,a};}).then(ok=>{ if(ok) renderFacts(); }); });
}

// ---------- log ----------
const logEl=document.getElementById('log');
function renderLog(){
  logEl.innerHTML=`<div class="log">${S.log.length?S.log.map(e=>`<div class="entry"><div class="top"><span><b>${esc(e.who)}</b> · <b>${esc(e.card)}</b></span><span>${fmt(e.at)}</span></div>${e.changes.map(ch=>`<div class="diff"><span style="font-weight:600">${esc(ch.field)}</span>${ch.from?`<span class="from">${esc(ch.from)}</span>`:''}<span class="to">${esc(ch.to)||'(cleared)'}</span></div>`).join('')}</div>`).join(''):'<div class="reveal">No edits yet.</div>'}</div>`;
}

// ---------- today ----------
const todayEl=document.getElementById('today');
let ongoingOpen=false;
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
const checkRow = (t,n,late) => `<div class="task" data-id="${esc(t.id)}"><div class="t"><label class="ck"><input type="checkbox" data-tog ${isDone(t,n)?'checked':''} aria-label="Mark done"></label><span class="ttl">${esc(t.title)}</span><span class="due ${late?'late':''}">${esc(dueText(t.due))}${t.time?' · '+timeText(t.time):''}${t.due&&examOn(n,t.due).length?'<br>exam that day':''}</span></div></div>`;
function renderToday(){
  if(!me){ todayEl.innerHTML=`<div class="editor"><h2>Hi there</h2><div class="status">Pick your name to see your plan.</div><div class="ctrl"><button class="btn primary" id="tpick">Pick your name</button></div></div>`+weeklyHtml(); todayEl.querySelector('#tpick').onclick=askName; return; }
  const t0=today(), t1=addDays(t0,1), plan=planFor(me,t0), P=periodAt(), wk=weekStats([me],P), cls=weekStats(PC(),P), st=streakFor(me,t0);
  const now=S.tasks.filter(t=>isFor(t,me)&&!isDone(t,me)&&t.due&&t.due<=t0).length;
  const solid=Object.values(S.drill[me]||{}).filter(x=>x.last==='ok'&&(x.streak||0)>=2).length;
  const spell=ROLLS.filter(r=>rollBest(me,r.cls)===100).length;
  const dayName = d => d===t0?'Today':d===t1?'Tomorrow':dayLabel(d);
  const goal = (d,ts) => { const k=ts.filter(t=>isDone(t,me)).length; return `${d===t0?"Today's goal":'Goal'}: ${k} of ${ts.length} done`; };
  todayEl.innerHTML=`<h2 class="hi">Hi ${esc(first(me))}</h2><div class="status">${now?`${now} task${now===1?'':'s'} due today or overdue.`:'Nothing due today.'}</div>
    <div class="meter">${ring(wk.pct)}<div><b>This week</b><div class="status" style="margin:0">${wk.done} of ${wk.tot} done</div><div class="status" style="margin:2px 0 0">${esc(P.label)}</div><div class="status" style="margin:2px 0 0">${st}-day streak</div></div></div>
    <div class="clsbar"><span>Whole class: ${cls.pct===null?'—':cls.pct+'%'} this week</span><div class="bar"><i style="width:${cls.pct||0}%"></i></div></div>
    ${examsTomorrowHtml()}
    ${weeklyHtml()}
    ${myMilestonesHtml()}
    <div class="editor"><h2>Your progress</h2><div class="status">Faces solid <b>${solid}/${S.cards.length}</b> · Rolls spelled 100% <b>${spell}/${ROLLS.length}</b></div>
      <div class="ctrl"><button class="btn primary" id="tdrill">Study flashcards</button></div></div>
    ${(()=>{ const nx=sigCards().filter(c=>['confirmed','done'].includes(sigOf(c).status)).sort((a,b)=>(+sigOf(a).difficulty||99)-(+sigOf(b).difficulty||99)||a.name.localeCompare(b.name)); return nx.length?`<h3 class="sec">Next sig tasks <small>${nx.length} in progress · easiest first</small></h3>${nx.slice(0,5).map(c=>sigRow(c,true)).join('')}${nx.length>5?`<div class="status"><button class="small" id="allsigs">See all ${nx.length}</button></div>`:''}`:''; })()}
    ${plan.catchup.length?`<h3 class="sec">Catch up <small>${plan.catchup.filter(t=>isDone(t,me)).length} of ${plan.catchup.length} done</small></h3>${plan.catchup.map(t=>checkRow(t,me,true)).join('')}`:''}
    ${plan.days.length?plan.days.map(([d,ts])=>`<h3 class="sec">${esc(dayName(d))}</h3><div class="status" style="margin:0 0 2px">${goal(d,ts)}</div>${ts.map(t=>checkRow(t,me,false)).join('')}`).join('')
      :plan.catchup.length?'':`<div class="reveal" style="margin-top:14px;text-align:center"><div class="big">Nothing due 🎉</div><div class="ctrl"><button class="btn" id="tstudy">Go to Study</button></div></div>`}
    ${plan.ongoing.length?`<details class="ogd" ${ongoingOpen?'open':''}><summary><h3 class="sec">Ongoing <small>${plan.ongoing.length}</small></h3></summary>${plan.ongoing.map(t=>checkRow(t,me,false)).join('')}</details>`:''}`;
  const od=todayEl.querySelector('.ogd'); if(od) od.ontoggle=()=>{ ongoingOpen=od.open; };
  todayEl.querySelector('#tdrill').onclick=()=>{ view='cards'; setMode('learn'); };
  const sb=todayEl.querySelector('#tstudy'); if(sb) sb.onclick=()=>setMode(lastStudy);
  const as=todayEl.querySelector('#allsigs'); if(as) as.onclick=()=>setMode('sigs');
  bindTasks(todayEl, renderToday); bindSig(todayEl, renderToday);
}

function weeklyHtml(){
  const I=informals(), t0=today(), pc=PC(), all=sigCards(), signed=all.filter(c=>sigOf(c).status==='signed').length;
  const scale=I?Math.max(...pc.map(n=>Math.max(I[n].done,I[n].target))):1;
  const bars=I?pc.map(n=>{ const c=I[n]; return `<div class="hb"><span class="hl">${esc(first(n))}</span><div class="ht"><i style="width:${(100*c.done/scale).toFixed(1)}%"></i><b style="left:${(100*c.target/scale).toFixed(1)}%" title="Target ${c.target}"></b></div><span class="hv${c.done>=c.target?' ok':''}">${c.done}/${c.target}</span></div>`; }).join('')
    :'<div class="status">Informal counts sync from the tracker every night at 10 PM. Not synced yet.</div>';
  const atInf=I?pc.filter(n=>I[n].done>=I[n].target).length:0, ms=MILESTONES.items.map(m=>[m, pc.filter(n=>{ const [a,b]=m.val(n); return b>0&&a>=b; }).length]);
  const goals=[[`${INFORMALS.target} informals each (${Object.entries(INFORMALS.targets).map(([n,v])=>esc(first(n))+' '+v).join(', ')}) by ${mdy(INFORMALS.by)}`, I?`${atInf} of ${pc.length} there`:'not synced yet'],
    [`${SIG_TARGET.pct}% of sig tasks signed by ${mdy(SIG_TARGET.by)}`, all.length?`${signed} of ${all.length} signed`:'none tracked yet']].concat(ms.map(([m,k])=>[`${m.label} by ${mdy(MILESTONES.by)}`, `${k} of ${pc.length} there`]));
  const P=periodAt(), tk=pc.map(n=>[n,weekStats([n],P)]);
  return `<div class="editor weekly"><h2>Weekly progress</h2><div class="status" style="margin-top:-6px">${esc(P.label)}</div>
    <h3 class="wh">Informals done ${I?`<small>${esc(informalsUpdated())} · line = target</small>`:''}</h3>${bars}
    <h3 class="wh">This week's goals</h3><ul class="goals">${goals.map(([g,v])=>`<li><span>${g}</span><b>${esc(v)}</b></li>`).join('')}</ul>
    <h3 class="wh">Tasks done this week</h3>${tk.map(([n,w])=>`<div class="hb"><span class="hl">${esc(first(n))}</span><div class="ht"><i style="width:${w.tot?(100*w.done/w.tot).toFixed(1):0}%"></i></div><span class="hv">${w.done} of ${w.tot}</span></div>`).join('')}</div>`;
}

// ---------- quizzes (question bank in Firebase `quiz`, attempts in recitals as quiz:set:item) ----------
const quizEl=document.getElementById('quizzes');
const byOrder=(a,b)=>(a.order??0)-(b.order??0);
const qSets = () => Object.entries((S.quiz&&S.quiz.sets)||{}).map(([id,x])=>Object.assign({id},x)).sort(byOrder);
const qFilled = set => Object.entries(set.items||{}).map(([id,x])=>Object.assign({id},x)).filter(x=>String(x.a||'').trim()).sort(byOrder);
function qItems(set){
  // "both" sets (e.g. executive board) are asked both ways
  const xs=qFilled(set); if(!set.both) return xs.map(x=>({id:x.id,q:x.q,a:x.a,alt:x.alt||[]}));
  return xs.flatMap(x=>[{id:x.id,q:`Who is the ${x.q}?`,a:x.a,alt:x.alt||[]},{id:x.id+'~r',q:`What position does ${x.a} hold?`,a:x.q,alt:[x.q.replace(/^Beta Nu /,'')]}]);
}
const qBest = (n,setId,itemId) => { const rs=S.recitals.filter(r=>r.who===n&&r.passage===`quiz:${setId}:${itemId}`); return rs.length?Math.max(...rs.map(r=>r.pct)):null; };
function qScore(n,set){ const xs=qItems(set); if(!xs.length) return null; const b=xs.map(x=>qBest(n,set.id,x.id)||0); return {pct:Math.round(b.reduce((s,v)=>s+v,0)/xs.length), mastered:b.every(v=>v===100), perfect:b.filter(v=>v===100).length, total:xs.length}; }
function qGrade(item, typed){ let best=null; for(const ans of [item.a].concat(item.alt||[])){ const g=lcsGrade(qtoks(ans),qtoks(typed),false); g.ans=ans; if(!best||g.pct>best.pct) best=g; } return best; }
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
    ${sets.map(x=>{ const sc=me&&qScore(me,x), n=qItems(x).length; return `<div class="qset" data-set="${esc(x.id)}"><div><b>${esc(x.title)}</b><small>${n?`${n} question${n===1?'':'s'}${sc?` · your score ${sc.pct}%${sc.mastered?' · Mastered':''}`:''}`:esc(x.note||'No questions yet.')}</small></div>${pcp?'<button class="small" data-qedit>Edit</button>':''}${n?'<button class="btn" data-qstart style="flex:0 0 auto">Start</button>':''}</div>`; }).join('')}
    <div class="qset"><div><b>Classes</b><small>Spell each class roll from memory</small></div><button class="btn" id="qspell" style="flex:0 0 auto">Open Spell</button></div>
    <div class="status">Capitals and extra spaces don't matter; spelling, punctuation and word order do. Your score for a set is the average of your best on each question; Mastered = 100% on every one.</div>`;
  quizEl.querySelectorAll('[data-qm]').forEach(b=>b.onclick=()=>{ qz.mode=b.dataset.qm; renderQuizzes(); });
  quizEl.querySelectorAll('[data-qstart]').forEach(b=>b.onclick=()=>qStart(sets.find(x=>x.id===b.closest('[data-set]').dataset.set), qz.mode));
  quizEl.querySelectorAll('[data-qedit]').forEach(b=>b.onclick=()=>{ const x=sets.find(y=>y.id===b.closest('[data-set]').dataset.set); qz.set=x.id; qz.draft=Object.entries(x.items||{}).map(([id,v])=>Object.assign({id},v)).sort(byOrder).map(v=>({id:v.id,q:v.q||'',a:v.a||'',alt:(v.alt||[]).join(' | ')})); qz.phase='edit'; renderQuizzes(); });
  quizEl.querySelector('#qspell').onclick=()=>setMode('roll');
}
function renderQuizEdit(set){
  // PCP only: add, edit and reorder questions; saved through commit() and logged
  if(!isPCP()){ qz.phase='pick'; return renderQuizzes(); }
  const D=qz.draft;
  quizEl.innerHTML=`<div class="editor"><h2>Edit · ${esc(set.title)}</h2>${D.map((x,i)=>`<div class="qedit" data-i="${i}"><div class="ctrl" style="margin:0 0 4px;align-items:center"><b style="flex:1">${set.both?'':'Q'}${i+1}</b><button class="small" data-up ${i?'':'disabled'}>↑</button><button class="small" data-dn ${i<D.length-1?'':'disabled'}>↓</button><button class="small" data-rm>×</button></div>
      <div class="field"><label>${set.both?'Position':'Question'}</label><textarea data-k="q" rows="2">${esc(x.q)}</textarea></div>
      <div class="field"><label>${set.both?'Name':'Answer (leave empty to hide from quizzes)'}</label><textarea data-k="a" rows="2">${esc(x.a)}</textarea></div>
      <div class="field"><label>Also accept (separate with |)</label><input data-k="alt" value="${esc(x.alt)}"></div></div>`).join('')}
    <div class="ctrl"><button class="small" id="qadd">+ Add question</button></div>
    <div class="ctrl"><button class="btn" id="qcancel">Cancel</button><button class="btn primary" id="qsave">Save for everyone</button></div></div>`;
  quizEl.querySelectorAll('.qedit').forEach(el=>{ const i=+el.dataset.i;
    el.querySelectorAll('[data-k]').forEach(f=>f.oninput=()=>{ D[i][f.dataset.k]=f.value; });
    el.querySelector('[data-up]').onclick=()=>{ [D[i-1],D[i]]=[D[i],D[i-1]]; renderQuizEdit(set); };
    el.querySelector('[data-dn]').onclick=()=>{ [D[i+1],D[i]]=[D[i],D[i+1]]; renderQuizEdit(set); };
    el.querySelector('[data-rm]').onclick=()=>{ if(D[i].q.trim()&&!confirm('Remove this question?')) return; D.splice(i,1); renderQuizEdit(set); }; });
  quizEl.querySelector('#qadd').onclick=()=>{ D.push({id:'i'+uid(),q:'',a:'',alt:''}); renderQuizEdit(set); const t=quizEl.querySelectorAll('.qedit textarea[data-k=q]'); t[t.length-1].focus(); };
  quizEl.querySelector('#qcancel').onclick=()=>{ qz.phase='pick'; renderQuizzes(); };
  quizEl.querySelector('#qsave').onclick=async()=>{
    const items={}, old=set.items||{}, ch=[];
    D.filter(x=>x.q.trim()).forEach((x,i)=>{ const alt=x.alt.split('|').map(v=>v.trim()).filter(Boolean); items[x.id]=Object.assign({q:x.q.trim(),a:x.a.trim(),order:i+1},alt.length?{alt}:{});
      const o=old[x.id]; if(!o) ch.push({field:'Added question',from:'',to:x.q.trim()}); else if(o.q!==items[x.id].q||(o.a||'')!==items[x.id].a||JSON.stringify(o.alt||[])!==JSON.stringify(alt)) ch.push({field:x.q.trim(),from:o.a||'',to:items[x.id].a}); });
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
  rollEl.innerHTML=`<div class="chips">${ROLLS.map((x,i)=>{ const b=rollBest(me,x.cls); return `<button class="chip" data-ri="${i}" aria-pressed="${i===rIdx}">${esc(x.cls)}${b===null?'':' · '+b+'%'}</button>`; }).join('')}</div>
    <div class="editor"><h2>Spell the ${esc(r.cls)} roll</h2>
      <div class="field"><label>Class name</label><input id="rc" autocomplete="off" autocapitalize="words" value="${esc(d.c)}"></div>
      <div class="field"><label>VPPE</label><input id="rv" autocomplete="off" autocapitalize="words" value="${esc(d.v)}"></div>
      <div class="field"><label>Members (one per line, in order)</label><textarea id="rm" autocapitalize="words" style="min-height:220px">${esc(d.m)}</textarea></div>
      <div class="ctrl"><button class="btn primary" id="rcheck">Check it</button></div>
      <div class="status">Full official names, in order. Capitals and accents don't matter; spelling, punctuation and order do. Target: 100% on all four classes.</div></div>
    <div id="rres"></div><div id="rboard"></div>`;
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
function showErr(msg){ try{ fetch(DB+'/errors.json',{method:'POST',body:JSON.stringify({msg:String(msg).slice(0,500),at:new Date().toISOString(),who:me,mode,view,ua:navigator.userAgent.slice(0,120),build:'2026-10-06m'})}); }catch(e){} let b=document.getElementById('errbar'); if(!b){ b=document.createElement('div'); b.id='errbar'; b.style.cssText='position:fixed;left:0;right:0;bottom:0;z-index:70;background:#B23A3A;color:#fff;padding:10px 14px;font:600 13px "Public Sans",sans-serif;display:flex;gap:10px;align-items:center;justify-content:space-between'; document.body.appendChild(b); }
  b.innerHTML='<span style="flex:1;word-break:break-word">Something broke: '+esc(msg)+'</span><button onclick="location.reload()" style="border:0;background:#fff;color:#B23A3A;border-radius:8px;padding:6px 10px;font:600 13px \'Public Sans\',sans-serif;cursor:pointer">Reload</button><button onclick="document.getElementById(\'errbar\').remove()" style="border:0;background:transparent;color:#fff;font-size:18px;cursor:pointer">×</button>'; }
window.addEventListener('error', e=>{ showErr((e.message||'error')+' @'+(e.lineno||'?')); try{ render(); }catch(x){} });
window.addEventListener('unhandledrejection', e=>{ showErr('async: '+((e.reason&&e.reason.message)||e.reason||'error')); });

// ---------- render ----------
function render(){
  if(!['today','learn','roll','quizzes','tasks','sigs','guide','facts','acct','log'].includes(mode)) mode='today';
  document.getElementById('count').textContent=`${pool().length} in this set · ${Object.keys(stars).length} starred · data v${S.version}`;
  const showChips = mode==='learn';
  chipsEl.hidden=!showChips; document.getElementById('count').hidden=!showChips;
  for(const id of ['today','learn','roll','quizzes','tasks','sigs','guide','facts','acct','log']) document.getElementById(id).hidden = mode!==id;
  const tab=tabOf(mode);
  document.querySelectorAll('[role=tab]').forEach(t=>t.setAttribute('aria-selected', t.dataset.tab===tab));
  document.getElementById('studysub').hidden = tab!=='study'; document.getElementById('infosub').hidden = tab!=='info'; document.getElementById('tasksub').hidden = tab!=='tasks';
  document.querySelectorAll('#studysub [data-m],#infosub [data-m],#tasksub [data-m]').forEach(b=>b.setAttribute('aria-pressed', b.dataset.m===mode));
  if(mode==='learn'){ document.getElementById('o-smart').setAttribute('aria-pressed',fcSmart); document.getElementById('o-order').setAttribute('aria-pressed',!fcSmart); document.getElementById('v-cards').setAttribute('aria-pressed',view==='cards'); document.getElementById('v-grid').setAttribute('aria-pressed',view==='grid'); document.getElementById('v-dir').setAttribute('aria-pressed',view==='dir'); document.getElementById('cardwrap').hidden=view!=='cards'; gridEl.hidden=view!=='grid'; document.getElementById('dir').hidden=view!=='dir'; if(view==='cards') renderCard(); else if(view==='grid') renderGrid(); else renderDir(); }
  else if(mode==='today') renderToday();
  else if(mode==='roll') renderRoll();
  else if(mode==='quizzes') renderQuizzes();
  else if(mode==='acct') renderAcct();
  else if(mode==='tasks') renderTasks();
  else if(mode==='sigs') renderSigs();
  else if(mode==='facts') renderFacts();
  else if(mode==='guide') renderGuide();
  else if(mode==='log') renderLog();
}
renderWho(); setStatus('Loading…');
Promise.all([loadPhotos(),refresh()]).then(()=>{ renderChips(); resetOrder(); render(); if(!me) setTimeout(askName, 300); loadSheets().then(()=>{ if(['today','acct','sigs'].includes(mode)) render(); }); });
setInterval(()=>{ const ae=document.activeElement, typing=ae&&(ae.tagName==='TEXTAREA'||(ae.tagName==='INPUT'&&ae.type!=='checkbox')); if(document.visibilityState==='visible' && !typing && !tEdit && !editing && !dirEdit && mode!=='learn' && mode!=='quiz') refresh().then(()=>{ order=order.map(c=>S.cards.find(x=>x.photo===c.photo)||c); if(['today','tasks','sigs','acct','log','facts','guide'].includes(mode)) render(); }); loadSheets(); }, 30000);
