// ── DATE PICKER CALENDAR ──────────────────────────────────────────
import { db }                          from '../supabase.js';
import { s }                           from './state.js';
import { $, todayKey, fmtDateStr, shiftDateStr } from './utils.js';
import { renderDash }                  from './dashboard.js';
import { renderLeadFeed }              from './feed.js';
import { renderRoster }                from './roster.js';
import { renderProfileData, updateProfileDate } from './profile.js';

export async function openCal(target) {
  s.calTarget = target;
  const current = target === 'dash'     ? s.dashDate
    : target === 'district' ? s.districtDate
    : target === 'profile'  ? s.profileDate
    : target === 'roster'   ? s.rosterDate
    : s.feedDate;
  s.calMonth = current.slice(0, 7);
  await fetchCalActive();
  renderCal(current);
  $('cal-overlay').style.display = 'block';
  $('cal-popup').style.display   = 'block';
}

export function closeCal() {
  $('cal-overlay').style.display = 'none';
  $('cal-popup').style.display   = 'none';
}

async function fetchCalActive() {
  const [y, m] = s.calMonth.split('-').map(Number);
  const from   = `${s.calMonth}-01`;
  const last   = new Date(y, m, 0).getDate();
  const to     = `${s.calMonth}-${String(last).padStart(2,'0')}`;
  // District calendar: show dots for any mall in district; mall calendar: just this mall
  if (s.calTarget === 'district') {
    const mallIds = s.districtMalls.filter(m2 =>
      !s.activeDistrictId || m2.district_id === s.activeDistrictId
    ).map(m2 => m2.id);
    if (!mallIds.length) { s.calActive = new Set(); return; }
    const { data } = await db.from('sales')
      .select('sale_date').in('mall_id', mallIds)
      .gte('sale_date', from).lte('sale_date', to);
    s.calActive = new Set((data || []).map(d => d.sale_date));
  } else {
    const { data } = await db.from('sales')
      .select('sale_date').eq('mall_id', s.activeMallId)
      .gte('sale_date', from).lte('sale_date', to);
    s.calActive = new Set((data || []).map(d => d.sale_date));
  }
}

function renderCal(selectedDate) {
  const [y, m] = s.calMonth.split('-').map(Number);
  const first  = new Date(y, m - 1, 1);
  const lastD  = new Date(y, m, 0).getDate();
  const today  = todayKey();
  const nowM   = today.slice(0, 7);

  $('cal-month').textContent = first.toLocaleDateString('en-CA', { month:'long', year:'numeric' });
  $('cal-prev').disabled = false;
  $('cal-next').disabled = s.calMonth >= nowM;

  let startDow = first.getDay();
  startDow = startDow === 0 ? 6 : startDow - 1;

  let html = ['Mo','Tu','We','Th','Fr','Sa','Su']
    .map(d => `<div class="cal-dh">${d}</div>`).join('');

  for (let i = 0; i < startDow; i++) html += '<div class="cal-day cal-empty"></div>';

  const minDate = s.calTarget === 'dash' ? shiftDateStr(today, -2) : null;

  for (let d = 1; d <= lastD; d++) {
    const ds      = `${s.calMonth}-${String(d).padStart(2,'0')}`;
    const fut     = ds > today;
    const tooOld  = minDate && ds < minDate;
    const blocked = fut || tooOld;
    const act     = s.calActive.has(ds);
    const sel     = ds === selectedDate;
    const now     = ds === today;
    let cls = 'cal-day';
    if (blocked)     cls += ' cal-future';
    else if (!act)   cls += ' cal-inactive';
    if (sel)         cls += ' cal-sel';
    if (now && !sel) cls += ' cal-today';
    html += `<div class="${cls}" ${!blocked ? `onclick="calPick('${ds}')"` : ''}>${d}</div>`;
  }
  $('cal-grid').innerHTML = html;
}

export async function calShiftMonth(n) {
  const [y, m] = s.calMonth.split('-').map(Number);
  const d      = new Date(y, m - 1 + n, 1);
  const next   = d.toISOString().slice(0, 7);
  if (next > todayKey().slice(0, 7)) return;
  if (s.calTarget === 'dash' && next < shiftDateStr(todayKey(), -2).slice(0, 7)) return;
  s.calMonth = next;
  await fetchCalActive();
  const sel = s.calTarget === 'dash'     ? s.dashDate
    : s.calTarget === 'district' ? s.districtDate
    : s.calTarget === 'profile'  ? s.profileDate
    : s.calTarget === 'roster'   ? s.rosterDate
    : s.feedDate;
  renderCal(sel);
}

export function calPick(date) {
  if (s.calTarget === 'dash') {
    s.dashDate = date;
    renderDash();
  } else if (s.calTarget === 'district') {
    s.districtDate = date;
    if (window.renderDistrict) window.renderDistrict();
  } else if (s.calTarget === 'profile') {
    s.profileDate = date;
    updateProfileDate(date);
    renderProfileData();
  } else if (s.calTarget === 'roster') {
    s.rosterDate = date;
    renderRoster();
  } else {
    s.feedDate = date;
    renderLeadFeed();
  }
  closeCal();
}

// Expose for HTML onclick
window.openCal       = openCal;
window.closeCal      = closeCal;
window.calShiftMonth = calShiftMonth;
window.calPick       = calPick;
