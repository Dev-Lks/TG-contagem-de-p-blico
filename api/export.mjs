import { actionsCsv, getEventConfig, readActions, sendJson } from './_lib.mjs';

export default async function handler(req, res) {
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'Método não permitido' });
  try {
    const config = await getEventConfig();
    const actions = await readActions({ eventId: config.eventId });
    const format = new URL(req.url, 'https://local.invalid').searchParams.get('format');
    if (format === 'json') {
      res.setHeader('content-disposition', 'attachment; filename="contagem-evento.json"');
      return sendJson(res, 200, { config, actions });
    }
    res.statusCode = 200;
    res.setHeader('content-type', 'text/csv; charset=utf-8');
    res.setHeader('content-disposition', 'attachment; filename="contagem-evento.csv"');
    res.end(actionsCsv(actions));
  } catch (error) {
    sendJson(res, 500, { error: error.message || 'Falha ao exportar contagem' });
  }
}
