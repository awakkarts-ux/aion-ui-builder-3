'use strict';
/**
 * Сквозная проверка: на КОПИИ клиента двигаем мини-карту, снимаем замок,
 * прячем виджет — собираем пак и читаем его обратно. Настоящая игра не
 * трогается: копия лежит во временной папке.
 *
 *   node tools/roundtrip.js ["G:\Aion Empire\classic"]
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const pak = require('../src/core/pak');
const bxml = require('../src/core/bxml');
const { Client } = require('../src/core/client');
const build = require('../src/core/build');

const src = process.argv[2] || 'G:\\Aion Empire\\classic';
const sandbox = path.join(os.tmpdir(), 'aion-ui-builder-sandbox');
const backup = path.join(sandbox, '_backup');

// Клиент пользователя может быть уже пропатчен нами же. Чтобы тест мерил
// настоящие изменения, а не сравнивал правку с такой же правкой, берём файлы
// из резервных копий программы, когда они есть.
const appBackup = path.join(
  process.env.APPDATA || os.homedir(), 'aion-ui-builder', 'backup'
);
const pristine = (rel) => {
  const bak = path.join(appBackup, rel.split('/').join('__'));
  return fs.existsSync(bak) ? bak : path.join(src, rel.replace(/\//g, path.sep));
};

fs.rmSync(sandbox, { recursive: true, force: true });
for (const rel of [
  'bin64/crysystem.dll',
  'data/ui/game_hud_s1/game_hud_s1.pak',
  'data/ui/ui.pak',
  'l10n/rus/data/data.pak',
  'textures/ui/hit_number/hit_number.pak',
  'l10n/rus/textures/textures.pak',
  'data/ui/preload/preload.pak',
]) {
  const to = path.join(sandbox, rel.replace(/\//g, path.sep));
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(pristine(rel), to);
}
// пустышка, чтобы check() был доволен
fs.mkdirSync(path.join(sandbox, 'data', 'ui', 'game'), { recursive: true });
fs.writeFileSync(path.join(sandbox, 'data', 'ui', 'game', 'game.pak'), Buffer.alloc(0));

const client = new Client(sandbox, backup);
const target = 'hud_s1/radar_dialog.xml';
const profile = {
  layout: {
    [target]: {
      frame: { x: 24, y: 40, w: 237, h: 224 },
      movable: true,
      widgets: { item_shop_bg: { visible: false } },
    },
  },
  portrait: Object.assign({ enabled: true }, require('../src/core/portrait').fromPreset(6)),
  font: { enabled: false },
  packs: { skills: {}, hitnum: {}, uiatlas: {} },
  // перенаправляем рамку радара на атлас интерфейса Aion 5.x
  skins: {
    'version4.xml|hud|v4_hud_radar_wnd': {
      texture: 'textures/ui/v5_common',
      rects: { src_image: { x: 10, y: 20, w: 177, h: 177 } },
    },
  },
  // как по умолчанию в программе: сведение вариантов рамок выключено
  v5: { enabled: true, rules: { variant: false } },
  lang: 'rus',
};

// Подменяемые картинки: заливка вместо надписи «критический удар» (она берётся
// из локализованного пака, 248x76) и вместо белой единицы (общий пак, 32x32).
const dds = require('../src/core/dds');
const fill = (w, h, r, g, b) => {
  const rgba = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    rgba[i * 4] = r; rgba[i * 4 + 1] = g; rgba[i * 4 + 2] = b; rgba[i * 4 + 3] = 255;
  }
  const f = path.join(sandbox, `fill_${w}x${h}_${r}.dds`);
  fs.writeFileSync(f, dds.fromRgba(w, h, rgba));
  return f;
};
// ключ — «пак|запись»: одноимённые копии в разных паках правятся по отдельности
profile.packs.hitnum['l10n/rus/textures/textures.pak|UI/hit_number/critical_w.dds'] =
  fill(248, 76, 255, 32, 0);
profile.packs.hitnum['textures/ui/hit_number/hit_number.pak|1_white.dds'] =
  fill(32, 32, 0, 255, 64);

const log = [];
build.apply(client, profile, (m) => log.push(m));
log.forEach((l) => console.log('  ' + l));

// читаем результат заново, как это сделает игра
const after = pak.readPak(
  path.join(sandbox, 'data', 'ui', 'game_hud_s1', 'game_hud_s1.pak'),
  path.join(sandbox, 'bin64', 'crysystem.dll')
);
const root = bxml.parse(after.get('radar_dialog.xml')).root;
const fr = root.getFrame();
const shop = root.kids.find((k) => k.attrs.get('name') === 'item_shop_bg');

const checks = [
  ['рамка переехала', fr.x === 24 && fr.y === 40 && fr.w === 237 && fr.h === 224, `${fr.x},${fr.y},${fr.w},${fr.h}`],
  ['замок снят', !root.getFlags().includes('not_movable'), root.attrs.get('flag')],
  ['виджет спрятан', shop.getFlags().includes('not_visible'), shop.attrs.get('flag') || '—'],
  ['остальные записи целы', after.size === 9, after.size + ' записей'],
  ['резерв создан', client.hasBackup('data/ui/game_hud_s1/game_hud_s1.pak'), ''],
];

// портрет: окно в панели состояния и камера в ui.pak
const status = bxml.parse(after.get('basic_status_dialog.xml')).root;
const pw = status.kids.find((k) => k.attrs.get('name') === 'portrait').getFrame();
checks.push(['окно портрета выросло', pw.w === 280 && pw.h === 280 && pw.x === -75,
  `${pw.x},${pw.y},${pw.w},${pw.h}`]);

const uiPak = pak.readPak(
  path.join(sandbox, 'data', 'ui', 'ui.pak'),
  path.join(sandbox, 'bin64', 'crysystem.dll')
);
const cam = bxml.parse(uiPak.get('UI_ModelCam.xml')).root;
const lm = cam.kids
  .find((k) => k.attrs.get('type') === 'portrait')
  .kids.find((k) => k.attrs.get('name') === 'lm.cgf');
checks.push(['камера отодвинута', lm.attrs.get('pos') === '-0.028,3.6,0.4', lm.attrs.get('pos')]);
checks.push(['ui.pak цел', uiPak.size === 66, uiPak.size + ' записей']);

// главное: то же самое должно оказаться в локализованном паке — клиент читает его
const l10nPath = path.join(sandbox, 'l10n', 'rus', 'data', 'data.pak');
const dllPath = path.join(sandbox, 'bin64', 'crysystem.dll');
// UI_ModelCam.xml в локализованном паке нет — он живёт только в data/ui/ui.pak,
// поэтому камеру проверяем там (выше), а здесь только то, что задублировано.
const want = [
  'UI/game_hud_s1/radar_dialog.xml',
  'UI/game_hud_s1/basic_status_dialog.xml',
];
const got = pak.readSome(l10nPath, dllPath, want);
const lRadar = bxml.parse(got.get(want[0])).root;
const lPortrait = bxml.parse(got.get(want[1])).root
  .kids.find((k) => k.attrs.get('name') === 'portrait');
const lf = lRadar.getFrame();
checks.push(['l10n: радар переехал', lf.x === 24 && lf.y === 40, `${lf.x},${lf.y}`]);
checks.push(['l10n: замок снят', !lRadar.getFlags().includes('not_movable'), lRadar.attrs.get('flag')]);
checks.push(['l10n: портрет вырос', lPortrait.attrs.get('frame') === '-75,-105,280,280',
  lPortrait.attrs.get('frame')]);

// и всё остальное в этом паке должно остаться нетронутым
const srcL10n = pristine('l10n/rus/data/data.pak');
const srcAll = pak.readDirectory(fs.readFileSync(srcL10n));
const outAll = pak.readDirectory(fs.readFileSync(l10nPath));
checks.push(['l10n: число записей то же', srcAll.entries.length === outAll.entries.length,
  `${srcAll.entries.length} -> ${outAll.entries.length}`]);
const untouched = 'UI/game/inventory_dialog.xml';
const a = pak.readSome(srcL10n, dllPath, [untouched]).get(untouched);
const b = pak.readSome(l10nPath, dllPath, [untouched]).get(untouched);
checks.push(['l10n: соседние записи целы', a.equals(b), '']);

// цифры урона: правка ушла в ДВА разных пака, и сжатые DDS читаются
const hitPath = path.join(sandbox, 'textures', 'ui', 'hit_number', 'hit_number.pak');
const texPath = path.join(sandbox, 'l10n', 'rus', 'textures', 'textures.pak');

const critRaw = pak.readSome(texPath, dllPath, ['UI/hit_number/critical_w.dds'])
  .get('UI/hit_number/critical_w.dds');
const crit = dds.toRgba(critRaw);
checks.push(['цифры: табличка подменена в l10n',
  crit.width === 248 && crit.height === 76 && crit.rgba[0] === 255 && crit.rgba[1] === 32,
  `${crit.width}x${crit.height} первый пиксель ${crit.rgba.slice(0, 4).join(',')}`]);

const hits = pak.readSome(hitPath, dllPath, ['1_white.dds', '0_gray.dds', '0_white.dds']);
const one = dds.toRgba(hits.get('1_white.dds'));
checks.push(['цифры: цифра подменена в общем паке',
  one.width === 32 && one.rgba[1] === 255 && one.rgba[2] === 64,
  `${one.width}x${one.height} первый пиксель ${one.rgba.slice(0, 4).join(',')}`]);
const gray = dds.toRgba(hits.get('0_gray.dds'));
checks.push(['цифры: DXT3 читается', gray.width === 32 && gray.rgba.length === 32 * 32 * 4,
  `${gray.width}x${gray.height}`]);
const white = dds.toRgba(hits.get('0_white.dds'));
checks.push(['цифры: соседняя цифра цела', white.width === 32, `${white.width}x${white.height}`]);
// скины: правка должна лечь и в preload.pak, и в его копию внутри l10n
const findSkin = (buf) => {
  for (const n of bxml.parse(buf).root.walk()) {
    if (n.attrs.get('name') === 'v4_hud_radar_wnd') return n;
  }
  return null;
};
const preSkin = findSkin(
  pak.readSome(path.join(sandbox, 'data', 'ui', 'preload', 'preload.pak'), dllPath,
    ['version4.xml']).get('version4.xml')
);
checks.push(['скин: ручная правка поверх переноса',
  preSkin.attrs.get('texture') === 'textures/ui/v5_common' &&
  preSkin.attrs.get('src_image') === '10,20,177,177',
  `${preSkin.attrs.get('texture')} ${preSkin.attrs.get('src_image')}`]);

// перенос на вид 5.x: кнопка должна смотреть в атлас v5, а имя остаться прежним
const preAll = bxml.parse(
  pak.readSome(path.join(sandbox, 'data', 'ui', 'preload', 'preload.pak'), dllPath,
    ['version4.xml']).get('version4.xml')
).root;
const findByName = (nm) => {
  for (const n of preAll.walk()) if (n.attrs.get('name') === nm) return n;
  return null;
};
const btn = findByName('v4_button_up');
checks.push(['вид 5.x: кнопка смотрит в атлас v5',
  /v5_/i.test(btn.attrs.get('texture') || ''), btn.attrs.get('texture')]);
checks.push(['вид 5.x: имя скина не изменилось', !!findByName('v4_button_up'), 'v4_button_up']);
// деталь без пары в v5 должна остаться прежней
const noPair = findByName('v4_check_check');
checks.push(['вид 5.x: деталь без пары осталась на v4',
  /v4_/i.test(noPair.attrs.get('texture') || ''), noPair.attrs.get('texture')]);
// пресеты ссылаются на скины по имени — они не должны были пострадать
let presets = 0;
for (const n of preAll.walk()) if (n.name === 'Preset') presets++;
checks.push(['вид 5.x: пресеты на месте', presets === 313, presets + ' шт.']);
const l10nSkin = findSkin(
  pak.readSome(l10nPath, dllPath, ['UI/preload/version4.xml']).get('UI/preload/version4.xml')
);
checks.push(['скин: и в l10n тоже',
  l10nSkin.attrs.get('texture') === 'textures/ui/v5_common',
  l10nSkin.attrs.get('texture')]);
// а правки диалогов при этом не потерялись — пишем в l10n одним проходом
checks.push(['l10n: диалоги и скины вместе',
  bxml.parse(got.get(want[0])).root.getFrame().x === 24, '']);

const parry = dds.toRgba(
  pak.readSome(texPath, dllPath, ['UI/hit_number/parry_w.dds']).get('UI/hit_number/parry_w.dds')
);
checks.push(['цифры: DXT5 читается', parry.width === 268 && parry.height === 76,
  `${parry.width}x${parry.height}`]);

// и возврат
client.restoreAll();
const back = pak.readPak(
  path.join(sandbox, 'data', 'ui', 'game_hud_s1', 'game_hud_s1.pak'),
  path.join(sandbox, 'bin64', 'crysystem.dll')
);
const backRoot = bxml.parse(back.get('radar_dialog.xml')).root;
const bf = backRoot.getFrame();
checks.push(['возврат вернул оригинал', bf.x === 1043 && bf.y === 736, `${bf.x},${bf.y}`]);
const backCrit = dds.toRgba(
  pak.readSome(texPath, dllPath, ['UI/hit_number/critical_w.dds']).get('UI/hit_number/critical_w.dds')
);
checks.push(['возврат вернул и цифры',
  !(backCrit.rgba[0] === 255 && backCrit.rgba[1] === 32 && backCrit.rgba[3] === 255),
  backCrit.rgba.slice(0, 4).join(',')]);

const backL10n = pak.readSome(l10nPath, dllPath, [want[0]]).get(want[0]);
const bl = bxml.parse(backL10n).root.getFrame();
checks.push(['возврат вернул и l10n', bl.x === 1043 && bl.y === 736, `${bl.x},${bl.y}`]);

let bad = 0;
for (const [name, ok, extra] of checks) {
  if (!ok) bad++;
  console.log((ok ? '  ok   ' : '  МИМО ') + name.padEnd(28) + (extra || ''));
}
fs.rmSync(sandbox, { recursive: true, force: true });
console.log(bad ? 'провалов: ' + bad : 'сквозная проверка пройдена');
process.exit(bad ? 1 : 0);
