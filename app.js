// ================================================================
// NEO TRACKER · app.js
// ================================================================
import { db } from './supabase.js';

// ── CONFIG — paste your mall ID after running schema.sql ─────────
const MALL_ID = '2f153b45-2124-4bff-9008-32c4c145c8c7';

const DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const DAY_SHORT = ['Di','Lu','Ma','Me','Je','Ve','Sa'];
const D0_TGT = 75, CR_TGT = 50;

// ── STATE ────────────────────────────────────────────────────────
let session   = null;   // { id, name, email, role, mall_id }
let targets   = {0:20,1:10,2:10,3:10,4:15,5:15,6:20};
let cart      = [];
let form      = { act: false, dep: false, depAmt: null };
let realtimeCh = null;

// ── HELPERS ──────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
function todayKey() { return new Date().toISOString().slice(0,10); }
function fmtDate(d) { return d.toLocaleDateString('fr-CA',{weekday:'short',month:'short',day:'numeric'}); }
function pct(a,b)   { return b ? Math.round(a/b*100) : 0; }
function getLabels(s) {
  if (Array.isArray(s.labels) && s.labels.length) return s.labels;
  if (Array.isArray(s.products) && s.products.length) return s.products;
  if (s.label)   return [s.label];
  if (s.product) return [s.product];
  return ['Unknown'];
}
function toast(msg, dur=2600) {
  const t = $('toast'); t.textContent = msg;
  t.classList.add('show'); setTimeout(() => t.classList.remove('show'), dur);
}
function initDates() {
  const d = fmtDate(new Date());
  ['log-date','feed-date','dash-date','lfeed-date','manage-date']
    .forEach(id => { const e=$(id); if(e) e.textContent = d; });
}

// ── AUTH ─────────────────────────────────────────────────────────
async function hashPin(pin) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pin));
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
}

window.doLogin = async function() {
  const email = $('login-email').value.trim().toLowerCase();
  const pin   = $('login-pin').value.trim();
  const err   = $('login-err');
  const btn   = $('login-btn');
  if (!email || !pin) { err.textContent='Enter your email and PIN.'; err.classList.add('show'); return; }
  btn.disabled = true; btn.textContent = 'Signing in…';
  err.classList.remove('show');
  try {
    const hash = await hashPin(pin);
    const { data, error } = await db.from('reps')
      .select('*').eq('email', email).eq('pin_hash', hash).eq('active', true).single();
    if (error || !data) throw new Error('Not found');
    session = data;
    sessionStorage.setItem('neo_session', JSON.stringify(data));
    await bootApp();
  } catch {
    err.textContent = 'Incorrect email or PIN. Try again.';
    err.classList.add('show');
    btn.disabled = false; btn.textContent = 'Sign in';
  }
};

window.doLogout = function() {
  sessionStorage.removeItem('neo_session');
  session = null;
  if (realtimeCh) { db.removeChannel(realtimeCh); realtimeCh = null; }
  $('lead-app').style.display = 'none';
  $('rep-app').style.display  = 'none';
  $('view-login').classList.add('active');
};

// ── BOOT ─────────────────────────────────────────────────────────
async function bootApp() {
  $('view-login').classList.remove('active');
  // Load mall targets
  const { data: mall } = await db.from('malls').select('targets').eq('id', MALL_ID).single();
  if (mall?.targets) targets = mall.targets;

  if (session.role === 'lead') {
    $('lead-app').style.display = 'block';
    $('lead-email-display').textContent = session.email;
    await renderDash();
    await renderLeadFeed();
    subscribeRealtime();
    requestPushPermission();
  } else {
    $('rep-app').style.display = 'block';
    $('rep-context').textContent = `${session.name} · Log a sale`;
    await populateRepSelect();
    subscribeRealtime();
    requestPushPermission();
  }
  initDates();
}

// Try resuming session on load
window.addEventListener('DOMContentLoaded', async () => {
  const saved = sessionStorage.getItem('neo_session');
  if (saved) { session = JSON.parse(saved); await bootApp(); }
  // Register service worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(console.error);
  }
});

// ── REALTIME SUBSCRIPTION ────────────────────────────────────────
function subscribeRealtime() {
  if (realtimeCh) db.removeChannel(realtimeCh);
  realtimeCh = db.channel('sales-live')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'sales', filter: `mall_id=eq.${MALL_ID}` },
      payload => {
        const s = payload.new;
        if (session.role === 'lead') { renderDash(); renderLeadFeed(); }
        else renderRepFeed();
      })
    .subscribe();
}

// ── PUSH NOTIFICATIONS ───────────────────────────────────────────
// VAPID public key — generate yours at: https://web-push-codelab.glitch.me
const VAPID_PUBLIC = 'BBLQYXyQnw90R7XFsRnjCfmMFJfQK5EUxZw_u8JjznPUvfZgoTDMQkhLZR6Jrfn2aDkbY75T-tQtJQxLNIwMvjw';

async function requestPushPermission() {
  if (!('Notification' in window) || !('serviceWorker' in navigator)) return;
  if (Notification.permission === 'denied') return;
  if (Notification.permission !== 'granted') {
    const p = await Notification.requestPermission();
    if (p !== 'granted') return;
  }
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC)
    });
    const j = sub.toJSON();
    await db.from('push_subscriptions').upsert({
      rep_id:   session.id,
      endpoint: j.endpoint,
      p256dh:   j.keys.p256dh,
      auth:     j.keys.auth
    }, { onConflict: 'rep_id,endpoint' });
  } catch(e) { console.warn('Push subscription failed:', e); }
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g,'+').replace(/_/g,'/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

// ── REP: POPULATE SELECT ─────────────────────────────────────────
async function populateRepSelect() {
  const { data } = await db.from('reps').select('id,name').eq('mall_id', MALL_ID).eq('active', true).order('name');
  const sel = $('rep-select');
  sel.innerHTML = '<option value="">Select rep…</option>';
  (data||[]).forEach(r => {
    const o = document.createElement('option');
    o.value = r.id; o.textContent = r.name;
    if (r.id === session.id) o.selected = true;
    sel.appendChild(o);
  });
}

// ── REP: NAV ────────────────────────────────────────────────────
window.goRep = function(v) {
  ['log','feed'].forEach(x => {
    $('view-'+x).classList.toggle('active', x===v);
    $('nav-'+x).classList.toggle('active', x===v);
  });
  if (v==='feed') renderRepFeed();
};

// ── LEAD: NAV ────────────────────────────────────────────────────
window.goLead = function(v) {
  ['dash','feed','manage'].forEach(x => {
    $('lview-'+x).classList.toggle('active', x===v);
    $('lnav-'+x).classList.toggle('active', x===v);
  });
  if (v==='dash')   renderDash();
  if (v==='feed')   renderLeadFeed();
  if (v==='manage') renderManage();
};

// ── PRODUCT TREE ─────────────────────────────────────────────────
window.toggleCat = function(cat) {
  const b=$('body-'+cat), ch=$('chev-'+cat), sep=$('sep-'+cat);
  const o = b.classList.toggle('open');
  ch.style.transform = o ? 'rotate(180deg)' : '';
  sep.style.display  = o ? 'block' : 'none';
};
window.toggleTier = function(t) {
  const o=$('topts-'+t), ch=$('tchev-'+t);
  const open = o.classList.toggle('open');
  ch.style.transform = open ? 'rotate(180deg)' : '';
};

function hasCredit()  { return cart.some(i=>i.t==='credit'); }
function hasSecured() { return cart.some(i=>i.s); }
function hasDebit()   { return cart.some(i=>i.t==='debit'); }

window.addCart = function(el) {
  const p = el.dataset.p;
  if (cart.find(i=>i.p===p)) return;
  cart.push({ p, t: el.dataset.t, s: el.dataset.s==='true', l: el.dataset.l });
  el.classList.add('in');
  syncCart();
};
window.rmCart = function(p) {
  cart = cart.filter(i=>i.p!==p);
  const el=$('pill-'+p); if(el) el.classList.remove('in');
  syncCart();
};

function syncCart() {
  $('cart-row').innerHTML = cart.map(i =>
    `<div class="chip-cart ${i.t}">${i.l}<button class="chip-rm" onclick="rmCart('${i.p}')">✕</button></div>`
  ).join('');
  const cc = cart.filter(i=>i.t==='credit').length;
  const dc = cart.filter(i=>i.t==='debit').length;
  $('cart-credit-count').textContent = cc ? cc+' selected' : '';
  $('cart-debit-count').textContent  = dc ? 'Added' : '';

  const needAct = hasCredit();
  const needDep = hasSecured() || hasDebit();
  $('q-act').style.display = needAct ? 'block' : 'none';
  if (!needAct) { form.act=false; $('tog-act').classList.remove('on'); }
  $('q-dep').style.display = needDep ? 'block' : 'none';
  if (!needDep) { form.dep=false; form.depAmt=null; $('tog-dep').classList.remove('on'); $('dep-amt').style.display='none'; resetDepBtns(); }
  if (needDep) {
    const secOnly = hasSecured() && !hasDebit();
    $('dep-title').textContent = secOnly ? 'Security deposit made?' : 'Money deposited?';
    $('dep-sub').textContent   = secOnly ? 'Customer put down their security deposit' : 'Customer added funds to their account';
  }
}

window.togField = function(f) {
  form[f] = !form[f];
  $('tog-'+f).classList.toggle('on', form[f]);
  if (f==='dep') {
    $('dep-amt').style.display = form.dep ? 'block' : 'none';
    if (!form.dep) { form.depAmt=null; resetDepBtns(); }
  }
};
window.pickDep = function(el) {
  resetDepBtns(); el.classList.add('on'); form.depAmt = el.dataset.v;
  $('dep-custom').value = '';
};
function resetDepBtns() { document.querySelectorAll('.dep-btn').forEach(b=>b.classList.remove('on')); }
$('dep-custom') && $('dep-custom').addEventListener('input', function() {
  if (this.value) { resetDepBtns(); form.depAmt = this.value; } else form.depAmt = null;
});

// ── SUBMIT SALE ──────────────────────────────────────────────────
window.submitSale = async function() {
  const repId = $('rep-select').value;
  const repName = $('rep-select').options[$('rep-select').selectedIndex]?.text;
  if (!repId)       { toast('Select your name first'); return; }
  if (!cart.length) { toast('Select at least one product'); return; }

  const btn = document.querySelector('#view-log .btn-primary');
  btn.disabled = true; btn.textContent = 'Logging…';

  const sale = {
    mall_id:   MALL_ID,
    rep_id:    repId,
    rep_name:  repName,
    sale_date: todayKey(),
    sale_time: new Date().toTimeString().slice(0,8),
    products:  cart.map(i=>i.p),
    labels:    cart.map(i=>i.l),
    type:      hasCredit() ? 'credit' : 'debit',
    activated: form.act,
    deposited: form.dep,
    deposit:   form.depAmt ? parseFloat(form.depAmt) : null,
    notes:     $('notes').value.trim() || null
  };

  const { error } = await db.from('sales').insert(sale);
  if (error) { toast('Error saving. Try again.'); btn.disabled=false; btn.textContent='Log sale'; return; }

  toast('✓ ' + cart.map(i=>i.l).join(' + '));
  resetForm();
  btn.disabled = false; btn.textContent = 'Log sale';
};

function resetForm() {
  cart = []; form = { act:false, dep:false, depAmt:null };
  $('notes').value = '';
  $('cart-row').innerHTML = '';
  document.querySelectorAll('.in').forEach(e=>e.classList.remove('in'));
  ['q-act','q-dep'].forEach(id => $(id).style.display='none');
  $('tog-act').classList.remove('on'); $('tog-dep').classList.remove('on');
  $('dep-amt').style.display='none'; resetDepBtns(); $('dep-custom').value='';
  $('cart-credit-count').textContent=''; $('cart-debit-count').textContent='';
  ['credit','debit'].forEach(c => {
    $('body-'+c).classList.remove('open'); $('chev-'+c).style.transform=''; $('sep-'+c).style.display='none';
  });
  ['std','world','elite'].forEach(t => {
    $('topts-'+t).classList.remove('open'); $('tchev-'+t).style.transform='';
  });
}

// ── FEED (shared renderer) ───────────────────────────────────────
function buildFeedHTML(sales) {
  if (!sales.length) return '<div class="empty">No sales yet today.<br>Be the first. 💪</div>';
  return sales.slice().reverse().map(s => {
    const lbls = getLabels(s).join(' + ');
    const dep  = s.deposit ? ' $' + s.deposit : '';
    const badges = [];
    if (s.activated) badges.push('<span class="fb act">Activated ✓</span>');
    if (s.deposited) badges.push(`<span class="fb dep">Deposited${dep} ✓</span>`);
    const time = s.sale_time ? s.sale_time.slice(0,5) : (s.time||'');
    return `<div class="feed-item">
      <div class="f-line ${s.type}"></div>
      <div class="f-body">
        <div class="f-prod">${lbls}</div>
        ${badges.length ? '<div class="f-badges">'+badges.join('')+'</div>' : ''}
        <div class="f-meta">${s.rep_name||s.rep||''}${s.notes?' · '+s.notes:''}</div>
        <div class="f-time">${time}</div>
      </div>
    </div>`;
  }).join('');
}

async function fetchTodaySales() {
  const { data } = await db.from('sales')
    .select('*').eq('mall_id', MALL_ID).eq('sale_date', todayKey()).order('created_at');
  return data || [];
}

async function renderRepFeed() {
  const sales = await fetchTodaySales();
  $('feed').innerHTML = buildFeedHTML(sales);
}
async function renderLeadFeed() {
  const sales = await fetchTodaySales();
  $('lfeed').innerHTML = buildFeedHTML(sales);
}

// ── DASHBOARD ────────────────────────────────────────────────────
async function renderDash() {
  const today = await fetchTodaySales();
  const dow = new Date().getDay();
  const tgt = targets[dow] || 10;
  const tot = today.length;
  const d0s = today.filter(s=>s.activated).length;
  const crs = today.filter(s=>s.type==='credit').length;
  const d0r = pct(d0s,tot), crr = pct(crs,tot);

  $('k-tot').textContent = tot; $('k-tgt').textContent = tgt;
  $('k-d0').textContent  = d0r+'%'; $('k-cr').textContent = crr+'%';

  function colorKpi(id,val,g,w) {
    $(id).className = 'kpi ' + (tot===0 ? '' : (val>=g?'good':val>=w?'warn':'bad'));
  }
  colorKpi('kpi-tot',tot,tgt,Math.round(tgt*.6));
  colorKpi('kpi-d0',d0r,D0_TGT,50);
  colorKpi('kpi-cr',crr,CR_TGT,35);

  function bar(pfId,pvId,val,max,fmt) {
    const w = Math.min(100,Math.round(val/max*100));
    $(pfId).style.width = w+'%';
    $(pfId).style.background = w>=100?'var(--green)':w>=60?'var(--amber)':'var(--red)';
    $(pvId).textContent = fmt==='s' ? val+'/'+max : val+'%';
    $(pvId).style.color = w>=100?'var(--green)':w>=60?'var(--amber)':'var(--text2)';
  }
  bar('pf-s','pv-s',tot,tgt,'s');
  bar('pf-d','pv-d',d0r,100,'p');
  bar('pf-c','pv-c',crr,100,'p');

  // Week chart
  const now = new Date();
  const monOff = now.getDay()===0 ? 6 : now.getDay()-1;
  const mon = new Date(now); mon.setDate(now.getDate()-monOff); mon.setHours(0,0,0,0);
  const monKey = mon.toISOString().slice(0,10);
  const { data: weekData } = await db.from('sales')
    .select('sale_date').eq('mall_id', MALL_ID).gte('sale_date', monKey);
  const tk = todayKey();
  const wd = DAY_SHORT.map((d,i) => {
    const dt = new Date(mon); dt.setDate(mon.getDate()+i);
    // DAY_SHORT: Di=0=Sun, Lu=1=Mon... shift to Mon-first
    const actualIdx = (i+1)%7; // 0=Mon→Sun is 0, but we label Mon first
    const k = dt.toISOString().slice(0,10);
    const cnt = (weekData||[]).filter(s=>s.sale_date===k).length;
    return { d, cnt, cur: k===tk, fut: dt>now && k!==tk };
  });
  const mx = Math.max(...wd.map(x=>x.cnt),1);
  $('week').innerHTML = wd.map(x=>`
    <div class="wb-wrap${x.cur?' cur':''}">
      <div class="wb-num">${x.cnt||''}</div>
      <div class="wb ${x.cur?'today':''}" style="height:${x.fut?4:Math.max(4,Math.round(x.cnt/mx*58))}px;opacity:${x.fut?.18:1}"></div>
      <div class="wb-day">${x.d}</div>
    </div>`).join('');

  // Rep breakdown
  const rm = {};
  today.forEach(s => {
    if (!rm[s.rep_name]) rm[s.rep_name]={n:0,d:0,c:0};
    rm[s.rep_name].n++;
    if(s.activated) rm[s.rep_name].d++;
    if(s.type==='credit') rm[s.rep_name].c++;
  });
  const reps = Object.entries(rm).sort((a,b)=>b[1].n-a[1].n);
  $('rep-bd').innerHTML = !reps.length ? '<div class="empty">No sales today yet.</div>' :
    reps.map(([name,r]) => {
      const dr=pct(r.d,r.n), cr=pct(r.c,r.n);
      const ini=name.split(' ').map(x=>x[0]).join('').slice(0,2).toUpperCase();
      return `<div class="rep-row">
        <div class="rep-av">${ini}</div>
        <div class="rep-nm">${name.split(' ')[0]}</div>
        <div class="chips">
          <div class="ck cnt">${r.n} cx</div>
          <div class="ck ${dr>=D0_TGT?'g':'r'}">${dr}% D0</div>
          <div class="ck b">${cr}% cr</div>
        </div>
      </div>`;
    }).join('');
}

// ── MANAGE ───────────────────────────────────────────────────────
async function renderManage() {
  renderTargetsForm();
  await renderRepList();
}

function renderTargetsForm() {
  const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  $('targets-form').innerHTML = '<div class="card-title">Sales target per day</div>' +
    days.map((d,i) => `
      <div class="target-row">
        <div class="target-day">${d}</div>
        <input class="target-input" type="number" id="tgt-${i}" value="${targets[i]||10}" min="1" max="99">
      </div>`).join('');
}

window.saveTargets = async function() {
  const newTargets = {};
  for (let i=0;i<7;i++) newTargets[i] = parseInt($('tgt-'+i).value)||10;
  const { error } = await db.from('malls').update({ targets: newTargets }).eq('id', MALL_ID);
  if (error) { toast('Error saving targets'); return; }
  targets = newTargets;
  toast('Targets saved ✓');
};

async function renderRepList() {
  const { data } = await db.from('reps').select('*').eq('mall_id', MALL_ID).order('name');
  $('rep-list').innerHTML = !data?.length ? '<div class="empty">No reps yet.</div>' :
    data.map(r => `
      <div class="manage-rep-row">
        <div class="rep-av">${r.name.split(' ').map(x=>x[0]).join('').slice(0,2).toUpperCase()}</div>
        <div class="mrep-info">
          <div class="mrep-name">${r.name}</div>
          <div class="mrep-email">${r.email}</div>
        </div>
        <div class="mrep-role ${r.role}">${r.role==='lead'?'Lead':'Rep'}</div>
        ${r.id!==session.id ? `<button class="btn-icon" onclick="removeRep('${r.id}')">✕</button>` : ''}
      </div>`).join('');
}

window.addRep = async function() {
  const name  = $('new-rep-name').value.trim();
  const email = $('new-rep-email').value.trim().toLowerCase();
  const pin   = $('new-rep-pin').value.trim();
  const role  = $('new-rep-role').value;
  if (!name||!email||!pin) { toast('Fill in all fields'); return; }
  if (pin.length < 4)      { toast('PIN must be 4–6 digits'); return; }
  const pin_hash = await hashPin(pin);
  const { error } = await db.from('reps').insert({ mall_id:MALL_ID, name, email, role, pin_hash, active:true });
  if (error) { toast(error.code==='23505'?'Email already exists':'Error adding rep'); return; }
  $('new-rep-name').value=''; $('new-rep-email').value=''; $('new-rep-pin').value='';
  toast(name+' added ✓');
  await renderRepList();
};

window.removeRep = async function(id) {
  if (!confirm('Remove this rep from the team?')) return;
  await db.from('reps').update({ active:false }).eq('id', id);
  toast('Rep removed');
  await renderRepList();
};

// ── AUTO-REFRESH ─────────────────────────────────────────────────
setInterval(() => {
  if (!session) return;
  if (session.role==='lead') {
    if ($('lview-dash')?.classList.contains('active')) renderDash();
    if ($('lview-feed')?.classList.contains('active')) renderLeadFeed();
  } else {
    if ($('view-feed')?.classList.contains('active')) renderRepFeed();
  }
}, 30000);
