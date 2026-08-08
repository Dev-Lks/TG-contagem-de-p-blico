import { getEventConfig, readActions, sendJson } from './_lib.mjs';

export default async function handler(req, res) {
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'Método não permitido' });
  try {
    const config = await getEventConfig();
    const url = new URL(req.url, 'https://local.invalid');
    const after = url.searchParams.get('after') || '';
    const actions = await readActions({ eventId: config.eventId, after });
    sendJson(res, 200, { config, actions, incremental: Boolean(after) });
  } catch (error) {
    sendJson(res, 500, { error: error.message || 'Falha ao carregar contagem' });
  }
}
