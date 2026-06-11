# Neo Tracker · Setup Guide

Follow these steps in order. Should take ~30 minutes total.

---

## Step 1 — Install tools

1. **VS Code** → https://code.visualstudio.com
2. **Node.js (LTS)** → https://nodejs.org

---

## Step 2 — Open the project in VS Code

1. Unzip the `neo-tracker` folder
2. Open VS Code → File → Open Folder → select `neo-tracker`

---

## Step 3 — Create your Supabase project

1. Go to https://supabase.com → New project
2. Name it `neo-tracker`, pick any password, choose **Canada (Central)** region
3. Wait ~2 min for it to spin up
4. Go to **SQL Editor** → **New query**
5. Paste the entire contents of `schema.sql` and click **Run**
6. Go to **Table Editor → malls** → copy the `id` value of "Carrefour Laval"

---

## Step 4 — Configure the app

Open `supabase.js` and replace:
- `YOUR_SUPABASE_URL` → from Supabase Dashboard → Settings → API → Project URL
- `YOUR_SUPABASE_ANON_KEY` → from same page → anon/public key

Open `app.js` and replace:
- `YOUR_MALL_ID` → the UUID you copied from the malls table

---

## Step 5 — Generate VAPID keys (push notifications)

In VS Code, open a Terminal (Terminal → New Terminal) and run:

```bash
npx web-push generate-vapid-keys
```

Copy the **Public Key** and paste it into `app.js` replacing `YOUR_VAPID_PUBLIC_KEY`

Copy both keys somewhere safe — you'll also need the **Private Key** for the Supabase Edge Function later.

---

## Step 6 — Create your first account (Mall Lead)

1. Go to Supabase → SQL Editor → New query
2. Run this (replace the values):

```sql
insert into reps (mall_id, email, name, role, pin_hash, active)
values (
  'YOUR_MALL_ID',
  'voldi@example.com',
  'Voldi Monzambe',
  'lead',
  encode(digest('YOUR_PIN_HERE', 'sha256'), 'hex'),
  true
);
```

Replace `YOUR_MALL_ID`, `voldi@example.com`, `Voldi Monzambe`, and `YOUR_PIN_HERE`.

---

## Step 7 — Test locally

In VS Code Terminal:

```bash
npx serve .
```

Open http://localhost:3000 in your browser. Log in with your email and PIN.

---

## Step 8 — Deploy to Netlify

1. Go to https://netlify.com → Add new site → Deploy manually
2. Drag the entire `neo-tracker` folder onto the deploy zone
3. Your app is live at something like `neo-tracker-abc123.netlify.app`
4. Share that URL with your reps → they open it in Safari → Share → Add to Home Screen

---

## Step 9 — Push notifications Edge Function (optional, do after testing)

This sends a notification to you (the lead) every time a rep logs a sale.
Message me and I'll generate this function once the rest is working.

---

## Adding reps after launch

Use the **Manage tab** in your lead view — enter their name, email, and a PIN, tap Add.
They can then log in at your Netlify URL immediately.
