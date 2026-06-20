// ── REP MODAL + FULL-PAGE PROFILE ────────────────────────────────
import { db }              from '../supabase.js';
import { s }               from './state.js';
import { $, pct, todayKey, fmtDateStr, updateDatePill } from './utils.js';
import { MALL_ID, DAY_SHORT, D0_TGT, CR_TGT } from './constants.js';

// ── Shared data fetcher ───────────────────────────────────────────
async function fetchPeriodData(repId, refDate, period) {
  const ref   = new Date(refDate + 'T12:00:00');
  const today = todayKey();
  let sales = [], chartBars = [], chartLbl = '';
  let fromDate = refDate, toDate = refDate;

  if (period === 'day') {
    const { data } = await db.from('sales').select('*')
      .eq('mall_id', MALL_ID).eq('rep_id', repId).eq('sale_date', refDate);
    sales    = data || [];
    chartLbl = fmtDateStr(refDate);
    const hm = {}, nowH = new Date().getHours();
    sales.forEach(r => { const h = parseInt(r.sale_time?.slice(0,2) || '9'); hm[h] = (hm[h] || 0) + 1; });
    chartBars = [9,10,11,12,13,14,15,16,17,18,19].map(h => ({ l: h+'h', n: hm[h]||0, cur: h===nowH && refDate===today }));

  } else if (period === 'week') {
    const dow    = ref.getDay();
    const monOff = dow === 0 ? 6 : dow - 1;
    const mon    = new Date(ref); mon.setDate(ref.getDate() - monOff);
    const sun    = new Date(mon); sun.setDate(mon.getDate() + 6);
    fromDate = mon.toISOString().slice(0, 10);
    toDate   = sun.toISOString().slice(0, 10);
    const { data } = await db.from('sales').select('*')
      .eq('mall_id', MALL_ID).eq('rep_id', repId)
      .gte('sale_date', fromDate).lte('sale_date', toDate);
    sales    = data || [];
    chartLbl = 'This week';
    const dm = {};
    sales.forEach(r => { dm[r.sale_date] = (dm[r.sale_date] || 0) + 1; });
    chartBars = DAY_SHORT.map((d, i) => {
      const dt = new Date(mon); dt.setDate(mon.getDate() + i);
      const k  = dt.toISOString().slice(0, 10);
      return { l: d, n: dm[k] || 0, cur: k === refDate };
    });

  } else {
    const y = ref.getFullYear(), m = ref.getMonth();
    fromDate = new Date(y, m, 1).toISOString().slice(0, 10);
    toDate   = new Date(y, m + 1, 0).toISOString().slice(0, 10);
    const { data } = await db.from('sales').select('*')
      .eq('mall_id', MALL_ID).eq('rep_id', repId)
      .gte('sale_date', fromDate).lte('sale_date', toDate);
    sales    = data || [];
    chartLbl = ref.toLocaleDateString('en-CA', { month:'long', year:'numeric' });
    const weeks = [{l:'W1',n:0,cur:false},{l:'W2',n:0,cur:false},{l:'W3',n:0,cur:false},{l:'W4',n:0,cur:false}];
    sales.forEach(r => { const wi = Math.min(Math.floor((parseInt(r.sale_date.slice(8)) - 1) / 7), 3); weeks[wi].n++; });
    weeks[Math.min(Math.floor((parseInt(refDate.slice(8)) - 1) / 7), 3)].cur = true;
    chartBars = weeks;
  }

  // Fetch shift hours for the period and sum them
  const { data: shiftRows } = await db.from('shifts')
    .select('hours').eq('rep_id', repId)
    .gte('shift_date', fromDate).lte('shift_date', toDate);
  const totalHours = (shiftRows || []).reduce((acc, r) => acc + parseFloat(r.hours), 0);

  return { sales, chartBars, chartLbl, totalHours };
}

function renderKpisAndChart(sales, chartBars, chartLbl, kpiEl, chartLblEl, chartEl, breakdownEl, totalHours) {
  const n    = sales.length;
  const d0s  = sales.filter(r => r.activated).length;
  const d0r  = pct(d0s, n);
  const crr  = pct(sales.filter(r => r.type === 'credit').length, n);
  const col  = (v, g, w) => n === 0 ? '' : v >= g ? 'var(--green)' : v >= w ? 'var(--amber)' : 'var(--red)';

  const cph  = totalHours > 0 ? (n   / totalHours).toFixed(1) : null;
  const acph = totalHours > 0 ? (d0s / totalHours).toFixed(1) : null;
  const cphCol  = cph  ? (parseFloat(cph)  >= s.cphTarget  ? 'var(--green)' : parseFloat(cph)  >= s.cphTarget  * .75 ? 'var(--amber)' : 'var(--red)') : '';
  const acphCol = acph ? (parseFloat(acph) >= s.acphTarget ? 'var(--green)' : parseFloat(acph) >= s.acphTarget * .75 ? 'var(--amber)' : 'var(--red)') : '';

  $(kpiEl).innerHTML = `
    <div class="modal-kpi"><div class="modal-kpi-val">${n}</div><div class="modal-kpi-lbl">Sales</div></div>
    <div class="modal-kpi"><div class="modal-kpi-val" style="color:${col(d0r,D0_TGT,50)}">${d0r}%</div><div class="modal-kpi-lbl">D0 rate</div></div>
    <div class="modal-kpi"><div class="modal-kpi-val" style="color:${col(crr,CR_TGT,35)}">${crr}%</div><div class="modal-kpi-lbl">Credit mix</div></div>
    ${totalHours > 0 ? `<div class="modal-kpi"><div class="modal-kpi-val">${totalHours % 1 === 0 ? totalHours : totalHours.toFixed(1)}</div><div class="modal-kpi-lbl">Hours</div></div>` : ''}
    ${cph  ? `<div class="modal-kpi"><div class="modal-kpi-val" style="color:${cphCol}">${cph}</div><div class="modal-kpi-lbl">CPH</div></div>`  : ''}
    ${acph ? `<div class="modal-kpi"><div class="modal-kpi-val" style="color:${acphCol}">${acph}</div><div class="modal-kpi-lbl">ACPH</div></div>` : ''}
  `;

  $(chartLblEl).textContent = chartLbl;
  const mx = Math.max(...chartBars.map(b => b.n), 1);
  $(chartEl).innerHTML = chartBars.map(b => `
    <div class="wb-wrap${b.cur ? ' cur' : ''}">
      <div class="wb-num">${b.n || ''}</div>
      <div class="wb${b.cur ? ' today' : ''}" style="height:${Math.max(3, Math.round(b.n / mx * 58))}px"></div>
      <div class="wb-day">${b.l}</div>
    </div>`).join('');

  const lc = {}, lt = {};
  sales.forEach(r => (r.labels || []).forEach(l => { lc[l] = (lc[l] || 0) + 1; lt[l] = r.type; }));
  const sorted = Object.entries(lc).sort((a, b) => b[1] - a[1]);
  const maxC   = sorted[0]?.[1] || 1;
  $(breakdownEl).innerHTML = `
    <div class="card-title" style="margin-bottom:10px">Product breakdown</div>
    ${sorted.length ? sorted.map(([l, c]) => `
      <div class="modal-bd-row">
        <div class="modal-bd-name">${l}</div>
        <div class="modal-bd-track"><div class="modal-bd-fill modal-bd-${lt[l]==='credit'?'blue':'green'}" style="width:${Math.round(c/maxC*100)}%"></div></div>
        <div class="modal-bd-count">${c}</div>
      </div>`).join('') : '<div class="empty" style="padding:16px 0;text-align:left">No sales in this period.</div>'}
  `;
}

// ── REP MODAL ────────────────────────────────────────────────────
window.openRepModal = async function(repName, date, repId) {
  s.modalRepName = repName;
  s.modalRepId   = repId;
  s.modalRefDate = date;
  const ini = repName.split(' ').map(x => x[0]).join('').slice(0, 2).toUpperCase();
  $('modal-av').textContent       = ini;
  $('modal-rep-name').textContent = repName;
  $('modal-rep-sub').textContent  = 'CF Promenade St-Bruno';
  document.querySelectorAll('.modal-period-btn').forEach((b, i) => b.classList.toggle('active', i === 1));
  $('rep-modal-overlay').style.display = 'block';
  $('rep-modal').style.display         = 'flex';
  await loadModalPeriod('week');
};

window.loadModalPeriod = async function(period, btn) {
  if (btn) {
    document.querySelectorAll('.modal-period-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  }
  const { sales, chartBars, chartLbl, totalHours } = await fetchPeriodData(s.modalRepId, s.modalRefDate, period);
  renderKpisAndChart(sales, chartBars, chartLbl, 'modal-kpis', 'modal-chart-lbl', 'modal-chart', 'modal-breakdown', totalHours);
};

window.closeRepModal = function() {
  $('rep-modal-overlay').style.display = 'none';
  $('rep-modal').style.display         = 'none';
};

// ── FULL-PAGE PROFILE ─────────────────────────────────────────────
window.openRepProfile = function(repName, repId, fromView) {
  s.profileRepName  = repName;
  s.profileRepId    = repId;
  s.profilePrevView = fromView || 'dash';
  s.profileDate     = s.dashDate || todayKey();
  const ini = repName.split(' ').map(x => x[0]).join('').slice(0, 2).toUpperCase();
  $('profile-av').textContent   = ini;
  $('profile-name').textContent = repName;
  updateDatePill('profile-date', s.profileDate);
  document.querySelectorAll('.profile-period').forEach((b, i) => b.classList.toggle('active', i === 1));
  s.profilePeriod = 'week';
  ['lview-dash','lview-feed','lview-manage','view-log','view-contacts','lview-rep-profile']
    .forEach(id => $(id).classList.remove('active'));
  $('lview-rep-profile').classList.add('active');
  document.querySelectorAll('#lead-nav .nav-btn').forEach(b => b.classList.remove('active'));
  renderProfileData();
};

window.closeRepProfile = function() {
  $('lview-rep-profile').classList.remove('active');
  window.goLead(s.profilePrevView);
};

window.expandRepProfile = function() {
  window.closeRepModal();
  window.openRepProfile(s.modalRepName, s.modalRepId, 'dash');
};

window.setProfilePeriod = function(period, btn) {
  document.querySelectorAll('.profile-period').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  s.profilePeriod = period;
  renderProfileData();
};

// Exported so calendar.js can call it after a date pick
export async function renderProfileData() {
  const { sales, chartBars, chartLbl, totalHours } = await fetchPeriodData(s.profileRepId, s.profileDate, s.profilePeriod);
  renderKpisAndChart(sales, chartBars, chartLbl, 'profile-kpis', 'profile-chart-lbl', 'profile-chart', 'profile-breakdown', totalHours);
}

// Called by calendar.js after a date pick on the profile view
export function updateProfileDate(date) {
  s.profileDate = date;
  updateDatePill('profile-date', date);
}
