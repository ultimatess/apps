// Tiny static file server for local testing (node scripts/serve.mjs [port]).
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json", ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon",
};

export function serve({ port = 0, root = ROOT } = {}) {
  const server = createServer(async (req, res) => {
    try {
      let path = decodeURIComponent(new URL(req.url, "http://x").pathname);
      if (path.endsWith("/")) path += "index.html";
      const file = normalize(join(root, path));
      if (!file.startsWith(root)) throw Object.assign(new Error("forbidden"), { code: 403 });
      const s = await stat(file);
      if (s.isDirectory()) { res.writeHead(301, { Location: `${path}/` }); return res.end(); }
      res.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream", "Cache-Control": "no-store" });
      res.end(await readFile(file));
    } catch (e) {
      res.writeHead(e.code === 403 ? 403 : 404, { "Content-Type": "text/plain" });
      res.end("not found");
    }
  });
  return new Promise((r) => server.listen(port, "127.0.0.1", () => r({ server, port: server.address().port, close: () => server.close() })));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { port } = await serve({ port: Number(process.argv[2] ?? 8080) });
  console.log(`NightFury v3 → http://127.0.0.1:${port}/`);
}
