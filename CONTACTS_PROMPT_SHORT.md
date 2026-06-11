# Add: Book of Business (Contacts)

You know this codebase. Add a contacts feature. Read all three files before touching anything.

---

## Database — run first

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

## Privacy rule — critical

**Everyone only sees their own contacts.** The lead is also a sales rep. Always query `rep_id = session.id`. No role-based exceptions. No cross-rep visibility.

---

## index.html

- Rep nav: add **Contacts** tab (3rd tab) → `goRep('contacts')`, id `nav-contacts`
- Lead nav: add **Contacts** tab (3rd of 4) → `goLead('contacts')`, id `lnav-contacts`
- Add view containers `#view-contacts` (rep) and `#lview-contacts` (lead) — same header pattern as every other view
- Inside each view: add-contact form on top, contact list `#cx-list` / `#lcx-list` below

**Add-contact form fields:**
- Customer name (required) `#cx-name`
- Phone `#cx-phone` (tel), Email `#cx-email` (email) — side by side
- Interested in: 3 toggle chips — Credit Card, Money Account, Debit — call `toggleCxChip('credit')` etc, reuse `.chip` / `.in` classes
- Notes textarea `#cx-notes`
- Follow-up: quick buttons **Today** / **Tomorrow** / **Pick date**, reveal datetime-local input `#cx-followup-dt`
- "Save contact" button → `saveContact()`

**Contact card structure** (in the list):
- Name + status pill (right-aligned)
- Phone (`tel:`) and email (`mailto:`) on one line
- Interested-in chips if set
- Notes (1 line, truncated)
- Follow-up label: **Overdue** (red) / **Today** (amber) / **Tomorrow** / formatted date
- Tap card to expand → action buttons: Mark called · Mark converted · Mark lost · Delete

---

## app.js

Add to state: `let cxInterested = [];`

Update `goRep(v)` and `goLead(v)` to include `'contacts'` and call `renderContacts()` on that view.

New functions to add:

```js
window.toggleCxChip = function(chip) { /* toggle cxInterested array + .in class */ }
window.setCxFollowup = function(offset) { /* set #cx-followup-dt to today+offset at 10am */ }
window.pickCxDate = function() { /* show + focus #cx-followup-dt */ }
window.saveContact = async function() { /* validate name, insert to contacts, toast, resetContactForm, renderContacts */ }
window.updateContactStatus = async function(id, status) { /* update + renderContacts */ }
window.deleteContact = async function(id) { /* confirm + delete + renderContacts */ }
function resetContactForm() { /* clear all cx fields, cxInterested = [] */ }

async function renderContacts() {
  // ALWAYS filter by rep_id = session.id — no exceptions
  const { data } = await db.from('contacts')
    .select('*').eq('rep_id', session.id)
    .order('follow_up_at', { ascending: true, nullsFirst: false });
  const listId = session.role === 'lead' ? 'lcx-list' : 'cx-list';
  document.getElementById(listId).innerHTML = buildContactsHTML(data || []);
}

function buildContactsHTML(contacts) {
  // Group into: Overdue · Today · Upcoming · No date · Past (called/converted/lost, collapsed)
  // Each group has a section label
  // Overdue + Today show count badge on nav tab
}
```

Add a count badge `#nav-contacts-badge` (and `#lnav-contacts-badge`) on the Contacts nav tab — show count of overdue pending contacts, hide when 0.

---

## style.css

Add only what's needed:
- `.status-pill` + variants `.pending` (amber), `.called` (blue), `.converted` (green), `.lost` (text2)
- `.cx-card` — same border-radius/shadow as existing cards; `.cx-card.open .cx-actions` to expand actions
- `.cx-actions` — small action buttons row
- `.cx-section-label` — muted uppercase group header (match existing section header style)
- `.cx-overdue` red, `.cx-today` amber — for follow-up date labels
- Badge on nav tab: small red circle, top-right of tab

Reuse all existing variables. No new colors.

---

## Done when

- [ ] SQL run
- [ ] Both navs updated (rep 3-tab, lead 4-tab)
- [ ] Add form works, saves to Supabase
- [ ] List groups correctly (overdue/today/upcoming/no-date/past)
- [ ] Status updates work, card moves to Past on completion
- [ ] Badge shows overdue count
- [ ] `renderContacts` never queries without `rep_id = session.id`
