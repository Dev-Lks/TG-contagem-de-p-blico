const PAGE_SIZE = 1000;

export const DEFAULT_ROSTER = [
  ['Mon TOMAZELI', 'Monitor'], ['Mon RODRIGO', 'Monitor'], ['Mon FONSECA', 'Monitor'], ['Mon SOUZA', 'Monitor'],
  ['Atdr 045 LISBOA', 'Atirador'], ['Atdr 088 GUILHERME', 'Atirador'], ['Atdr 114 ASSIS', 'Atirador'],
  ['Atdr 067 GABRIEL', 'Atirador'], ['Atdr 061 MIGUEL', 'Atirador'], ['Atdr 038 MIRANDA', 'Atirador'],
  ['Atdr 004 BRAGA', 'Atirador'], ['Atdr 039 LIMA', 'Atirador'], ['Atdr 043 MORAIS', 'Atirador'],
  ['Atdr 092 GUIMARÃES', 'Atirador'], ['Atdr 106 MUNIZ', 'Atirador']
].map(([name, role]) => ({ name, role }));

export function saoPauloDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(now);
  const value = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function baseEventId(value) {
  return String(value || 'fiemg').trim().replace(/-\d{4}-\d{2}-\d{2}$/, '') || 'fiemg';
}

export function getConfig(env = process.env) {
  const gates = String(env.EVENT_GATES || 'Portão 1,Portão 2,Portão 3')
    .split(',').map((value) => value.trim()).filter(Boolean);
  const eventDate = saoPauloDate();
  const eventBaseId = baseEventId(env.EVENT_ID);
  return {
    eventId: `${eventBaseId}-${eventDate}`,
    eventBaseId,
    eventDate,
    eventName: env.EVENT_NAME || 'Contagem do Evento',
    gates: [...new Set(gates)].slice(0, 20)
  };
}

export async function getEventConfig(env = process.env) {
  const config = getConfig(env);
  try {
    const rows = await supabaseFetch(`counter_settings?select=gates&event_id=eq.${encodeURIComponent(config.eventBaseId)}&limit=1`, {}, env);
    const gates = rows?.[0]?.gates;
    if (Array.isArray(gates) && gates.length) {
      return { ...config, gates: [...new Set(gates.map((gate) => String(gate).trim()).filter(Boolean))].slice(0, 20) };
    }
  } catch { /* A primeira execução ainda pode não ter a tabela de configurações. */ }
  return config;
}

export function validateAction(input, config) {
  if (!input || typeof input !== 'object') return 'Ação inválida';
  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(String(input.id || ''))) return 'ID inválido';
  if (!['count', 'undo', 'session_start', 'session_end', 'estimate'].includes(input.kind)) return 'Tipo inválido';
  if (!String(input.deviceId || '').slice(0, 100)) return 'Dispositivo ausente';
  if (!String(input.operator || '').trim().slice(0, 80)) return 'Operador ausente';
  if (input.kind === 'count' || input.kind === 'undo') {
    if (!config.gates.includes(input.gate)) return 'Portão inválido';
    if (!['in', 'out'].includes(input.flow)) return 'Fluxo inválido';
    if (input.kind === 'count' && input.amount !== 1) return 'A contagem aceita apenas uma pessoa por marcação';
    if (input.kind === 'undo') {
      if (input.amount !== -1) return 'O desfazer aceita apenas uma pessoa por marcação';
      if (!/^[a-zA-Z0-9_-]{8,100}$/.test(String(input.refId || ''))) return 'Referência de desfazer inválida';
    }
  }
  if (input.kind === 'estimate' && (!Number.isFinite(input.estimate) || input.estimate < 0 || input.estimate > 100000)) return 'Estimativa inválida';
  return null;
}

export function toDatabaseAction(input, eventId) {
  return {
    id: String(input.id), event_id: eventId, kind: input.kind,
    device_id: String(input.deviceId).slice(0, 100),
    operator: String(input.operator).trim().slice(0, 80),
    gate: String(input.gate || '').slice(0, 80),
    flow: input.flow === 'out' ? 'out' : 'in',
    amount: Number(input.amount || 0), ref_id: String(input.refId || '').slice(0, 100),
    estimate: Number(input.estimate || 0), note: String(input.note || '').trim().slice(0, 300),
    client_created_at: input.createdAt || null
  };
}

export function fromDatabaseAction(row) {
  return {
    id: row.id, kind: row.kind, deviceId: row.device_id, operator: row.operator,
    gate: row.gate || '', flow: row.flow || 'in', amount: Number(row.amount || 0),
    refId: row.ref_id || '', estimate: Number(row.estimate || 0), note: row.note || '',
    clientCreatedAt: row.client_created_at, receivedAt: row.received_at
  };
}

function credentials(env = process.env) {
  const url = String(env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!url || !key) throw new Error('Configure SUPABASE_URL e SUPABASE_SECRET_KEY na Vercel.');
  return { url, key };
}

export async function supabaseFetch(path, options = {}, env = process.env) {
  const { url, key } = credentials(env);
  const auth = key.startsWith('sb_secret_') ? {} : { authorization: `Bearer ${key}` };
  const response = await fetch(`${url}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: key, ...auth,
      'content-type': 'application/json', ...(options.headers || {})
    }
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Supabase ${response.status}: ${detail.slice(0, 500)}`);
  }
  if (response.status === 204 || response.headers.get('content-length') === '0') return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

export async function readActions({ eventId, after = '', env = process.env }) {
  const rows = [];
  for (let offset = 0; offset < 20000; offset += PAGE_SIZE) {
    const filters = [
      'select=*', `event_id=eq.${encodeURIComponent(eventId)}`,
      'order=received_at.asc,id.asc'
    ];
    if (after) filters.push(`received_at=gte.${encodeURIComponent(after)}`);
    const page = await supabaseFetch(`counter_actions?${filters.join('&')}`, {
      headers: { Range: `${offset}-${offset + PAGE_SIZE - 1}` }
    }, env);
    rows.push(...(page || []));
    if (!page || page.length < PAGE_SIZE) break;
  }
  return rows.map(fromDatabaseAction);
}

export function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
}

export async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 1_000_000) throw new Error('Corpo muito grande');
  }
  return JSON.parse(raw || '{}');
}

export function actionsCsv(actions) {
  const columns = ['id', 'tipo', 'operador', 'portao', 'fluxo', 'quantidade', 'estimativa', 'observacao', 'referencia', 'data_cliente', 'data_servidor'];
  const quote = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  const rows = actions.map((a) => [a.id, a.kind, a.operator, a.gate, a.flow, a.amount, a.estimate, a.note, a.refId, a.clientCreatedAt, a.receivedAt].map(quote).join(','));
  return `\uFEFF${columns.join(',')}\n${rows.join('\n')}\n`;
}
