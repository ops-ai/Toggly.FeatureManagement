import {createServer} from 'node:http';
import {gunzipSync} from 'node:zlib';

const definitions = {
  DirectOn: true,
  DirectOff: false,
  SkippedOn: true,
  LocalOn: true,
  OrderGate: {requirement: 'all', rules: [{property: 'Total', op: 'gt', value: '10', type: 'number'}]},
};
const server = createServer((request, response) => {
  process.stdout.write(`${request.method} ${request.url}\n`);
  if (request.method === 'GET' && request.url?.startsWith('/evaluated-signed/')) {
    response.writeHead(200, {'Content-Type': 'application/json'});
    response.end(JSON.stringify({defs: definitions}));
    return;
  }
  if (request.method !== 'POST' || request.url !== '/api/frontend/telemetry') {
    response.writeHead(404).end();
    return;
  }
  const chunks = [];
  request.on('data', chunk => chunks.push(chunk));
  request.on('end', () => {
    try {
      const bytes = Buffer.concat(chunks);
      const body = request.headers['content-encoding'] === 'gzip' ? gunzipSync(bytes) : bytes;
      const packet = JSON.parse(body.toString('utf8'));
      const forbidden = ['origin', 'authorization', 'cookie', 'x-toggly-identity'].filter(key => request.headers[key]);
      const record = {packet, contentEncoding: request.headers['content-encoding'] ?? 'plain', forbiddenHeaders: forbidden};
      process.stdout.write(`${JSON.stringify(record)}\n`);
      response.writeHead(202, {'Content-Type': 'application/json'});
      response.end('{"ok":1}');
    } catch (error) {
      response.writeHead(400).end(String(error));
    }
  });
});
server.listen(8765, '127.0.0.1', () => process.stdout.write('Collector on http://127.0.0.1:8765\n'));
