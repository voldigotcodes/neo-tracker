// ── DASHBOARD ─────────────────────────────────────────────────────
import { db }              from '../supabase.js';
import { s }               from './state.js';
import { $, pct, todayKey, shiftDateStr, updateDatePill, fetchSalesByDate } from './utils.js';
import { MALL_ID, DAY_SHORT, D0_TGT, CR_TGT } from './constants.js';

export async function renderDash() {
  const today = await fetchSalesByDate(s.dashDate);
  const dow   = new Date(s.dashDate + 'T12:00:00').getDay();
  const tgt   = s.targets[dow] || 10;
  const tot   = today.length;
  const d0s   = today.filter(t => t.activated).length;
  const crs   = today.filter(t => t.type === 'credit').length;
  const d0r   = pct(d0s, tot), crr = pct(crs, tot);

  updateDatePill('dash-date', s.dashDate);
  $('dash-next').disabled = s.dashDate >= todayKey();

  $('k-tot').textContent = tot; $('k-tgt').textContent = tgt;
  $('k-d0').textContent  = d0r + '%'; $('k-cr').textContent = crr + '%';

  // CPH / ACPH
  const { data: shiftRows } = await db.from('shifts')
    .select('rep_id, hours').eq('mall_id', MALL_ID).eq('shift_date', s.dashDate);
  const shiftMap   = {};
  (shiftRows || []).forEach(r => { shiftMap[r.rep_id] = parseFloat(r.hours); });
  const totalHours = Object.values(shiftMap).reduce((a, b) => a + b, 0);
  if (totalHours > 0) {
    const mc = (tot / totalHours).toFixed(1);
    const ma = (d0s / totalHours).toFixed(1);
    $('cph-kpi-row').style.display = '';
    $('k-cph').textContent  = mc;
    $('k-acph').textContent = ma;
    $('kpi-cph').className  = 'kpi ' + (parseFloat(mc) >= s.cphTarget  ? 'good' : parseFloat(mc)  >= s.cphTarget  * .75 ? 'warn' : 'bad');
    $('kpi-acph').className = 'kpi ' + (parseFloat(ma) >= s.acphTarget ? 'good' : parseFloat(ma) >= s.acphTarget * .75 ? 'warn' : 'bad');
  } else {
    $('cph-kpi-row').style.display = 'none';
  }

  function colorKpi(id, val, g, w) {
    $(id).className = 'kpi ' + (tot === 0 ? '' : val >= g ? 'good' : val >= w ? 'warn' : 'bad');
  }
  colorKpi('kpi-tot', tot, tgt, Math.round(tgt * .6));
  colorKpi('kpi-d0',  d0r, D0_TGT, 50);
  colorKpi('kpi-cr',  crr, CR_TGT, 35);

  function bar(pfId, pvId, val, max, fmt) {
    const w = Math.min(100, Math.round(val / max * 100));
    $(pfId).style.width      = w + '%';
    $(pfId).style.background = w >= 100 ? 'var(--green)' : w >= 60 ? 'var(--amber)' : 'var(--red)';
    $(pvId).textContent      = fmt === 's' ? val + '/' + max : val + '%';
    $(pvId).style.color      = w >= 100 ? 'var(--green)' : w >= 60 ? 'var(--amber)' : 'var(--text2)';
  }
  bar('pf-s','pv-s', tot, tgt,  's');
  bar('pf-d','pv-d', d0r, 100,  'p');
  bar('pf-c','pv-c', crr, 100,  'p');

  // Week chart
  const vd     = new Date(s.dashDate + 'T12:00:00');
  const monOff = vd.getDay() === 0 ? 6 : vd.getDay() - 1;
  const mon    = new Date(vd); mon.setDate(vd.getDate() - monOff);
  const monKey = mon.toISOString().slice(0, 10);
  const { data: weekData } = await db.from('sales')
    .select('sale_date').eq('mall_id', MALL_ID).gte('sale_date', monKey);
  const now = new Date();
  const wd  = DAY_SHORT.map((d, i) => {
    const dt  = new Date(mon); dt.setDate(mon.getDate() + i);
    const k   = dt.toISOString().slice(0, 10);
    const cnt = (weekData || []).filter(r => r.sale_date === k).length;
    return { d, cnt, cur: k === s.dashDate, fut: dt > now };
  });
  const mx = Math.max(...wd.map(x => x.cnt), 1);
  $('week').innerHTML = wd.map(x => `
    <div class="wb-wrap${x.cur ? ' cur' : ''}">
      <div class="wb-num">${x.cnt || ''}</div>
      <div class="wb ${x.cur ? 'today' : ''}" style="height:${x.fut ? 4 : Math.max(4, Math.round(x.cnt / mx * 58))}px;opacity:${x.fut ? .18 : 1}"></div>
      <div class="wb-day">${x.d}</div>
    </div>`).join('');

  // Rep breakdown
  const rm = {};
  today.forEach(r => {
    if (!rm[r.rep_name]) rm[r.rep_name] = { n:0, d:0, c:0, repId: r.rep_id };
    rm[r.rep_name].n++;
    if (r.activated)       rm[r.rep_name].d++;
    if (r.type === 'credit') rm[r.rep_name].c++;
  });
  const reps = Object.entries(rm).sort((a, b) => b[1].n - a[1].n);
  $('rep-bd').innerHTML = !reps.length
    ? '<div class="empty">No sales logged today yet.</div>'
    : reps.map(([name, r]) => {
        const dr = pct(r.d, r.n), cr = pct(r.c, r.n);
        const ini = name.split(' ').map(x => x[0]).join('').slice(0, 2).toUpperCase();
        const safeName = name.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
        return `<div class="rep-row rep-row-clickable" onclick="openRepModal('${safeName}','${s.dashDate}','${r.repId}')">
          <div class="rep-av">${ini}</div>
          <div class="rep-nm">${name.split(' ')[0]}</div>
          <div class="chips">
            <div class="ck cnt">${r.n} cx</div>
            <div class="ck ${dr >= D0_TGT ? 'g' : 'r'}">${dr}% D0</div>
            <div class="ck b">${cr}% cr</div>
            ${shiftMap[r.repId] ? `<div class="ck ${(r.n / shiftMap[r.repId]) >= s.cphTarget ? 'g' : (r.n / shiftMap[r.repId]) >= s.cphTarget * .75 ? 'o' : 'r'}">${(r.n / shiftMap[r.repId]).toFixed(1)} CPH</div><div class="ck ${(r.d / shiftMap[r.repId]) >= s.acphTarget ? 'g' : (r.d / shiftMap[r.repId]) >= s.acphTarget * .75 ? 'o' : 'r'}">${(r.d / shiftMap[r.repId]).toFixed(1)} ACPH</div>` : ''}
          </div>
          <svg class="rep-chev" viewBox="0 0 14 14"><polyline points="4,2 10,7 4,12"/></svg>
        </div>`;
      }).join('');
}

window.shiftDashDate = function(n) {
  const next = shiftDateStr(s.dashDate, n);
  if (next > todayKey()) return;
  s.dashDate = next;
  renderDash();
};
