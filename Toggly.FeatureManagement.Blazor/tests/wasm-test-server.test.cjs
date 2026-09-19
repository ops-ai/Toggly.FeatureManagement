const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const {
  loadAssets,
  createAssetHandler,
  createCollectorHandler,
} = require("./wasm-test-server.cjs");

const listen = (server) =>
  new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const close = (server) => new Promise((resolve) => server.close(resolve));
const request = (server, target, options = {}) =>
  new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: server.address().port,
        path: target,
        ...options,
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString(),
          }),
        );
      },
    );
    req.on("error", reject);
    req.end(options.body);
  });

test("host serves only startup assets and rejects malformed/traversal targets without filesystem access", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "wasm-assets-"));
  fs.writeFileSync(path.join(directory, "index.html"), "trusted index");
  fs.writeFileSync(path.join(directory, "app.wasm"), "wasm");
  const handler = createAssetHandler(loadAssets(directory));
  fs.writeFileSync(path.join(directory, "later-secret.txt"), "never served");
  fs.writeFileSync(path.join(directory, "index.html"), "changed after startup");
  const server = http.createServer(handler);
  try {
    await listen(server);
    assert.equal((await request(server, "/")).body, "trusted index");
    assert.equal(
      (await request(server, "/app.wasm?v=1")).headers["content-type"],
      "application/wasm",
    );
    for (const target of [
      "/../index.html",
      "/%2e%2e/index.html",
      "/%2e/index.html",
      "/%2e%2e%5cindex.html",
      "/%ZZ",
      "/%00",
      "//other.test/index.html",
      "http://other.test/index.html",
      "/later-secret.txt",
    ]) {
      assert.equal((await request(server, target)).status, 404, target);
    }
  } finally {
    await close(server);
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("asset scan rejects root and nested symlinks", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "wasm-symlink-"));
  try {
    const root = path.join(directory, "wwwroot");
    fs.mkdirSync(root);
    fs.writeFileSync(path.join(root, "index.html"), "index");
    const link = path.join(directory, "linked-root");
    fs.symlinkSync(root, link, "dir");
    assert.throws(() => loadAssets(link), /symbolic link/i);
    fs.symlinkSync(path.join(root, "index.html"), path.join(root, "leak.html"));
    assert.throws(() => loadAssets(root), /symbolic link/i);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("collector permits only its fixed host origin and telemetry route", async () => {
  const origin = "http://127.0.0.1:12345";
  const packets = [],
    preflights = [];
  const server = http.createServer(
    createCollectorHandler(origin, packets, preflights),
  );
  try {
    await listen(server);
    for (const method of ["OPTIONS", "POST"]) {
      for (const wrong of [
        "http://evil.test",
        "http://127.0.0.1:12346",
        "null",
      ]) {
        const denied = await request(server, "/base/api/frontend/telemetry", {
          method,
          headers: { Origin: wrong },
        });
        assert.equal(denied.status, 403);
        assert.equal(denied.headers["access-control-allow-origin"], undefined);
      }
    }
    assert.equal(
      (
        await request(server, "/base/api/frontend/telemetry", {
          method: "POST",
        })
      ).status,
      403,
    );
    const allowed = await request(server, "/base/api/frontend/telemetry", {
      method: "OPTIONS",
      headers: { Origin: origin },
    });
    assert.equal(allowed.status, 204);
    assert.equal(allowed.headers["access-control-allow-origin"], origin);
    assert.equal(
      (
        await request(server, "/other", {
          method: "POST",
          headers: { Origin: origin },
        })
      ).status,
      404,
    );
    assert.equal(
      (
        await request(server, "/base/api/frontend/telemetry", {
          method: "POST",
          headers: { Origin: origin },
          body: "{}",
        })
      ).status,
      202,
    );
    assert.equal(packets.length, 1);
    assert.equal(preflights.length, 1);
  } finally {
    await close(server);
  }
});
