// ── LOG FORM · PRODUCT TREE · CART · SUBMIT ───────────────────────
import { db }            from '../supabase.js';
import { s }             from './state.js';
import { $, toast, todayKey, haptic } from './utils.js';
import { queueSale }     from './offline.js';

// ── Cart helpers ─────────────────────────────────────────────────
export function hasCredit()  { return s.cart.some(i => i.t === 'credit'); }
export function hasSecured() { return s.cart.some(i => i.s); }
export function hasDebit()   { return s.cart.some(i => i.t === 'debit'); }

// ── Product tree toggles ──────────────────────────────────────────
window.toggleCat = function(cat) {
  const b = $('body-' + cat), ch = $('chev-' + cat), sep = $('sep-' + cat);
  const o = b.classList.toggle('open');
  ch.style.transform = o ? 'rotate(180deg)' : '';
  sep.style.display  = o ? 'block' : 'none';
};
window.toggleTier = function(t) {
  const o = $('topts-' + t), ch = $('tchev-' + t);
  const open = o.classList.toggle('open');
  ch.style.transform = open ? 'rotate(180deg)' : '';
};

// ── Cart ─────────────────────────────────────────────────────────
window.addCart = function(el) {
  const p = el.dataset.p;
  const t = el.dataset.t;
  // Tap selected item → deselect
  if (s.cart.find(i => i.p === p)) {
    s.cart = s.cart.filter(i => i.p !== p);
    el.classList.remove('in');
    syncCart();
    return;
  }
  // Credit: only one at a time — swap out existing
  if (t === 'credit') {
    s.cart.filter(i => i.t === 'credit').forEach(i => {
      const e = $('pill-' + i.p); if (e) e.classList.remove('in');
    });
    s.cart = s.cart.filter(i => i.t !== 'credit');
  }
  s.cart.push({ p, t, s: el.dataset.s === 'true', l: el.dataset.l });
  el.classList.add('in');
  syncCart();
};

window.rmCart = function(p) {
  s.cart = s.cart.filter(i => i.p !== p);
  const el = $('pill-' + p); if (el) el.classList.remove('in');
  syncCart();
};

export function syncCart() {
  $('cart-row').innerHTML = s.cart.map(i =>
    `<div class="chip-cart ${i.t}">${i.l}<button class="chip-rm" onclick="rmCart('${i.p}')">✕</button></div>`
  ).join('');
  const cc = s.cart.filter(i => i.t === 'credit').length;
  const dc = s.cart.filter(i => i.t === 'debit').length;
  $('cart-credit-count').textContent = cc ? cc + ' selected' : '';
  $('cart-debit-count').textContent  = dc ? 'Added' : '';

  const needAct = hasCredit() || s.cart.some(i => i.p === 'Money');
  const needDep = hasSecured() || hasDebit();

  $('q-act').style.display = needAct ? 'block' : 'none';
  if (!needAct) { s.form.act = false; $('tog-act').classList.remove('on'); }

  $('q-dep').style.display = needDep ? 'block' : 'none';
  if (!needDep) {
    s.form.dep = false; s.form.depAmt = null;
    $('tog-dep').classList.remove('on');
    $('dep-amt').style.display = 'none';
    resetDepBtns();
    $('tog-dep').style.opacity = '';
    $('tog-dep').style.pointerEvents = '';
  }
  if (needDep) {
    const secOnly = hasSecured() && !hasDebit();
    $('dep-title').textContent = secOnly ? 'Security deposit made?' : 'Money deposited?';
    $('dep-sub').textContent   = secOnly ? 'Customer put down their security deposit' : 'Customer added funds to their account';
    if (hasSecured()) {
      // Secured card → deposit is mandatory
      s.form.dep = true;
      $('tog-dep').classList.add('on');
      $('dep-amt').style.display = 'block';
      $('tog-dep').style.opacity = '0.5';
      $('tog-dep').style.pointerEvents = 'none';
    } else {
      $('tog-dep').style.opacity = '';
      $('tog-dep').style.pointerEvents = '';
    }
  }
}

window.togField = function(f) {
  s.form[f] = !s.form[f];
  $('tog-' + f).classList.toggle('on', s.form[f]);
  if (f === 'dep') {
    $('dep-amt').style.display = s.form.dep ? 'block' : 'none';
    if (!s.form.dep) { s.form.depAmt = null; resetDepBtns(); }
  }
};
window.pickDep = function(el) {
  resetDepBtns(); el.classList.add('on'); s.form.depAmt = el.dataset.v;
  $('dep-custom').value = '';
};
function resetDepBtns() {
  document.querySelectorAll('.dep-btn').forEach(b => b.classList.remove('on'));
}

// ── Submit ────────────────────────────────────────────────────────
window.submitSale = async function() {
  let repId, repName;
  if (s.session.role === 'rep') {
    repId   = s.session.id;
    repName = s.session.name;
  } else {
    repId   = $('rep-select').value;
    repName = $('rep-select').options[$('rep-select').selectedIndex]?.text;
    if (!repId) { toast('Select a rep first'); return; }
  }
  if (!s.cart.length) { toast('Select at least one product'); return; }
  if (hasSecured() && !s.form.depAmt) { toast('Enter the security deposit amount'); return; }

  const saleMsg = buildActivationMessage(s.cart, s.form); // build while in gesture context
  const btn = document.querySelector('#view-log .btn-primary');
  btn.disabled = true; btn.textContent = 'Logging…';

  const sale = {
    mall_id:   s.activeMallId, rep_id: repId, rep_name: repName,
    sale_date: todayKey(), sale_time: new Date().toTimeString().slice(0, 8),
    products:  s.cart.map(i => i.p), labels: s.cart.map(i => i.l),
    type:      hasCredit() ? 'credit' : 'debit',
    activated: s.form.act, deposited: s.form.dep,
    deposit:   s.form.depAmt ? parseFloat(s.form.depAmt) : null,
    notes:     $('notes').value.trim() || null,
  };

  if (s.editingId) {
    const { error } = await db.from('sales').update({
      products:  sale.products, labels:    sale.labels,
      type:      sale.type,     activated: sale.activated,
      deposited: sale.deposited, deposit:  sale.deposit,
      notes:     sale.notes,
    }).eq('id', s.editingId);
    if (error) { haptic('error'); toast('Error updating. Try again.'); btn.disabled = false; btn.textContent = 'Update sale'; return; }
    haptic('success');
    toast('✓ Sale updated');
    resetForm();
    btn.disabled = false; btn.textContent = 'Log sale';
    if (s.session.role === 'rep') window.goRep('feed');
    else window.goLead('feed');
  } else {
    const { error } = await db.from('sales').insert(sale);
    if (error) {
      if (!navigator.onLine) {
        await queueSale(sale);
        haptic('success');
        toast('No connection — sale queued ⏳');
      } else {
        haptic('error');
        toast('Error saving. Try again.');
        btn.disabled = false; btn.textContent = 'Log sale';
        return;
      }
    } else {
      haptic('success');
      toast('✓ Logged · message copied 📋');
    }
    resetForm();
    btn.disabled = false; btn.textContent = 'Log sale';
    setTimeout(() => navigator.clipboard.writeText(saleMsg).catch(() => {}), 50);
  }
};

export function buildActivationMessage(cartItems, f) {
  const labelMap = {
    'World Unsecured':       'W',
    'World Secured':         'SecW',
    'World Elite Unsecured': 'WE',
    'World Elite Secured':   'SecWE',
  };
  const stdMap = {
    'Standard Unsecured': 'Std Credit',
    'Standard Secured':   'Sec Card',
  };
  const moneyLabels = ['Neo Money','Neo Savings'];

  const labels     = cartItems.map(i => i.l);
  const weLabel    = labels.map(l => labelMap[l]).filter(Boolean).join(' + ');
  const stdLabel   = labels.map(l => stdMap[l]).filter(Boolean).join(' + ');
  const moneyLabel = labels.filter(l => moneyLabels.includes(l)).join(' + ');
  const deposit    = f.dep && f.depAmt ? `$${f.depAmt}` : f.dep ? 'Yes' : 'N/A';

  return [
    `Activation: mall`,
    `Location: ${s.activeMallName || 'Neo Kiosk'}`,
    `Was this a new Cx: Yes`,
    `WE/W or SecWE/SecW: ${weLabel}`,
    `Std Credit or Sec Card: ${stdLabel}`,
    `Everyday Account: ${moneyLabel || 'No'}`,
    `How much Deposit: ${deposit}`,
    `Product: ${labels.length}`,
    `Activated Y/N: ${f.act ? 'Y' : 'N'}`,
  ].join('\n');
}

export function resetForm() {
  s.editingId = null;
  s.cart = []; s.form = { act: false, dep: false, depAmt: null };
  const logBtn = document.querySelector('#view-log .btn-primary');
  if (logBtn) logBtn.textContent = 'Log sale';
  $('notes').value = '';
  $('cart-row').innerHTML = '';
  $('view-log').querySelectorAll('.in').forEach(e => e.classList.remove('in'));
  ['q-act','q-dep'].forEach(id => $(id).style.display = 'none');
  $('tog-act').classList.remove('on'); $('tog-dep').classList.remove('on');
  $('tog-dep').style.opacity = ''; $('tog-dep').style.pointerEvents = '';
  $('dep-amt').style.display = 'none'; resetDepBtns(); $('dep-custom').value = '';
  $('cart-credit-count').textContent = ''; $('cart-debit-count').textContent = '';
  ['credit','debit'].forEach(c => {
    $('body-' + c).classList.remove('open');
    $('chev-' + c).style.transform = '';
    $('sep-' + c).style.display = 'none';
  });
  ['std','world','elite'].forEach(t => {
    $('topts-' + t).classList.remove('open');
    $('tchev-' + t).style.transform = '';
  });
}
