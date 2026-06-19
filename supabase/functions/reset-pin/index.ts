// ─── reset-pin · Supabase Edge Function ─────────────────────────────
// Called by the lead client after resetting a rep's PIN in the reps table.
// Updates the rep's Supabase Auth password so the new PIN works on next login.
// Requires the caller to be authenticated and have role='lead' in the reps table.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return new Response('Unauthorized', { status: 401, headers: corsHeaders });

  const adminClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // Verify the caller's JWT
  const callerClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: { user }, error: authErr } = await callerClient.auth.getUser();
  if (authErr || !user) return new Response('Unauthorized', { status: 401, headers: corsHeaders });

  // Confirm caller is a lead in the reps table
  const { data: caller } = await adminClient
    .from('reps').select('role').eq('auth_uid', user.id).single();
  if (caller?.role !== 'lead') return new Response('Forbidden', { status: 403, headers: corsHeaders });

  const { rep_id, pin_hash } = await req.json();
  if (!rep_id || !pin_hash) return new Response('Bad request', { status: 400, headers: corsHeaders });

  // Get the target rep's Supabase Auth UID
  const { data: rep } = await adminClient
    .from('reps').select('auth_uid').eq('id', rep_id).single();

  if (rep?.auth_uid) {
    // Rep has logged in before — update their Auth password immediately
    const { error: updateErr } = await adminClient.auth.admin.updateUserById(
      rep.auth_uid, { password: pin_hash },
    );
    if (updateErr) console.error('Auth password update failed:', updateErr.message);
  }
  // If auth_uid is null, the rep hasn't logged in yet. Their first login will
  // pick up the new pin_hash from reps table and create their Auth account then.

  return new Response(JSON.stringify({ ok: true }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
