// Test-only loopback servers. Request data never selects a filesystem operation.
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

function loadAssets(publishedRoot) {
  const assets = new Map();
  const root = path.resolve(publishedRoot);
  function visit(directory, prefix) {
    const info = fs.lstatSync(directory);
    if (info.isSymbolicLink())
      throw new Error("Published assets cannot contain a symbolic link");
    if (!info.isDirectory())
      throw new Error("Published asset root must be a directory");
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      const name = prefix + "/" + entry.name;
      if (entry.isSymbolicLink())
        throw new Error("Published assets cannot contain a symbolic link");
      if (entry.isDirectory()) visit(file, name);
      else if (entry.isFile()) {
        const types = {
          ".wasm": "application/wasm",
          ".js": "text/javascript",
          ".json": "application/json",
          ".html": "text/html",
          ".dll": "application/octet-stream",
        };
        assets.set(name, {
          bytes: fs.readFileSync(file),
          type: types[path.extname(entry.name)] || "application/octet-stream",
        });
      }
    }
  }
  visit(root, "");
  if (!assets.has("/index.html"))
    throw new Error("Published assets must contain index.html");
  return assets;
}

function createAssetHandler(assets) {
  return (req, res) => {
    let name;
    try {
      const target = req.url || "";
      if (!target.startsWith("/") || target.startsWith("//"))
        throw new Error("Invalid request target");
      name = decodeURIComponent(target.split("?")[0]);
      if (
        name.includes("\\") ||
        name.includes("\0") ||
        name.includes("#") ||
        name.split("/").some((part) => part === "." || part === "..")
      )
        throw new Error("Invalid asset path");
    } catch {
      res.writeHead(404).end();
      return;
    }
    const asset = assets.get(name === "/" ? "/index.html" : name);
    if (!asset || !["GET", "HEAD"].includes(req.method)) {
      res.writeHead(404).end();
      return;
    }
    res.setHeader("Content-Type", asset.type);
    res.end(req.method === "HEAD" ? undefined : asset.bytes);
  };
}

function createCollectorHandler(expectedOrigin, packets, preflights) {
  return (req, res) => {
    if (req.headers.origin !== expectedOrigin) {
      res.writeHead(403).end();
      return;
    }
    if (
      req.url !== "/base/api/frontend/telemetry" ||
      !["POST", "OPTIONS"].includes(req.method)
    ) {
      res.writeHead(404).end();
      return;
    }
    res.setHeader("Access-Control-Allow-Origin", expectedOrigin);
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "content-type, content-encoding",
    );
    if (req.method === "OPTIONS") {
      preflights.push(req.headers);
      res.writeHead(204).end();
      return;
    }
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks);
        const plain =
          req.headers["content-encoding"] === "gzip"
            ? zlib.gunzipSync(raw)
            : raw;
        packets.push({
          headers: req.headers,
          body: JSON.parse(plain),
          bytes: plain.length,
          url: req.url,
        });
        res.writeHead(202).end();
      } catch {
        // A malformed test request must fail locally without terminating the host.
        res.writeHead(400).end();
      }
    });
  };
}
module.exports = { loadAssets, createAssetHandler, createCollectorHandler };
