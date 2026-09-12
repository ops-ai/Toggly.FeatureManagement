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
