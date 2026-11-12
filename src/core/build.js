'use strict';
/**
 * Применение профиля: из описания правок собираем настоящие паки клиента.
 *
 * Всё, что делает сборщик, обратимо: перед первой записью каждого штатного
 * пака рядом кладётся его копия, а свои файлы (шрифт, иконки) просто удаляются.
 */

const fs = require('fs');
const path = require('path');
const pak = require('./pak');
const bxml = require('./bxml');
const hud = require('./hud');
const dds = require('./dds');
const portrait = require('./portrait');
const skins = require('./skins');
const v5 = require('./v5');
const donor = require('./donor');
const hudport = require('./hudport');
const dialogfix = require('./dialogfix');
const maps = require('./maps');
const usermaps = require('./usermaps');
const running = require('./running');
const { PACKS, BUILDER_PAK } = require('./client');
const look = require('./look');
const radar = require('./radar');
const calib = require('./calib');
const arrange = require('./arrange');
const elementsLib = require('./elements');

/** Имена, под которыми клиент ищет шрифты в Fonts\. CJK-гарнитуру не трогаем. */
const FONT_NAMES = ['CALIBRI.TTF', 'MYRIADPR.TTF', 'RomicCyr.ttf'];

/**
 * @param {import('./client').Client} client
 * @param {object} profile
 * @param {(msg: string) => void} log
 * @param {{dry?: boolean}} [opts] dry — сборка в памяти для предпросмотра
 *   редактора: тот же путь, но вместо записи всё, что легло бы в паки,
 *   складывается в `report.dry` (см. ниже), клиент не трогается.
 */
function apply(client, profile, log, opts) {
  let transaction = null;
  try {
  const say = log || (() => {});
  const report = { paks: [], files: 0, dialogs: 0 };
  const lang = profile.lang || 'rus';
  const dry = !!(opts && opts.dry);
  /**
   * paks: ключ пака -> (запись -> содержимое); l10n: запись data.pak -> содержимое;
   * images: пак -> подменённые картинки; atlases: свои атласы программы (имя.dds -> DDS);
   * donor/shipLocs/made — атласы донора читаются по требованию, а не все разом.
   */
  const out = dry ? { paks: new Map(), l10n: new Map(), images: new Map(), atlases: new Map(),
    donor: null, shipLocs: new Map(), made: new Map() } : null;
  if (dry) report.dry = out;

  // Пока клиент открыт, паки заняты, и запись свалится на середине списка.
  // Проверяем всё разом до первой правки, чтобы не оставить полусобранный набор.
  if (!dry) {
    running.assertWritable(client.writeTargets(lang), client.root);
    transaction = client.beginTransaction(lang);
  }

  /*
   * Локализованный пак пишется РОВНО ОДИН РАЗ, в самом конце. Каждая запись
   * начинает с резервной копии, поэтому второй заход стёр бы первый — на этом
   * уже обжигались. Все разделы складывают правки сюда.
   */
  const l10nChanges = new Map();

  // --- клиент-донор: вид и окна официального Classic -----------------------
  // Читается один раз и нужен двум разделам: переносу скинов (ниже) и
  // переносу окон HUD, которые подменяют основу для раскладки (сразу ниже).
  const cl = profile.classic || {};
  // что включено: микшер вида (profile.look) или старые галочки целиком
  const mix = look.resolve(profile);
  const wantHud = mix.hud;
  let donorObj = null;
  if (cl.root && (mix.classic || mix.hud || mix.fix || mix.maps)) {
    donorObj = new donor.Donor(cl.root);
    const chk = donorObj.check();
    if (!chk.ok) throw new Error('клиент-донор ' + cl.root + ': не хватает ' + chk.missing.join(', '));
  }
  const shipLocs = new Map(); // атлас донора в нашем паке -> где он лежит у донора
  const madeAtlases = new Map(); // свои атласы из картинок донора -> готовый DDS

  const overrides = new Map(); // 'hud_s2/quickbar_dialog.xml' -> окно официального
  let hudPlan = null;
  if (donorObj && wantHud) {
    hudPlan = hudport.plan(client, donorObj, lang, cl.hud);
    for (const d of hudPlan.dialogs) {
      if (!d.on) continue;
      if (d.error) { say(`окна HUD: ${d.title} — пропуск, ${d.error}`); continue; }
      overrides.set(d.id, d.data);
      if (d.restyle) { say(`окна HUD: ${d.title} — окно твоё, рамка официальная`); continue; }
      say(`окна HUD: ${d.title} — официальное` +
          `${d.dropped.length ? `, убрано чужих виджетов ${d.dropped.length}` : ''}` +
          `${d.grafted.length ? `, возвращено своих: ${d.grafted.join(', ')}` : ''}`);
    }
    for (const [s, loc] of hudPlan.ships) shipLocs.set(s, loc);
    if (hudPlan.missing.length) say('окна HUD: у официального не нашлось ' + hudPlan.missing.join(', '));
  }

  // обычные окна: зазор строк в списках и полоса под вкладками, как у
  // официального (dialogfix). Окна HUD уже подменены выше — их не трогаем.
  let fixPlan = null;
  if (donorObj && mix.fix) {
    fixPlan = dialogfix.plan(client, donorObj, lang);
    let n = 0;
    for (const [id, data] of fixPlan.dialogs) {
      if (overrides.has(id)) continue;
      overrides.set(id, data);
      n++;
    }
    for (const [s, loc] of fixPlan.ships) shipLocs.set(s, loc);
    if (n) say(`вид официального Classic: окон со списками и вкладками как у официального — ${n}`);
    if (fixPlan.missing.length) say('вид официального Classic: не нашлось ' + fixPlan.missing.join(', '));
  }

  // --- раскладка и видимость -------------------------------------------
  // Портрет живёт в тех же диалогах, поэтому подмешиваем его к обычным правкам
  // и записываем всё одним проходом по паку.
  const layout = Object.assign({}, profile.layout || {});
  const p = profile.portrait;
  // Портрет есть только в наборе s1: в s2 вместо модели герб, трогать нечего.
  if (p && p.enabled) {
    const id = 'hud_s1/' + portrait.DIALOG_ENTRY;
    const cur = layout[id] || {};
    layout[id] = Object.assign({}, cur, {
      widgets: Object.assign({}, cur.widgets, portrait.widgetEdit(p).widgets),
    });
  }

  // сетка значков в окнах бафов (раздел «Бафы») — та же правка окна
  // режим разметки окон HUD (calib.js): рамка и рост у каждого окна стиля
  const wantCalib = !!(profile.calib && profile.calib.on);
  if (wantCalib) {
    const set = (cl.hud && cl.hud.set) || 's1';
    for (const id of calib.ids(set)) layout[id] = Object.assign({}, layout[id], { calib: calib.indexOf(id, set) });
    say(`разметка окон HUD: стиль ${set}, окон ${calib.WINDOWS.length}, рост +${calib.GROW.w}×${calib.GROW.h}`);
  }

  // раскладка HUD в «Стиле Aion» (arrange.js): размеры окон и сдвиг содержимого.
  // Считается по окнам, которые реально запишутся (официальные или свои).
  const ar = profile.arrange || {};
  if (!wantCalib && ((cl.hud && cl.hud.set) || 's1') === 's1' && ar.mapTopRight &&
      client.has('hud_s1')) {
    const own = client.original('hud_s1');
    const roots = {};
    for (const [k, id] of Object.entries(arrange.ID)) {
      const data = overrides.get(id) || own.get(id.split('/')[1]);
      if (!data) continue;
      roots[k] = bxml.parse(data).root;
      // ширину/высоту могли поменять в «Раскладке окон» — считаем по тому, что запишется
      if (layout[id] && layout[id].frame) hud.applyEdit(roots[k], { frame: layout[id].frame });
    }
    const edits = arrange.plan(roots, hudport.screenOf(client), ar);
    for (const [id, e] of edits) layout[id] = Object.assign({}, layout[id], { arrange: e });
    if (edits.size) {
      say('раскладка «Стиля Aion»: карта в правый верхний угол');
    }
  }

  // квадратная мини-карта: подложка официального шире карты — прячем, рамка обнимает карту
  if (profile.radar && profile.radar.square) {
    for (const id of ['hud_s1/radar_dialog.xml', 'hud_s2/radar_dialog.xml']) {
      const cur = layout[id] || {};
      const widgets = Object.assign({}, cur.widgets);
      for (const w of radar.HIDE_WIDGETS) widgets[w] = Object.assign({}, widgets[w], { visible: false });
      layout[id] = Object.assign({}, cur, { widgets });
    }
  }

  // С привязкой игры окна бафов ставит сама игра — их можно только сдвинуть
  // влево расширением окна. Окну со своим местом (hudFree) сдвиг не нужен:
  // его место задаётся рамкой, а лишняя ширина только ловила бы клики.
  const freeIds = new Set(Object.keys(profile.hudFree || {}).filter((k) => profile.hudFree[k] && hud.FREE_WINDOWS[k])
    .flatMap((k) => hud.FREE_WINDOWS[k]));
  for (const [id, g] of Object.entries(profile.buffs || {})) {
    if (g && (g.size || g.perRow || g.left)) {
      const left = freeIds.has(id) ? 0 : g.left;
      layout[id] = Object.assign({}, layout[id], { grid: { size: g.size, perRow: g.perRow, left } });
    }
  }

  // окна HUD, которые таскаются мышью в игре (место живёт до перезахода —
  // игра его не хранит и координаты файла для этих окон не берёт)
  const free = Object.keys(profile.hudFree || {}).filter((k) => profile.hudFree[k] && hud.FREE_WINDOWS[k]);
  for (const k of free) {
    for (const id of hud.FREE_WINDOWS[k]) {
      const key = id.split('/')[0];
      if (client.has(key) && client.original(key).has(id.split('/')[1])) {
        layout[id] = Object.assign({}, layout[id], { free: true });
      }
    }
  }
  if (free.length) say(`окна двигаются мышью в игре: ${free.join(', ')}`);
  // Ряды Ctrl/Alt с привязкой игра кладёт стопкой над основным рядом панели и x/y
  // не смотрит; без привязки ставит строго по файлу — а там ряд Alt наполовину
  // под основным рядом. Ставим стопкой сами: Ctrl над основным рядом, Alt над Ctrl.
  if (free.includes('ctrl') || free.includes('alt')) {
    const mainId = ((cl.hud && cl.hud.set) === 's2' ? 'hud_s2' : 'hud_s1') + '/quickbar_dialog.xml';
    const dlgOf = (id) => {
      const [key, entry] = id.split('/');
      const data = overrides.get(id) || (client.has(key) ? client.original(key).get(entry) : null);
      return data ? [...bxml.parse(data).root.walk()].find((n) => n.name === 'Dialog') : null;
    };
    const main = dlgOf(mainId);
    // основную панель игра ставит сама — от её места в файле, правки рамки не в счёт
    const mf = main && main.getFrame();
    const ctn = main && main.kids.find((k) => k.attrs.get('name') === 'ctn_shortcut');
    const cf = ctn && ctn.getFrame();
    if (mf && cf) {
      let y = mf.y + cf.y;
      for (const [k, id] of [['ctrl', 'game/quickbar_dialog_ctrl.xml'], ['alt', 'game/quickbar_dialog_alt.xml']]) {
        const row = dlgOf(id);
        const rf = row && row.getFrame();
        if (!rf) continue;
        y -= rf.h + 3;
        // место, заданное вручную в «Раскладке окон», главнее
        if (!free.includes(k) || (profile.layout && profile.layout[id] && profile.layout[id].frame)) continue;
        layout[id] = Object.assign({}, layout[id], { frame: { x: mf.x + cf.x, y } });
      }
      say('ряды умений Ctrl/Alt: стопкой над основным рядом панели');
    }
  }

  // «сделать отдельным» (редактор): в окне ссылки переводятся на копию элемента,
  // сама копия появляется в библиотеке скинов ниже (elements.applySplits)
  const splits = Array.isArray(profile.splits) ? profile.splits.filter((s) => s && s.win && s.el) : [];
  for (const s of splits) {
    const cur = layout[s.win] || {};
    layout[s.win] = Object.assign({}, cur, { split: [...(cur.split || []), s] });
  }

  const byPak = new Map();
  const addEdit = (id, edit) => {
    const cut = id.indexOf('/');
    const key = id.slice(0, cut);
    const entry = id.slice(cut + 1);
    if (!byPak.has(key)) byPak.set(key, new Map());
    byPak.get(key).set(entry, edit);
  };
  for (const [id, edit] of Object.entries(layout)) addEdit(id, edit);
  // перенесённое окно пишется, даже если раскладку в нём не трогали
  for (const id of overrides.keys()) if (!layout[id]) addEdit(id, null);

  /**
   * Окно с правками: основа — официальное, если его переносим, иначе своё.
   * Правки раскладки ложатся поверх — имена наших виджетов в перенесённом
   * окне сохранены. @returns {Buffer|null} null — менять нечего
   */
  const buildDialog = (id, own, edit) => {
    const base = overrides.get(id);
    const data = base || own;
    if (!data) return null;
    if (!edit) return base || null;
    const { root, strings } = bxml.parse(data);
    let touched = hud.applyEdit(root, edit);
    if (Number.isInteger(edit.calib) && edit.calib >= 0) { calib.apply(root, edit.calib); touched = true; }
    if (edit.arrange) { arrange.apply(root, edit.arrange); touched = true; }
    if (edit.split && elementsLib.splitDialog(root, edit.split)) touched = true;
    // раскладка «Стиля Aion» и сетка бафов правят окно после — повторяем,
    // и полоса захвата — по окончательному размеру
    if (edit.free) {
      hud.applyEdit(root, { free: true });
      hud.addGrip(root);
      touched = true;
    }
    return touched || base ? bxml.serialize(root, strings) : null;
  };

  for (const [key, edits] of byPak) {
    if (!client.has(key)) { say(`${key}: такого пака в клиенте нет, пропускаю`); continue; }
    const files = client.original(key);
    const changed = new Map();
    for (const [entry, edit] of edits) {
      if (!files.get(entry)) { say(`пропустил ${key}/${entry} — нет такой записи`); continue; }
      const next = buildDialog(key + '/' + entry, files.get(entry), edit);
      if (next) changed.set(entry, next);
    }
    if (!changed.size) { say(`${key}: правок нет`); continue; }
    if (dry) out.paks.set(key, changed);
    else client.writePak(key, changed);
    report.paks.push(key);
    report.dialogs += changed.size;
    say(`${key}: переписано диалогов — ${changed.size}`);
  }

  // --- data/ui/ui.pak: камера портрета и порядок окон набора ---------------
  // Одной записью: вторая запись в тот же пак стёрла бы первую.
  const camName = client.l10nName('ui', portrait.CAM_ENTRY);
  const uiChanges = new Map();
  if (p && p.enabled && client.has('ui')) {
    const cam = client.original('ui').get(portrait.CAM_ENTRY);
    const next = cam && portrait.patchCamera(cam, p);
    if (next) uiChanges.set(portrait.CAM_ENTRY, next);
  }
  if (hudPlan) {
    for (const [k, v] of hudPlan.screens.ui) uiChanges.set(k, v);
    for (const [k, v] of hudPlan.screens.l10n) l10nChanges.set(k, v);
    if (hudPlan.screens.ui.size || hudPlan.screens.l10n.size) {
      say('окна HUD: меню поставлено поверх окна карты (порядок окон набора s2)');
    }
  }
  if (uiChanges.size && client.has('ui')) {
    if (dry) out.paks.set('ui', uiChanges);
    else client.writePak('ui', uiChanges);
    report.paks.push('ui');
  }

  // --- те же правки диалогов для локализованного пака ---------------------
  // Клиент читает интерфейс именно оттуда, `data/ui/*` он игнорирует.
  if (client.hasL10n(lang)) {
    const wanted = new Map(); // имя записи в data.pak -> [id окна, правка раскладки]
    for (const [key, edits] of byPak) {
      for (const [entry, edit] of edits) {
        const name = client.l10nName(key, entry);
        if (name) wanted.set(name, [key + '/' + entry, edit]);
      }
    }
    const names = [...wanted.keys()];
    if (p && p.enabled) names.push(camName);
    if (names.length) {
      const src = client.l10nRead(lang, names);
      for (const [name, [id, edit]] of wanted) {
        if (!src.get(name)) { say(`в l10n нет ${name}`); continue; }
        const next = buildDialog(id, src.get(name), edit);
        if (next) l10nChanges.set(name, next);
      }
      if (p && p.enabled && src.get(camName)) {
        const next = portrait.patchCamera(src.get(camName), p);
        if (next) l10nChanges.set(camName, next);
      }
    }
  } else {
    say(`внимание: нет l10n/${lang}/data/data.pak — правки в игре не появятся`);
  }

  if (p && p.enabled) {
    say(`портрет: окно ${p.size}x${p.size}, камера м ${p.maleDist}/${p.maleHeight}, ` +
        `ж ${p.femaleDist}/${p.femaleHeight}`);
  }

  // --- скины: из какого атласа и какого его куска рисуется деталь ---------
  // Порядок: вид Aion 5.x, поверх него вид официального Classic, поверх всего
  // — точечные правки. Каждый следующий слой перекрывает предыдущий.
  const skinEdits = profile.skins || {};
  const wantV5 = mix.v5;
  const classic = donorObj && mix.classic ? donor.plan(client, donorObj, lang) : null;
  // скины и пресеты, которых у нас нет, а перенесённые окна их зовут
  // (и то, что зовут поправленные обычные окна — полоса под вкладками)
  const extra = { skins: [], presets: [] };
  const seen = new Set();
  for (const src of [hudPlan, fixPlan]) {
    if (!src) continue;
    for (const kind of ['skins', 'presets']) {
      for (const n of src[kind]) {
        const key = kind + ':' + n.attrs.get('name');
        if (seen.has(key)) continue;
        seen.add(key);
        extra[kind].push(n);
      }
    }
  }
  const hudLib = extra.skins.length || extra.presets.length ? extra : null;

  // квадратная мини-карта — поверх всех слоёв, по имени скина
  const wantRadar = !!(profile.radar && profile.radar.square);
  // редактор интерфейса (elements.js) — самый последний слой
  const elEdits = profile.elements || {};
  const wantEl = Object.keys(elEdits).length > 0;
  const elFiles = new Map(); // свои картинки элементов -> пак программы

  // невидимое тело перетаскиваемых окон (hud.GRIP_PRESET): скин и пресет в библиотеку
  const wantGrip = free.length > 0;

  if ((Object.keys(skinEdits).length || wantV5 || classic || hudLib || wantRadar || wantCalib || wantEl ||
      splits.length || wantGrip) && client.has('preload')) {
    const files = client.original('preload');
    const done = new Map(); // библиотека -> новое содержимое

    const libs = new Set(Object.keys(skinEdits).map((k) => k.split('|')[0]));
    if (wantV5 || hudLib || wantRadar || wantCalib || wantGrip) libs.add(v5.V4_LIB);
    if (wantRadar) {
      // маска карты живёт в free_version.xml; имя файла в паке — как есть
      const fv = [...files.keys()].find((k) => /^free_version\.xml$/i.test(k));
      if (fv) libs.add(fv);
    }
    if (classic) for (const c of classic.changes) libs.add(c.lib);

    const have = new Set();
    if (wantV5) {
      for (const row of client.packIndex('uiatlas', lang).values()) {
        have.add(row.short.toLowerCase().replace(/\.dds$/, ''));
      }
    }

    const parsed = new Map(); // библиотека -> { root, strings, n }: пишутся после всех слоёв
    for (const lib of libs) {
      const data = files.get(lib);
      if (!data) { say(`скины: в preload нет ${lib}`); continue; }
      const { root, strings } = bxml.parse(data);
      let n = 0;
      // детали с ручной правкой массовые переносы не трогают
      const skip = new Set(
        Object.keys(skinEdits)
          .filter((k) => k.startsWith(lib + '|'))
          .map((k) => k.split('|')[2])
      );
      if (wantV5 && lib === v5.V4_LIB) {
        const moved = v5.convert(root, files.get(v5.V5_LIB),
          { skip, have, rules: (profile.v5 || {}).rules, allow: mix.allowV5 });
        say(`вид Aion 5.x: перенесено деталей — ${moved}`);
        n += moved;
      }
      if (classic) {
        // в микшере группы решает он, старые выключенные группы не действуют
        const r = donor.convert(root, lib, classic,
          { skip, off: mix.mixer ? {} : cl.off, rules: cl.rules, allow: mix.allowClassic });
        for (const s of r.ships) {
          // свой атлас (значки меню, уменьшенные заранее) — готовой картинкой
          if (classic.generated && classic.generated.has(s)) madeAtlases.set(s, classic.generated.get(s));
          else shipLocs.set(s, classic.atlases.get(s));
        }
        if (r.touched) say(`вид официального Classic: ${lib} — перенесено деталей ${r.touched}`);
        n += r.touched;
      }
      if (hudLib && lib === v5.V4_LIB) {
        const added = hudport.addToLibrary(root, hudLib);
        say(`окна HUD: в ${lib} дописано скинов ${hudLib.skins.length}, пресетов ${hudLib.presets.length}`);
        n += added;
      }
      n += skins.applyEdits(root, skinEdits, lib);
      if (wantRadar) {
        const r = skins.applyByName(root, radar.skinEdits());
        if (r) say(`мини-карта: ${lib} — квадратная маска и рамка, скинов ${r}`);
        n += r;
      }
      if (wantCalib && lib === v5.V4_LIB) {
        const add = calib.skins();
        root.kids.push(...add);
        n += add.length;
      }
      if (wantGrip && lib === v5.V4_LIB) {
        const add = hud.gripLibrary();
        root.kids.push(...add);
        n += add.length;
      }
      parsed.set(lib, { root, strings, n });
    }

    // Правки редактора: элемент и вариант могут жить в разных библиотеках,
    // поэтому — по всем сразу, когда прочие слои уже легли.
    if (wantEl || splits.length) {
      for (const lib of files.keys()) {
        if (!/\.xml$/i.test(lib) || parsed.has(lib)) continue;
        const { root, strings } = bxml.parse(files.get(lib));
        parsed.set(lib, { root, strings, n: 0 });
      }
    }
    if (splits.length) {
      const r = elementsLib.applySplits(parsed, splits);
      say(`редактор интерфейса: отдельных копий элементов ${r.added}` +
        (r.missing.length ? ` — не нашлось: ${r.missing.join(', ')}` : ''));
    }
    if (wantEl) {
      const readImage = (f) => { try { return fs.readFileSync(f); } catch (e) { return null; } };
      const r = elementsLib.applyEdits(parsed, elEdits, readImage);
      for (const [name, raw] of r.files) elFiles.set(name, raw);
      say(`редактор интерфейса: элементов ${Object.keys(elEdits).length}, скинов переписано ${r.touched}` +
        (r.files.size ? `, своих картинок ${r.files.size}` : '') +
        (r.missing.length ? ` — не нашлось: ${r.missing.join(', ')}` : ''));
    }

    for (const [lib, { root, strings, n }] of parsed) {
      if (!n) continue;
      done.set(lib, bxml.serialize(root, strings));
      say(`скины: ${lib} — переписано ${n}`);
    }

    if (done.size) {
      if (dry) out.paks.set('preload', done);
      else client.writePak('preload', done);
      report.paks.push('preload');
      // и та же правка в локализованную копию, иначе клиент её не увидит
      for (const [lib, data] of done) l10nChanges.set(client.l10nName('preload', lib), data);
    }
  }

  // --- атласы донора: свой пак рядом с ui.pak ------------------------------
  // Собирается заново при каждой сборке и только из того, на что реально
  // смотрят перенесённые скины. Вид выключен — пак убираем, чтобы не висел.
  const donorPak = client.abs(donor.DONOR_PAK);
  if (dry) {
    // атласы донора — десятки МБ: предпросмотр читает их по одному, когда нужны
    out.donor = donorObj;
    for (const [s, loc] of shipLocs) out.shipLocs.set(s, loc);
    for (const [s, raw] of madeAtlases) out.made.set(s, raw);
  } else if (shipLocs.size || madeAtlases.size) {
    const data = shipLocs.size ? donorObj.readAtlases(shipLocs, lang) : new Map();
    const lost = [...shipLocs.keys()].filter((s) => !data.has(s));
    if (lost.length) throw new Error('не прочитал у донора атласы: ' + lost.join(', '));
    for (const [s, raw] of madeAtlases) data.set(s, raw);
    const entries = new Map([...data].map(([s, raw]) => [s + '.dds', raw]));
    pak.writePak(donorPak, entries, { encrypt: true, dllPath: client.dll });
    report.files += entries.size;
    say(`вид официального Classic: атласов ${entries.size} -> ${donor.DONOR_PAK} ` +
        `(${(fs.statSync(donorPak).size / 1e6).toFixed(1)} МБ)`);
  } else if (fs.existsSync(donorPak)) {
    fs.unlinkSync(donorPak);
    say(`вид официального Classic выключен — убран ${donor.DONOR_PAK}`);
  }

  // --- свои картинки программы (мини-карта): свой пак рядом с ui.pak --------
  const builderPak = client.abs(BUILDER_PAK);
  if (wantRadar || wantCalib || wantGrip || elFiles.size) {
    const own = wantRadar ? radar.files() : new Map();
    if (wantCalib) own.set(calib.ATLAS.split('/').pop() + '.dds', calib.atlas());
    if (wantGrip) own.set(hud.GRIP_ATLAS.split('/').pop() + '.dds', hud.gripAtlas());
    for (const [n, raw] of elFiles) own.set(n, raw);
    if (dry) {
      for (const [n, raw] of own) out.atlases.set(n, raw);
    } else {
      pak.writePak(builderPak, own, { encrypt: true, dllPath: client.dll });
    }
    report.files += own.size;
    say(`свои картинки программы (${[wantRadar && 'мини-карта', wantCalib && 'разметка', wantGrip && 'тело окон',
      elFiles.size && 'картинки элементов'].filter(Boolean).join(', ')}) -> ${BUILDER_PAK}`);
  } else if (!dry && fs.existsSync(builderPak)) {
    fs.unlinkSync(builderPak);
    say(`своих картинок нет — убран ${BUILDER_PAK}`);
  }

  // --- шрифт -------------------------------------------------------------
  const font = profile.font;
  if (!dry && font && font.enabled && font.file) {
    if (!fs.existsSync(font.file)) throw new Error('нет файла шрифта: ' + font.file);
    const ttf = fs.readFileSync(font.file);
    const files = new Map(FONT_NAMES.map((n) => [n, ttf]));
    for (const l of font.langs && font.langs.length ? font.langs : client.languages()) {
      const out = client.fontPakPath(l);
      pak.writePak(out, files);
      say(`шрифт: ${path.basename(font.file)} -> ${path.relative(client.root, out)}`);
      report.files++;
    }
  }

  // --- картинки: иконки умений и цифры урона -----------------------------
  // Подменяем прямо в родном паке: перебивающий пак с именем на `zz` работает
  // не везде, а тут нам нужна гарантия.
  const byRel = new Map(); // пак -> записи; пишем ниже одним проходом
  for (const packId of ['skills', 'items', 'hitnum', 'uiatlas']) {
    const wanted = (profile.packs && profile.packs[packId]) || {};
    const names = Object.keys(wanted);
    if (!names.length) continue;
    if (!client.hasPack(packId, lang)) { say(`${packId}: такого набора в клиенте нет`); continue; }

    const changes = new Map();
    for (const name of names) {
      const file = wanted[name];
      if (!file || !fs.existsSync(file)) { say(`${name}: нет файла ${file}`); continue; }
      const raw = fs.readFileSync(file);
      if (raw.toString('latin1', 0, 4) !== 'DDS ') { say(`${name}: ожидается DDS`); continue; }
      changes.set(name, raw);
    }
    if (!changes.size) continue;
    const n = client.packStage(packId, lang, changes, byRel);
    say(`${client.pack(packId).title}: готово к записи ${n} из ${changes.size}`);
  }

  // --- перекрашенные карты официального клиента ----------------------------
  // В тот же byRel: паки карт пишутся тем же единственным проходом.
  if (donorObj && mix.maps) {
    const mp = maps.plan(client, donorObj);
    const n = maps.stage(mp, donorObj, byRel);
    const zonesOn = mp.zones.filter((z) => z.replace).map((z) => z.zone + ' (' + z.sub + ')');
    say(`карты: заменено тайлов ${n} — ${zonesOn.join(', ') || 'нечего'}`);
  }
  // --- свои карты пользователя — после официальных: своя главнее -----------
  // В предпросмотре (dry) не нужны: это десятки мегабайт тайлов.
  if (!dry && profile.maps && Object.keys(profile.maps).length) {
    const um = usermaps.stage(client, lang, profile.maps, byRel);
    if (um.tiles) say(`свои карты: ${um.zones.join(', ')} — тайлов ${um.tiles}`);
    for (const k of um.missing) say(`свои карты: ${k} — нет зоны или не хватает тайлов, пропущено`);
  }
  // Паки карт и наборов картинок, которые раньше меняли, а сейчас не меняем, —
  // из резерва: иначе «вернуть как было» у последней иконки ничего бы не
  // вернуло. В эти паки пишет только этот проход (byRel), больше никто.
  const packRels = new Set();
  for (const id of Object.keys(PACKS)) {
    for (const s of PACKS[id].sources) for (const rel of client.expandSource(s, lang)) packRels.add(rel);
  }
  for (const { file, rel } of client.backups()) {
    const isMap = /^textures\/ui\/(newmap|zonemap)\//i.test(rel);
    if ((!isMap && !packRels.has(rel)) || byRel.has(rel) || dry) continue;
    running.assertWritable([client.abs(rel)]);
    fs.copyFileSync(file, client.abs(rel));
    say((isMap ? 'карты' : 'картинки') + ': возвращён штатный ' + rel);
  }

  if (dry) {
    for (const [rel, m] of byRel) out.images.set(rel, m);
  } else if (byRel.size) {
    running.assertWritable([...byRel.keys()].map((r) => client.abs(r)));
    const res = client.writeByRel(byRel);
    report.files += res.count;
    say(`картинки: подменено ${res.count} в паках — ${res.paks.join(', ')}`);
  }

  // --- единственная запись в локализованные паки -------------------------
  // Пишем во все языки, где такие записи есть: какой из них читает клиент,
  // достоверно неизвестно, а угадывать приоритет мы уже пробовали.
  if (dry) {
    for (const [n, data] of l10nChanges) out.l10n.set(n, data);
  } else if (l10nChanges.size) {
    for (const { lang: l, count } of client.l10nWriteAll(l10nChanges)) {
      report.paks.push('l10n:' + l);
      say(`l10n/${l}/data/data.pak: подменено записей — ${count}`);
    }
  }

  if (transaction) transaction.commit();
  return report;
  } catch (error) {
    if (transaction) transaction.rollback();
    throw error;
  }
}

/** Готовит DDS-иконку 64x64 из сырых пикселей, пришедших из окна. */
function iconFromRgba(width, height, rgba) {
  return dds.fromRgba(width, height, Buffer.from(rgba));
}

module.exports = { apply, iconFromRgba, FONT_NAMES };
