'use strict';
/**
 * Сборка из импорта официального клиента должна совпасть со сборкой прямо
 * из клиента байт в байт. Собирает копию нашего клиента с донором и
 * печатает отпечатки получившихся файлов — запустить дважды и сравнить:
 *
 *   node tools/import-check.js <донор: клиент или импорт> [профиль.json] [наш клиент] [резерв]
 *
 * Ни игра, ни донор не меняются: всё — во временной папке.
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Client } = require('../src/core/client');
const build = require('../src/core/build');

const donorRoot = process.argv[2];
if (!donorRoot) throw new Error('укажи папку донора');
const profileFile = process.argv[3];
const src = process.argv[4] || 'G:\\Aion Empire\\classic';
const appBackup = process.argv[5] ||
  path.join(process.env.APPDATA || os.homedir(), 'aion-ui-builder', 'backup');
const pristine = (rel) => {
  const bak = path.join(appBackup, rel.split('/').join('__'));
  return fs.existsSync(bak) ? bak : path.join(src, rel.replace(/\//g, path.sep));
};

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'aionui-import-check-'));
const backup = path.join(sandbox, '_backup');
for (const rel of [
  'bin64/crysystem.dll',
  'data/ui/ui.pak',
  'data/ui/preload/preload.pak',
  'l10n/rus/data/data.pak',
  'l10n/rus/textures/textures.pak',
  'textures/ui/ui.pak',
  'data/ui/game/game.pak',
  'data/ui/game_hud_s1/game_hud_s1.pak',
  'data/ui/game_hud_s2/game_hud_s2.pak',
  'textures/ui/newmap/tiamat_down/tiamat_down.pak',
  'textures/ui/newmap/lf4/lf4.pak',
]) {
  const to = path.join(sandbox, rel.replace(/\//g, path.sep));
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(pristine(rel), to);
}

const profile = profileFile ? JSON.parse(fs.readFileSync(profileFile, 'utf8')) : {
  layout: {}, font: { enabled: false }, packs: {}, skins: {}, v5: { enabled: false }, lang: 'rus',
  classic: { enabled: true, off: {}, rules: {}, hud: { enabled: true, off: {}, set: 's2' }, maps: true },
};
profile.classic.root = donorRoot;
// шрифт и картинки пользователя в сравнении не участвуют
profile.font = { enabled: false };
profile.packs = {};

const client = new Client(sandbox, backup);
const log = [];
build.apply(client, profile, (m) => log.push(m));

const walk = (d, o = []) => {
  for (const n of fs.readdirSync(d)) {
    const p = path.join(d, n);
    if (fs.statSync(p).isDirectory()) { if (n !== '_backup') walk(p, o); } else o.push(p);
  }
  return o;
};
for (const f of walk(sandbox).sort()) {
  const h = crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex');
  console.log(h + '  ' + path.relative(sandbox, f).split(path.sep).join('/'));
}
console.log('--- журнал сборки');
log.forEach((l) => console.log(l.replace(donorRoot, '<донор>')));
fs.rmSync(sandbox, { recursive: true, force: true });
