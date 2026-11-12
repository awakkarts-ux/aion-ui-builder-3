'use strict';
/**
 * Вид официального Aion Classic: внешность интерфейса переносится из другого
 * клиента (донора) — например, официального 4Game.
 *
 * Схема та же, что у вида 5.x: имена скинов не трогаем, потому что их зовут
 * диалоги, а переписываем «внешность» — атлас, прямоугольники, размеры
 * кусков. Источников два:
 *
 *   v3   — новый плоский вид. У официального клиента он живёт в библиотеках,
 *          которых у нас нет (`version3`, `ver4`, `ver5`), под именами `v3_*`,
 *          и зовут их его собственные диалоги. Наши диалоги просят `v4_*`,
 *          поэтому пару ищем по имени: `v4_quickbar_slot_bg` ↔
 *          `v3_quickbar_slot_bg`. Так переезжают панель умений, полосы,
 *          инвентарь, чат.
 *   same — одноимённая деталь в одноимённой библиотеке донора
 *          (`version4.xml` ↔ `version4.xml`), если она у него другая.
 *
 * «Другая» проверяется по пикселям, а не по описанию и не по CRC атласа.
 * Атласы вроде `v4_common` у донора отличаются по CRC, но основные куски в
 * них те же — без сверки картинок план обещал тысячу изменений, из которых
 * на экране видна была четверть.
 *
 * Атласы донора с нашими не смешиваем. Часть из них перерисована под теми
 * же именами, и координаты в них другие: подложить такой вместо нашего —
 * разъедутся все остальные окна. Поэтому атлас донора кладётся рядом под
 * своим именем (`cl_v4_common`) в отдельный пак `zz_classic_look.pak`, и на
 * него переводятся только перенесённые скины. Атлас, одинаковый у обоих
 * клиентов (CRC и размер), не копируется — скин остаётся на нашем.
 */

const fs = require('fs');
const path = require('path');
const pak = require('./pak');
const bxml = require('./bxml');
const dds = require('./dds');
const skins = require('./skins');
const { VISUAL } = require('./v5');
// Наш пак с атласами донора. В textures/ui клиент монтирует все паки.
const { DONOR_PAK } = require('./client');
/** Приставка к именам атласов донора, чтобы не пересечься с нашими. */
const PREFIX = 'cl_';
/** Источник вида 5.x: клиент её не грузит, переносить в неё нечего. */
const SKIP_LIBS = /^version5\.xml$/i;

/**
 * Источники вида — по убыванию приоритета. Любой можно выключить.
 *
 * `v3odd` — те же пары v4 ↔ v3, но простая картинка другого размера или
 * другого устройства (рамка против картинки). Имя совпало, а смысл часто
 * нет: у `v4_force_over` подсветка-полоса, у `v3_force_over` эмблема. Окно
 * задаёт размер жёстко, поэтому такая картинка растянется или обрежется.
 * По умолчанию выключено — включать, посмотрев «до и после».
 */
const SOURCES = [
  { id: 'v3', title: 'новый вид Classic', hint: 'v4_quickbar_slot_bg → v3_quickbar_slot_bg', safe: true },
  { id: 'same', title: 'перерисованное у официального', hint: 'та же деталь, другая картинка', safe: true },
  { id: 'v3odd', title: 'новый вид — детали другой формы', hint: 'растянутся или обрежутся', safe: false },
];
/** Что выключено, пока пользователь не решил иначе. */
const DEFAULT_OFF = { v3odd: true };

/** Включён ли источник: явная галочка важнее умолчания. */
const ruleOn = (rules, id) => (rules && id in rules ? rules[id] !== false : !DEFAULT_OFF[id]);

/** Путь внутри папки без учёта регистра: у 4Game `Textures/UI`, у других `textures/ui`. */
function findCI(root, rel) {
  let cur = root;
  for (const part of rel.split('/')) {
    if (!part) continue;
    let names;
    try { names = fs.readdirSync(cur); } catch (e) { return null; }
    const hit = names.find((n) => n.toLowerCase() === part.toLowerCase());
    if (!hit) return null;
    cur = path.join(cur, hit);
  }
  return cur;
}

const normTex = (t) => String(t || '').replace(/\\/g, '/').replace(/^\/+/, '')
  .toLowerCase().replace(/\.dds$/, '');

/** `textures/ui/battlepass/map/x` -> `cl_battlepass_map_x`. */
function shipName(tex) {
  const t = normTex(tex).replace(/^textures\/ui\//, '').replace(/^textures\//, '');
  return PREFIX + t.replace(/\//g, '_');
}

/**
 * Где лежит атлас из поля `texture`. Порядок — как у клиента (см. PACKS в
 * client.js): локализованный textures.pak, потом паки в папке атласа, из них
 * позже по имени — сильнее, ui.pak — последним.
 */
class AtlasFinder {
  /**
   * @param {object} o
   * @param {string} o.root папка клиента
   * @param {string} o.dll crysystem.dll этого клиента
   * @param {string|null} o.l10n локализованный textures.pak
   * @param {(abs: string) => string} [o.source] откуда читать пак (у своего клиента — резерв)
   * @param {(abs: string) => boolean} [o.skip] паки, которые не считаем
   */
  constructor(o) {
    Object.assign(this, o);
    this.dirs = new Map();
    this.lists = new Map();
    this.images = new Map();
  }

  from(abs) {
    return this.source ? this.source(abs) : abs;
  }

  paksIn(relDir) {
    if (this.dirs.has(relDir)) return this.dirs.get(relDir);
    const abs = findCI(this.root, relDir);
    let list = [];
    if (abs && fs.statSync(abs).isDirectory()) {
      const main = (p) => (path.basename(p).toLowerCase() === 'ui.pak' ? 1 : 0);
      list = fs.readdirSync(abs)
        .filter((n) => /\.pak$/i.test(n))
        .map((n) => path.join(abs, n))
        .filter((p) => !(this.skip && this.skip(p)))
        .sort((a, b) => main(a) - main(b) || path.basename(b).localeCompare(path.basename(a)));
    }
    this.dirs.set(relDir, list);
    return list;
  }

  /** Имена записей пака (в нижнем регистре) -> запись каталога. */
  list(abs) {
    if (!this.lists.has(abs)) {
      const m = new Map();
      try {
        for (const e of pak.listPak(this.from(abs)).entries) {
          m.set(e.name.replace(/\\/g, '/').toLowerCase(), e);
        }
      } catch (e) {
        // битый или чужой пак — просто не участвует
      }
      this.lists.set(abs, m);
    }
    return this.lists.get(abs);
  }

  /** @returns {{pak: string, entry: string, crc: number, size: number}|null} */
  resolve(texture) {
    const t = normTex(texture);
    if (!t) return null;
    const hit = (abs, name) => {
      const e = this.list(abs).get(name);
      return e ? { pak: abs, entry: e.name, crc: e.crc, size: e.uncSize } : null;
    };
    if (this.l10n && t.startsWith('textures/ui/')) {
      const r = hit(this.l10n, 'ui/' + t.slice('textures/ui/'.length) + '.dds');
      if (r) return r;
    }
    // от папки самого атласа вверх до textures/ui
    const parts = t.split('/');
    for (let cut = parts.length - 1; cut >= 2; cut--) {
      const inner = parts.slice(cut).join('/') + '.dds';
      for (const p of this.paksIn(parts.slice(0, cut).join('/'))) {
        const r = hit(p, inner);
        if (r) return r;
      }
    }
    return null;
  }

  /** Сырые DDS нескольких атласов. @param {Map<string, object>} locs */
  readMany(locs) {
    const byPak = new Map();
    for (const [name, loc] of locs) {
      if (!byPak.has(loc.pak)) byPak.set(loc.pak, []);
      byPak.get(loc.pak).push([name, loc.entry]);
    }
    const out = new Map();
    for (const [file, list] of byPak) {
      const data = pak.readSome(this.from(file), this.dll, list.map((x) => x[1]));
      for (const [name, entry] of list) if (data.has(entry)) out.set(name, data.get(entry));
    }
    return out;
  }

  /** Атлас картинкой; null — нет такого или формат не разобрали. */
  image(texture) {
    const t = normTex(texture);
    if (this.images.has(t)) return this.images.get(t);
    const loc = this.resolve(t);
    let img = null;
    if (loc) {
      try { img = dds.toRgba(this.readMany(new Map([[t, loc]])).get(t)); } catch (e) { img = null; }
    }
    this.images.set(t, img);
    return img;
  }
}

/** Скины библиотеки с категорией. Одиночный скин на верхнем уровне — без категории. */
function* skinNodes(root) {
  for (const top of root.kids) {
    const cat = top.name === 'Skin' ? '' : (top.attrs.get('name') || '');
    for (const node of top.walk()) {
      if (node.name === 'Skin' && node.attrs.get('name')) yield { node, cat };
    }
  }
}

const firstRect = (attrs) => attrs.get('src_image') || attrs.get('src_middle_middle') || '';

function rectsOf(attrs) {
  const out = {};
  for (const [k, v] of attrs) {
    if (!/^src_/.test(k)) continue;
    const r = skins.parseRect(v);
    if (r && r.w > 0 && r.h > 0) out[k] = r;
  }
  return out;
}

/**
 * Совпадают ли два куска на экране. Допуск — на шум пережатия DXT: канал
 * может уйти на пару единиц, а пара пикселей на кромке — поменяться.
 */
function samePiece(a, ra, b, rb) {
  if (ra.w !== rb.w || ra.h !== rb.h) return false;
  const inside = (img, r) => r.x >= 0 && r.y >= 0 && r.x + r.w <= img.width && r.y + r.h <= img.height;
  if (!inside(a, ra) || !inside(b, rb)) return false;
  let diff = 0;
  const limit = Math.max(2, Math.floor(ra.w * ra.h * 0.002));
  for (let y = 0; y < ra.h; y++) {
    let ia = ((ra.y + y) * a.width + ra.x) * 4;
    let ib = ((rb.y + y) * b.width + rb.x) * 4;
    for (let x = 0; x < ra.w; x++, ia += 4, ib += 4) {
      if (Math.abs(a.rgba[ia] - b.rgba[ib]) > 6 || Math.abs(a.rgba[ia + 1] - b.rgba[ib + 1]) > 6 ||
          Math.abs(a.rgba[ia + 2] - b.rgba[ib + 2]) > 6 || Math.abs(a.rgba[ia + 3] - b.rgba[ib + 3]) > 6) {
        if (++diff > limit) return false;
      }
    }
  }
  return true;
}

/** Выглядит ли скин донора так же, как наш. Все куски рамки должны совпасть. */
function looksSame(ourImg, ourAttrs, theirImg, theirAttrs) {
  if (!ourImg || !theirImg) return false;
  const a = rectsOf(ourAttrs);
  const b = rectsOf(theirAttrs);
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((k) => b[k] && samePiece(ourImg, a[k], theirImg, b[k]));
}

/**
 * Другой ли формы картинка пары. Рамка из девяти кусков тянется как угодно,
 * а простую картинку окно растягивает до своего размера — это незаметно,
 * пока пропорции почти те же (ячейка 44×44 против 40×40), и режет глаз,
 * когда нет (полоса 123×6 против 88×8). Рамка против картинки — всегда другая.
 */
function oddShape(ours, theirs) {
  const nineA = Object.keys(ours).length > 1;
  const nineB = Object.keys(theirs).length > 1;
  if (nineA !== nineB) return true;
  if (nineA) return false;
  const a = ours.src_image;
  const b = theirs.src_image;
  if (!a || !b) return true;
  const aspect = Math.abs(Math.log((b.w / b.h) / (a.w / a.h)));
  const scale = Math.max(b.w / a.w, b.h / a.h, a.w / b.w, a.h / b.h);
  return aspect > Math.log(1.15) || scale > 1.5;
}

function preloadList(uiFiles) {
  const k = uiFiles && [...uiFiles.keys()].find((x) => /^ui_preload\.xml$/i.test(x));
  if (!k) return null;
  const names = [];
  for (const n of bxml.parse(uiFiles.get(k)).root.walk()) {
    if (n.name === 'Preload' && n.attrs.get('name')) names.push(n.attrs.get('name').toLowerCase());
  }
  return names;
}

const libBase = (k) => k.replace(/\.xml$/i, '').toLowerCase();
const normName = (s) => String(s).toLowerCase().replace(/^v[3-8]_/, '').replace(/_/g, '');

/**
 * Паспорт импорта (donorimport.js). Папка с ним — не клиент, а выжимка из
 * него: те же пути, но паки — обычные ZIP с нужными записями, без ключа.
 */
const MANIFEST = 'aion-ui-donor.json';

/** Паспорт импорта или null, если это настоящий клиент. */
function importInfo(root) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, MANIFEST), 'utf8'));
  } catch (e) {
    return null;
  }
}

/** Клиент-донор или его импорт. Только читается. */
class Donor {
  constructor(root) {
    this.root = root;
    this.imported = importInfo(root);
    // у импорта паки без шифрования, ключ не нужен
    this.dll = this.imported ? null : findCI(root, 'bin64/crysystem.dll');
    this.finders = new Map();
  }

  check() {
    // в импорте textures/ui/ui.pak может и не быть — если все атласы нашлись в других паках
    const need = this.imported ? ['data/ui/preload/preload.pak']
      : ['bin64/crysystem.dll', 'data/ui/preload/preload.pak', 'textures/ui/ui.pak'];
    const missing = need.filter((r) => !findCI(this.root, r));
    return { ok: missing.length === 0, missing };
  }

  languages() {
    const dir = findCI(this.root, 'l10n');
    if (!dir) return [];
    return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  }

  preload() {
    if (!this._preload) this._preload = pak.readPak(findCI(this.root, 'data/ui/preload/preload.pak'), this.dll);
    return this._preload;
  }

  /** Какие библиотеки грузит донор (по его UI_Preload.xml). */
  loaded() {
    if (this._loaded === undefined) {
      const f = findCI(this.root, 'data/ui/ui.pak');
      try { this._loaded = f ? preloadList(pak.readPak(f, this.dll)) : null; } catch (e) { this._loaded = null; }
    }
    return this._loaded;
  }

  /** Язык донора подбираем к нашему: `rus` ↔ `RUS`; нет такого — первый. */
  finder(lang) {
    const langs = this.languages();
    const l = langs.find((x) => x.toLowerCase() === String(lang || '').toLowerCase()) || langs[0] || '';
    if (!this.finders.has(l)) {
      this.finders.set(l, new AtlasFinder({
        root: this.root,
        dll: this.dll,
        l10n: l ? findCI(this.root, 'l10n/' + l + '/textures/textures.pak') : null,
      }));
    }
    return this.finders.get(l);
  }

  readAtlases(locs, lang) {
    return this.finder(lang).readMany(locs);
  }

  /** Атлас донора картинкой — для «до и после» в окне. */
  atlasImage(texture, lang) {
    return this.finder(lang).image(texture);
  }

  /** Все окна интерфейса донора из локализованного пака: `ui/game/x.xml` -> дерево. */
  dialogs(lang) {
    const langs = this.languages();
    const l = langs.find((x) => x.toLowerCase() === String(lang || '').toLowerCase()) || langs[0] || '';
    if (!this._dialogs) this._dialogs = new Map();
    if (!this._dialogs.has(l)) {
      const f = l && findCI(this.root, 'l10n/' + l + '/data/data.pak');
      this._dialogs.set(l, f ? readDialogs(f, this.dll) : new Map());
    }
    return this._dialogs.get(l);
  }
}

/** Окна `UI/…/*.xml` из пака: имя в нижнем регистре -> дерево. Нечитаемые пропускаются. */
function readDialogs(file, dll) {
  const names = pak.listPak(file).entries.map((e) => e.name).filter((n) => /^ui\/.*\.xml$/i.test(n));
  const bufs = pak.readSome(file, dll, names);
  const out = new Map();
  for (const n of names) {
    try { out.set(n.toLowerCase(), bxml.parse(bufs.get(n)).root); } catch (e) { /* не бинарный XML */ }
  }
  return out;
}

/**
 * Пары пресетов по окнам: наше окно `X` ↔ официальное `v3_X` (новое окно
 * того же назначения) или одноимённое, виджет — по имени. Так видно, чем
 * официальный клиент рисует ТО ЖЕ место: вкладки окна «Статус» у нас
 * `v4_tab_button`, у него — `v3_tab01_button`, а по одному имени пара
 * находилась `v3_tabbutton` — вкладки окна карты.
 *
 * Голоса считаются по всем окнам; пара — самый частый ответ, и только если
 * это пресет нового вида (`v3pres`). Окна HUD переносятся целиком
 * (hudport), окно разработчика — не показатель.
 * @returns {Map<string, {to: string, voted: Set<string>}>}
 */
function dialogPresetPairs(ourDialogs, theirDialogs, v3pres) {
  const SKIP = /\/game_hud_s\d\/|\/builder_dev_dialog\.xml$/;
  const votes = new Map();
  // рамка самого окна — тоже голос: `v4_dialog2` ↔ `v3_dialog02` по имени
  // не сходятся, и окна (лавка, питомцы, союз, меню) оставались в старой рамке
  const widgets = (r) => {
    const m = new Map([['#dialog', r]]);
    for (const w of r.walk()) {
      const n = w.name === 'Widget' && String(w.attrs.get('name') || '').toLowerCase();
      if (n && !m.has(n)) m.set(n, w);
    }
    return m;
  };
  for (const [k, ours] of ourDialogs) {
    if (SKIP.test(k)) continue;
    const cut = k.lastIndexOf('/');
    const theirs = theirDialogs.get(k.slice(0, cut + 1) + 'v3_' + k.slice(cut + 1)) || theirDialogs.get(k);
    if (!theirs) continue;
    const tw = widgets(theirs);
    for (const [n, w] of widgets(ours)) {
      const p4 = w.attrs.get('preset');
      const t = tw.get(n);
      const p3 = t && t.attrs.get('preset');
      if (!p4 || !p3 || p4 === p3) continue;
      if (!votes.has(p4)) votes.set(p4, new Map());
      votes.get(p4).set(p3, (votes.get(p4).get(p3) || 0) + 1);
    }
  }
  // Одно-два совпадения — не показатель: `v4_tooltip` — рамка двух окон
  // (сбор, ремесло), у официального там `v3_msgbox`, но тем же пресетом код
  // рисует все подсказки к предметам.
  const out = new Map();
  for (const [p4, m] of votes) {
    const [top, n] = [...m].sort((a, b) => b[1] - a[1])[0];
    if (n >= MIN_VOTES && v3pres.has(top)) out.set(p4, { to: top, voted: new Set(m.keys()) });
  }
  return out;
}
const MIN_VOTES = 3;

/**
 * Значки пунктов меню «Статус / Инвентарь / …» (`v4_start_menu_N`) — номер
 * зашит в код игры, пары по имени нет. Сопоставлено по картинкам и
 * подписям меню (27.09.2026). У официального значки 47×47 без подложки,
 * пункт меню рисует 22×22 — картинка сжимается, поэтому проверка формы
 * (v3odd) для этих пар не действует.
 */
const ICON_PAIRS = {
  v4_start_menu_10_up: 'v3_character_up', // Статус
  v4_start_menu_5_up: 'v3_inven_up', // Инвентарь
  v4_start_menu_9_up: 'v3_skill_up', // Умения
  v4_start_menu_12_up: 'v3_mission_up', // Миссии/задания
  v4_start_menu_3_up: 'v3_map_up', // Карта
  v4_start_menu_7_up: 'v3_macro_up', // Макросы
  v4_start_menu_1_up: 'v3_private_store_up', // Личная лавка
  v4_start_menu_16_up: 'v3_indun_up', // Временные зоны
  v4_start_menu_pet_up: 'v3_pet_up', // Питомцы
  v4_start_menu_2_up: 'v3_find_party_up', // Поиск группы
  v4_start_menu_promotion: 'v3_event_up', // Ивентовая награда
  v4_start_menu_8_up: 'v3_communication_up', // Сообщество
  v4_start_menu_4_up: 'v3_service_center_up', // Сервис
  v4_start_menu_plugin_up: 'v3_contents_up', // Дополнительные функции
  v4_start_menu_6_up: 'v3_setting_up', // Системное меню
  v4_start_menu_wardrobe: 'v3_aionlook_up', // гардероб (вешалка -> манекен)
  v4_start_menu_ranking_up: 'v3_rank_up', // рейтинг
  v4_start_menu_powerbook_up: 'v3_book_up', // книга
  v4_start_menu_13_up: 'v3_guild_up', // флаг легиона
};

/**
 * Рамки окон без пары у официального -> рамка его новых окон. Подсказки
 * (`v4_tooltip*`) не трогаем: ими код рисует подсказки к предметам.
 */
const FRAME_FALLBACK = {
  v4_dialog4: 'v3_dialog02', // окно карты
  v4_msgbox3: 'v3_dialog02', // системное меню, выбор цвета (у официального — v3_dialog02)
  v4_shop_dialog: 'v3_dialog02', // магазин в игре
  v4_popup: 'v3_msgbox', // всплывающие меню
  v4_popup2: 'v3_msgbox', // меню «Статус / Инвентарь / Умения…»
  v4_inv_dialog: 'v3_dialog02', // куб рядом с личной лавкой, обменом, складом
  v4_inv_tab_button: 'v3_tab01_button', // его вкладки «Основной куб / Доп. куб»
  // ползунки (настройки и др.): у официального в окнах create_custom_slide ×55 —
  // тонкая полоса и кругляш; риски шага (step_marker) у него нет, остаются наши
  v4_slide: 'create_custom_slide',
};

/** Поиск атласов в НАШЕМ клиенте — по нетронутым пакам и без своего же пака донора. */
function ourFinder(client, lang) {
  const donorPak = path.resolve(client.abs(DONOR_PAK)).toLowerCase();
  const rel = (abs) => path.relative(client.root, abs).replace(/\\/g, '/');
  const l10n = client.abs('l10n/' + (lang || 'rus') + '/textures/textures.pak');
  return new AtlasFinder({
    root: client.root,
    dll: client.dll,
    l10n: fs.existsSync(l10n) ? l10n : null,
    source: (abs) => client.pristine(rel(abs)),
    skip: (abs) => path.resolve(abs).toLowerCase() === donorPak,
  });
}

/**
 * Что изменится на экране, если перенести вид донора. Файлы не меняются.
 * @param {import('./client').Client} client наш клиент
 * @param {Donor} donor
 * @param {string} lang
 */
function plan(client, donor, lang) {
  const ours = client.original('preload');
  const theirs = donor.preload();
  const theirKey = new Map([...theirs.keys()].map((k) => [k.toLowerCase(), k]));
  const ourKeys = new Set([...ours.keys()].map((k) => k.toLowerCase()));

  // какие библиотеки грузит наш клиент; не нашли список — берём все, кроме version5
  let loaded = null;
  try { loaded = preloadList(client.original('ui')); } catch (e) { loaded = null; }
  const libs = [...ours.keys()].filter((k) => /\.xml$/i.test(k) && !SKIP_LIBS.test(k) &&
    !/^ui_preload\.xml$/i.test(k) && (!loaded || loaded.includes(libBase(k))));

  // новый вид: скины v3_* из библиотек, которые донор грузит, а у нас их нет
  const theirLoaded = donor.loaded();
  const v3 = new Map();
  const v3presets = new Map();
  // всё из его библиотек, которых у нас нет, — для ручных таблиц: ползунок
  // официального `create_custom_slide` живёт в v3_lobby.xml без приставки v3_
  const onlySkins = new Map();
  const onlyPresets = new Map();
  for (const k of theirs.keys()) {
    if (!/\.xml$/i.test(k) || ourKeys.has(k.toLowerCase()) || SKIP_LIBS.test(k)) continue;
    if (theirLoaded && !theirLoaded.includes(libBase(k))) continue;
    for (const node of bxml.parse(theirs.get(k)).root.walk()) {
      const n = node.attrs.get('name');
      if (!n) continue;
      if (node.name === 'Skin' && !onlySkins.has(n)) onlySkins.set(n, node);
      if (node.name === 'Preset' && !onlyPresets.has(n)) onlyPresets.set(n, node);
      if (!/^v3_/i.test(n)) continue;
      if (node.name === 'Skin' && !v3.has(n)) v3.set(n, node);
      if (node.name === 'Preset' && !v3presets.has(n)) v3presets.set(n, node);
    }
  }
  // цели ручной таблицы — в общий индекс вместе со своими скинами
  for (const to of Object.values(FRAME_FALLBACK)) {
    const p = !v3presets.has(to) && onlyPresets.get(to);
    if (!p) continue;
    v3presets.set(to, p);
    for (const r of p.kids) {
      const s = r.name === 'SkinRef' && r.attrs.get('name');
      if (s && onlySkins.has(s) && !v3.has(s)) v3.set(s, onlySkins.get(s));
    }
  }
  const pairIn = (map) => {
    const byNorm = new Map();
    for (const n of map.keys()) if (!byNorm.has(normName(n))) byNorm.set(normName(n), n);
    return (name) => {
      if (!/^v4_/i.test(name || '')) return null;
      const exact = 'v3_' + name.slice(3);
      return map.has(exact) ? exact : byNorm.get(normName(name)) || null;
    };
  };
  const v3byName = pairIn(v3);
  const presetPair = pairIn(v3presets);

  // Пары через пресеты: наш v4_button ↔ их v3_button, состояние к состоянию.
  // Так находятся скины, названные по-разному: v4_button_defbutton ↔
  // v3_button_def, а v4_button_disabled ↔ v3_button_down — так неактивную
  // кнопку рисует сам официальный клиент. По одним именам эти состояния
  // оставались старыми.
  const viaPreset = new Map();
  const stateKey = (r) => [r.attrs.get('main_state'), r.attrs.get('sub_state'), r.attrs.get('state')].join('|');
  for (const k of libs) {
    for (const n of bxml.parse(ours.get(k)).root.walk()) {
      if (n.name !== 'Preset') continue;
      const tp = presetPair(n.attrs.get('name'));
      if (!tp) continue;
      const theirRefs = new Map(v3presets.get(tp).kids
        .filter((r) => r.name === 'SkinRef').map((r) => [stateKey(r), r.attrs.get('name')]));
      for (const r of n.kids) {
        if (r.name !== 'SkinRef') continue;
        const s = r.attrs.get('name');
        const t = theirRefs.get(stateKey(r));
        if (s && t && v3.has(t) && !viaPreset.has(s)) viaPreset.set(s, t);
      }
    }
  }
  // Пары через окна (dialogPresetPairs) — сильнее пар по имени, но только
  // там, где пара по имени официальными окнами не подтверждается: у
  // `v4_button` обе пары встречаются, и принятый вид кнопок не трогаем.
  // Деталь, которой рисуют и другие пресеты, по такой паре не переезжает:
  // `v4_item_over` — это и наведение на кнопку всплывающего окна, и
  // подсветка строки во всех списках.
  const viaDialog = new Map();
  const dlgPairs = dialogPresetPairs(
    readDialogs(client.pristine('l10n/' + (lang || 'rus') + '/data/data.pak'), client.dll),
    donor.dialogs(lang), v3presets);
  const ourPresets = [];
  const usedBy = new Map();
  for (const k of libs) {
    for (const n of bxml.parse(ours.get(k)).root.walk()) {
      if (n.name !== 'Preset') continue;
      ourPresets.push(n);
      for (const r of n.kids) {
        const s = r.name === 'SkinRef' && r.attrs.get('name');
        if (!s) continue;
        if (!usedBy.has(s)) usedBy.set(s, new Set());
        usedBy.get(s).add(n.attrs.get('name'));
      }
    }
  }
  for (const n of ourPresets) {
    const name = n.attrs.get('name');
    const pair = dlgPairs.get(name);
    const byName = pair && presetPair(name);
    if (!pair || (byName && pair.voted.has(byName))) continue;
    const theirRefs = new Map(v3presets.get(pair.to).kids
      .filter((r) => r.name === 'SkinRef').map((r) => [stateKey(r), r.attrs.get('name')]));
    for (const r of n.kids) {
      if (r.name !== 'SkinRef') continue;
      const s = r.attrs.get('name');
      const t = theirRefs.get(stateKey(r));
      const own = s && [...usedBy.get(s)].every((p) => p === name || (dlgPairs.get(p) || {}).to === pair.to);
      if (own && t && v3.has(t) && !viaDialog.has(s)) viaDialog.set(s, t);
    }
  }
  // Рамки окон, для которых пары у официального нет: его окно другого типа
  // (карта — v3_map_dialog, код которого у нас нет) или он окно не
  // показывает (всплывающее меню — у него своё меню из 37 кнопок). Все рамки
  // устроены одинаково — одно состояние frame, девять кусков, — поэтому
  // берём рамку его новых окон. Самый низкий приоритет.
  const viaFrame = new Map();
  for (const n of ourPresets) {
    const to = FRAME_FALLBACK[n.attrs.get('name')];
    const tp = to && v3presets.get(to);
    if (!tp || n.attrs.get('type') !== tp.attrs.get('type')) continue;
    const refsOf = (p) => p.kids.filter((r) => r.name === 'SkinRef');
    const theirRefs = new Map(refsOf(tp).map((r) => [stateKey(r), r.attrs.get('name')]));
    // одна картинка на всё окно — пара, как бы ни звалось состояние
    // (у v4_inv_dialog оно «0», у v3_dialog02 «frame»)
    const single = refsOf(n).length === 1 && refsOf(tp).length === 1 ? refsOf(tp)[0].attrs.get('name') : null;
    for (const r of n.kids) {
      const s = r.name === 'SkinRef' && r.attrs.get('name');
      const t = s && (single || theirRefs.get(stateKey(r)));
      if (t && v3.has(t) && usedBy.get(s).size === 1 && !viaFrame.has(s)) viaFrame.set(s, t);
    }
  }
  const curated = (name) => (ICON_PAIRS[name] && v3.has(ICON_PAIRS[name]) ? ICON_PAIRS[name] : null);
  // ручные таблицы — решения по картинкам, они сильнее догадки по имени
  // (`v4_inv_tab_up` по имени находил полосу раздела большого инвентаря 400×25)
  const v3pair = (name) => curated(name) ||
    viaDialog.get(name) || viaFrame.get(name) || v3byName(name) || viaPreset.get(name) || null;

  const oursFind = ourFinder(client, lang);
  const theirsFind = donor.finder(lang);

  const changes = []; // варианты; у одного скина их бывает два — v3 и same
  const atlases = new Map(); // имя в нашем паке -> где лежит у донора
  const perLib = [];
  const noAtlas = new Set();

  for (const lib of libs) {
    const dk = theirKey.get(lib.toLowerCase());
    const same = new Map();
    if (dk) {
      for (const { node } of skinNodes(bxml.parse(theirs.get(dk)).root)) {
        const n = node.attrs.get('name');
        if (!same.has(n)) same.set(n, node);
      }
    }

    const row = { lib, total: 0, moved: 0, same: 0, only: 0, missing: 0, v3: 0, redrawn: 0 };
    for (const { node, cat } of skinNodes(bxml.parse(ours.get(lib)).root)) {
      row.total++;
      const name = node.attrs.get('name');
      const cands = [];
      const pair = v3pair(name);
      if (pair) cands.push({ src: 'v3', to: pair, d: v3.get(pair) });
      if (same.has(name)) cands.push({ src: 'same', to: name, d: same.get(name) });
      if (!cands.length) { row.only++; continue; }

      const ourImg = oursFind.image(node.attrs.get('texture'));
      const ourRects = rectsOf(node.attrs);
      let kept = 0;
      for (const cand of cands) {
        const { to, d } = cand;
        let src = cand.src;
        // пара v3 другой формы — отдельным, по умолчанию выключенным источником
        if (src === 'v3' && !curated(name) && oddShape(ourRects, rectsOf(d.attrs))) src = 'v3odd';
        const tex = d.attrs.get('texture') || '';
        const theirLoc = tex ? theirsFind.resolve(tex) : null;
        if (tex && !theirLoc) { noAtlas.add(normTex(tex)); continue; }
        if (looksSame(ourImg, node.attrs, theirsFind.image(tex), d.attrs)) continue;

        // атлас тот же, что у нас (по CRC и размеру) — везти незачем
        const ourLoc = tex ? oursFind.resolve(tex) : null;
        const sameAtlas = !tex || !!(ourLoc && ourLoc.crc === theirLoc.crc && ourLoc.size === theirLoc.size);
        const ship = sameAtlas ? null : shipName(tex);
        if (ship) atlases.set(ship, theirLoc);
        changes.push({
          lib,
          cat,
          name,
          src,
          to,
          ship,
          attrs: [...d.attrs].filter(([k]) => VISUAL.test(k)),
          texture: ship ? 'textures/ui/' + ship : tex,
          from: { texture: node.attrs.get('texture') || '', rect: firstRect(node.attrs) },
          after: { texture: tex, rect: firstRect(d.attrs) },
        });
        row[src === 'same' ? 'redrawn' : 'v3']++;
        kept++;
      }
      if (kept) row.moved++;
      else if (cands.length) row.same++;
    }
    if (!dk && !row.v3) row.absent = true;
    perLib.push(row);
  }

  const generated = menuIconAtlas(changes, theirsFind);
  return { changes, atlases, generated, perLib, noAtlas: [...noAtlas].sort(), sources: SOURCES };
}

/** Свой атлас для значков меню: имя в паке донора, клетка, сам значок в ней. */
const ICON_ATLAS = { ship: PREFIX + 'menu_icons', cell: 22, icon: 20, cols: 8 };

/**
 * Значки меню официального 47×47, а пункт меню рисует свои 22×22 — отдавать
 * ему большую картинку нельзя: сжимается криво, по ширине и высоте по-разному
 * (проверено в игре 27.09). Поэтому уменьшаем заранее, усреднением с учётом
 * прозрачности, и кладём в свой атлас по клеткам 22×22. Переписывает
 * изменения ICON_PAIRS на этот атлас. @returns {Map<string, Buffer>} ship -> DDS
 */
function menuIconAtlas(changes, theirsFind) {
  const list = changes.filter((c) => ICON_PAIRS[c.name] === c.to);
  if (!list.length) return new Map();
  const { cell, icon, cols } = ICON_ATLAS;
  const pow2 = (n) => 2 ** Math.ceil(Math.log2(n));
  const W = pow2(cols * cell);
  const H = pow2(Math.ceil(list.length / cols) * cell);
  const out = new Uint8Array(W * H * 4);
  list.forEach((c, i) => {
    const img = theirsFind.image(c.after.texture);
    const r = skins.parseRect(c.after.rect);
    if (!img || !r) return;
    const ox = (i % cols) * cell + (cell - icon) / 2;
    const oy = Math.floor(i / cols) * cell + (cell - icon) / 2;
    for (let y = 0; y < icon; y++) {
      for (let x = 0; x < icon; x++) {
        // область исходника под пикселем результата; цвет — с весом прозрачности
        const x0 = r.x + (x * r.w) / icon;
        const x1 = r.x + ((x + 1) * r.w) / icon;
        const y0 = r.y + (y * r.h) / icon;
        const y1 = r.y + ((y + 1) * r.h) / icon;
        let a = 0; let cr = 0; let cg = 0; let cb = 0; let n = 0;
        for (let sy = Math.floor(y0); sy < Math.ceil(y1); sy++) {
          for (let sx = Math.floor(x0); sx < Math.ceil(x1); sx++) {
            const wgt = (Math.min(sx + 1, x1) - Math.max(sx, x0)) * (Math.min(sy + 1, y1) - Math.max(sy, y0));
            const si = (sy * img.width + sx) * 4;
            const al = img.rgba[si + 3] * wgt;
            cr += img.rgba[si] * al; cg += img.rgba[si + 1] * al; cb += img.rgba[si + 2] * al;
            a += al; n += wgt;
          }
        }
        const di = ((oy + y) * W + ox + x) * 4;
        if (a > 0) { out[di] = Math.round(cr / a); out[di + 1] = Math.round(cg / a); out[di + 2] = Math.round(cb / a); }
        out[di + 3] = Math.round(a / n);
      }
    }
    const cx = (i % cols) * cell;
    const cy = Math.floor(i / cols) * cell;
    c.ship = ICON_ATLAS.ship;
    c.texture = 'textures/ui/' + ICON_ATLAS.ship;
    c.attrs = [['src_image', `${cx},${cy},${cell},${cell}`], ['type', 'single']];
    // c.after не трогаем: «до и после» в окне показывает официальный значок
  });
  return new Map([[ICON_ATLAS.ship, dds.fromRgba(W, H, out)]]);
}

/**
 * Какой вариант достаётся каждому скину при данных настройках: первый по
 * приоритету источник, который включён; выключенная группа — ничего.
 * @returns {Map<string, object>} `библиотека|имя` -> вариант
 */
function pick(p, opts) {
  const o = opts || {};
  const off = o.off || {};
  const rules = o.rules || {};
  const order = SOURCES.map((s) => s.id);
  const out = new Map();
  for (const c of p.changes) {
    if (!ruleOn(rules, c.src) || off[c.lib + '|' + c.cat]) continue;
    // микшер вида (look.js): деталь из группы с другим источником не берём
    if (o.allow && !o.allow(c.lib, c.cat, c.name)) continue;
    const k = c.lib + '|' + c.name;
    const cur = out.get(k);
    if (!cur || order.indexOf(c.src) < order.indexOf(cur.src)) out.set(k, c);
  }
  return out;
}

/**
 * Переписывает внешность скинов одной библиотеки по плану.
 * @param {bxml.Node} root дерево нашей библиотеки (меняется на месте)
 * @param {string} lib имя файла библиотеки
 * @param {object} p результат plan()
 * @param {{skip?: Set<string>, off?: object, rules?: object}} [opts] skip —
 *   имена с ручными правками, off — выключенные группы `библиотека|категория`,
 *   rules — выключенные источники `{v3: false}`
 * @returns {{touched: number, ships: Set<string>}} ships — какие атласы понадобились
 */
function convert(root, lib, p, opts) {
  const o = opts || {};
  const chosen = pick(p, o);
  const ships = new Set();
  let touched = 0;
  for (const { node } of skinNodes(root)) {
    const name = node.attrs.get('name');
    const c = chosen.get(lib + '|' + name);
    if (!c || (o.skip && o.skip.has(name))) continue;
    // старое описание снимаем целиком: у донора может быть другой набор полей
    for (const k of [...node.attrs.keys()]) if (VISUAL.test(k)) node.attrs.delete(k);
    for (const [k, v] of c.attrs) node.attrs.set(k, v);
    if (c.texture) node.attrs.set('texture', c.texture);
    if (c.ship) ships.add(c.ship);
    touched++;
  }
  return { touched, ships };
}

module.exports = {
  Donor, AtlasFinder, ourFinder, plan, pick, convert, findCI, shipName, normTex, looksSame, ruleOn,
  importInfo, readDialogs, SOURCES, DEFAULT_OFF, DONOR_PAK, PREFIX, MANIFEST,
};
