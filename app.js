// ================================================================
// NEO TRACKER · app.js
// ================================================================
import { db, SUPABASE_URL, SUPABASE_ANON } from './supabase.js';

const MALL_ID = '2f153b45-2124-4bff-9008-32c4c145c8c7';

const DAY_SHORT = ['Di','Lu','Ma','Me','Je','Ve','Sa'];
const D0_TGT = 75, CR_TGT = 50;

// ── STATE ────────────────────────────────────────────────────────
let session    = null;
let targets    = {0:20,1:10,2:10,3:10,4:15,5:15,6:20};
let cart       = [];
let form       = { act: false, dep: false, depAmt: null };
let realtimeCh = null;
let dashDate   = '';
let feedDate   = '';
let statsDate  = '';
let editingId  = null;   // sale ID being edited, null = new sale
let rosterDate = '';     // date shown in the roster card
let cphTarget  = 2.0;   // mall CPH target (loaded from malls table)
let acphTarget = 1.5;   // mall ACPH target
let calTarget  = null;  // 'dash' | 'feed' | 'profile' | 'roster'
let calMonth   = '';     // 'YYYY-MM' currently displayed in calendar
let calActive  = new Set(); // sale_dates that have at least one sale
let salesCache = {};     // id → sale object, populated by feed renders
let cxInterested = [];   // interested_in chips selected on the add-contact form

// ── HELPERS ──────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

function todayKey() {
  const d = new Date();
  const pad = n => String(n).padStart(2,'0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}

function fmtDate(d) {
  return d.toLocaleDateString('fr-CA',{weekday:'short',month:'short',day:'numeric'});
}
function fmtDateStr(s) { return fmtDate(new Date(s + 'T12:00:00')); }

function shiftDateStr(s, n) {
  const d = new Date(s + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0,10);
}

// Returns YYYY-MM-DD in the user's local timezone (for comparing follow_up_at to today)
function localDateStr(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  const pad = n => String(n).padStart(2,'0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}

function pct(a,b) { return b ? Math.round(a/b*100) : 0; }

function getLabels(s) {
  if (Array.isArray(s.labels)   && s.labels.length)   return s.labels;
  if (Array.isArray(s.products) && s.products.length)  return s.products;
  if (s.label)   return [s.label];
  if (s.product) return [s.product];
  return ['Unknown'];
}

function toast(msg, dur=2600) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), dur);
}

function initDates() {
  const d = fmtDate(new Date());
  ['log-date','feed-date','stats-date','manage-date','cx-date']
    .forEach(id => { const e=$(id); if(e) e.textContent = d; });
}

function updateDatePill(elId, date) {
  const el = $(elId);
  if (el) el.textContent = fmtDateStr(date);
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

  // ── Step 1: verify credentials only (isolated try/catch)
  let repData;
  try {
    const hash = await hashPin(pin);
    const { data, error } = await db.from('reps')
      .select('*').eq('email', email).eq('pin_hash', hash).eq('active', true).single();
    // PGRST116 = "0 rows" → wrong credentials; any other error → connection issue
    if (error?.code === 'PGRST116' || !data) {
      err.textContent = 'Incorrect email or PIN. Try again.';
      err.classList.add('show');
      btn.disabled = false; btn.textContent = 'Sign in';
      return;
    }
    if (error) throw error; // network / server error → caught below
    repData = data;
    // Sync Supabase Auth in background — never blocks login
    if (data.auth_uid) {
      db.auth.signInWithPassword({ email, password: hash }).catch(console.warn);
    } else {
      db.auth.signUp({ email, password: hash })
        .then(({ data: au }) => {
          if (au?.user?.id) {
            repData.auth_uid = au.user.id;
            db.from('reps').update({ auth_uid: au.user.id }).eq('id', data.id).catch(console.warn);
          }
        }).catch(console.warn);
    }
  } catch {
    err.textContent = 'Connection error. Please try again.';
    err.classList.add('show');
    btn.disabled = false; btn.textContent = 'Sign in';
    return;
  }

  // ── Step 2: session + boot (errors here don't blame the user's credentials)
  session = repData;
  localStorage.setItem('neo_session', JSON.stringify(repData));
  if (repData.must_change_pin) {
    $('view-login').classList.remove('active');
    $('view-change-pin').classList.add('active');
    btn.disabled = false; btn.textContent = 'Sign in';
    return;
  }
  await bootApp();
};

window.doLogout = function() {
  db.auth.signOut().catch(console.warn);
  localStorage.removeItem('neo_session');
  session = null;
  if (realtimeCh) { db.removeChannel(realtimeCh); realtimeCh = null; }
  $('lead-app').style.display = 'none';
  $('rep-app').style.display  = 'none';
  $('view-log').classList.remove('active');
  $('view-contacts').classList.remove('active');
  $('view-login').classList.add('active');
  resetContactForm();
  // reset login form state
  $('login-btn').disabled = false; $('login-btn').textContent = 'Sign in';
  $('login-err').classList.remove('show');
  resetForm();
};

// ── CHANGE PIN ───────────────────────────────────────────────────
window.doChangePin = async function() {
  const newPin  = $('pin-new').value.trim();
  const confirm = $('pin-confirm').value.trim();
  const err     = $('pin-err');
  const btn     = $('pin-btn');
  err.classList.remove('show');
  if (newPin.length < 4)        { err.textContent = 'PIN must be 4–6 digits.'; err.classList.add('show'); return; }
  if (newPin !== confirm)       { err.textContent = 'PINs don\'t match.';      err.classList.add('show'); return; }
  btn.disabled = true; btn.textContent = 'Saving…';
  const pin_hash = await hashPin(newPin);
  const { error } = await db.from('reps')
    .update({ pin_hash, must_change_pin: false }).eq('id', session.id);
  if (error) { err.textContent = 'Error saving. Try again.'; err.classList.add('show'); btn.disabled=false; btn.textContent='Set PIN & continue'; return; }
  session.must_change_pin = false;
  session.pin_hash = pin_hash;
  localStorage.setItem('neo_session', JSON.stringify(session));
  db.auth.updateUser({ password: pin_hash }).catch(console.warn); // sync Auth password
  $('view-change-pin').classList.remove('active');
  $('pin-new').value = ''; $('pin-confirm').value = '';
  await bootApp();
};

// ── BOOT ─────────────────────────────────────────────────────────
async function bootApp() {
  $('view-login').classList.remove('active');
  const { data: mall } = await db.from('malls').select('targets, cph_target, acph_target').eq('id', MALL_ID).single();
  if (mall?.targets)    targets   = mall.targets;
  if (mall?.cph_target)  cphTarget  = parseFloat(mall.cph_target);
  if (mall?.acph_target) acphTarget = parseFloat(mall.acph_target);

  dashDate   = todayKey();
  feedDate   = todayKey();
  statsDate  = todayKey();
  rosterDate = todayKey();

  await populateRepSelect();

  if (session.role === 'lead') {
    $('lead-app').style.display = 'block';
    $('lead-email-display').textContent = session.email;
    goLead('dash');
    subscribeRealtime();
    requestPushPermission();
  } else {
    $('rep-app').style.display = 'block';
    $('rep-email-display').textContent = session.email;
    goRep('log');
    subscribeRealtime();
    requestPushPermission();
  }
  initDates();
  drainQueue(); // replay any sales logged while offline
}

window.addEventListener('DOMContentLoaded', async () => {
  const saved = localStorage.getItem('neo_session');
  if (saved) { session = JSON.parse(saved); await bootApp(); }
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(console.error);
  }
  const dc = $('dep-custom');
  if (dc) dc.addEventListener('input', function() {
    if (this.value) { resetDepBtns(); form.depAmt = this.value; } else form.depAmt = null;
  });
  window.addEventListener('online', () => { if (session) drainQueue(); });
});

// ── REALTIME ─────────────────────────────────────────────────────
function subscribeRealtime() {
  if (realtimeCh) db.removeChannel(realtimeCh);
  realtimeCh = db.channel('neo-live')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'sales', filter: `mall_id=eq.${MALL_ID}` },
      () => {
        if (session.role === 'lead') {
          if ($('lview-dash')?.classList.contains('active')) renderDash();
          if ($('lview-feed')?.classList.contains('active')) renderLeadFeed();
        } else {
          if ($('view-feed')?.classList.contains('active'))  renderRepFeed();
          if ($('view-stats')?.classList.contains('active')) renderRepStats();
        }
      })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'contacts', filter: `rep_id=eq.${session.id}` },
      () => {
        if ($('view-contacts')?.classList.contains('active')) renderContacts();
      })
    .subscribe();
}

// ── PUSH ─────────────────────────────────────────────────────────
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
      rep_id: session.id, endpoint: j.endpoint,
      p256dh: j.keys.p256dh, auth: j.keys.auth
    }, { onConflict: 'rep_id,endpoint' });
  } catch(e) { console.warn('Push subscription failed:', e); }
}

function urlBase64ToUint8Array(b) {
  const p = '='.repeat((4 - b.length % 4) % 4);
  const s = (b + p).replace(/-/g,'+').replace(/_/g,'/');
  return Uint8Array.from([...atob(s)].map(c => c.charCodeAt(0)));
}

// ── REP SELECT ───────────────────────────────────────────────────
async function populateRepSelect() {
  const { data } = await db.from('reps')
    .select('id,name').eq('mall_id', MALL_ID).eq('active', true).order('name');
  const sel = $('rep-select');
  sel.innerHTML = '<option value="">Select rep…</option>';
  (data||[]).forEach(r => {
    const o = document.createElement('option');
    o.value = r.id; o.textContent = r.name;
    if (r.id === session.id) o.selected = true;
    sel.appendChild(o);
  });
}

async function populateResetSelect() {
  const { data } = await db.from('reps')
    .select('id,name').eq('mall_id', MALL_ID).eq('active', true).order('name');
  const sel = $('reset-rep-select');
  sel.innerHTML = '<option value="">Select rep…</option>';
  (data||[]).forEach(r => {
    const o = document.createElement('option');
    o.value = r.id; o.textContent = r.name;
    sel.appendChild(o);
  });
}

// ── NAV ──────────────────────────────────────────────────────────
window.goRep = function(v) {
  ['log','feed','contacts','stats'].forEach(x => $('nav-'+x).classList.toggle('active', x===v));
  ['view-log','view-feed','view-contacts','view-stats'].forEach(id => $(id).classList.remove('active'));
  if (v === 'log')      { $('view-log').classList.add('active');      prepareLogForm(); }
  if (v === 'feed')     { $('view-feed').classList.add('active');     renderRepFeed(); }
  if (v === 'contacts') { $('view-contacts').classList.add('active'); renderContacts(); }
  if (v === 'stats')    { $('view-stats').classList.add('active');    renderRepStats(); }
};

window.goLead = function(v) {
  ['dash','feed','contacts','log','manage'].forEach(x => $('lnav-'+x).classList.toggle('active', x===v));
  ['lview-dash','lview-feed','lview-manage','view-log','view-contacts'].forEach(id => $(id).classList.remove('active'));
  if (v === 'dash')     { $('lview-dash').classList.add('active');    renderDash(); }
  if (v === 'feed')     { $('lview-feed').classList.add('active');    renderLeadFeed(); }
  if (v === 'contacts') { $('view-contacts').classList.add('active'); renderContacts(); }
  if (v === 'log')      { $('view-log').classList.add('active');      prepareLogForm(); }
  if (v === 'manage')   { $('lview-manage').classList.add('active');  renderManage(); }
};

// ── LOG FORM SETUP ────────────────────────────────────────────────
function prepareLogForm() {
  $('log-context').textContent = session.name + ' · Log a sale';
  if (session.role === 'rep') {
    $('log-rep-selector').style.display = 'none';
    $('log-rep-name').style.display     = 'none';
  } else {
    $('log-rep-selector').style.display = 'block';
    $('log-rep-name').style.display     = 'none';
  }
}

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
  const t = el.dataset.t;
  // Tap selected item → deselect it
  if (cart.find(i=>i.p===p)) {
    cart = cart.filter(i=>i.p!==p);
    el.classList.remove('in');
    syncCart();
    return;
  }
  // Credit cards: only one at a time — swap out the existing one
  if (t === 'credit') {
    cart.filter(i=>i.t==='credit').forEach(i => { const e=$('pill-'+i.p); if(e) e.classList.remove('in'); });
    cart = cart.filter(i=>i.t!=='credit');
  }
  cart.push({ p, t, s: el.dataset.s==='true', l: el.dataset.l });
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

  const needAct = hasCredit() || cart.some(i => i.p === 'Money');
  const needDep = hasSecured() || hasDebit();
  $('q-act').style.display = needAct ? 'block' : 'none';
  if (!needAct) { form.act=false; $('tog-act').classList.remove('on'); }
  $('q-dep').style.display = needDep ? 'block' : 'none';
  if (!needDep) { form.dep=false; form.depAmt=null; $('tog-dep').classList.remove('on'); $('dep-amt').style.display='none'; resetDepBtns(); $('tog-dep').style.opacity=''; $('tog-dep').style.pointerEvents=''; }
  if (needDep) {
    const secOnly = hasSecured() && !hasDebit();
    $('dep-title').textContent = secOnly ? 'Security deposit made?' : 'Money deposited?';
    $('dep-sub').textContent   = secOnly ? 'Customer put down their security deposit' : 'Customer added funds to their account';
    // Secured card → deposit is mandatory: auto-enable, show amount picker, lock toggle
    if (hasSecured()) {
      form.dep = true;
      $('tog-dep').classList.add('on');
      $('dep-amt').style.display = 'block';
      $('tog-dep').style.opacity = '0.5';
      $('tog-dep').style.pointerEvents = 'none';
    } else {
      $('tog-dep').style.opacity = '';
      $('tog-dep').style.pointerEvents = '';
    }
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

// ── SUBMIT SALE ──────────────────────────────────────────────────
window.submitSale = async function() {
  let repId, repName;
  if (session.role === 'rep') {
    repId   = session.id;
    repName = session.name;
  } else {
    repId   = $('rep-select').value;
    repName = $('rep-select').options[$('rep-select').selectedIndex]?.text;
    if (!repId) { toast('Select a rep first'); return; }
  }
  if (!cart.length) { toast('Select at least one product'); return; }
  if (hasSecured() && !form.depAmt) { toast('Enter the security deposit amount'); return; }

  const saleMsg = buildActivationMessage(cart, form); // build while still in gesture context
  const btn = document.querySelector('#view-log .btn-primary');
  btn.disabled = true; btn.textContent = 'Logging…';

  const sale = {
    mall_id:   MALL_ID, rep_id: repId, rep_name: repName,
    sale_date: todayKey(), sale_time: new Date().toTimeString().slice(0,8),
    products:  cart.map(i=>i.p), labels: cart.map(i=>i.l),
    type:      hasCredit() ? 'credit' : 'debit',
    activated: form.act, deposited: form.dep,
    deposit:   form.depAmt ? parseFloat(form.depAmt) : null,
    notes:     $('notes').value.trim() || null
  };

  if (editingId) {
    const { error } = await db.from('sales').update({
      products:  sale.products,  labels:    sale.labels,
      type:      sale.type,      activated: sale.activated,
      deposited: sale.deposited, deposit:   sale.deposit,
      notes:     sale.notes
    }).eq('id', editingId);
    if (error) { toast('Error updating. Try again.'); btn.disabled=false; btn.textContent='Update sale'; return; }
    toast('✓ Sale updated');
    resetForm();
    btn.disabled = false; btn.textContent = 'Log sale';
    if (session.role === 'rep') goRep('feed');
    else goLead('feed');
  } else {
    const { error } = await db.from('sales').insert(sale);
    if (error) {
      if (!navigator.onLine) {
        await queueSale(sale);
        toast('No connection — sale queued ⏳');
        resetForm();
        btn.disabled = false; btn.textContent = 'Log sale';
        setTimeout(() => navigator.clipboard.writeText(saleMsg).catch(() => {}), 50);
      } else {
        toast('Error saving. Try again.');
        btn.disabled = false; btn.textContent = 'Log sale';
      }
      return;
    }
    toast('✓ Logged · message copied 📋');
    resetForm();
    btn.disabled = false; btn.textContent = 'Log sale';
    setTimeout(() => navigator.clipboard.writeText(saleMsg).catch(() => {}), 50);
  }
};

function buildActivationMessage(cartItems, f) {
  const labelMap = {
    'World Unsecured':       'W',
    'World Secured':         'SecW',
    'World Elite Unsecured': 'WE',
    'World Elite Secured':   'SecWE',
  };
  const stdMap = {
    'Standard Unsecured': 'Std Credit',
    'Standard Secured':   'Sec Card',
  };
  const moneyLabels = ['Neo Money','Neo Savings'];

  const labels     = cartItems.map(i => i.l);
  const weLabel    = labels.map(l => labelMap[l]).filter(Boolean).join(' + ');
  const stdLabel   = labels.map(l => stdMap[l]).filter(Boolean).join(' + ');
  const moneyLabel = labels.filter(l => moneyLabels.includes(l)).join(' + ');
  const deposit    = f.dep && f.depAmt ? `$${f.depAmt}` : f.dep ? 'Yes' : 'N/A';

  return [
    `Activation: mall`,
    `Location: CF Promenade St-Bruno`,
    `Was this a new Cx: Yes`,
    `WE/W or SecWE/SecW: ${weLabel}`,
    `Std Credit or Sec Card: ${stdLabel}`,
    `Everyday Account: ${moneyLabel || 'No'}`,
    `How much Deposit: ${deposit}`,
    `Product: ${labels.length}`,
    `Activated Y/N: ${f.act ? 'Y' : 'N'}`,
  ].join('\n');
}

function resetForm() {
  editingId = null;
  cart = []; form = { act:false, dep:false, depAmt:null };
  const logBtn = document.querySelector('#view-log .btn-primary');
  if (logBtn) logBtn.textContent = 'Log sale';
  $('notes').value = '';
  $('cart-row').innerHTML = '';
  $('view-log').querySelectorAll('.in').forEach(e=>e.classList.remove('in'));
  ['q-act','q-dep'].forEach(id => $(id).style.display='none');
  $('tog-act').classList.remove('on'); $('tog-dep').classList.remove('on');
  $('tog-dep').style.opacity=''; $('tog-dep').style.pointerEvents='';
  $('dep-amt').style.display='none'; resetDepBtns(); $('dep-custom').value='';
  $('cart-credit-count').textContent=''; $('cart-debit-count').textContent='';
  ['credit','debit'].forEach(c => {
    $('body-'+c).classList.remove('open');
    $('chev-'+c).style.transform='';
    $('sep-'+c).style.display='none';
  });
  ['std','world','elite'].forEach(t => {
    $('topts-'+t).classList.remove('open');
    $('tchev-'+t).style.transform='';
  });
}

// ── FETCH ────────────────────────────────────────────────────────
async function fetchSalesByDate(date) {
  const { data } = await db.from('sales')
    .select('*').eq('mall_id', MALL_ID).eq('sale_date', date).order('created_at');
  return data || [];
}

// ── FEED ─────────────────────────────────────────────────────────
function buildFeedHTML(sales, canDelete=false, allowEdit=false) {
  if (!sales.length) return '<div class="empty">No sales yet.<br>Be the first. 💪</div>';
  return sales.slice().reverse().map(s => {
    salesCache[s.id] = s;
    const lbls = getLabels(s).join(' + ');
    const dep  = s.deposit ? ' $' + s.deposit : '';
    const badges = [];
    if (s.activated) badges.push('<span class="fb act">Activated ✓</span>');
    if (s.deposited) badges.push(`<span class="fb dep">Deposited${dep} ✓</span>`);
    const time    = s.sale_time ? s.sale_time.slice(0,5) : '';
    const daysDiff = Math.round((new Date(todayKey()+'T12:00:00') - new Date(s.sale_date+'T12:00:00')) / 86400000);
    const withinWindow = session.role === 'lead' ? daysDiff <= 2 : daysDiff === 0;
    const isOwn        = s.rep_id === session.id;
    const canAct       = withinWindow && (session.role === 'lead' || isOwn);
    const canEdit = allowEdit  && canAct;
    const canDel  = canDelete  && canAct;
    const editBtn = canEdit ? `<button class="feed-edit" onclick="openEditSale('${s.id}')">✎</button>` : '';
    const delBtn  = canDel  ? `<button class="feed-del"  onclick="deleteSale('${s.id}')">✕</button>`  : '';
    const actions = (editBtn || delBtn) ? `<div class="feed-actions">${editBtn}${delBtn}</div>` : '';
    return `<div class="feed-item">
      <div class="f-line ${s.type}"></div>
      <div class="f-body">
        <div class="f-prod">${lbls}</div>
        ${badges.length ? '<div class="f-badges">'+badges.join('')+'</div>' : ''}
        <div class="f-meta">${s.rep_name||''}${s.notes?' · '+s.notes:''}</div>
        <div class="f-time">${time}</div>
      </div>
      ${actions}
    </div>`;
  }).join('');
}

async function renderRepFeed() {
  const sales = await fetchSalesByDate(todayKey());
  $('feed').innerHTML = buildFeedHTML(sales, true, true);
}

async function renderLeadFeed() {
  const sales = await fetchSalesByDate(todayKey());
  $('lfeed').innerHTML = buildFeedHTML(sales, true, true);
  updateDatePill('lfeed-date', todayKey());
}

window.deleteSale = async function(id) {
  if (!confirm('Remove this sale?')) return;
  const { error } = await db.from('sales').delete().eq('id', id);
  if (error) { toast('Could not delete — check RLS policy'); return; }
  toast('Sale removed');
  renderDash();
  renderLeadFeed();
};

window.openEditSale = function(id) {
  const sale = salesCache[id];
  if (!sale) return;

  resetForm();
  editingId = id;

  // rebuild cart from saved products
  (sale.products || []).forEach((p, i) => {
    const el = $('pill-' + p);
    if (!el) return;
    cart.push({ p, t: el.dataset.t, s: el.dataset.s === 'true', l: sale.labels?.[i] || el.dataset.l });
    el.classList.add('in');
  });
  syncCart();

  // restore activation
  if (sale.activated && (hasCredit() || cart.some(i => i.p === 'Money'))) {
    form.act = true;
    $('tog-act').classList.add('on');
  }

  // restore deposit
  if (sale.deposited && (hasSecured() || hasDebit())) {
    form.dep = true;
    $('tog-dep').classList.add('on');
    $('dep-amt').style.display = 'block';
    if (sale.deposit) {
      form.depAmt = String(sale.deposit);
      const presetBtn = document.querySelector(`.dep-btn[data-v="${parseInt(sale.deposit)}"]`);
      if (presetBtn) presetBtn.classList.add('on');
      else $('dep-custom').value = sale.deposit;
    }
  }

  $('notes').value = sale.notes || '';

  // navigate to log view first (prepareLogForm runs inside)
  if (session.role === 'rep') goRep('log');
  else goLead('log');

  // override header and rep display for edit context
  $('log-context').textContent = sale.rep_name + ' · Edit sale';
  if (session.role === 'lead') {
    $('log-rep-selector').style.display = 'none';
    $('log-rep-name').style.display     = 'block';
    $('rep-name-static').textContent    = sale.rep_name;
  }

  const btn = document.querySelector('#view-log .btn-primary');
  if (btn) btn.textContent = 'Update sale';
};

// ── DATE NAV ─────────────────────────────────────────────────────
window.shiftDashDate = function(n) {
  const next = shiftDateStr(dashDate, n);
  if (next > todayKey()) return;
  dashDate = next;
  renderDash();
};

window.shiftFeedDate = function(n) {
  const next = shiftDateStr(feedDate, n);
  if (next > todayKey()) return;
  feedDate = next;
  renderLeadFeed();
};

window.shiftStatsDate = function(n) {
  const next = shiftDateStr(statsDate, n);
  if (next > todayKey()) return;
  statsDate = next;
  renderRepStats();
};

// ── DATE PICKER CALENDAR ─────────────────────────────────────────
window.openCal = async function(target) {
  calTarget = target;
  const current = target === 'dash' ? dashDate : target === 'profile' ? profileDate : target === 'roster' ? rosterDate : feedDate;
  calMonth = current.slice(0, 7);
  await fetchCalActive();
  renderCal(current);
  $('cal-overlay').style.display = 'block';
  $('cal-popup').style.display   = 'block';
};

window.closeCal = function() {
  $('cal-overlay').style.display = 'none';
  $('cal-popup').style.display   = 'none';
};

async function fetchCalActive() {
  const [y, m] = calMonth.split('-').map(Number);
  const from  = `${calMonth}-01`;
  const last  = new Date(y, m, 0).getDate();
  const to    = `${calMonth}-${String(last).padStart(2,'0')}`;
  const { data } = await db.from('sales')
    .select('sale_date').eq('mall_id', MALL_ID)
    .gte('sale_date', from).lte('sale_date', to);
  calActive = new Set((data||[]).map(s => s.sale_date));
}

function renderCal(selectedDate) {
  const [y, m] = calMonth.split('-').map(Number);
  const first  = new Date(y, m-1, 1);
  const lastD  = new Date(y, m, 0).getDate();
  const today  = todayKey();
  const nowM   = today.slice(0,7);

  $('cal-month').textContent = first.toLocaleDateString('en-CA', { month:'long', year:'numeric' });
  $('cal-prev').disabled  = false;
  $('cal-next').disabled  = calMonth >= nowM;

  // Mon-first offset
  let startDow = first.getDay();
  startDow = startDow === 0 ? 6 : startDow - 1;

  let html = ['Mo','Tu','We','Th','Fr','Sa','Su']
    .map(d => `<div class="cal-dh">${d}</div>`).join('');

  for (let i = 0; i < startDow; i++) html += '<div class="cal-day cal-empty"></div>';

  const minDate = calTarget === 'dash' ? shiftDateStr(today, -2) : null;

  for (let d = 1; d <= lastD; d++) {
    const ds      = `${calMonth}-${String(d).padStart(2,'0')}`;
    const fut     = ds > today;
    const tooOld  = minDate && ds < minDate;
    const blocked = fut || tooOld;
    const act     = calActive.has(ds);
    const sel     = ds === selectedDate;
    const now     = ds === today;
    let cls = 'cal-day';
    if (blocked)       cls += ' cal-future';
    else if (!act)     cls += ' cal-inactive';
    if (sel)           cls += ' cal-sel';
    if (now && !sel)   cls += ' cal-today';
    html += `<div class="${cls}" ${!blocked ? `onclick="calPick('${ds}')"` : ''}>${d}</div>`;
  }
  $('cal-grid').innerHTML = html;
}

window.calShiftMonth = async function(n) {
  const [y, m] = calMonth.split('-').map(Number);
  const d    = new Date(y, m - 1 + n, 1);
  const next = d.toISOString().slice(0,7);
  if (next > todayKey().slice(0,7)) return;
  if (calTarget === 'dash' && next < shiftDateStr(todayKey(), -2).slice(0,7)) return;
  calMonth = next;
  await fetchCalActive();
  const sel = calTarget === 'dash' ? dashDate : calTarget === 'profile' ? profileDate : calTarget === 'roster' ? rosterDate : feedDate;
  renderCal(sel);
};

window.calPick = function(date) {
  if (calTarget === 'dash') {
    dashDate = date; renderDash();
  } else if (calTarget === 'profile') {
    profileDate = date;
    updateDatePill('profile-date', profileDate);
    renderProfileData();
  } else if (calTarget === 'roster') {
    rosterDate = date;
    renderRoster();
  } else {
    feedDate = date; renderLeadFeed();
  }
  closeCal();
};

// ── DASHBOARD ────────────────────────────────────────────────────
async function renderDash() {
  const today = await fetchSalesByDate(dashDate);
  const dow = new Date(dashDate + 'T12:00:00').getDay();
  const tgt = targets[dow] || 10;
  const tot = today.length;
  const d0s = today.filter(s=>s.activated).length;
  const crs = today.filter(s=>s.type==='credit').length;
  const d0r = pct(d0s,tot), crr = pct(crs,tot);

  updateDatePill('dash-date', dashDate);
  $('dash-next').disabled = dashDate >= todayKey();

  $('k-tot').textContent = tot; $('k-tgt').textContent = tgt;
  $('k-d0').textContent  = d0r+'%'; $('k-cr').textContent = crr+'%';

  // CPH / ACPH — fetch shift hours for this date
  const { data: shiftRows } = await db.from('shifts')
    .select('rep_id, hours').eq('mall_id', MALL_ID).eq('shift_date', dashDate);
  const shiftMap = {};
  (shiftRows || []).forEach(s => { shiftMap[s.rep_id] = parseFloat(s.hours); });
  const totalHours = Object.values(shiftMap).reduce((a,b) => a+b, 0);
  if (totalHours > 0) {
    const mc = (tot / totalHours).toFixed(1);
    const ma = (d0s / totalHours).toFixed(1);
    $('cph-kpi-row').style.display = '';
    $('k-cph').textContent  = mc;
    $('k-acph').textContent = ma;
    $('kpi-cph').className  = 'kpi ' + (parseFloat(mc) >= cphTarget  ? 'good' : parseFloat(mc)  >= cphTarget*.75  ? 'warn' : 'bad');
    $('kpi-acph').className = 'kpi ' + (parseFloat(ma) >= acphTarget ? 'good' : parseFloat(ma) >= acphTarget*.75 ? 'warn' : 'bad');
  } else {
    $('cph-kpi-row').style.display = 'none';
  }

  function colorKpi(id,val,g,w) {
    $(id).className = 'kpi ' + (tot===0 ? '' : val>=g?'good':val>=w?'warn':'bad');
  }
  colorKpi('kpi-tot',tot,tgt,Math.round(tgt*.6));
  colorKpi('kpi-d0',d0r,D0_TGT,50);
  colorKpi('kpi-cr',crr,CR_TGT,35);

  function bar(pfId,pvId,val,max,fmt) {
    const w = Math.min(100,Math.round(val/max*100));
    $(pfId).style.width      = w+'%';
    $(pfId).style.background = w>=100?'var(--green)':w>=60?'var(--amber)':'var(--red)';
    $(pvId).textContent      = fmt==='s' ? val+'/'+max : val+'%';
    $(pvId).style.color      = w>=100?'var(--green)':w>=60?'var(--amber)':'var(--text2)';
  }
  bar('pf-s','pv-s',tot,tgt,'s');
  bar('pf-d','pv-d',d0r,100,'p');
  bar('pf-c','pv-c',crr,100,'p');

  // Week chart centred on dashDate's week
  const vd = new Date(dashDate + 'T12:00:00');
  const monOff = vd.getDay()===0 ? 6 : vd.getDay()-1;
  const mon = new Date(vd); mon.setDate(vd.getDate()-monOff);
  const monKey = mon.toISOString().slice(0,10);
  const { data: weekData } = await db.from('sales')
    .select('sale_date').eq('mall_id', MALL_ID).gte('sale_date', monKey);
  const now = new Date();
  const wd = DAY_SHORT.map((d,i) => {
    const dt = new Date(mon); dt.setDate(mon.getDate()+i);
    const k  = dt.toISOString().slice(0,10);
    const cnt = (weekData||[]).filter(s=>s.sale_date===k).length;
    return { d, cnt, cur: k===dashDate, fut: dt>now };
  });
  const mx = Math.max(...wd.map(x=>x.cnt), 1);
  $('week').innerHTML = wd.map(x=>`
    <div class="wb-wrap${x.cur?' cur':''}">
      <div class="wb-num">${x.cnt||''}</div>
      <div class="wb ${x.cur?'today':''}" style="height:${x.fut?4:Math.max(4,Math.round(x.cnt/mx*58))}px;opacity:${x.fut?.18:1}"></div>
      <div class="wb-day">${x.d}</div>
    </div>`).join('');

  // Rep breakdown — rows are clickable for drill-down
  const rm = {};
  today.forEach(s => {
    if (!rm[s.rep_name]) rm[s.rep_name] = { n:0, d:0, c:0, repId: s.rep_id };
    rm[s.rep_name].n++;
    if (s.activated)       rm[s.rep_name].d++;
    if (s.type==='credit') rm[s.rep_name].c++;
  });
  const reps = Object.entries(rm).sort((a,b)=>b[1].n-a[1].n);
  $('rep-bd').innerHTML = !reps.length
    ? '<div class="empty">No sales today yet.</div>'
    : reps.map(([name,r]) => {
        const dr  = pct(r.d,r.n), cr = pct(r.c,r.n);
        const ini = name.split(' ').map(x=>x[0]).join('').slice(0,2).toUpperCase();
        const safeName = name.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
        return `<div class="rep-row rep-row-clickable" onclick="openRepModal('${safeName}','${dashDate}','${r.repId}')">
          <div class="rep-av">${ini}</div>
          <div class="rep-nm">${name.split(' ')[0]}</div>
          <div class="chips">
            <div class="ck cnt">${r.n} cx</div>
            <div class="ck ${dr>=D0_TGT?'g':'r'}">${dr}% D0</div>
            <div class="ck b">${cr}% cr</div>
            ${shiftMap[r.repId] ? `<div class="ck ${(r.n/shiftMap[r.repId])>=cphTarget?'g':(r.n/shiftMap[r.repId])>=cphTarget*.75?'o':'r'}">${(r.n/shiftMap[r.repId]).toFixed(1)} CPH</div><div class="ck ${(r.d/shiftMap[r.repId])>=acphTarget?'g':(r.d/shiftMap[r.repId])>=acphTarget*.75?'o':'r'}">${(r.d/shiftMap[r.repId]).toFixed(1)} ACPH</div>` : ''}
          </div>
          <svg class="rep-chev" viewBox="0 0 14 14"><polyline points="4,2 10,7 4,12"/></svg>
        </div>`;
      }).join('');
}

// ── REP STATS ─────────────────────────────────────────────────────
async function renderRepStats() {
  $('stats-context').textContent = session.name;
  const today = await fetchSalesByDate(statsDate);
  const mine  = today.filter(s => s.rep_id === session.id);
  const dow   = new Date(statsDate + 'T12:00:00').getDay();
  const tgt   = targets[dow] || 10;
  updateDatePill('stats-date', statsDate);
  $('stats-next').disabled = statsDate >= todayKey();
  const tot   = mine.length;
  const d0s   = mine.filter(s=>s.activated).length;
  const crs   = mine.filter(s=>s.type==='credit').length;
  const d0r   = pct(d0s,tot), crr = pct(crs,tot);

  $('sk-tot').textContent = tot;
  $('sk-tgt').textContent = tgt;
  $('sk-d0').textContent  = d0r+'%';
  $('sk-cr').textContent  = crr+'%';

  function colorKpi(id,val,g,w) {
    $(id).className = 'kpi ' + (tot===0 ? '' : val>=g?'good':val>=w?'warn':'bad');
  }
  colorKpi('skpi-tot',tot,tgt,Math.round(tgt*.6));
  colorKpi('skpi-d0',d0r,D0_TGT,50);
  colorKpi('skpi-cr',crr,CR_TGT,35);

  // Week chart for this rep only
  const now    = new Date();
  const monOff = now.getDay()===0 ? 6 : now.getDay()-1;
  const mon    = new Date(now); mon.setDate(now.getDate()-monOff);
  const monKey = mon.toISOString().slice(0,10);
  const { data: weekData } = await db.from('sales')
    .select('sale_date').eq('mall_id', MALL_ID).eq('rep_id', session.id).gte('sale_date', monKey);
  const wd = DAY_SHORT.map((d,i) => {
    const dt  = new Date(mon); dt.setDate(mon.getDate()+i);
    const k   = dt.toISOString().slice(0,10);
    const cnt = (weekData||[]).filter(s=>s.sale_date===k).length;
    return { d, cnt, cur: k===statsDate, fut: dt>now };
  });
  const mx = Math.max(...wd.map(x=>x.cnt), 1);
  $('stats-week').innerHTML = wd.map(x=>`
    <div class="wb-wrap${x.cur?' cur':''}">
      <div class="wb-num">${x.cnt||''}</div>
      <div class="wb ${x.cur?'today':''}" style="height:${x.fut?4:Math.max(4,Math.round(x.cnt/mx*58))}px;opacity:${x.fut?.18:1}"></div>
      <div class="wb-day">${x.d}</div>
    </div>`).join('');

  $('stats-feed').innerHTML = buildFeedHTML(mine, true, true);

  // Shift hours + CPH/ACPH
  const { data: shiftRow } = await db.from('shifts')
    .select('hours').eq('rep_id', session.id).eq('shift_date', statsDate).maybeSingle();
  const shiftHrs = shiftRow?.hours ? parseFloat(shiftRow.hours) : null;
  if (shiftHrs) {
    $('shift-banner').style.display = 'block';
    $('shift-banner-text').textContent = `Today's shift · ${shiftHrs}h (set by lead)`;
    $('cph-stat-row').style.display = '';
    const myCph  = (tot / shiftHrs).toFixed(1);
    const myAcph = (d0s / shiftHrs).toFixed(1);
    $('sk-cph').textContent  = myCph;
    $('sk-acph').textContent = myAcph;
    $('kpi-sk-cph').className  = 'kpi ' + (parseFloat(myCph) >= cphTarget ? 'good' : parseFloat(myCph) >= cphTarget*.75 ? 'warn' : 'bad');
    $('kpi-sk-acph').className = 'kpi ' + (parseFloat(myAcph) >= acphTarget ? 'good' : parseFloat(myAcph) >= acphTarget*.75 ? 'warn' : 'bad');
  } else {
    $('shift-banner').style.display = 'none';
    $('cph-stat-row').style.display = 'none';
  }
}

// ── MANAGE ───────────────────────────────────────────────────────
async function renderManage() {
  $('cph-target-input').value  = cphTarget;
  $('acph-target-input').value = acphTarget;
  renderRoster();
  renderTargetsForm();
  await renderRepList();
  await populateResetSelect();
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
    data.map(r => {
      const ini = r.name.split(' ').map(x=>x[0]).join('').slice(0,2).toUpperCase();
      const isMe = r.id === session.id;
      const disabled = !r.active;
      let actions = '';
      if (!isMe) {
        if (!disabled) {
          actions = `<button class="btn-disable" onclick="disableRep('${r.id}','${r.name.replace(/'/g,"\\'")}')">Disable</button>`;
        } else {
          actions = `<button class="btn-icon btn-delete-rep" onclick="deleteRep('${r.id}','${r.name.replace(/'/g,"\\'")}')">Delete</button>`;
        }
      }
      const safeName = r.name.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
      const canView  = !isMe && r.active;
      const clickAttr = canView ? `onclick="openRepProfile('${safeName}','${r.id}','manage')"` : '';
      return `
        <div class="manage-rep-row${disabled?' mrep-row-disabled':''}${canView?' rep-row-clickable':''}" ${clickAttr}>
          <div class="rep-av${disabled?' rep-av-disabled':''}">${ini}</div>
          <div class="mrep-info">
            <div class="mrep-name">${r.name}${disabled?' <span class="mrep-tag-disabled">Disabled</span>':''}</div>
            <div class="mrep-email">${r.email}</div>
          </div>
          <div class="mrep-role ${r.role}">${r.role==='lead'?'Lead':'Rep'}</div>
          ${canView ? '<svg class="rep-chev" viewBox="0 0 14 14"><polyline points="4,2 10,7 4,12"/></svg>' : ''}
          ${actions}
        </div>`;
    }).join('');
}

window.addRep = async function() {
  const name  = $('new-rep-name').value.trim();
  const email = $('new-rep-email').value.trim().toLowerCase();
  const pin   = $('new-rep-pin').value.trim();
  const role  = $('new-rep-role').value;
  if (!name||!email||!pin) { toast('Fill in all fields'); return; }
  if (pin.length < 4)      { toast('PIN must be 4–6 digits'); return; }
  const pin_hash = await hashPin(pin);
  const { error } = await db.from('reps').insert({ mall_id:MALL_ID, name, email, role, pin_hash, active:true, must_change_pin:true });
  if (error) { toast(error.code==='23505'?'Email already exists':'Error adding rep'); return; }
  $('new-rep-name').value=''; $('new-rep-email').value=''; $('new-rep-pin').value='';
  toast(name+' added ✓');
  await renderRepList();
  await populateRepSelect();
  await populateResetSelect();
};

window.disableRep = async function(id, name) {
  if (!confirm(`Disable ${name}?\n\nThey won't be able to log in, but all their sales history is kept.`)) return;
  await db.from('reps').update({ active:false }).eq('id', id);
  toast(name + ' disabled');
  await renderRepList();
  await populateRepSelect();
  await populateResetSelect();
};

window.deleteRep = async function(id, name) {
  const confirmed = prompt(
    `This will permanently delete ${name} and ALL their sales history.\n\nType DELETE to confirm.`
  );
  if (confirmed?.trim().toUpperCase() !== 'DELETE') return;
  const { error } = await db.from('reps').delete().eq('id', id);
  if (error) { toast('Error deleting rep'); return; }
  toast(name + ' deleted');
  await renderRepList();
  await populateRepSelect();
  await populateResetSelect();
};

window.resetPin = async function() {
  const repId  = $('reset-rep-select').value;
  const newPin = $('reset-new-pin').value.trim();
  if (!repId)  { toast('Select a rep'); return; }
  if (!newPin || newPin.length < 4) { toast('PIN must be 4–6 digits'); return; }
  const pin_hash = await hashPin(newPin);
  const { error } = await db.from('reps').update({ pin_hash, must_change_pin: true }).eq('id', repId);
  if (error) { toast('Error resetting PIN'); return; }
  // Fire-and-forget: sync Supabase Auth password via Edge Function (non-blocking)
  const { data: sd } = await db.auth.getSession();
  if (sd?.session?.access_token) {
    fetch(`${SUPABASE_URL}/functions/v1/reset-pin`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${sd.session.access_token}`,
        'apikey': SUPABASE_ANON,
      },
      body: JSON.stringify({ rep_id: repId, pin_hash }),
    }).catch(console.warn);
  }
  $('reset-new-pin').value = '';
  $('reset-rep-select').value = '';
  toast('PIN reset ✓');
};

// ── REP DRILL-DOWN MODAL ──────────────────────────────────────────
let modalRepName = '';
let modalRepId   = '';
let modalRefDate = '';

window.openRepModal = async function(repName, date, repId) {
  modalRepName = repName;
  modalRepId   = repId;
  modalRefDate = date;
  const ini = repName.split(' ').map(x=>x[0]).join('').slice(0,2).toUpperCase();
  $('modal-av').textContent       = ini;
  $('modal-rep-name').textContent = repName;
  $('modal-rep-sub').textContent  = 'CF Promenade St-Bruno';
  document.querySelectorAll('.modal-period-btn').forEach((b,i) => b.classList.toggle('active', i===1));
  $('rep-modal-overlay').style.display = 'block';
  $('rep-modal').style.display         = 'flex';
  await loadModalPeriod('week');
};

window.loadModalPeriod = async function(period, btn) {
  if (btn) {
    document.querySelectorAll('.modal-period-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  }

  let sales = [], chartBars = [], chartLbl = '';
  const ref    = new Date(modalRefDate + 'T12:00:00');
  const today  = todayKey();

  if (period === 'day') {
    const { data } = await db.from('sales').select('*')
      .eq('mall_id', MALL_ID).eq('rep_id', modalRepId).eq('sale_date', modalRefDate);
    sales = data || [];
    chartLbl = fmtDateStr(modalRefDate);
    const hm = {};
    sales.forEach(s => { const h = parseInt(s.sale_time?.slice(0,2)||'9'); hm[h]=(hm[h]||0)+1; });
    const hours = [9,10,11,12,13,14,15,16,17,18,19];
    const nowH  = new Date().getHours();
    chartBars = hours.map(h => ({ l: h+'h', n: hm[h]||0, cur: h===nowH && modalRefDate===today }));

  } else if (period === 'week') {
    const dow    = ref.getDay();
    const monOff = dow===0 ? 6 : dow-1;
    const mon    = new Date(ref); mon.setDate(ref.getDate()-monOff);
    const sun    = new Date(mon); sun.setDate(mon.getDate()+6);
    const monKey = mon.toISOString().slice(0,10);
    const sunKey = sun.toISOString().slice(0,10);
    const { data } = await db.from('sales').select('*')
      .eq('mall_id', MALL_ID).eq('rep_id', modalRepId)
      .gte('sale_date', monKey).lte('sale_date', sunKey);
    sales = data || [];
    chartLbl = 'This week';
    const dm = {};
    sales.forEach(s => { dm[s.sale_date]=(dm[s.sale_date]||0)+1; });
    chartBars = DAY_SHORT.map((d,i) => {
      const dt = new Date(mon); dt.setDate(mon.getDate()+i);
      const k  = dt.toISOString().slice(0,10);
      return { l:d, n:dm[k]||0, cur: k===modalRefDate };
    });

  } else {
    const y = ref.getFullYear(), m = ref.getMonth();
    const firstKey = new Date(y,m,1).toISOString().slice(0,10);
    const lastKey  = new Date(y,m+1,0).toISOString().slice(0,10);
    const { data } = await db.from('sales').select('*')
      .eq('mall_id', MALL_ID).eq('rep_id', modalRepId)
      .gte('sale_date', firstKey).lte('sale_date', lastKey);
    sales = data || [];
    chartLbl = ref.toLocaleDateString('en-CA', {month:'long', year:'numeric'});
    const weeks = [{l:'W1',n:0,cur:false},{l:'W2',n:0,cur:false},{l:'W3',n:0,cur:false},{l:'W4',n:0,cur:false}];
    sales.forEach(s => { const wi = Math.min(Math.floor((parseInt(s.sale_date.slice(8))-1)/7),3); weeks[wi].n++; });
    const curWi = Math.min(Math.floor((parseInt(modalRefDate.slice(8))-1)/7),3);
    weeks[curWi].cur = true;
    chartBars = weeks;
  }

  // KPIs
  const n   = sales.length;
  const d0r = pct(sales.filter(s=>s.activated).length, n);
  const crr = pct(sales.filter(s=>s.type==='credit').length, n);
  const kpiColor = (v, g, w) => n===0?'':v>=g?'var(--green)':v>=w?'var(--amber)':'var(--red)';
  $('modal-kpis').innerHTML = `
    <div class="modal-kpi"><div class="modal-kpi-val">${n}</div><div class="modal-kpi-lbl">Sales</div></div>
    <div class="modal-kpi"><div class="modal-kpi-val" style="color:${kpiColor(d0r,D0_TGT,50)}">${d0r}%</div><div class="modal-kpi-lbl">D0 rate</div></div>
    <div class="modal-kpi"><div class="modal-kpi-val" style="color:${kpiColor(crr,CR_TGT,35)}">${crr}%</div><div class="modal-kpi-lbl">Credit mix</div></div>
  `;

  // Bar chart
  $('modal-chart-lbl').textContent = chartLbl;
  const mx = Math.max(...chartBars.map(b=>b.n), 1);
  $('modal-chart').innerHTML = chartBars.map(b => `
    <div class="wb-wrap${b.cur?' cur':''}">
      <div class="wb-num">${b.n||''}</div>
      <div class="wb${b.cur?' today':''}" style="height:${Math.max(3,Math.round(b.n/mx*58))}px"></div>
      <div class="wb-day">${b.l}</div>
    </div>`).join('');

  // Product breakdown
  const lc = {}, lt = {};
  sales.forEach(s => (s.labels||[]).forEach(l => { lc[l]=(lc[l]||0)+1; lt[l]=s.type; }));
  const sorted = Object.entries(lc).sort((a,b)=>b[1]-a[1]);
  const maxC   = sorted[0]?.[1] || 1;
  $('modal-breakdown').innerHTML = `
    <div class="card-title" style="margin-bottom:10px">Product breakdown</div>
    ${sorted.length ? sorted.map(([l,c]) => `
      <div class="modal-bd-row">
        <div class="modal-bd-name">${l}</div>
        <div class="modal-bd-track"><div class="modal-bd-fill modal-bd-${lt[l]==='credit'?'blue':'green'}" style="width:${Math.round(c/maxC*100)}%"></div></div>
        <div class="modal-bd-count">${c}</div>
      </div>`).join('') : '<div class="empty" style="padding:16px 0;text-align:left">No sales in this period.</div>'}
  `;
};

window.closeRepModal = function() {
  $('rep-modal-overlay').style.display = 'none';
  $('rep-modal').style.display = 'none';
};

// ── ROSTER ───────────────────────────────────────────────────────
async function renderRoster() {
  const isPast = rosterDate < todayKey();
  updateDatePill('roster-date', rosterDate);
  $('roster-next').disabled = rosterDate >= todayKey();
  $('roster-past-banner').style.display = isPast ? 'block' : 'none';
  $('roster-save-btn').textContent = isPast ? 'Update past roster' : 'Save roster';

  const [{ data: reps }, { data: shifts }, salesResp] = await Promise.all([
    db.from('reps').select('id, name, role').eq('mall_id', MALL_ID).eq('active', true).order('name'),
    db.from('shifts').select('rep_id, hours').eq('mall_id', MALL_ID).eq('shift_date', rosterDate),
    isPast ? db.from('sales').select('rep_id, activated').eq('mall_id', MALL_ID).eq('sale_date', rosterDate) : { data: [] }
  ]);

  const shiftMap = {};
  (shifts || []).forEach(s => { shiftMap[s.rep_id] = parseFloat(s.hours); });

  const salesMap = {};
  (salesResp.data || []).forEach(s => {
    if (!salesMap[s.rep_id]) salesMap[s.rep_id] = { n:0, d0:0 };
    salesMap[s.rep_id].n++;
    if (s.activated) salesMap[s.rep_id].d0++;
  });

  $('roster-list').innerHTML = (reps || []).map(r => {
    const hrs  = shiftMap[r.id] || null;
    const isOn = hrs !== null;
    const ini  = r.name.split(' ').map(x=>x[0]).join('').slice(0,2).toUpperCase();
    const sm   = salesMap[r.id];
    let statsHtml = '';
    if (isPast && sm) {
      if (hrs) {
        const cv = (sm.n/hrs).toFixed(1), av = (sm.d0/hrs).toFixed(1);
        statsHtml = `<div class="chips" style="margin-top:4px">
          <div class="ck cnt">${sm.n} cx</div>
          <div class="ck ${parseFloat(cv)>=cphTarget?'g':'r'}">${cv} CPH</div>
          <div class="ck ${parseFloat(av)>=acphTarget?'g':'r'}">${av} ACPH</div>
        </div>`;
      } else {
        statsHtml = `<div class="chips" style="margin-top:4px"><div class="ck cnt">${sm.n} cx · no hours set</div></div>`;
      }
    }
    return `<div class="manage-rep-row" data-rep-id="${r.id}">
      <div class="rep-av">${ini}</div>
      <div class="mrep-info">
        <div class="mrep-name">${r.name}</div>
        <div class="mrep-email">${r.role === 'lead' ? 'Lead' : 'Rep'}</div>
        ${statsHtml}
      </div>
      <div style="display:flex;align-items:center;gap:6px;flex-shrink:0">
        <button class="tog${isOn?' on':''}" onclick="toggleRosterRep(this)"></button>
        <input class="roster-hrs-input" type="number" value="${hrs||''}" placeholder="—" min="0.5" max="14" step="0.5" ${!isOn?'disabled':''}>
        <span class="mrep-email">h</span>
      </div>
    </div>`;
  }).join('');
}

window.shiftRosterDate = function(n) {
  const next = shiftDateStr(rosterDate, n);
  if (next > todayKey()) return;
  rosterDate = next;
  renderRoster();
};

window.toggleRosterRep = function(btn) {
  btn.classList.toggle('on');
  const row   = btn.closest('.manage-rep-row');
  const input = row.querySelector('.roster-hrs-input');
  const isOn  = btn.classList.contains('on');
  input.disabled     = !isOn;
  input.style.opacity = isOn ? '1' : '0.35';
};

window.saveRoster = async function() {
  const rows    = document.querySelectorAll('#roster-list .manage-rep-row');
  const upserts = [], toDelete = [];
  rows.forEach(row => {
    const repId = row.dataset.repId;
    const isOn  = row.querySelector('.tog').classList.contains('on');
    const hrs   = parseFloat(row.querySelector('.roster-hrs-input').value);
    if (isOn && hrs > 0) upserts.push({ mall_id: MALL_ID, rep_id: repId, shift_date: rosterDate, hours: hrs });
    else toDelete.push(repId);
  });
  const ops = [];
  if (upserts.length) ops.push(db.from('shifts').upsert(upserts, { onConflict: 'rep_id,shift_date' }));
  if (toDelete.length) ops.push(db.from('shifts').delete().eq('mall_id', MALL_ID).eq('shift_date', rosterDate).in('rep_id', toDelete));
  await Promise.all(ops);
  toast('Roster saved ✓');
  if (rosterDate === dashDate) renderDash();
};

window.saveCphTargets = async function() {
  const cph  = parseFloat($('cph-target-input').value);
  const acph = parseFloat($('acph-target-input').value);
  if (!cph || !acph || cph <= 0 || acph <= 0) { toast('Enter valid targets'); return; }
  const { error } = await db.from('malls').update({ cph_target: cph, acph_target: acph }).eq('id', MALL_ID);
  if (error) { toast('Error saving targets'); return; }
  cphTarget = cph; acphTarget = acph;
  toast('CPH targets saved ✓');
  renderDash();
};

// ── REP PROFILE (full-page) ──────────────────────────────────────
let profileRepName  = '';
let profileRepId    = '';
let profileDate     = '';
let profilePrevView = 'dash';
let profilePeriod   = 'week';

window.openRepProfile = function(repName, repId, fromView) {
  profileRepName  = repName;
  profileRepId    = repId;
  profilePrevView = fromView || 'dash';
  profileDate     = dashDate || todayKey();
  const ini = repName.split(' ').map(x=>x[0]).join('').slice(0,2).toUpperCase();
  $('profile-av').textContent   = ini;
  $('profile-name').textContent = repName;
  updateDatePill('profile-date', profileDate);
  document.querySelectorAll('.profile-period').forEach((b,i) => b.classList.toggle('active', i===1));
  profilePeriod = 'week';
  ['lview-dash','lview-feed','lview-manage','view-log','view-contacts','lview-rep-profile']
    .forEach(id => $(id).classList.remove('active'));
  $('lview-rep-profile').classList.add('active');
  document.querySelectorAll('#lead-nav .nav-btn').forEach(b => b.classList.remove('active'));
  renderProfileData();
};

window.closeRepProfile = function() {
  $('lview-rep-profile').classList.remove('active');
  goLead(profilePrevView);
};

window.expandRepProfile = function() {
  closeRepModal();
  openRepProfile(modalRepName, modalRepId, 'dash');
};

window.setProfilePeriod = function(period, btn) {
  document.querySelectorAll('.profile-period').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  profilePeriod = period;
  renderProfileData();
};

async function renderProfileData() {
  let sales = [], chartBars = [], chartLbl = '';
  const ref   = new Date(profileDate + 'T12:00:00');
  const today = todayKey();

  if (profilePeriod === 'day') {
    const { data } = await db.from('sales').select('*')
      .eq('mall_id', MALL_ID).eq('rep_id', profileRepId).eq('sale_date', profileDate);
    sales = data || [];
    chartLbl = fmtDateStr(profileDate);
    const hm = {}, nowH = new Date().getHours();
    sales.forEach(s => { const h=parseInt(s.sale_time?.slice(0,2)||'9'); hm[h]=(hm[h]||0)+1; });
    chartBars = [9,10,11,12,13,14,15,16,17,18,19].map(h => ({ l:h+'h', n:hm[h]||0, cur:h===nowH&&profileDate===today }));

  } else if (profilePeriod === 'week') {
    const dow=ref.getDay(), monOff=dow===0?6:dow-1;
    const mon=new Date(ref); mon.setDate(ref.getDate()-monOff);
    const sun=new Date(mon); sun.setDate(mon.getDate()+6);
    const { data } = await db.from('sales').select('*')
      .eq('mall_id',MALL_ID).eq('rep_id',profileRepId)
      .gte('sale_date',mon.toISOString().slice(0,10)).lte('sale_date',sun.toISOString().slice(0,10));
    sales=data||[]; chartLbl='This week';
    const dm={};
    sales.forEach(s=>{dm[s.sale_date]=(dm[s.sale_date]||0)+1;});
    chartBars=DAY_SHORT.map((d,i)=>{
      const dt=new Date(mon);dt.setDate(mon.getDate()+i);
      const k=dt.toISOString().slice(0,10);
      return{l:d,n:dm[k]||0,cur:k===profileDate};
    });

  } else {
    const y=ref.getFullYear(),m=ref.getMonth();
    const { data } = await db.from('sales').select('*')
      .eq('mall_id',MALL_ID).eq('rep_id',profileRepId)
      .gte('sale_date',new Date(y,m,1).toISOString().slice(0,10))
      .lte('sale_date',new Date(y,m+1,0).toISOString().slice(0,10));
    sales=data||[];
    chartLbl=ref.toLocaleDateString('en-CA',{month:'long',year:'numeric'});
    const weeks=[{l:'W1',n:0,cur:false},{l:'W2',n:0,cur:false},{l:'W3',n:0,cur:false},{l:'W4',n:0,cur:false}];
    sales.forEach(s=>{const wi=Math.min(Math.floor((parseInt(s.sale_date.slice(8))-1)/7),3);weeks[wi].n++;});
    weeks[Math.min(Math.floor((parseInt(profileDate.slice(8))-1)/7),3)].cur=true;
    chartBars=weeks;
  }

  const n=sales.length;
  const d0r=pct(sales.filter(s=>s.activated).length,n);
  const crr=pct(sales.filter(s=>s.type==='credit').length,n);
  const col=(v,g,w)=>n===0?'':v>=g?'var(--green)':v>=w?'var(--amber)':'var(--red)';

  $('profile-kpis').innerHTML=`
    <div class="modal-kpi"><div class="modal-kpi-val">${n}</div><div class="modal-kpi-lbl">Sales</div></div>
    <div class="modal-kpi"><div class="modal-kpi-val" style="color:${col(d0r,D0_TGT,50)}">${d0r}%</div><div class="modal-kpi-lbl">D0 rate</div></div>
    <div class="modal-kpi"><div class="modal-kpi-val" style="color:${col(crr,CR_TGT,35)}">${crr}%</div><div class="modal-kpi-lbl">Credit mix</div></div>
  `;

  $('profile-chart-lbl').textContent=chartLbl;
  const mx=Math.max(...chartBars.map(b=>b.n),1);
  $('profile-chart').innerHTML=chartBars.map(b=>`
    <div class="wb-wrap${b.cur?' cur':''}">
      <div class="wb-num">${b.n||''}</div>
      <div class="wb${b.cur?' today':''}" style="height:${Math.max(3,Math.round(b.n/mx*58))}px"></div>
      <div class="wb-day">${b.l}</div>
    </div>`).join('');

  const lc={},lt={};
  sales.forEach(s=>(s.labels||[]).forEach(l=>{lc[l]=(lc[l]||0)+1;lt[l]=s.type;}));
  const sorted=Object.entries(lc).sort((a,b)=>b[1]-a[1]);
  const maxC=sorted[0]?.[1]||1;
  $('profile-breakdown').innerHTML=`
    <div class="card-title" style="margin-bottom:10px">Product breakdown</div>
    ${sorted.length?sorted.map(([l,c])=>`
      <div class="modal-bd-row">
        <div class="modal-bd-name">${l}</div>
        <div class="modal-bd-track"><div class="modal-bd-fill modal-bd-${lt[l]==='credit'?'blue':'green'}" style="width:${Math.round(c/maxC*100)}%"></div></div>
        <div class="modal-bd-count">${c}</div>
      </div>`).join(''):'<div class="empty" style="padding:16px 0;text-align:left">No sales in this period.</div>'}
  `;
}

// ── CONTACTS ─────────────────────────────────────────────────────

window.toggleCxChip = function(chip) {
  const idx = cxInterested.indexOf(chip);
  if (idx > -1) { cxInterested.splice(idx, 1); $('cxchip-'+chip).classList.remove('in'); }
  else          { cxInterested.push(chip);      $('cxchip-'+chip).classList.add('in'); }
};

window.setCxFollowup = function(offset) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const pad = n => String(n).padStart(2,'0');
  $('cx-followup-dt').value = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T10:00`;
  $('cx-followup-dt').style.display = 'block';
  $('cx-fup-today').classList.toggle('on', offset === 0);
  $('cx-fup-tomorrow').classList.toggle('on', offset === 1);
};

window.pickCxDate = function() {
  const dt = $('cx-followup-dt');
  dt.style.display = 'block';
  dt.focus();
  $('cx-fup-today').classList.remove('on');
  $('cx-fup-tomorrow').classList.remove('on');
};

window.saveContact = async function() {
  const name = $('cx-name').value.trim();
  if (!name) { toast('Enter customer name'); return; }
  const btn = document.querySelector('#view-contacts .btn-primary');
  btn.disabled = true; btn.textContent = 'Saving…';
  const fupVal = $('cx-followup-dt').value;
  const contact = {
    mall_id:       MALL_ID,
    rep_id:        session.id,
    rep_name:      session.name,
    name,
    phone:         $('cx-phone').value.trim() || null,
    email:         $('cx-email').value.trim() || null,
    interested_in: cxInterested.length ? [...cxInterested] : null,
    notes:         $('cx-notes').value.trim() || null,
    follow_up_at:  fupVal ? new Date(fupVal).toISOString() : null,
    status:        'pending'
  };
  const { error } = await db.from('contacts').insert(contact);
  if (error) { toast('Error saving contact'); btn.disabled=false; btn.textContent='Save contact'; return; }
  toast(name + ' saved ✓');
  resetContactForm();
  btn.disabled = false; btn.textContent = 'Save contact';
  await renderContacts();
};

window.updateContactStatus = async function(id, status) {
  const { error } = await db.from('contacts').update({ status }).eq('id', id);
  if (error) { toast('Error updating'); return; }
  const msgs = { converted: '✓ Converted!', lost: 'Marked lost', called: '✓ Called' };
  toast(msgs[status] || '✓ Updated');
  await renderContacts();
};

window.deleteContact = async function(id) {
  if (!confirm('Delete this contact?')) return;
  const { error } = await db.from('contacts').delete().eq('id', id);
  if (error) { toast('Error deleting'); return; }
  toast('Contact deleted');
  await renderContacts();
};

window.toggleCxCard = function(id) {
  const card = $('cxcard-' + id);
  if (card) card.classList.toggle('open');
};

function resetContactForm() {
  const fields = ['cx-name','cx-phone','cx-email','cx-notes'];
  fields.forEach(id => { const e=$(id); if(e) e.value=''; });
  const dt = $('cx-followup-dt');
  if (dt) { dt.value=''; dt.style.display='none'; }
  cxInterested = [];
  document.querySelectorAll('.cx-chip').forEach(el => el.classList.remove('in'));
  document.querySelectorAll('.cx-fup-btn').forEach(el => el.classList.remove('on'));
}

// ALWAYS filters by rep_id = session.id — no exceptions
async function renderContacts() {
  const { data } = await db.from('contacts')
    .select('*')
    .eq('rep_id', session.id)
    .order('follow_up_at', { ascending: true, nullsFirst: false });

  $('cx-list').innerHTML = buildContactsHTML(data || []);

  const today = todayKey();
  const overdueCount = (data || []).filter(c =>
    c.status === 'pending' && c.follow_up_at && localDateStr(c.follow_up_at) < today
  ).length;
  ['nav-contacts-badge','lnav-contacts-badge'].forEach(id => {
    const el = $(id);
    if (!el) return;
    el.textContent = overdueCount || '';
    el.style.display = overdueCount > 0 ? 'flex' : 'none';
  });
}

function buildContactsHTML(contacts) {
  if (!contacts.length) return '<div class="empty">No contacts yet.<br>Add your first lead above.</div>';

  const today    = todayKey();
  const tomorrow = shiftDateStr(today, 1);
  const groups   = { overdue:[], today:[], upcoming:[], nodate:[], past:[] };

  contacts.forEach(c => {
    if (c.status !== 'pending') { groups.past.push(c); return; }
    if (!c.follow_up_at)        { groups.nodate.push(c); return; }
    const d = localDateStr(c.follow_up_at);
    if (d < today)       groups.overdue.push(c);
    else if (d === today) groups.today.push(c);
    else                  groups.upcoming.push(c);
  });

  let html = '';
  if (groups.overdue.length)  html += renderCxGroup('Overdue',     groups.overdue,  today, tomorrow);
  if (groups.today.length)    html += renderCxGroup('Today',       groups.today,    today, tomorrow);
  if (groups.upcoming.length) html += renderCxGroup('Upcoming',    groups.upcoming, today, tomorrow);
  if (groups.nodate.length)   html += renderCxGroup('No date set', groups.nodate,   today, tomorrow);
  if (groups.past.length)     html += renderCxGroup('Past',        groups.past,     today, tomorrow);
  return html;
}

function renderCxGroup(label, contacts, today, tomorrow) {
  return `<div class="cx-section-label">${label}</div>` +
    contacts.map(c => renderCxCard(c, today, tomorrow)).join('');
}

function renderCxCard(c, today, tomorrow) {
  const statusLabels = { pending:'Pending', called:'Called', converted:'Converted', lost:'Lost' };
  const intLabels    = { credit:'Credit Card', money:'Money Account', debit:'Debit' };

  // follow-up label
  let fuLabel = '';
  if (c.follow_up_at) {
    const d = localDateStr(c.follow_up_at);
    if (d < today)         fuLabel = `<div class="cx-followup cx-overdue">Overdue · ${fmtDateStr(d)}</div>`;
    else if (d === today)  fuLabel = `<div class="cx-followup cx-today">Today</div>`;
    else if (d === tomorrow) fuLabel = `<div class="cx-followup">Tomorrow</div>`;
    else                   fuLabel = `<div class="cx-followup">${fmtDateStr(d)}</div>`;
  }

  const intChips = (c.interested_in || []).map(i =>
    `<span class="ck cnt">${intLabels[i] || i}</span>`
  ).join('');

  const phoneLink = c.phone ? `<a class="cx-contact-link" href="tel:${c.phone}" onclick="event.stopPropagation()">${c.phone}</a>` : '';
  const emailLink = c.email ? `<a class="cx-contact-link" href="mailto:${c.email}" onclick="event.stopPropagation()">${c.email}</a>` : '';

  // action buttons — never show the current status as a button
  const actions = [];
  if (c.status !== 'called')    actions.push(`<button class="cx-action-btn called"    onclick="updateContactStatus('${c.id}','called')">Mark called</button>`);
  if (c.status !== 'converted') actions.push(`<button class="cx-action-btn converted" onclick="updateContactStatus('${c.id}','converted')">Mark converted</button>`);
  if (c.status !== 'lost')      actions.push(`<button class="cx-action-btn lost"      onclick="updateContactStatus('${c.id}','lost')">Mark lost</button>`);
  actions.push(`<button class="cx-action-btn delete" onclick="deleteContact('${c.id}')">Delete</button>`);

  return `<div class="cx-card" id="cxcard-${c.id}" onclick="toggleCxCard('${c.id}')">
    <div class="cx-card-body">
      <div class="cx-name-row">
        <div class="cx-name">${c.name}</div>
        <span class="status-pill ${c.status}">${statusLabels[c.status]}</span>
      </div>
      ${phoneLink || emailLink ? `<div class="cx-contact-row">${phoneLink}${emailLink ? (phoneLink ? '&nbsp;&nbsp;' : '') + emailLink : ''}</div>` : ''}
      ${intChips ? `<div class="cx-chips">${intChips}</div>` : ''}
      ${c.notes ? `<div class="cx-notes-preview">${c.notes}</div>` : ''}
      ${fuLabel}
    </div>
    <div class="cx-actions" onclick="event.stopPropagation()">
      ${actions.join('')}
    </div>
  </div>`;
}

// ── OFFLINE QUEUE ────────────────────────────────────────────────
// Failed sale inserts are saved to IndexedDB and replayed when connectivity returns.

function openOfflineDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('neo-offline', 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore('sales', { keyPath: 'qid' });
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error);
  });
}

async function queueSale(sale) {
  const idb = await openOfflineDB();
  return new Promise((resolve, reject) => {
    const tx = idb.transaction('sales', 'readwrite');
    tx.objectStore('sales').add({ qid: crypto.randomUUID(), ...sale, queued_at: Date.now() });
    tx.oncomplete = resolve;
    tx.onerror    = e => reject(e.target.error);
  });
}

async function drainQueue() {
  let idb;
  try { idb = await openOfflineDB(); } catch { return; }

  const pending = await new Promise((resolve) => {
    const tx  = idb.transaction('sales', 'readonly');
    const req = tx.objectStore('sales').getAll();
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = () => resolve([]);
  });

  if (!pending.length) return;
  toast(`Syncing ${pending.length} queued sale(s)…`, 3000);

  let synced = 0;
  for (const item of pending) {
    const { qid, queued_at, ...sale } = item;
    const { error } = await db.from('sales').insert(sale);
    if (!error) {
      synced++;
      await new Promise(resolve => {
        const tx = idb.transaction('sales', 'readwrite');
        tx.objectStore('sales').delete(qid);
        tx.oncomplete = resolve;
        tx.onerror    = resolve;
      });
    }
  }

  if (synced > 0) toast(`✓ Synced ${synced} offline sale(s)`);
}

// ── AUTO-REFRESH ──────────────────────────────────────────────────
setInterval(() => {
  if (!session) return;
  if (session.role === 'lead') {
    if ($('lview-dash')?.classList.contains('active')) renderDash();
    if ($('lview-feed')?.classList.contains('active')) renderLeadFeed();
  } else {
    if ($('view-feed')?.classList.contains('active'))  renderRepFeed();
    if ($('view-stats')?.classList.contains('active')) renderRepStats();
  }
}, 30000);
