'use strict';
/**
 * Каталог элементов интерфейса — основа редактора.
 *
 * Скин — один кусок атласа. Элемент — то, что видит игрок: кнопка со всеми
 * состояниями (пресет из SkinRef up/over/down), полоса, ячейка, рамка окна.
 * Окна зовут элементы атрибутами `preset`, `close_preset`, `…_preset` и дочерним
 * `<Skin name>`. Замерено 29.09.2026 на клиенте AionEmpire: пресетов 1120, из
 * них окна зовут 381; скинов 3811, напрямую из окон — 243. Показываем то, что
 * зовут окна; заменять разрешаем на любой элемент того же вида, в том числе
 * на тот, который окна не зовут (кнопки Aion 5.x и т. п.).
 */

const bxml = require('./bxml');
const skins = require('./skins');

const DIALOG_PAKS = ['ui', 'game', 'hud_s1', 'hud_s2'];
const STRING_TABLES = ['Strings/client_strings_ui.xml', 'Strings/StringTable_Dialog.xml'];
/** Одноимённые скины и пресеты в нескольких библиотеках: кто раньше, тот и главный. */
const LIB_FIRST = ['version4.xml', 'hud_s1.xml', 'hud_s2.xml', 'map.xml', 'free_version.xml'];

/** Окна предпросмотра (согласовано 29.09.2026): HUD «Стиля Aion» и частые окна. */
const FEATURED = [
  { id: 'hud_s1/basic_status_dialog.xml', title: 'HP/MP', hud: true },
  { id: 'hud_s1/quickbar_dialog.xml', title: 'Панель умений', hud: true },
  { id: 'hud_s1/exp_bar_dialog.xml', title: 'Полоса опыта', hud: true },
  { id: 'hud_s1/start_dialog.xml', title: 'Меню', hud: true },
  { id: 'hud_s1/radar_dialog.xml', title: 'Мини-карта', hud: true },
  { id: 'game/target_dialog.xml', title: 'Цель', hud: true },
  { id: 'game/buff_status_dialog.xml', title: 'Бафы', hud: true },
  { id: 'game/debuff_status_dialog.xml', title: 'Дебафы', hud: true },
  { id: 'game/party_dialog.xml', title: 'Группа', hud: true },
  { id: 'game/chat_dialog.xml', title: 'Чат', hud: true },
  { id: 'game/party_match_dialog.xml', title: 'Поиск группы' },
  { id: 'game/guild_info_dialog.xml', title: 'Легион' },
  { id: 'game/player_info_dialog.xml', title: 'Профиль' },
  { id: 'game/inventory_dialog.xml', title: 'Инвентарь' },
  { id: 'game/skill_dialog.xml', title: 'Умения' },
  { id: 'game/quest_dialog.xml', title: 'Задания' },
  { id: 'game/new_map_dialog.xml', title: 'Карта мира' },
  { id: 'game/trade_dialog.xml', title: 'Магазин NPC' },
  { id: 'game/warehouse_dialog.xml', title: 'Склад' },
  { id: 'game/mailbox_dialog.xml', title: 'Почта' },
  { id: 'game/who_dialog.xml', title: 'Друзья' },
  { id: 'game/exchange_dialog.xml', title: 'Торговля' },
  { id: 'game/vendor_dialog.xml', title: 'Биржа' },
];

/**
 * Окна с вариантами: игра показывает один контейнер из нескольких (цель —
 * по виду моба). Предпросмотр рисует выбранный, названия элементов говорят,
 * к какому варианту они относятся. Снято с окна цели 30.09.2026.
 */
const VARIANTS = {
  'game/target_dialog.xml': [
    ['container1', 'Обычный'], ['container2', 'Элитный'], ['container3', 'Герой'],
    ['container4', 'Легенда'], ['container5', 'Питомец'], ['container6', 'Чужой питомец'],
  ],
};

/**
 * Вкладки окна: набор (`tabsheet`) — полоса кнопок (`tabbutton` внутри `tab`)
 * и страницы (`tabpage`), кнопка соответствует странице по порядку. Игра
 * показывает одну страницу. @returns {{name, pages: [{node, button, title}]}|null}
 */
function tabsOf(sheet, str) {
  const pages = sheet.kids.filter((k) => k.name === 'Widget' && k.attrs.get('type') === 'tabpage');
  if (!pages.length) return null;
  const bar = sheet.kids.find((k) => k.name === 'Widget' && k.attrs.get('type') === 'tab');
  const buttons = bar ? bar.kids.filter((k) => k.name === 'Widget' && k.attrs.get('type') === 'tabbutton') : [];
  return {
    name: sheet.attrs.get('name') || 'tabsheet',
    pages: pages.map((node, i) => {
      const button = buttons[i] || null;
      const hidden = button && button.getFlags().includes('not_visible');
      const title = (button && str(button.attrs.get('text'))) ||
        'Вкладка ' + (i + 1); // имена страниц техничные (ch_tabpage_2) — номер понятнее
      return { node, button, title, hidden };
    }),
  };
}

/** Вид элемента: по типу пресета, а у скина без пресета — по типу виджета. */
const KIND_OF_TYPE = {
  button: 'button', gaugebutton: 'button', tabbutton: 'tab',
  static: 'image', image: 'image', imageex: 'image', staticex: 'image',
  gauge: 'gauge', flygauge: 'gauge',
  itemview: 'slot',
  window: 'frame', dialog: 'frame',
  container: 'panel', containerex: 'panel', extensible: 'panel', tabpage: 'panel', scrollable: 'panel',
  listview: 'list', listviewex: 'list', listbox: 'list', checklistview: 'list', treeview: 'list',
  itemgrouplist: 'list', grid: 'list',
  scrollbar: 'scroll', slide: 'slider',
  tabframe: 'tabs', tab: 'tabs', tabsheet: 'tabs',
  keybox: 'input', editbox: 'input', combobox: 'input',
  pagecontrol: 'pager',
};
const KINDS = {
  button: 'Кнопка', tab: 'Вкладка', image: 'Картинка', gauge: 'Полоса', slot: 'Ячейка',
  frame: 'Рамка окна', panel: 'Подложка', list: 'Список', scroll: 'Прокрутка', slider: 'Ползунок',
  tabs: 'Вкладки', input: 'Поле ввода', pager: 'Листалка', other: 'Прочее',
};

const STATE_TITLES = {
  up: 'обычная', over: 'наведение', down: 'нажата', disable: 'выключена', disabled: 'выключена',
  select: 'выбрана', selected: 'выбрана', check: 'отмечена', uncheck: 'не отмечена',
  frame: 'рамка', bg: 'фон', slot: 'ячейка', slot_filled: 'ячейка с предметом',
  slot_mouseover: 'наведение', gauge: 'заполнение', row_selected: 'выбранная строка',
  row_over: 'строка под курсором', row_odd: 'нечётная строка', row_even: 'чётная строка',
  header: 'заголовок', header_over: 'заголовок под курсором', header_down: 'заголовок нажат',
  header_disabled: 'заголовок выключен', col_line: 'линия колонок', normal: 'обычная',
  defbutton: 'по умолчанию', left_tabline: 'линия слева', middle_tabline: 'линия посередине',
  right_tabline: 'линия справа', 0: 'обычная',
};

/** Типы пресетов, которые ничего не говорят о роли: роль берём из виджетов, которые их зовут. */
const GENERIC_TYPES = new Set(['', '?', 'static', 'image', 'container']);

/** Окна второго набора HUD и копии «чужого» просмотра — названием из известных, с пометкой. */
const SET_SUFFIX = { hud_s2: ' (Обычный стиль)' };

/** Подсказки из технического имени («Кнопка (почта)»): первая подошедшая. */
const NAME_HINTS = [
  [/express_mail/, 'срочная почта'], [/cash_mail/, 'почта магазина'], [/mail/, 'почта'],
  [/zoom/, 'масштаб'], [/map/, 'карта'], [/shop|spinel|qina/, 'магазин'], [/fly/, 'полёт'],
  [/^bp_/, 'боевой пропуск'], [/lock/, 'замок'], [/help/, 'справка'],
  [/close/, 'закрыть'], [/minimi[sz]e|reduce/, 'свернуть'], [/check/, 'галочка'], [/radio/, 'переключатель'],
  [/plus/, 'плюс'], [/minus/, 'минус'], [/arrow|_left|_right|prev|next/, 'стрелка'],
  [/scroll/, 'прокрутка'], [/tooltip/, 'подсказка'], [/title/, 'заголовок'], [/slot/, 'ячейка'],
  [/tab/, 'вкладка'], [/drop|combo/, 'выпадающий список'], [/edit|input/, 'поле ввода'],
  [/gauge|bar/, 'полоса'], [/hp/, 'здоровье'], [/mp/, 'мана'], [/exp/, 'опыт'],
];

/** Таблицы строк клиента: `STR_…` (без регистра) -> текст. */
function readStrings(client, lang) {
  const out = new Map();
  let src;
  try { src = client.l10nRead(lang, STRING_TABLES); } catch (e) { return out; }
  for (const buf of src.values()) {
    const t = buf.toString(buf[0] === 0xff && buf[1] === 0xfe ? 'utf16le' : 'utf8');
    const re = /<name>([^<]+)<\/name>\s*<body>([^<]*)<\/body>/g;
    let m;
    while ((m = re.exec(t))) out.set(m[1].toLowerCase(), m[2].trim());
  }
  return out;
}

/** Состояние записи SkinRef: `up`, `1:down` (у кнопки с двумя режимами), `frame`. */
function refState(attrs) {
  if (attrs.has('sub_state')) {
    const main = attrs.get('main_state') || '0';
    return (main === '0' ? '' : main + ':') + attrs.get('sub_state');
  }
  return attrs.get('state') || '';
}

function stateTitle(state) {
  const m = /^(\d+):(.+)$/.exec(state);
  const base = m ? m[2] : state;
  const t = STATE_TITLES[base.toLowerCase()] || (/^\d+$/.test(base) ? 'вариант ' + base : base);
  return m ? `${t} (режим ${m[1]})` : t;
}

/** Наименьший размер скина: у простого — прямоугольник, у рамки из девяти — углы плюс середина. */
function skinSize(row) {
  const r = row.rects;
  if (r.src_image) return [r.src_image.w, r.src_image.h];
  const w = (k) => (r[k] ? r[k].w : 0);
  const h = (k) => (r[k] ? r[k].h : 0);
  return [
    w('src_left_middle') + w('src_middle_middle') + w('src_right_middle') ||
      w('src_left_top') + w('src_middle_top') + w('src_right_top'),
    h('src_middle_top') + h('src_middle_middle') + h('src_middle_bottom') ||
      h('src_left_top') + h('src_left_middle') + h('src_left_bottom'),
  ];
}

const libRank = (lib) => {
  const i = LIB_FIRST.indexOf(lib);
  return i < 0 ? (/^version5/i.test(lib) ? 99 : 50) : i;
};

/**
 * @param {object} src
 * @param {Map<string, Buffer>} src.libs библиотеки preload: имя -> содержимое
 * @param {Map<string, Buffer>} src.dialogs окна: `game/inventory_dialog.xml` -> содержимое
 * @param {Map<string, string>} [src.strings] строки клиента (readStrings)
 * @param {Object<string, string>} [src.names] ручные названия: id элемента -> название
 */
function build(src) {
  const strings = src.strings || new Map();
  const names = src.names || {};
  const str = (k) => (k && strings.get(String(k).toLowerCase())) || '';

  // --- библиотеки: скины и пресеты ---------------------------------------
  const skinByName = new Map(); // имя -> строка skins.list
  const presets = new Map(); // имя -> { lib, type, refs: [{state, skin}] }
  const libs = [...src.libs.keys()].filter((l) => /\.xml$/i.test(l)).sort((a, b) => libRank(a) - libRank(b));
  for (const lib of libs) {
    const data = src.libs.get(lib);
    let rows;
    let root;
    try { root = bxml.parse(data).root; rows = skins.list(data, lib); } catch (e) { continue; }
    for (const r of rows) if (!skinByName.has(r.name)) skinByName.set(r.name, r);
    for (const n of root.walk()) {
      if (n.name !== 'Preset') continue;
      const name = n.attrs.get('name');
      if (!name || presets.has(name)) continue;
      const refs = n.kids.filter((k) => k.name === 'SkinRef' && k.attrs.get('name'))
        .map((k) => ({ state: refState(k.attrs), skin: k.attrs.get('name') }));
      presets.set(name, { lib, type: n.attrs.get('type') || '', refs });
    }
  }

  // --- окна: кто кого зовёт ----------------------------------------------
  const featured = new Map(FEATURED.map((f) => [f.id, f]));
  const featuredType = new Map(); // тип окна -> название известного (заполняется ниже)
  const windows = [];
  const uses = new Map(); // id элемента -> [{ win, widget, type, text }]
  const use = (id, u) => {
    if (!uses.has(id)) uses.set(id, []);
    uses.get(id).push(u);
  };
  for (const [wid, data] of src.dialogs) {
    let root;
    try { root = bxml.parse(data).root; } catch (e) { continue; }
    const dlg = root.name === 'Dialog' ? root : [...root.walk()].find((n) => n.name === 'Dialog');
    if (!dlg) continue;
    const f = featured.get(wid);
    if (f) featuredType.set(dlg.attrs.get('type') || '', f.title);
    windows.push({
      id: wid,
      title: (f && f.title) || str(dlg.attrs.get('title_text')) || '',
      type: dlg.attrs.get('type') || '',
      frame: dlg.attrs.get('frame') || '',
      featured: !!f,
      hud: !!(f && f.hud),
      variants: (VARIANTS[wid] || []).map(([id, title]) => ({ id, title })),
      order: f ? FEATURED.indexOf(f) : -1,
    });
    const variants = new Map(VARIANTS[wid] || []);
    const pageTitle = new Map(); // страница вкладки -> название вкладки
    const sheets = [];
    for (const n of dlg.walk()) {
      if (n.name !== 'Widget' || n.attrs.get('type') !== 'tabsheet') continue;
      const t = tabsOf(n, str);
      if (!t) continue;
      sheets.push({ name: t.name, pages: t.pages.map((p) => ({ title: p.title, hidden: !!p.hidden })) });
      for (const p of t.pages) pageTitle.set(p.node, p.title);
    }
    windows[windows.length - 1].tabs = sheets;
    // scope — область, для которой элемент можно сделать отдельным (splitDialog):
    // контейнер варианта или страница вкладки; пусто — всё окно
    const walk = (n, parent, variant, scope) => {
      if (parent && parent.name === 'Dialog' && variants.has(n.attrs.get('name'))) {
        variant = variants.get(n.attrs.get('name'));
        scope = n.attrs.get('name');
      }
      if (pageTitle.has(n)) {
        variant = variant ? variant + ', ' + pageTitle.get(n) : pageTitle.get(n);
        if (n.attrs.get('name')) scope = n.attrs.get('name');
      }
      const type = n.name === 'Dialog' ? 'dialog' : (n.attrs.get('type') || '');
      const u = () => ({ win: wid, widget: n.attrs.get('name') || '', type, text: str(n.attrs.get('text')), variant, scope });
      for (const [a, v] of n.attrs) {
        if (a === 'preset' || /_preset$/.test(a)) {
          if (presets.has(v)) use('p:' + v, Object.assign(u(), { attr: a }));
        }
      }
      if (n.name === 'Skin' && parent) {
        const v = n.attrs.get('name');
        const pu = { win: wid, widget: parent.attrs.get('name') || '', type: parent.attrs.get('type') || '', text: '', variant, scope };
        if (presets.has(v)) use('p:' + v, pu);
        else if (skinByName.has(v)) use('s:' + v, pu);
      }
      for (const k of n.kids) walk(k, n, variant, scope);
    };
    walk(dlg, null, null, '');
  }
  // без заголовка: как у известного окна того же типа (радар второго набора), иначе по имени файла
  for (const w of windows) {
    if (w.title) continue;
    const known = featuredType.get(w.type);
    w.title = known ? known + (SET_SUFFIX[w.id.split('/')[0]] || '')
      : w.id.replace(/^.*\//, '').replace(/(_dialog)?\.xml$/i, '');
  }
  const winTitle = new Map(windows.map((w) => [w.id, w.title]));

  // --- элементы -----------------------------------------------------------
  const elements = [];
  const inPreset = new Set();
  for (const p of presets.values()) for (const r of p.refs) inPreset.add(r.skin);

  const majority = (list) => {
    const c = new Map();
    for (const x of list) c.set(x, (c.get(x) || 0) + 1);
    return [...c].sort((a, b) => b[1] - a[1])[0];
  };
  const kindOf = (type, us) => {
    if (us && us.some((u) => u.type === 'dialog' && u.attr === 'preset')) return 'frame';
    const m = us && us.length ? majority(us.map((u) => KIND_OF_TYPE[u.type] || 'other')) : null;
    if (KIND_OF_TYPE[type] && !(GENERIC_TYPES.has(type) && m && m[0] !== 'other')) return KIND_OF_TYPE[type];
    return m ? m[0] : (KIND_OF_TYPE[type] || 'other');
  };

  const add = (id, tech, lib, kind, states, us) => {
    const main = states.map((s) => skinByName.get(s.skin)).find(Boolean);
    if (!main) return; // ни одного живого скина — показать нечего
    const wins = [...new Set((us || []).map((u) => u.win))];
    const el = {
      id, tech, lib, kind, kindTitle: KINDS[kind],
      states: states.map((s) => ({ state: s.state, title: stateTitle(s.state), skin: s.skin })),
      size: skinSize(main),
      nine: main.nine,
      used: (us || []).length,
      windows: wins,
    };
    // места, для которых элемент можно сделать отдельным: окно + область (вариант, вкладка)
    const scopes = new Map();
    for (const u of us || []) {
      const key = u.win + '#' + (u.scope || '');
      if (scopes.has(key)) continue;
      const t = winTitle.get(u.win) || u.win;
      scopes.set(key, { win: u.win, scope: u.scope || '', title: u.variant ? `${t} (${u.variant})` : t });
    }
    el.scopes = [...scopes.values()];
    el.title = names[id] || autoTitle(el, us || [], winTitle);
    el.named = !!names[id];
    elements.push(el);
  };

  for (const [name, p] of presets) {
    const us = uses.get('p:' + name);
    add('p:' + name, name, p.lib, kindOf(p.type, us), p.refs.length ? p.refs : [], us);
  }
  for (const [name, row] of skinByName) {
    const us = uses.get('s:' + name);
    // скин из пресета отдельно показываем, только если окна зовут его и напрямую
    if (inPreset.has(name) && !us) continue;
    add('s:' + name, name, row.lib, us ? kindOf('', us) : (row.nine ? 'panel' : 'image'),
      [{ state: '', skin: name }], us);
  }

  windows.sort((a, b) => (a.featured !== b.featured ? (a.featured ? -1 : 1)
    : a.featured ? a.order - b.order : a.title.localeCompare(b.title, 'ru')));
  for (const w of windows) delete w.order;
  return { elements, windows, skinByName };
}

/** Черновое название: вид, надпись на кнопке, окна; у общих — подсказка из имени. */
function autoTitle(el, us, winTitle) {
  const label = (us.find((u) => u.text) || {}).text;
  // окно с вариантами — с их перечнем: «Цель (Герой, Легенда)» — видно, что общее
  const vars = new Map();
  for (const u of us) {
    if (!u.variant) continue;
    if (!vars.has(u.win)) vars.set(u.win, new Set());
    vars.get(u.win).add(u.variant);
  }
  const wins = el.windows.map((w) => {
    const t = winTitle.get(w);
    return t && vars.has(w) ? `${t} (${[...vars.get(w)].join(', ')})` : t;
  }).filter(Boolean);
  const uniq = [...new Set(wins)];
  if (us.length && us.every((u) => u.widget === 'bg') && el.kind === 'image') el = Object.assign({}, el, { kindTitle: 'Фон' });
  const low = el.tech.toLowerCase();
  let hint = (NAME_HINTS.find(([re]) => re.test(low)) || [])[1];
  if (hint && el.kindTitle.toLowerCase().includes(hint)) hint = ''; // «Поле ввода (поле ввода)»
  const shared = uniq.length > 3; // у общей надпись первого окна сбивала бы с толку
  const head = el.kindTitle + (label && !shared ? ` «${label}»` : hint ? ` (${hint})` : '');
  if (!us.length) return `${head} · не используется`;
  if (shared) return `${head} · общая, окон ${uniq.length}`;
  return `${head} · ${uniq.join(', ')}`;
}

/**
 * На что можно заменить элемент: тот же вид, похожие состояния и размер.
 * Рамки из девяти кусков тянутся — у них размер не важен.
 * @returns {Array<{id: string, score: number}>} лучшие сначала
 */
function candidates(cat, id, limit) {
  const el = cat.elements.find((e) => e.id === id);
  if (!el) return [];
  const states = new Set(el.states.map((s) => s.state));
  const out = [];
  for (const c of cat.elements) {
    if (c.id === id || c.kind !== el.kind) continue;
    let score = 0;
    // состояния: у кнопки без «наведения» замена будет мигать родным
    const cs = new Set(c.states.map((s) => s.state));
    for (const s of states) if (!cs.has(s)) score += 2;
    if (!el.nine || !c.nine) {
      score += Math.abs(Math.log((c.size[0] || 1) / (el.size[0] || 1))) +
        Math.abs(Math.log((c.size[1] || 1) / (el.size[1] || 1)));
    } else {
      // рамки тянутся — размер не важен, но пропорции подсказывают назначение
      const ar = (s) => Math.log((s[0] || 1) / (s[1] || 1));
      score += 0.3 * Math.abs(ar(c.size) - ar(el.size));
    }
    if (el.nine !== c.nine) score += 1;
    // при равенстве — то, что игра реально показывает в окнах
    if (!c.used) score += 0.05;
    out.push({ id: c.id, score: Math.round(score * 100) / 100 });
  }
  out.sort((a, b) => a.score - b.score);
  return out.slice(0, limit || 120);
}

/** Внешность скина — всё, кроме имени: атлас, тип, куски, размеры. */
const LOOK_ATTR = (k) => k === 'texture' || k === 'type' || /^(src_|size_)/.test(k);

function copyLook(from, to) {
  for (const k of [...to.attrs.keys()]) if (LOOK_ATTR(k)) to.attrs.delete(k);
  for (const [k, v] of from.attrs) if (LOOK_ATTR(k)) to.attrs.set(k, v);
}

/** Своя картинка элемента: текстура в паке программы (zz_builder.pak). */
function ownTexture(id, state) {
  let h = 0;
  for (const c of id + '|' + state) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return 'textures/ui/bld_el_' + h.toString(36);
}

/**
 * Правки редактора — последним слоем, поверх всех остальных.
 * Вариант: у каждого скина элемента внешность берётся у скина варианта в том же
 * состоянии (нет такого — «в покое»). Своя картинка: скин смотрит на неё целиком.
 * @param {Map<string, {root: bxml.Node, n: number}>} parsed библиотеки после прочих слоёв
 * @param {Object<string, {from?: string, images?: Object<string, string>}>} edits
 * @param {(file: string) => Buffer|null} readImage DDS своей картинки
 * @returns {{touched: number, files: Map<string, Buffer>, missing: string[]}}
 */
function applyEdits(parsed, edits, readImage) {
  const skinNode = new Map(); // имя -> { node, lib }
  const presetRefs = new Map(); // имя пресета -> [{ state, skin }]
  const libs = [...parsed.keys()].sort((a, b) => libRank(a) - libRank(b));
  for (const lib of libs) {
    for (const n of parsed.get(lib).root.walk()) {
      const name = n.attrs.get('name');
      if (!name) continue;
      if (n.name === 'Skin' && !skinNode.has(name)) skinNode.set(name, { node: n, lib });
      if (n.name === 'Preset' && !presetRefs.has(name)) {
        presetRefs.set(name, n.kids.filter((k) => k.name === 'SkinRef' && k.attrs.get('name'))
          .map((k) => ({ state: refState(k.attrs), skin: k.attrs.get('name') })));
      }
    }
  }
  const statesOf = (id) => {
    if (id.startsWith('p:')) return presetRefs.get(id.slice(2)) || null;
    if (id.startsWith('s:')) return skinNode.has(id.slice(2)) ? [{ state: '', skin: id.slice(2) }] : null;
    return null;
  };

  let touched = 0;
  const files = new Map();
  const missing = [];
  for (const [id, edit] of Object.entries(edits || {})) {
    const target = statesOf(id);
    if (!target || !edit) { missing.push(id); continue; }
    const done = new Set(); // один скин бывает в нескольких состояниях — первое решает
    const put = (skin, fn) => {
      const t = skinNode.get(skin);
      if (!t || done.has(skin)) return;
      done.add(skin);
      fn(t.node);
      parsed.get(t.lib).n++;
      touched++;
    };
    if (edit.from) {
      const src = statesOf(edit.from);
      if (!src || !src.length) { missing.push(edit.from); continue; }
      const by = new Map(src.map((s) => [s.state, s.skin]));
      const rest = by.get(REST_STATES.find((r) => by.has(r))) || src[0].skin;
      for (const t of target) {
        const s = skinNode.get(by.get(t.state) || rest);
        if (s) put(t.skin, (node) => copyLook(s.node, node));
      }
    } else if (edit.images) {
      const first = Object.keys(edit.images)[0];
      for (const t of target) {
        const st = t.state in edit.images ? t.state : first;
        const file = edit.images[st];
        const raw = file && readImage(file);
        if (!raw) { missing.push(file || id); continue; }
        const tex = ownTexture(id, st);
        const name = tex.split('/').pop() + '.dds';
        files.set(name, raw);
        const [w, h] = [raw.readUInt32LE(16), raw.readUInt32LE(12)]; // DDS: высота, потом ширина
        put(t.skin, (node) => {
          for (const k of [...node.attrs.keys()]) if (LOOK_ATTR(k)) node.attrs.delete(k);
          node.attrs.set('texture', tex);
          node.attrs.set('src_image', [0, 0, w, h].join(','));
        });
      }
    }
  }
  return { touched, files, missing };
}

/* ---------- «сделать отдельным» ----------
 * Один элемент нередко стоит в нескольких местах (полоса HP у героя и легенды
 * в окне цели, рамка на 28 окон). Отделить: копия пресета и его скинов под
 * своим именем + в окне (только внутри области — контейнера варианта или
 * страницы вкладки) ссылки переводятся на копию. Правки редактора дальше
 * ложатся на копию как на обычный элемент. profile.splits: [{ win, scope, el }]. */

/** Имя копии: `v3_hp_gauge_monster__bld_container4`. */
function splitName(name, win, scope) {
  const tag = (scope || String(win).replace(/^.*\//, '').replace(/(_dialog)?\.xml$/i, '')).replace(/\W+/g, '_');
  return `${name}__bld_${tag}`;
}

/** Правка окна: ссылки на элемент внутри области — на копию. @returns {boolean} */
function splitDialog(root, splits) {
  const dlg = root.name === 'Dialog' ? root : [...root.walk()].find((n) => n.name === 'Dialog');
  if (!dlg) return false;
  let touched = false;
  for (const s of splits || []) {
    const base = String(s.el).slice(2);
    const to = splitName(base, s.win, s.scope);
    const top = s.scope ? [...dlg.walk()].find((n) => n !== dlg && n.attrs.get('name') === s.scope) : dlg;
    if (!top) continue;
    for (const n of top.walk()) {
      for (const [a, v] of n.attrs) {
        if (v !== base) continue;
        if (a === 'preset' || /_preset$/.test(a) || (n.name === 'Skin' && a === 'name')) {
          n.attrs.set(a, to);
          touched = true;
        }
      }
    }
  }
  return touched;
}

function cloneNode(n) {
  const c = new bxml.Node(n.name);
  c.text = n.text;
  for (const [k, v] of n.attrs) c.attrs.set(k, v);
  c.kids = n.kids.map(cloneNode);
  return c;
}

/**
 * Копии элементов в библиотеках — рядом с оригиналами, после прочих слоёв
 * (копия выглядит как оригинал в итоговом виде).
 * @param {Map<string, {root: bxml.Node, n: number}>} parsed
 * @returns {{added: number, missing: string[]}}
 */
function applySplits(parsed, splits) {
  const libs = [...parsed.keys()].sort((a, b) => libRank(a) - libRank(b));
  const find = (kind, name) => {
    for (const lib of libs) {
      const walkParents = (node) => {
        for (const k of node.kids) {
          if (k.name === kind && k.attrs.get('name') === name) return { node: k, parent: node, lib };
          const hit = walkParents(k);
          if (hit) return hit;
        }
        return null;
      };
      const hit = walkParents(parsed.get(lib).root);
      if (hit) return hit;
    }
    return null;
  };
  const insertAfter = (hit, clone) => {
    const i = hit.parent.kids.indexOf(hit.node);
    hit.parent.kids.splice(i + 1, 0, clone);
    parsed.get(hit.lib).n++;
  };
  const made = new Set();
  const cloneSkin = (name, to) => {
    if (made.has('s:' + to)) return true;
    const hit = find('Skin', name);
    if (!hit) return false;
    const c = cloneNode(hit.node);
    c.attrs.set('name', to);
    insertAfter(hit, c);
    made.add('s:' + to);
    return true;
  };
  let added = 0;
  const missing = [];
  for (const s of splits || []) {
    const base = String(s.el).slice(2);
    const to = splitName(base, s.win, s.scope);
    if (s.el.startsWith('s:')) {
      if (cloneSkin(base, to)) added++;
      else missing.push(s.el);
      continue;
    }
    if (made.has('p:' + to)) continue;
    const hit = find('Preset', base);
    if (!hit) { missing.push(s.el); continue; }
    const c = cloneNode(hit.node);
    c.attrs.set('name', to);
    for (const r of c.kids) {
      const sk = r.name === 'SkinRef' && r.attrs.get('name');
      if (!sk) continue;
      const skTo = splitName(sk, s.win, s.scope);
      if (cloneSkin(sk, skTo)) r.attrs.set('name', skTo);
    }
    insertAfter(hit, c);
    made.add('p:' + to);
    added++;
  }
  return { added, missing };
}

/** Какой кусок пресета «в покое» — как рисует предпросмотр. */
const REST_STATES = ['frame', 'bg', 'slot', '0', 'up', 'normal', '0:up', 'wait_for_key', 'left_tabline'];

/** Всё для каталога из клиента: окна четырёх паков, preload, строки. */
function fromClient(client, lang, names) {
  const dialogs = new Map();
  for (const key of DIALOG_PAKS) {
    if (!client.has(key)) continue;
    for (const [entry, data] of client.original(key)) {
      if (/\.xml$/i.test(entry)) dialogs.set(key + '/' + entry, data);
    }
  }
  return build({
    libs: client.original('preload'),
    dialogs,
    strings: readStrings(client, lang),
    names,
  });
}

module.exports = {
  build, fromClient, candidates, readStrings, applyEdits, ownTexture, tabsOf,
  splitName, splitDialog, applySplits,
  FEATURED, KINDS, DIALOG_PAKS, REST_STATES, VARIANTS,
};
