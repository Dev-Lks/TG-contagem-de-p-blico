import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createCounterServer } from '../server.mjs';

async function runningApp() {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'contador-'));
  const app = createCounterServer({ dataDir, gates: ['Norte', 'Sul'], eventName: 'Teste' });
  await app.load();
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const { port } = app.server.address();
  return { ...app, base: `http://127.0.0.1:${port}`, close: () => new Promise((resolve) => app.server.close(resolve)) };
}

const valid = (overrides = {}) => ({
  id: `acao_${Math.random().toString(36).slice(2)}`, kind: 'count', deviceId: 'device_123456',
  operator: 'Silva', gate: 'Norte', flow: 'in', amount: 1, createdAt: new Date().toISOString(), ...overrides
});

test('salva, deduplica e recarrega ações', async () => {
  const app = await runningApp();
  try {
    const action = valid();
    let response = await fetch(`${app.base}/api/actions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ actions: [action, action] }) });
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).accepted, [action.id]);
    response = await fetch(`${app.base}/api/snapshot`);
    const snapshot = await response.json();
    assert.equal(snapshot.actions.length, 1);
    assert.equal(snapshot.actions[0].amount, 1);
    const log = await readFile(path.join(app.dataDir, 'actions.jsonl'), 'utf8');
    assert.match(log, new RegExp(action.id));
  } finally { await app.close(); }
});

test('aceita desfazer unitário e rejeita lote ou portão inválido', async () => {
  const app = await runningApp();
  try {
    const count = valid({ amount: 1 });
    const undo = valid({ kind: 'undo', amount: -1, refId: count.id });
    const batch = valid({ amount: 5 });
    const invalid = valid({ gate: 'Inexistente' });
    const response = await fetch(`${app.base}/api/actions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ actions: [count, undo, batch, invalid] }) });
    assert.equal(response.status, 207);
    const result = await response.json();
    assert.equal(result.accepted.length, 2);
    assert.equal(result.rejected.length, 2);
    assert.equal(result.rejected[0].error, 'A contagem aceita apenas uma pessoa por marcação');
    assert.equal(result.rejected[1].error, 'Portão inválido');
  } finally { await app.close(); }
});

test('serve o aplicativo e exporta CSV', async () => {
  const app = await runningApp();
  try {
    const page = await fetch(app.base);
    assert.equal(page.status, 200);
    const pageHtml = await page.text();
    assert.match(pageHtml, /Contador de Público/);
    assert.doesNotMatch(pageHtml, /\+5 entrada|\+5 saída/);
    const csv = await fetch(`${app.base}/api/export.csv`);
    assert.match(csv.headers.get('content-type'), /text\/csv/);
    assert.match(await csv.text(), /operador,portao/);
  } finally { await app.close(); }
});
