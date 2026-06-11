// ─── notify-lead · Supabase Edge Function ──────────────────────────
// Triggered by a database webhook on INSERT to the sales table.
// Sends a web push notification to every lead rep at that mall.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import webpush from 'npm:web-push';

const VAPID_PUBLIC =
  'BBLQYXyQnw90R7XFsRnjCfmMFJfQK5EUxZw_u8JjznPUvfZgoTDMQkhLZR6Jrfn2aDkbY75T-tQtJQxLNIwMvjw';

webpush.setVapidDetails(
  'mailto:voldimonzambe@milende-collective.com',
  VAPID_PUBLIC,
  Deno.env.get('VAPID_PRIVATE_KEY')!,
);

Deno.serve(async (req) => {
  const { record } = await req.json(); // new row from the sales table

  const db = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // Find all active leads for this mall
  const { data: leads } = await db
    .from('reps')
    .select('id')
    .eq('mall_id', record.mall_id)
    .eq('role', 'lead')
    .eq('active', true);

  if (!leads?.length) return new Response('no leads', { status: 200 });

  // Get their push subscriptions
  const { data: subs } = await db
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth')
    .in('rep_id', leads.map((l: { id: string }) => l.id));

  if (!subs?.length) return new Response('no subs', { status: 200 });

  // Build the notification payload
  const products = record.labels?.join(' + ') || record.type || 'sale';
  const time = new Date().toLocaleTimeString('en-CA', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Toronto',
  });

  const payload = JSON.stringify({
    title: `${record.rep_name} logged a sale`,
    body: `${products} · ${time}`,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: 'neo-sale',
  });

  // Send to all subscriptions, ignore individual failures
  await Promise.allSettled(
    subs.map((s: { endpoint: string; p256dh: string; auth: string }) =>
      webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        payload,
      )
    ),
  );

  return new Response('ok', { status: 200 });
});
