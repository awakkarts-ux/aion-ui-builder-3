'use strict';
/**
 * Журнал ошибок программы (17.11.2026). Всё, что падает — вызовы окна в
 * главный процесс, ошибки в самом окне, красные всплывающие сообщения, сбои
 * сборки, — дописывается в userData/logs/errors.log со временем и стеком.
 * Плюс журнал последней сборки — logs/last-build.log. Оба попадают в
 * «Выгрузку для дизайна», чтобы причину было видно без скриншотов.
 */

const fs = require('fs');
const path = require('path');

const MAX = 1024 * 1024; // больше — старое уходит в errors.old.log

let dir = '';
let version = '';

function init(logDir, appVersion) {
  dir = logDir;
  version = appVersion || '';
}

const file = (name) => path.join(dir, name);

function write(source, what, err) {
  if (!dir) return;
  try {
    fs.mkdirSync(dir, { recursive: true });
    const f = file('errors.log');
    if (fs.existsSync(f) && fs.statSync(f).size > MAX) fs.renameSync(f, file('errors.old.log'));
    const msg = err && err.message ? err.message : String(err);
    const stack = err && err.stack ? '\n  ' + String(err.stack).split('\n').slice(1, 8).map((s) => s.trim()).join('\n  ') : '';
    fs.appendFileSync(f, `[${new Date().toISOString()}] v${version} ${source}${what ? ' ' + what : ''}: ${msg}${stack}\n`);
  } catch (e) { /* журнал не должен ронять программу */ }
}

function saveBuild(lines, error) {
  if (!dir) return;
  try {
    fs.mkdirSync(dir, { recursive: true });
    const head = `[${new Date().toISOString()}] v${version} сборка ${error ? 'НЕ УДАЛАСЬ: ' + (error.message || error) : 'прошла'}\n`;
    fs.writeFileSync(file('last-build.log'), head + (lines || []).join('\n') + '\n');
  } catch (e) { /* то же */ }
}

/** Файлы журнала для выгрузки: имя -> содержимое. */
function files() {
  const out = new Map();
  if (!dir) return out;
  for (const n of ['errors.log', 'errors.old.log', 'last-build.log']) {
    try { if (fs.existsSync(file(n))) out.set(n, fs.readFileSync(file(n))); } catch (e) { /* пропуск */ }
  }
  return out;
}

module.exports = { init, write, saveBuild, files };
