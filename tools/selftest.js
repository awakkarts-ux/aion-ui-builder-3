'use strict';
/**
 * Самопроверка ядра на настоящем клиенте:
 *   1. все .pak из data/ui распаковываются;
 *   2. каждый бинарный XML разбирается без остатка;
 *   3. пересборка XML даёт дерево, идентичное исходному;
 *   4. запись своего .pak и чтение его обратно ничего не теряют.
 *
 *   node tools/selftest.js ["G:\Aion Empire\classic"]
 */

const fs = require('fs');
const path = require('path');
const pak = require('../src/core/pak');
const bxml = require('../src/core/bxml');

const client = process.argv[2] || 'G:\\Aion Empire\\classic';
const dll = path.join(client, 'bin64', 'crysystem.dll');

function sameTree(a, b, trail) {
  if (a.name !== b.name) throw new Error(trail + ': имя ' + a.name + ' != ' + b.name);
  if (a.text !== b.text) throw new Error(trail + ': текст разошёлся');
  if (a.attrs.size !== b.attrs.size) throw new Error(trail + ': число атрибутов');
  for (const [k, v] of a.attrs) {
    if (b.attrs.get(k) !== v) throw new Error(trail + ': атрибут ' + k);
  }
  if (a.kids.length !== b.kids.length) throw new Error(trail + ': число детей');
  a.kids.forEach((k, i) => sameTree(k, b.kids[i], trail + '/' + k.name));
}

const paks = [
  'data/ui/ui.pak',
  'data/ui/game/game.pak',
  'data/ui/game_hud_s1/game_hud_s1.pak',
  'data/ui/game_hud_s2/game_hud_s2.pak',
  'data/ui/preload/preload.pak',
];

let files = 0;
let trees = 0;
let bytesEqual = 0;
const problems = [];

for (const rel of paks) {
  const p = path.join(client, rel.replace(/\//g, path.sep));
  if (!fs.existsSync(p)) { problems.push('нет ' + rel); continue; }
  const t0 = Date.now();
  const entries = pak.readPak(p, dll);
  files += entries.size;
  let n = 0;
  for (const [name, data] of entries) {
    if (data.length < 4 || data[0] !== 0x80) continue;
    n++;
    try {
      const { root, strings } = bxml.parse(data);
      const again = bxml.serialize(root, strings);
      sameTree(root, bxml.parse(again).root, name);
      if (again.equals(data)) bytesEqual++;
      trees++;
    } catch (e) {
      problems.push(rel + ' / ' + name + ': ' + e.message);
    }
  }
  console.log(
    `${rel.padEnd(36)} записей ${String(entries.size).padStart(4)}  ` +
      `бинарных XML ${String(n).padStart(4)}  ${Date.now() - t0} мс`
  );
}

// запись своего пака и чтение обратно, в обоих форматах
const tmp = path.join(require('os').tmpdir(), 'aion-ui-builder-test.pak');
const sample = new Map([
  ['a.txt', Buffer.from('привет', 'utf8')],
  ['sub/b.bin', Buffer.from(Array.from({ length: 5000 }, (_, i) => i & 0xff))],
  ['tiny', Buffer.from([1])],
]);
for (const mode of [{}, { encrypt: true, dllPath: dll }]) {
  pak.writePak(tmp, sample, mode);
  const back = pak.readPak(tmp, dll);
  const tag = mode.encrypt ? 'шифрованный' : 'обычный';
  for (const [k, v] of sample) {
    if (!back.has(k) || !back.get(k).equals(v)) problems.push(`запись пака (${tag}): потеряно ${k}`);
  }
  console.log(`запись пака (${tag}): ${back.size} записей прочитано обратно`);
}
fs.unlinkSync(tmp);

console.log('');
console.log(`записей всего: ${files}`);
console.log(`разобрано деревьев: ${trees}, из них байт-в-байт: ${bytesEqual}`);
console.log(problems.length ? 'ПРОБЛЕМЫ:\n  ' + problems.join('\n  ') : 'проблем нет');
process.exit(problems.length ? 1 : 0);
