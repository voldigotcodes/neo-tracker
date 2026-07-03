// ── REP STATS ─────────────────────────────────────────────────────
import { db }              from '../supabase.js';
import { s }               from './state.js';
import { $, pct, todayKey, shiftDateStr, updateDatePill, fetchSalesByDate } from './utils.js';
import { DAY_SHORT, D0_TGT, CR_TGT } from './constants.js';
import { buildFeedHTML }   from './feed.js';

export async function renderRepStats() {
  $('stats-context').textContent = s.session.name;
  const today = await fetchSalesByDate(s.statsDate, s.activeMallId);
  const mine  = today.filter(r => r.rep_id === s.session.id);
  const dow   = new Date(s.statsDate + 'T12:00:00').getDay();
  const tgt   = s.targets[dow] || 10;
  updateDatePill('stats-date', s.statsDate);
  $('stats-next').disabled = s.statsDate >= todayKey();

  const tot = mine.length;
  const d0s = mine.filter(r => r.activated).length;
  const crs = mine.filter(r => r.type === 'credit').length;
  const d0r = pct(d0s, tot), crr = pct(crs, tot);

  $('sk-tot').textContent = tot; $('sk-tgt').textContent = tgt;
  $('sk-d0').textContent  = d0r + '%'; $('sk-cr').textContent = crr + '%';

  function colorKpi(id, val, g, w) {
    $(id).className = 'kpi ' + (tot === 0 ? '' : val >= g ? 'good' : val >= w ? 'warn' : 'bad');
  }
  colorKpi('skpi-tot', tot, tgt, Math.round(tgt * .6));
  colorKpi('skpi-d0',  d0r, D0_TGT, 50);
  colorKpi('skpi-cr',  crr, CR_TGT, 35);

  // Week chart (this rep only)
  const now    = new Date();
  const monOff = now.getDay() === 0 ? 6 : now.getDay() - 1;
  const mon    = new Date(now); mon.setDate(now.getDate() - monOff);
  const monKey = mon.toISOString().slice(0, 10);
  const { data: weekData } = await db.from('sales')
    .select('sale_date').eq('mall_id', s.activeMallId).eq('rep_id', s.session.id).gte('sale_date', monKey);
  const wd = DAY_SHORT.map((d, i) => {
    const dt  = new Date(mon); dt.setDate(mon.getDate() + i);
    const k   = dt.toISOString().slice(0, 10);
    const cnt = (weekData || []).filter(r => r.sale_date === k).length;
    return { d, cnt, cur: k === s.statsDate, fut: dt > now };
  });
  const mx = Math.max(...wd.map(x => x.cnt), 1);
  $('stats-week').innerHTML = wd.map(x => `
    <div class="wb-wrap${x.cur ? ' cur' : ''}">
      <div class="wb-num">${x.cnt || ''}</div>
      <div class="wb ${x.cur ? 'today' : ''}" style="height:${x.fut ? 4 : Math.max(4, Math.round(x.cnt / mx * 58))}px;opacity:${x.fut ? .18 : 1}"></div>
      <div class="wb-day">${x.d}</div>
    </div>`).join('');

  $('stats-feed').innerHTML = buildFeedHTML(mine, true, true);

  // Shift banner + CPH/ACPH
  const { data: shiftRow } = await db.from('shifts')
    .select('hours').eq('rep_id', s.session.id).eq('shift_date', s.statsDate).maybeSingle();
  const shiftHrs = shiftRow?.hours ? parseFloat(shiftRow.hours) : null;
  if (shiftHrs) {
    $('shift-banner').style.display       = 'block';
    $('shift-banner-text').textContent    = `Today's shift · ${shiftHrs}h (set by lead)`;
    $('cph-stat-row').style.display       = '';
    const myCph  = (tot / shiftHrs).toFixed(1);
    const myAcph = (d0s / shiftHrs).toFixed(1);
    $('sk-cph').textContent  = myCph;
    $('sk-acph').textContent = myAcph;
    $('kpi-sk-cph').className  = 'kpi ' + (parseFloat(myCph)  >= s.cphTarget  ? 'good' : parseFloat(myCph)  >= s.cphTarget  * .75 ? 'warn' : 'bad');
    $('kpi-sk-acph').className = 'kpi ' + (parseFloat(myAcph) >= s.acphTarget ? 'good' : parseFloat(myAcph) >= s.acphTarget * .75 ? 'warn' : 'bad');
  } else {
    $('shift-banner').style.display = 'none';
    $('cph-stat-row').style.display = 'none';
  }
}

window.shiftStatsDate = function(n) {
  const next = shiftDateStr(s.statsDate, n);
  if (next > todayKey()) return;
  s.statsDate = next;
  renderRepStats();
};
