// ── FEED ──────────────────────────────────────────────────────────
import { db }              from '../supabase.js';
import { s }               from './state.js';
import { $, toast, todayKey, fmtDateStr, getLabels, fetchSalesByDate } from './utils.js';
import { MALL_ID }         from './constants.js';
import { hasCredit, hasDebit, hasSecured, syncCart, resetForm } from './log.js';

export function buildFeedHTML(sales, canDelete = false, allowEdit = false) {
  if (!sales.length) return '<div class="empty">No sales yet.<br>Be the first. 💪</div>';
  return sales.slice().reverse().map(sale => {
    s.salesCache[sale.id] = sale;
    const lbls   = getLabels(sale).join(' + ');
    const dep    = sale.deposit ? ' $' + sale.deposit : '';
    const badges = [];
    if (sale.activated) badges.push('<span class="fb act">Activated ✓</span>');
    if (sale.deposited) badges.push(`<span class="fb dep">Deposited${dep} ✓</span>`);
    const time      = sale.sale_time ? sale.sale_time.slice(0, 5) : '';
    const daysDiff  = Math.round(
      (new Date(todayKey() + 'T12:00:00') - new Date(sale.sale_date + 'T12:00:00')) / 86400000
    );
    const withinWindow = s.session.role === 'lead' ? daysDiff <= 2 : daysDiff === 0;
    const isOwn        = sale.rep_id === s.session.id;
    const canAct       = withinWindow && (s.session.role === 'lead' || isOwn);
    const canEdit      = allowEdit  && canAct;
    const canDel       = canDelete  && canAct;
    const editBtn      = canEdit ? `<button class="feed-edit" onclick="openEditSale('${sale.id}')">✎</button>` : '';
    const delBtn       = canDel  ? `<button class="feed-del"  onclick="deleteSale('${sale.id}')">✕</button>`  : '';
    const actions      = (editBtn || delBtn) ? `<div class="feed-actions">${editBtn}${delBtn}</div>` : '';
    return `<div class="feed-item">
      <div class="f-line ${sale.type}"></div>
      <div class="f-body">
        <div class="f-prod">${lbls}</div>
        ${badges.length ? '<div class="f-badges">' + badges.join('') + '</div>' : ''}
        <div class="f-meta">${sale.rep_name || ''}${sale.notes ? ' · ' + sale.notes : ''}</div>
        <div class="f-time">${time}</div>
      </div>
      ${actions}
    </div>`;
  }).join('');
}

export async function renderRepFeed() {
  const sales = await fetchSalesByDate(todayKey());
  $('feed').innerHTML = buildFeedHTML(sales, true, true);
}

export async function renderLeadFeed() {
  const sales = await fetchSalesByDate(todayKey());
  $('lfeed').innerHTML = buildFeedHTML(sales, true, true);
}

window.deleteSale = async function(id) {
  if (!confirm('Remove this sale?')) return;
  const { error } = await db.from('sales').delete().eq('id', id);
  if (error) { toast('Could not delete — check RLS policy'); return; }
  toast('Sale removed');
  // Refresh both views
  const { renderDash } = await import('./dashboard.js');
  renderDash();
  renderLeadFeed();
};

window.openEditSale = function(id) {
  const sale = s.salesCache[id];
  if (!sale) return;

  resetForm();
  s.editingId = id;

  // Rebuild cart from saved products
  (sale.products || []).forEach((p, i) => {
    const el = $('pill-' + p);
    if (!el) return;
    s.cart.push({ p, t: el.dataset.t, s: el.dataset.s === 'true', l: sale.labels?.[i] || el.dataset.l });
    el.classList.add('in');
  });
  syncCart();

  // Restore activation
  if (sale.activated && (hasCredit() || s.cart.some(i => i.p === 'Money'))) {
    s.form.act = true;
    $('tog-act').classList.add('on');
  }

  // Restore deposit
  if (sale.deposited && (hasSecured() || hasDebit())) {
    s.form.dep = true;
    $('tog-dep').classList.add('on');
    $('dep-amt').style.display = 'block';
    if (sale.deposit) {
      s.form.depAmt = String(sale.deposit);
      const presetBtn = document.querySelector(`.dep-btn[data-v="${parseInt(sale.deposit)}"]`);
      if (presetBtn) presetBtn.classList.add('on');
      else $('dep-custom').value = sale.deposit;
    }
  }

  $('notes').value = sale.notes || '';

  // Navigate to log view
  if (s.session.role === 'rep') window.goRep('log');
  else window.goLead('log');

  // Override header for edit context
  $('log-context').textContent = sale.rep_name + ' · Edit sale';
  if (s.session.role === 'lead') {
    $('log-rep-selector').style.display = 'none';
    $('log-rep-name').style.display     = 'block';
    $('rep-name-static').textContent    = sale.rep_name;
  }

  const btn = document.querySelector('#view-log .btn-primary');
  if (btn) btn.textContent = 'Update sale';
};

// Date nav (lead feed is today-only, no nav — kept here for potential future use)
window.shiftFeedDate = function(n) {
  const { shiftDateStr, todayKey: today } = { shiftDateStr: (d, n) => {
    const dt = new Date(d + 'T12:00:00'); dt.setDate(dt.getDate() + n);
    return dt.toISOString().slice(0,10);
  }, todayKey: () => s.feedDate };
  // currently unused — lead feed shows today only
};
