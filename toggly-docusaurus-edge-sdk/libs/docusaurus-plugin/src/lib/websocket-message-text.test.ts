import { describe, expect, it } from 'vitest';
import { websocketMessageText } from './websocket-message-text.mjs';

describe('websocketMessageText', () => {
  it('returns string payloads unchanged', () => {
    expect(websocketMessageText('{"type":"ping"}')).toBe('{"type":"ping"}');
  });

  it('decodes a Buffer as utf8', () => {
    expect(websocketMessageText(Buffer.from('{"type":"sync"}', 'utf8'))).toBe('{"type":"sync"}');
  });

  it('decodes an ArrayBuffer as utf8', () => {
    const bytes = new TextEncoder().encode('{"type":"evaluated"}');
    const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    expect(websocketMessageText(copy)).toBe('{"type":"evaluated"}');
  });

  it('decodes a list of Buffer frames as utf8', () => {
    const frames = [Buffer.from('{"type":', 'utf8'), Buffer.from('"definitions"}', 'utf8')];
    expect(websocketMessageText(frames)).toBe('{"type":"definitions"}');
  });

  it('rejects a payload that is not text or bytes', () => {
    expect(() => websocketMessageText({ type: 'sync' })).toThrow('Unexpected WebSocket message payload');
  });
});
