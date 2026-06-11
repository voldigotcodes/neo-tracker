// ─── SUPABASE CONFIG ───────────────────────────────────────────────
// Replace these two values after you create your Supabase project
// Dashboard → Settings → API
export const SUPABASE_URL  = 'https://baxvhzguoshbnmlnsnbu.supabase.co';
export const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJheHZoemd1b3NoYm5tbG5zbmJ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEwNjYzMDMsImV4cCI6MjA5NjY0MjMwM30.kHRmryYUExl2e8C-V4gfuVYQ4MYRq5jjR2SIbn7MjoY';

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
export const db = createClient(SUPABASE_URL, SUPABASE_ANON);
