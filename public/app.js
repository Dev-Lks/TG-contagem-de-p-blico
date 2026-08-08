const STORAGE = {
  device: 'contador.device.v1',
  profile: 'contador.profile.v1',
  pending: 'contador.pending.v1'
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const state = {
  config: { eventName: 'Contagem do Evento', gates: ['Portão 1'] },
  actions: [],
  pending: readJson(STORAGE.pending, []),
  profile: readJson(STORAGE.profile, null),
  deviceId: localStorage.getItem(STORAGE.device) || makeId(),
  syncing: false,
  connection: 'offline'
};
localStorage.setItem(STORAGE.device, state.deviceId);

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

function actionBase(kind) {
  return {
    id: makeId(), kind, deviceId: state.deviceId,
    operator: state.profile?.operator || 'Não identificado',
    gate: state.profile?.gate || '', flow: state.profile?.flow || 'in', createdAt: now()
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
    state.pending = state.pending.filter((a) => !done.has(a.id));
    persistPending();
    if (result.rejected?.length) toast(`Não foi possível salvar ${result.rejected.length} registro(s).`);
    await refresh();
  } catch {
    setConnection('offline');
  } finally {
    state.syncing = false;
    render();
  }
}

async function refresh() {
  try {
    const latest = state.actions.at(-1)?.receivedAt;
    const endpoint = latest ? `/api/snapshot?after=${encodeURIComponent(latest)}` : '/api/snapshot';
    const response = await fetchTimed(endpoint, { cache: 'no-store' });
    if (!response.ok) throw new Error();
    const data = await response.json();
    state.config = data.config;
    const merged = new Map(state.actions.map((action) => [action.id, action]));
    for (const action of data.actions || []) merged.set(action.id, action);
    state.actions = [...merged.values()].sort((a, b) => String(a.receivedAt).localeCompare(String(b.receivedAt)) || a.id.localeCompare(b.id));
    setConnection('online');
    render();
  } catch { setConnection('offline'); }
}

function setConnection(mode) {
  state.connection = mode;
  const el = $('#connection');
  el.classList.toggle('online', mode !== 'offline');
  el.classList.toggle('offline', mode === 'offline');
  el.lastChild.textContent = mode === 'online' ? 'Sincronizado' : mode === 'syncing' ? 'Enviando…' : `Offline${state.pending.length ? ` · ${state.pending.length} pendente(s)` : ''}`;
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
  return allActions().slice(Math.max(0, startIndex)).filter((a) => a.deviceId === state.deviceId && a.gate === state.profile.gate && a.flow === state.profile.flow);
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
  const gateSelect = $('#gate');
  const current = gateSelect.value || state.profile?.gate;
  gateSelect.innerHTML = state.config.gates.map((g) => `<option${g === current ? ' selected' : ''}>${escapeHtml(g)}</option>`).join('');
  const active = Boolean(state.profile?.active);
  $('#setup-card').classList.toggle('hidden', active);
  $('#counter-card').classList.toggle('hidden', !active);
  if (active) {
    $('#assignment-gate').textContent = state.profile.gate;
    $('#assignment-flow').textContent = state.profile.flow === 'in' ? 'ENTRADA' : 'SAÍDA';
    $('#assignment-flow').classList.toggle('out', state.profile.flow === 'out');
    $('#operator-name').textContent = state.profile.operator;
    $('#device-total').textContent = ownTotal().toLocaleString('pt-BR');
    const candidate = undoCandidate();
    $('#undo').disabled = !candidate;
    $('#last-action').textContent = candidate ? `Última marcação: +${candidate.amount} às ${formatTime(candidate.clientCreatedAt || candidate.createdAt)}` : 'Nenhuma marcação disponível para desfazer.';
  } else if (state.profile) {
    $('#operator').value = state.profile.operator || '';
    $('#flow').value = state.profile.flow || 'in';
  }
  renderDashboard();
  setConnection(navigator.onLine ? state.connection : 'offline');
}

function renderDashboard() {
  const t = totals();
  $('#present-total').textContent = t.present.toLocaleString('pt-BR');
  $('#in-total').textContent = t.entries.toLocaleString('pt-BR');
  $('#out-total').textContent = t.exits.toLocaleString('pt-BR');
  $('#gate-cards').innerHTML = state.config.gates.map((gate) => {
    const data = t.byGate[gate] || { in: 0, out: 0 };
    return `<article class="gate-card"><h3>${escapeHtml(gate)}</h3><div class="gate-stats"><div><span>Entradas</span><strong>${Math.max(0, data.in).toLocaleString('pt-BR')}</strong></div><div><span>Saídas</span><strong>${Math.max(0, data.out).toLocaleString('pt-BR')}</strong></div><div><span>Saldo</span><strong>${Math.max(0, data.in - data.out).toLocaleString('pt-BR')}</strong></div></div></article>`;
  }).join('');
  $('#last-sync').textContent = state.pending.length ? `${state.pending.length} registro(s) pendente(s)` : `Atualizado ${formatTime(now())}`;
  const estimates = allActions().filter((a) => a.kind === 'estimate');
  const latest = estimates.at(-1);
  $('#latest-estimate').textContent = latest ? `Última estimativa: ${Number(latest.estimate).toLocaleString('pt-BR')} — ${latest.operator}${latest.note ? ` (${latest.note})` : ''}` : 'Nenhuma estimativa registrada.';
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

function addCount(amount) {
  if (!state.profile?.active) return;
  queue({ ...actionBase('count'), amount });
  if (navigator.vibrate) navigator.vibrate(25);
}

$('#start-session').addEventListener('click', () => {
  const operator = $('#operator').value.trim();
  if (operator.length < 2) return toast('Digite o nome do atirador.');
  const profile = { operator, gate: $('#gate').value, flow: $('#flow').value, active: true };
  state.profile = profile;
  const start = actionBase('session_start');
  state.profile.sessionId = start.id;
  localStorage.setItem(STORAGE.profile, JSON.stringify(state.profile));
  queue(start);
});

$('#add-one').addEventListener('click', () => addCount(1));
$$('[data-add]').forEach((button) => button.addEventListener('click', () => addCount(Number(button.dataset.add))));
$('#undo').addEventListener('click', () => {
  const candidate = undoCandidate();
  if (!candidate) return;
  queue({ ...actionBase('undo'), amount: -Number(candidate.amount), refId: candidate.id });
  toast(`Marcação de +${candidate.amount} desfeita.`);
});

function closeSession(message) {
  if (!state.profile?.active) return;
  queue({ ...actionBase('session_end') });
  state.profile.active = false;
  localStorage.setItem(STORAGE.profile, JSON.stringify(state.profile));
  render();
  toast(message);
}
$('#change-post').addEventListener('click', () => closeSession('Posto liberado para nova identificação.'));
$('#end-session').addEventListener('click', () => closeSession('Turno encerrado e salvo.'));

$$('.tab').forEach((tab) => tab.addEventListener('click', () => {
  $$('.tab').forEach((t) => t.classList.toggle('active', t === tab));
  $$('.view').forEach((view) => view.classList.toggle('active', view.id === `${tab.dataset.view}-view`));
}));

function previewEstimate() {
  const estimate = Math.round(Number($('#area').value || 0) * Number($('#density').value));
  $('#estimate-preview').textContent = estimate.toLocaleString('pt-BR');
  return estimate;
}
$('#area').addEventListener('input', previewEstimate);
$('#density').addEventListener('change', previewEstimate);
$('#save-estimate').addEventListener('click', () => {
  const estimate = previewEstimate();
  if (!estimate) return toast('Informe a área ocupada.');
  const operator = state.profile?.operator || prompt('Nome de quem fez a estimativa:')?.trim();
  if (!operator) return;
  const base = actionBase('estimate');
  queue({ ...base, operator, estimate, note: $('#estimate-note').value.trim() });
  toast('Estimativa registrada separadamente.');
});

window.addEventListener('online', () => { refresh(); sync(); });
window.addEventListener('offline', () => { setConnection('offline'); render(); });
setInterval(() => { sync(); refresh(); }, 3000);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
await refresh();
await sync();
render();
