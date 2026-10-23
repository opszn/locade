import http from 'node:http';
import { once } from 'node:events';

export async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return `http://127.0.0.1:${server.address().port}`;
}

export async function close(server) {
  if (!server.listening) return;
  const done = new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  server.closeAllConnections();
  await done;
}

export async function fixture() {
  let online = true;
  const requests = [];
  const server = http.createServer((request, response) => {
    requests.push(request.url);
    if (!online) {
      response.writeHead(503);
      response.end();
      return;
    }
    if (request.url === '/json') {
      response.setHeader('Content-Type', 'application/json');
      response.end('{}');
      return;
    }
    if (request.url === '/redirect') {
      response.writeHead(302, { Location: 'https://example.invalid/' });
      response.end();
      return;
    }
    if (request.url === '/slow') return;
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end(`<!doctype html><html><head><title>${request.url.startsWith('/notes') ? 'Field Notes' : 'Sprout Studio'}</title><style>
      body{margin:0;padding:60px;background:#e6eddf;color:#243d2a;font-family:Georgia,serif}nav{border-bottom:1px solid #243d2a55;padding-bottom:24px;font:13px monospace;letter-spacing:3px}h1{font-size:100px;font-weight:400;letter-spacing:-6px;line-height:1.05;margin:90px 0 35px;max-width:900px}p{font-size:22px}span{display:inline-block;background:#e4ae4a;border-radius:100%;width:200px;height:200px;position:absolute;right:100px;top:220px}
      </style></head><body><nav>SPROUT / A LOCAL TEST FIXTURE</nav><span></span><h1>Make room<br>for new ideas.</h1><p>A small garden for things worth building.</p></body></html>`);
  });
  const url = await listen(server);
  return {
    server,
    url,
    requests,
    setOnline: (value) => {
      online = value;
    },
  };
}
