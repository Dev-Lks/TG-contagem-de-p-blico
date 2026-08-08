import { DEFAULT_ROSTER, getConfig, readBody, sendJson, supabaseFetch } from './_lib.mjs';

const mapRow = (row) => ({ id: row.id, name: row.name, role: row.role, active: row.active });

async function list(eventId) {
  const rows = await supabaseFetch(`counter_roster?select=*&event_id=eq.${encodeURIComponent(eventId)}&active=eq.true&order=role.asc,name.asc`);
  return (rows || []).map(mapRow);
}

export default async function handler(req, res) {
  try {
    const config = getConfig();
    if (req.method === 'GET') {
      let roster = await list(config.eventId);
      if (!roster.length) {
        await supabaseFetch('counter_roster?on_conflict=event_id,name', {
          method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
          body: JSON.stringify(DEFAULT_ROSTER.map((person) => ({ ...person, event_id: config.eventId })))
        });
        roster = await list(config.eventId);
      }
      return sendJson(res, 200, { roster });
    }
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'Método não permitido' });
    const body = await readBody(req);
    const name = String(body.name || '').trim().replace(/\s+/g, ' ').slice(0, 80);
    const role = body.role === 'Monitor' ? 'Monitor' : 'Atirador';
    if (name.length < 3) return sendJson(res, 400, { error: 'Informe um nome válido.' });
    await supabaseFetch('counter_roster?on_conflict=event_id,name', {
      method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
      body: JSON.stringify([{ event_id: config.eventId, name, role }])
    });
    sendJson(res, 200, { ok: true });
  } catch (error) {
    sendJson(res, 500, { error: error.message || 'Falha ao atualizar equipe' });
  }
}
