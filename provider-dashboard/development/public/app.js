'use strict';

const $ = id => document.getElementById(id);
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const DEFAULT_ROLES = [
  {id:'owner',label:'Owner',description:'Manage sample operators, game settings and review workflows.',mark:'O'},
  {id:'operator',label:'Operator',description:'Manage sample operations and prepare release requests.',mark:'OP'},
  {id:'approver',label:'Approver',description:'Review requests and simulate independent approval.',mark:'AP'},
  {id:'auditor',label:'Auditor',description:'Explore sample sessions, activity and reports with read access.',mark:'AU'}
];
const ROUTES = {overview:'Overview',games:'Games',operators:'Operators',ledger:'Sessions & Ledger',releases:'Releases',finance:'Finance & Billing',staff:'Staff Roles'};
const PERMISSION_GROUPS = [
  ['View sample reports',null],['Manage operators','operators:write'],['Manage game settings','games:write'],
  ['Request & validate releases','release:request'],['Approve & reject releases','release:approve'],['Manage demo billing','finance:manage'],['Issue demo invoices','finance:issue'],['Reset sample workspace','workspace:reset']
];
const state = {csrf:null,identity:null,data:null,roles:DEFAULT_ROLES,page:'overview',busy:false,ready:false,expiresAt:null,filter:{operator:'',game:''}};
let toastTimer;
let expiryRefresh;

const formatCount = value => Number.isFinite(Number(value)) ? Number(value).toLocaleString('en-US') : '0';
const titleCase = value => String(value || '').replace(/[_:.\-]+/g,' ').replace(/\b\w/g, char => char.toUpperCase());
const roleLabel = role => state.roles.find(item => item.id === role)?.label || titleCase(role);
const can = permission => state.identity?.kind === 'development' && state.identity.permissions?.includes(permission);
const gameName = id => state.data?.games.find(game => game.id === id)?.name || id;
const operatorName = id => state.data?.operators.find(operator => operator.id === id)?.name || id;
const isOwnRequest = request => [state.identity?.role,state.identity?.id,state.identity?.persona_id].filter(Boolean).includes(request.requested_by);

function dateLabel(value,short = false) {
  const date = new Date(value);
  if (!value || !Number.isFinite(date.getTime())) return '—';
  return date.toLocaleString('en-GB',{timeZone:'Asia/Jakarta',day:'2-digit',month:'short',...(short ? {} : {hour:'2-digit',minute:'2-digit'})}) + (short ? '' : ' WIB');
}

function tag(value,label = value) {
  const kind = ['enabled','active','settled','approved','available','matched'].includes(value) ? 'good' : ['requested','validated','pending','maintenance'].includes(value) ? 'warn' : ['rejected','disabled'].includes(value) ? 'bad' : ['cancelled','read_only','off'].includes(value) ? 'off' : '';
  return `<span class="tag ${kind}">${escapeHTML(titleCase(label))}</span>`;
}

function button(label,attributes = '',variant = 'secondary',disabled = false) {
  return `<button type="button" class="button button-${variant}" ${attributes}${disabled ? ' disabled' : ''}>${label}</button>`;
}

function notice(message,error = false) {
  const toast = $('toast');
  toast.textContent = message;
  toast.classList.toggle('error',error);
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; },6500);
}

async function api(path,{method = 'GET',body} = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(),15000);
  try {
    const response = await fetch(path,{method,credentials:'same-origin',cache:'no-store',signal:controller.signal,headers:{'Accept':'application/json',...(body === undefined ? {} : {'Content-Type':'application/json'}),...(state.csrf ? {'X-CSRF-Token':state.csrf} : {})},...(body === undefined ? {} : {body:JSON.stringify(body)})});
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401 && state.identity) {
        state.identity = null; state.data = null; state.csrf = null;
        showLogin('Your development session ended. Choose a role to start again.');
        clearTimeout(expiryRefresh);
        expiryRefresh = setTimeout(() => loadSession(),0);
      }
      throw new Error(data.message || titleCase(data.error) || `Request failed (${response.status}). Please try again.`);
    }
    return data;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('The workspace took too long to respond. Please try again.');
    if (error instanceof TypeError) throw new Error('Could not reach the workspace. Check your connection and try again.');
    throw error;
  } finally { clearTimeout(timeout); }
}

const post = (path,body = {}) => api(path,{method:'POST',body});
const patch = (path,body) => api(path,{method:'PATCH',body});

function setBusy(busy) {
  state.busy = busy;
  document.querySelectorAll('[data-login-role]').forEach(element => { element.disabled = busy || !state.ready; });
  $('role-switch').disabled = busy;
  $('logout-button').disabled = busy;
  $('role-cards').setAttribute('aria-busy',String(busy || !state.ready));
}

function setLoginFeedback(message,error = false) {
  $('login-feedback').textContent = message;
  $('login-feedback').classList.toggle('error',error);
}

function renderRoleCards() {
  $('role-cards').innerHTML = state.roles.map((role,index) => {
    const fallback = DEFAULT_ROLES.find(item => item.id === role.id);
    return `<article class="role-card" data-role="${escapeHTML(role.id)}"><div class="role-card-top"><span class="role-mark" aria-hidden="true">${escapeHTML(fallback?.mark || role.id.slice(0,2).toUpperCase())}</span><span class="role-number">0${index + 1}</span></div><h3>${escapeHTML(role.label)}</h3><p>${escapeHTML(role.description || fallback?.description)}</p>${button(`<span>Sign In as ${escapeHTML(role.label)}</span><span aria-hidden="true">↗</span>`,`data-login-role="${escapeHTML(role.id)}"`,'primary',!state.ready || state.busy)}</article>`;
  }).join('');
}

function showLogin(message = 'Choose a role to enter your sample workspace.') {
  $('app-shell').hidden = true;
  $('login-screen').hidden = false;
  document.querySelector('.skip-link').setAttribute('href','#main-content');
  if ($('workspace-dialog').open) $('workspace-dialog').close();
  renderRoleCards();
  setLoginFeedback(message);
  document.title = 'XDPLAY — Development Workspace';
}

function acceptSession(session) {
  if (session.development !== true) throw new Error('This page requires the isolated development service.');
  state.csrf = session.csrf || null;
  if (Array.isArray(session.roles)) {
    state.roles = DEFAULT_ROLES.map(fallback => {
      const supplied = session.roles.find(role => role.id === fallback.id);
      return supplied ? {...fallback,...supplied} : fallback;
    });
  }
  state.identity = session.authenticated ? session.identity : null;
  state.expiresAt = session.expires_at || null;
  state.ready = Boolean(state.csrf);
  if (state.identity && state.identity.kind !== 'development') throw new Error('This workspace accepts development personas only.');
}

async function loadSession() {
  state.ready = false;
  setBusy(true);
  $('retry-session').hidden = true;
  try {
    const session = await api('/api/session');
    acceptSession(session);
    if (!state.ready) throw new Error('Could not prepare a sign-in session. Please try again.');
    if (state.identity) await loadWorkspace();
    else showLogin();
  } catch (error) {
    state.identity = null;
    showLogin();
    setLoginFeedback(error.message,true);
    $('retry-session').hidden = false;
  } finally { setBusy(false); }
}

function renderShell() {
  $('login-screen').hidden = true;
  $('app-shell').hidden = false;
  document.querySelector('.skip-link').setAttribute('href','#page-content');
  $('workspace-nav').innerHTML = Object.entries(ROUTES).map(([route,label],index) => `<button type="button" class="nav-link${route === state.page ? ' active' : ''}" data-route="${route}" ${route === state.page ? 'aria-current="page"' : ''}><span class="nav-marker" aria-hidden="true">0${index + 1}</span><span>${escapeHTML(label)}</span></button>`).join('');
  $('role-switch').innerHTML = state.roles.map(role => `<option value="${escapeHTML(role.id)}"${role.id === state.identity.role ? ' selected' : ''}>${escapeHTML(role.label)} · Switch role</option>`).join('');
  $('session-expiry').textContent = state.expiresAt ? 'Session until ' + dateLabel(state.expiresAt) : '';
  $('updated-at').textContent = 'Updated ' + dateLabel(state.data.updated_at);
}

async function loadWorkspace() {
  const data = await api('/api/bootstrap');
  if (data.development !== true || data.identity?.kind !== 'development') throw new Error('Development workspace data could not be verified.');
  state.data = data;
  state.identity = data.identity;
  state.page = ROUTES[location.hash.slice(1)] ? location.hash.slice(1) : state.page;
  if (!ROUTES[state.page]) state.page = 'overview';
  renderShell();
  renderPage();
}

function pageHeading(title,description,actions = '') {
  return `<div class="page-heading"><div><span class="eyebrow">${escapeHTML(roleLabel(state.identity.role).toUpperCase())} / DEVELOPMENT WORKSPACE</span><h1>${title}</h1><p>${description}</p></div>${actions ? `<div class="page-actions">${actions}</div>` : ''}</div>`;
}

function sampleBanner(extra = '') {
  return `<div class="sample-banner"><span class="banner-symbol" aria-hidden="true">◇</span><div><strong>Development / Sample data.</strong> ${extra || 'Explore this role with your own sample workspace. Changes stay here, and switching roles keeps your sample workflow.'}</div></div>`;
}

function empty(message) { return `<div class="empty-state">${escapeHTML(message)}</div>`; }

function auditList(items) {
  if (!items.length) return empty('Your sample activity will appear here.');
  return `<ul class="audit-list">${items.map(item => `<li><span class="audit-dot" aria-hidden="true"></span><div class="audit-copy">${escapeHTML(titleCase(item.event))}<small>${escapeHTML(titleCase(item.actor))}</small></div><time>${escapeHTML(dateLabel(item.created_at))}</time></li>`).join('')}</ul>`;
}

function metric(label,value,note) { return `<article class="metric"><span class="metric-label">${label}</span><strong class="metric-value">${formatCount(value)}</strong><span class="metric-note">${note}</span></article>`; }

function overviewPage() {
  const summary = state.data.summary;
  const actions = button('Refresh','data-action="refresh"') + (can('workspace:reset') ? button('Reset sample data','data-action="reset"','quiet') : '');
  return pageHeading('YOUR <em>WORKSPACE.</em>','Explore the provider dashboard, test sample operations, and review each role’s perspective.',actions) + sampleBanner() +
    `<div class="metrics">${metric('Sample operators',summary.operators,'Isolated operator profiles')}${metric('Configured games',summary.games,'UI fixtures only')}${metric('Sample sessions',summary.sessions,'Virtual activity records')}${metric('Pending releases',summary.pending_releases,'Review simulation')}</div>` +
    `<div class="grid-two"><section class="panel"><div class="panel-header"><h2>YOUR ROLE</h2>${tag('development',roleLabel(state.identity.role))}</div><p>${escapeHTML(state.roles.find(role => role.id === state.identity.role)?.description || 'Explore this development persona.')}</p><ul class="permission-list">${PERMISSION_GROUPS.map(([label,permission]) => `<li><span>${label}</span>${tag(!permission || can(permission) ? 'available' : 'off',!permission || can(permission) ? 'Available' : 'View only')}</li>`).join('')}</ul></section><section class="panel"><div class="panel-header"><h2>TRY A WORKFLOW</h2><span class="small-tag">SIMULATION</span></div><div class="workflow-steps"><div class="workflow-step"><span>01</span><div><strong>Prepare as Operator</strong><small>Create a sample operator and request a release.</small></div></div><div class="workflow-step"><span>02</span><div><strong>Review as Approver</strong><small>Switch roles to approve a validated request.</small></div></div><div class="workflow-step"><span>03</span><div><strong>Inspect as Auditor</strong><small>Read the activity and sample ledger with no write access.</small></div></div></div>${button('Open releases <span aria-hidden="true">↗</span>','data-route="releases"','primary')}<p class="tiny space-top">Approval is simulated. Production activation is unavailable here.</p></section></div>` +
    `<div class="grid-two space-top"><section class="panel"><div class="panel-header"><h2>RECENT ACTIVITY</h2><span class="tiny">This workspace</span></div>${auditList(state.data.audit.slice(0,6))}</section><section class="panel"><div class="panel-header"><h2>ORIGINAL GAMES</h2>${button('View games','data-route="games"','quiet')}</div><ul class="permission-list">${state.data.games.map(game => `<li><span>${escapeHTML(game.name)}<br><small>${escapeHTML(game.version || 'Development fixture')}</small></span>${tag(game.maintenance ? 'maintenance' : 'available',game.maintenance ? 'Paused in sample' : 'Sample available')}</li>`).join('')}</ul><p class="tiny space-top">Game cards represent sample configuration. This workspace does not start live game sessions.</p></section></div>`;
}

function sampleSettingsTable(game) {
  const records=(state.data.game_settings||[]).filter(item=>item.game_id===game.id);
  if(!records.length)return '<p class="tiny">No assigned operators for this game.</p>';
  return '<div class="game-operator-list">'+records.map(item=>{
    const title=operatorName(item.operator_id);
    return '<div class="game-operator-row"><div><strong>'+escapeHTML(title)+'</strong><small>'+escapeHTML(item.min_bet.toLocaleString('en-US'))+'–'+escapeHTML(item.max_bet.toLocaleString('en-US'))+' VCOIN · Rev '+escapeHTML(item.revision)+'</small></div>'+tag(item.enabled&&!item.maintenance?'available':item.maintenance?'maintenance':'disabled',item.enabled&&!item.maintenance?'Enabled':item.maintenance?'Paused':'Disabled')+button('Settings','data-action="config-game" data-id="'+escapeHTML(game.id)+'" data-operator="'+escapeHTML(item.operator_id)+'"','secondary button-small',!can('games:write'))+'</div>';
  }).join('')+'</div>';
}
function gameSettingsDialog(gameId,operatorId) {
  const game=state.data.games.find(item=>item.id===gameId);
  const item=(state.data.game_settings||[]).find(record=>record.game_id===gameId&&record.operator_id===operatorId);
  if(!game||!item)return notice('No assigned operator settings found.',true);
  openDialog('GAME SETTINGS',`<p><strong>${escapeHTML(game.name)}</strong> · ${escapeHTML(operatorName(operatorId))}</p><p class="tiny">Development only. Limits are virtual VCOIN. RNG, RTP, live game math and engine deployment are locked.</p>
  <form id="game-settings-form">
  <input type="hidden" name="operator_id" value="${escapeHTML(operatorId)}">
  <input type="hidden" name="game_id" value="${escapeHTML(gameId)}">
  <input type="hidden" name="revision" value="${item.revision}">
  <div class="settings-fields">
   <label class="form-field">Minimum bet (VCOIN)<input name="min_bet" type="number" min="1" max="100000000" step="1" value="${item.min_bet}" required></label>
   <label class="form-field">Maximum bet (VCOIN)<input name="max_bet" type="number" min="1" max="100000000" step="1" value="${item.max_bet}" required></label>
  </div>
  <label class="settings-toggle"><input type="checkbox" name="enabled" ${item.enabled?'checked':''}>Enable for this operator</label>
  <label class="settings-toggle"><input type="checkbox" name="maintenance" ${item.maintenance?'checked':''}>Operator maintenance mode</label>
  <p class="tiny">Currency: VCOIN (fixed) · Game version: ${escapeHTML(game.version)} · Revision: ${item.revision}</p>
  <p class="form-error" id="form-error" role="alert"></p>
  <div class="dialog-footer">${button('Cancel','data-close-dialog','quiet')}<button class="button button-primary" type="submit">Save sample settings</button></div></form>`);
}
function gamesPage() {
  return pageHeading('GAME <em>WORKSPACE.</em>','Review the sample game catalog and explore maintenance controls for your selected role.') + sampleBanner('Game settings below apply to sample data. Live game engines are not connected.') +
    `<div class="grid-three">${state.data.games.map((game,index) => `<article class="game-card"><div class="game-cover ${game.id.includes('sky') ? 'skygate' : game.id.includes('mahjong') ? 'mahjong' : 'uno'}"><small>XDPLAY ORIGINAL / UI FIXTURE</small><span class="game-monogram" aria-hidden="true">0${index + 1}</span><h2>${escapeHTML(game.name)}</h2></div><div class="game-details"><div class="game-meta">${tag(game.maintenance ? 'maintenance' : 'available',game.maintenance ? 'Maintenance' : 'Available')}<span class="tiny">${escapeHTML(game.version || 'DEV')}</span></div><p>${escapeHTML(game.id)}<br>Sample configuration · No live gameplay</p>${sampleSettingsTable(game)}${button(game.maintenance ? 'Resume sample game' : 'Pause sample game',`data-action="maintenance" data-id="${escapeHTML(game.id)}" title="${can('games:write') ? 'Change this sample game setting' : 'Owner or Operator role required'}"`,'secondary',!can('games:write'))}</div></article>`).join('')}</div>` +
    (!can('games:write') ? '<p class="readonly-note">Your role can review game settings. Switch to Owner or Operator to edit the sample configuration.</p>' : '');
}

function table(headers,rows,label) {
  return `<div class="table-wrap" tabindex="0" role="region" aria-label="${escapeHTML(label)}"><table><thead><tr>${headers.map(header => `<th scope="col">${header}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
}

function operatorsPage() {
  return pageHeading('OPERATOR <em>ACCESS.</em>','Create sample operator profiles and choose their game access.',can('operators:write') ? button('Add operator <span aria-hidden="true">+</span>','data-action="add-operator"','primary') : '') + sampleBanner('Operator profiles use virtual VCOIN in this development session. No usable API keys or wallet credentials are issued.') +
    table(['OPERATOR','ENVIRONMENT','GAME ACCESS','STATUS','ACTION'],state.data.operators.map(operator => `<tr><td><strong>${escapeHTML(operator.name)}</strong><small>${escapeHTML(operator.id)}</small></td><td>${tag('development','Development')}<small>${escapeHTML(operator.currency)} · Sample credits</small></td><td><div class="table-labels">${operator.games.map(id => `<span class="tag">${escapeHTML(gameName(id))}</span>`).join('')}</div></td><td>${tag(operator.status)}</td><td>${button(operator.status === 'enabled' ? 'Disable' : 'Enable',`data-action="operator-status" data-id="${escapeHTML(operator.id)}" title="${can('operators:write') ? 'Change sample operator status' : 'Owner or Operator role required'}"`,'secondary button-small',!can('operators:write'))}</td></tr>`),'Sample operators') +
    (!state.data.operators.length ? empty('No sample operators yet. Sign in as Owner or Operator to add one.') : '') +
    (!can('operators:write') ? '<p class="readonly-note">Read access for this role. Owner and Operator can manage sample operators.</p>' : '');
}

function ledgerPage() {
  const match = item => (!state.filter.operator || item.operator_id === state.filter.operator) && (!state.filter.game || item.game_id === state.filter.game || (!item.game_id && !state.filter.game));
  const sessions = state.data.sessions.filter(match);
  const transactions = state.data.transactions.filter(item => (!state.filter.operator || item.operator_id === state.filter.operator) && (!state.filter.game || item.game_id === state.filter.game || sessions.some(session => session.id === item.session_id)));
  return pageHeading('SESSION <em>LEDGER.</em>','Inspect sample sessions and virtual-credit activity. All roles can view these records.',button('Refresh','data-action="refresh"')) + sampleBanner('These are demonstration records, not verified gameplay outcomes or financial transactions.') +
    `<div class="filter-row"><label>Operator<select id="ledger-operator"><option value="">All operators</option>${state.data.operators.map(operator => `<option value="${escapeHTML(operator.id)}"${state.filter.operator === operator.id ? ' selected' : ''}>${escapeHTML(operator.name)}</option>`).join('')}</select></label><label>Game<select id="ledger-game"><option value="">All games</option>${state.data.games.map(game => `<option value="${escapeHTML(game.id)}"${state.filter.game === game.id ? ' selected' : ''}>${escapeHTML(game.name)}</option>`).join('')}</select></label>${button('Clear filters','data-action="clear-filters"','quiet')}</div>` +
    `<div class="section-title"><h2>SAMPLE SESSIONS</h2><span class="small-tag">${formatCount(sessions.length)} RECORDS</span></div>` +
    table(['SESSION','OPERATOR','GAME','STATUS','CREATED'],sessions.map(session => `<tr><td>${escapeHTML(session.id)}</td><td>${escapeHTML(operatorName(session.operator_id))}</td><td>${escapeHTML(gameName(session.game_id))}</td><td>${tag(session.status)}</td><td>${escapeHTML(dateLabel(session.created_at))}</td></tr>`),'Sample sessions') + (!sessions.length ? empty('No sample sessions match these filters.') : '') +
    `<div class="section-title"><h2>VIRTUAL CREDIT ACTIVITY</h2><span class="small-tag">SAMPLE DATA</span></div>` +
    table(['KIND','OPERATOR','AMOUNT','REFERENCE','CREATED'],transactions.map(transaction => `<tr><td>${tag(transaction.kind)}</td><td>${escapeHTML(operatorName(transaction.operator_id))}</td><td>${escapeHTML(transaction.amount_minor)} ${escapeHTML(transaction.currency || 'VCOIN')}<small>Sample minor units</small></td><td>${escapeHTML(transaction.reference || transaction.id)}</td><td>${escapeHTML(dateLabel(transaction.created_at))}</td></tr>`),'Sample credit activity') + (!transactions.length ? empty('No sample credit entries match these filters.') : '');
}

function releaseActions(request) {
  const options = [];
  if (request.status === 'requested' && can('release:validate')) options.push(button('Validate',`data-action="release" data-id="${escapeHTML(request.id)}" data-release-action="validate"`,'secondary button-small'));
  if (request.status === 'validated' && can('release:approve')) options.push(button('Simulate approval',`data-action="release" data-id="${escapeHTML(request.id)}" data-release-action="approve"${isOwnRequest(request) ? ' title="Switch to a different persona to approve this request"' : ''}`,'primary button-small',isOwnRequest(request)));
  if (['requested','validated'].includes(request.status) && can('release:reject')) options.push(button('Reject',`data-action="release" data-id="${escapeHTML(request.id)}" data-release-action="reject"`,'quiet button-small'));
  if (['requested','validated'].includes(request.status) && can('release:cancel')) options.push(button('Cancel',`data-action="release" data-id="${escapeHTML(request.id)}" data-release-action="cancel"`,'quiet button-small'));
  let note = request.status === 'approved' ? 'Simulation complete. Production activation is unavailable in this workspace.' : ['rejected','cancelled'].includes(request.status) ? 'This sample request is closed.' : request.status === 'validated' ? 'Ready for simulated approval by a different persona.' : 'Validate this sample request before approval.';
  if (isOwnRequest(request) && request.status === 'validated' && can('release:approve')) note = 'You created this request. Switch to Approver to review it independently.';
  if (state.identity.role === 'auditor') note = 'Read-only view. Review this sample request and its recorded activity.';
  return `<div class="release-actions"><span class="tiny">${note}</span><div class="action-group">${options.join('')}</div></div>`;
}

function releasesPage() {
  return pageHeading('RELEASE <em>REVIEW.</em>','Practice requesting, validating and reviewing releases across development personas.',can('release:request') ? button('New request <span aria-hidden="true">+</span>','data-action="new-release"','primary') : '') + sampleBanner('This is a review simulation. Approving a sample request does not publish a game or pass any production release gate.') +
    `<div class="release-list">${state.data.releases.map(request => `<article class="release-card"><div class="release-head"><div><h3>${escapeHTML(gameName(request.game_id))}</h3><p>${escapeHTML(operatorName(request.operator_id))} / ${escapeHTML(request.id)}</p></div>${tag(request.status)}</div><div class="release-meta"><span>Requested by <strong>${escapeHTML(roleLabel(request.requested_by))}</strong></span>${request.approved_by ? `<span>Reviewed by <strong>${escapeHTML(roleLabel(request.approved_by))}</strong></span>` : ''}<span>${escapeHTML(dateLabel(request.created_at))}</span></div>${releaseActions(request)}</article>`).join('')}</div>` + (!state.data.releases.length ? empty('No sample release requests. Owner and Operator can create one.') : '') +
    '<div class="notice-panel space-top"><strong>Try the handoff:</strong> create and validate a request as Operator, then use the role selector to switch to Approver. Your sample workspace stays with you while you switch.</div>';
}

function staffPage() {
  return pageHeading('FOUR <em>PERSPECTIVES.</em>','Switch between development personas to inspect the same sample workspace through different permissions.') + sampleBanner('These are development personas. Real staff accounts, invitations and MFA enrollment are managed in the protected staff system.') +
    `<div class="grid-two">${state.roles.map(role => {
      const persona = state.data.staff.find(item => item.role === role.id);
      const active = state.identity.role === role.id;
      const permissions = role.permissions || [];
      return `<article class="persona-card${active ? ' active' : ''}"><div class="persona-head"><span class="role-mark" aria-hidden="true">${escapeHTML(DEFAULT_ROLES.find(item => item.id === role.id)?.mark)}</span>${active ? tag('available','Current role') : '<span class="small-tag">DEVELOPMENT</span>'}</div><h3>${escapeHTML(role.label)}</h3><p>${escapeHTML(role.description || persona?.description)}</p><div class="role-permissions">${permissions.length ? permissions.map(permission => `<span>${escapeHTML(titleCase(permission))}</span>`).join('') : '<span>Read sample data</span>'}</div>${button(active ? 'Current perspective' : `Switch to ${escapeHTML(role.label)}`,`data-action="switch-role" data-role="${escapeHTML(role.id)}"`,'secondary',active)}</article>`;
    }).join('')}</div>`;
}


function idr(value) {
  return 'Rp ' + Number(value || 0).toLocaleString('id-ID');
}
function financePage() {
  const finance=state.data.finance || {profiles:[],invoices:[]};
  const summary=state.data.finance_summary || {draft:0,issued:0,paid:0,overdue:0,outstanding_idr:0,paid_idr:0};
  const profiles=finance.profiles || [];
  const invoices=finance.invoices || [];
  const rows=profiles.map(profile=>{
    const ready=Boolean(profile.bill_to && profile.billing_email);
    return '<tr><td><strong>'+escapeHTML(operatorName(profile.operator_id))+'</strong><small>'+escapeHTML(profile.operator_id)+'</small></td><td>'+escapeHTML(profile.bill_to || 'Not configured')+'<small>'+escapeHTML(profile.billing_email || 'Missing billing contact')+'</small></td><td>'+idr(profile.monthly_fee)+'<small>Per month · sample</small></td><td>'+idr(profile.usage_fee)+'<small>Per completed demo session</small></td><td>'+tag(ready?'available':'pending',ready?'Configured':'Incomplete')+'</td><td>'+button('Edit profile','data-action="finance-profile" data-id="'+escapeHTML(profile.operator_id)+'"','secondary button-small',!can('finance:manage'))+'</td></tr>';
  });
  const invoiceRows=invoices.map(invoice=>{
    let actions=button('View','data-action="finance-view" data-id="'+escapeHTML(invoice.id)+'"','secondary button-small');
    if(invoice.status==='draft'&&can('finance:issue'))actions+=button('Issue DEMO','data-action="finance-transition" data-op="issue" data-id="'+escapeHTML(invoice.id)+'"','primary button-small');
    if(invoice.status==='issued'&&can('finance:record'))actions+=button('Mark paid (DEMO)','data-action="finance-transition" data-op="mark-paid" data-id="'+escapeHTML(invoice.id)+'"','secondary button-small');
    if(['draft','issued'].includes(invoice.status)&&can('finance:issue'))actions+=button('Void','data-action="finance-transition" data-op="void" data-id="'+escapeHTML(invoice.id)+'"','quiet button-small');
    return '<tr><td><strong>'+escapeHTML(invoice.number)+'</strong><small>'+escapeHTML(invoice.billing_month)+'</small></td><td>'+escapeHTML(operatorName(invoice.operator_id))+'</td><td>'+idr(invoice.total)+'</td><td>'+tag(invoice.status)+'</td><td>'+escapeHTML(invoice.due_at?dateLabel(invoice.due_at,true):'Not issued')+'</td><td><div class="action-group">'+actions+'</div></td></tr>';
  });
  return pageHeading('FINANCE <em>& BILLING.</em>','Manage sample billing profiles and simulate the complete invoice lifecycle.',can('finance:manage')?button('Create sample invoice','data-action="finance-new-invoice"','primary'):'')+
    sampleBanner('All invoices use synthetic IDR amounts and are marked DEMO. No tax assessment, payable obligation, bank transfer, payment gateway or real operator billing occurs.')+
    '<div class="metrics">'+metric('Draft invoices',summary.draft,'Pending demo issuance')+metric('Issued invoices',summary.issued,'Unpaid sample invoices')+metric('Overdue sample',summary.overdue,'Not a real receivable')+metric('Paid demo',summary.paid,'Simulated confirmation only')+'</div>'+
    '<div class="grid-two"><section class="panel"><div class="panel-header"><h2>OPEN SAMPLE INVOICES</h2></div><strong class="metric-value">'+idr(summary.outstanding_idr)+'</strong><p class="tiny">Synthetic outstanding amount in IDR. No payment is owed.</p></section><section class="panel"><div class="panel-header"><h2>PAID SIMULATIONS</h2></div><strong class="metric-value">'+idr(summary.paid_idr)+'</strong><p class="tiny">Status-only, no funds have been received.</p></section></div>'+
    '<div class="section-title"><h2>OPERATOR BILLING PROFILES</h2><span class="small-tag">DEVELOPMENT</span></div>'+
    table(['OPERATOR','BILL TO','MONTHLY','USAGE','STATUS','ACTION'],rows,'Development billing profiles')+
    '<div class="section-title"><h2>DEMO INVOICES</h2><span class="small-tag">'+invoices.length+' RECORDS</span></div>'+
    (invoices.length?table(['INVOICE','OPERATOR','TOTAL','STATUS','DUE','ACTIONS'],invoiceRows,'Sample invoice records'):empty('No invoices. Complete a billing profile, then create a demo invoice.'))+
    '<div class="notice-panel space-top"><strong>Approval simulation:</strong> Owner configures a billing profile and drafts an invoice. Switch to Approver to issue the sample invoice, then return to Owner to record a simulated payment. All statuses are non-commercial.</div>';
}
function profileDialog(operatorId) {
  const f=state.data.finance;
  const p=f?.profiles.find(item=>item.operator_id===operatorId);
  if(!p || !can('finance:manage'))return;
  const field=(label,name,val,max=100)=>'<label class="form-field">'+label+'<input name="'+name+'" value="'+escapeHTML(val)+'" maxlength="'+max+'" required></label>';
  const amount=(label,name,val)=>'<label class="form-field">'+label+' (IDR)<input type="number" name="'+name+'" value="'+val+'" min="0" max="1000000000" step="1" required></label>';
  openDialog('BILLING PROFILE', '<p><strong>'+escapeHTML(operatorName(operatorId))+'</strong> · DEMO DATA ONLY</p><form id="finance-profile-form"><input type="hidden" name="operator_id" value="'+escapeHTML(operatorId)+'"><input type="hidden" name="revision" value="'+p.revision+'">'+field('Billing name','bill_to',p.bill_to,120)+field('Billing email','billing_email',p.billing_email,160)+'<label class="form-field">Address (optional)<textarea name="billing_address" maxlength="280" rows="2">'+escapeHTML(p.billing_address)+'</textarea></label><div class="settings-fields">'+amount('Monthly platform fee','monthly_fee',p.monthly_fee)+amount('Per completed sample session','usage_fee',p.usage_fee)+amount('One-time setup (not automatically charged)','setup_fee',p.setup_fee)+'<label class="form-field">Sample tax % (basis points)<input type="number" name="tax_bps" min="0" max="2000" step="1" value="'+p.tax_bps+'" required></label><label class="form-field">Payment terms (days)<input type="number" name="due_days" min="1" max="90" step="1" value="'+p.due_days+'" required></label></div><p class="tiny">IDR only · tax is a configurable demo assumption, not a legal tax determination.</p><p class="form-error" id="form-error" role="alert"></p><div class="dialog-footer">'+button('Cancel','data-close-dialog','quiet')+'<button class="button button-primary" type="submit">Save demo profile</button></div></form>');
}
function newInvoiceDialog() {
  if(!can('finance:manage'))return;
  const options=(state.data.finance?.profiles||[]).filter(p=>p.bill_to&&p.billing_email);
  if(!options.length){notice('Configure at least one operator billing profile before creating a sample invoice.',true);return;}
  const month=new Date().toISOString().slice(0,7);
  openDialog('CREATE DEMO INVOICE','<p>Invoices are synthetic snapshots from local sample sessions and explicitly configured mock fees.</p><form id="finance-invoice-form"><label class="form-field">Operator<select name="operator_id" required>'+options.map(p=>'<option value="'+escapeHTML(p.operator_id)+'">'+escapeHTML(operatorName(p.operator_id))+'</option>').join('')+'</select></label><label class="form-field">Billing month<input type="month" name="billing_month" value="'+month+'" max="'+month+'" required></label><p class="tiny">One active demo invoice per operator per billing month. Repeated requests are rejected.</p><p class="form-error" id="form-error" role="alert"></p><div class="dialog-footer">'+button('Cancel','data-close-dialog','quiet')+'<button class="button button-primary" type="submit">Create draft (DEMO)</button></div></form>');
}
function invoiceViewDialog(id) {
  const i=state.data.finance?.invoices.find(row=>row.id===id);
  if(!i)return;
  const lines=i.lines.map(line=>'<tr><td>'+escapeHTML(line.description)+'</td><td>'+line.quantity+'</td><td>'+idr(line.unit_amount)+'</td><td>'+idr(line.amount)+'</td></tr>');
  openDialog('DEMO INVOICE','<section class="invoice-preview"><div class="invoice-stamp">NOT PAYABLE · DEMO ONLY</div><h3>'+escapeHTML(i.number)+'</h3><p>'+escapeHTML(i.bill_to)+'<br>'+escapeHTML(i.billing_email)+'<br>'+escapeHTML(i.billing_address||'')+'</p><p><strong>Period:</strong> '+escapeHTML(i.billing_month)+' · <strong>Status:</strong> '+escapeHTML(i.status)+'</p>'+table(['DESCRIPTION','QTY','RATE','AMOUNT'],lines,'Invoice lines')+'<p>Subtotal <strong>'+idr(i.subtotal)+'</strong></p><p>Sample tax basis points: '+i.tax_bps+' · '+idr(i.tax_amount)+'</p><h3>TOTAL '+idr(i.total)+'</h3><p class="tiny">Issued: '+escapeHTML(i.issued_at?dateLabel(i.issued_at):'Not issued')+' · Due: '+escapeHTML(i.due_at?dateLabel(i.due_at,true):'Not assigned')+'</p></section><p class="tiny">Preview only. No legal tax invoice, payment instruction or PDF export.</p><div class="dialog-footer">'+button('Close','data-close-dialog','secondary')+'</div>');
}
function financeTransitionDialog(id,action) {
  const i=state.data.finance?.invoices.find(row=>row.id===id);
  if(!i)return;
  const label=action==='issue'?'Issue demo invoice':action==='mark-paid'?'Confirm demo paid status':'Void demo invoice';
  openDialog(label.toUpperCase(),'<p><strong>'+escapeHTML(i.number)+'</strong> · '+escapeHTML(operatorName(i.operator_id))+'</p><p>'+escapeHTML(label)+'? This changes only sample invoice status and does not create a legal invoice or confirm a real payment.</p><p class="form-error" id="form-error" role="alert"></p><div class="dialog-footer">'+button('Cancel','data-close-dialog','quiet')+button(label,'data-finance-confirm="'+action+'" data-id="'+escapeHTML(id)+'"','primary')+'</div>');
}

const renderers = {overview:overviewPage,games:gamesPage,operators:operatorsPage,ledger:ledgerPage,releases:releasesPage,finance:financePage,staff:staffPage};

function renderPage() {
  if (!state.data || !state.identity) return;
  $('page-content').innerHTML = renderers[state.page]();
  document.querySelectorAll('[data-route]').forEach(element => {
    const current = element.dataset.route === state.page;
    element.classList.toggle('active',current);
    if (element.classList.contains('nav-link')) { if (current) element.setAttribute('aria-current','page'); else element.removeAttribute('aria-current'); }
  });
  document.title = `XDPLAY — ${ROUTES[state.page]} · ${roleLabel(state.identity.role)} · Development`;
}

function navigate(route) {
  if (!state.identity || !ROUTES[route]) return;
  state.page = route;
  history.replaceState(null,'','#' + route);
  renderPage();
  $('page-content').focus({preventScroll:true});
  window.scrollTo({top:0,behavior:'auto'});
}

function openDialog(title,content) {
  $('dialog-content').innerHTML = `<div class="dialog-body"><div class="dialog-heading"><div><span class="eyebrow">DEVELOPMENT / SAMPLE DATA</span><h2 id="dialog-title">${title}</h2></div><button type="button" class="dialog-close" data-close-dialog aria-label="Close dialog">×</button></div>${content}</div>`;
  if (!$('workspace-dialog').open) $('workspace-dialog').showModal();
}

function operatorDialog() {
  if (!can('operators:write')) return;
  openDialog('ADD SAMPLE OPERATOR',`<p>Create a virtual operator profile for this session. No live wallet or API credential is created.</p><form id="operator-form"><label class="form-field">Operator name<input name="name" minlength="2" maxlength="80" autocomplete="off" placeholder="e.g. Aurora Demo" required><small>Use a sample name without personal information.</small></label><fieldset class="fieldset"><legend>Game access</legend><div class="checkbox-grid">${state.data.games.map(game => `<label class="checkbox-option"><input type="checkbox" name="games" value="${escapeHTML(game.id)}" checked><span>${escapeHTML(game.name)}</span></label>`).join('')}</div></fieldset><p class="tiny">Currency: VCOIN · Virtual sample credits</p><p class="form-error" id="form-error" role="alert"></p><div class="dialog-footer">${button('Cancel','data-close-dialog','quiet')}<button class="button button-primary" type="submit">Create sample operator</button></div></form>`);
}

function releaseDialog() {
  if (!can('release:request')) return;
  const operators = state.data.operators.filter(operator => operator.status === 'enabled' && operator.games.length);
  if (!operators.length) { notice('Add or enable a sample operator before requesting a release.',true); return; }
  openDialog('NEW SAMPLE REQUEST',`<p>Prepare a review simulation. A different persona can approve it after validation.</p><form id="release-form"><label class="form-field">Operator<select name="operator_id" id="release-operator" required>${operators.map(operator => `<option value="${escapeHTML(operator.id)}">${escapeHTML(operator.name)}</option>`).join('')}</select></label><label class="form-field">Game<select name="game_id" id="release-game" required>${operators[0].games.map(id => `<option value="${escapeHTML(id)}">${escapeHTML(gameName(id))}</option>`).join('')}</select></label><p class="form-error" id="form-error" role="alert"></p><div class="dialog-footer">${button('Cancel','data-close-dialog','quiet')}<button class="button button-primary" type="submit">Create request</button></div></form>`);
}

function confirmDialog(kind,request) {
  const descriptions = {
    reset:['RESET SAMPLE DATA','This resets the operators, release requests and activity in your current development workspace.','Reset sample data'],
    validate:['VALIDATE SAMPLE REQUEST','Move this sample request to the review stage. This does not validate a real production release.','Validate request'],
    approve:['SIMULATE APPROVAL','Record this persona’s approval of the sample request. No game is published and no production gate is passed.','Simulate approval'],
    reject:['REJECT SAMPLE REQUEST','Mark this sample request as rejected in your development workspace.','Reject request'],
    cancel:['CANCEL SAMPLE REQUEST','Close this sample request in your development workspace.','Cancel request']
  };
  const [title,copy,label] = descriptions[kind];
  openDialog(title,`<p>${copy}</p>${request ? `<div class="notice-panel"><strong>${escapeHTML(gameName(request.game_id))}</strong><br>${escapeHTML(operatorName(request.operator_id))}</div>` : ''}<p class="form-error" id="form-error" role="alert"></p><div class="dialog-footer">${button('Go back','data-close-dialog','quiet')}${button(label,`data-confirm="${kind}"${request ? ` data-id="${escapeHTML(request.id)}"` : ''}`,kind === 'reset' || kind === 'reject' ? 'danger' : 'primary')}</div>`);
}

async function switchRole(role) {
  if (role === state.identity?.role) return;
  const session = await post('/api/development/switch-role',{role});
  acceptSession(session);
  await loadWorkspace();
  notice(`Switched to ${roleLabel(role)}. Your sample workspace is preserved.`);
}

async function runAction(element,task) {
  if (state.busy) return;
  setBusy(true);
  const oldDisabled = element?.disabled;
  if (element) element.disabled = true;
  try { await task(); }
  catch (error) {
    if ($('workspace-dialog').open && $('form-error')) $('form-error').textContent = error.message;
    else notice(error.message,true);
  } finally {
    if (element?.isConnected) element.disabled = Boolean(oldDisabled);
    setBusy(false);
    if (state.identity) $('role-switch').value = state.identity.role;
  }
}

document.addEventListener('click',event => {
  const element = event.target.closest('button,a[data-route]');
  if (!element || element.disabled) return;
  if (element.hasAttribute('data-close-dialog')) { $('workspace-dialog').close(); return; }
  if (element.dataset.route) { event.preventDefault(); navigate(element.dataset.route); return; }
  if (element.dataset.loginRole) {
    runAction(element,async () => {
      setLoginFeedback(`Signing in as ${roleLabel(element.dataset.loginRole)}…`);
      try {
        const session = await post('/api/development/login',{role:element.dataset.loginRole,csrf:state.csrf});
        acceptSession(session);
        state.page = 'overview';
        history.replaceState(null,'','#overview');
        await loadWorkspace();
        $('retry-session').hidden = true;
        window.scrollTo({top:0,behavior:'auto'});
      } catch (error) { setLoginFeedback(error.message,true); $('retry-session').hidden = false; throw error; }
    });
    return;
  }
  if (element.id === 'retry-session') { loadSession(); return; }
  if (element.id === 'logout-button') {
    runAction(element,async () => {
      await post('/api/logout');
      state.identity = null; state.data = null; state.csrf = null; state.ready = false;
      state.filter = {operator:'',game:''};
      history.replaceState(null,'',location.pathname);
      showLogin('Signed out. Preparing a fresh sample workspace…');
      await loadSession();
      notice('Signed out. Your sample session has ended.');
    });
    return;
  }
  const action = element.dataset.action;
  if (action === 'add-operator') { operatorDialog(); return; }
  if (action === 'finance-profile') { profileDialog(element.dataset.id); return; }
  if (action === 'finance-new-invoice') { newInvoiceDialog(); return; }
  if (action === 'finance-view') { invoiceViewDialog(element.dataset.id); return; }
  if (action === 'finance-transition') { financeTransitionDialog(element.dataset.id,element.dataset.op); return; }
  if (element.dataset.financeConfirm) { runAction(element,async()=>{await post('/api/finance/invoices/'+encodeURIComponent(element.dataset.id)+'/'+encodeURIComponent(element.dataset.financeConfirm),{});$('workspace-dialog').close();await loadWorkspace();notice('DEMO invoice status updated. No financial transaction occurred.');});return; }
  if (action === 'config-game') { gameSettingsDialog(element.dataset.id,element.dataset.operator); return; }
  if (action === 'new-release') { releaseDialog(); return; }
  if (action === 'clear-filters') { state.filter = {operator:'',game:''}; renderPage(); return; }
  if (action === 'reset' && can('workspace:reset')) { confirmDialog('reset'); return; }
  if (action === 'release') {
    const request = state.data.releases.find(item => item.id === element.dataset.id);
    const releaseAction = element.dataset.releaseAction;
    if (request && ['validate','approve','reject','cancel'].includes(releaseAction) && can('release:' + releaseAction)) confirmDialog(releaseAction,request);
    return;
  }
  if (element.dataset.confirm) {
    runAction(element,async () => {
      if (element.dataset.confirm === 'reset') {
        await post('/api/development/reset',{confirmation:'RESET DEVELOPMENT'});
        state.filter = {operator:'',game:''};
      } else await post(`/api/release-requests/${encodeURIComponent(element.dataset.id)}/${element.dataset.confirm}`);
      $('workspace-dialog').close();
      await loadWorkspace();
      notice(element.dataset.confirm === 'reset' ? 'Sample workspace reset.' : 'Sample request updated.');
    });
    return;
  }
  if (!action) return;
  runAction(element,async () => {
    if (action === 'refresh') { await loadWorkspace(); notice('Sample workspace refreshed.'); }
    if (action === 'switch-role') await switchRole(element.dataset.role);
    if (action === 'maintenance' && can('games:write')) {
      const game = state.data.games.find(item => item.id === element.dataset.id);
      await patch('/api/games/' + encodeURIComponent(game.id),{maintenance:!game.maintenance});
      await loadWorkspace(); notice('Sample game configuration updated.');
    }
    if (action === 'operator-status' && can('operators:write')) {
      const operator = state.data.operators.find(item => item.id === element.dataset.id);
      await patch('/api/operators/' + encodeURIComponent(operator.id),{status:operator.status === 'enabled' ? 'disabled' : 'enabled'});
      await loadWorkspace(); notice('Sample operator status updated.');
    }
  });
});

document.addEventListener('change',event => {
  const element = event.target;
  if (element.id === 'role-switch') runAction(element,() => switchRole(element.value));
  if (element.id === 'ledger-operator') { state.filter.operator = element.value; renderPage(); }
  if (element.id === 'ledger-game') { state.filter.game = element.value; renderPage(); }
  if (element.id === 'release-operator') {
    const operator = state.data.operators.find(item => item.id === element.value);
    $('release-game').innerHTML = (operator?.games || []).map(id => `<option value="${escapeHTML(id)}">${escapeHTML(gameName(id))}</option>`).join('');
  }
});

document.addEventListener('submit',event => {
  const form = event.target;
  if (!['operator-form','release-form','game-settings-form','finance-profile-form','finance-invoice-form'].includes(form.id)) return;
  event.preventDefault();
  if (!form.reportValidity()) return;
  const values = new FormData(form);
  const submit = form.querySelector('[type=submit]');
  $('form-error').textContent = '';
  runAction(submit,async () => {
    if (form.id === 'finance-profile-form') {
      const n=key=>Number(values.get(key));
      await patch('/api/finance/profile',{operator_id:values.get('operator_id'),bill_to:String(values.get('bill_to')||'').trim(),billing_email:String(values.get('billing_email')||'').trim(),billing_address:String(values.get('billing_address')||'').trim(),currency:'IDR',setup_fee:n('setup_fee'),monthly_fee:n('monthly_fee'),usage_fee:n('usage_fee'),tax_bps:n('tax_bps'),due_days:n('due_days'),revision:n('revision')});
    } else if (form.id === 'finance-invoice-form') {
      await post('/api/finance/invoices',{operator_id:values.get('operator_id'),billing_month:values.get('billing_month')});
    } else if (form.id === 'game-settings-form') {
      const minBet=Number(values.get('min_bet')),maxBet=Number(values.get('max_bet'));
      if(!Number.isSafeInteger(minBet)||!Number.isSafeInteger(maxBet)||minBet<1||maxBet>100000000||minBet>maxBet)throw new Error('Check the VCOIN limits. Minimum must not exceed maximum.');
      await patch('/api/operator-game-settings',{operator_id:values.get('operator_id'),game_id:values.get('game_id'),revision:Number(values.get('revision')),enabled:values.has('enabled'),maintenance:values.has('maintenance'),min_bet:minBet,max_bet:maxBet,currency:'VCOIN'});
    } else if (form.id === 'operator-form') {
      const games = values.getAll('games');
      if (!games.length) throw new Error('Choose at least one game for this sample operator.');
      await post('/api/operators',{name:String(values.get('name') || '').trim(),games,currency:'VCOIN'});
    } else await post('/api/release-requests',{operator_id:values.get('operator_id'),game_id:values.get('game_id')});
    $('workspace-dialog').close();
    await loadWorkspace();
    notice(form.id === 'operator-form' ? 'Sample operator created.' : form.id === 'game-settings-form' ? 'Per-operator game settings saved.' : form.id === 'finance-profile-form' ? 'Demo billing profile saved.' : form.id === 'finance-invoice-form' ? 'Demo invoice draft created.' : 'Sample release request created.');
  });
});

window.addEventListener('hashchange',() => {
  if (state.identity && ROUTES[location.hash.slice(1)]) { state.page = location.hash.slice(1); renderPage(); }
});

renderRoleCards();
loadSession();
