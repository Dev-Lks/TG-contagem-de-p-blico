import { createServer } from 'node:http';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { createReadStream, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, 'public');
const DEFAULT_DATA_DIR = path.join(ROOT, 'data');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8'
};

function parseGates(value) {
  const gates = String(value || 'Portão 1,Portão 2,Portão 3').split(',').map((v) => v.trim()).filter(Boolean);
  return [...new Set(gates)].slice(0, 20);
}

export function createCounterServer(options = {}) {
  const dataDir = options.dataDir || process.env.DATA_DIR || DEFAULT_DATA_DIR;
  const logFile = path.join(dataDir, 'actions.jsonl');
  const config = {
    eventName: options.eventName || process.env.EVENT_NAME || 'Contagem do Evento',
    gates: options.gates || parseGates(process.env.EVENT_GATES),
    startedAt: new Date().toISOString()
  };
  const actions = [];
  const actionIds = new Set();
  const streams = new Set();
  let writeChain = Promise.resolve();

  async function load() {
    await mkdir(dataDir, { recursive: true });
    if (!existsSync(logFile)) return;
    const text = await readFile(logFile, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const action = JSON.parse(line);
        if (action.id && !actionIds.has(action.id)) {
          actionIds.add(action.id);
          actions.push(action);
        }
      } catch {
        // Uma linha incompleta não invalida o restante do histórico.
      }
    }
  }

  function snapshot() {
    return { config, actions };
  }

  function sendJson(res, status, body) {
    const data = JSON.stringify(body);
    res.writeHead(status, { 'content-type': MIME['.json'], 'cache-control': 'no-store' });
    res.end(data);
  }

  async function bodyJson(req) {
    let raw = '';
    for await (const chunk of req) {
      raw += chunk;
      if (raw.length > 1_000_000) throw new Error('Corpo muito grande');
    }
    return JSON.parse(raw || '{}');
  }

  function validateAction(input) {
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

  function normalizeAction(input) {
    return {
      id: String(input.id),
      kind: input.kind,
      deviceId: String(input.deviceId).slice(0, 100),
      operator: String(input.operator).trim().slice(0, 80),
      gate: String(input.gate || '').slice(0, 80),
      flow: input.flow === 'out' ? 'out' : 'in',
      amount: Number(input.amount || 0),
      refId: String(input.refId || '').slice(0, 100),
      estimate: Number(input.estimate || 0),
      note: String(input.note || '').trim().slice(0, 300),
      clientCreatedAt: String(input.createdAt || '').slice(0, 40),
      receivedAt: new Date().toISOString()
    };
  }

  async function storeActions(incoming) {
    const accepted = [];
    const rejected = [];
    for (const item of incoming.slice(0, 100)) {
      if (actionIds.has(String(item?.id || ''))) continue;
      const error = validateAction(item);
      if (error) {
        rejected.push({ id: item?.id, error });
        continue;
      }
      const action = normalizeAction(item);
      actionIds.add(action.id);
      actions.push(action);
      accepted.push(action);
    }
    if (accepted.length) {
      const lines = accepted.map((a) => `${JSON.stringify(a)}\n`).join('');
      writeChain = writeChain.then(() => appendFile(logFile, lines, 'utf8'));
      await writeChain;
      const update = `event: update\ndata: ${JSON.stringify({ actions: accepted })}\n\n`;
      for (const stream of streams) stream.write(update);
    }
    return { accepted: accepted.map((a) => a.id), rejected };
  }

  function csv() {
    const columns = ['id', 'tipo', 'operador', 'portao', 'fluxo', 'quantidade', 'estimativa', 'referencia', 'data_cliente', 'data_servidor'];
    const quote = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
    const rows = actions.map((a) => [a.id, a.kind, a.operator, a.gate, a.flow, a.amount, a.estimate, a.refId, a.clientCreatedAt, a.receivedAt].map(quote).join(','));
    return `\uFEFF${columns.join(',')}\n${rows.join('\n')}\n`;
  }

  async function handler(req, res) {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (req.method === 'GET' && url.pathname === '/api/snapshot') return sendJson(res, 200, snapshot());
      if (req.method === 'POST' && url.pathname === '/api/actions') {
        const body = await bodyJson(req);
        const result = await storeActions(Array.isArray(body.actions) ? body.actions : []);
        return sendJson(res, result.rejected.length ? 207 : 200, result);
      }
      if (req.method === 'GET' && (url.pathname === '/api/export.json' || (url.pathname === '/api/export' && url.searchParams.get('format') === 'json'))) {
        res.writeHead(200, { 'content-type': MIME['.json'], 'content-disposition': 'attachment; filename="contagem-evento.json"' });
        return res.end(JSON.stringify(snapshot(), null, 2));
      }
      if (req.method === 'GET' && (url.pathname === '/api/export.csv' || url.pathname === '/api/export')) {
        res.writeHead(200, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="contagem-evento.csv"' });
        return res.end(csv());
      }
      if (req.method === 'GET' && url.pathname === '/api/stream') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
        res.write(`event: ready\ndata: {}\n\n`);
        streams.add(res);
        req.on('close', () => streams.delete(res));
        return;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'Método não permitido' });
      const requested = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
      const filePath = path.resolve(PUBLIC_DIR, requested);
      if (!filePath.startsWith(`${PUBLIC_DIR}${path.sep}`) || !existsSync(filePath)) return sendJson(res, 404, { error: 'Não encontrado' });
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, { 'content-type': MIME[ext] || 'application/octet-stream', 'cache-control': ext === '.html' ? 'no-cache' : 'public, max-age=3600' });
      if (req.method === 'HEAD') return res.end();
      createReadStream(filePath).pipe(res);
    } catch (error) {
      sendJson(res, 400, { error: error.message || 'Falha na solicitação' });
    }
  }

  const server = createServer(handler);
  return { server, load, snapshot, dataDir };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || '0.0.0.0';
  const app = createCounterServer();
  await app.load();
  app.server.listen(port, host, () => {
    console.log(`Contador disponível em http://localhost:${port}`);
    console.log(`No celular, abra http://IP-DESTE-PC:${port}`);
  });
}
