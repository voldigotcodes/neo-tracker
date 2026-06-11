# Neo Tracker — Book of Business / Contacts Feature

## Project overview

Neo Tracker is a PWA sales tracker for Neo Financial mall reps. It is a single-page app with no build step — plain ES modules loaded directly in the browser. Files: `index.html`, `style.css`, `app.js`, `supabase.js`, `sw.js`, `manifest.json`. Backend is Supabase (Postgres + RLS + Realtime). Deployed on Netlify.

Read all existing files carefully before writing anything. Match the existing code style exactly — no frameworks, no bundlers, no TypeScript.

---

## What to build

Add a **Book of Business (Contacts)** feature. When a customer can't complete a sale on the spot, the rep saves their info for a follow-up call later. Each person's book of business is completely private — reps only see their own contacts, and the lead (who is also a sales rep) only sees their own contacts too. No cross-visibility at all.

---

## 1 — Database: run this SQL in Supabase SQL Editor

```sql
create table if not exists contacts (
  id            uuid primary key default gen_random_uuid(),
  mall_id       uuid references malls(id) on delete cascade,
  rep_id        uuid references reps(id) on delete cascade,
  rep_name      text not null,
  name          text not null,
  phone         text,
  email         text,
  interested_in text[],
  notes         text,
  follow_up_at  timestamptz,
  status        text not null default 'pending'
                check (status in ('pending','called','converted','lost')),
  created_at    timestamptz default now()
);

alter table contacts enable row level security;
create policy "contacts_select" on contacts for select using (true);
create policy "contacts_insert" on contacts for insert with check (true);
create policy "contacts_update" on contacts for update using (true);
create policy "contacts_delete" on contacts for delete using (true);
```

---

## 2 — index.html changes

### Rep nav
Change from 2 tabs (Log, Feed) to 3:
```
Log  ·  Feed  ·  Contacts
```
Add a third nav button `lnav`-style with id `nav-contacts`, calling `goRep('contacts')`.
Add a new view section `<div id="view-contacts">` with the same header pattern as the other rep views.

### Lead nav
Change from 3 tabs (Dashboard, Feed, Manage) to 4:
```
Dashboard  ·  Feed  ·  Contacts  ·  Manage
```
Add a nav button with id `lnav-contacts`, calling `goLead('contacts')`.
Add a new view section `<div id="lview-contacts">` with the same header pattern.

### Contacts view content (shared structure used in both rep and lead views)

**Add contact form** (card, same style as the log form cards):
- Text input: Customer name (required), id `cx-name`
- Text input: Phone, id `cx-phone`, type tel
- Text input: Email, id `cx-email`, type email
- Interested in — three toggle chips (reuse `.chip` / `.in` pattern): Credit Card, Money Account, Debit Card — ids `cx-credit`, `cx-money`, `cx-debit`
- Textarea: Notes, id `cx-notes`, same style as existing `#notes`
- Follow-up section: three quick buttons "Today", "Tomorrow", "Pick date" — when "Pick date" is chosen show a date+time input, id `cx-followup-dt`
- CTA button "Save contact", calls `saveContact()`

**Contacts list** below the form, id `cx-list` (rep) / `lcx-list` (lead).

Each contact renders as a card with:
- Customer name (bold) + status pill on the right
- Phone (tappable `tel:` link) and email (tappable `mailto:` link) on one line
- Interested in chips if present
- Notes snippet (1 line, truncated)
- Follow-up time line — show relative label: "Overdue", "Today", "Tomorrow", or the formatted date. Color red if overdue, amber if today.
- On tap: open an inline expand (toggle `.open` class) showing action buttons: **Mark called**, **Mark converted**, **Mark lost**, **Delete**

Status pill colors (add to style.css):
- `pending` → amber (`var(--amber)`)
- `called` → blue (`var(--blue)` or `#3B82F6`)
- `converted` → green (`var(--green)`)
- `lost` → `var(--text2)` (gray, muted)

Group the list into sections with a small section label:
1. **Overdue** (follow_up_at < now, status = pending)
2. **Today** (follow_up_at is today)
3. **Upcoming** (follow_up_at > today)
4. **No date set** (follow_up_at is null)

Completed contacts (called/converted/lost) go in a collapsible **Past** section at the bottom, collapsed by default.

---

## 3 — app.js changes

### State
Add at the top with other state:
```js
let cxInterested = []; // selected product chips for new contact form
```

### Nav
In `goRep(v)`: add `'contacts'` to the array of views/nav ids. Call `renderContacts()` when `v === 'contacts'`.

In `goLead(v)`: add `'contacts'` to the array. Call `renderContacts()` when `v === 'contacts'`.

### Chip toggle for interested-in
```js
window.toggleCxChip = function(chip) {
  const el = document.getElementById('cx-' + chip);
  const idx = cxInterested.indexOf(chip);
  if (idx === -1) { cxInterested.push(chip); el.classList.add('in'); }
  else            { cxInterested.splice(idx,1); el.classList.remove('in'); }
};
```

### Follow-up quick buttons
```js
window.setCxFollowup = function(offset) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  d.setHours(10, 0, 0, 0); // default 10am
  const local = new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0,16);
  document.getElementById('cx-followup-dt').value = local;
  document.getElementById('cx-followup-dt').style.display = 'block';
};
window.pickCxDate = function() {
  document.getElementById('cx-followup-dt').style.display = 'block';
  document.getElementById('cx-followup-dt').focus();
};
```

### saveContact
```js
window.saveContact = async function() {
  const name = document.getElementById('cx-name').value.trim();
  if (!name) { toast('Customer name is required'); return; }
  const phone   = document.getElementById('cx-phone').value.trim() || null;
  const email   = document.getElementById('cx-email').value.trim().toLowerCase() || null;
  const notes   = document.getElementById('cx-notes').value.trim() || null;
  const dtVal   = document.getElementById('cx-followup-dt').value;
  const follow_up_at = dtVal ? new Date(dtVal).toISOString() : null;
  const interested_in = cxInterested.length ? [...cxInterested] : null;

  const { error } = await db.from('contacts').insert({
    mall_id: MALL_ID,
    rep_id:  session.id,
    rep_name: session.name,
    name, phone, email, notes,
    interested_in, follow_up_at,
    status: 'pending'
  });

  if (error) { toast('Error saving contact'); return; }
  toast('Contact saved ✓');
  resetContactForm();
  await renderContacts();
};
```

### resetContactForm
Clear all contact form fields and reset `cxInterested = []`.

### updateContactStatus
```js
window.updateContactStatus = async function(id, status) {
  await db.from('contacts').update({ status }).eq('id', id);
  await renderContacts();
};
window.deleteContact = async function(id) {
  if (!confirm('Delete this contact?')) return;
  await db.from('contacts').delete().eq('id', id);
  await renderContacts();
};
```

### renderContacts
Always filter by `rep_id = session.id` regardless of role — privacy is per-person, the lead is also a sales rep and only sees their own book.

```js
async function renderContacts() {
  const { data } = await db.from('contacts')
    .select('*')
    .eq('rep_id', session.id)
    .order('follow_up_at', { ascending: true, nullsFirst: false });

  const listId = session.role === 'lead' ? 'lcx-list' : 'cx-list';
  document.getElementById(listId).innerHTML = buildContactsHTML(data || []);
}
```

### buildContactsHTML
Group contacts into: overdue, today, upcoming, no-date, and past (called/converted/lost).

For each contact card:
- Tapping the card body toggles an `.open` class to expand/collapse action buttons
- `tel:` and `mailto:` links on phone/email
- Follow-up label: compute from `follow_up_at` vs today — "Overdue" (red), "Today" (amber), "Tomorrow", or `fmtDate(new Date(follow_up_at))`
- Status pill with class matching status value
- Action buttons call `updateContactStatus(id, 'called')` etc and `deleteContact(id)`

Show a count badge on the Contacts nav tab when there are pending/overdue contacts:
```js
function updateContactsBadge(contacts) {
  const now = new Date();
  const urgent = contacts.filter(c =>
    c.status === 'pending' && c.follow_up_at && new Date(c.follow_up_at) <= now
  ).length;
  const badge = document.getElementById('nav-contacts-badge'); // add this span in HTML
  if (badge) { badge.textContent = urgent || ''; badge.style.display = urgent ? 'inline' : 'none'; }
}
```

---

## 4 — style.css changes

Add styles for:
- `.status-pill` base + `.status-pending`, `.status-called`, `.status-converted`, `.status-lost`
- `.cx-card` contact card, same border-radius / shadow as existing cards
- `.cx-card.open .cx-actions` to show the action buttons on expand
- `.cx-actions` flex row of small buttons, reuse `.btn-icon` style
- `.cx-section-label` small uppercase label between groups (same muted style as existing section headers)
- `.cx-followup-overdue` red text, `.cx-followup-today` amber text
- Badge dot on nav tab: small circle, `var(--red)`, positioned top-right of the tab icon
- Interested-in chips on the add form: reuse existing `.chip` / `.chip.in` classes

---

## 5 — Style & UX rules to follow strictly

- No new color variables — reuse `var(--green)`, `var(--amber)`, `var(--red)`, `var(--text2)`, `var(--blue)` etc
- No new fonts or icon libraries
- All async operations show a `toast()` on success and on error
- Phone links use `tel:`, email links use `mailto:`
- All new `window.*` functions follow the existing pattern
- The add-contact form and the list live in the same view — form on top, list below (same pattern as Manage tab)
- Keep the view header pattern: `ne*o*` logo + context line + date

---

## Checklist

- [ ] SQL run in Supabase
- [ ] `index.html`: rep nav updated to 3 tabs, lead nav to 4 tabs, both contacts views added
- [ ] `app.js`: all new functions added, existing nav functions updated
- [ ] `style.css`: contact card, status pills, badge, section labels
- [ ] Privacy verified: `renderContacts` always uses `rep_id = session.id`, never queries all contacts
- [ ] Test: add a contact, check grouping, mark converted, check it moves to Past section
