'use strict';
/**
 * Возврат клиента к штатному виду.
 *
 * Два разных случая:
 *   — пак, который мы правили: у него есть резервная копия, её и кладём назад;
 *   — файл, которого в штатном клиенте не было вовсе (подменённый шрифт,
 *     чужой пак-перебивалка): резерва нет, потому что и возвращать нечего —
 *     такой файл просто убираем.
 *
 * Убранное не удаляется, а переезжает в карантин: скин, который собирали
 * руками, лучше не терять из-за одной кнопки.
 */

const fs = require('fs');
const path = require('path');
const running = require('./running');

/** @returns {{restore: Array, extra: Array}} */
function plan(client, quarantineDir) {
  const restore = client.backups()
    .filter(({ file, rel }) => {
      const live = client.abs(rel);
      return fs.existsSync(live) && fs.statSync(live).size !== fs.statSync(file).size;
    })
    .map(({ rel }) => ({ rel, size: fs.statSync(client.abs(rel)).size }));

  const extra = [];
  const add = (abs, why) => {
    if (!fs.existsSync(abs)) return;
    extra.push({
      rel: path.relative(client.root, abs).replace(/\\/g, '/'),
      size: fs.statSync(abs).size,
      why,
    });
  };

  for (const lang of client.languages()) add(client.fontPakPath(lang), 'подменённый шрифт');

  const texUi = client.abs('textures/ui');
  if (fs.existsSync(texUi)) {
    for (const f of fs.readdirSync(texUi)) {
      // штатный в этой папке один — ui.pak; всё остальное кто-то доложил
      if (/\.pak$/i.test(f) && f.toLowerCase() !== 'ui.pak') {
        add(path.join(texUi, f), 'сторонний пак поверх интерфейса');
      }
    }
  }
  add(client.abs('data/skills/zz_custom_icons.pak'), 'пак иконок ранних версий');

  const inQuarantine = fs.existsSync(quarantineDir) ? fs.readdirSync(quarantineDir).length : 0;
  return { restore, extra, inQuarantine };
}

function run(client, quarantineDir) {
  const p = plan(client, quarantineDir);
  running.assertWritable([
    ...p.restore.map((r) => client.abs(r.rel)),
    ...p.extra.map((e) => client.abs(e.rel)),
  ]);
  for (const r of p.restore) {
    fs.copyFileSync(client.backupPath(r.rel), client.abs(r.rel));
  }
  if (p.extra.length) fs.mkdirSync(quarantineDir, { recursive: true });
  for (const e of p.extra) {
    const abs = client.abs(e.rel);
    fs.copyFileSync(abs, path.join(quarantineDir, e.rel.split('/').join('__')));
    fs.unlinkSync(abs);
  }
  return { restored: p.restore.map((r) => r.rel), removed: p.extra.map((e) => e.rel) };
}

function undo(client, quarantineDir) {
  if (!fs.existsSync(quarantineDir)) return [];
  const back = [];
  for (const f of fs.readdirSync(quarantineDir)) {
    const rel = f.split('__').join('/');
    const to = client.abs(rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(path.join(quarantineDir, f), to);
    fs.unlinkSync(path.join(quarantineDir, f));
    back.push(rel);
  }
  return back;
}

module.exports = { plan, run, undo };
