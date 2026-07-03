// ── MANAGE ────────────────────────────────────────────────────────
import { db }            from '../supabase.js';
import { SUPABASE_URL, SUPABASE_ANON } from '../supabase.js';
import { s }             from './state.js';
import { $, toast, haptic } from './utils.js';
import { hashPin }       from './auth.js';
import { renderRoster }  from './roster.js';

export async function populateRepSelect() {
  const { data } = await db.from('reps')
    .select('id, name').eq('mall_id', s.activeMallId).eq('active', true).order('name');
  const sel = $('rep-select');
  sel.innerHTML = '<option value="">Select rep…</option>';
  (data || []).forEach(r => {
    const o = document.createElement('option');
    o.value = r.id; o.textContent = r.name;
    if (r.id === s.session.id) o.selected = true;
    sel.appendChild(o);
  });
}

async function populateResetSelect() {
  const { data } = await db.from('reps')
    .select('id, name').eq('mall_id', s.activeMallId).eq('active', true).order('name');
  const sel = $('reset-rep-select');
  sel.innerHTML = '<option value="">Select rep…</option>';
  (data || []).forEach(r => {
    const o = document.createElement('option');
    o.value = r.id; o.textContent = r.name;
    sel.appendChild(o);
  });
}

// ── Account card (used by lead manage view) ───────────────────────
function renderAccountCard() {
  const r   = s.session;
  const ini = r.name.split(' ').map(x => x[0]).join('').slice(0, 2).toUpperCase();
  const roleLabel = { rep: 'Sales Rep', lead: 'Mall Lead', manager: 'District Manager', admin: 'Admin' }[r.role] || r.role;
  const meta      = [roleLabel, s.activeMallName].filter(Boolean).join(' · ');
  if ($('acct-av'))    $('acct-av').textContent   = ini;
  if ($('acct-name'))  $('acct-name').textContent = r.name;
  if ($('acct-email')) $('acct-email').textContent = r.email;
  if ($('acct-meta'))  $('acct-meta').textContent  = meta;
  // Keep lead-email-display in sync (used by boot.js sign-out reset)
  if ($('lead-email-display')) $('lead-email-display').textContent = r.email;
}

// ── Account card HTML string (injected into manager manage view) ──
function accountCardHTML() {
  const r   = s.session;
  const ini = r.name.split(' ').map(x => x[0]).join('').slice(0, 2).toUpperCase();
  const roleLabel = { rep: 'Sales Rep', lead: 'Mall Lead', manager: 'District Manager', admin: 'Admin' }[r.role] || r.role;
  const meta = [roleLabel, s.activeDistrictName].filter(Boolean).join(' · ');
  return `
    <span class="sec first">My account</span>
    <div class="card"><div class="card-pad">
      <div class="acct-row">
        <div class="rep-av" id="acct-av">${ini}</div>
        <div class="acct-info">
          <div class="acct-name">${r.name}</div>
          <div class="acct-email">${r.email}</div>
          <div class="acct-meta">${meta}</div>
        </div>
        <button class="btn-logout" onclick="doLogout()">Sign out</button>
      </div>
      <button class="see-all-btn acct-pin-btn" onclick="toggleChangePinForm()">🔑 Change my PIN</button>
      <div id="change-pin-form" class="change-pin-form" style="display:none">
        <input class="input" type="password" id="change-current-pin" placeholder="Current PIN" inputmode="numeric" maxlength="6">
        <input class="input" type="password" id="change-new-pin"     placeholder="New PIN (4–6 digits)" inputmode="numeric" maxlength="6">
        <input class="input" type="password" id="change-confirm-pin" placeholder="Confirm new PIN" inputmode="numeric" maxlength="6">
        <div id="change-pin-err" style="display:none;color:var(--red);font-size:13px;padding:2px 0"></div>
        <div style="display:flex;gap:8px;margin-top:4px">
          <button class="btn-primary"   style="flex:1" onclick="submitChangePin()">Save PIN</button>
          <button class="btn-secondary" style="flex:1" onclick="toggleChangePinForm()">Cancel</button>
        </div>
      </div>
    </div></div>`;
}

export async function renderManage() {
  renderAccountCard();
  $('cph-target-input').value  = s.cphTarget;
  $('acph-target-input').value = s.acphTarget;
  renderRoster();
  renderTargetsForm();
  await renderRepList();
  await populateResetSelect();
}

// ── Change PIN (self-service) ─────────────────────────────────────
window.toggleChangePinForm = function() {
  const form = $('change-pin-form');
  if (!form) return;
  const opening = form.style.display === 'none';
  form.style.display = opening ? 'flex' : 'none';
  if (opening) {
    if ($('change-current-pin')) $('change-current-pin').focus();
    if ($('change-pin-err'))     $('change-pin-err').style.display = 'none';
  } else {
    // Clear fields on close
    ['change-current-pin','change-new-pin','change-confirm-pin']
      .forEach(id => { if ($(id)) $(id).value = ''; });
  }
};

window.submitChangePin = async function() {
  const currentPin = $('change-current-pin')?.value.trim();
  const newPin     = $('change-new-pin')?.value.trim();
  const confirmPin = $('change-confirm-pin')?.value.trim();
  const errEl      = $('change-pin-err');

  function showErr(msg) {
    haptic('error');
    if (errEl) { errEl.textContent = msg; errEl.style.display = 'block'; }
    else toast(msg);
  }

  if (!currentPin)                    return showErr('Enter your current PIN.');
  if (!newPin || newPin.length < 4)   return showErr('New PIN must be 4–6 digits.');
  if (newPin !== confirmPin)          return showErr("PINs don't match.");
  if (newPin === currentPin)          return showErr('New PIN must differ from current PIN.');

  const btn = $('change-pin-form')?.querySelector('.btn-primary');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }

  // Verify current PIN first
  const currentHash = await hashPin(currentPin);
  const { data: check } = await db.from('reps')
    .select('id').eq('id', s.session.id).eq('pin_hash', currentHash).single();

  if (!check) {
    if (btn) { btn.disabled = false; btn.textContent = 'Save PIN'; }
    return showErr('Current PIN is incorrect.');
  }

  const newHash = await hashPin(newPin);
  const { error } = await db.from('reps').update({ pin_hash: newHash, must_change_pin: false }).eq('id', s.session.id);

  if (btn) { btn.disabled = false; btn.textContent = 'Save PIN'; }
  if (error) return showErr('Error saving. Try again.');

  // Update session in memory + storage
  s.session.pin_hash = newHash;
  localStorage.setItem('neo_session', JSON.stringify(s.session));
  db.auth.updateUser({ password: newHash }).catch(console.warn);

  haptic('success');
  window.toggleChangePinForm();
  toast('PIN updated ✓');
};

function renderTargetsForm() {
  const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  $('targets-form').innerHTML = '<div class="card-title">Sales target per day</div>' +
    days.map((d, i) => `
      <div class="target-row">
        <div class="target-day">${d}</div>
        <input class="target-input" type="number" id="tgt-${i}" value="${s.targets[i] || 10}" min="1" max="99">
      </div>`).join('');
}

window.saveTargets = async function() {
  const newTargets = {};
  for (let i = 0; i < 7; i++) newTargets[i] = parseInt($('tgt-' + i).value) || 10;
  const { error } = await db.from('malls').update({ targets: newTargets }).eq('id', s.activeMallId);
  if (error) { toast('Error saving targets'); return; }
  s.targets = newTargets;
  toast('Targets saved ✓');
};

async function renderRepList() {
  const { data } = await db.from('reps').select('*').eq('mall_id', s.activeMallId).order('name');
  if (!data?.length) { $('rep-list').innerHTML = '<div class="empty">No reps yet.</div>'; return; }

  function buildRow(r) {
    const ini      = r.name.split(' ').map(x => x[0]).join('').slice(0, 2).toUpperCase();
    const isMe     = r.id === s.session.id;
    const disabled = !r.active;
    const safeName = r.name.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
    const canView  = !isMe && r.active;
    const actions  = isMe ? '' : (disabled
      ? `<button class="btn-icon btn-delete-rep" onclick="deleteRep('${r.id}','${safeName}')">Delete</button>`
      : `<button class="btn-disable" onclick="disableRep('${r.id}','${safeName}')">Disable</button>`);
    return `<div class="manage-rep-row${disabled ? ' mrep-row-disabled' : ''}${canView ? ' rep-row-clickable' : ''}" data-name="${r.name.toLowerCase()}" ${canView ? `onclick="openRepProfile('${safeName}','${r.id}','manage')"` : ''}>
      <div class="rep-av${disabled ? ' rep-av-disabled' : ''}">${ini}</div>
      <div class="mrep-info">
        <div class="mrep-name">${r.name}${disabled ? ' <span class="mrep-tag-disabled">Disabled</span>' : ''}</div>
        <div class="mrep-email">${r.email}</div>
      </div>
      <div class="mrep-role ${r.role}">${r.role === 'lead' ? 'Lead' : 'Rep'}</div>
      ${canView ? '<svg class="rep-chev" viewBox="0 0 14 14"><polyline points="4,2 10,7 4,12"/></svg>' : ''}
      ${actions}
    </div>`;
  }

  const active   = data.filter(r => r.active);
  const disabled = data.filter(r => !r.active);

  // Search bar + active reps + collapsed disabled reps
  $('rep-list').innerHTML =
    `<div class="list-search-wrap">
       <input class="list-search" type="search" placeholder="Search team…" autocomplete="off"
              oninput="filterLeadRepList(this.value)">
     </div>` +
    `<div id="rep-list-active">${active.map(buildRow).join('') || '<div class="empty">No active reps.</div>'}</div>` +
    (disabled.length ? `
      <button class="see-all-btn" id="disabled-reps-toggle" onclick="toggleLeadDisabled()">
        Show ${disabled.length} disabled rep${disabled.length > 1 ? 's' : ''} ›
      </button>
      <div id="disabled-reps-list" style="display:none">${disabled.map(buildRow).join('')}</div>
    ` : '');
}

window.filterLeadRepList = function(q) {
  const query = q.toLowerCase().trim();
  // Filter both active and disabled lists
  ['rep-list-active', 'disabled-reps-list'].forEach(containerId => {
    const container = $(containerId);
    if (!container) return;
    let anyVisible = false;
    container.querySelectorAll('.manage-rep-row').forEach(el => {
      const match = !query || el.dataset.name?.includes(query);
      el.style.display = match ? '' : 'none';
      if (match) anyVisible = true;
    });
    // Show/hide "no results" message
    let emptyEl = container.querySelector('.list-search-empty');
    if (!anyVisible && query) {
      if (!emptyEl) {
        emptyEl = document.createElement('div');
        emptyEl.className = 'empty list-search-empty';
        container.appendChild(emptyEl);
      }
      emptyEl.textContent = `No reps match "${q}"`;
      emptyEl.style.display = '';
    } else if (emptyEl) {
      emptyEl.style.display = 'none';
    }
  });
};

window.toggleLeadDisabled = function() {
  const el  = $('disabled-reps-list');
  const btn = $('disabled-reps-toggle');
  if (!el) return;
  const expand = el.style.display === 'none';
  el.style.display = expand ? '' : 'none';
  const n = el.querySelectorAll('.manage-rep-row').length;
  btn.textContent = expand ? 'Hide disabled ‹' : `Show ${n} disabled rep${n > 1 ? 's' : ''} ›`;
};

// ── Manager manage view (accordion mall cards) ───────────────────
// Tracks which mall card is currently expanded
let _expandedMallId = null;

export async function renderManageManager() {
  const el = $('mgr-manage-content');
  if (!el) return;
  el.innerHTML = '<div class="empty" style="padding:24px 0">Loading…</div>';

  const mallIds = s.districtMalls.map(m => m.id);
  if (!mallIds.length) { el.innerHTML = '<div class="empty">No malls in district.</div>'; return; }

  const { data: reps } = await db.from('reps')
    .select('id, name, email, role, active, mall_id')
    .in('mall_id', mallIds).order('name');

  const byMall = {};
  (reps || []).forEach(r => {
    if (!byMall[r.mall_id]) byMall[r.mall_id] = [];
    byMall[r.mall_id].push(r);
  });

  // ── Mall accordion cards ─────────────────────────────────────
  const mallCards = s.districtMalls.map(m => {
    const mReps    = byMall[m.id] || [];
    const active   = mReps.filter(r => r.active).length;
    const disabled = mReps.filter(r => !r.active).length;
    const isOpen   = _expandedMallId === m.id;
    const mid      = m.id;
    const sn       = m.name.replace(/'/g, "\\'");

    const activeReps   = mReps.filter(r => r.active);
    const disabledReps = mReps.filter(r => !r.active);

    function taggedRow(r) {
      const base = buildMgrRepRow(r);
      // Inject data-name for search filtering
      return base.replace('<div class="manage-rep-row', `<div class="manage-rep-row" data-name="${r.name.toLowerCase()}"`);
    }

    const repRows      = activeReps.map(taggedRow).join('');
    const disabledRows = disabledReps.map(taggedRow).join('');
    const showSearch   = activeReps.length > 4; // only show search if worth it

    return `
    <div class="mgr-mall-accordion${isOpen ? ' open' : ''}" id="mall-card-${mid}">
      <div class="mgr-mall-accordion-header" onclick="toggleMallCard('${mid}')">
        <div>
          <div class="mgr-mall-accordion-name">${m.name}</div>
          <div class="mgr-mall-accordion-sub">${active} active${disabled ? ` · ${disabled} disabled` : ''}</div>
        </div>
        <svg class="mgr-mall-chev" viewBox="0 0 14 14"><polyline points="2,4 7,10 12,4"/></svg>
      </div>

      <div class="mgr-mall-accordion-body" id="mall-body-${mid}" style="display:${isOpen ? '' : 'none'}">

        ${showSearch ? `<div class="list-search-wrap" style="margin-bottom:8px">
          <input class="list-search" type="search" placeholder="Search reps…" autocomplete="off"
                 oninput="filterMallReps('${mid}', this.value)">
        </div>` : ''}

        <!-- Active reps -->
        <div id="mall-reps-active-${mid}">
          ${repRows || '<div class="empty" style="padding:8px 0">No active reps yet.</div>'}
        </div>

        <!-- Disabled reps (collapsed) -->
        ${disabledReps.length ? `
        <button class="see-all-btn" style="margin-top:4px" onclick="toggleDisabledReps('${mid}')">
          Show ${disabled} disabled rep${disabled > 1 ? 's' : ''} ›
        </button>
        <div id="disabled-reps-${mid}" style="display:none">${disabledRows}</div>
        ` : ''}

        <!-- Add rep form (inline) -->
        <div class="mgr-add-rep-form" id="add-rep-form-${mid}" style="display:none">
          <input id="mgr-rep-name-${mid}"  class="input" type="text"  placeholder="Full name">
          <input id="mgr-rep-email-${mid}" class="input" type="email" placeholder="Email">
          <input id="mgr-rep-pin-${mid}"   class="input" type="number" placeholder="PIN (4–6 digits)">
          <select id="mgr-rep-role-${mid}" class="input">
            <option value="rep">Sales Rep</option>
            <option value="lead">Mall Lead</option>
          </select>
          <div style="display:flex;gap:8px">
            <button class="btn-primary" style="flex:1" onclick="addRepToMall('${mid}')">Add</button>
            <button class="btn-secondary" style="flex:1" onclick="toggleAddRepForm('${mid}')">Cancel</button>
          </div>
        </div>

        <button class="see-all-btn" style="margin-top:8px" onclick="toggleAddRepForm('${mid}')">
          + Add rep to ${m.name}
        </button>
      </div>
    </div>`;
  }).join('');

  el.innerHTML = accountCardHTML() + mallCards + `
    <div class="mgr-mall-accordion" id="mall-card-add-mall">
      <div class="mgr-mall-accordion-header" onclick="toggleMallCard('add-mall')">
        <div>
          <div class="mgr-mall-accordion-name">Add new mall</div>
          <div class="mgr-mall-accordion-sub">Expand to add a mall to this district</div>
        </div>
        <svg class="mgr-mall-chev" viewBox="0 0 14 14"><polyline points="2,4 7,10 12,4"/></svg>
      </div>
      <div class="mgr-mall-accordion-body" id="mall-body-add-mall" style="display:${_expandedMallId === 'add-mall' ? '' : 'none'}">
        <input id="mgr-mall-name" class="input" type="text" placeholder="Mall name">
        <input id="mgr-mall-location" class="input" type="text" placeholder="City, Province">
        <button class="btn-primary" onclick="addMall()">Add mall</button>
      </div>
    </div>`;
}

function buildMgrRepRow(r) {
  const ini     = r.name.split(' ').map(x => x[0]).join('').slice(0, 2).toUpperCase();
  const isMe    = r.id === s.session.id;
  const sn      = r.name.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
  const actions = isMe ? '' : (!r.active
    ? `<button class="btn-icon btn-delete-rep" onclick="deleteRepReload('${r.id}','${sn}')">Delete</button>`
    : `<button class="btn-disable" onclick="disableRep('${r.id}','${sn}')">Disable</button>`);
  return `<div class="manage-rep-row${!r.active ? ' mrep-row-disabled' : ''}" ${r.active && !isMe ? `onclick="openRepProfile('${sn}','${r.id}','manage')" style="cursor:pointer"` : ''}>
    <div class="rep-av${!r.active ? ' rep-av-disabled' : ''}">${ini}</div>
    <div class="mrep-info">
      <div class="mrep-name">${r.name}${!r.active ? ' <span class="mrep-tag-disabled">Disabled</span>' : ''}</div>
      <div class="mrep-email">${r.email}</div>
    </div>
    <div class="mrep-role ${r.role}">${r.role === 'lead' ? 'Lead' : r.role === 'manager' ? 'Mgr' : 'Rep'}</div>
    ${actions}
  </div>`;
}

window.toggleMallCard = function(mallId) {
  const wasOpen = _expandedMallId === mallId;
  // Close previously open card
  if (_expandedMallId) {
    const prevBody = $('mall-body-' + _expandedMallId);
    const prevCard = $('mall-card-' + _expandedMallId);
    if (prevBody) prevBody.style.display = 'none';
    if (prevCard) prevCard.classList.remove('open');
  }
  _expandedMallId = wasOpen ? null : mallId;
  if (!wasOpen) {
    const body = $('mall-body-' + mallId);
    const card = $('mall-card-' + mallId);
    if (body) body.style.display = '';
    if (card) card.classList.add('open');
  }
};

window.toggleAddRepForm = function(mallId) {
  const form = $('add-rep-form-' + mallId);
  if (!form) return;
  form.style.display = form.style.display === 'none' ? '' : 'none';
};

window.toggleDisabledReps = function(mallId) {
  const el  = $('disabled-reps-' + mallId);
  const btn = el?.previousElementSibling;
  if (!el) return;
  const expand = el.style.display === 'none';
  el.style.display = expand ? '' : 'none';
  if (btn) btn.textContent = expand ? 'Hide disabled ‹' : `Show ${el.querySelectorAll('.manage-rep-row').length} disabled rep${el.querySelectorAll('.manage-rep-row').length > 1 ? 's' : ''} ›`;
};

window.filterMallReps = function(mallId, q) {
  const query     = q.toLowerCase().trim();
  const container = $('mall-reps-active-' + mallId);
  if (!container) return;
  let anyVisible  = false;
  container.querySelectorAll('.manage-rep-row').forEach(el => {
    const match = !query || el.dataset.name?.includes(query);
    el.style.display = match ? '' : 'none';
    if (match) anyVisible = true;
  });
  let emptyEl = container.querySelector('.list-search-empty');
  if (!anyVisible && query) {
    if (!emptyEl) {
      emptyEl = document.createElement('div');
      emptyEl.className = 'empty list-search-empty';
      container.appendChild(emptyEl);
    }
    emptyEl.textContent = `No reps match "${q}"`;
    emptyEl.style.display = '';
  } else if (emptyEl) {
    emptyEl.style.display = 'none';
  }
};

window.addRepToMall = async function(mallId) {
  const name  = $('mgr-rep-name-'  + mallId)?.value.trim();
  const email = $('mgr-rep-email-' + mallId)?.value.trim().toLowerCase();
  const pin   = $('mgr-rep-pin-'   + mallId)?.value.trim();
  const role  = $('mgr-rep-role-'  + mallId)?.value;
  if (!name || !email || !pin) { toast('Fill in all fields'); return; }
  if (pin.length < 4) { toast('PIN must be 4–6 digits'); return; }
  const { hashPin } = await import('./auth.js');
  const pin_hash = await hashPin(pin);
  const { error } = await db.from('reps').insert({
    mall_id: mallId, name, email, role, pin_hash,
    active: true, must_change_pin: true, added_by: s.session.id,
  });
  if (error) { toast(error.code === '23505' ? 'Email already exists' : 'Error adding rep'); return; }
  toast(name + ' added ✓');
  _expandedMallId = mallId;   // keep this mall open after reload
  renderManageManager();
};

window.addRepManager = async function() {
  const name  = $('mgr-rep-name').value.trim();
  const email = $('mgr-rep-email').value.trim().toLowerCase();
  const pin   = $('mgr-rep-pin').value.trim();
  const role  = $('mgr-rep-role').value;
  const mallId = $('mgr-rep-mall').value;
  if (!name || !email || !pin || !mallId) { toast('Fill in all fields'); return; }
  if (pin.length < 4) { toast('PIN must be 4–6 digits'); return; }
  const { hashPin } = await import('./auth.js');
  const pin_hash = await hashPin(pin);
  const { error } = await db.from('reps').insert({
    mall_id: mallId, name, email, role, pin_hash,
    active: true, must_change_pin: true, added_by: s.session.id,
  });
  if (error) { toast(error.code === '23505' ? 'Email already exists' : 'Error adding rep'); return; }
  $('mgr-rep-name').value = ''; $('mgr-rep-email').value = ''; $('mgr-rep-pin').value = '';
  toast(name + ' added ✓');
  renderManageManager();
};

window.deleteRepReload = async function(id, name) {
  const confirmed = prompt(`Permanently delete ${name} and ALL their sales?\n\nType DELETE to confirm.`);
  if (confirmed?.trim().toUpperCase() !== 'DELETE') return;
  const { error } = await db.from('reps').delete().eq('id', id);
  if (error) { toast('Error deleting rep'); return; }
  toast(name + ' deleted');
  renderManageManager();
};

window.addMall = async function() {
  const name     = $('mgr-mall-name')?.value.trim();
  const location = $('mgr-mall-location')?.value.trim();
  if (!name || !location) { toast('Enter mall name and location'); return; }
  const { error, data } = await db.from('malls').insert({
    name, location,
    district_id: s.activeDistrictId,
    targets: { 0:20, 1:10, 2:10, 3:10, 4:15, 5:15, 6:20 },
    cph_target: 2.0,
    acph_target: 1.5,
  }).select().single();
  if (error) { toast('Error adding mall'); return; }
  s.districtMalls.push(data);
  _expandedMallId = data.id;   // auto-open the new mall
  toast(name + ' added ✓');
  renderManageManager();
};

window.addRep = async function() {
  const name  = $('new-rep-name').value.trim();
  const email = $('new-rep-email').value.trim().toLowerCase();
  const pin   = $('new-rep-pin').value.trim();
  const role  = $('new-rep-role').value;
  if (!name || !email || !pin) { toast('Fill in all fields'); return; }
  if (pin.length < 4)          { toast('PIN must be 4–6 digits'); return; }
  const pin_hash = await hashPin(pin);
  const { error } = await db.from('reps').insert({ mall_id: s.activeMallId, name, email, role, pin_hash, active: true, must_change_pin: true, added_by: s.session.id });
  if (error) { toast(error.code === '23505' ? 'Email already exists' : 'Error adding rep'); return; }
  $('new-rep-name').value = ''; $('new-rep-email').value = ''; $('new-rep-pin').value = '';
  toast(name + ' added ✓');
  await renderRepList();
  await populateRepSelect();
  await populateResetSelect();
};

window.disableRep = async function(id, name) {
  if (!confirm(`Disable ${name}?\n\nThey won't be able to log in, but all their sales history is kept.`)) return;
  await db.from('reps').update({ active: false }).eq('id', id);
  toast(name + ' disabled');
  await renderRepList();
  await populateRepSelect();
  await populateResetSelect();
};

window.deleteRep = async function(id, name) {
  const confirmed = prompt(`This will permanently delete ${name} and ALL their sales history.\n\nType DELETE to confirm.`);
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
  // Sync Supabase Auth password via Edge Function (non-blocking)
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
