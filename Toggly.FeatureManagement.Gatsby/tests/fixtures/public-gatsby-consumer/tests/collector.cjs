const http = require('node:http');
const zlib = require('node:zlib');

const definitions = {
  Visible: true,
  Hidden: false,
  Skipped: true,
  Local: true,
  Entity: {
    requirement: 'all',
    rules: [{ property: 'enabled', op: 'eq', value: 'true', type: 'boolean' }],
  },
};

function decodeBody(headers, raw) {
  const body = headers['content-encoding'] === 'gzip' ? zlib.gunzipSync(raw) : raw;
  return {
    rawBody: raw.toString('base64'),
    bodyText: body.toString('utf8'),
    body: body.length ? safeJson(body.toString('utf8')) : null,
  };
}

function createCollector({ port = 8838, telemetryStatus = 202 } = {}) {
  const requests = [];
  let currentTelemetryStatus = telemetryStatus;
  const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    if (req.method === 'OPTIONS') {
      res.writeHead(204).end();
      return;
    }
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks);
      const decoded = decodeBody(req.headers, raw);
      const record = {
        method: req.method,
        url: req.url,
        headers: req.headers,
        ...decoded,
      };
      requests.push(record);
      if (req.url.includes('/metrics')) {
        const status = typeof currentTelemetryStatus === 'function' ? currentTelemetryStatus() : currentTelemetryStatus;
        res.writeHead(status, { 'content-type': 'application/json' }).end('{}');
        return;
      }
      if (req.url.includes('/evaluated-signed/')) {
        res.writeHead(200, { 'content-type': 'application/json', etag: 'gatsby-probe-v1' })
          .end(JSON.stringify(definitions));
        return;
      }
      res.writeHead(404).end();
    });
  });
  return {
    requests,
    server,
    setTelemetryStatus(status) { currentTelemetryStatus = status; },
    listen: () => new Promise((resolve, reject) => {
      const onError = error => reject(error);
      server.once('error', onError);
      server.listen(port, '127.0.0.1', () => {
        server.removeListener('error', onError);
        resolve();
      });
    }),
    close: () => new Promise((resolve, reject) => {
      if (!server.listening) return resolve();
      server.closeAllConnections?.();
      server.close(err => err ? reject(err) : resolve());
    }),
  };
}

function safeJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}

module.exports = { createCollector, decodeBody };
