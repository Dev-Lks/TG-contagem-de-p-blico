import { getEventConfig, readBody, sendJson, supabaseFetch, toDatabaseAction, validateAction } from './_lib.mjs';

export default async function handler(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Método não permitido' });
  try {
    const config = await getEventConfig();
    const body = await readBody(req);
    const incoming = Array.isArray(body.actions) ? body.actions.slice(0, 100) : [];
    const valid = [];
    const rejected = [];
    for (const action of incoming) {
      const error = validateAction(action, config);
      if (error) rejected.push({ id: action?.id, error });
      else valid.push(action);
    }
    if (valid.length) {
      await supabaseFetch('counter_actions?on_conflict=id', {
        method: 'POST',
        headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
        body: JSON.stringify(valid.map((action) => toDatabaseAction(action, config.eventId)))
      });
    }
    sendJson(res, rejected.length ? 207 : 200, { accepted: valid.map((action) => action.id), rejected });
  } catch (error) {
    sendJson(res, 500, { error: error.message || 'Falha ao salvar contagem' });
  }
}
