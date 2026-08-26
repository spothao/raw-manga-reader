// Cloudflare Worker: CORS-relay for the reader app.
// Deploy (free, ~5 min):
//   1. dash.cloudflare.com → Workers & Pages → Create Worker → name it e.g. `api-relay`
//   2. Edit code → paste this file → Deploy
//   3. In the reader app settings:
//        - "API 中转" → https://api-relay.<your-subdomain>.workers.dev/proxy?url=
//        - "自定义 CORS 代理" → https://api-relay.<your-subdomain>.workers.dev/html?url=
//   4. (Recommended) keep the targets locked below so your relay can't be
//      abused as an open proxy.

const API_TARGET = 'https://api.ilmu.ai';
const HTML_TARGET = 'https://dokiraw.space';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization,content-type',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
};

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    if (url.pathname === '/proxy') {
      const target = url.searchParams.get('url');
      if (!target || !target.startsWith(API_TARGET)) {
        return new Response('bad target', { status: 403, headers: CORS });
      }
      const upstream = await fetch(target, {
        method: request.method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: request.headers.get('Authorization') || '',
        },
        body: request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.text(),
      });
      return relay(upstream);
    }

    if (url.pathname === '/html') {
      const target = url.searchParams.get('url');
      if (!target || !target.startsWith(HTML_TARGET)) {
        return new Response('bad target', { status: 403, headers: CORS });
      }
      const upstream = await fetch(target, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
          'Accept': 'text/html,application/xhtml+xml',
        },
        redirect: 'follow',
      });
      return relay(upstream);
    }

    return new Response('not found', { status: 404, headers: CORS });
  },
};

function relay(upstream) {
  const res = new Response(upstream.body, upstream);
  for (const [k, v] of Object.entries(CORS)) res.headers.set(k, v);
  return res;
}
