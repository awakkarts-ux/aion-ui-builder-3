'use strict';
/**
 * Сквозная проверка иконок умений на КОПИИ skills.pak: каталог, сборка
 * рангов и серых из одной картинки, запись сборкой, возврат к родному.
 *
 *   node tools/roundtrip-skillicons.js ["G:\Aion Empire\classic"] [резерв]
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const pak = require('../src/core/pak');
const dds = require('../src/core/dds');
const png = require('../src/core/png');
const { Client } = require('../src/core/client');
const skillicons = require('../src/core/skillicons');
const build = require('../src/core/build');

const src = process.argv[2] || 'G:\\Aion Empire\\classic';
const appBackup = process.argv[3] ||
  path.join(process.env.APPDATA || os.homedir(), 'aion-ui-builder', 'backup');
const pristine = (rel) => {
  const bak = path.join(appBackup, rel.split('/').join('__'));
  return fs.existsSync(bak) ? bak : path.join(src, rel.replace(/\//g, path.sep));
};

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'aionui-skillicons-'));
for (const rel of ['bin64/crysystem.dll', 'data/skills/skills.pak', 'l10n/rus/data/data.pak']) {
  const to = path.join(sandbox, rel.replace(/\//g, path.sep));
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(pristine(rel), to);
}
const client = new Client(sandbox, path.join(sandbox, '_backup'));
const checks = [];
const check = (name, ok, extra) => checks.push([name, !!ok, extra]);

const cat = skillicons.catalogue(client, 'rus');
check('каталог: семейств больше 1500', cat.families.length > 1500, cat.families.length);
const ranger = cat.families.filter((f) => f.classes.includes('RANGER') && f.used);
check('каталог: у Стрелка 120–220 иконок', ranger.length >= 120 && ranger.length <= 220, ranger.length);
// иконки с кодом класса в имени (cbt_ra_…) не теряются в фильтре — было 43 из 105
const CODES = { fi: 'FIGHTER', kn: 'KNIGHT', ra: 'RANGER', as: 'ASSASSIN', wi: 'WIZARD', el: 'ELEMENTALLIST', pr: 'PRIEST', ch: 'CHANTER' };
const lostByCode = Object.entries(CODES).map(([k, id]) => cat.families
  .filter((f) => new RegExp('^(cbt|live)_' + k + '_').test(f.id) && !(f.used && f.classes.includes(id))).length);
check('каталог: ни одна иконка с кодом класса не теряется', lostByCode.every((n) => n === 0), lostByCode.join(','));
const fam = cat.families.find((f) => f.id === 'cbt_ra_arrowstrike');
check('каталог: «Меткая стрела» — Стрелок, 5 рангов', fam && fam.classes.join() === 'RANGER' &&
  fam.ranks.length === 5 && fam.titles.some((t) => /стрел/i.test(t)), fam && fam.titles.join(', '));
const shared = cat.families.find((f) => f.id === 'cbt_sc_swiftedge');
check('каталог: умение Разведчика — общее у Стрелка и Убийцы',
  shared && shared.classes.join() === 'RANGER,ASSASSIN', shared && shared.classes.join());

// новая картинка — чужая иконка первого ранга, как будто её нарисовал пользователь
const donorFam = cat.families.find((f) => f.id === 'cbt_wi_burningsoul') || cat.families[10];
const base = dds.toRgba(client.packRead('skills', 'rus', [donorFam.ranks[0].key]).get(donorFam.ranks[0].key));
const made = skillicons.make(client, 'rus', { family: fam, rgba: base.rgba });
check('сборка рангов: 5 цветных + 5 серых', made.length === 10, made.length);
const gray = made.filter((m) => /_gray\.dds$/i.test(m.key));
check('серые действительно серые', gray.every((m) => {
  for (let i = 0; i < m.rgba.length; i += 4) if (m.rgba[i] !== m.rgba[i + 1] || m.rgba[i] !== m.rgba[i + 2]) return false;
  return true;
}));
check('ранг I — картинка как есть', made[0].rgba.equals(base.rgba));
check('ранги II–V отличаются друг от друга', new Set(made.filter((m) => !/_gray/i.test(m.key))
  .map((m) => m.rgba.toString('base64'))).size === 5);

// лист для глаз: родные ранги сверху, собранные — ниже
const orig = client.packRead('skills', 'rus', fam.ranks.map((r) => r.key));
const W = 64;
const sheet = Buffer.alloc(5 * W * 3 * W * 4);
const put = (img, cx, cy) => { for (let y = 0; y < W; y++) img.copy(sheet, ((cy * W + y) * 5 * W + cx * W) * 4, y * W * 4, (y + 1) * W * 4); };
fam.ranks.forEach((r, i) => put(dds.toRgba(orig.get(r.key)).rgba, i, 0));
made.filter((m) => !/_gray/i.test(m.key)).forEach((m, i) => put(m.rgba, i, 1));
gray.forEach((m, i) => put(m.rgba, i, 2));
const sheetFile = path.join(os.tmpdir(), 'aionui-skillicons-sheet.png');
fs.writeFileSync(sheetFile, png.encode(5 * W, 3 * W, sheet));

// профиль, как его ведёт окно: ключ -> подготовленный DDS
const staged = path.join(sandbox, '_staged');
fs.mkdirSync(staged);
const profile = { layout: {}, font: { enabled: false }, packs: { skills: {} }, skins: {}, lang: 'rus' };
for (const m of made) {
  const f = path.join(staged, m.key.replace(/[\\/|]/g, '_'));
  fs.writeFileSync(f, dds.fromRgba(m.width, m.height, m.rgba));
  profile.packs.skills[m.key] = f;
}
const log = [];
build.apply(client, profile, (m) => log.push(m));
const skillsAbs = client.abs('data/skills/skills.pak');
const after = pak.readSome(skillsAbs, client.dll, made.map((m) => m.key.split('|')[1]));
check('в паке подменены все 10 записей', made.every((m) => {
  const raw = after.get(m.key.split('|')[1]);
  return raw && dds.toRgba(raw).rgba.equals(m.rgba);
}));
const untouched = cat.families.find((f) => f.id === 'cbt_ra_breathofnature');
const k = untouched.ranks[0].key.split('|')[1];
check('соседняя иконка не тронута',
  pak.readSome(skillsAbs, client.dll, [k]).get(k).equals(pak.readSome(pristine('data/skills/skills.pak'), client.dll, [k]).get(k)));

// «вернуть как было»: правок нет — сборка возвращает родной пак
profile.packs.skills = {};
const log2 = [];
build.apply(client, profile, (m) => log2.push(m));
check('после возврата пак штатный байт в байт',
  fs.readFileSync(skillsAbs).equals(fs.readFileSync(pristine('data/skills/skills.pak'))), log2.join(' / '));

fs.rmSync(sandbox, { recursive: true, force: true });
let bad = 0;
for (const [name, ok, extra] of checks) {
  if (!ok) bad++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${extra !== undefined ? '  ' + extra : ''}`);
}
console.log('лист рангов: ' + sheetFile);
console.log(bad ? `провалено: ${bad}` : 'иконки умений проверены');
process.exit(bad ? 1 : 0);
