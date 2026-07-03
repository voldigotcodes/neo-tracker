// ── DISTRICT OVERVIEW (Manager/Admin) ────────────────────────────
import { db }              from '../supabase.js';
import { s }               from './state.js';
import { $, pct, todayKey, shiftDateStr, fmtDateStr, withTransition } from './utils.js';
import { D0_TGT, CR_TGT }  from './constants.js';
import { openCal }         from './calendar.js';

// ── Module-level state for rep search sheet ───────────────────────
let _allRepRows  = [];
let _buildRepRow = null;
let _repShiftMap = {};
let _mallById    = {};

// ── Period helpers (mirroring dashboard.js) ───────────────────────
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

function districtDateLabel() {
  const today = todayKey();
  if (s.districtPeriod === 'day') {
    if (s.districtDate === today) return 'Today';
    return fmtDateStr(s.districtDate);
  }
  if (s.districtPeriod === 'week') {
    const { mon, sunKey } = weekRange(s.districtDate);
    const sun = new Date(sunKey + 'T12:00:00');
    const fmt = d => d.toLocaleDateString('fr-CA', { month: 'short', day: 'numeric' });
    return `${fmt(mon)} – ${fmt(sun)}`;
  }
  return new Date(s.districtDate + 'T12:00:00')
    .toLocaleDateString('fr-CA', { month: 'long', year: 'numeric' });
}

function isDistrictAtLatest() {
  const today = todayKey();
  if (s.districtPeriod === 'day')   return s.districtDate >= today;
  if (s.districtPeriod === 'week')  return weekRange(s.districtDate).sunKey >= today;
  return s.districtDate.slice(0, 7) >= today.slice(0, 7);
}

function computeDateRange() {
  const today = todayKey();
  if (s.districtPeriod === 'day') {
    return { fromDate: s.districtDate, toDate: s.districtDate };
  }
  if (s.districtPeriod === 'week') {
    const { monKey, sunKey } = weekRange(s.districtDate);
    return { fromDate: monKey, toDate: sunKey };
  }
  // month
  const ref = new Date(s.districtDate + 'T12:00:00');
  const y = ref.getFullYear(), m = ref.getMonth();
  return {
    fromDate: new Date(y, m, 1).toISOString().slice(0, 10),
    toDate:   new Date(y, m + 1, 0).toISOString().slice(0, 10),
  };
}

function computeTarget(mallTargets) {
  const targets = typeof mallTargets === 'string' ? JSON.parse(mallTargets) : (mallTargets || {});
  const today   = todayKey();
  if (s.districtPeriod === 'day') {
    const dow = new Date(s.districtDate + 'T12:00:00').getDay();
    return targets[dow] || 10;
  }
  if (s.districtPeriod === 'week') {
    const { mon } = weekRange(s.districtDate);
    let tgt = 0;
    for (let i = 0; i < 7; i++) {
      const dt = new Date(mon); dt.setDate(mon.getDate() + i);
      const k  = dt.toISOString().slice(0, 10);
      if (k <= today) tgt += targets[dt.getDay()] || 10;
    }
    return tgt;
  }
  // month
  const ref = new Date(s.districtDate + 'T12:00:00');
  const y = ref.getFullYear(), m = ref.getMonth();
  const lastDay = new Date(y, m + 1, 0).getDate();
  let tgt = 0;
  for (let d = 1; d <= lastDay; d++) {
    const k = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    if (k <= today) tgt += targets[new Date(k + 'T12:00:00').getDay()] || 10;
  }
  return tgt;
}

// ── Period switcher ───────────────────────────────────────────────
window.setDistrictPeriod = function(period, btn) {
  document.querySelectorAll('.district-period').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  s.districtPeriod = period;
  localStorage.setItem('neo_district_period', period);
  renderDistrict();
};

// ── Date navigation ───────────────────────────────────────────────
window.shiftDistrictPeriod = function(n) {
  const today = todayKey();
  let next;
  if (s.districtPeriod === 'day') {
    next = shiftDateStr(s.districtDate, n);
    if (next > today) return;
  } else if (s.districtPeriod === 'week') {
    next = shiftDateStr(s.districtDate, n * 7);
    if (next > today) return;
  } else {
    const [y, m] = s.districtDate.split('-').map(Number);
    const d = new Date(y, m - 1 + n, 1);
    next = d.toISOString().slice(0, 10);
    if (next > today) return;
  }
  s.districtDate = next;
  renderDistrict();
};

// ── Drill-in to a specific mall ───────────────────────────────────
window.drillIntoMall = async function(mallId, mallName) {
  // Set active mall
  s.activeMallId   = mallId;
  s.activeMallName = mallName;

  // Load mall targets into state
  const mall = s.districtMalls.find(m => m.id === mallId);
  if (mall?.targets) s.targets    = typeof mall.targets === 'string' ? JSON.parse(mall.targets) : mall.targets;
  if (mall?.cph_target)  s.cphTarget  = parseFloat(mall.cph_target);
  if (mall?.acph_target) s.acphTarget = parseFloat(mall.acph_target);

  // Sync dashboard date with district date
  s.dashDate    = s.districtDate;
  s.dashPeriod  = s.districtPeriod;

  // Re-subscribe realtime for this mall
  const { subscribeRealtime } = await import('./realtime.js');
  subscribeRealtime();
  const { renderDash } = await import('./dashboard.js');

  withTransition('forward', () => {
    // Switch UI to lead-app in manager drill-in mode
    $('manager-app').style.display       = 'none';
    $('lead-app').style.display          = 'block';
    $('lead-nav').style.display          = 'none';
    $('dash-drillback').style.display    = '';
    $('dash-drillback-name').textContent = mallName;

    // Sync period buttons on the lead dashboard
    document.querySelectorAll('.dash-period').forEach(b =>
      b.classList.toggle('active', b.dataset.period === s.dashPeriod)
    );

    // Show dashboard, hide others
    ['lview-dash','lview-feed','lview-manage','lview-roster','lview-rep-profile']
      .forEach(id => $(id)?.classList.remove('active'));
    $('lview-dash')?.classList.add('active');
  });

  await renderDash();
};

// ── Back to district overview ─────────────────────────────────────
window.backToDistrict = function() {
  // Clear mall scope
  s.activeMallId   = '';
  s.activeMallName = '';

  withTransition('back', () => {
    $('lead-app').style.display          = 'none';
    $('lead-nav').style.display          = '';
    $('dash-drillback').style.display    = 'none';
    $('manager-app').style.display       = 'block';
  });

  goManager('district');
};

// ── Switch district (admin only) ──────────────────────────────────
window.switchDistrict = async function(districtId) {
  s.activeDistrictId = districtId;

  if (districtId === 'all') {
    s.activeDistrictName = 'All Districts';
    const { data: malls } = await db.from('malls')
      .select('id, name, district_id, targets, cph_target, acph_target').order('name');
    s.districtMalls = malls || [];
  } else {
    const dist = s.districts.find(d => d.id === districtId);
    s.activeDistrictName = dist?.name || districtId;
    const { data: malls } = await db.from('malls')
      .select('id, name, district_id, targets, cph_target, acph_target')
      .eq('district_id', districtId).order('name');
    s.districtMalls = malls || [];
  }

  $('district-ctx').textContent = s.activeDistrictName;

  // Refresh whichever manager view is currently active
  const onManage = $('lview-manage-mgr')?.classList.contains('active');
  if (onManage) {
    const { renderManageManager } = await import('./manage.js');
    renderManageManager();
  } else {
    renderDistrict();
  }
};

// ── Main render ───────────────────────────────────────────────────
export async function renderDistrict() {
  // Sync period buttons
  document.querySelectorAll('.district-period').forEach(b =>
    b.classList.toggle('active', b.dataset.period === s.districtPeriod)
  );

  $('district-date').textContent = districtDateLabel();
  $('district-next').disabled    = isDistrictAtLatest();

  const { fromDate, toDate } = computeDateRange();
  const mallIds = s.districtMalls.map(m => m.id);

  if (!mallIds.length) {
    $('district-agg').innerHTML  = '<div class="empty">No malls in this district.</div>';
    $('district-malls').innerHTML = '';
    $('district-leaderboard').innerHTML = '';
    return;
  }

  // ── Fetch all sales + shifts in period ────────────────────────
  const [{ data: salesAll }, { data: shiftAll }] = await Promise.all([
    db.from('sales').select('mall_id, rep_id, rep_name, activated, type')
      .in('mall_id', mallIds).gte('sale_date', fromDate).lte('sale_date', toDate),
    db.from('shifts').select('mall_id, rep_id, hours')
      .in('mall_id', mallIds).gte('shift_date', fromDate).lte('shift_date', toDate),
  ]);

  const sales  = salesAll  || [];
  const shifts = shiftAll  || [];

  // ── Aggregate KPIs ────────────────────────────────────────────
  const tot = sales.length;
  const d0s = sales.filter(r => r.activated).length;
  const crs = sales.filter(r => r.type === 'credit').length;
  const d0r = pct(d0s, tot), crr = pct(crs, tot);

  // Total target = sum of all mall targets
  const totalTgt = s.districtMalls.reduce((sum, m) => sum + computeTarget(m.targets), 0);

  const totalHours = shifts.reduce((s2, r) => s2 + parseFloat(r.hours || 0), 0);
  const cph  = totalHours > 0 ? (tot / totalHours).toFixed(1) : '—';
  const acph = totalHours > 0 ? (d0s / totalHours).toFixed(1) : '—';

  function kpiColor(val, tgt) {
    if (tot === 0) return '';
    return val >= tgt ? 'good' : val >= tgt * 0.6 ? 'warn' : 'bad';
  }

  const tgtLbl = s.districtPeriod === 'day' ? 'Day target'
    : s.districtPeriod === 'week' ? 'Week target' : 'Month target';

  $('district-agg').innerHTML = `
    <div class="kpi-grid" style="grid-template-columns:repeat(3,1fr)">
      <div class="kpi ${kpiColor(tot, totalTgt)}" id="dkpi-tot">
        <div class="k-val">${tot}</div>
        <div class="k-lbl">Sales</div>
      </div>
      <div class="kpi">
        <div class="k-val">${totalTgt}</div>
        <div class="k-lbl">${tgtLbl}</div>
      </div>
      <div class="kpi ${kpiColor(d0r, D0_TGT)}">
        <div class="k-val">${d0r}%</div>
        <div class="k-lbl">D0 rate</div>
      </div>
      <div class="kpi ${kpiColor(crr, CR_TGT)}">
        <div class="k-val">${crr}%</div>
        <div class="k-lbl">Credit rate</div>
      </div>
      ${totalHours > 0 ? `
      <div class="kpi ${parseFloat(cph) >= 2 ? 'good' : 'warn'}">
        <div class="k-val">${cph}</div>
        <div class="k-lbl">CPH</div>
      </div>
      <div class="kpi ${parseFloat(acph) >= 1.5 ? 'good' : 'warn'}">
        <div class="k-val">${acph}</div>
        <div class="k-lbl">ACPH</div>
      </div>` : ''}
    </div>`;

  // ── Mall cards ────────────────────────────────────────────────
  const salesByMall  = {};
  const shiftsByMall = {};
  sales.forEach(r  => { salesByMall[r.mall_id]  = salesByMall[r.mall_id]  || []; salesByMall[r.mall_id].push(r); });
  shifts.forEach(r => { shiftsByMall[r.mall_id] = (shiftsByMall[r.mall_id] || 0) + parseFloat(r.hours || 0); });

  $('district-malls').innerHTML = s.districtMalls.map(m => {
    const ms     = salesByMall[m.id]  || [];
    const mHours = shiftsByMall[m.id] || 0;
    const mn     = ms.length;
    const md0s   = ms.filter(r => r.activated).length;
    const mcrs   = ms.filter(r => r.type === 'credit').length;
    const md0r   = pct(md0s, mn), mcrr = pct(mcrs, mn);
    const mtgt   = computeTarget(m.targets);
    const mcph   = mHours > 0 ? (mn / mHours).toFixed(1) : null;
    const macph  = mHours > 0 ? (md0s / mHours).toFixed(1) : null;
    const pct100 = Math.min(100, Math.round(mn / Math.max(mtgt, 1) * 100));
    const barCol = pct100 >= 100 ? 'var(--green)' : pct100 >= 60 ? 'var(--amber)' : 'var(--red)';
    const sn     = m.name.replace(/'/g, "\\'");

    return `<div class="mall-card" onclick="drillIntoMall('${m.id}','${sn}')">
      <div class="mall-card-header">
        <div class="mall-card-name">${m.name}</div>
        <div class="mall-card-count">${mn} / ${mtgt}</div>
        <svg class="rep-chev" viewBox="0 0 14 14"><polyline points="4,2 10,7 4,12"/></svg>
      </div>
      <div class="progress-track" style="margin:6px 0 8px">
        <div class="progress-fill" style="width:${pct100}%;background:${barCol}"></div>
      </div>
      <div class="chips">
        <div class="ck ${md0r >= D0_TGT ? 'g' : 'r'}">${md0r}% D0</div>
        <div class="ck b">${mcrr}% cr</div>
        ${mcph  ? `<div class="ck ${parseFloat(mcph)  >= 2   ? 'g' : 'o'}">${mcph} CPH</div>`  : ''}
        ${macph ? `<div class="ck ${parseFloat(macph) >= 1.5 ? 'g' : 'o'}">${macph} ACPH</div>` : ''}
      </div>
    </div>`;
  }).join('');

  // ── Rep leaderboard ───────────────────────────────────────────
  const repMap = {};
  sales.forEach(r => {
    if (!repMap[r.rep_id]) repMap[r.rep_id] = { name: r.rep_name, mallId: r.mall_id, n: 0, d0: 0, cr: 0 };
    repMap[r.rep_id].n++;
    if (r.activated)         repMap[r.rep_id].d0++;
    if (r.type === 'credit') repMap[r.rep_id].cr++;
  });
  const repShiftMap = {};
  shifts.forEach(r => { repShiftMap[r.rep_id] = (repShiftMap[r.rep_id] || 0) + parseFloat(r.hours || 0); });

  const repList = Object.entries(repMap).sort((a, b) => b[1].n - a[1].n);
  const mallById = Object.fromEntries(s.districtMalls.map(m => [m.id, m.name]));

  const LEADERBOARD_DEFAULT = 5;

  // Store full list on module state so the sheet can access it
  _allRepRows = repList;
  _repShiftMap = repShiftMap;
  _mallById = mallById;

  function buildRepRow([repId, r]) {
    const dr  = pct(r.d0, r.n), cr = pct(r.cr, r.n);
    const ini = r.name.split(' ').map(x => x[0]).join('').slice(0, 2).toUpperCase();
    const hrs = repShiftMap[repId];
    const sn  = r.name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const mallTag = mallById[r.mallId] ? `<div class="leaderboard-mall-tag">${mallById[r.mallId]}</div>` : '';
    return `<div class="rep-row rep-row-clickable" onclick="closeRepSheet();openRepProfile('${sn}','${repId}','district','${r.mallId}')">
      <div class="rep-av">${ini}</div>
      <div class="rep-nm">${r.name.split(' ')[0]}</div>
      <div class="chips" style="flex:1">
        <div class="ck cnt">${r.n} cx</div>
        <div class="ck ${dr >= D0_TGT ? 'g' : 'r'}">${dr}% D0</div>
        <div class="ck b">${cr}% cr</div>
        ${hrs ? `<div class="ck ${(r.n / hrs) >= 2 ? 'g' : 'o'}">${(r.n / hrs).toFixed(1)} CPH</div>` : ''}
        ${mallTag}
      </div>
      <svg class="rep-chev" viewBox="0 0 14 14"><polyline points="4,2 10,7 4,12"/></svg>
    </div>`;
  }

  // Store builder for the sheet to reuse
  _buildRepRow = buildRepRow;

  if (!repList.length) {
    $('district-leaderboard').innerHTML = '<div class="empty" style="padding:16px">No sales in this period.</div>';
  } else {
    const top     = repList.slice(0, LEADERBOARD_DEFAULT);
    const hasMore = repList.length > LEADERBOARD_DEFAULT;
    $('district-leaderboard').innerHTML =
      top.map(buildRepRow).join('') +
      (hasMore ? `
        <button class="see-all-btn" onclick="openRepSheet()">
          See all ${repList.length} reps ›
        </button>` : '');
  }
}

// ── District picker (admin) ───────────────────────────────────────
window.openDistrictPicker = function() {
  if (s.session.role !== 'admin') return;
  const list = $('district-picker-list');
  if (!list) return;
  const options = [{ id: 'all', name: 'All Districts' }, ...s.districts];
  const check   = '<svg viewBox="0 0 14 14" style="width:16px;height:16px;stroke:var(--blue);stroke-width:2.5;fill:none;flex-shrink:0"><polyline points="2,7 6,11 12,3"/></svg>';
  list.innerHTML = options.map(d => `
    <div class="district-picker-option${d.id === s.activeDistrictId ? ' active' : ''}"
         onclick="switchDistrict('${d.id}');closeDistrictPicker()">
      <div class="district-picker-name">${d.name}</div>
      ${d.id === s.activeDistrictId ? check : ''}
    </div>`).join('');
  $('district-picker-overlay').style.display = 'block';
  $('district-picker-sheet').style.display   = 'flex';
};

window.closeDistrictPicker = function() {
  $('district-picker-overlay').style.display = 'none';
  $('district-picker-sheet').style.display   = 'none';
};

// ── Rep search sheet ──────────────────────────────────────────────
window.openRepSheet = function() {
  if (!_buildRepRow || !_allRepRows.length) return;
  const title = $('rep-sheet-title');
  if (title) title.textContent = `All Reps (${_allRepRows.length})`;
  const search = $('rep-sheet-search');
  if (search) search.value = '';
  _renderRepSheetList('');
  $('rep-search-overlay').style.display = 'block';
  $('rep-search-sheet').style.display   = 'flex';
  requestAnimationFrame(() => search?.focus());
};

window.closeRepSheet = function() {
  $('rep-search-overlay').style.display = 'none';
  $('rep-search-sheet').style.display   = 'none';
};

window.filterRepSheet = function(q) {
  _renderRepSheetList(q.toLowerCase().trim());
};

function _renderRepSheetList(q) {
  const list = $('rep-sheet-list');
  if (!list) return;
  const filtered = q
    ? _allRepRows.filter(([repId, r]) => r.name.toLowerCase().includes(q) || (_mallById[r.mallId] || '').toLowerCase().includes(q))
    : _allRepRows;
  if (!filtered.length) {
    list.innerHTML = `<div class="empty list-search-empty">No reps match "${q}"</div>`;
  } else {
    list.innerHTML = filtered.map(_buildRepRow).join('');
  }
}

// Expose for HTML onclick and calPick
window.renderDistrict = renderDistrict;
window.openDistrictCal = () => openCal('district');
