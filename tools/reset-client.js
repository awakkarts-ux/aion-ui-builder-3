'use strict';
/**
 * Полный сброс клиента к штатному виду — то же, что кнопка «Сбросить всё»
 * в программе, только из консоли.
 *
 *   node tools/reset-client.js            — показать, что будет сделано
 *   node tools/reset-client.js --apply    — сделать
 *   node tools/reset-client.js --undo     — вернуть убранное из карантина
 */

const os = require('os');
const path = require('path');
const { Client } = require('../src/core/client');
const reset = require('../src/core/reset');

const arg = (name, def) => {
  const hit = process.argv.find((a) => a.startsWith('--' + name + '='));
  return hit ? hit.slice(name.length + 3) : def;
};

const root = arg('client', 'G:\\Aion Empire\\classic');
const appDir = path.join(process.env.APPDATA || os.homedir(), 'aion-ui-builder');
const client = new Client(root, path.join(appDir, 'backup'));
const quarantine = path.join(appDir, 'removed');

if (process.argv.includes('--undo')) {
  const back = reset.undo(client, quarantine);
  console.log(back.length ? 'вернул:\n  ' + back.join('\n  ') : 'карантин пуст');
  process.exit(0);
}

const p = reset.plan(client, quarantine);
console.log('=== вернуть из резервных копий ===');
console.log(p.restore.length ? p.restore.map((r) => '  ' + r.rel).join('\n') : '  нечего, всё штатное');
console.log('\n=== убрать в карантин ===');
console.log(p.extra.length
  ? p.extra.map((e) => `  ${e.rel.padEnd(40)} ${(e.size / 1024).toFixed(0)} КБ  — ${e.why}`).join('\n')
  : '  нечего');

if (!process.argv.includes('--apply')) {
  console.log('\nэто предварительный показ. чтобы сделать: node tools/reset-client.js --apply');
  process.exit(0);
}

const done = reset.run(client, quarantine);
for (const r of done.restored) console.log('вернул ' + r);
for (const r of done.removed) console.log('убрал  ' + r);
console.log('\nготово. вернуть убранное: node tools/reset-client.js --undo');
