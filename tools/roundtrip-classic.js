'use strict';
/**
 * Сквозная проверка переноса вида официального Classic: на КОПИИ клиента
 * собираем с донором, читаем результат так, как его прочтёт игра, и
 * откатываем. Ни игра, ни донор не меняются.
 *
 *   node tools/roundtrip-classic.js ["E:\Aion Classic"] ["G:\Aion Empire\classic"]
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const pak = require('../src/core/pak');
const bxml = require('../src/core/bxml');
const dds = require('../src/core/dds');
const donor = require('../src/core/donor');
const { Client } = require('../src/core/client');
const build = require('../src/core/build');

const donorRoot = process.argv[2] || 'E:\\Aion Classic';
const src = process.argv[3] || 'G:\\Aion Empire\\classic';
const sandbox = path.join(os.tmpdir(), 'aion-ui-builder-classic');
const backup = path.join(sandbox, '_backup');

const appBackup = path.join(process.env.APPDATA || os.homedir(), 'aion-ui-builder', 'backup');
const pristine = (rel) => {
  const bak = path.join(appBackup, rel.split('/').join('__'));
  return fs.existsSync(bak) ? bak : path.join(src, rel.replace(/\//g, path.sep));
};

fs.rmSync(sandbox, { recursive: true, force: true });
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
  // карты: перекрашенная зона и зона с той же картинкой
  'textures/ui/newmap/tiamat_down/tiamat_down.pak',
  'textures/ui/newmap/df4/df4.pak',
]) {
  const to = path.join(sandbox, rel.replace(/\//g, path.sep));
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(pristine(rel), to);
}

const client = new Client(sandbox, backup);
const dllPath = client.dll;
const OFF_KEY = 'version4.xml|number'; // одну группу выключаем — она должна остаться прежней
const profile = {
  layout: {},
  font: { enabled: false },
  packs: { skills: {}, hitnum: {}, uiatlas: {} },
  // ручная правка поверх переноса — должна победить
  skins: {
    'version4.xml|hud|v4_hud_radar_wnd': {
      texture: 'textures/ui/v5_common',
      rects: { src_image: { x: 10, y: 20, w: 177, h: 177 } },
    },
  },
  v5: { enabled: false },
  // значки «в угол» — самый тяжёлый режим (окно карты до низа, меню поверх);
  // режим по умолчанию проверяется отдельно ниже
  classic: { enabled: true, root: donorRoot, off: { [OFF_KEY]: true }, hud: { enabled: true, off: {}, icons: 'corner', set: 's2' }, maps: true },
  lang: 'rus',
};

// план — до сборки, по нему и сверяем
const d = new donor.Donor(donorRoot);
const plan = donor.plan(client, d, 'rus');

const log = [];
build.apply(client, profile, (m) => log.push(m));
log.forEach((l) => console.log('  ' + l));

const checks = [];
const check = (name, ok, extra) => checks.push([name, !!ok, extra]);

const readLib = (file, entry) => bxml.parse(pak.readSome(file, dllPath, [entry]).get(entry)).root;
const byName = (root) => {
  const m = new Map();
  for (const n of root.walk()) if (n.name === 'Skin' && !m.has(n.attrs.get('name'))) m.set(n.attrs.get('name'), n);
  return m;
};
const preloadPath = path.join(sandbox, 'data', 'ui', 'preload', 'preload.pak');
const l10nPath = path.join(sandbox, 'l10n', 'rus', 'data', 'data.pak');
const v4 = byName(readLib(preloadPath, 'version4.xml'));
const v4l10n = byName(readLib(l10nPath, 'UI/preload/version4.xml'));
const donorV4 = byName(bxml.parse(d.preload().get('version4.xml')).root);
// наша version4 до сборки
const orig0 = () => byName(bxml.parse(pak.readSome(pristine('data/ui/preload/preload.pak'), dllPath,
  ['version4.xml']).get('version4.xml')).root);

// 1. пак атласов: есть, читается ключом НАШЕГО клиента, картинки те же, что у донора
const zz = path.join(sandbox, donor.DONOR_PAK.replace(/\//g, path.sep));
check('пак атласов создан', fs.existsSync(zz), donor.DONOR_PAK);
const shipped = pak.readPak(zz, dllPath);
let sameBytes = 0, decoded = 0;
const hudShips = require('../src/core/hudport').plan(client, d, 'rus', profile.classic.hud).ships;
// свои атласы (значки меню, уменьшенные из донора) — сверяем с тем, что собрал план
const fixShips = require('../src/core/dialogfix').plan(client, d, 'rus').ships;
const made = (k) => plan.generated && plan.generated.get(k.replace(/\.dds$/, ''));
const donorAtlases = d.readAtlases(new Map([...shipped.keys()].filter((k) => !made(k)).map((k) => {
  const s = k.replace(/\.dds$/, '');
  return [s, plan.atlases.get(s) || hudShips.get(s) || fixShips.get(s)];
})));
for (const [k, raw] of shipped) {
  if ((made(k) || donorAtlases.get(k.replace(/\.dds$/, ''))).equals(raw)) sameBytes++;
  try { dds.toRgba(raw); decoded++; } catch (e) { /* посчитаем ниже */ }
}
check('атласы байт в байт как у донора', sameBytes === shipped.size, `${sameBytes}/${shipped.size}`);
check('атласы разбираются как DDS', decoded === shipped.size, `${decoded}/${shipped.size}`);
check('имена атласов с приставкой cl_', [...shipped.keys()].every((k) => k.startsWith(donor.PREFIX)), '');

// что досталось каждому скину при настройках профиля
const chosen = donor.pick(plan, profile.classic);
const pickOne = (fn) => [...chosen.values()].find((c) => c.lib === 'version4.xml' && c.ship &&
  c.cat !== 'number' && c.name !== 'v4_hud_radar_wnd' && fn(c));
const sameRects = (node, pairs) => pairs.filter(([k]) => /^(src_|size_)/.test(k))
  .every(([k, v]) => node.attrs.get(k) === v);

// 2. одноимённая перерисованная деталь: внешность как у донора, атлас — наш cl_
const moved = pickOne((c) => c.src === 'same');
const got = v4.get(moved.name);
check('перерисованное: атлас перенаправлен на cl_', got.attrs.get('texture') === 'textures/ui/' + moved.ship,
  `${moved.name}: ${got.attrs.get('texture')}`);
check('перерисованное: прямоугольники как у донора',
  sameRects(got, [...donorV4.get(moved.name).attrs]), moved.name);
check('перерисованное: атлас есть в паке', shipped.has(moved.ship + '.dds'), moved.ship);

// 3. новый вид: v4_* получил внешность своей пары v3_*
const fresh = pickOne((c) => c.src === 'v3');
check('новый вид: есть пары v4 → v3', !!fresh, fresh ? `${fresh.name} → ${fresh.to}` : 'нет');
if (fresh) {
  const node = v4.get(fresh.name);
  check('новый вид: скин смотрит в атлас донора',
    node.attrs.get('texture') === 'textures/ui/' + fresh.ship, `${fresh.name}: ${node.attrs.get('texture')}`);
  check('новый вид: прямоугольники пары v3', sameRects(node, fresh.attrs), fresh.to);
  check('новый вид: имя осталось v4', !!v4.get(fresh.name) && !v4.has(fresh.to), fresh.name);
}

// 3а. пары другой формы по умолчанию не применяются
const odd = plan.changes.find((c) => c.lib === 'version4.xml' && c.src === 'v3odd' &&
  !chosen.has('version4.xml|' + c.name) && c.name !== 'v4_hud_radar_wnd');
if (odd) {
  check('другая форма по умолчанию не применена',
    v4.get(odd.name).attrs.get('texture') === orig0().get(odd.name).attrs.get('texture'),
    `${odd.name} → ${odd.to}`);
}

// 3б. изменились только те, что реально выглядят иначе: остальное не тронуто
let untouched = 0, wrong = 0;
for (const [name, node] of orig0()) {
  if (chosen.has('version4.xml|' + name) || name === 'v4_hud_radar_wnd') continue;
  const now = v4.get(name);
  if (now.attrs.get('texture') === node.attrs.get('texture') &&
      now.attrs.get('src_image') === node.attrs.get('src_image')) untouched++;
  else wrong++;
}
check('выглядящее так же — не тронуто', wrong === 0, `не тронуто ${untouched}, изменено лишнего ${wrong}`);

// 4. выключенная группа не тронута
const orig = orig0();
const offOne = plan.changes.find((c) => c.lib + '|' + c.cat === OFF_KEY);
check('выключенная группа осталась прежней',
  offOne && v4.get(offOne.name).attrs.get('texture') === orig.get(offOne.name).attrs.get('texture') &&
  v4.get(offOne.name).attrs.get('src_image') === orig.get(offOne.name).attrs.get('src_image'),
  offOne && offOne.name);

// 5. ручная правка сильнее переноса
const radar = v4.get('v4_hud_radar_wnd');
check('ручная правка поверх переноса',
  radar.attrs.get('texture') === 'textures/ui/v5_common' && radar.attrs.get('src_image') === '10,20,177,177',
  `${radar.attrs.get('texture')} ${radar.attrs.get('src_image')}`);

// 6. то же — в локализованной копии, иначе игра не увидит
check('l10n: перенос тоже там', v4l10n.get(moved.name).attrs.get('texture') === 'textures/ui/' + moved.ship,
  v4l10n.get(moved.name).attrs.get('texture'));

// 7. имена и число скинов не изменились, пресеты целы
// скинов больше ровно на дописанные для окон HUD, ни один старый не пропал
// (плюс то, что зовут поправленные обычные окна — полоса под вкладками)
const hudAdd = require('../src/core/hudport').plan(client, d, 'rus', profile.classic.hud);
const fixAdd = require('../src/core/dialogfix').plan(client, d, 'rus');
const added = (kind) => new Set([...hudAdd[kind], ...fixAdd[kind]].map((n) => n.attrs.get('name'))).size;
check('число скинов: старые + дописанные для окон', v4.size === orig.size + added('skins') &&
  [...orig.keys()].every((k) => v4.has(k)), `${orig.size} + ${added('skins')} -> ${v4.size}`);
let presets = 0;
for (const n of readLib(preloadPath, 'version4.xml').walk()) if (n.name === 'Preset') presets++;
check('пресеты: старые + дописанные', presets === 313 + added('presets'), presets + ' шт.');
// вкладки окна «Статус» — как в официальном v3_player_info_dialog, а не
// вкладки карты; подсветка строк списков (v4_item_over) не стала кнопкой
const v4now = new Map([...readLib(preloadPath, 'version4.xml').walk()]
  .filter((n) => n.name === 'Skin').map((n) => [n.attrs.get('name'), n]));
const tabUp = v4now.get('v4_tab_button_up');
check('вкладки — пара через окна (v3_tab01_button)',
  /cl_v3_common_01$/i.test(tabUp.attrs.get('texture')) && tabUp.attrs.get('src_left_middle') === '266,474,13,26' &&
  v4now.get('v4_item_over').attrs.get('texture') === orig.get('v4_item_over').attrs.get('texture'),
  `${tabUp.attrs.get('texture')} ${tabUp.attrs.get('src_left_middle')}`);
// рамки окон — рамка новых окон официального; подсказки (код) не тронуты
const donorFrame = (n) => [...bxml.parse(d.preload().get('version3.xml') || Buffer.alloc(0)).root.walk()]
  .find((x) => x.name === 'Skin' && x.attrs.get('name') === n);
const framed = ['v4_dialog2', 'v4_dialog3', 'v4_dialog4', 'v4_msgbox3', 'v4_popup2'];
const dlg02 = donorFrame('v3_dialog02');
check('рамки окон — новые (лавка, союз, карта, меню), подсказки прежние',
  framed.every((n) => /^textures\/ui\/cl_/i.test(v4now.get(n).attrs.get('texture'))) &&
  (!dlg02 || v4now.get('v4_dialog4').attrs.get('src_left_top') === dlg02.attrs.get('src_left_top')) &&
  v4now.get('v4_tooltip').attrs.get('texture') === orig.get('v4_tooltip').attrs.get('texture'),
  framed.map((n) => n + '→' + v4now.get(n).attrs.get('texture').split('/').pop()).join(' '));

// 8. наш ui.pak не тронут — атласы донора лежат рядом, а не вместо
const uiPak = path.join(sandbox, 'textures', 'ui', 'ui.pak');
check('textures/ui/ui.pak не тронут', fs.readFileSync(uiPak).equals(fs.readFileSync(pristine('textures/ui/ui.pak'))), '');

// 8а. окна HUD официального Classic
const hudport = require('../src/core/hudport');
const l10nDialog = (name) => bxml.parse(pak.readSome(l10nPath, dllPath, [name]).get(name)).root;
const wnames = (root) => [...root.walk()].filter((n) => n.name === 'Widget').map((n) => n.attrs.get('name'));
const qb = l10nDialog('UI/game_hud_s2/quickbar_dialog.xml');
check('HUD: панель умений — официальная',
  /,140$/.test(qb.attrs.get('frame')) &&
  qb.kids.find((k) => k.attrs.get('name') === 'ctn_shortcut').kids.every((s) => s.attrs.get('preset') === 'v3_quickbar_slot'),
  qb.attrs.get('frame'));
const qbData = pak.readSome(path.join(sandbox, 'data', 'ui', 'game_hud_s2', 'game_hud_s2.pak'), dllPath,
  ['quickbar_dialog.xml']).get('quickbar_dialog.xml');
check('HUD: и в data/ui тоже', bxml.parse(qbData).root.attrs.get('frame') === qb.attrs.get('frame'), '');
const bs = l10nDialog('UI/game_hud_s2/basic_status_dialog.xml');
check('HUD: герб возвращён, чужие полосы убраны',
  wnames(bs).includes('emblem') && !wnames(bs).includes('sp_gauge') && !wnames(bs).includes('portrait'),
  wnames(bs).join(' '));
const party = l10nDialog('UI/game/party_dialog.xml');
const members = party.kids.filter((k) => /^ctn_member/.test(k.attrs.get('name') || ''));
check('HUD: у каждого участника свой fly_gauge и нет sp/ep/death',
  members.length > 0 && members.every((m) => {
    const n = m.kids.map((k) => k.attrs.get('name'));
    return n.includes('fly_gauge') && !n.includes('sp') && !n.includes('ep') && !n.includes('death') && !n.includes('fly_gauge01');
  }), members.length + ' участников');
// все виджеты наших окон на месте — код их найдёт
const ourAll = (name) => bxml.parse(pak.readSome(pristine('l10n/rus/data/data.pak'), dllPath, [name]).get(name)).root;
// все узлы библиотек после сборки
const libsNow0 = function* () {
  for (const [k, buf] of pak.readPak(preloadPath, dllPath)) {
    if (!/\.xml$/i.test(k)) continue;
    try { yield* bxml.parse(buf).root.walk(); } catch (e) { /* не библиотека */ }
  }
};
for (const d of hudport.DIALOGS) {
  const name = hudport.L10N_PREFIX[d.key] + d.entry;
  // battlepass_bg убирается нарочно: game.dll этого имени не знает;
  // fly_gauge переезжает из меню в окно карты (проверяется ниже)
  const mine = new Set(wnames(ourAll(name)).filter(Boolean).map((s) => s.toLowerCase())
    .filter((s) => s !== 'battlepass_bg' && !(d.entry === 'start_dialog.xml' && s === 'fly_gauge')));
  const now = new Set(wnames(l10nDialog(name)).filter(Boolean).map((s) => s.toLowerCase()));
  const lost = [...mine].filter((w) => !now.has(w));
  check('HUD: ' + d.entry + ' — все наши виджеты на месте', !lost.length, lost.join(' ') || '');
}
// цель — общее окно: стоит там же, где стояла наша (центр), и закреплена
// цель: середина на прежнем месте, окно подвижное — в s2 её место держит
// игра, ставится мышью; окно HP/MP больше не расширяется
// цель: официальная, середина на месте наших (в s2 место всё равно держит игра)
const tg = l10nDialog('UI/game/target_dialog.xml');
const tf = tg.getFrame();
check('HUD: цель — официальная, середина на месте',
  Math.abs(tf.x + tf.w / 2 - (508 + 274 / 2)) <= 1 && tf.w === 372, `${tg.attrs.get('frame')} ${tg.attrs.get('flag')}`);
// отдельные панели: официальный вид, заготовки ячеек своего типа, номер панели в каждом варианте
const sep = l10nDialog('UI/game/quickbar_dialog_sep.xml');
const sepCont = sep.kids.filter((k) => /^container[0-3]$/.test(k.attrs.get('name') || ''));
check('HUD: отдельные панели — официальный вид, номер панели и ячейки свои',
  sepCont.length === 4 && sepCont.every((c) => {
    const all = [...c.walk()];
    return all.some((x) => x.attrs.get('preset') === 'v3_shortcut_sep_bg') &&
      all.filter((x) => x.attrs.get('name') === 'sep_index').length === 1 &&
      all.filter((x) => /^shortcut\d+$/.test(x.attrs.get('name') || '')).every((x) => x.attrs.get('type') === 'container');
  }), sepCont.map((c) => c.attrs.get('frame')).join(' | '));
// обычные окна: зазор строк в таблицах и полоса под вкладками (dialogfix)
const sk = l10nDialog('UI/game/skill_dialog.xml');
const skw = (n) => [...sk.walk()].find((x) => x.attrs.get('name') === n);
const piTab = [...l10nDialog('UI/game/player_info_dialog.xml').walk()].find((x) => x.attrs.get('type') === 'tab');
const exch = [...l10nDialog('UI/game/macro_name_dialog.xml').walk()].find((x) => x.attrs.get('name') === 'icon_list');
check('окна: зазор строк в списке умений, полоса под вкладками, сетки иконок не тронуты',
  skw('active_skill_list').attrs.get('cell_space') === '3,2' && skw('tab').attrs.get('preset') === 'v3_tab_line' &&
  piTab.attrs.get('preset') === 'v3_tab_line' && [...libsNow0()].some((n) => n.name === 'Preset' && n.attrs.get('name') === 'v3_tab_line') &&
  (!exch || (exch.attrs.get('cell_space') || '0,0') === (ourAll('UI/game/macro_name_dialog.xml') && [...ourAll('UI/game/macro_name_dialog.xml').walk()]
    .find((x) => x.attrs.get('name') === 'icon_list').attrs.get('cell_space') || '0,0')),
  `${skw('active_skill_list').attrs.get('cell_space')} ${skw('tab').attrs.get('preset')}`);
// вкладки умений встык и до кнопки «Серии»; ползунки — официальные
const skTabs = skw('tab').kids.filter((k) => k.attrs.get('type') === 'tabbutton').map((k) => k.getFrame())
  .sort((a, b) => a.x - b.x);
const serii = skw('open_skill_dic').getFrame();
check('окна: вкладки умений встык, до кнопки «Серии»',
  skTabs[0].x === 0 && skTabs.every((f, i) => !i || f.x === skTabs[i - 1].x + skTabs[i - 1].w) &&
  skTabs[skTabs.length - 1].x + skTabs[skTabs.length - 1].w <= serii.x,
  skTabs.map((f) => f.x + '+' + f.w).join(' ') + ' | «Серии» ' + serii.x);
check('ползунки — официальные (create_custom_slide)',
  [...libsNow0()].some((n) => n.name === 'Skin' && n.attrs.get('name') === 'v4_slider_button_up' &&
    /cl_ui_create_01/i.test(n.attrs.get('texture'))), '');
// значки меню и куб рядом с лавкой — по ручным таблицам
const v4after = new Map([...libsNow0()].filter((n) => n.name === 'Skin').map((n) => [n.attrs.get('name'), n]));
check('значки меню однотонные официальные, куб у лавки в новой рамке и вкладках',
  ['v4_start_menu_10_up', 'v4_start_menu_5_up', 'v4_start_menu_pet_up', 'v4_inv_frame', 'v4_inv_tab_up']
    .every((n) => /^textures\/ui\/cl_/i.test(v4after.get(n).attrs.get('texture'))),
  ['v4_start_menu_10_up', 'v4_inv_tab_up'].map((n) => v4after.get(n).attrs.get('texture') + ' ' +
    (v4after.get(n).attrs.get('src_image') || v4after.get(n).attrs.get('src_left_middle'))).join(' | '));
check('HUD: окно HP/MP прежней официальной ширины', bs.getFrame().w === 384, bs.attrs.get('frame'));
// значки и кнопки меню — выше полосы опыта (её 16 + зазор)
const scr0 = hudport.screenOf(client);
const iconBottom = Math.max(...['btn_radar_map', 'btn_quna_shop', 'btn_battlepass'].map((n) => {
  const f = l10nDialog('UI/game_hud_s2/radar_dialog.xml').kids.find((k) => k.attrs.get('name') === n).getFrame();
  return f.y + f.h;
}));
check('HUD: значки выше полосы опыта', iconBottom <= scr0.h - 16 - 4, `низ значков ${iconBottom}, экран ${scr0.h}`);
// мини-карта — окно наше, от официального только рамка; круг прежнего размера
const rd = l10nDialog('UI/game_hud_s2/radar_dialog.xml');
const rw = (n) => rd.kids.find((k) => k.attrs.get('name') === n);
const bg = rw('radar_bg') && rw('radar_bg').getFrame();
check('HUD: мини-карта — рамка официальная, круг как был (177)',
  !!bg && rw('radar_sight').attrs.get('type') === 'image' && rw('radar_sight').attrs.get('frame').endsWith('177,177') &&
  !rd.attrs.has('preset'), rd.attrs.get('frame'));
const cornerIcons = ['mail_notice', 'btn_radar_map', 'btn_quna_shop', 'btn_battlepass', 'item_shop'];
check('HUD: значки — внизу, внутри окна карты, в официальном виде',
  cornerIcons.every((n) => rw(n).getFrame().y > bg.y + bg.h && rw(n).getFrame().x >= 0) &&
  rw('mail_notice').attrs.get('preset') === 'v3_mail' && rw('btn_battlepass').attrs.get('preset') === 'v3_devapass' &&
  !rw('battlepass_bg') && rd.getFlags().includes('transparent'),
  cornerIcons.map((n) => rw(n).attrs.get('frame')).join(' | '));
// панель умений шириной в экран, ряд ячеек — по центру экрана (с учётом меню)
const ctn = qb.kids.find((k) => k.attrs.get('name') === 'ctn_shortcut').getFrame();
const scr = hudport.screenOf(client);
check('HUD: панель умений в экран, ряд по центру',
  qb.getFrame().w === scr.w && ctn.x + ctn.w / 2 === (scr.w + hudport.START_W) / 2 && qb.getFlags().includes('transparent'),
  `${qb.attrs.get('frame')} ряд ${ctn.x}+${ctn.w}`);
const ex = l10nDialog('UI/game_hud_s2/exp_bar_dialog.xml');
const expW = Math.round(scr.w * 1.05); // с запасом на масштаб
check('HUD: полоса опыта в экран с запасом', ex.getFrame().w === expW &&
  ex.kids.filter((k) => k.name === 'Widget').every((k) => k.getFrame().w === expW), ex.attrs.get('frame'));
// меню: наше окно, официальные значки, кнопки в видимой (левой) половине
const st = l10nDialog('UI/game_hud_s2/start_dialog.xml');
const sw = (n) => st.kids.find((k) => k.attrs.get('name') === n);
check('HUD: меню — наши кнопки, официальный вид, в видимой половине',
  st.getFrame().w === hudport.START_W && !st.attrs.has('preset') &&
  sw('start_button').attrs.get('preset') === 'cl_gamemenu' && sw('prophet_button').attrs.get('preset') === 'cl_wars' &&
  !sw('fly_gauge') &&
  ['start_button', 'prophet_button'].every((n) => sw(n).getFrame().x + sw(n).getFrame().w <= hudport.START_W / 2),
  ['start_button', 'prophet_button'].map((n) => sw(n).attrs.get('frame')).join(' | '));
// полёт — в окне карты, в гнезде, с гибридным пресетом (кольцо времени наше)
const fg = rw('fly_gauge');
const flyPre = [...libsNow0()].find((n) => n.name === 'Preset' && n.attrs.get('name') === 'cl_fly_gauge');
check('HUD: полёт — в окне карты, гибридный пресет с кольцом времени',
  !!fg && fg.attrs.get('type') === 'flygauge' && fg.attrs.get('preset') === 'cl_fly_gauge' && !!flyPre &&
  flyPre.kids.some((r) => r.attrs.get('state') === 'fly_time' && r.attrs.get('name') === 'v4_fly_gauge_fly_time') &&
  flyPre.kids.some((r) => r.attrs.get('state') === 'normal' && /^v3_/.test(r.attrs.get('name'))),
  fg ? fg.attrs.get('frame') : 'нет');
// меню — последним в списке окон набора (поверх растянутого окна карты)
const scrList = bxml.parse(pak.readSome(l10nPath, dllPath, ['UI/ui_gamehud_s2.xml']).get('UI/ui_gamehud_s2.xml')).root
  .kids.map((k) => k.attrs.get('name'));
check('HUD: меню поверх окна карты', scrList[scrList.length - 1] === 'start_dialog' &&
  scrList.indexOf('radar_dialog') < scrList.indexOf('start_dialog'), scrList.join(' > '));
// время — не под лупой
const ts = rw('time_slot').getFrame();
const bz = rw('btn_zoom').getFrame();
const overlap = !(ts.x >= bz.x + bz.w || bz.x >= ts.x + ts.w || ts.y >= bz.y + bz.h || bz.y >= ts.y + ts.h);
check('HUD: значок времени не под лупой', !overlap, `время ${rw('time_slot').attrs.get('frame')}, лупа ${rw('btn_zoom').attrs.get('frame')}`);
// меню и влияние: все наши состояния есть, «меню открыто» — нажатая картинка
const menuPre = [...libsNow0()].find((n) => n.name === 'Preset' && n.attrs.get('name') === 'cl_gamemenu');
const warsPre = [...libsNow0()].find((n) => n.name === 'Preset' && n.attrs.get('name') === 'cl_wars');
check('HUD: меню и влияние — все 6 состояний, «открыто» = нажатая',
  !!menuPre && !!warsPre && [menuPre, warsPre].every((p) => p.kids.filter((r) => r.name === 'SkinRef').length === 6) &&
  menuPre.kids.filter((r) => r.attrs.get('main_state') === '1').every((r) => r.attrs.get('name') === 'v3_gamemenu_down'),
  menuPre ? menuPre.kids.map((r) => (r.attrs.get('main_state') || '') + '/' + r.attrs.get('sub_state') + '=' + r.attrs.get('name')).join(' ') : 'нет');
// ряды 2 и 3 и боковая панель — шаг ячеек официальный, флаги наши
for (const [n, w, h] of [['ctrl', 502, 40], ['alt', 502, 40], ['extra', 40, 502]]) {
  const name = 'UI/game/quickbar_dialog_' + n + '.xml';
  const dlg = l10nDialog(name);
  const slots = [...dlg.walk()].filter((x) => /^shortcut\d+$/.test(x.attrs.get('name') || ''));
  check(`HUD: панель умений ${n} — ${w}×${h}, ячейки официальные, флаги наши`,
    dlg.getFrame().w === w && dlg.getFrame().h === h && slots.length === 12 &&
    slots.every((s) => s.attrs.get('preset') === 'v3_quickbar_slot' && s.getFrame().w === 40) &&
    dlg.attrs.get('flag') === ourAll(name).attrs.get('flag'),
    `${dlg.attrs.get('frame')} ${dlg.attrs.get('flag')}`);
}
// по умолчанию значки под картой: окно карты обычной высоты, список окон не трогается
const planDefault = hudport.plan(client, d, 'rus', { off: {}, set: 's2' });
const rdDefault = bxml.parse(planDefault.dialogs.find((x) => x.entry === 'radar_dialog.xml').data).root;
check('HUD: по умолчанию окно карты не тянется до низа (боковой панели есть место)',
  hudport.ICONS_DEFAULT === 'under' && rdDefault.getFrame().h < scr.h / 2 && !planDefault.screens.l10n.size,
  rdDefault.attrs.get('frame'));

// всё, что зовут перенесённые окна, есть в наших библиотеках, а атласы — в клиенте
const libsNow = new Map();
for (const [k, buf] of pak.readPak(preloadPath, dllPath)) {
  if (!/\.xml$/i.test(k)) continue;
  try { for (const n of bxml.parse(buf).root.walk()) if (n.attrs.get('name')) libsNow.set(n.name + ':' + n.attrs.get('name'), n); } catch (e) {}
}
const unresolved = [];
const texMissing = [];
const ourAtlases = new Set();
for (const [k] of shipped) ourAtlases.add('textures/ui/' + k.replace(/\.dds$/, ''));
const ourFind = donor.ourFinder(client, 'rus');
for (const d of hudport.DIALOGS) {
  for (const n of l10nDialog(hudport.L10N_PREFIX[d.key] + d.entry).walk()) {
    const pr = n.attrs.get('preset');
    const refs = [];
    if (pr) {
      const node = libsNow.get('Preset:' + pr);
      if (!node) { unresolved.push('пресет ' + pr); continue; }
      for (const r of node.kids) if (r.name === 'SkinRef') refs.push(r.attrs.get('name'));
    }
    if (n.name === 'Skin') refs.push(n.attrs.get('name'));
    for (const s of refs) {
      const sk = libsNow.get('Skin:' + s);
      if (!sk) { unresolved.push('скин ' + s); continue; }
      const t = donor.normTex(sk.attrs.get('texture'));
      if (t && !ourAtlases.has(t) && !ourFind.resolve(t)) texMissing.push(s + '→' + t);
    }
  }
}
// «пресеты» v5_party_death_gauge* нет и у самого официального клиента — их не считаем
const realUnresolved = [...new Set(unresolved)].filter((x) => !/v5_party_death_gauge/.test(x));
check('HUD: все пресеты и скины окон найдутся', !realUnresolved.length, realUnresolved.slice(0, 8).join(' '));
check('HUD: все атласы скинов окон есть', !texMissing.length, [...new Set(texMissing)].slice(0, 6).join(' '));
check('HUD: набор s1 не тронут', pak.readSome(path.join(sandbox, 'data', 'ui', 'game_hud_s1', 'game_hud_s1.pak'), dllPath,
  ['quickbar_dialog.xml']).get('quickbar_dialog.xml').equals(pak.readSome(pristine('data/ui/game_hud_s1/game_hud_s1.pak'),
  dllPath, ['quickbar_dialog.xml']).get('quickbar_dialog.xml')), '');

// 8б. «Стиль Aion» (s1): те же официальные окна — в наборе s1, s2 не тронут
check('HUD: по умолчанию новый HUD ставится в «Стиль Aion» (s1)', hudport.plan(client, d, 'rus', {}).set === 's1', '');
build.apply(client, Object.assign({}, profile, {
  classic: Object.assign({}, profile.classic, { hud: { enabled: true, off: {}, set: 's1' } }),
}), () => {});
const s1 = (n) => l10nDialog('UI/game_hud_s1/' + n);
const s1bs = s1('basic_status_dialog.xml');
const s1portrait = [...s1bs.walk()].find((x) => x.attrs.get('name') === 'portrait');
const s1qb = s1('quickbar_dialog.xml');
const s1st = s1('start_dialog.xml');
const s2qbNow = pak.readSome(l10nPath, dllPath, ['UI/game_hud_s2/quickbar_dialog.xml']).get('UI/game_hud_s2/quickbar_dialog.xml');
const s2qbOrig = pak.readSome(pristine('l10n/rus/data/data.pak'), dllPath, ['UI/game_hud_s2/quickbar_dialog.xml'])
  .get('UI/game_hud_s2/quickbar_dialog.xml');
check('HUD s1: полосы официальные, портрет — наша 3D-модель на месте официального',
  s1bs.attrs.get('preset') === 'v3_hud_char' && s1portrait && s1portrait.attrs.get('type') === '3dview' &&
  !wnames(s1bs).includes('emblem'), s1portrait ? s1portrait.attrs.get('frame') : 'нет портрета');
check('HUD s1: панель умений официальная, без растяжки под s2', s1qb.getFrame().w === 541 &&
  s1qb.attrs.get('h_pos_align') === 'center', s1qb.attrs.get('frame'));
// у официального полоса опыта шириной 1920 — в s1 уезжала вправо от середины (27.09)
const s1exp = s1('exp_bar_dialog.xml');
const s1expOwn = bxml.parse(pak.readSome(pristine('l10n/rus/data/data.pak'), dllPath,
  ['UI/game_hud_s1/exp_bar_dialog.xml']).get('UI/game_hud_s1/exp_bar_dialog.xml')).root;
check('HUD s1: полоса опыта своя (официальная в s1 уезжает вправо)',
  s1exp.attrs.get('frame') === s1expOwn.attrs.get('frame') && s1exp.kids.length === s1expOwn.kids.length,
  s1exp.attrs.get('frame') + ' / наша ' + s1expOwn.attrs.get('frame'));
check('HUD s1: меню на своём месте, значки официальные', s1st.getFrame().w === 104 && !s1st.attrs.has('preset') &&
  s1st.kids.some((k) => k.attrs.get('preset') === 'cl_gamemenu'), s1st.attrs.get('frame'));
check('HUD s1: набор s2 не тронут', s2qbNow.equals(s2qbOrig), '');
build.apply(client, profile, () => {}); // обратно к s2 — дальше проверки на нём

// 8в. карты: перекрашенная зона заменена байт в байт, та же картинка не тронута
const mapsLib = require('../src/core/maps');
const mp = mapsLib.plan(client, d);
const tiamat = mp.tiles.filter((t) => /tiamat_down/.test(t.rel));
const tdPak = path.join(sandbox, 'textures', 'ui', 'newmap', 'tiamat_down', 'tiamat_down.pak');
const tdNow = pak.readPak(tdPak, dllPath);
const tdTheirs = d.readAtlases(new Map(tiamat.map((t) => [t.entry, t.from])), 'rus');
check('карты: tiamat_down заменён официальным',
  tiamat.length > 0 && tiamat.every((t) => tdNow.get(t.entry).equals(tdTheirs.get(t.entry))), tiamat.length + ' тайлов');
check('карты: df4 (та же картинка) не тронут',
  fs.readFileSync(path.join(sandbox, 'textures', 'ui', 'newmap', 'df4', 'df4.pak'))
    .equals(fs.readFileSync(pristine('textures/ui/newmap/df4/df4.pak'))), '');
check('карты: зона с другой местностью не в списке', !mp.tiles.some((t) => /\/(lc1|dc1)\//.test(t.rel)), '');
build.apply(client, Object.assign({}, profile, { classic: Object.assign({}, profile.classic, { maps: false }) }), () => {});
check('карты: сняли галочку — пак штатный',
  fs.readFileSync(tdPak).equals(fs.readFileSync(pristine('textures/ui/newmap/tiamat_down/tiamat_down.pak'))), '');
build.apply(client, profile, () => {});

// 8б. источник «новый вид» выключен — пара v3 не применяется
if (fresh) {
  build.apply(client, Object.assign({}, profile, {
    classic: Object.assign({}, profile.classic, { rules: { v3: false } }),
  }), () => {});
  const t = byName(readLib(preloadPath, 'version4.xml')).get(fresh.name).attrs.get('texture');
  check('выключили новый вид — v3 не применён', t !== 'textures/ui/' + fresh.ship || fresh.ship ===
    (donor.pick(plan, { rules: { v3: false } }).get('version4.xml|' + fresh.name) || {}).ship, t);
}

// 9. выключили вид, окна оставили — в паке только атласы окон
build.apply(client, Object.assign({}, profile, { classic: Object.assign({}, profile.classic, { enabled: false }) }),
  () => {});
const onlyHud = fs.existsSync(zz) ? [...pak.readPak(zz, dllPath).keys()].map((k) => k.replace(/\.dds$/, '')) : [];
check('только окна — в паке только их атласы',
  onlyHud.length === hudShips.size && onlyHud.every((s) => hudShips.has(s)), onlyHud.join(' '));
// выключили и окна — пак убирается
build.apply(client, Object.assign({}, profile, { classic: Object.assign({}, profile.classic,
  { enabled: false, hud: { enabled: false } }) }), () => {});
check('выключили всё — пак убран', !fs.existsSync(zz), '');

// 10. «Вернуть как было» убирает пак и возвращает preload
build.apply(client, profile, () => {});
client.restoreAll();
check('возврат убрал пак', !fs.existsSync(zz), '');
const back = byName(readLib(preloadPath, 'version4.xml'));
check('возврат вернул скины', back.get(moved.name).attrs.get('texture') === orig.get(moved.name).attrs.get('texture'),
  back.get(moved.name).attrs.get('texture'));
check('возврат вернул карты',
  fs.readFileSync(tdPak).equals(fs.readFileSync(pristine('textures/ui/newmap/tiamat_down/tiamat_down.pak'))), '');
check('возврат вернул окна HUD',
  l10nDialog('UI/game_hud_s2/quickbar_dialog.xml').attrs.get('frame') === '0,867,967,93',
  l10nDialog('UI/game_hud_s2/quickbar_dialog.xml').attrs.get('frame'));

let bad = 0;
for (const [name, ok, extra] of checks) {
  if (!ok) bad++;
  console.log((ok ? '  ok   ' : '  МИМО ') + name.padEnd(38) + (extra || ''));
}
fs.rmSync(sandbox, { recursive: true, force: true });
console.log(bad ? 'провалов: ' + bad : 'перенос вида официального Classic проверен');
process.exit(bad ? 1 : 0);
