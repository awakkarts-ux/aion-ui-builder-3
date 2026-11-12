'use strict';
/**
 * Цифры урона из конструктора на КОПИИ клиента: подготовленные окном картинки
 * ложатся в оба пака (hit_number.pak и l10n textures.pak) родного размера
 * (или крупнее в пропорциях родной — размер выше 110%),
 * соседние записи не трогаются, «вернуть родные» возвращает паки байт в байт.
 * Картинки рисует окно (canvas), поэтому на вход — профиль с уже
 * подготовленными файлами:
 *
 *   node tools/roundtrip-hitnum.js <profile.json> ["G:\Aion Empire\classic"] [резерв]
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const pak = require('../src/core/pak');
const dds = require('../src/core/dds');
const { Client } = require('../src/core/client');
const build = require('../src/core/build');

const profile = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const src = process.argv[3] || 'G:\\Aion Empire\\classic';
const appBackup = process.argv[4] ||
  path.join(process.env.APPDATA || os.homedir(), 'aion-ui-builder', 'backup');
const pristine = (rel) => {
  const bak = path.join(appBackup, rel.split('/').join('__'));
  return fs.existsSync(bak) ? bak : path.join(src, rel.replace(/\//g, path.sep));
};

const RELS = ['textures/ui/hit_number/hit_number.pak', 'l10n/rus/textures/textures.pak'];
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'aionui-hitnum-'));
for (const rel of ['bin64/crysystem.dll', ...RELS]) {
  const to = path.join(sandbox, rel.replace(/\//g, path.sep));
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(pristine(rel), to);
}
const client = new Client(sandbox, path.join(sandbox, '_backup'));
const checks = [];
const check = (name, ok, extra) => checks.push([name, !!ok, extra]);

const wanted = profile.packs.hitnum || {};
const keys = Object.keys(wanted);
check('в профиле есть подготовленные картинки', keys.length > 100, keys.length);
const run = { layout: {}, font: { enabled: false }, packs: { hitnum: wanted }, skins: {}, lang: 'rus' };
const log = [];
build.apply(client, run, (m) => log.push(m));

const byRel = new Map();
for (const k of keys) {
  const cut = k.indexOf('|');
  const rel = k.slice(0, cut);
  if (!byRel.has(rel)) byRel.set(rel, []);
  byRel.get(rel).push(k.slice(cut + 1));
}
let same = 0, sized = 0, total = 0;
for (const [rel, names] of byRel) {
  const now = pak.readSome(client.abs(rel), client.dll, names);
  const before = pak.readSome(pristine(rel), client.dll, names);
  for (const n of names) {
    total++;
    const staged = fs.readFileSync(wanted[rel + '|' + n]);
    if (now.get(n) && now.get(n).equals(staged)) same++;
    const a = dds.toRgba(now.get(n));
    const b = dds.toRgba(before.get(n));
    // крупнее 110% конструктор растит картинку — в пропорциях родной
    const k = a.width / b.width;
    if (k >= 1 && Math.abs(a.height - b.height * k) <= 1) sized++;
  }
}
check('все картинки легли в паки как подготовлены', same === total, `${same}/${total}`);
check('размер каждой — родной или крупнее в её пропорциях', sized === total, `${sized}/${total}`);
check('записаны оба пака: общий и переведённый', RELS.every((r) => byRel.has(r)), [...byRel.keys()].join(', '));

// соседи в переведённом паке (не цифры) не тронуты
const l10n = 'l10n/rus/textures/textures.pak';
const other = pak.listPak(client.abs(l10n)).entries.map((e) => e.name)
  .filter((n) => !/hit_number/i.test(n)).slice(0, 40);
const x = pak.readSome(client.abs(l10n), client.dll, other);
const y = pak.readSome(pristine(l10n), client.dll, other);
// пустые записи readSome не отдаёт — у обоих паков их нет одинаково
check('прочие картинки переведённого пака не тронуты',
  other.every((n) => (!x.get(n) && !y.get(n)) || (x.get(n) && y.get(n) && x.get(n).equals(y.get(n)))), other.length);

run.packs.hitnum = {};
const log2 = [];
build.apply(client, run, (m) => log2.push(m));
check('«вернуть родные» — паки штатные байт в байт',
  RELS.every((r) => fs.readFileSync(client.abs(r)).equals(fs.readFileSync(pristine(r)))), log2.join(' / '));

fs.rmSync(sandbox, { recursive: true, force: true });
let bad = 0;
for (const [name, ok, extra] of checks) {
  if (!ok) bad++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${extra !== undefined ? '  ' + extra : ''}`);
}
console.log(bad ? `провалено: ${bad}` : 'цифры урона проверены');
process.exit(bad ? 1 : 0);
