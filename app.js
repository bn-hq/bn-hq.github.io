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
  return { version:d.version||0, cards, log:objToArr(d.log).sort(byAtDesc), facts:objToArr(d.facts,'order'), tasks:objToArr(d.tasks).sort((a,b)=>(a.due||'9999')<(b.due||'9999')?-1:1), recitals:objToArr(d.recitals).sort(byAtDesc), guide:objToArr(d.guide,'order'), passages: d.passages? objToArr(d.passages,'order') : SEED.passages, drill:d.drill||{} };
}
async function dbGet(path){ const r=await fetch(DB+'/'+path+'.json',{cache:'no-store'}); if(!r.ok) throw new Error('read '+r.status); return r.json(); }
async function dbWrite(method,path,body){ const r=await fetch(DB+'/'+path+'.json',{method,body:body===undefined?undefined:JSON.stringify(body)}); if(!r.ok) throw new Error('write '+r.status); return r.json(); }
const KEYS=['version','cards','log','facts','tasks','recitals','passages','drill','guide'];
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
  m.innerHTML=`<div><h2>Which pledge are you?</h2><p>Your name goes on every edit, task check-off, and recital score.</p><select id="nm" style="width:100%;border:1px solid var(--line);background:var(--bg);color:var(--ink);border-radius:10px;padding:10px;font:15px 'Public Sans',sans-serif"><option value="">Pick your name</option>${names.map(n=>`<option value="${esc(n)}" ${n===me?'selected':''}>${esc(n)}</option>`).join('')}</select><div class="ctrl"><button class="btn primary" id="ok">Continue</button></div></div>`;
  document.body.appendChild(m);
  const sel=m.querySelector('#nm'); sel.focus();
  const done=()=>{ const v=sel.value; if(!v){ sel.focus(); return; } me=v; try{localStorage.setItem('bn-user',me);}catch(e){} m.remove(); renderWho(); render(); };
  m.querySelector('#ok').onclick=done; sel.addEventListener('change',()=>{ if(sel.value) done(); });
}

// ---------- helpers ----------
function pool(){
  if (filter==='starred') return S.cards.filter(c=>stars[c.photo]);
  if (filter==='all') return S.cards.slice();
  return S.cards.filter(c=>c.cls===filter);
}
function shuffle(a){ for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];} return a; }
function resetOrder(){ order = pool(); idx = 0; flipped=false; editing=false; document.getElementById('editor').hidden=true; }
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
  const cls=[...new Set(S.cards.map(c=>c.cls))];
  const items=[['all',`All ${S.cards.length}`],...cls.map(k=>[k,k]),['starred','★ Starred']];
  chipsEl.innerHTML = items.map(([k,l])=>`<button class="chip" data-f="${esc(k)}" aria-pressed="${filter===k}">${esc(l)}</button>`).join('');
}
chipsEl.addEventListener('click', e=>{ const b=e.target.closest('.chip'); if(!b) return; filter=b.dataset.f; renderChips(); resetOrder(); if(mode==='quiz'){ saveDrill(); startDrill(); } render(); });
const STUDY=['learn','quiz','roll','recite'], INFO=['guide','facts','log'], TASKS=['tasks','sigs'];
let lastStudy='learn', lastInfo='guide', lastTasks='tasks'; try{ const v=JSON.parse(localStorage.getItem('bn-sub')||'{}'); if(STUDY.includes(v.s)) lastStudy=v.s; if(INFO.includes(v.i)) lastInfo=v.i; if(TASKS.includes(v.t)) lastTasks=v.t; }catch(e){}
const tabOf = m => STUDY.includes(m)?'study':INFO.includes(m)?'info':TASKS.includes(m)?'tasks':m;
function setMode(m){
  if(mode==='quiz') saveDrill(); resetOrder(); stopRec(); mode=m;
  if(STUDY.includes(m)) lastStudy=m; if(INFO.includes(m)) lastInfo=m; if(TASKS.includes(m)) lastTasks=m; try{ localStorage.setItem('bn-sub',JSON.stringify({s:lastStudy,i:lastInfo,t:lastTasks})); }catch(e){}
  if(mode==='quiz') startDrill(); render(); window.scrollTo({top:0});
  refresh().then(()=>{ order=order.map(c=>S.cards.find(x=>x.photo===c.photo)||c); if(mode!=='learn'&&mode!=='quiz') render(); });
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
document.getElementById('q-fn').onclick=()=>{ qkind='fn'; saveDrill(); startDrill(); render(); };
document.getElementById('q-nf').onclick=()=>{ qkind='nf'; saveDrill(); startDrill(); render(); };
document.getElementById('q-smart').onclick=()=>{ smart=!smart; document.getElementById('q-smart').setAttribute('aria-pressed',smart); saveDrill(); startDrill(); render(); };

// ---------- learn ----------
const cardEl=document.getElementById('card');
function renderCard(){
  const c=order[idx];
  if(!c){ cardEl.innerHTML='<div style="padding:40px;text-align:center;color:var(--ink2)">Nothing here. Star some brothers first.</div>'; document.getElementById('editor').hidden=true; return; }
  if(!flipped){
    cardEl.innerHTML=`<div class="front"><img src="${IMG(c.photo)}" alt="brother photo"><div class="hint">Tap to reveal · ${idx+1} / ${order.length}</div></div>`;
  } else {
    const rows=FIELDS.map(([k,l])=>[l,c[k]]);
    for(const [k,v] of Object.entries(c.extra||{})) rows.push([k,v]);
    rows.push(['LinkedIn', c.li?`<a href="https://www.linkedin.com/in/${esc(c.li)}/" target="_blank" rel="noopener">linkedin.com/in/${esc(c.li)}</a>`:'', true]);
    cardEl.innerHTML=`<div class="back"><img src="${IMG(c.photo)}" alt=""><div><h2>${esc(c.name)}</h2>${c.alias?`<div class="alias">${esc(c.alias)}</div>`:''}<span class="tag">${esc(c.cls)}</span></div><div class="facts">${rows.map(([k,v,raw])=>`<div><b>${esc(k)}</b><span>${v?(raw?v:esc(v)):'<span class="empty">not filled in yet</span>'}</span></div>`).join('')}</div>${sigHtml(c)}</div>`;
    bindSig(cardEl, ()=>{ order=order.map(x=>S.cards.find(y=>y.photo===x.photo)||x); renderCard(); });
  }
  const s=document.getElementById('star'); const on=!!stars[c.photo]; s.setAttribute('aria-pressed',on); s.textContent=on?'★ Starred':'☆ Star';
  document.getElementById('editor').hidden=true;
}
let lastFlip=0;
cardEl.addEventListener('pointerdown', e=>{ if(e.button&&e.button!==0) return; if(e.target.closest('a,.sig')) return; const t=Date.now(); if(t-lastFlip<250) return; lastFlip=t; flipped=!flipped; renderCard(); });
cardEl.addEventListener('click', e=>{ if(e.target.closest('a,.sig')) return; e.preventDefault(); });
cardEl.addEventListener('keydown', e=>{ if(e.target!==cardEl) return; if(e.key===' '||e.key==='Enter'){e.preventDefault();flipped=!flipped;renderCard();} });
document.getElementById('next').onpointerdown=e=>{ if(e.button) return; if(!order.length) return; idx=(idx+1)%order.length; flipped=false; editing=false; renderCard(); };
document.getElementById('prev').onpointerdown=e=>{ if(e.button) return; if(!order.length) return; idx=(idx-1+order.length)%order.length; flipped=false; editing=false; renderCard(); };
document.getElementById('shuffle').onclick=()=>{ shuffle(order); idx=0; flipped=false; editing=false; renderCard(); };
document.getElementById('star').onclick=()=>{ const c=order[idx]; if(!c) return; if(stars[c.photo]) delete stars[c.photo]; else stars[c.photo]=1; saveStars(); renderCard(); };
document.getElementById('edit').onclick=()=>{ if(!order[idx]) return; if(!me){ askName(); return; } openInDir(order[idx].photo, true); };
document.addEventListener('keydown', e=>{ if(mode!=='learn'||view!=='cards'||editing||['INPUT','TEXTAREA'].includes(e.target.tagName)) return; if(e.key==='ArrowRight') document.getElementById('next').onpointerdown({button:0}); if(e.key==='ArrowLeft') document.getElementById('prev').onpointerdown({button:0}); });

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
const quizEl=document.getElementById('quizbody');
let drun=[], di=0, dflip=false, dres={}, dirty=false, smart=true;
function weight(c){ const x=(S.drill[me]||{})[c.photo]; if(!x) return 3; const r=x.r||(x.last==='ok'?5:x.last==='some'?3:1); const s=x.streak||0; if(r<=1) return 4.5; if(r===2) return 3.5; if(r===3) return 2.5; if(r===4) return 1.4; return s>=4?0.25:s>=2?0.6:1.2; }
function startDrill(){
  const p=pool(); di=0; dflip=false; dres={};
  if(!smart||!me){ drun=shuffle(p); return; }
  // weighted sample without replacement: weak/unknown first, but everyone can still show up
  const items=p.map(c=>({c,w:weight(c)})); const out=[];
  while(items.length){ let tot=items.reduce((a,b)=>a+b.w,0); let r=Math.random()*tot; let i=0; for(;i<items.length;i++){ r-=items[i].w; if(r<=0) break; } out.push(items.splice(Math.min(i,items.length-1),1)[0].c); }
  drun=out;
}
function myDrill(){ return (S.drill[me]=S.drill[me]||{}); }
async function saveDrill(){
  if(!Object.keys(dres).length) return true;
  const snap=dres; dres={};
  const ok=await commit(null, st=>{ st.drill=st.drill||{}; const d=st.drill[me]=st.drill[me]||{}; for(const [p,r] of Object.entries(snap)){ const x=d[p]=d[p]||{ok:0,some:0,miss:0}; const rt=typeof r==='number'?r:(r==='ok'?5:r==='some'?3:1); x.r=rt; x.n=(x.n||0)+1; x.sum=(x.sum||0)+rt; if(rt>=4){x.ok++; x.streak=rt===5?(x.streak||0)+1:0;} else if(rt>=2){x.some=(x.some||0)+1; x.streak=0;} else {x.miss++; x.streak=0;} x.last=rt>=4?'ok':rt>=2?'some':'miss'; x.at=when(); } });
  if(!ok) dres=Object.assign(snap,dres);
  return ok;
}
function renderQuiz(){
  document.getElementById('q-fn').setAttribute('aria-pressed',qkind==='fn'); document.getElementById('q-nf').setAttribute('aria-pressed',qkind==='nf');
  if(!drun.length) startDrill();
  { const p=pool(); const d=S.drill[me]||{}; const solid=p.filter(c=>{const x=d[c.photo]; return x&&x.last==='ok'&&(x.streak||0)>=2;}).length, shaky=p.filter(c=>{const x=d[c.photo]; return x&&(x.last!=='ok'||(x.streak||0)<2);}).length, never=p.length-solid-shaky;
    document.getElementById('recall').innerHTML=me?`Recall: <b>${solid}</b> solid (2+ in a row) · <b>${shaky}</b> shaky · <b>${never}</b> never drilled${smart?' · smart order puts shaky and new ones first':''}`:'Pick your name to track recall.'; }
  if(!drun.length){ quizEl.innerHTML='<div class="reveal">Nothing in this set.</div>'; return; }
  if(di>=drun.length){
    const vals=Object.values(dres); const got=vals.filter(r=>r===5).length, some=vals.filter(r=>r>=2&&r<5).length, tot=vals.length; const avg=tot?(vals.reduce((a,b)=>a+b,0)/tot).toFixed(1):'0';
    quizEl.innerHTML=`<div class="reveal"><div class="big">${avg}<small> avg / 5 · ${got} perfect · ${some} partial</small></div>Anything under 5 got starred. ${me?'Saving this run to your record…':'Pick your name to save this run.'}</div><div class="ctrl"><button class="btn primary" id="again">Run it again</button></div>`;
    document.getElementById('again').onclick=()=>{ startDrill(); renderQuiz(); };
    saveDrill().then(ok=>{ const r=quizEl.querySelector('.reveal'); if(r) r.innerHTML=`<div class="big">${avg}<small> avg / 5 · ${got} perfect · ${some} partial</small></div>${ok?'Saved to your record.':'Not saved (see message).'}`; });
    return;
  }
  const c=drun[di]; const rec=(S.drill[me]||{})[c.photo];
  const hist = rec ? `<span>last ${rec.r||'?'}/5 · avg ${rec.n?(rec.sum/rec.n).toFixed(1):'?'} over ${rec.n||rec.ok+rec.miss+(rec.some||0)}${rec.streak>1?' · streak '+rec.streak:''}</span>` : '<span>never drilled</span>';
  const front = qkind==='fn' ? `<img src="${IMG(c.photo)}" alt="who is this"><div class="prompt">Say their name, then flip · ${di+1} / ${drun.length}</div>` : `<div class="prompt">Picture their face, then flip · ${di+1} / ${drun.length}</div><h2>${esc(c.name)}</h2>`;
  const rows=FIELDS.filter(([k])=>k!=='cls').map(([k,l])=>[l,c[k]]).concat(Object.entries(c.extra||{})).filter(([k,v])=>v);
  const back = `<div class="back" style="text-align:left;padding:0"><img src="${IMG(c.photo)}" alt=""><div><h2>${esc(c.name)}</h2><span class="tag">${esc(c.cls)}</span></div><div class="facts">${rows.map(([k,v])=>`<div><b>${esc(k)}</b><span>${esc(v)}</span></div>`).join('')||'<div class="empty">No facts filled in yet.</div>'}</div></div>`;
  quizEl.innerHTML=`<div class="card" id="dcard" style="padding:14px;text-align:center">${dflip?back:front}</div>
    ${dflip?`<div class="legend" style="text-align:center;margin-top:10px">How much did you know? 1 = nothing · 5 = everything</div><div class="opts" style="grid-template-columns:repeat(5,1fr);gap:6px">${[1,2,3,4,5].map(r=>`<button class="opt rate" data-r="${r}" style="padding:16px 4px;font-size:22px;border-color:${['#B23A3A','#C96A3A','#C79A2B','#7FA84A','#1F7A4D'][r-1]};box-shadow:inset 0 0 0 2px ${['#B23A3A','#C96A3A','#C79A2B','#7FA84A','#1F7A4D'][r-1]}">${r}</button>`).join('')}</div><div class="legend" style="display:flex;justify-content:space-between"><span>name wrong</span><span>name only</span><span>some facts</span><span>most</span><span>all</span></div>`:`<div class="ctrl"><button class="btn primary" id="dflip">Flip</button></div>`}
    <div class="score">${hist}<span>${Object.keys(dres).length} rated this run</span></div>`;
  const flip=()=>{ dflip=true; renderQuiz(); };
  if(!dflip){ quizEl.querySelector('#dcard').onpointerdown=e=>{ if(!e.button) flip(); }; quizEl.querySelector('#dflip').onpointerdown=e=>{ if(!e.button) flip(); }; }
  else {
    quizEl.querySelectorAll('.rate').forEach(b=>b.onpointerdown=e=>{ if(e.button) return; const r=+b.dataset.r; dres[c.photo]=r; if(r<5){ stars[c.photo]=1; saveStars(); } di++; dflip=false; renderQuiz(); });
  }
}
document.addEventListener('keydown', e=>{ if(mode!=='quiz'||['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)) return; const fire=id=>{ const b=quizEl.querySelector(id); if(b&&b.onpointerdown) b.onpointerdown({button:0}); }; if(e.key===' '){ e.preventDefault(); fire('#dflip'); } if('12345'.includes(e.key)&&e.key){ const b=quizEl.querySelector('.rate[data-r="'+e.key+'"]'); if(b) b.onpointerdown({button:0}); } });

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
  const rows=FIELDS.map(([k,l])=>[l,c[k]]).concat(Object.entries(c.extra||{}));
  rows.push(['LinkedIn', c.li?`<a href="https://www.linkedin.com/in/${esc(c.li)}/" target="_blank" rel="noopener">linkedin.com/in/${esc(c.li)}</a>`:'', true]);
  return `<div id="dirdetail" class="card" style="margin-top:12px;cursor:default"><div class="back"><img src="${IMG(c.photo)}" alt=""><div><h2>${esc(c.name)}</h2>${c.alias?`<div class="alias">${esc(c.alias)}</div>`:''}<span class="tag">${esc(c.cls)}</span></div><div class="facts">${rows.map(([k,v,raw])=>`<div><b>${esc(k)}</b><span>${v?(raw?v:esc(v)):'<span class="empty">not filled in yet</span>'}</span></div>`).join('')}</div>${sigHtml(c)}</div></div>
    <div class="ctrl"><button class="btn" id="dirclose">Close</button><button class="btn primary" id="diredit">${dirEdit?'Close editor':'✎ Edit this brother'}</button></div><div id="direditor" ${dirEdit?'':'hidden'}></div>`;
}

// ---------- grid ----------
const gridEl=document.getElementById('grid');
function renderGrid(){
  gridEl.innerHTML=pool().map(c=>`<button class="tile" data-p="${c.photo}" data-star="${stars[c.photo]?1:0}"><img src="${IMG(c.photo)}" alt=""><div>${esc(c.name)}<small>${esc(c.cls)}</small></div></button>`).join('');
}
gridEl.addEventListener('click', e=>{ const t=e.target.closest('.tile'); if(!t) return; view='cards'; resetOrder(); idx=order.findIndex(c=>c.photo===t.dataset.p); flipped=true; render(); window.scrollTo({top:0}); });

// ---------- recite ----------
const recEl=document.getElementById('recite');
let pIdx=0, recog=null, recording=false, heardFinal='', heardInterim='', recMode='mic', hidePassage=false;
const PUNCT = [
  [/\b(semi[\s-]?colon)\b/gi,' ; '],[/\b(full[\s-]?stop|period)\b/gi,' . '],[/\bcomma\b/gi,' , '],[/\bcolon\b/gi,' : '],
  [/\b(open|opening|begin) quote\b/gi,' " '],[/\b(close|closing|end) quote\b/gi,' " '],[/\bquote\b/gi,' " '],[/\bquotation( mark)?\b/gi,' " '],
  [/\bhyphen\b/gi,' - '],[/\bdash\b/gi,' - ']
];
function tokens(text){
  // returns [{w, p:bool}] words and punctuation tokens
  return (text.match(/[A-Za-z0-9']+|[;:,."\-]/g)||[]).map(w=>({w, p:/^[;:,."\-]$/.test(w), n:/^[;:,."\-]$/.test(w)?w:w.toLowerCase().replace(/[^a-z0-9]/g,'')}));
}
function spokenToTokens(text){
  let t=' '+text+' '; for(const [re,rep] of PUNCT) t=t.replace(re,rep);
  return tokens(t);
}
function lev(a,b){ const m=a.length,n=b.length; if(!m) return n; if(!n) return m; let prev=[...Array(n+1).keys()]; for(let i=1;i<=m;i++){ const cur=[i]; for(let j=1;j<=n;j++){ cur[j]=Math.min(prev[j]+1,cur[j-1]+1,prev[j-1]+(a[i-1]===b[j-1]?0:1)); } prev=cur; } return prev[n]; }
function sim(a,b){ if(a.p&&b.p) return a.w===b.w?1:0; if(a.p||b.p) return 0; const A=a.n,B=b.n; if(A===B) return 1; if(A.length<3||B.length<3) return A===B?1:0; const d=lev(A,B); return 1-d/Math.max(A.length,B.length); }
function grade(ref, said){
  // LCS-style alignment with fuzzy match; returns per-ref-token status and stats
  const R=ref, H=said, m=R.length, n=H.length;
  const dp=Array.from({length:m+1},()=>new Float64Array(n+1));
  for(let i=m-1;i>=0;i--) for(let j=n-1;j>=0;j--){ const s=sim(R[i],H[j]); const take = s>=0.72 ? s+dp[i+1][j+1] : 0; dp[i][j]=Math.max(dp[i+1][j],dp[i][j+1],take); }
  const status=new Array(m).fill('miss'); let i=0,j=0, extras=0;
  while(i<m&&j<n){ const s=sim(R[i],H[j]); if(s>=0.72 && s+dp[i+1][j+1]>=dp[i][j]-1e-6){ status[i]= s>=0.99?'ok':'near'; i++; j++; } else if(dp[i+1][j]>=dp[i][j+1]){ i++; } else { j++; extras++; } }
  extras += n-j;
  const words=R.filter(t=>!t.p).length, puncts=R.filter(t=>t.p).length;
  let wOk=0,pOk=0; R.forEach((t,k)=>{ if(status[k]!=='miss'){ if(t.p) pOk++; else wOk++; } });
  const pct = Math.round(100*(wOk+pOk*0.5)/(words+puncts*0.5) - Math.min(15, extras*0.5));
  return {status, words, puncts, wOk, pOk, extras, pct:Math.max(0,pct)};
}
function stopRec(){ if(recog){ try{ recog.stop(); }catch(e){} } recording=false; }
function renderRecite(){
  const P=S.passages; const p=P[pIdx]; const ref=tokens(p.text);
  const SR = window.SpeechRecognition||window.webkitSpeechRecognition;
  const mine = S.recitals.filter(r=>r.who===me&&r.passage===p.id).map(r=>r.pct); const best = mine.length?Math.max(...mine):null;
  recEl.innerHTML=`
    <div class="sub">${P.map((x,i)=>`<button data-pi="${i}" aria-pressed="${i===pIdx}">${esc(x.title)}</button>`).join('')}</div>
    <div class="passage ${hidePassage?'hide':''}" id="ptext"><p>${ref.map((t,k)=>`<span class="tk" data-k="${k}">${esc(t.w)}</span>`).join(' ').replace(/ ([;:,.])/g,'$1')}</p></div>
    <div class="ctrl"><button class="btn" id="hideP">${hidePassage?'Show text':'Hide text'}</button><button class="btn" id="mMic" aria-pressed="${recMode==='mic'}">🎙 Speak</button><button class="btn" id="mType" aria-pressed="${recMode==='type'}">⌨ Type</button></div>
    <div class="legend">Say punctuation out loud: <b>quote</b> at the start and end, <b>semicolon</b>, <b>comma</b>, <b>full stop</b> (or "period"). Word for word. Pronunciation is graded leniently, punctuation is not.</div>
    ${recMode==='mic' ? `<div class="ctrl"><button class="btn primary" id="recbtn">${recording?'■ Stop':'● Start recording'}</button><button class="btn" id="clear">Clear</button></div>
      <div class="heard" id="heard">${SR?'':'Speech recognition is not available in this browser. Use Chrome or Safari, or switch to Type.'}</div>`
    : `<div class="field" style="margin-top:12px"><label>Type it from memory (punctuation included)</label><textarea id="typed" style="min-height:140px"></textarea></div>`}
    <div class="ctrl"><button class="btn ok" id="gradebtn">Check it</button></div>
    <div id="result"></div>
    <div class="editor" style="margin-top:14px"><h2>Scoreboard · ${esc(p.title)}</h2>${best!==null?`<div class="status">Your best: <b>${best}%</b> over ${mine.length} logged attempt${mine.length===1?'':'s'}</div>`:'<div class="status">No attempts yet. Every Check is logged.</div>'}
      <table class="lb"><tr><th>Pledge</th><th class="n">Best</th><th class="n">Attempts</th><th>Last</th></tr>${PC().map(n=>{ const rs=S.recitals.filter(r=>r.who===n&&r.passage===p.id); const b=rs.length?Math.max(...rs.map(r=>r.pct)):null; return `<tr><td>${esc(n)}</td><td class="n">${b===null?'—':b+'%'}</td><td class="n">${rs.length}</td><td>${rs.length?fmt(rs[0].at):'—'}</td></tr>`; }).join('')}</table>
      <div class="status">Names come from the Beta Omega roster.</div></div>`;
  recEl.querySelectorAll('[data-pi]').forEach(b=>b.onclick=()=>{ stopRec(); pIdx=+b.dataset.pi; heardFinal=heardInterim=''; renderRecite(); });
  recEl.querySelector('#hideP').onclick=()=>{ hidePassage=!hidePassage; renderRecite(); };
  recEl.querySelector('#mMic').onclick=()=>{ recMode='mic'; renderRecite(); };
  recEl.querySelector('#mType').onclick=()=>{ stopRec(); recMode='type'; renderRecite(); };
  if(recMode==='mic'){
    const heard=recEl.querySelector('#heard');
    const paint=()=>{ heard.innerHTML=esc(heardFinal)+(heardInterim?`<span class="interim"> ${esc(heardInterim)}</span>`:''); };
    if(heardFinal||heardInterim) paint();
    recEl.querySelector('#clear').onclick=()=>{ heardFinal=heardInterim=''; paint(); recEl.querySelector('#result').innerHTML=''; };
    recEl.querySelector('#recbtn').onclick=()=>{
      if(recording){ stopRec(); renderRecite(); return; }
      if(!SR){ toast('No speech recognition here. Switch to Type.'); return; }
      recog=new SR(); recog.lang='en-US'; recog.continuous=true; recog.interimResults=true;
      recog.onresult=e=>{ let fin='',inter=''; for(let i=e.resultIndex;i<e.results.length;i++){ const r=e.results[i]; if(r.isFinal) fin+=r[0].transcript+' '; else inter+=r[0].transcript+' '; } if(fin) heardFinal+=fin; heardInterim=inter; paint(); };
      recog.onerror=e=>{ recording=false; const msg = e.error==='not-allowed'||e.error==='service-not-allowed' ? 'Mic blocked. Allow the microphone for this page, or open the link in a new tab, or use Type.' : 'Mic error: '+e.error; toast(msg); renderRecite(); };
      recog.onend=()=>{ if(recording){ try{ recog.start(); }catch(e){ recording=false; renderRecite(); } } };
      try{ recog.start(); recording=true; renderRecite(); }catch(e){ toast('Could not start the mic: '+e.message); }
    };
  }
  recEl.querySelector('#gradebtn').onclick=async()=>{
    stopRec();
    const saidText = recMode==='mic' ? (heardFinal+' '+heardInterim) : recEl.querySelector('#typed').value;
    const said = recMode==='mic' ? spokenToTokens(saidText) : tokens(saidText);
    if(!said.length){ toast('Nothing to grade yet.'); return; }
    const g=grade(ref, said);
    hidePassage=false; recEl.querySelector('#ptext').classList.remove('hide');
    recEl.querySelectorAll('.tk').forEach(el=>{ el.classList.remove('ok','miss','near'); el.classList.add(g.status[+el.dataset.k]); });
    const missed = ref.filter((t,k)=>g.status[k]==='miss');
    recEl.querySelector('#result').innerHTML=`<div class="reveal"><div class="big">${g.pct}%<small> · ${g.wOk}/${g.words} words · ${g.pOk}/${g.puncts} punctuation · ${g.extras} extra</small></div>
      <div class="legend"><span class="tk ok">green</span> exact <span class="tk near">yellow</span> close enough <span class="tk miss">red</span> missed</div>
      ${missed.length?`<div style="margin-top:8px;font-size:13px">Missed: ${missed.slice(0,40).map(t=>esc(t.w)).join(' · ')}${missed.length>40?' …':''}</div>`:'<div style="margin-top:8px;font-weight:600;color:var(--good)">Word perfect.</div>'}
      <div class="status" id="logst">Logging this attempt to your record…</div></div>`;
    const ok=await commit(null, st=>{ st.recitals.unshift({who:me,at:when(),passage:p.id,pct:g.pct}); if(st.recitals.length>400) st.recitals.length=400; });
    const ls=recEl.querySelector('#logst'); if(ls) ls.textContent = ok ? 'Logged to your record ('+g.pct+'%). Every check counts, so no free tries.' : 'Not logged (see message).';
  };
}

// ---------- sig tasks (stored on each brother's card as c.sig) ----------
const SIG=['none','requested','confirmed','done','signed'];
const SIGL={none:'Not asked',requested:'Requested',confirmed:'Confirmed',done:'Done, needs signature',signed:'Signed'};
const SIG_TARGET={pct:75, by:'2026-10-11'};
const sigOf = c => (c&&c.sig)||{status:'none'};
const sigCards = () => S.cards.filter(c=>c.sig);
const mdy = iso => +iso.slice(5,7)+'/'+ +iso.slice(8,10);
function sigProgress(){ const all=sigCards(), k=all.filter(c=>sigOf(c).status==='signed').length, tgt=Math.ceil(all.length*SIG_TARGET.pct/100); return `Signed ${k} of ${all.length} · target ${SIG_TARGET.pct}% (${tgt}) by ${mdy(SIG_TARGET.by)}`; }
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
    <button class="sigtask" data-sigtask title="Edit the task">${g.task?esc(g.task):'<span class="empty">No task text yet</span>'} <span class="pen">✎</span></button>${g.notes?`<div class="status">${esc(g.notes)}</div>`:''}
    <div class="sigedit"><label>Owner<select data-sigowner><option value="">No owner</option>${PC().map(n=>`<option value="${esc(n)}" ${g.owner===n?'selected':''}>${esc(n)}</option>`).join('')}</select></label>
      <label>Difficulty<select data-sigdiff><option value="">—</option>${[1,2,3,4,5,6,7,8,9,10].map(d=>`<option ${+g.difficulty===d?'selected':''}>${d}</option>`).join('')}</select></label></div>
    <div class="ctrl">${i>0?`<button class="btn" data-sigback style="flex:0 0 auto">← Back</button>`:''}${i<SIG.length-1?`<button class="btn" data-signext>Next step → ${esc(SIGL[SIG[i+1]])}</button>`:''}</div></div>`;
}
function bindSig(root, rerender){
  const ph=el=>el.closest('[data-sig]').dataset.sig, run=async p=>{ if(await p) rerender(); };
  root.querySelectorAll('[data-signext]').forEach(b=>b.onclick=()=>{ b.disabled=true; run(sigStep(ph(b),1)); });
  root.querySelectorAll('[data-sigback]').forEach(b=>b.onclick=()=>{ b.disabled=true; run(sigStep(ph(b),-1)); });
  root.querySelectorAll('[data-sigowner]').forEach(x=>x.onchange=()=>run(sigSet(ph(x),{owner:x.value})));
  root.querySelectorAll('[data-sigdiff]').forEach(x=>x.onchange=()=>run(sigSet(ph(x),{difficulty:x.value?+x.value:''})));
  root.querySelectorAll('[data-sigtask]').forEach(b=>b.onclick=()=>{ const g=sigOf(S.cards.find(x=>x.photo===ph(b))); const v=prompt('Sig task',g.task||''); if(v===null||v.trim()===(g.task||'')) return; run(sigSet(ph(b),{task:v.trim()})); });
  root.querySelectorAll('[data-open]').forEach(b=>b.onclick=()=>openInDir(ph(b)));
}
const sigsEl=document.getElementById('sigs');
let sigMine=false;
function renderSigs(){
  const list=sigCards().filter(c=>!sigMine||sigOf(c).owner===me), nm=(a,b)=>a.name.localeCompare(b.name);
  const cols=[['To request',['none','requested'],(a,b)=>SIG.indexOf(sigOf(a).status)-SIG.indexOf(sigOf(b).status)||nm(a,b)],
    ['In progress',['confirmed','done'],(a,b)=>(+sigOf(a).difficulty||99)-(+sigOf(b).difficulty||99)||nm(a,b)],
    ['Signed',['signed'],(a,b)=>(sigOf(b).signedAt||'')<(sigOf(a).signedAt||'')?-1:1]];
  const row=c=>{ const g=sigOf(c); return `<div class="sigr" data-sig="${esc(c.photo)}"><button class="nm" data-open>${esc(c.name)}<small>${esc(c.cls.split(' (')[0])} · ${g.owner?esc(first(g.owner)):'no owner'}</small></button>${sigDiff(g.difficulty)}${sigChip(g.status)}${g.status!=='signed'?`<button class="nx" data-signext aria-label="Next step">→</button>`:''}</div>`; };
  sigsEl.innerHTML=`<div class="status" style="margin-top:14px"><b>${esc(sigProgress())}</b></div>
    <div class="chips"><button class="chip" data-sm="0" aria-pressed="${!sigMine}">All</button><button class="chip" data-sm="1" aria-pressed="${sigMine}">Mine</button></div>
    <div class="sigcols">${cols.map(([h,sts,sort])=>{ const xs=list.filter(c=>sts.includes(sigOf(c).status)).sort(sort); return `<div><h3 class="sec">${h} <small>${xs.length}</small></h3>${xs.map(row).join('')||'<div class="status">None</div>'}</div>`; }).join('')}</div>
    <div class="status">Tap a name to open the brother. → moves the sig task to its next step.</div>`;
  sigsEl.querySelectorAll('[data-sm]').forEach(b=>b.onclick=()=>{ sigMine=b.dataset.sm==='1'; renderSigs(); });
  bindSig(sigsEl, renderSigs);
}

// ---------- tasks ----------
const tasksEl=document.getElementById('tasks');
const WDAYS=['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
const dow = iso => new Date(iso+'T12:00:00').getDay();
const dueText = iso => { if(!iso) return ''; const t=today(); if(iso===t) return 'Today'; if(iso===addDays(t,1)) return 'Tomorrow'; return new Date(iso+'T12:00:00').toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'}).replace(',',''); };
const first = n => String(n).split(' ')[0];
const whoText = who => who&&who.length ? who.map(n=>`#${PNUM(n)} ${first(n)}`).join(', ') : 'Whole class';
function atWho(t){
  t=t.toLowerCase().replace(/[^a-z0-9-]/g,''); const R=SEED.roster||[];
  if(t==='me') return me||null;
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
function parseTask(line, base){
  base=base||today(); const who=[], bad=[], rest=[];
  for(const w of String(line).replace(/^\s*([-*•]|\d+[.)])\s+/,'').trim().split(/\s+/)){ if(/^@\S+/.test(w)){ const n=atWho(w.slice(1)); if(n){ if(!who.includes(n)) who.push(n); } else bad.push(w); } else if(w) rest.push(w); }
  const d=parseDue(rest, base); if(d) rest.splice(rest.length-d.n);
  return {title:rest.join(' '), who, due:d?d.due:addDays(base,1), bad};
}
const previewText = p => p.bad.length ? `Unknown: ${p.bad.join(' ')} (use @number, @first name or @me)` : `For: ${whoText(p.who)} · Due ${dueText(p.due)}`;
const newTask = p => Object.assign({id:uid(),title:p.title,due:p.due,notes:'',by:me,at:when(),done:{}}, p.who.length?{who:p.who}:{});
async function addTasks(ps){
  const ok=await commit({who:me,at:when(),card:'Tasks',changes:ps.map(p=>({field:'Added task',from:'',to:p.title+' ('+whoText(p.who)+', due '+p.due+')'}))}, st=>{ for(const p of ps) st.tasks.push(newTask(p)); });
  if(ok){ tDraft=''; render(); } return ok;
}
let tDraft='', tEdit=null, tWho=[];
function undoToast(text, onUndo){
  document.querySelectorAll('.toast').forEach(x=>x.remove()); const d=document.createElement('div'); d.className='toast'; d.innerHTML=`${esc(text)} <button>Undo</button>`; document.body.appendChild(d);
  const t=setTimeout(()=>d.remove(),5000); d.querySelector('button').onclick=()=>{ clearTimeout(t); d.remove(); onUndo(); };
}
function taskHtml(t){
  const as=t.who&&t.who.length?t.who:PC(), n=as.filter(x=>isDone(t,x)).length, mine=!!me&&isFor(t,me), meDone=isDone(t,me);
  const late=t.due&&t.due<today()&&(mine?!meDone:n<as.length);
  if(tEdit===t.id) return `<div class="task" data-id="${esc(t.id)}"><div class="field"><label>Task</label><input id="et" value="${esc(t.title)}"></div>
    <div class="field"><label>Due</label><input id="ed" type="date" value="${esc(t.due||'')}"></div>
    <div class="field"><label>Who</label><div class="chips" style="margin-top:0"><button class="chip" data-ew="" aria-pressed="${!tWho.length}">Whole class</button>${(SEED.roster||[]).map(r=>`<button class="chip" data-ew="${esc(r.name)}" aria-pressed="${tWho.includes(r.name)}">#${r.n} ${esc(first(r.name))}</button>`).join('')}</div></div>
    <div class="field"><label>Notes</label><textarea id="en">${esc(t.notes||'')}</textarea></div>
    <div class="ctrl"><button class="btn" id="ecancel">Cancel</button><button class="btn primary" id="esave">Save</button></div></div>`;
  return `<div class="task ${(mine?meDone:n>=as.length)?'done':''}" data-id="${esc(t.id)}"><div class="t">${mine?`<label class="ck"><input type="checkbox" data-tog ${meDone?'checked':''} aria-label="Mark done"></label>`:''}<button class="ttl" data-edit>${esc(t.title)}</button><button class="x" data-del aria-label="Delete task">×</button></div>
    ${t.notes?`<div class="notes">${esc(t.notes)}</div>`:''}
    <div class="bar"><i style="width:${Math.round(100*n/as.length)}%"></i></div>
    <div class="meta"><span class="due ${late?'late':''}">${late?'Overdue · ':'Due '}${esc(dueText(t.due))}</span><button class="small" data-show aria-label="Who's done">${n}/${as.length} done · ${esc(whoText(t.who))} ▾</button></div>
    <div class="who" data-who hidden>${as.map(x=>`<span class="${isDone(t,x)?'':'no'}">${isDone(t,x)?'✓ ':''}${esc(first(x))}</span>`).join('')}</div></div>`;
}
function bindTasks(el, rerender){
  const T=id=>S.tasks.find(x=>x.id===id), idOf=b=>b.closest('[data-id]').dataset.id;
  el.querySelectorAll('[data-tog]').forEach(b=>b.onchange=async()=>{ if(!me){askName();return;} const t=T(idOf(b)), was=isDone(t,me); b.disabled=true;
    await commit({who:me,at:when(),card:'Tasks',changes:[{field:t.title,from:was?'done':'not done',to:was?'not done':'done'}]},st=>{ const x=st.tasks.find(y=>y.id===t.id); x.done=x.done||{}; if(was) delete x.done[me]; else x.done[me]=when(); }); rerender(); });
  el.querySelectorAll('[data-show]').forEach(b=>b.onclick=()=>{ const w=b.closest('.task').querySelector('[data-who]'); w.hidden=!w.hidden; });
  el.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>{ const t=T(idOf(b)); tEdit=t.id; tWho=(t.who||[]).slice(); rerender(); const i=el.querySelector('#et'); if(i){ i.focus(); i.setSelectionRange(i.value.length,i.value.length); } });
  el.querySelectorAll('[data-del]').forEach(b=>b.onclick=async()=>{ const t=T(idOf(b)), keep=Object.assign({},t); delete keep._k;
    const ok=await commit({who:me,at:when(),card:'Tasks',changes:[{field:'Deleted task',from:t.title,to:''}]},st=>{ st.tasks=st.tasks.filter(x=>x.id!==t.id); }); rerender();
    if(ok) undoToast('Deleted "'+t.title+'"', async()=>{ await commit({who:me,at:when(),card:'Tasks',changes:[{field:'Restored task',from:'',to:t.title}]},st=>{ st.tasks.push(keep); }); rerender(); }); });
  const ed=el.querySelector('[data-id] #et'); if(!ed) return;
  el.querySelectorAll('[data-ew]').forEach(b=>b.onclick=()=>{ const n=b.dataset.ew; if(!n) tWho=[]; else tWho=tWho.includes(n)?tWho.filter(x=>x!==n):tWho.concat(n);
    el.querySelectorAll('[data-ew]').forEach(c=>c.setAttribute('aria-pressed', c.dataset.ew ? tWho.includes(c.dataset.ew) : !tWho.length)); });
  const save=async()=>{ const t=T(tEdit); if(!t){ tEdit=null; rerender(); return; } const title=ed.value.trim(), due=el.querySelector('#ed').value, notes=el.querySelector('#en').value.trim(); if(!title){ ed.focus(); return; }
    const who=(SEED.roster||[]).map(r=>r.name).filter(n=>tWho.includes(n)), ch=[];
    if(title!==t.title) ch.push({field:'Task',from:t.title,to:title}); if(due!==(t.due||'')) ch.push({field:t.title+' · due',from:t.due||'',to:due}); if(notes!==(t.notes||'')) ch.push({field:t.title+' · notes',from:t.notes||'',to:notes});
    if(whoText(who)!==whoText(t.who)) ch.push({field:t.title+' · who',from:whoText(t.who),to:whoText(who)});
    if(ch.length){ const ok=await commit({who:me,at:when(),card:'Tasks',changes:ch},st=>{ const x=st.tasks.find(y=>y.id===t.id); Object.assign(x,{title,due,notes}); if(who.length) x.who=who; else delete x.who; }); if(!ok) return; }
    tEdit=null; rerender(); };
  el.querySelector('#esave').onclick=save; el.querySelector('#ecancel').onclick=()=>{ tEdit=null; rerender(); };
  ed.onkeydown=e=>{ if(e.key==='Enter'){ e.preventDefault(); save(); } if(e.key==='Escape'){ tEdit=null; rerender(); } };
}
function renderTasks(){
  const byDue=(a,b)=>(a.due||'9999')<(b.due||'9999')?-1:(a.due||'9999')>(b.due||'9999')?1:0;
  const L=S.tasks.slice().sort(byDue), mine=L.filter(t=>me&&(t.who||[]).includes(me)), all=L.filter(t=>!(t.who||[]).length), other=L.filter(t=>(t.who||[]).length&&!(t.who||[]).includes(me));
  const sec=(h,ts,empty)=>ts.length||empty?`<h3 class="sec">${h} <small>${ts.length}</small></h3>${ts.map(taskHtml).join('')||`<div class="reveal">${empty}</div>`}`:'';
  const focused=document.activeElement&&document.activeElement.id==='tq';
  tasksEl.innerHTML=`<div class="field" style="margin-top:14px"><input id="tq" placeholder="Add a task…" autocomplete="off" enterkeyhint="done" value="${esc(tDraft)}"><div class="status" id="tprev">${tDraft.trim()?esc(previewText(parseTask(tDraft))):'@4 or @Tim to assign · fri, 10/12, in 3 days to set a due date · Enter to add'}</div></div>
    ${sec('Mine',mine,'Nothing assigned just to you.')}${sec('Whole class',all,'No class tasks yet.')}${sec('Assigned to others',other)}`;
  const q=tasksEl.querySelector('#tq'), pv=tasksEl.querySelector('#tprev');
  if(focused){ q.focus(); q.setSelectionRange(q.value.length,q.value.length); }
  q.oninput=()=>{ tDraft=q.value; pv.textContent=tDraft.trim()?previewText(parseTask(tDraft)):''; };
  q.onkeydown=async e=>{ if(e.key!=='Enter') return; e.preventDefault(); const p=parseTask(q.value); if(p.bad.length){ toast(previewText(p)); return; } if(!p.title) return; q.disabled=true; if(!await addTasks([p])) q.disabled=false; };
  q.onpaste=async e=>{ const lines=(e.clipboardData||window.clipboardData).getData('text').split(/\r?\n/).map(x=>x.trim()).filter(Boolean); if(lines.length<2) return; e.preventDefault();
    const ps=lines.map(l=>parseTask(l)).filter(p=>p.title); const bad=ps.filter(p=>p.bad.length);
    if(!confirm(`Add ${ps.length} tasks?\n\n`+ps.map(p=>`• ${p.title} (${previewText(p)})`).join('\n')+(bad.length?`\n\n${bad.length} line(s) have unknown @names; those are ignored.`:''))) return;
    ps.forEach(p=>p.bad=[]); await addTasks(ps); };
  bindTasks(tasksEl, renderTasks);
}

// ---------- accountability ----------
const acctEl=document.getElementById('acct');
function renderAcct(){
  const pc=PC(); const total=S.cards.length; const P=S.passages;
  const solidOf=n=>Object.values(S.drill[n]||{}).filter(x=>x.last==='ok'&&(x.streak||0)>=2).length;
  const rows=pc.map(n=>{
    const solid=solidOf(n);
    const spell=ROLLS.map(r=>rollBest(n,r.cls));
    const rec=P.map(p=>{ const rs=S.recitals.filter(r=>r.who===n&&r.passage===p.id); return rs.length?Math.max(...rs.map(r=>r.pct)):null; });
    const mine=S.tasks.filter(t=>isFor(t,n)), done=mine.filter(t=>isDone(t,n)).length;
    const hits=(solid>=total?1:0)+spell.concat(rec).filter(b=>b===100).length+(mine.length&&done===mine.length?1:0);
    return {n,solid,spell,rec,done,assigned:mine.length,hits};
  }).sort((a,b)=>b.hits-a.hits||b.solid-a.solid);
  const pctCell=b=>`<td class="n${b===100?' hit':''}">${b===null?'—':b+'%'}</td>`;
  acctEl.innerHTML=`<div class="editor" style="margin-top:12px"><h2>Where everyone stands</h2>
    <div class="status">Green = target hit. Faces = brothers rated 5 twice in a row. Spell and Recite = best score (target 100%). Tasks = done / assigned.</div>
    <div style="overflow-x:auto"><table class="lb"><tr><th>Pledge</th><th class="n">Faces</th>${ROLLS.map(r=>`<th class="n">${esc(r.cls.replace('Beta ',''))}</th>`).join('')}${P.map(p=>`<th class="n">${esc(p.title.replace('Ideal ',''))}</th>`).join('')}<th class="n">Tasks</th></tr>
    ${rows.map(r=>`<tr><td>${esc(r.n.split(' ')[0])}${r.n===me?' <b>(you)</b>':''}</td><td class="n${r.solid>=total?' hit':''}">${r.solid}/${total}</td>${r.spell.map(pctCell).join('')}${r.rec.map(pctCell).join('')}<td class="n${r.assigned&&r.done===r.assigned?' hit':''}">${r.done}/${r.assigned}</td></tr>`).join('')}</table></div>
    <div class="status">Spell columns: Psi, Chi, Phi, Upsilon rolls. Recite columns: Purpose, Ideal Member, Ideal Chapter.</div></div>
    ${me&&S.drill[me]?`<div class="editor" style="margin-top:12px"><h2>Your weak spots</h2><div class="grid" style="margin-top:6px">${S.cards.filter(c=>{const x=S.drill[me][c.photo]; return x&&x.last!=='ok';}).map(c=>{const x=S.drill[me][c.photo]; return `<div class="tile"><img src="${IMG(c.photo)}" alt=""><div>${esc(c.name)}<small>${x.last==='miss'?'name wrong':'facts shaky'} · ${x.miss} wrong · ${x.some||0} partial</small></div></div>`;}).join('')||'<div class="status">No misses on record. Either you are cracked or you have not drilled.</div>'}</div></div>`:''}`;
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
  factsEl.innerHTML=`<div class="factlist">${S.facts.length?S.facts.map((f,i)=>`<div class="fact"><b>${esc(f.q)}</b><div class="a hide" title="tap to reveal">${esc(f.a)}</div><div class="ctrl" style="margin-top:6px"><button class="small" data-e="${i}">Edit</button><button class="small" data-d="${i}">Delete</button></div></div>`).join(''):'<div class="reveal">No DSP facts yet. Add the ones the brothers give you. (The purpose statement and the ideal member / chapter are under Recite.)</div>'}</div>
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
const weekStart = iso => addDays(iso, -((dow(iso)+6)%7));
const nextMeeting = iso => addDays(iso, (7-dow(iso))%7);
const daysBetween = (a,b) => Math.round((new Date(b+'T12:00:00')-new Date(a+'T12:00:00'))/864e5);
const doneDay = (t,n) => { const x=(t.done||{})[n]; return x?isoDay(x):null; };
function planFor(n, base){
  // day-by-day plan computed from tasks: dated on their date, overdue under catch up, undated spread to the next meeting (max 3/day)
  base=base||today(); const days={}, catchup=[], undated=[], put=(d,t)=>(days[d]=days[d]||[]).push(t);
  for(const t of S.tasks.filter(t=>isFor(t,n))){ const dd=doneDay(t,n);
    if(t.due){ if(t.due>=base) put(t.due,t); else if(!dd||dd===base) catchup.push(t); }
    else if(dd){ if(dd>=base) put(dd,t); } else undated.push(t); }
  const D=daysBetween(base,nextMeeting(base))+1, N=undated.length;
  undated.sort((a,b)=>(a.at||'')<(b.at||'')?-1:1).forEach((t,i)=>put(addDays(base, N<=3*D?Math.floor(i*D/N):Math.floor(i/3)), t));
  return {catchup, days:Object.keys(days).sort().map(d=>[d,days[d]])};
}
function weekStats(names, base){
  // this week (Mon-Sun): tasks still open and due by Sunday (or undated), plus anything finished this week
  base=base||today(); const ws=weekStart(base), we=addDays(ws,6); let tot=0, done=0;
  for(const n of names) for(const t of S.tasks){ if(!isFor(t,n)) continue; const dd=doneDay(t,n); if(dd&&dd<ws) continue; if(!dd&&t.due&&t.due>we) continue; tot++; if(dd) done++; }
  return {tot, done, pct: tot?Math.round(100*done/tot):null};
}
function streakFor(n, base){
  // consecutive days (back from today) where every task due that day was done by that day; days with nothing due are skipped
  base=base||today(); let s=0;
  for(let i=0;i<90;i++){ const d=addDays(base,-i), planned=S.tasks.filter(t=>isFor(t,n)&&(t.due===d||(!t.due&&doneDay(t,n)===d))); if(!planned.length) continue;
    if(planned.every(t=>{ const dd=doneDay(t,n); return dd&&dd<=d; })) s++; else if(i) break; }
  return s;
}
const ring = pct => { const C=2*Math.PI*26, p=pct===null?0:pct; return `<svg class="ring" viewBox="0 0 64 64" width="64" height="64" aria-hidden="true"><circle cx="32" cy="32" r="26" fill="none" stroke="var(--line)" stroke-width="7"/>${p?`<circle cx="32" cy="32" r="26" fill="none" stroke="var(--ink)" stroke-width="7" stroke-linecap="round" stroke-dasharray="${(C*p/100).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 32 32)"/>`:''}<text x="32" y="37" text-anchor="middle" font-size="15" font-weight="700" fill="var(--ink)">${pct===null?'—':pct+'%'}</text></svg>`; };
const checkRow = (t,n,late) => `<div class="task" data-id="${esc(t.id)}"><div class="t"><label class="ck"><input type="checkbox" data-tog ${isDone(t,n)?'checked':''} aria-label="Mark done"></label><span class="ttl">${esc(t.title)}</span><span class="due ${late?'late':''}">${esc(dueText(t.due))}</span></div></div>`;
function renderToday(){
  if(!me){ todayEl.innerHTML=`<div class="editor"><h2>Hi there</h2><div class="status">Pick your name to see your plan.</div><div class="ctrl"><button class="btn primary" id="tpick">Pick your name</button></div></div>`; todayEl.querySelector('#tpick').onclick=askName; return; }
  const t0=today(), t1=addDays(t0,1), plan=planFor(me,t0), wk=weekStats([me],t0), cls=weekStats(PC(),t0), st=streakFor(me,t0);
  const now=S.tasks.filter(t=>isFor(t,me)&&!isDone(t,me)&&t.due&&t.due<=t0).length;
  const solid=Object.values(S.drill[me]||{}).filter(x=>x.last==='ok'&&(x.streak||0)>=2).length;
  const spell=ROLLS.filter(r=>rollBest(me,r.cls)===100).length;
  const rec=S.passages.filter(p=>S.recitals.some(r=>r.who===me&&r.passage===p.id&&r.pct===100)).length;
  const dayName = d => d===t0?'Today':d===t1?'Tomorrow':dayLabel(d);
  const goal = (d,ts) => { const k=ts.filter(t=>isDone(t,me)).length; return `${d===t0?"Today's goal":'Goal'}: ${k} of ${ts.length} done`; };
  todayEl.innerHTML=`<h2 class="hi">Hi ${esc(first(me))}</h2><div class="status">${now?`${now} task${now===1?'':'s'} due today or overdue.`:'Nothing due today.'}</div>
    <div class="meter">${ring(wk.pct)}<div><b>This week</b><div class="status" style="margin:0">${wk.done} of ${wk.tot} done · resets Monday</div><div class="status" style="margin:2px 0 0">${st}-day streak</div></div></div>
    <div class="clsbar"><span>Whole class: ${cls.pct===null?'—':cls.pct+'%'} this week</span><div class="bar"><i style="width:${cls.pct||0}%"></i></div></div>
    <div class="editor"><h2>Your progress</h2><div class="status">Faces solid <b>${solid}/${S.cards.length}</b> · Rolls spelled 100% <b>${spell}/${ROLLS.length}</b> · Recitals 100% <b>${rec}/${S.passages.length}</b></div>
      <div class="ctrl"><button class="btn primary" id="tdrill">Start drill</button></div></div>
    ${plan.catchup.length?`<h3 class="sec">Catch up <small>${plan.catchup.filter(t=>isDone(t,me)).length} of ${plan.catchup.length} done</small></h3>${plan.catchup.map(t=>checkRow(t,me,true)).join('')}`:''}
    ${plan.days.length?plan.days.map(([d,ts])=>`<h3 class="sec">${esc(dayName(d))}</h3><div class="status" style="margin:0 0 2px">${goal(d,ts)}</div>${ts.map(t=>checkRow(t,me,false)).join('')}`).join('')
      :plan.catchup.length?'':`<div class="reveal" style="margin-top:14px;text-align:center"><div class="big">Nothing due 🎉</div><div class="ctrl"><button class="btn" id="tstudy">Go to Study</button></div></div>`}`;
  todayEl.querySelector('#tdrill').onclick=()=>{ filter='all'; renderChips(); setMode('quiz'); };
  const sb=todayEl.querySelector('#tstudy'); if(sb) sb.onclick=()=>setMode(lastStudy);
  bindTasks(todayEl, renderToday);
}

// ---------- spell (roll call) ----------
const rollEl=document.getElementById('roll');
const ROLLS=SEED.rolls||[];
let rIdx=0, rDraft={};
const nw = w => w.normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
const words = t => String(t||'').replace(/\*/g,'').split(/[\s\-]+/).filter(w=>nw(w));
function rollWords(r){ return [['Class',[r.cls]],['VPPE',[r.vppe]],['Members',r.members]].map(([l,xs])=>[l,xs.map(x=>words(x))]); }
function gradeRoll(r, typed){
  // exact (normalized) LCS between expected and typed words, order matters
  const E=rollWords(r).flatMap(([,ls])=>ls.flat()), T=words(typed), m=E.length, n=T.length, a=E.map(nw), b=T.map(nw);
  const dp=Array.from({length:m+1},()=>new Int32Array(n+1));
  for(let i=m-1;i>=0;i--) for(let j=n-1;j>=0;j--) dp[i][j]= a[i]===b[j] ? dp[i+1][j+1]+1 : Math.max(dp[i+1][j],dp[i][j+1]);
  const ok=new Array(m).fill(false); let i=0,j=0; while(i<m&&j<n){ if(a[i]===b[j]){ ok[i]=true; i++; j++; } else if(dp[i+1][j]>=dp[i][j+1]) i++; else j++; }
  const hit=ok.filter(Boolean).length, extras=n-hit;
  return {ok, hit, total:m, extras, pct:Math.max(0, Math.floor(100*hit/m - 0.5*extras))};
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
      <div class="status">Full official names, in order. Capitals and accents don't matter. Target: 100% on all four classes.</div></div>
    <div id="rres"></div><div id="rboard"></div>`;
  rollEl.querySelectorAll('[data-ri]').forEach(b=>b.onclick=()=>{ rIdx=+b.dataset.ri; renderRoll(); });
  for(const [id,k] of [['rc','c'],['rv','v'],['rm','m']]) rollEl.querySelector('#'+id).oninput=e=>{ d[k]=e.target.value; };
  rollEl.querySelector('#rcheck').onclick=async()=>{
    const typed=[d.c,d.v,d.m].join('\n'); if(!words(typed).length){ toast('Type the roll first.'); return; }
    const g=gradeRoll(r,typed); let k=0;
    const line=ws=>ws.map(w=>`<span class="tk ${g.ok[k++]?'ok':'miss'}">${esc(w)}</span>`).join(' ');
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
function showErr(msg){ try{ fetch(DB+'/errors.json',{method:'POST',body:JSON.stringify({msg:String(msg).slice(0,500),at:new Date().toISOString(),who:me,mode,view,ua:navigator.userAgent.slice(0,120),build:'2026-10-06a'})}); }catch(e){} let b=document.getElementById('errbar'); if(!b){ b=document.createElement('div'); b.id='errbar'; b.style.cssText='position:fixed;left:0;right:0;bottom:0;z-index:70;background:#B23A3A;color:#fff;padding:10px 14px;font:600 13px "Public Sans",sans-serif;display:flex;gap:10px;align-items:center;justify-content:space-between'; document.body.appendChild(b); }
  b.innerHTML='<span style="flex:1;word-break:break-word">Something broke: '+esc(msg)+'</span><button onclick="location.reload()" style="border:0;background:#fff;color:#B23A3A;border-radius:8px;padding:6px 10px;font:600 13px \'Public Sans\',sans-serif;cursor:pointer">Reload</button><button onclick="document.getElementById(\'errbar\').remove()" style="border:0;background:transparent;color:#fff;font-size:18px;cursor:pointer">×</button>'; }
window.addEventListener('error', e=>{ showErr((e.message||'error')+' @'+(e.lineno||'?')); try{ render(); }catch(x){} });
window.addEventListener('unhandledrejection', e=>{ showErr('async: '+((e.reason&&e.reason.message)||e.reason||'error')); });

// ---------- render ----------
function render(){
  document.getElementById('count').textContent=`${pool().length} in this set · ${Object.keys(stars).length} starred · data v${S.version}`;
  const showChips = mode==='learn'||mode==='quiz';
  chipsEl.hidden=!showChips; document.getElementById('count').hidden=!showChips;
  for(const id of ['today','learn','quiz','roll','recite','tasks','sigs','guide','facts','acct','log']) document.getElementById(id).hidden = mode!==id;
  const tab=tabOf(mode);
  document.querySelectorAll('[role=tab]').forEach(t=>t.setAttribute('aria-selected', t.dataset.tab===tab));
  document.getElementById('studysub').hidden = tab!=='study'; document.getElementById('infosub').hidden = tab!=='info'; document.getElementById('tasksub').hidden = tab!=='tasks';
  document.querySelectorAll('#studysub [data-m],#infosub [data-m],#tasksub [data-m]').forEach(b=>b.setAttribute('aria-pressed', b.dataset.m===mode));
  if(mode==='learn'){ document.getElementById('v-cards').setAttribute('aria-pressed',view==='cards'); document.getElementById('v-grid').setAttribute('aria-pressed',view==='grid'); document.getElementById('v-dir').setAttribute('aria-pressed',view==='dir'); document.getElementById('cardwrap').hidden=view!=='cards'; gridEl.hidden=view!=='grid'; document.getElementById('dir').hidden=view!=='dir'; if(view==='cards') renderCard(); else if(view==='grid') renderGrid(); else renderDir(); }
  else if(mode==='today') renderToday();
  else if(mode==='roll') renderRoll();
  else if(mode==='quiz') renderQuiz();
  else if(mode==='acct') renderAcct();
  else if(mode==='recite') renderRecite();
  else if(mode==='tasks') renderTasks();
  else if(mode==='sigs') renderSigs();
  else if(mode==='facts') renderFacts();
  else if(mode==='guide') renderGuide();
  else if(mode==='log') renderLog();
}
renderWho(); setStatus('Loading…');
Promise.all([loadPhotos(),refresh()]).then(()=>{ renderChips(); resetOrder(); render(); if(!me) setTimeout(askName, 300); });
setInterval(()=>{ const ae=document.activeElement, typing=ae&&(ae.tagName==='TEXTAREA'||(ae.tagName==='INPUT'&&ae.type!=='checkbox')); if(document.visibilityState==='visible' && !typing && !tEdit && !editing && !recording && !dirEdit && mode!=='learn' && mode!=='quiz') refresh().then(()=>{ order=order.map(c=>S.cards.find(x=>x.photo===c.photo)||c); drun=drun.map(c=>S.cards.find(x=>x.photo===c.photo)||c); if(['today','tasks','sigs','acct','log','facts','guide'].includes(mode)) render(); }); }, 30000);
