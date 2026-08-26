// Local replica of worker/api-proxy.js contract for testing.
import http from 'node:http';

const API_TARGET = 'https://api.ilmu.ai';
const HTML_TARGET = 'https://dokiraw.space';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization,content-type',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
};

http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
  const url = new URL(req.url, 'http://localhost:8787');

  if (url.pathname === '/proxy') {
    const target = url.searchParams.get('url');
    if (!target || !target.startsWith(API_TARGET)) { res.writeHead(403, CORS); return res.end('bad target'); }
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const upstream = await fetch(target, {
      method: req.method,
      headers: { 'Content-Type': 'application/json', Authorization: req.headers.authorization || '' },
      body: chunks.length ? Buffer.concat(chunks) : undefined,
    });
    return finish(res, upstream);
  }

  if (url.pathname === '/html') {
    const target = url.searchParams.get('url');
    if (!target || !target.startsWith(HTML_TARGET)) { res.writeHead(403, CORS); return res.end('bad target'); }
    const upstream = await fetch(target, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
        'Accept': 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
    });
    return finish(res, upstream);
  }

  res.writeHead(404, CORS);
  res.end('not found');
}).listen(8787, () => console.log('relay on :8787'));

async function finish(res, upstream) {
  const headers = { ...CORS, 'Content-Type': upstream.headers.get('content-type') || 'application/json' };
  res.writeHead(upstream.status, headers);
  res.end(Buffer.from(await upstream.arrayBuffer()));
}
