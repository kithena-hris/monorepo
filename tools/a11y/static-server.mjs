/**
 * A static file server in Node's own standard library.
 *
 * `http-server` would do this, but it has to resolve through npx or a
 * workspace bin, and that resolution is exactly what failed when this was a
 * shell one-liner. Nothing here needs installing.
 *
 * Only ever serves the directory it is given, and only ever reads. Requests are
 * resolved and then checked to still be inside the root, so `..` in a URL
 * cannot walk out of it.
 */

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';

const root = resolve(process.argv[2] ?? '.');
const port = Number(process.argv[3] ?? 6123);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.map': 'application/json; charset=utf-8',
};

createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://localhost');
  const requested = decodeURIComponent(url.pathname);
  const candidate = resolve(join(root, normalize(requested)));

  // Containment check. A path that does not start with the root plus a
  // separator is outside it, whatever the URL claimed.
  if (candidate !== root && !candidate.startsWith(root + sep)) {
    response.writeHead(403).end('Forbidden');
    return;
  }

  void (async () => {
    let file = candidate;
    try {
      const info = await stat(file);
      if (info.isDirectory()) file = join(file, 'index.html');
      await stat(file);
    } catch {
      response.writeHead(404).end('Not found');
      return;
    }

    response.writeHead(200, {
      'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
      // No caching: this exists to serve a build that is being rebuilt.
      'cache-control': 'no-store',
    });
    createReadStream(file).pipe(response);
  })();
}).listen(port);
