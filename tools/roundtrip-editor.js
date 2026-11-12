'use strict';
/**
 * Редактор интерфейса на КОПИИ клиента: элемент заменяется вариантом (все
 * состояния берут его внешность), другой элемент — своей картинкой (скин
 * смотрит на картинку в zz_builder.pak), общая рамка отделяется у инвентаря
 * («сделать отдельным») и меняется только там. Читаем библиотеку так, как её прочтёт
 * игра (l10n), и откатываем — паки штатные байт в байт, пака программы нет.
 *
 *   node tools/roundtrip-editor.js ["G:\Aion Empire\classic"] [резерв]
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const pak = require('../src/core/pak');
const bxml = require('../src/core/bxml');
const dds = require('../src/core/dds');
const { Client, BUILDER_PAK } = require('../src/core/client');
const build = require('../src/core/build');
const elements = require('../src/core/elements');

const src = process.argv[2] || 'G:\\Aion Empire\\classic';
const appBackup = process.argv[3] ||
  path.join(process.env.APPDATA || os.homedir(), 'aion-ui-builder', 'backup');
const pristine = (rel) => {
  const bak = path.join(appBackup, rel.split('/').join('__'));
  return fs.existsSync(bak) ? bak : path.join(src, rel.replace(/\//g, path.sep));
};

const RELS = ['data/ui/preload/preload.pak', 'l10n/rus/data/data.pak', 'data/ui/game/game.pak'];
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'aionui-editor-'));
for (const rel of ['bin64/crysystem.dll', ...RELS, 'data/ui/ui.pak']) {
  const to = path.join(sandbox, rel.replace(/\//g, path.sep));
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(pristine(rel), to);
}
fs.mkdirSync(path.join(sandbox, 'textures', 'ui'), { recursive: true });

const client = new Client(sandbox, path.join(sandbox, '_backup'));
const checks = [];
const check = (name, ok, extra) => checks.push([name, !!ok, extra]);

// своя картинка 20×10 — красная
const img = path.join(sandbox, 'own.dds');
const px = Buffer.alloc(20 * 10 * 4);
for (let i = 0; i < 200; i++) px.writeUInt32BE(0xff2020ff, i * 4);
fs.writeFileSync(img, dds.fromRgba(20, 10, px));

const profile = {
  layout: {}, font: { enabled: false }, packs: { skills: {}, hitnum: {}, uiatlas: {} }, skins: {}, lang: 'rus',
  // рамка v4_dialog общая на много окон — отделяем её у инвентаря и меняем только копию
  splits: [{ win: 'game/inventory_dialog.xml', scope: '', el: 'p:v4_dialog' }],
  elements: {
    'p:v4_map_button': { from: 'p:v5_map_button' },
    'p:v4_mail_btn': { images: { up: img } },
    ['p:' + elements.splitName('v4_dialog', 'game/inventory_dialog.xml', '')]: { from: 'p:v4_dialog2' },
  },
};
const log = [];
build.apply(client, profile, (m) => log.push(m));
check('журнал сборки', log.some((m) => /редактор интерфейса: элементов 3/.test(m)) &&
  log.some((m) => /отдельных копий элементов 1/.test(m)), log.filter((m) => /редактор/.test(m)).join(' | '));

/** Библиотеки так, как их прочтёт игра: копия в l10n. */
const l10nLib = (lib) => pak.readSome(client.abs('l10n/rus/data/data.pak'), client.dll, ['UI/preload/' + lib])
  .get('UI/preload/' + lib);
const libNow = l10nLib('version4.xml');
const libV5 = client.original('preload').get('version5.xml');
const skinsOf = (buf) => {
  const m = new Map();
  for (const n of bxml.parse(buf).root.walk()) if (n.name === 'Skin' && n.attrs.get('name')) m.set(n.attrs.get('name'), n);
  return m;
};
const now = skinsOf(libNow);
const v5 = skinsOf(libV5);
const look = (n) => n && [...n.attrs].filter(([k]) => k !== 'name').map(([k, v]) => k + '=' + v).sort().join(' ');
check('кнопка карты «обычная» — как у v5', look(now.get('v4_map_btn_up')) === look(v5.get('v5_map_btn_up')),
  look(now.get('v4_map_btn_up')));
check('кнопка карты «наведение» — как у v5', look(now.get('v4_map_btn_over')) === look(v5.get('v5_map_btn_over')));
// у кнопки почты все три состояния — один скин v4_mailicon
const mail = now.get('v4_mailicon');
const tex = elements.ownTexture('p:v4_mail_btn', 'up');
check('своя картинка: скин смотрит на свой атлас целиком', mail && mail.attrs.get('texture') === tex &&
  mail.attrs.get('src_image') === '0,0,20,10' && !mail.attrs.has('src_left_top'), look(mail));
check('соседний скин не тронут', look(now.get('v4_mail_full_btn_up')) === look(skinsOf(client.original('preload')
  .get('version4.xml')).get('v4_mail_full_btn_up')));
const bp = client.abs(BUILDER_PAK);
const own = fs.existsSync(bp) ? pak.readPak(bp, client.dll) : new Map();
const ownImg = own.get(tex.split('/').pop() + '.dds');
check('картинка в паке программы', ownImg && dds.toRgba(ownImg).width === 20, [...own.keys()].join(','));
const dataUi = skinsOf(pak.readPak(client.abs('data/ui/preload/preload.pak'), client.dll).get('version4.xml'));
check('и в data/ui тоже', look(dataUi.get('v4_map_btn_up')) === look(v5.get('v5_map_btn_up')));

// «сделать отдельным»: окно инвентаря смотрит на копию, соседние окна — на общую рамку
const dlgPreset = (buf) => {
  const r = bxml.parse(buf).root;
  return (r.name === 'Dialog' ? r : [...r.walk()].find((n) => n.name === 'Dialog')).attrs.get('preset');
};
const copy = elements.splitName('v4_dialog', 'game/inventory_dialog.xml', '');
const liveL10n = (name) => pak.readSome(client.abs('l10n/rus/data/data.pak'), client.dll, [name]).get(name);
check('отдельно: инвентарь смотрит на копию рамки', dlgPreset(liveL10n('UI/game/inventory_dialog.xml')) === copy,
  dlgPreset(liveL10n('UI/game/inventory_dialog.xml')));
const origGame = client.original('game');
const other = [...origGame.keys()].find((e) => e !== 'inventory_dialog.xml' && /\.xml$/i.test(e) &&
  (() => { try { return dlgPreset(origGame.get(e)) === 'v4_dialog'; } catch (e2) { return false; } })());
check('отдельно: другое окно с той же рамкой не тронуто', other && dlgPreset(liveL10n('UI/game/' + other)) === 'v4_dialog', other);
const presetsNow = new Map();
for (const n of bxml.parse(libNow).root.walk()) if (n.name === 'Preset') presetsNow.set(n.attrs.get('name'), n);
const cp = presetsNow.get(copy);
const cpSkins = cp ? cp.kids.map((k) => k.attrs.get('name')) : [];
check('отдельно: копия пресета со своими скинами', cp && cpSkins.length && cpSkins.every((s) => s.endsWith('__bld_inventory') && now.has(s)),
  cpSkins.join(','));
const origSkin = presetsNow.get('v4_dialog').kids[0].attrs.get('name');
const d2 = skinsOf(client.original('preload').get('version4.xml'));
const d2skin = [...bxml.parse(client.original('preload').get('version4.xml')).root.walk()]
  .find((n) => n.name === 'Preset' && n.attrs.get('name') === 'v4_dialog2').kids[0].attrs.get('name');
check('отдельно: у копии вид варианта, у общей — родной',
  look(now.get(cpSkins[0])) === look(d2.get(d2skin)) && look(now.get(origSkin)) === look(d2.get(origSkin)));

// откат: правок нет — паки штатные, пака программы нет
build.apply(client, Object.assign({}, profile, { elements: {}, splits: [] }), () => {});
client.restoreAll();
check('возврат: паки штатные байт в байт',
  RELS.every((r) => fs.readFileSync(client.abs(r)).equals(fs.readFileSync(pristine(r)))));
check('возврат: пака программы нет', !fs.existsSync(bp));

fs.rmSync(sandbox, { recursive: true, force: true });
let bad = 0;
for (const [name, ok, extra] of checks) {
  if (!ok) bad++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${extra !== undefined ? '  ' + extra : ''}`);
}
console.log(bad ? `провалено: ${bad}` : 'редактор интерфейса проверен');
process.exit(bad ? 1 : 0);
