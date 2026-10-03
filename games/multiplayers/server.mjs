import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon'
};

export function createServer() {
  return http.createServer(handleRequest);
}

function handleRequest(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Parse URL pathname
  let reqPath = new URL(req.url, `http://${req.headers.host}`).pathname;

  if (reqPath === '/api/info' || reqPath === '/games/multiplayers/api/info') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    const ips = getLocalIPs();
    res.end(JSON.stringify({ localIp: ips[0] || 'localhost', port: req.socket.localPort || PORT }));
    return;
  }

  if (reqPath.startsWith('/games/multiplayers')) {
    reqPath = reqPath.replace(/^\/games\/multiplayers/, '') || '/';
  }

  if (reqPath === '/' || reqPath === '') {
    reqPath = '/index.html';
  }

  const filePath = path.join(__dirname, reqPath);

  // Security check: ensure path is within __dirname
  if (filePath !== __dirname && !filePath.startsWith(__dirname + path.sep)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('403 Forbidden');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      // Fallback to index.html for SPA if not an asset
      if (!path.extname(reqPath)) {
        const fallbackPath = path.join(__dirname, 'index.html');
        serveFile(fallbackPath, res);
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end(`404 Not Found: ${reqPath}`);
      }
      return;
    }

    serveFile(filePath, res);
  });
}

function serveFile(filePath, res) {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end(`Server Error: ${err.message}`);
      return;
    }

    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  });
}

function getLocalIPs() {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        addresses.push(iface.address);
      }
    }
  }
  return addresses;
}

/** Start the server; resolves with the bound port (use port 0 for a random free port). */
export function startServer(port = PORT, host = '0.0.0.0') {
  const server = createServer();
  return new Promise((resolve) => {
    server.listen(port, host, () => resolve({ server, port: server.address().port }));
  });
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (isMain) startServer().then(() => {
  const localIPs = getLocalIPs();
  console.log(`\n==================================================`);
  console.log(`🎭 Netplay-Party Server Running!`);
  console.log(`==================================================`);
  console.log(`Local (Host TV / Laptop): http://localhost:${PORT}`);
  localIPs.forEach(ip => {
    console.log(`Mobile Phone (Same Wi-Fi): http://${ip}:${PORT}`);
  });
  console.log(`==================================================\n`);
});
