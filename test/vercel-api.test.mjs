import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import actionsHandler from '../api/actions.mjs';
import snapshotHandler from '../api/snapshot.mjs';
import { saoPauloDate } from '../api/_lib.mjs';

function mockResponse() {
  let body = '';
  const headers = new Map();
  return {
    statusCode: 200,
    setHeader(name, value) { headers.set(name.toLowerCase(), value); },
    end(value = '') { body += value; },
    result() { return { status: this.statusCode, headers, body: body ? JSON.parse(body) : null }; }
  };
}

test('funções da Vercel gravam e leem pelo REST do Supabase', async () => {
  let inserted = [];
  let receivedAuthorization = null;
  const fakeSupabase = createServer(async (req, res) => {
    receivedAuthorization = req.headers.authorization || null;
    if (req.method === 'POST') {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      inserted = JSON.parse(raw);
      res.writeHead(204).end();
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(inserted.map((row) => ({ ...row, received_at: '2026-08-08T12:00:01.000Z' }))));
  });
  await new Promise((resolve) => fakeSupabase.listen(0, '127.0.0.1', resolve));
  const previous = {
    url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SECRET_KEY,
    event: process.env.EVENT_ID, gates: process.env.EVENT_GATES
  };
  const { port } = fakeSupabase.address();
  process.env.SUPABASE_URL = `http://127.0.0.1:${port}`;
  process.env.SUPABASE_SECRET_KEY = 'sb_secret_teste';
  process.env.EVENT_ID = 'evento-teste';
  process.env.EVENT_GATES = 'Principal,Lateral';
  try {
    const action = {
      id: 'acao_api_123', kind: 'count', deviceId: 'device_123', operator: 'Silva',
      gate: 'Principal', flow: 'in', amount: 1, createdAt: '2026-08-08T12:00:00.000Z'
    };
    const postRes = mockResponse();
    await actionsHandler({ method: 'POST', body: { actions: [action] }, url: '/api/actions' }, postRes);
    assert.equal(postRes.result().status, 200);
    assert.deepEqual(postRes.result().body.accepted, [action.id]);
    assert.equal(inserted[0].event_id, `evento-teste-${saoPauloDate()}`);
    assert.equal(receivedAuthorization, null, 'a chave sb_secret não deve ir no header Bearer');

    const getRes = mockResponse();
    await snapshotHandler({ method: 'GET', url: '/api/snapshot' }, getRes);
    assert.equal(getRes.result().status, 200);
    assert.equal(getRes.result().body.actions[0].operator, 'Silva');
    assert.deepEqual(getRes.result().body.config.gates, ['Principal', 'Lateral']);
  } finally {
    await new Promise((resolve) => fakeSupabase.close(resolve));
    for (const [name, value] of Object.entries({
      SUPABASE_URL: previous.url, SUPABASE_SECRET_KEY: previous.key,
      EVENT_ID: previous.event, EVENT_GATES: previous.gates
    })) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});
