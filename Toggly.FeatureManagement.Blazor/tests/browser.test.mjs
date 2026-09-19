import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
globalThis.crypto ??= webcrypto;
const { verify, load, save } = await import(
  "../src/Toggly.FeatureManagement.Blazor/wwwroot/toggly.js"
);
const fixture = JSON.parse(
  readFileSync(new URL("./webcrypto-fixture.json", import.meta.url)),
);
test("independent canonical Worker double-hash P1363 fixture validates exact bytes", async () => {
  const { defs, timestamp, signature, kid, jwks } = fixture;
  assert.equal(
    await verify(defs, timestamp, signature, kid, JSON.stringify(jwks)),
    true,
  );
  for (const args of [
    [defs + " ", timestamp, signature, kid, jwks],
    [defs, timestamp + 1, signature, kid, jwks],
    [defs, timestamp, signature, "bad", jwks],
    [defs, timestamp, signature, kid, { keys: [...jwks.keys, ...jwks.keys] }],
    [defs, timestamp, "invalid", kid, jwks],
    [defs, timestamp, signature, kid, { keys: [] }],
    [
      defs,
      timestamp,
      signature,
      kid,
      { keys: [{ ...jwks.keys[0], alg: "RS256" }] },
    ],
    [defs, timestamp, signature, kid, { keys: [{ ...jwks.keys[0], x: "AA" }] }],
  ]) {
    assert.equal(
      await verify(...args.slice(0, 4), JSON.stringify(args[4])),
      false,
    );
  }
  assert.equal(await verify(defs, timestamp, signature, kid, "{"), false);
  const trailing = Buffer.concat([
    Buffer.from(signature, "base64"),
    Buffer.from([0]),
  ]).toString("base64");
  assert.equal(
    await verify(defs, timestamp, trailing, kid, JSON.stringify(jwks)),
    false,
  );
  assert.equal(
    await verify(
      defs,
      timestamp,
      Buffer.from([0x30, 0x46, 0x02, 0x20]).toString("base64"),
      kid,
      JSON.stringify(jwks),
    ),
    false,
  );
});
test("durable storage is scoped and unavailable storage degrades safely", () => {
  const values = new Map();
  globalThis.localStorage = {
    getItem: (k) => values.get(k) ?? null,
    setItem: (k, v) => values.set(k, v),
  };
  assert.equal(load("alice"), null);
  save("alice", { contextKey: "alice", envelope: "signed", revision: "1" });
  globalThis.sessionStorage = {
    getItem() {
      throw new Error("Session storage must not be used.");
    },
    setItem() {
      throw new Error("Session storage must not be used.");
    },
  };
  assert.equal(load("alice").envelope, "signed");
  assert.equal(load("bob"), null);
  values.set("toggly:alice", "{");
  assert.equal(load("alice"), null);
  globalThis.localStorage = {
    getItem() {
      throw Error("blocked");
    },
    setItem() {
      throw Error("quota");
    },
  };
  assert.equal(load("alice"), null);
  assert.doesNotThrow(() => save("alice", {}));
});

test("telemetry transport omits credentials and bounds failures without replay", async () => {
  const { sendTelemetry, abortTelemetry } = await import("../src/Toggly.FeatureManagement.Blazor/wwwroot/toggly.js");
  const originalFetch = globalThis.fetch, originalSet = globalThis.setTimeout, originalClear = globalThis.clearTimeout;
  let timeout, cleared = 0; const requests = [];
  globalThis.setTimeout = (callback, ms) => { assert.equal(ms, 5000); timeout = callback; return 7; };
  globalThis.clearTimeout = (timer) => { assert.equal(timer, 7); cleared++; };
  try {
    globalThis.fetch = async (url, options) => { requests.push({url, ...options}); return { status: 503, headers: { get: () => "30" } }; };
    assert.deepEqual(await sendTelemetry("https://collector.test/api/frontend/telemetry", new Uint8Array([1]), true, false), { statusCode: 503, retryAfter: "30" });
    assert.equal(requests[0].credentials, "omit"); assert.equal(requests[0].redirect, "error");
    assert.deepEqual(Object.keys(requests[0].headers).sort(), ["Content-Encoding", "Content-Type"]);
    await sendTelemetry("https://collector.test/api/frontend/telemetry", new Uint8Array([2]), false, true);
    assert.equal(requests[1].keepalive, true); assert.equal(requests[1].headers["Content-Encoding"], undefined);
    globalThis.fetch = async (_, options) => { timeout(); assert.equal(options.signal.aborted, true); throw Error("ambiguous"); };
    await assert.rejects(sendTelemetry("https://collector.test", new Uint8Array(), false, false, "timed"));
    abortTelemetry("finished");
    globalThis.fetch = async (_, options) => { abortTelemetry("cancel"); assert.equal(options.signal.aborted, true); throw Error("cancelled"); };
    await assert.rejects(sendTelemetry("https://collector.test", new Uint8Array(), false, false, "cancel"));
    assert.equal(requests.length, 2); assert.equal(cleared, 4);
  } finally { globalThis.fetch = originalFetch; globalThis.setTimeout = originalSet; globalThis.clearTimeout = originalClear; }
});

test("telemetry lifecycle belongs to one owner and detaches on disposal", async () => {
  const { attachTelemetry } = await import("../src/Toggly.FeatureManagement.Blazor/wwwroot/toggly.js");
  const events = new Map(), calls = [];
  const target = { addEventListener: (name, fn) => events.set(name, fn), removeEventListener: (name, fn) => { assert.equal(events.get(name), fn); events.delete(name); } };
  globalThis.document = { ...target, visibilityState: "visible" }; globalThis.window = target;
  const listener = attachTelemetry({ invokeMethodAsync: async (...args) => { calls.push(args); if (calls.length === 2) throw Error("teardown"); } });
  events.get("visibilitychange")(); await Promise.resolve(); assert.equal(calls.length, 0);
  document.visibilityState = "hidden"; events.get("visibilitychange")(); events.get("pagehide")();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, [["FlushTelemetry", false], ["FlushTelemetry", true]]);
  listener.dispose(); assert.equal(events.size, 0); delete globalThis.document; delete globalThis.window;
});
