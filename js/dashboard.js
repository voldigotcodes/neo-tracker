// ── DASHBOARD ─────────────────────────────────────────────────────
import { db }              from '../supabase.js';
import { s }               from './state.js';
import { $, pct, todayKey, shiftDateStr, fmtDateStr } from './utils.js';
import { DAY_SHORT, D0_TGT, CR_TGT } from './constants.js';

// ── Helpers ───────────────────────────────────────────────────────
function weekRange(dateStr) {
  const ref    = new Date(dateStr + 'T12:00:00');
  const monOff = ref.getDay() === 0 ? 6 : ref.getDay() - 1;
  const mon    = new Date(ref); mon.setDate(ref.getDate() - monOff);
  const sun    = new Date(mon); sun.setDate(mon.getDate() + 6);
  return {
    mon,
    monKey: mon.toISOString().slice(0, 10),
    sunKey: sun.toISOString().slice(0, 10),
  };
}

function isDashAtLatest() {
  const today = todayKey();
  if (s.dashPeriod === 'day')   return s.dashDate >= today;
  if (s.dashPeriod === 'week')  return weekRange(s.dashDate).sunKey >= today;
  return s.dashDate.slice(0, 7) >= today.slice(0, 7);
}

function dashDateLabel() {
  if (s.dashPeriod === 'day') return fmtDateStr(s.dashDate);
  if (s.dashPeriod === 'week') {
    const { mon, sunKey } = weekRange(s.dashDate);
    const sun = new Date(sunKey + 'T12:00:00');
    const fmt = d => d.toLocaleDateString('fr-CA', { month: 'short', day: 'numeric' });
    return `${fmt(mon)} – ${fmt(sun)}`;
  }
  return new Date(s.dashDate + 'T12:00:00').toLocaleDateString('fr-CA', { month: 'long', year: 'numeric' });
}

// ── Period switcher ───────────────────────────────────────────────
window.setDashPeriod = function(period, btn) {
  document.querySelectorAll('.dash-period').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  s.dashPeriod = period;
  localStorage.setItem('neo_dash_period', period);
  renderDash();
};

// ── Date navigation ───────────────────────────────────────────────
window.shiftDashPeriod = function(n) {
  const today = todayKey();
  let next;
  if (s.dashPeriod === 'day') {
    next = shiftDateStr(s.dashDate, n);
    if (next > today) return;
  } else if (s.dashPeriod === 'week') {
    next = shiftDateStr(s.dashDate, n * 7);
    if (next > today) return;
  } else {
    const [y, m] = s.dashDate.split('-').map(Number);
    const d = new Date(y, m - 1 + n, 1);
    next = d.toISOString().slice(0, 10);
    if (next > today) return;
  }
  s.dashDate = next;
  renderDash();
};

// ── Main render ───────────────────────────────────────────────────
export async function renderDash() {
  const today = todayKey();

  // Sync period buttons (handles restore from localStorage on boot)
  document.querySelectorAll('.dash-period').forEach(b =>
    b.classList.toggle('active', b.dataset.period === s.dashPeriod)
  );

  // ── Compute date range + target ────────────────────────────────
  let fromDate, toDate, tgt;

  if (s.dashPeriod === 'day') {
    fromDate = toDate = s.dashDate;
    const dow = new Date(s.dashDate + 'T12:00:00').getDay();
    tgt = s.targets[dow] || 10;

  } else if (s.dashPeriod === 'week') {
    const { mon, monKey, sunKey } = weekRange(s.dashDate);
    fromDate = monKey; toDate = sunKey;
    tgt = 0;
    for (let i = 0; i < 7; i++) {
      const dt = new Date(mon); dt.setDate(mon.getDate() + i);
      const k  = dt.toISOString().slice(0, 10);
      if (k <= today) tgt += s.targets[dt.getDay()] || 10;
    }

  } else { // month
    const ref = new Date(s.dashDate + 'T12:00:00');
    const y = ref.getFullYear(), m = ref.getMonth();
    fromDate = new Date(y, m, 1).toISOString().slice(0, 10);
    toDate   = new Date(y, m + 1, 0).toISOString().slice(0, 10);
    tgt = 0;
    const lastDay = new Date(y, m + 1, 0).getDate();
    for (let d = 1; d <= lastDay; d++) {
      const k = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      if (k <= today) tgt += s.targets[new Date(k + 'T12:00:00').getDay()] || 10;
    }
  }

  // ── Skeleton while fetching ────────────────────────────────────
  ['k-tot','k-tgt','k-d0','k-cr'].forEach(id => { const el = $(id); if (el) el.classList.add('skeleton'); });
  $('rep-bd').innerHTML = '<div class="skeleton" style="height:56px;border-radius:12px;margin:4px 0"></div>'.repeat(3);

  // ── Fetch all data in parallel ─────────────────────────────────
  const salesQ  = db.from('sales')
    .select('sale_date,rep_id,rep_name,activated,type,created_at')
    .eq('mall_id', s.activeMallId).gte('sale_date', fromDate).lte('sale_date', toDate).order('created_at');
  const shiftsQ = db.from('shifts')
    .select('rep_id,hours').eq('mall_id', s.activeMallId)
    .gte('shift_date', fromDate).lte('shift_date', toDate);

  // Day mode: fetch week chart data in the same round-trip
  let wkQ = null;
  if (s.dashPeriod === 'day') {
    const { mon } = weekRange(s.dashDate);
    const monKey  = mon.toISOString().slice(0, 10);
    wkQ = db.from('sales').select('sale_date').eq('mall_id', s.activeMallId).gte('sale_date', monKey);
  }

  const [{ data: salesData }, { data: shiftRows }, wkResult] = await Promise.all([
    salesQ, shiftsQ, wkQ || Promise.resolve({ data: null }),
  ]);

  const salesAll = salesData || [];

  // Clear skeletons
  ['k-tot','k-tgt','k-d0','k-cr'].forEach(id => { const el = $(id); if (el) el.classList.remove('skeleton'); });

  const tot = salesAll.length;
  const d0s = salesAll.filter(r => r.activated).length;
  const crs = salesAll.filter(r => r.type === 'credit').length;
  const d0r = pct(d0s, tot), crr = pct(crs, tot);

  // ── Date pill + nav ────────────────────────────────────────────
  $('dash-date').textContent = dashDateLabel();
  $('dash-next').disabled    = isDashAtLatest();

  // ── KPIs ───────────────────────────────────────────────────────
  const tgtLabel = s.dashPeriod === 'day' ? 'Day target'
    : s.dashPeriod === 'week' ? 'Week target' : 'Month target';
  $('k-tot').textContent     = tot;
  $('k-tgt').textContent     = tgt;
  $('k-tgt-lbl').textContent = tgtLabel;
  $('k-d0').textContent      = d0r + '%';
  $('k-cr').textContent      = crr + '%';
  // ── CPH / ACPH (shifts for full period) ───────────────────────
  const shiftRepMap = {};
  (shiftRows || []).forEach(r => {
    shiftRepMap[r.rep_id] = (shiftRepMap[r.rep_id] || 0) + parseFloat(r.hours);
  });
  const totalHours = Object.values(shiftRepMap).reduce((a, b) => a + b, 0);

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

  // ── Color KPIs ─────────────────────────────────────────────────
  function colorKpi(id, val, g, w) {
    $(id).className = 'kpi ' + (tot === 0 ? '' : val >= g ? 'good' : val >= w ? 'warn' : 'bad');
  }
  colorKpi('kpi-tot', tot, tgt, Math.round(tgt * .6));
  colorKpi('kpi-d0',  d0r, D0_TGT, 50);
  colorKpi('kpi-cr',  crr, CR_TGT, 35);

  // ── Progress bars ──────────────────────────────────────────────
  function bar(pfId, pvId, val, max, fmt) {
    const w = Math.min(100, Math.round(val / max * 100));
    $(pfId).style.width      = w + '%';
    $(pfId).style.background = w >= 100 ? 'var(--green)' : w >= 60 ? 'var(--amber)' : 'var(--red)';
    $(pvId).textContent      = fmt === 's' ? val + '/' + max : val + '%';
    $(pvId).style.color      = w >= 100 ? 'var(--green)' : w >= 60 ? 'var(--amber)' : 'var(--text2)';
  }
  bar('pf-s', 'pv-s', tot, tgt,  's');
  bar('pf-d', 'pv-d', d0r, 100,  'p');
  bar('pf-c', 'pv-c', crr, 100,  'p');

  // ── Chart ──────────────────────────────────────────────────────
  let chartBars, chartTitle;

  if (s.dashPeriod === 'month') {
    // W1–W4 bars for the month
    chartTitle = new Date(s.dashDate + 'T12:00:00').toLocaleDateString('fr-CA', { month: 'long', year: 'numeric' });
    const weeks = [{ l:'W1',n:0,cur:false },{ l:'W2',n:0,cur:false },{ l:'W3',n:0,cur:false },{ l:'W4',n:0,cur:false }];
    salesAll.forEach(r => {
      const wi = Math.min(Math.floor((parseInt(r.sale_date.slice(8)) - 1) / 7), 3);
      weeks[wi].n++;
    });
    weeks[Math.min(Math.floor((parseInt(s.dashDate.slice(8)) - 1) / 7), 3)].cur = true;
    chartBars = weeks;

  } else {
    // 7-day bars for the week containing dashDate
    const { mon } = weekRange(s.dashDate);
    let dm = {};

    if (s.dashPeriod === 'week') {
      // salesAll already covers the full week
      chartTitle = dashDateLabel();
      salesAll.forEach(r => { dm[r.sale_date] = (dm[r.sale_date] || 0) + 1; });
    } else {
      // day mode: use wkResult fetched in parallel above
      chartTitle = 'This week';
      (wkResult?.data || []).forEach(r => { dm[r.sale_date] = (dm[r.sale_date] || 0) + 1; });
    }

    const now = new Date();
    chartBars = DAY_SHORT.map((d, i) => {
      const dt = new Date(mon); dt.setDate(mon.getDate() + i);
      const k  = dt.toISOString().slice(0, 10);
      return { l: d, n: dm[k] || 0, cur: k === s.dashDate, fut: dt > now };
    });
  }

  $('dash-chart-title').textContent = chartTitle;
  const mx = Math.max(...chartBars.map(b => b.n), 1);
  $('week').innerHTML = chartBars.map(b => `
    <div class="wb-wrap${b.cur ? ' cur' : ''}">
      <div class="wb-num">${b.n || ''}</div>
      <div class="wb${b.cur ? ' today' : ''}" style="height:${b.fut ? 4 : Math.max(4, Math.round(b.n / mx * 58))}px;opacity:${b.fut ? .18 : 1}"></div>
      <div class="wb-day">${b.l}</div>
    </div>`).join('');

  // ── Rep breakdown ──────────────────────────────────────────────
  const rm = {};
  salesAll.forEach(r => {
    if (!rm[r.rep_name]) rm[r.rep_name] = { n:0, d:0, c:0, repId: r.rep_id };
    rm[r.rep_name].n++;
    if (r.activated)         rm[r.rep_name].d++;
    if (r.type === 'credit') rm[r.rep_name].c++;
  });
  const reps = Object.entries(rm).sort((a, b) => b[1].n - a[1].n);
  const emptyMsg = s.dashPeriod === 'day'   ? 'No sales logged today yet.'
    : s.dashPeriod === 'week'  ? 'No sales logged this week yet.'
    : 'No sales logged this month yet.';
  $('rep-bd').innerHTML = !reps.length
    ? `<div class="empty">${emptyMsg}</div>`
    : reps.map(([name, r]) => {
        const dr  = pct(r.d, r.n), cr = pct(r.c, r.n);
        const ini = name.split(' ').map(x => x[0]).join('').slice(0, 2).toUpperCase();
        const sn  = name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        const hrs = shiftRepMap[r.repId];
        return `<div class="rep-row rep-row-clickable" onclick="openRepModal('${sn}','${s.dashDate}','${r.repId}')">
          <div class="rep-av">${ini}</div>
          <div class="rep-nm">${name.split(' ')[0]}</div>
          <div class="chips">
            <div class="ck cnt">${r.n} cx</div>
            <div class="ck ${dr >= D0_TGT ? 'g' : 'r'}">${dr}% D0</div>
            <div class="ck b">${cr}% cr</div>
            ${hrs ? `<div class="ck ${(r.n / hrs) >= s.cphTarget ? 'g' : (r.n / hrs) >= s.cphTarget * .75 ? 'o' : 'r'}">${(r.n / hrs).toFixed(1)} CPH</div><div class="ck ${(r.d / hrs) >= s.acphTarget ? 'g' : (r.d / hrs) >= s.acphTarget * .75 ? 'o' : 'r'}">${(r.d / hrs).toFixed(1)} ACPH</div>` : ''}
          </div>
          <svg class="rep-chev" viewBox="0 0 14 14"><polyline points="4,2 10,7 4,12"/></svg>
        </div>`;
      }).join('');
}
