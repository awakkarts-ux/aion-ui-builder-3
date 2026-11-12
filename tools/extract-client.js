'use strict';
/**
 * Выгрузка интерфейса любого клиента Aion на диск — для разбора, сравнения и
 * работы в Figma. Клиент только читается, ничего в нём не меняется.
 *
 *   node tools/extract-client.js <папка клиента> <куда> [язык]
 *
 * Что получается:
 *   atlases/<имя>.png          все атласы интерфейса целиком
 *   skins/<библиотека>/<имя>.png  каждый скин отдельной картинкой; у
 *                              растягиваемых девять кусков собраны в рамку
 *                              естественного размера
 *   xml/...                    диалоги и библиотеки в читаемом XML
 *   skins.csv                  опись: библиотека, категория, имя, атлас,
 *                              прямоугольники, откуда взят атлас
 *
 * Атласы берутся по полю `texture` у скинов (`textures/ui/v3_common_01` —
 * значит, ищем в паках папки textures/ui) плюс всё, что лежит на верхнем
 * уровне textures/ui и в локализованном textures.pak. Подпапки вроде
 * zonemap/newmap не обходим целиком: там десятки тысяч тайлов карт, это не
 * компоненты интерфейса. Если имя есть в нескольких паках — локализованный
 * сильнее, потом паки-перебивалки, потом ui.pak, как в client.js.
 */

const fs = require('fs');
const path = require('path');
const pak = require('../src/core/pak');
const bxml = require('../src/core/bxml');
const dds = require('../src/core/dds');
const png = require('../src/core/png');
const skins = require('../src/core/skins');

const [clientArg, outArg, langArg] = process.argv.slice(2);
if (!clientArg || !outArg) {
  console.log('node tools/extract-client.js <папка клиента> <куда> [язык]');
  process.exit(1);
}
const ROOT = path.resolve(clientArg);
const OUT = path.resolve(outArg);

/** Путь без учёта регистра: у 4Game `Textures/UI`, у других `textures/ui`. */
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

const l10n = find('l10n');
const lang = langArg || (l10n ? fs.readdirSync(l10n)[0] : null);
console.log('клиент', ROOT, '| язык', lang || '—');

const safe = (s) => String(s).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
const short = (k) => k.toLowerCase().replace(/^.*\//, '').replace(/\.dds$/, '');
const mkdir = (d) => fs.mkdirSync(d, { recursive: true });

const relOf = (p) => path.relative(ROOT, p).replace(/\\/g, '/');

// ---------- скины: сначала опись, по ней понятно, какие атласы нужны --------
function crop(img, r) {
  const W = Math.max(0, r.w), H = Math.max(0, r.h);
  const out = Buffer.alloc(W * H * 4);
  // куски, вылезающие за край атласа (встречаются в штатных описаниях),
  // остаются прозрачными
  for (let y = 0; y < H; y++) {
    const sy = r.y + y;
    if (sy < 0 || sy >= img.height) continue;
    const x0 = Math.max(0, r.x), x1 = Math.min(img.width, r.x + W);
    if (x1 <= x0) continue;
    img.rgba.copy(out, (y * W + (x0 - r.x)) * 4, (sy * img.width + x0) * 4, (sy * img.width + x1) * 4);
  }
  return { width: W, height: H, rgba: out };
}

/** Девять кусков -> одна рамка естественного размера. */
function nine(img, rects) {
  const R = (k) => rects['src_' + k] || { x: 0, y: 0, w: 0, h: 0 };
  const cols = [
    Math.max(R('left_top').w, R('left_middle').w, R('left_bottom').w),
    Math.max(R('middle_top').w, R('middle_middle').w, R('middle_bottom').w),
    Math.max(R('right_top').w, R('right_middle').w, R('right_bottom').w),
  ];
  const rows = [
    Math.max(R('left_top').h, R('middle_top').h, R('right_top').h),
    Math.max(R('left_middle').h, R('middle_middle').h, R('right_middle').h),
    Math.max(R('left_bottom').h, R('middle_bottom').h, R('right_bottom').h),
  ];
  const W = cols[0] + cols[1] + cols[2];
  const H = rows[0] + rows[1] + rows[2];
  if (!W || !H) return null;
  const out = Buffer.alloc(W * H * 4);
  const names = [['left_top', 'middle_top', 'right_top'],
    ['left_middle', 'middle_middle', 'right_middle'],
    ['left_bottom', 'middle_bottom', 'right_bottom']];
  let oy = 0;
  for (let row = 0; row < 3; row++) {
    let ox = 0;
    for (let col = 0; col < 3; col++) {
      const r = rects['src_' + names[row][col]];
      if (r && r.w && r.h) {
        const piece = crop(img, r);
        for (let y = 0; y < piece.height; y++) {
          piece.rgba.copy(out, ((oy + y) * W + ox) * 4, y * piece.width * 4, (y + 1) * piece.width * 4);
        }
      }
      ox += cols[col];
    }
    oy += rows[row];
  }
  return { width: W, height: H, rgba: out };
}

const preloadPak = find('data/ui/preload/preload.pak');
const preload = pak.readPak(preloadPak, dll);

// порядок библиотек — как их грузит клиент, остальные после
const order = [];
const listKey = [...preload.keys()].find((k) => /ui_preload\.xml$/i.test(k));
const uiMain = pak.readPak(find('data/ui/ui.pak'), dll);
const preXml = uiMain.get([...uiMain.keys()].find((k) => /^ui_preload\.xml$/i.test(k)) || listKey);
if (preXml) {
  for (const n of bxml.parse(preXml).root.walk()) {
    if (n.name === 'Preload' && n.attrs.get('name')) order.push(n.attrs.get('name').toLowerCase());
  }
}
const libKeys = [...preload.keys()].filter((k) => /\.xml$/i.test(k)).sort((a, b) => {
  const ia = order.indexOf(short(a).replace(/\.xml$/, '')), ib = order.indexOf(short(b).replace(/\.xml$/, ''));
  return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib) || a.localeCompare(b);
});

const libs = [];
for (const k of libKeys) {
  const lib = k.replace(/\.xml$/i, '');
  try { libs.push({ lib, loaded: order.includes(lib.toLowerCase()), list: skins.list(preload.get(k), lib) }); }
  catch (e) { console.log('  библиотека не разобрана:', k, e.message); }
}

// ---------- атласы --------------------------------------------------------
const atlases = new Map(); // короткое имя -> {data, from}
function addAtlases(file, filter, force) {
  let files;
  try { files = pak.readPak(file, dll); } catch (e) { console.log('  пропуск', relOf(file), e.message); return; }
  for (const [k, d] of files) {
    if (!/\.dds$/i.test(k) || (filter && !filter.test(k))) continue;
    const n = short(k);
    if (force || !atlases.has(n)) atlases.set(n, { data: d, from: relOf(file) + ':' + k });
  }
}
const paksIn = (dir) => (dir && fs.existsSync(dir)
  ? fs.readdirSync(dir).filter((n) => /\.pak$/i.test(n)).map((n) => path.join(dir, n)) : []);

// папки, куда смотрят скины; textures/ui — всегда
const dirs = new Set(['textures/ui']);
for (const { list } of libs) {
  for (const s of list) {
    const t = String(s.texture || '').toLowerCase().replace(/\\/g, '/');
    if (t.includes('/')) dirs.add(t.slice(0, t.lastIndexOf('/')));
  }
}
const locTex = lang && find('l10n/' + lang + '/textures/textures.pak');
if (locTex) addAtlases(locTex, /^ui\/[^/]+\.dds$/i, true);
for (const d of dirs) {
  const abs = find(d);
  const list = paksIn(abs);
  // ui.pak — последним: паки-перебивалки в той же папке сильнее
  list.sort((a, b) => (/[\\/]ui\.pak$/i.test(a) ? 1 : 0) - (/[\\/]ui\.pak$/i.test(b) ? 1 : 0) || a.localeCompare(b));
  for (const p of list) addAtlases(p);
}

mkdir(path.join(OUT, 'atlases'));
const images = new Map(); // короткое имя -> {width, height, rgba}
let bad = 0;
for (const [n, a] of atlases) {
  try {
    const img = dds.toRgba(a.data);
    images.set(n, img);
    fs.writeFileSync(path.join(OUT, 'atlases', safe(n) + '.png'), png.encode(img.width, img.height, img.rgba));
  } catch (e) {
    bad++;
    console.log('  атлас не разобран:', n, e.message);
  }
}
console.log('атласов:', atlases.size, '| папок:', [...dirs].join(', '), bad ? '| не разобрано ' + bad : '');

// ---------- картинки скинов ------------------------------------------------
const csv = ['lib,loaded,category,name,type,atlas,atlas_found,rects,atlas_from'];
const q = (s) => '"' + String(s).replace(/"/g, '""') + '"';
let saved = 0, missing = 0;
for (const { lib, loaded, list } of libs) {
  const dir = path.join(OUT, 'skins', safe(lib));
  mkdir(dir);
  const used = new Set();
  for (const s of list) {
    const img = images.get(s.atlas);
    csv.push([lib, loaded ? 1 : 0, q(s.category), q(s.name), s.type, s.atlas, img ? 1 : 0,
      q(JSON.stringify(s.rects)), q(atlases.has(s.atlas) ? atlases.get(s.atlas).from : '')].join(','));
    if (!img) { missing++; continue; }
    const pic = s.nine ? nine(img, s.rects) : crop(img, s.rects.src_image || Object.values(s.rects)[0]);
    if (!pic || !pic.width || !pic.height) continue;
    let file = safe(s.name);
    while (used.has(file.toLowerCase())) file += '_';
    used.add(file.toLowerCase());
    fs.writeFileSync(path.join(dir, file + '.png'), png.encode(pic.width, pic.height, pic.rgba));
    saved++;
  }
  console.log('  ' + lib.padEnd(20) + (loaded ? 'грузится ' : 'лежит    ') + String(list.length).padStart(5) + ' скинов');
}
fs.writeFileSync(path.join(OUT, 'skins.csv'), '﻿' + csv.join('\n'));
console.log('скинов выгружено:', saved, missing ? '| без атласа: ' + missing : '');

// ---------- XML в читаемом виде ------------------------------------------
function dumpXml(files, prefix, filter) {
  let n = 0;
  for (const [k, d] of files) {
    if (!/\.xml$/i.test(k) || (filter && !filter.test(k))) continue;
    let text;
    try { text = bxml.isBxml(d) ? bxml.parse(d).root.toXml() : d.toString('utf8'); } catch (e) { continue; }
    const file = path.join(OUT, 'xml', prefix, ...k.split('/').map(safe));
    mkdir(path.dirname(file));
    fs.writeFileSync(file, text);
    n++;
  }
  return n;
}
let xmls = dumpXml(preload, 'preload') + dumpXml(uiMain, 'ui');
for (const sub of ['game', 'game_hud_s1', 'game_hud_s2', 'game_hud_s3']) {
  const p = find('data/ui/' + sub + '/' + sub + '.pak');
  if (p) xmls += dumpXml(pak.readPak(p, dll), sub);
}
const locData = lang && find('l10n/' + lang + '/data/data.pak');
if (locData) xmls += dumpXml(pak.readPak(locData, dll), 'l10n_' + lang, /^ui\//i);
console.log('XML:', xmls);
console.log('готово ->', OUT);
