import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const indexPath = fileURLToPath(new URL('./public/index.html', import.meta.url));

export default async function handler(req, res) {
  try {
    const html = await readFile(indexPath, 'utf8');
    res.statusCode = 200;
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.setHeader('cache-control', 'no-cache');
    res.end(html);
  } catch {
    res.statusCode = 500;
    res.end('Não foi possível carregar o aplicativo.');
  }
}
