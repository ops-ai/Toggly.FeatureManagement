import WebSocket from 'ws';

const appKey = process.env.TOGGLY_SMOKE_APP_KEY_FRONTEND;

if (!appKey) {
  process.exit(0);
}

const ws = new WebSocket(`wss://definitions.toggly.io/${appKey}/ws`);

const timeout = setTimeout(() => {
  ws.close();
  throw new Error('WebSocket timed out after 10 seconds');
}, 10_000);

ws.on('message', (data) => {
  clearTimeout(timeout);
  const parsed = JSON.parse(data.toString());
  if (!parsed.type) {
    throw new Error(`Missing type field in message: ${data}`);
  }
  if (parsed.type !== 'definitions' && parsed.type !== 'evaluated') {
    throw new Error(`Expected type=definitions or evaluated, received ${parsed.type}`);
  }
  if (!parsed.timestamp) {
    throw new Error('Missing timestamp in message');
  }
  ws.close();
});

ws.on('error', (err) => {
  clearTimeout(timeout);
  throw err;
});
