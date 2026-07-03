// ── ENTRY POINT ───────────────────────────────────────────────────
// Imports all modules, wires up login/logout/changePin, boots the app.
import { db }                    from '../supabase.js';
import { s }                     from './state.js';
import { $, todayKey, initDates, haptic } from './utils.js';
import { hashPin }               from './auth.js';
import { drainQueue }            from './offline.js';
import { populateRepSelect }     from './manage.js';
import { subscribeRealtime, requestPushPermission } from './realtime.js';
import { resetContactForm }     from './contacts.js';

// Named imports used at runtime
import { renderDash }                from './dashboard.js';
import { renderRepFeed, renderLeadFeed } from './feed.js';
import { renderRepStats }            from './stats.js';

import { resetForm }         from './log.js';

// Side-effect imports — register remaining window.* globals
import './nav.js';
import './calendar.js';
import './roster.js';
import './profile.js';
import './contacts.js';
import './district.js';

// ── Boot ─────────────────────────────────────────────────────────
export async function bootApp() {
  $('view-login').classList.remove('active');

  const isManager = s.session.role === 'manager' || s.session.role === 'admin';
  const isLead    = s.session.role === 'lead';
  const isRep     = s.session.role === 'rep';

  s.dashDate      = todayKey();
  s.districtDate  = todayKey();
  s.feedDate      = todayKey();
  s.statsDate     = todayKey();
  s.rosterDate    = todayKey();

  // Restore saved period preferences
  const savedDashPeriod     = localStorage.getItem('neo_dash_period');
  const savedDistrictPeriod = localStorage.getItem('neo_district_period');
  if (savedDashPeriod)     s.dashPeriod     = savedDashPeriod;
  if (savedDistrictPeriod) s.districtPeriod = savedDistrictPeriod;

  if (isManager) {
    // Load all districts (admin sees all; manager sees their own)
    if (s.session.role === 'admin') {
      const { data: dists } = await db.from('districts').select('id, name').order('name');
      s.districts          = dists || [];
      // Default to showing all districts combined
      s.activeDistrictId   = 'all';
      s.activeDistrictName = 'All Districts';
    } else {
      s.activeDistrictId = s.session.district_id || '';
      const { data } = await db.from('districts').select('name').eq('id', s.activeDistrictId).single();
      s.activeDistrictName = data?.name || 'District';
    }

    // Load malls: admin loads all, manager loads by district
    const mallQ = s.session.role === 'admin'
      ? db.from('malls').select('id, name, district_id, targets, cph_target, acph_target').order('name')
      : db.from('malls').select('id, name, district_id, targets, cph_target, acph_target').eq('district_id', s.activeDistrictId).order('name');
    const { data: malls } = await mallQ;
    s.districtMalls = malls || [];

    $('manager-app').style.display    = 'block';
    $('district-ctx').textContent     = s.activeDistrictName;

    // Show district switcher chevron for all admins (always have "All Districts" option)
    if (s.session.role === 'admin') {
      const chev = $('mgr-district-chev');
      if (chev) chev.style.display = 'inline';
      const pill = $('mgr-district-pill');
      if (pill) pill.style.cursor = 'pointer';
    }

    window.goManager('district');
    subscribeRealtime();

  } else {
    // Rep or Lead: set active mall from session
    s.activeMallId   = s.session.mall_id || '';
    s.activeMallName = s.session.mall_name || '';

    // Load mall config
    const { data: mall } = await db.from('malls')
      .select('name, targets, cph_target, acph_target').eq('id', s.activeMallId).single();
    if (mall?.name)        s.activeMallName = mall.name;
    if (mall?.targets)     s.targets        = mall.targets;
    if (mall?.cph_target)  s.cphTarget      = parseFloat(mall.cph_target);
    if (mall?.acph_target) s.acphTarget     = parseFloat(mall.acph_target);

    await populateRepSelect();

    if (isLead) {
      $('lead-app').style.display          = 'block';
      $('lead-email-display').textContent  = s.session.email;
      window.goLead('dash');
      subscribeRealtime();
      requestPushPermission();
    } else {
      $('rep-app').style.display           = 'block';
      $('rep-email-display').textContent   = s.session.email;
      window.goRep('log');
      subscribeRealtime();
      requestPushPermission();
    }
  }

  initDates();
  drainQueue();
}

// ── Logout ────────────────────────────────────────────────────────
window.doLogout = function() {
  db.auth.signOut().catch(console.warn);
  localStorage.removeItem('neo_session');
  s.session = null;
  if (s.realtimeCh) { db.removeChannel(s.realtimeCh); s.realtimeCh = null; }
  $('lead-app').style.display = 'none';
  $('rep-app').style.display  = 'none';
  $('view-log').classList.remove('active');
  $('view-contacts').classList.remove('active');
  $('view-login').classList.add('active');
  resetContactForm();
  $('login-btn').disabled = false; $('login-btn').textContent = 'Sign in';
  $('login-err').classList.remove('show');
  resetForm();
};

// ── Login ─────────────────────────────────────────────────────────
window.doLogin = async function() {
  const email = $('login-email').value.trim().toLowerCase();
  const pin   = $('login-pin').value.trim();
  const err   = $('login-err');
  const btn   = $('login-btn');
  if (!email || !pin) { err.textContent = 'Enter your email and PIN.'; err.classList.add('show'); return; }
  btn.disabled = true; btn.textContent = 'Signing in…';
  err.classList.remove('show');

  // Step 1: verify credentials only
  let repData;
  try {
    const hash = await hashPin(pin);
    const { data, error } = await db.from('reps')
      .select('*').eq('email', email).eq('pin_hash', hash).eq('active', true).single();
    if (error?.code === 'PGRST116' || !data) {
      haptic('error');
      err.textContent = 'Incorrect email or PIN. Try again.';
      err.classList.add('show');
      btn.disabled = false; btn.textContent = 'Sign in';
      return;
    }
    if (error) throw error;
    repData = data;
    // Sync Supabase Auth in background
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
    haptic('error');
    err.textContent = 'Connection error. Please try again.';
    err.classList.add('show');
    btn.disabled = false; btn.textContent = 'Sign in';
    return;
  }

  // Step 2: session + boot
  s.session = repData;
  localStorage.setItem('neo_session', JSON.stringify(repData));
  if (repData.must_change_pin) {
    $('view-login').classList.remove('active');
    $('view-change-pin').classList.add('active');
    btn.disabled = false; btn.textContent = 'Sign in';
    return;
  }
  await bootApp();
};

// ── Change PIN (first-login flow) ─────────────────────────────────
window.doChangePin = async function() {
  const newPin  = $('pin-new').value.trim();
  const confirm = $('pin-confirm').value.trim();
  const err     = $('pin-err');
  const btn     = $('pin-btn');
  err.classList.remove('show');
  if (newPin.length < 4)  { err.textContent = 'PIN must be 4–6 digits.'; err.classList.add('show'); return; }
  if (newPin !== confirm) { err.textContent = "PINs don't match.";        err.classList.add('show'); return; }
  btn.disabled = true; btn.textContent = 'Saving…';
  const pin_hash = await hashPin(newPin);
  const { error } = await db.from('reps').update({ pin_hash, must_change_pin: false }).eq('id', s.session.id);
  if (error) { err.textContent = 'Error saving. Try again.'; err.classList.add('show'); btn.disabled = false; btn.textContent = 'Set PIN & continue'; return; }
  s.session.must_change_pin = false;
  s.session.pin_hash = pin_hash;
  localStorage.setItem('neo_session', JSON.stringify(s.session));
  db.auth.updateUser({ password: pin_hash }).catch(console.warn);
  $('view-change-pin').classList.remove('active');
  $('pin-new').value = ''; $('pin-confirm').value = '';
  await bootApp();
};

// ── DOMContentLoaded ─────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  const saved = localStorage.getItem('neo_session');
  if (saved) { s.session = JSON.parse(saved); await bootApp(); }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(console.error);
  }

  // Haptic tap on each PIN digit typed
  const pinField = $('login-pin');
  if (pinField) {
    let _lastLen = 0;
    pinField.addEventListener('input', () => {
      if (pinField.value.length > _lastLen) haptic('tap');
      _lastLen = pinField.value.length;
    });
  }

  const dc = $('dep-custom');
  if (dc) dc.addEventListener('input', function() {
    if (this.value) { document.querySelectorAll('.dep-btn').forEach(b => b.classList.remove('on')); s.form.depAmt = this.value; }
    else s.form.depAmt = null;
  });

  window.addEventListener('online', () => { if (s.session) drainQueue(); });
});

// ── Auto-refresh every 30s ────────────────────────────────────────
setInterval(() => {
  if (!s.session) return;
  if (s.session.role === 'lead') {
    if ($('lview-dash')?.classList.contains('active')) renderDash();
    if ($('lview-feed')?.classList.contains('active')) renderLeadFeed();
  } else {
    if ($('view-feed')?.classList.contains('active'))  renderRepFeed();
    if ($('view-stats')?.classList.contains('active')) renderRepStats();
  }
}, 30000);
