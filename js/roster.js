// ── ROSTER ────────────────────────────────────────────────────────
import { db }              from '../supabase.js';
import { s }               from './state.js';
import { $, toast, todayKey, shiftDateStr, updateDatePill } from './utils.js';
import { MALL_ID }         from './constants.js';
import { renderDash }      from './dashboard.js';

export async function renderRoster() {
  const isPast = s.rosterDate < todayKey();
  updateDatePill('roster-date', s.rosterDate);
  $('roster-next').disabled     = s.rosterDate >= todayKey();
  $('roster-past-banner').style.display = isPast ? 'block' : 'none';
  $('roster-save-btn').textContent      = isPast ? 'Update past roster' : 'Save roster';

  const [{ data: reps }, { data: shifts }, salesResp] = await Promise.all([
    db.from('reps').select('id, name, role').eq('mall_id', MALL_ID).eq('active', true).order('name'),
    db.from('shifts').select('rep_id, hours').eq('mall_id', MALL_ID).eq('shift_date', s.rosterDate),
    isPast
      ? db.from('sales').select('rep_id, activated').eq('mall_id', MALL_ID).eq('sale_date', s.rosterDate)
      : { data: [] },
  ]);

  const shiftMap = {};
  (shifts || []).forEach(r => { shiftMap[r.rep_id] = parseFloat(r.hours); });

  const salesMap = {};
  (salesResp.data || []).forEach(r => {
    if (!salesMap[r.rep_id]) salesMap[r.rep_id] = { n:0, d0:0 };
    salesMap[r.rep_id].n++;
    if (r.activated) salesMap[r.rep_id].d0++;
  });

  $('roster-list').innerHTML = (reps || []).map(r => {
    const hrs  = shiftMap[r.id] !== undefined ? shiftMap[r.id] : null;
    const isOn = hrs !== null;
    const ini  = r.name.split(' ').map(x => x[0]).join('').slice(0, 2).toUpperCase();
    const sm   = salesMap[r.id];
    let statsHtml = '';
    if (isPast && sm) {
      if (hrs) {
        const cv = (sm.n / hrs).toFixed(1), av = (sm.d0 / hrs).toFixed(1);
        statsHtml = `<div class="chips" style="margin-top:4px">
          <div class="ck cnt">${sm.n} cx</div>
          <div class="ck ${parseFloat(cv) >= s.cphTarget ? 'g' : 'r'}">${cv} CPH</div>
          <div class="ck ${parseFloat(av) >= s.acphTarget ? 'g' : 'r'}">${av} ACPH</div>
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
        <button class="tog${isOn ? ' on' : ''}" onclick="toggleRosterRep(this)"></button>
        <input class="roster-hrs-input" type="number" value="${hrs || ''}" placeholder="—" min="0.5" max="14" step="0.5" ${!isOn ? 'disabled' : ''}>
        <span class="mrep-email">h</span>
      </div>
    </div>`;
  }).join('');
}

window.shiftRosterDate = function(n) {
  const next = shiftDateStr(s.rosterDate, n);
  if (next > todayKey()) return;
  s.rosterDate = next;
  renderRoster();
};

window.toggleRosterRep = function(btn) {
  btn.classList.toggle('on');
  const row   = btn.closest('.manage-rep-row');
  const input = row.querySelector('.roster-hrs-input');
  const isOn  = btn.classList.contains('on');
  input.disabled      = !isOn;
  input.style.opacity = isOn ? '1' : '0.35';
};

window.saveRoster = async function() {
  const rows    = document.querySelectorAll('#roster-list .manage-rep-row');
  const upserts = [], toDelete = [];
  rows.forEach(row => {
    const repId = row.dataset.repId;
    const isOn  = row.querySelector('.tog').classList.contains('on');
    const hrs   = parseFloat(row.querySelector('.roster-hrs-input').value);
    if (isOn && hrs > 0) upserts.push({ mall_id: MALL_ID, rep_id: repId, shift_date: s.rosterDate, hours: hrs });
    else toDelete.push(repId);
  });
  const ops = [];
  if (upserts.length)  ops.push(db.from('shifts').upsert(upserts, { onConflict: 'rep_id,shift_date' }));
  if (toDelete.length) ops.push(db.from('shifts').delete().eq('mall_id', MALL_ID).eq('shift_date', s.rosterDate).in('rep_id', toDelete));
  await Promise.all(ops);
  toast('Roster saved ✓');
  if (s.rosterDate === s.dashDate) renderDash();
};

window.saveCphTargets = async function() {
  const cph  = parseFloat($('cph-target-input').value);
  const acph = parseFloat($('acph-target-input').value);
  if (!cph || !acph || cph <= 0 || acph <= 0) { toast('Enter valid targets'); return; }
  const { error } = await db.from('malls').update({ cph_target: cph, acph_target: acph }).eq('id', MALL_ID);
  if (error) { toast('Error saving targets'); return; }
  s.cphTarget = cph; s.acphTarget = acph;
  toast('CPH targets saved ✓');
  renderDash();
};
