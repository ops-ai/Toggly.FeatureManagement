import { describe, expect, it } from 'vitest';
import { serializeJsonForInlineScript } from './serialize-for-inline-script';

describe('serializeJsonForInlineScript', () => {
  it('escapes </script sequences in string values', () => {
    const json = serializeJsonForInlineScript({
      identity: 'user</script><script>alert(1)',
      flags: { 'evil</script><script>x': true },
    });

    expect(json).not.toMatch(/<\/script/i);
    expect(json).toContain('<\\/script');
  });

  it('preserves normal JSON when no script breakout sequence is present', () => {
    expect(serializeJsonForInlineScript({ flags: { a: true }, n: 1 })).toBe(
      '{"flags":{"a":true},"n":1}'
    );
  });
});
