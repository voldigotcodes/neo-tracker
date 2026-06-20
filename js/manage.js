// ── MANAGE ────────────────────────────────────────────────────────
import { db }            from '../supabase.js';
import { SUPABASE_URL, SUPABASE_ANON } from '../supabase.js';
import { s }             from './state.js';
import { $, toast }      from './utils.js';
import { MALL_ID }       from './constants.js';
import { hashPin }       from './auth.js';
import { renderRoster }  from './roster.js';

export async function populateRepSelect() {
  const { data } = await db.from('reps')
    .select('id, name').eq('mall_id', MALL_ID).eq('active', true).order('name');
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
    .select('id, name').eq('mall_id', MALL_ID).eq('active', true).order('name');
  const sel = $('reset-rep-select');
  sel.innerHTML = '<option value="">Select rep…</option>';
  (data || []).forEach(r => {
    const o = document.createElement('option');
    o.value = r.id; o.textContent = r.name;
    sel.appendChild(o);
  });
}

export async function renderManage() {
  $('cph-target-input').value  = s.cphTarget;
  $('acph-target-input').value = s.acphTarget;
  renderRoster();
  renderTargetsForm();
  await renderRepList();
  await populateResetSelect();
}

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
  const { error } = await db.from('malls').update({ targets: newTargets }).eq('id', MALL_ID);
  if (error) { toast('Error saving targets'); return; }
  s.targets = newTargets;
  toast('Targets saved ✓');
};

async function renderRepList() {
  const { data } = await db.from('reps').select('*').eq('mall_id', MALL_ID).order('name');
  $('rep-list').innerHTML = !data?.length ? '<div class="empty">No reps yet.</div>' :
    data.map(r => {
      const ini      = r.name.split(' ').map(x => x[0]).join('').slice(0, 2).toUpperCase();
      const isMe     = r.id === s.session.id;
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
        <div class="manage-rep-row${disabled ? ' mrep-row-disabled' : ''}${canView ? ' rep-row-clickable' : ''}" ${clickAttr}>
          <div class="rep-av${disabled ? ' rep-av-disabled' : ''}">${ini}</div>
          <div class="mrep-info">
            <div class="mrep-name">${r.name}${disabled ? ' <span class="mrep-tag-disabled">Disabled</span>' : ''}</div>
            <div class="mrep-email">${r.email}</div>
          </div>
          <div class="mrep-role ${r.role}">${r.role === 'lead' ? 'Lead' : 'Rep'}</div>
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
  if (!name || !email || !pin) { toast('Fill in all fields'); return; }
  if (pin.length < 4)          { toast('PIN must be 4–6 digits'); return; }
  const pin_hash = await hashPin(pin);
  const { error } = await db.from('reps').insert({ mall_id: MALL_ID, name, email, role, pin_hash, active: true, must_change_pin: true });
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
