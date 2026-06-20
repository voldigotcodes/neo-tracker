// ── NAVIGATION ────────────────────────────────────────────────────
// doLogout is in boot.js (needs db + bootApp context)
import { s }               from './state.js';
import { $ }               from './utils.js';
import { resetForm }       from './log.js';
import { renderRepFeed, renderLeadFeed } from './feed.js';
import { renderDash }      from './dashboard.js';
import { renderRepStats }  from './stats.js';
import { renderManage }    from './manage.js';
import { renderContacts }  from './contacts.js';

window.goRep = function(v) {
  ['log','feed','contacts','stats'].forEach(x => $('nav-' + x).classList.toggle('active', x === v));
  ['view-log','view-feed','view-contacts','view-stats'].forEach(id => $(id).classList.remove('active'));
  if (v === 'log')      { $('view-log').classList.add('active');      prepareLogForm(); }
  if (v === 'feed')     { $('view-feed').classList.add('active');     renderRepFeed(); }
  if (v === 'contacts') { $('view-contacts').classList.add('active'); renderContacts(); }
  if (v === 'stats')    { $('view-stats').classList.add('active');    renderRepStats(); }
};

window.goLead = function(v) {
  ['dash','feed','contacts','log','manage'].forEach(x => $('lnav-' + x).classList.toggle('active', x === v));
  ['lview-dash','lview-feed','lview-manage','view-log','view-contacts'].forEach(id => $(id).classList.remove('active'));
  if (v === 'dash')     { $('lview-dash').classList.add('active');    renderDash(); }
  if (v === 'feed')     { $('lview-feed').classList.add('active');    renderLeadFeed(); }
  if (v === 'contacts') { $('view-contacts').classList.add('active'); renderContacts(); }
  if (v === 'log')      { $('view-log').classList.add('active');      prepareLogForm(); }
  if (v === 'manage')   { $('lview-manage').classList.add('active');  renderManage(); }
};

function prepareLogForm() {
  $('log-context').textContent = s.session.name + ' · Log a sale';
  if (s.session.role === 'rep') {
    $('log-rep-selector').style.display = 'none';
    $('log-rep-name').style.display     = 'none';
  } else {
    $('log-rep-selector').style.display = 'block';
    $('log-rep-name').style.display     = 'none';
  }
}

