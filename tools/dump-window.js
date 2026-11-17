'use strict';
/**
 * Дерево виджетов окон интерфейса в текст — для разбора HUD перед редизайном.
 * Клиент только читается.
 *
 *   node tools/dump-window.js <папка клиента> <куда> [окно ...]
 *
 * Без списка окон берутся окна HUD: basic_status_dialog, target_dialog,
 * target_assist_dialog, party_dialog, pet_dialog, exp_bar_dialog, quickbar_dialog.
 * Имя можно давать с .xml или без; часть имени тоже подойдёт (`target`).
 *
 * Что получается в <куда>:
 *   windows/<окно>.xml   читаемый XML окна
 *   windows/<окно>.txt   дерево: тип, имя, все атрибуты; если значение атрибута
 *                        совпадает с именем скина — рядом атлас и прямоугольник
 *   skins-used.csv       скины, встретившиеся в этих окнах (имя, атлас, куски)
 *   atlases/<атлас>.png  только атласы, которые эти окна используют
 */
const fs = require('fs');
const path = require('path');
const pak = require('../src/core/pak');
const bxml = require('../src/core/bxml');
const dds = require('../src/core/dds');
const png = require('../src/core/png');
const skins = require('../src/core/skins');

const [clientArg, outArg, ...want] = process.argv.slice(2);
if (!clientArg || !outArg) {
  console.log('node tools/dump-window.js <папка клиента> <куда> [окно ...]');
  process.exit(1);
}
const ROOT = path.resolve(clientArg);
const OUT = path.resolve(outArg);
const HUD = ['basic_status_dialog', 'target_dialog', 'target_assist_dialog', 'party_dialog',
  'pet_dialog', 'exp_bar_dialog', 'quickbar_dialog'];
const names = (want.length ? want : HUD).map((n) => n.toLowerCase().replace(/\.xml$/, ''));

function find(rel) {
  let cur = ROOT;
  for (const part of rel.split('/')) {
    if (!fs.existsSync(cur)) return null;
    const hit = fs.readdirSync(cur).find((n) => n.toLowerCase() === part.toLowerCase());
    if (!hit) return null;
    cur = path.join(cur, hit);
  }
  return cur;
}
const dll = find('bin64/crysystem.dll');
if (!dll) throw new Error('нет bin64/crysystem.dll — это не клиент Aion');
const safe = (s) => String(s).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
const short = (k) => k.toLowerCase().replace(/^.*\//, '').replace(/\.(xml|dds)$/, '');
const mkdir = (d) => fs.mkdirSync(d, { recursive: true });

// скины: все библиотеки preload.pak, имя -> описание (version4 важнее остальных)
const preload = pak.readPak(find('data/ui/preload/preload.pak'), dll);
const skinByName = new Map();
for (const k of [...preload.keys()].filter((x) => /\.xml$/i.test(x)).sort()) {
  const lib = k.replace(/\.xml$/i, '');
  let list;
  try { list = skins.list(preload.get(k), lib); } catch (e) { continue; }
  for (const s of list) {
    const prev = skinByName.get(s.name);
    if (!prev || /version4/i.test(lib)) skinByName.set(s.name, s);
  }
}

// окна: ищем по всем пакам data/ui/*
const found = new Map(); // имя -> {key, data, from}
const uiDir = find('data/ui');
const paks = [];
(function walk(d, depth) {
  for (const n of fs.readdirSync(d)) {
    const p = path.join(d, n);
    if (fs.statSync(p).isDirectory()) { if (depth < 2) walk(p, depth + 1); }
    else if (/\.pak$/i.test(n)) paks.push(p);
  }
})(uiDir, 0);
const l10n = find('l10n');
if (l10n) for (const lang of fs.readdirSync(l10n)) {
  const p = find('l10n/' + lang + '/data/data.pak');
  if (p) paks.push(p);
}
for (const p of paks) {
  let files;
  try { files = pak.readPak(p, dll); } catch (e) { continue; }
  for (const [k, d] of files) {
    if (!/\.xml$/i.test(k)) continue;
    const n = short(k);
    if (!names.some((w) => n === w || (want.length && n.includes(w)))) continue;
    if (!found.has(n)) found.set(n, { key: k, data: d, from: path.relative(ROOT, p).replace(/\\/g, '/') });
  }
}
for (const w of names) if (![...found.keys()].some((n) => n === w || n.includes(w))) console.log('не найдено:', w);

mkdir(path.join(OUT, 'windows'));
const usedSkins = new Map();
const rect = (r) => r.x + ',' + r.y + ',' + r.w + ',' + r.h;

function describe(node, depth, lines) {
  const pad = '  '.repeat(depth);
  const attrs = [...node.attrs].map(([k, v]) => k + '=' + JSON.stringify(v)).join(' ');
  lines.push(pad + node.name + (attrs ? '  ' + attrs : '') + (node.text ? '  «' + node.text.trim() + '»' : ''));
  for (const [k, v] of node.attrs) {
    const s = skinByName.get(v);
    if (!s) continue;
    usedSkins.set(s.name, s);
    const parts = Object.entries(s.rects).map(([f, r]) => f.replace('src_', '') + ' ' + rect(r)).join('; ');
    lines.push(pad + '    └ ' + k + ' → скин ' + s.name + ' [' + s.atlas + '] ' + parts);
  }
  for (const kid of node.kids) describe(kid, depth + 1, lines);
}

for (const [n, f] of found) {
  const root = bxml.isBxml(f.data) ? bxml.parse(f.data).root : null;
  if (!root) { console.log('не бинарный XML:', n); continue; }
  fs.writeFileSync(path.join(OUT, 'windows', safe(n) + '.xml'), root.toXml());
  const lines = ['# ' + f.key + '  (' + f.from + ')'];
  describe(root, 0, lines);
  fs.writeFileSync(path.join(OUT, 'windows', safe(n) + '.txt'), lines.join('\n') + '\n');
  console.log(n.padEnd(26), lines.length - 1, 'строк |', f.from);
}

// опись и атласы только по использованным скинам
const q = (s) => '"' + String(s).replace(/"/g, '""') + '"';
const csv = ['name,lib,category,atlas,rects'];
for (const s of usedSkins.values()) csv.push([q(s.name), s.lib, q(s.category), s.atlas, q(JSON.stringify(s.rects))].join(','));
fs.writeFileSync(path.join(OUT, 'skins-used.csv'), '﻿' + csv.join('\n'));

const needAtlas = new Set([...usedSkins.values()].map((s) => s.atlas).filter(Boolean));
const atlasDirs = ['textures/ui'];
for (const s of usedSkins.values()) {
  const t = String(s.texture || '').toLowerCase().replace(/\\/g, '/');
  if (t.includes('/')) atlasDirs.push(t.slice(0, t.lastIndexOf('/')));
}
mkdir(path.join(OUT, 'atlases'));
const saved = new Set();
const lang = l10n ? fs.readdirSync(l10n)[0] : null;
const atlasPaks = [];
const loc = lang && find('l10n/' + lang + '/textures/textures.pak');
if (loc) atlasPaks.push(loc);
for (const d of new Set(atlasDirs)) {
  const abs = find(d);
  if (abs) for (const n of fs.readdirSync(abs)) if (/\.pak$/i.test(n)) atlasPaks.push(path.join(abs, n));
}
for (const p of atlasPaks) {
  let files;
  try { files = pak.readPak(p, dll); } catch (e) { continue; }
  for (const [k, d] of files) {
    const n = short(k);
    if (!/\.dds$/i.test(k) || !needAtlas.has(n) || saved.has(n)) continue;
    try {
      const img = dds.toRgba(d);
      fs.writeFileSync(path.join(OUT, 'atlases', safe(n) + '.png'), png.encode(img.width, img.height, img.rgba));
      saved.add(n);
    } catch (e) { console.log('атлас не разобран:', n, e.message); }
  }
}
for (const n of needAtlas) if (!saved.has(n)) console.log('атлас не найден:', n);
console.log('скинов:', usedSkins.size, '| атласов:', saved.size, '| готово ->', OUT);
