'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const htmlPath = path.join(root, 'src', 'ui', 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');

const requiredIds = [
  'pset', 'pset-btn', 'pset-menu', 'do-restore', 'do-apply',
  'w-min', 'w-max', 'w-close', 'cl-btn', 'home-grid', 'gd-grid',
];

for (const id of requiredIds) {
  const count = (html.match(new RegExp(`id=["']${id}["']`, 'g')) || []).length;
  if (count !== 1) throw new Error(`UI id ${id} встречается ${count} раз`);
}

const buttonOrder = [...html.matchAll(/<button[^>]+id="(w-min|w-max|w-close)"/g)].map((m) => m[1]);
if (buttonOrder.join(',') !== 'w-min,w-max,w-close') {
  throw new Error(`неверный порядок системных кнопок: ${buttonOrder.join(',')}`);
}

for (const file of ['app.css', 'live.css', 'header.css', 'tokens.css', 'app.js', 'navigation.js', 'client.js', 'build-ui.js', 'home.js', 'motion.js', 'presets.js']) {
  if (!fs.existsSync(path.join(root, 'src', 'ui', file))) throw new Error(`нет UI-файла ${file}`);
}

for (const file of ['chevron.svg', 'restore.svg', 'minimize.svg', 'maximize.svg', 'close.svg']) {
  const asset = path.join(root, 'src', 'ui', 'assets', 'figma-header', file);
  if (!fs.existsSync(asset) || fs.statSync(asset).size === 0) throw new Error(`нет ассета ${file}`);
}

console.log('ui selftest passed');
