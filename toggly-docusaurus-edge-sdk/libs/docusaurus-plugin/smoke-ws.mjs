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
  const parsed = JSON.parse(data.toString());
  if (parsed.type === 'ping') return; // skip ping messages
  clearTimeout(timeout);
  if (!parsed.type) {
    throw new Error(`Missing type field in message: ${data}`);
  }
  if (!['sync', 'definitions', 'evaluated'].includes(parsed.type)) {
    throw new Error(`Expected type=sync, definitions, or evaluated, received ${parsed.type}`);
  }
  if (parsed.type === 'sync') {
    if (!parsed.etag) {
      throw new Error('Missing etag in sync message');
    }
    if (!parsed.lastUpdated) {
      throw new Error('Missing lastUpdated in sync message');
    }
  } else if (!parsed.timestamp) {
    throw new Error('Missing timestamp in message');
  }
  ws.close();
});

ws.on('error', (err) => {
  clearTimeout(timeout);
  throw err;
});
