// ── UTILITIES ─────────────────────────────────────────────────────
import { db } from '../supabase.js';

export const $ = id => document.getElementById(id);

export function todayKey() {
  const d = new Date();
  const pad = n => String(n).padStart(2,'0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}

export function fmtDate(d) {
  return d.toLocaleDateString('fr-CA', { weekday:'short', month:'short', day:'numeric' });
}
export function fmtDateStr(s) { return fmtDate(new Date(s + 'T12:00:00')); }

export function shiftDateStr(s, n) {
  const d = new Date(s + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0,10);
}

// Returns YYYY-MM-DD in local timezone (for follow_up_at comparisons)
export function localDateStr(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  const pad = n => String(n).padStart(2,'0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}

export function pct(a, b) { return b ? Math.round(a / b * 100) : 0; }

export function getLabels(s) {
  if (Array.isArray(s.labels)   && s.labels.length)   return s.labels;
  if (Array.isArray(s.products) && s.products.length)  return s.products;
  if (s.label)   return [s.label];
  if (s.product) return [s.product];
  return ['Unknown'];
}

export function toast(msg, dur = 2600) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), dur);
}

export function initDates() {
  const d = fmtDate(new Date());
  ['log-date','feed-date','stats-date','manage-date','cx-date']
    .forEach(id => { const e = $(id); if (e) e.textContent = d; });
}

export function updateDatePill(elId, date) {
  const el = $(elId);
  if (el) el.textContent = fmtDateStr(date);
}

export async function fetchSalesByDate(date, mallId) {
  const { data } = await db.from('sales')
    .select('*').eq('mall_id', mallId).eq('sale_date', date).order('created_at');
  return data || [];
}

// ── HAPTIC FEEDBACK ───────────────────────────────────────────────
// type: 'tap' | 'success' | 'error' | 'heavy'
export function haptic(type = 'tap') {
  if (!navigator.vibrate) return;
  const patterns = { tap: 8, success: 80, error: [50, 40, 80], heavy: 150 };
  navigator.vibrate(patterns[type] ?? 8);
}

// ── VIEW TRANSITIONS ──────────────────────────────────────────────
// dir: 'fade' | 'forward' | 'back' | 'up' | 'down'
export function withTransition(dir, fn) {
  if (!document.startViewTransition) { fn(); return; }
  document.documentElement.dataset.vt = dir || 'fade';
  const t = document.startViewTransition(fn);
  t.finished.finally(() => delete document.documentElement.dataset.vt);
}
