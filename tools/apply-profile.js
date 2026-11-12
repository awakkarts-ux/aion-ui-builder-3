'use strict';
/**
 * Применяет сохранённый профиль к клиенту — то же, что кнопка
 * «Собрать и установить», только из консоли. Удобно, когда нужно видеть
 * журнал целиком.
 *
 *   node tools/apply-profile.js
 *   node tools/apply-profile.js --set v5.enabled=true --set font.enabled=false
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { Client } = require('../src/core/client');
const build = require('../src/core/build');

const appDir = path.join(process.env.APPDATA || os.homedir(), 'aion-ui-builder');
const profilePath = path.join(appDir, 'profile.json');
const profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'));

// --set путь.к.полю=значение
for (let i = 0; i < process.argv.length; i++) {
  if (process.argv[i] !== '--set') continue;
  const [where, raw] = process.argv[i + 1].split('=');
  const parts = where.split('.');
  let node = profile;
  for (const p of parts.slice(0, -1)) {
    if (!node[p] || typeof node[p] !== 'object') node[p] = {};
    node = node[p];
  }
  const v = raw === 'true' ? true : raw === 'false' ? false : raw;
  node[parts[parts.length - 1]] = v;
  console.log(`профиль: ${where} = ${v}`);
}

const root = profile.clientRoot ||
  JSON.parse(fs.readFileSync(path.join(appDir, 'config.json'), 'utf8')).clientRoot;
const client = new Client(root, path.join(appDir, 'backup'));

console.log('клиент: ' + root);
console.log('---');
const report = build.apply(client, profile, (m) => console.log('  ' + m));
fs.writeFileSync(profilePath, JSON.stringify(profile, null, 2), 'utf8');
console.log('---');
console.log(`диалогов ${report.dialogs}, файлов ${report.files}, паков: ${report.paks.join(', ')}`);
console.log('игру перезапустить.');
