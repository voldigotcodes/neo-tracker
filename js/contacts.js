// ── CONTACTS (Book of Business) ───────────────────────────────────
import { db }              from '../supabase.js';
import { s }               from './state.js';
import { $, toast, todayKey, fmtDateStr, shiftDateStr, localDateStr } from './utils.js';

window.toggleCxChip = function(chip) {
  const idx = s.cxInterested.indexOf(chip);
  if (idx > -1) { s.cxInterested.splice(idx, 1); $('cxchip-' + chip).classList.remove('in'); }
  else           { s.cxInterested.push(chip);     $('cxchip-' + chip).classList.add('in'); }
};

window.setCxFollowup = function(offset) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const pad = n => String(n).padStart(2,'0');
  $('cx-followup-dt').value = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T10:00`;
  $('cx-followup-dt').style.display = 'block';
  $('cx-fup-today').classList.toggle('on', offset === 0);
  $('cx-fup-tomorrow').classList.toggle('on', offset === 1);
};

window.pickCxDate = function() {
  const dt = $('cx-followup-dt');
  dt.style.display = 'block';
  dt.focus();
  $('cx-fup-today').classList.remove('on');
  $('cx-fup-tomorrow').classList.remove('on');
};

window.saveContact = async function() {
  const name = $('cx-name').value.trim();
  if (!name) { toast('Enter customer name'); return; }
  const btn = document.querySelector('#view-contacts .btn-primary');
  btn.disabled = true; btn.textContent = 'Saving…';
  const fupVal  = $('cx-followup-dt').value;
  const contact = {
    mall_id:       s.activeMallId,
    rep_id:        s.session.id,
    rep_name:      s.session.name,
    name,
    phone:         $('cx-phone').value.trim() || null,
    email:         $('cx-email').value.trim() || null,
    interested_in: s.cxInterested.length ? [...s.cxInterested] : null,
    notes:         $('cx-notes').value.trim() || null,
    follow_up_at:  fupVal ? new Date(fupVal).toISOString() : null,
    status:        'pending',
  };
  const { error } = await db.from('contacts').insert(contact);
  if (error) { toast('Error saving contact'); btn.disabled = false; btn.textContent = 'Save contact'; return; }
  toast(name + ' saved ✓');
  resetContactForm();
  btn.disabled = false; btn.textContent = 'Save contact';
  await renderContacts();
};

window.updateContactStatus = async function(id, status) {
  const { error } = await db.from('contacts').update({ status }).eq('id', id);
  if (error) { toast('Error updating'); return; }
  const msgs = { converted:'✓ Converted!', lost:'Marked lost', called:'✓ Called' };
  toast(msgs[status] || '✓ Updated');
  await renderContacts();
};

window.deleteContact = async function(id) {
  if (!confirm('Delete this contact?')) return;
  const { error } = await db.from('contacts').delete().eq('id', id);
  if (error) { toast('Error deleting'); return; }
  toast('Contact deleted');
  await renderContacts();
};

window.toggleCxCard = function(id) {
  const card = $('cxcard-' + id);
  if (card) card.classList.toggle('open');
};

export function resetContactForm() {
  ['cx-name','cx-phone','cx-email','cx-notes'].forEach(id => { const e = $(id); if (e) e.value = ''; });
  const dt = $('cx-followup-dt');
  if (dt) { dt.value = ''; dt.style.display = 'none'; }
  s.cxInterested = [];
  document.querySelectorAll('.cx-chip').forEach(el => el.classList.remove('in'));
  document.querySelectorAll('.cx-fup-btn').forEach(el => el.classList.remove('on'));
}

// Always filtered by session.id — no exceptions
export async function renderContacts() {
  const { data } = await db.from('contacts')
    .select('*')
    .eq('rep_id', s.session.id)
    .order('follow_up_at', { ascending: true, nullsFirst: false });

  const contacts = data || [];
  $('cx-list').innerHTML = buildContactsHTML(contacts);

  // Show search bar once there's something to search
  const searchWrap = $('cx-search-wrap');
  if (searchWrap) searchWrap.style.display = contacts.length > 4 ? '' : 'none';
  // Reset search on re-render
  const searchInput = $('cx-search');
  if (searchInput) searchInput.value = '';

  const today = todayKey();
  const overdueCount = contacts.filter(c =>
    c.status === 'pending' && c.follow_up_at && localDateStr(c.follow_up_at) < today
  ).length;
  ['nav-contacts-badge','lnav-contacts-badge'].forEach(id => {
    const el = $(id);
    if (!el) return;
    el.textContent    = overdueCount || '';
    el.style.display  = overdueCount > 0 ? 'flex' : 'none';
  });
}

window.filterContacts = function(q) {
  const query = q.toLowerCase().trim();
  // Each contact is a .cx-card element; group labels are .cx-section-label
  const cards = $('cx-list')?.querySelectorAll('.cx-card');
  if (!cards) return;

  const labels = new Set();
  cards.forEach(card => {
    const name  = card.dataset.name  || '';
    const phone = card.dataset.phone || '';
    const email = card.dataset.email || '';
    const match = !query || name.includes(query) || phone.includes(query) || email.includes(query);
    card.style.display = match ? '' : 'none';
    if (match) labels.add(card.dataset.group);
  });

  // Hide section labels with no visible cards
  $('cx-list')?.querySelectorAll('.cx-section-label').forEach(lbl => {
    lbl.style.display = (!query || labels.has(lbl.dataset.group)) ? '' : 'none';
  });

  // No-results message
  let emptyEl = $('cx-list')?.querySelector('.list-search-empty');
  if (query && labels.size === 0) {
    if (!emptyEl) {
      emptyEl = document.createElement('div');
      emptyEl.className = 'empty list-search-empty';
      $('cx-list').appendChild(emptyEl);
    }
    emptyEl.textContent = `No contacts match "${q}"`;
    emptyEl.style.display = '';
  } else if (emptyEl) {
    emptyEl.style.display = 'none';
  }
};

function buildContactsHTML(contacts) {
  if (!contacts.length) return '<div class="empty">No contacts yet.<br>Add your first lead above.</div>';
  const today    = todayKey();
  const tomorrow = shiftDateStr(today, 1);
  const groups   = { overdue:[], today:[], upcoming:[], nodate:[], past:[] };

  contacts.forEach(c => {
    if (c.status !== 'pending') { groups.past.push(c); return; }
    if (!c.follow_up_at)        { groups.nodate.push(c); return; }
    const d = localDateStr(c.follow_up_at);
    if (d < today)       groups.overdue.push(c);
    else if (d === today) groups.today.push(c);
    else                  groups.upcoming.push(c);
  });

  let html = '';
  if (groups.overdue.length)  html += renderCxGroup('Overdue',     groups.overdue,  today, tomorrow);
  if (groups.today.length)    html += renderCxGroup('Today',       groups.today,    today, tomorrow);
  if (groups.upcoming.length) html += renderCxGroup('Upcoming',    groups.upcoming, today, tomorrow);
  if (groups.nodate.length)   html += renderCxGroup('No date set', groups.nodate,   today, tomorrow);
  if (groups.past.length)     html += renderCxGroup('Past',        groups.past,     today, tomorrow);
  return html;
}

function renderCxGroup(label, contacts, today, tomorrow) {
  const groupKey = label.toLowerCase().replace(/\s+/g, '-');
  return `<div class="cx-section-label" data-group="${groupKey}">${label}</div>` +
    contacts.map(c => renderCxCard(c, today, tomorrow, groupKey)).join('');
}

function renderCxCard(c, today, tomorrow, groupKey = '') {
  const statusLabels = { pending:'Pending', called:'Called', converted:'Converted', lost:'Lost' };
  const intLabels    = { credit:'Credit Card', money:'Money Account', debit:'Debit' };

  let fuLabel = '';
  if (c.follow_up_at) {
    const d = localDateStr(c.follow_up_at);
    if (d < today)          fuLabel = `<div class="cx-followup cx-overdue">Overdue · ${fmtDateStr(d)}</div>`;
    else if (d === today)   fuLabel = `<div class="cx-followup cx-today">Today</div>`;
    else if (d === tomorrow) fuLabel = `<div class="cx-followup">Tomorrow</div>`;
    else                    fuLabel = `<div class="cx-followup">${fmtDateStr(d)}</div>`;
  }

  const intChips  = (c.interested_in || []).map(i => `<span class="ck cnt">${intLabels[i] || i}</span>`).join('');
  const phoneLink = c.phone ? `<a class="cx-contact-link" href="tel:${c.phone}" onclick="event.stopPropagation()">${c.phone}</a>` : '';
  const emailLink = c.email ? `<a class="cx-contact-link" href="mailto:${c.email}" onclick="event.stopPropagation()">${c.email}</a>` : '';

  const actions = [];
  if (c.status !== 'called')    actions.push(`<button class="cx-action-btn called"    onclick="updateContactStatus('${c.id}','called')">Mark called</button>`);
  if (c.status !== 'converted') actions.push(`<button class="cx-action-btn converted" onclick="updateContactStatus('${c.id}','converted')">Mark converted</button>`);
  if (c.status !== 'lost')      actions.push(`<button class="cx-action-btn lost"      onclick="updateContactStatus('${c.id}','lost')">Mark lost</button>`);
  actions.push(`<button class="cx-action-btn delete" onclick="deleteContact('${c.id}')">Delete</button>`);

  return `<div class="cx-card" id="cxcard-${c.id}" data-name="${c.name.toLowerCase()}" data-phone="${(c.phone||'').toLowerCase()}" data-email="${(c.email||'').toLowerCase()}" data-group="${groupKey}" onclick="toggleCxCard('${c.id}')">
    <div class="cx-card-body">
      <div class="cx-name-row">
        <div class="cx-name">${c.name}</div>
        <span class="status-pill ${c.status}">${statusLabels[c.status]}</span>
      </div>
      ${phoneLink || emailLink ? `<div class="cx-contact-row">${phoneLink}${emailLink ? (phoneLink ? '&nbsp;&nbsp;' : '') + emailLink : ''}</div>` : ''}
      ${intChips ? `<div class="cx-chips">${intChips}</div>` : ''}
      ${c.notes ? `<div class="cx-notes-preview">${c.notes}</div>` : ''}
      ${fuLabel}
    </div>
    <div class="cx-actions" onclick="event.stopPropagation()">${actions.join('')}</div>
  </div>`;
}
