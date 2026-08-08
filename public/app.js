const STORAGE = {
  device: 'contador.device.v1',
  profile: 'contador.profile.v1',
  pending: 'contador.pending.v1',
  roster: 'contador.roster.v1'
};

const FALLBACK_ROSTER = [
  ['Mon TOMAZELI', 'Monitor'], ['Mon RODRIGO', 'Monitor'], ['Mon FONSECA', 'Monitor'], ['Mon SOUZA', 'Monitor'],
  ['Atdr 045 LISBOA', 'Atirador'], ['Atdr 088 GUILHERME', 'Atirador'], ['Atdr 114 ASSIS', 'Atirador'],
  ['Atdr 067 GABRIEL', 'Atirador'], ['Atdr 061 MIGUEL', 'Atirador'], ['Atdr 038 MIRANDA', 'Atirador'],
  ['Atdr 004 BRAGA', 'Atirador'], ['Atdr 039 LIMA', 'Atirador'], ['Atdr 043 MORAIS', 'Atirador'],
  ['Atdr 092 GUIMARÃES', 'Atirador'], ['Atdr 106 MUNIZ', 'Atirador']
].map(([name, role], index) => ({ id: `fallback-${index}`, name, role, active: true }));

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const state = {
  config: { eventName: 'Contagem do Evento', eventDate: '', eventId: '', gates: ['Portão 1'] },
  actions: [],
  pending: readJson(STORAGE.pending, []),
  profile: readJson(STORAGE.profile, null),
  roster: readJson(STORAGE.roster, FALLBACK_ROSTER),
  deviceId: localStorage.getItem(STORAGE.device) || makeId(),
  syncing: false,
  refreshing: false,
  connection: 'connecting'
};
localStorage.setItem(STORAGE.device, state.deviceId);

if (location.search.includes('painel')) {
  const tab = $('#tab-dashboard');
  if (tab) tab.classList.remove('hidden');
  const nav = document.querySelector('.tabs');
  if (nav) nav.style.gridTemplateColumns = 'repeat(3, 1fr)';
}

function readJson(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}

function makeId() {
  return `${Date.now().toString(36)}_${crypto.getRandomValues(new Uint32Array(2)).join('_')}`;
}

function now() { return new Date().toISOString(); }

async function fetchTimed(url, options = {}, timeout = 2500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try { return await fetch(url, { ...options, signal: controller.signal }); }
  finally { clearTimeout(timer); }
}

function actionBase(kind, flow = 'in') {
  return {
    id: makeId(), kind, deviceId: state.deviceId,
    operator: state.profile?.operator || 'Não identificado',
    gate: state.profile?.gate || '', flow, createdAt: now()
  };
}

function allActions() {
  const known = new Set(state.actions.map((a) => a.id));
  return [...state.actions, ...state.pending.filter((a) => !known.has(a.id))];
}

function queue(action) {
  state.pending.push(action);
  persistPending();
  render();
  sync();
}

function persistPending() {
  localStorage.setItem(STORAGE.pending, JSON.stringify(state.pending));
}

async function sync() {
  if (state.syncing || !state.pending.length || !navigator.onLine) return;
  state.syncing = true;
  setConnection('syncing');
  try {
    const sending = [...state.pending];
    const response = await fetchTimed('/api/actions', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ actions: sending })
    });
    const result = await response.json();
    const done = new Set([...(result.accepted || []), ...(result.rejected || []).map((r) => r.id)]);
    const doneActions = sending.filter((a) => done.has(a.id));
    const merged = new Map(state.actions.map((a) => [a.id, a]));
    for (const a of doneActions) {
      merged.set(a.id, { ...a, receivedAt: a.clientCreatedAt || a.createdAt || new Date().toISOString() });
    }
    state.actions = [...merged.values()].sort((a, b) => String(a.receivedAt).localeCompare(String(b.receivedAt)) || a.id.localeCompare(b.id));
    state.pending = state.pending.filter((a) => !done.has(a.id));
    persistPending();
    if (result.rejected?.length) toast(`Não foi possível salvar ${result.rejected.length} registro(s).`);
    setConnection('online');
    render();
    refresh();
  } catch {
    setConnection('offline');
  } finally {
    state.syncing = false;
  }
}

async function refresh() {
  if (state.refreshing) return;
  state.refreshing = true;
  try {
    const latest = state.actions.at(-1)?.receivedAt;
    const endpoint = latest ? `/api/snapshot?after=${encodeURIComponent(latest)}` : '/api/snapshot';
    const response = await fetchTimed(endpoint, { cache: 'no-store' });
    if (!response.ok) throw new Error();
    const data = await response.json();
    const changedDay = Boolean(state.config.eventId && data.config?.eventId && state.config.eventId !== data.config.eventId);
    if (changedDay) state.actions = [];
    if (data.config) state.config = data.config;
    const merged = new Map(state.actions.map((action) => [action.id, action]));
    for (const action of data.actions || []) merged.set(action.id, action);
    state.actions = [...merged.values()].sort((a, b) => String(a.receivedAt).localeCompare(String(b.receivedAt)) || a.id.localeCompare(b.id));
    setConnection('online');
    render();
  } catch { setConnection('offline'); }
  finally { state.refreshing = false; }
}

async function refreshRoster() {
  try {
    const response = await fetchTimed('/api/roster', { cache: 'no-store' });
    if (!response.ok) throw new Error();
    const data = await response.json();
    if (Array.isArray(data.roster) && data.roster.length) {
      state.roster = data.roster;
      localStorage.setItem(STORAGE.roster, JSON.stringify(state.roster));
      render();
    }
  } catch { /* Em modo local, mantém a equipe já salva neste aparelho. */ }
}

function setConnection(mode) {
  state.connection = mode;
  const el = $('#connection');
  el.classList.toggle('online', mode === 'online' || mode === 'syncing');
  el.classList.toggle('offline', mode === 'offline');
  el.classList.toggle('connecting', mode === 'connecting');
  el.lastChild.textContent = mode === 'online' ? 'Sincronizado' : mode === 'syncing' ? 'Enviando…' : mode === 'connecting' ? 'Conectando…' : `Offline${state.pending.length ? ` · ${state.pending.length} pendente(s)` : ''}`;
}

function totals(actions = allActions()) {
  const byGate = Object.fromEntries(state.config.gates.map((gate) => [gate, { in: 0, out: 0 }]));
  let entries = 0, exits = 0;
  for (const a of actions) {
    if (!['count', 'undo'].includes(a.kind)) continue;
    const amount = Number(a.amount || 0);
    if (!byGate[a.gate]) byGate[a.gate] = { in: 0, out: 0 };
    if (a.flow === 'out') { exits += amount; byGate[a.gate].out += amount; }
    else { entries += amount; byGate[a.gate].in += amount; }
  }
  return { entries: Math.max(0, entries), exits: Math.max(0, exits), present: Math.max(0, entries - exits), byGate };
}

function ownSessionActions() {
  if (!state.profile?.sessionId) return [];
  const startIndex = allActions().findIndex((a) => a.id === state.profile.sessionId);
  return allActions().slice(Math.max(0, startIndex)).filter((a) => a.deviceId === state.deviceId && a.gate === state.profile.gate);
}

function ownTotal() {
  return Math.max(0, ownSessionActions().filter((a) => ['count', 'undo'].includes(a.kind)).reduce((sum, a) => sum + Number(a.amount || 0), 0));
}

function undoCandidate() {
  const session = ownSessionActions();
  const undone = new Set(session.filter((a) => a.kind === 'undo').map((a) => a.refId));
  return session.findLast((a) => a.kind === 'count' && !undone.has(a.id));
}

function render() {
  $('#event-name').textContent = state.config.eventName;
  const operationalDate = state.config.eventDate || new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  $('#event-day').textContent = `Dia operacional: ${new Date(`${operationalDate}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'short' })}`;
  $('#exec-event-name').textContent = state.config.eventName;
  $('#exec-subtitle').textContent = new Date(`${operationalDate}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
  const eventTotals = totals();
  $('#exec-in-sub').textContent = `${eventTotals.entries.toLocaleString('pt-BR')} pessoas`;
  $('#exec-out-sub').textContent = `${eventTotals.exits.toLocaleString('pt-BR')} pessoas`;
  const operatorSelect = $('#operator');
  const operatorCurrent = operatorSelect.value || state.profile?.operator || '';
  operatorSelect.innerHTML = `<option value="">Selecione seu nome</option>${state.roster.map((person) => `<option value="${escapeHtml(person.name)}"${person.name === operatorCurrent ? ' selected' : ''}>${escapeHtml(person.name)} — ${person.role}</option>`).join('')}`;
  const gateSelect = $('#gate');
  const current = gateSelect.value || state.profile?.gate;
  gateSelect.innerHTML = state.config.gates.map((g) => `<option${g === current ? ' selected' : ''}>${escapeHtml(g)}</option>`).join('');
  const active = Boolean(state.profile?.active);
  $('#setup-card').classList.toggle('hidden', active);
  $('#counter-card').classList.toggle('hidden', !active);
  if (active) {
    $('#assignment-gate').textContent = state.profile.gate;
    $('#assignment-flow').textContent = 'ENTRADA E SAÍDA';
    $('#assignment-flow').classList.remove('out');
    $('#operator-name').textContent = state.profile.operator;
    $('#device-total').textContent = ownTotal().toLocaleString('pt-BR');
    const candidate = undoCandidate();
    $('#undo').disabled = !candidate;
    $('#last-action').textContent = candidate ? `Última marcação: +${candidate.amount} às ${formatTime(candidate.clientCreatedAt || candidate.createdAt)}` : 'Nenhuma marcação disponível para desfazer.';
  } else if (state.profile) {
    $('#operator').value = state.profile.operator || '';
  }
  $('#counter-in-total').textContent = eventTotals.entries.toLocaleString('pt-BR');
  $('#counter-out-total').textContent = eventTotals.exits.toLocaleString('pt-BR');
  $('#counter-present-total').textContent = eventTotals.present.toLocaleString('pt-BR');
  renderDashboard();
  setConnection(navigator.onLine ? state.connection : 'offline');
}

function renderDashboard() {
  const t = totals();
  const actions = allActions();
  const analysis = analytics(actions);
  $('#present-total').textContent = t.present.toLocaleString('pt-BR');
  $('#in-total').textContent = t.entries.toLocaleString('pt-BR');
  $('#out-total').textContent = t.exits.toLocaleString('pt-BR');
  $('#peak-value').textContent = analysis.peak.total ? analysis.peak.label : '—';
  $('#peak-caption').textContent = analysis.peak.total ? `${analysis.peak.total.toLocaleString('pt-BR')} pessoas` : 'Aguardando';
  const countActions = actions.filter((a) => ['count', 'undo'].includes(a.kind)).length;
  $('#action-count').textContent = countActions.toLocaleString('pt-BR');

  renderTimeline(computeTimeline(actions));
  renderGateBreakdown(state.config.gates, t);
  renderFlowChart(analysis.hours);
  $('#last-sync').textContent = state.pending.length ? `${state.pending.length} registro(s) pendente(s)` : `Atualizado ${formatTime(now())}`;
  const monitors = state.roster.filter((person) => person.role === 'Monitor').length;
  $('#team-summary').textContent = `${state.roster.length} pessoas · ${monitors} monitores`;
  $('#team-list').innerHTML = state.roster.map((person) => {
    const total = analysis.byOperator[person.name] || 0;
    return `<article class="team-member"><span class="member-icon">${person.role === 'Monitor' ? '★' : '●'}</span><div><strong>${escapeHtml(person.name)}</strong><small>${person.role}${total ? ` · ${total.toLocaleString('pt-BR')} registros` : ''}</small></div></article>`;
  }).join('');
}

function computeTimeline(actions) {
  const sorted = actions
    .filter((a) => ['count', 'undo'].includes(a.kind))
    .filter((a) => a.clientCreatedAt || a.receivedAt)
    .sort((a, b) => String(a.clientCreatedAt || a.receivedAt).localeCompare(String(b.clientCreatedAt || b.receivedAt)));
  if (!sorted.length) return [];
  const intervalMs = 15 * 60 * 1000;
  const points = [];
  let currentKey = null;
  let bucket = null;
  let cumIn = 0;
  let cumOut = 0;
  for (const a of sorted) {
    const time = new Date(a.clientCreatedAt || a.receivedAt);
    const key = Math.floor(time.getTime() / intervalMs) * intervalMs;
    if (key !== currentKey) {
      if (bucket) points.push({ ...bucket, cumIn, cumOut, present: Math.max(0, cumIn - cumOut) });
      currentKey = key;
      bucket = { time: key, entries: 0, exits: 0 };
    }
    if (a.flow === 'out') { bucket.exits += Number(a.amount); cumOut += Number(a.amount); }
    else { bucket.entries += Number(a.amount); cumIn += Number(a.amount); }
  }
  if (bucket) points.push({ ...bucket, cumIn, cumOut, present: Math.max(0, cumIn - cumOut) });
  return points.length >= 2 ? points : [];
}

function renderTimeline(points) {
  const el = $('#timeline-chart');
  const caption = $('#timeline-caption');
  if (!points.length) {
    caption.textContent = 'Sem dados';
    el.innerHTML = '<p class="muted small" style="text-align:center;padding:60px 0">Dados insuficientes para gerar o gráfico de evolução.</p>';
    return;
  }
  caption.textContent = `${String(new Date(points[0].time).getHours()).padStart(2, '0')}:${String(new Date(points[0].time).getMinutes()).padStart(2, '0')} — ${String(new Date(points.at(-1).time).getHours()).padStart(2, '0')}:${String(new Date(points.at(-1).time).getMinutes()).padStart(2, '0')}`;
  const maxVal = Math.max(1, ...points.map((p) => Math.max(p.cumIn, p.cumOut, p.present)));
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.style.overflow = 'visible';
  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  defs.innerHTML = '<linearGradient id="inGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#24674d"/><stop offset="100%" stop-color="#24674d" stop-opacity="0"/></linearGradient><linearGradient id="presGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#d6eea9"/><stop offset="100%" stop-color="#d6eea9" stop-opacity="0"/></linearGradient>';
  svg.appendChild(defs);
  const margin = 3;
  const toX = (i) => margin + (i / (points.length - 1)) * (100 - 2 * margin);
  const toY = (v) => 100 - margin - (v / maxVal) * (100 - 2 * margin);
  for (const f of [0.25, 0.5, 0.75]) {
    const y = toY(maxVal * f);
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', margin); line.setAttribute('y1', y);
    line.setAttribute('x2', 100 - margin); line.setAttribute('y2', y);
    line.setAttribute('stroke', '#d9d7cc44'); line.setAttribute('stroke-width', '0.3');
    svg.appendChild(line);
    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', margin - 0.6); text.setAttribute('y', y + 1.2);
    text.setAttribute('text-anchor', 'end'); text.setAttribute('font-size', '2.5');
    text.setAttribute('fill', '#68736e'); text.setAttribute('font-weight', '600');
    text.textContent = Math.round(maxVal * f).toLocaleString('pt-BR');
    svg.appendChild(text);
  }
  function addPolyline(pointsArr, stroke, width, dash) {
    const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    poly.setAttribute('points', pointsArr.map((p, i) => `${toX(i)},${toY(p)}`).join(' '));
    poly.setAttribute('fill', 'none'); poly.setAttribute('stroke', stroke);
    poly.setAttribute('stroke-width', width); poly.setAttribute('stroke-linejoin', 'round');
    poly.setAttribute('stroke-linecap', 'round');
    if (dash) poly.setAttribute('stroke-dasharray', dash);
    svg.appendChild(poly);
  }
  function addArea(pointsArr, fill, opacity) {
    const last = points.length - 1;
    const pts = `${toX(0)},${100 - margin} ${pointsArr.map((p, i) => `${toX(i)},${toY(p)}`).join(' ')} ${toX(last)},${100 - margin}`;
    const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    poly.setAttribute('points', pts); poly.setAttribute('fill', fill); poly.setAttribute('opacity', opacity);
    svg.appendChild(poly);
  }
  addArea(points.map((p) => p.cumIn), 'url(#inGrad)', '0.22');
  addArea(points.map((p) => p.present), 'url(#presGrad)', '0.35');
  addPolyline(points.map((p) => p.cumIn), '#24674d', '0.9');
  addPolyline(points.map((p) => p.cumOut), '#dda565', '0.7', '1.5,1.5');
  addPolyline(points.map((p) => p.present), '#9cbe3c', '1.3');
  el.innerHTML = '';
  el.appendChild(svg);
}

function renderGateBreakdown(gates, totals) {
  const html = gates.map((gate) => {
    const data = totals.byGate[gate] || { in: 0, out: 0 };
    const absIn = Math.abs(data.in);
    const absOut = Math.abs(data.out);
    const total = absIn + absOut || 1;
    const inPct = Math.round(absIn / total * 100);
    const outPct = Math.round(absOut / total * 100);
    const saldo = Math.max(0, absIn - absOut);
    return `<div class="gate-row">
      <h3>${escapeHtml(gate)}</h3>
      <div class="gate-bars"><div class="gate-bar-in" style="width:${inPct}%"></div><div class="gate-bar-out" style="width:${outPct}%"></div></div>
      <strong>${saldo.toLocaleString('pt-BR')}</strong>
    </div>
    <div class="gate-row" style="font-size:11px;color:var(--muted);min-height:0">
      <span></span><span>${absIn.toLocaleString('pt-BR')} entradas · ${absOut.toLocaleString('pt-BR')} saídas</span><span></span>
    </div>`;
  }).join('');
  $('#gate-breakdown').innerHTML = html || '<p class="muted small">Nenhum portão configurado.</p>';
}

function analytics(actions) {
  const hours = new Map();
  const byOperator = {};
  for (const action of actions) {
    if (!['count', 'undo'].includes(action.kind)) continue;
    const date = new Date(action.clientCreatedAt || action.createdAt || action.receivedAt);
    const hour = Number.isNaN(date.valueOf()) ? '—' : `${String(date.getHours()).padStart(2, '0')}h`;
    const data = hours.get(hour) || { label: hour, in: 0, out: 0 };
    if (action.flow === 'out') data.out += Number(action.amount || 0);
    else data.in += Number(action.amount || 0);
    hours.set(hour, data);
    byOperator[action.operator] = (byOperator[action.operator] || 0) + Math.abs(Number(action.amount || 0));
  }
  const ordered = [...hours.values()].sort((a, b) => a.label.localeCompare(b.label));
  const peak = ordered.reduce((best, item) => Math.max(0, item.in + item.out) > best.total ? { label: item.label, total: Math.max(0, item.in + item.out) } : best, { label: '—', total: 0 });
  return { hours: ordered, peak, byOperator };
}

function renderFlowChart(hours) {
  const max = Math.max(1, ...hours.map((item) => Math.max(item.in, item.out)));
  $('#flow-chart').innerHTML = hours.length ? hours.map((item) => `<div class="flow-bar" title="${item.label}: ${item.in} entradas, ${item.out} saídas"><i class="in" style="height:${Math.max(2, item.in / max * 100)}%"></i><i class="out" style="height:${Math.max(2, item.out / max * 100)}%"></i><b>${item.label}</b></div>`).join('') : '<p class="muted small">Os dados vão aparecer aqui conforme a contagem começar.</p>';
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}

function formatTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? '--:--' : date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

let toastTimer;
function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
}

function addCount(amount, flow) {
  if (!state.profile?.active) return;
  queue({ ...actionBase('count', flow), amount });
  if (navigator.vibrate) navigator.vibrate(25);
}

$('#start-session').addEventListener('click', () => {
  const operator = $('#operator').value.trim();
  if (operator.length < 2) return toast('Selecione seu nome na lista.');
  const profile = { operator, gate: $('#gate').value, active: true };
  state.profile = profile;
  const start = actionBase('session_start');
  state.profile.sessionId = start.id;
  localStorage.setItem(STORAGE.profile, JSON.stringify(state.profile));
  queue(start);
});

$('#add-one-in').addEventListener('click', () => addCount(1, 'in'));
$('#add-one-out').addEventListener('click', () => addCount(1, 'out'));
$$('[data-add]').forEach((button) => button.addEventListener('click', () => addCount(Number(button.dataset.add), button.dataset.flow)));
$('#undo').addEventListener('click', () => {
  const candidate = undoCandidate();
  if (!candidate) return;
  queue({ ...actionBase('undo', candidate.flow), amount: -Number(candidate.amount), refId: candidate.id });
  toast(`Marcação de +${candidate.amount} desfeita.`);
});

function closeSession(message) {
  if (!state.profile?.active) return;
  state.profile.active = false;
  localStorage.setItem(STORAGE.profile, JSON.stringify(state.profile));
  queue({ ...actionBase('session_end') });
  toast(message);
}
$('#change-post').addEventListener('click', () => closeSession('Posto liberado para nova identificação.'));
$('#end-session').addEventListener('click', () => closeSession('Turno encerrado e salvo.'));

$$('.tab').forEach((tab) => tab.addEventListener('click', () => {
  $$('.tab').forEach((t) => t.classList.toggle('active', t === tab));
  $$('.view').forEach((view) => view.classList.toggle('active', view.id === `${tab.dataset.view}-view`));
}));

window.addEventListener('online', () => { refresh(); sync(); });
window.addEventListener('offline', () => { setConnection('offline'); render(); });
setInterval(() => { sync(); refresh(); }, 3000);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
await refresh();
await refreshRoster();
await sync();
render();
