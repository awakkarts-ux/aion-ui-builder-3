'use strict';
/**
 * Статический сервер для просмотра окна сборщика в обычном браузере,
 * без Electron. Данные подставляет src/ui/mock.js.
 *
 *   node tools/serve.js 5174
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const port = Number(process.argv[2] || 5174);
const root = path.join(__dirname, '..', 'src', 'ui');
const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
};

http
  .createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]);
    const file = path.join(root, rel === '/' ? 'index.html' : rel);
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404).end('нет такого файла');
      return;
    }
    let body = fs.readFileSync(file);
    // В браузере нет preload — дотягиваем заглушку перед основным скриптом.
    if (file.endsWith('index.html')) {
      body = Buffer.from(
        body.toString('utf8').replace('<script src="app.js">', '<script src="mock.js"></script>\n  <script src="app.js">')
      );
    }
    res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' });
    res.end(body);
  })
  .listen(port, () => console.log('открой http://localhost:' + port));
