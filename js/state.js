// ── SHARED MUTABLE STATE ──────────────────────────────────────────
// All modules import { s } and read/write via s.property.
// Object reference is shared, so mutations propagate automatically.
export const s = {
  // auth
  session:    null,

  // log form
  cart:       [],
  form:       { act: false, dep: false, depAmt: null },
  editingId:  null,

  // mall config
  targets:    { 0:20, 1:10, 2:10, 3:10, 4:15, 5:15, 6:20 },
  cphTarget:  2.0,
  acphTarget: 1.5,

  // dashboard period
  dashPeriod: 'day',   // 'day' | 'week' | 'month' — persisted to localStorage

  // dynamic mall scope (set at login; null for manager until they drill in)
  activeMallId:       '',
  activeMallName:     '',
  activeDistrictId:   '',
  activeDistrictName: '',

  // manager district overview
  districtDate:    '',
  districtPeriod:  'day',
  districtMalls:   [],   // [{id, name, district_id, targets, cph_target, acph_target}]
  districts:       [],   // [{id, name}] — admin only

  // active dates
  dashDate:   '',
  feedDate:   '',
  statsDate:  '',
  rosterDate: '',

  // calendar
  calTarget:  null,   // 'dash' | 'feed' | 'profile' | 'roster'
  calMonth:   '',     // 'YYYY-MM'
  calActive:  new Set(),

  // feed cache (id → sale object, for edit)
  salesCache: {},

  // contacts
  cxInterested: [],

  // realtime
  realtimeCh: null,

  // rep modal
  modalRepName:  '',
  modalRepId:    '',
  modalRefDate:  '',

  // rep full-page profile
  profileRepName:  '',
  profileRepId:    '',
  profileDate:     '',
  profilePrevView: 'dash',
  profilePeriod:   'week',
};
