import { timingSafeEqual } from 'node:crypto';
import { getEventConfig, getConfig, readBody, sendJson, supabaseFetch } from './_lib.mjs';

function passwordMatches(received, expected) {
  const a = Buffer.from(String(received || ''));
  const b = Buffer.from(String(expected || ''));
  return a.length === b.length && timingSafeEqual(a, b);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Método não permitido' });
  try {
    const password = process.env.ADMIN_PASSWORD;
    if (!password) return sendJson(res, 503, { error: 'Configure ADMIN_PASSWORD na Vercel antes de usar a administração.' });
    const body = await readBody(req);
    if (!passwordMatches(body.password, password)) return sendJson(res, 401, { error: 'Senha incorreta.' });
    const base = getConfig();
    if (body.action === 'add_person') {
      const name = String(body.name || '').trim().replace(/\s+/g, ' ').slice(0, 80);
      const role = body.role === 'Monitor' ? 'Monitor' : 'Atirador';
      if (name.length < 3) return sendJson(res, 400, { error: 'Informe um nome válido.' });
      await supabaseFetch('counter_roster?on_conflict=event_id,name', {
        method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
        body: JSON.stringify([{ event_id: base.eventBaseId, name, role }])
      });
      return sendJson(res, 200, { ok: true, message: 'Pessoa adicionada.' });
    }
    if (body.action === 'add_gate') {
      const gate = String(body.gate || '').trim().replace(/\s+/g, ' ').slice(0, 80);
      if (gate.length < 3) return sendJson(res, 400, { error: 'Informe um portão válido.' });
      const config = await getEventConfig();
      const gates = [...new Set([...config.gates, gate])].slice(0, 20);
      await supabaseFetch('counter_settings?on_conflict=event_id', {
        method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify([{ event_id: base.eventBaseId, gates }])
      });
      return sendJson(res, 200, { ok: true, gates, message: 'Portão adicionado.' });
    }
    sendJson(res, 400, { error: 'Ação administrativa inválida.' });
  } catch (error) {
    sendJson(res, 500, { error: error.message || 'Falha administrativa.' });
  }
}
