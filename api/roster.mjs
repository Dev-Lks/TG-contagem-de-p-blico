import { DEFAULT_ROSTER, getConfig, sendJson, supabaseFetch } from './_lib.mjs';

const mapRow = (row) => ({ id: row.id, name: row.name, role: row.role, active: row.active });

async function list(eventId) {
  const rows = await supabaseFetch(`counter_roster?select=*&event_id=eq.${encodeURIComponent(eventId)}&active=eq.true&order=role.asc,name.asc`);
  return (rows || []).map(mapRow);
}

export default async function handler(req, res) {
  try {
    const config = getConfig();
    if (req.method === 'GET') {
      let roster = await list(config.eventBaseId);
      if (!roster.length) {
        await supabaseFetch('counter_roster?on_conflict=event_id,name', {
          method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
          body: JSON.stringify(DEFAULT_ROSTER.map((person) => ({ ...person, event_id: config.eventBaseId })))
        });
        roster = await list(config.eventBaseId);
      }
      return sendJson(res, 200, { roster });
    }
    return sendJson(res, 405, { error: 'Método não permitido' });
  } catch (error) {
    sendJson(res, 500, { error: error.message || 'Falha ao atualizar equipe' });
  }
}
