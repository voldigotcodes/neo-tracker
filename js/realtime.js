// ── REALTIME + PUSH NOTIFICATIONS ────────────────────────────────
import { db }             from '../supabase.js';
import { s }              from './state.js';
import { $ }              from './utils.js';
import { MALL_ID, VAPID_PUBLIC } from './constants.js';
import { renderDash }     from './dashboard.js';
import { renderRepFeed, renderLeadFeed } from './feed.js';
import { renderRepStats } from './stats.js';
import { renderContacts } from './contacts.js';

export function subscribeRealtime() {
  if (s.realtimeCh) db.removeChannel(s.realtimeCh);
  s.realtimeCh = db.channel('neo-live')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'sales', filter: `mall_id=eq.${MALL_ID}` },
      () => {
        if (s.session.role === 'lead') {
          if ($('lview-dash')?.classList.contains('active')) renderDash();
          if ($('lview-feed')?.classList.contains('active')) renderLeadFeed();
        } else {
          if ($('view-feed')?.classList.contains('active'))  renderRepFeed();
          if ($('view-stats')?.classList.contains('active')) renderRepStats();
        }
      })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'contacts', filter: `rep_id=eq.${s.session.id}` },
      () => {
        if ($('view-contacts')?.classList.contains('active')) renderContacts();
      })
    .subscribe();
}

export async function requestPushPermission() {
  if (!('Notification' in window) || !('serviceWorker' in navigator)) return;
  if (Notification.permission === 'denied') return;
  if (Notification.permission !== 'granted') {
    const p = await Notification.requestPermission();
    if (p !== 'granted') return;
  }
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC),
    });
    const j = sub.toJSON();
    await db.from('push_subscriptions').upsert({
      rep_id:   s.session.id,
      endpoint: j.endpoint,
      p256dh:   j.keys.p256dh,
      auth:     j.keys.auth,
    }, { onConflict: 'rep_id,endpoint' });
  } catch (e) { console.warn('Push subscription failed:', e); }
}

function urlBase64ToUint8Array(b) {
  const p = '='.repeat((4 - b.length % 4) % 4);
  const s = (b + p).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from([...atob(s)].map(c => c.charCodeAt(0)));
}
