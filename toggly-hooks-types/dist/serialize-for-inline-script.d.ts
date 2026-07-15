/**
 * Serialize a value as JSON safe for embedding inside an inline `<script>` tag.
 *
 * `JSON.stringify` does not escape the `</script` sequence. Without this
 * replacement, attacker-influenced strings (e.g. identity, flag keys) can
 * break out of the script element. Matches the Cloudflare edge rewriter.
 */
export declare function serializeJsonForInlineScript(value: unknown): string;
