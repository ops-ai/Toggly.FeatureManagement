export function websocketMessageText(data) {
  if (typeof data === 'string') {
    return data;
  }
  if (Array.isArray(data)) {
    return new TextDecoder().decode(Buffer.concat(data));
  }
  if (data instanceof ArrayBuffer || Buffer.isBuffer(data)) {
    return new TextDecoder().decode(data);
  }
  throw new Error('Unexpected WebSocket message payload');
}
