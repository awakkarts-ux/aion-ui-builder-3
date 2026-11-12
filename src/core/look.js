'use strict';
/**
 * Микшер вида: для каждой группы деталей интерфейса — свой источник
 * внешности: «свой», «официальный Classic» или «Aion 5.x».
 *
 * Технические категории библиотек для этого не годятся: у официального
 * Classic все одиночные элементы (кнопки, рамки, прокрутка — 251 деталь)
 * лежат одной безымянной группой, а категории вроде `force` или `indun`
 * игроку ничего не говорят. Поэтому группы свои: по категории библиотеки,
 * а безымянные — по имени детали.
 *
 * Кроме скинов в микшере три переключателя того же рода: окна HUD
 * официального (hudport), списки и вкладки обычных окон (dialogfix) и
 * перекрашенные карты (maps) — у них только «свой / официальный».
 *
 * Профиль: `profile.look = { groups: { <id>: 'own'|'classic'|'v5' } }`. Нет
 * `look` — старый режим: целиком `v5.enabled` и `classic.enabled`.
 */

const SOURCES = ['own', 'classic', 'v5'];

/** Группы по порядку показа. `kind: 'switch'` — не скины, а переключатель. */
const GROUPS = [
  { id: 'frames', title: 'Рамки окон', hint: 'окна, всплывающие меню, подсказки' },
  { id: 'buttons', title: 'Кнопки', hint: 'кнопки, закрыть, плюс/минус, стрелки' },
  { id: 'tabs', title: 'Вкладки и заголовки', hint: 'вкладки окон, заголовки колонок' },
  { id: 'scroll', title: 'Прокрутка и ползунки', hint: 'полосы прокрутки, ползунки настроек' },
  { id: 'fields', title: 'Поля и переключатели', hint: 'поля ввода, списки выбора, галочки' },
  { id: 'lists', title: 'Списки и таблицы', hint: 'строки, выделение, разделители' },
  { id: 'slots', title: 'Ячейки', hint: 'ячейки предметов и умений' },
  { id: 'gauges', title: 'Полосы', hint: 'HP/MP, опыт, шкалы' },
  { id: 'hud', title: 'Элементы HUD', hint: 'мини-карта, портрет, значки на экране' },
  { id: 'menu', title: 'Меню и его значки', hint: 'кнопка меню и пункты' },
  { id: 'numbers', title: 'Цифры и счётчики', hint: 'цифры на ячейках, таймеры' },
  { id: 'chat', title: 'Чат' },
  { id: 'inventory', title: 'Инвентарь и снаряжение' },
  { id: 'skills', title: 'Окно умений и стигмы' },
  { id: 'quest', title: 'Задания' },
  { id: 'social', title: 'Группа, альянс, легион' },
  { id: 'trade', title: 'Обмен и магазины' },
  { id: 'instances', title: 'Временные зоны' },
  { id: 'pets', title: 'Питомцы' },
  { id: 'worldmap', title: 'Карта мира (элементы окна)' },
  { id: 'battlepass', title: 'Пропуск' },
  { id: 'lobby', title: 'Выбор и создание персонажа' },
  { id: 'other', title: 'Прочее' },
  { id: 'hudwin', title: 'Окна HUD', hint: 'панель умений, полосы, цель — окна официального', kind: 'switch' },
  { id: 'winfix', title: 'Списки и вкладки в окнах', hint: 'зазор строк и вкладки во всю ширину, как у официального', kind: 'switch' },
  { id: 'maptiles', title: 'Перекрашенные карты', hint: 'зоны с той же местностью', kind: 'switch' },
];
const GROUP_IDS = new Set(GROUPS.map((g) => g.id));

/** Узнаваемые детали группы — первыми в образцах и в большом превью. */
const SHOWCASE = {
  frames: ['v4_dialog', 'v4_msgbox', 'v4_popup', 'v4_tooltip'],
  buttons: ['v4_button_up', 'v4_close_up', 'v4_plus_up', 'v4_next_up'],
  tabs: ['v4_tab_button_up', 'v4_tab_button_down', 'v4_header_up', 'v4_tabpage'],
  scroll: ['v4_scroll_slider_up', 'v4_slide_bg', 'v4_slider_button_up', 'v4_scroll_plus_up'],
  fields: ['v4_editbox_bg', 'v4_droplist_bg', 'v4_radio_check', 'v4_keybox_bg'],
  lists: ['v4_row_selected', 'v4_row_mouseover', 'v4_column_bg', 'v4_row_line'],
  slots: ['v4_slot_bg', 'v4_slot_filled_bg', 'v4_slot_over', 'v4_item_selected'],
  gauges: ['v4_gauge_red', 'v4_gauge_blue', 'v4_gauge_bg', 'v4_abyss_gauge'],
  hud: ['v4_hud_radar_wnd', 'v4_hud_hp_s1', 'v4_hud_mp_s1', 'v4_hud_radar_sight'],
  menu: ['v4_start_menu_5_up', 'v4_start_menu_10_up', 'v4_start_menu_9_up', 'v4_start_menu_3_up'],
  numbers: ['v4_item_num_1', 'v4_item_num_2', 'v4_bar_num_1'],
};

/** Категория библиотеки version4.xml -> группа. */
const BY_CAT = {
  hud: 'hud', number: 'numbers', gauge: 'gauges', dialog: 'frames', equipment: 'inventory',
  force: 'social', indun: 'instances', start_menu: 'menu', skill: 'skills', chat: 'chat',
  inventory: 'inventory', help: 'other', quest: 'quest', ingameshop: 'trade', exchange: 'trade',
  party: 'social', slot: 'slots', toypet: 'pets', stigma: 'skills', union: 'social',
  spectator: 'other', influence: 'hud', mailbox: 'other', artifact: 'other',
};
/** Другие библиотеки -> группа. */
const BY_LIB = {
  'map.xml': 'worldmap', 'battlepass.xml': 'battlepass', 'v4_lobby.xml': 'lobby', 'shop.xml': 'trade',
  'free_version.xml': 'other', 'hud_s1.xml': 'hud', 'hud_s2.xml': 'hud', 'login.xml': 'lobby',
};
/** Одиночные детали без категории — по имени. Порядок важен: первое совпадение. */
const BY_NAME = [
  [/slide|slider|scroll|ruler/, 'scroll'],
  [/editbox|keybox|droplist|combobox|radio|check/, 'fields'],
  [/(^|_)row_|col_line|column|listview|treeview|listbox/, 'lists'],
  [/tab_|tabpage|_tab$|header/, 'tabs'],
  [/slot|item_selected|sealed|itemview/, 'slots'],
  [/gauge|timer/, 'gauges'],
  [/dialog|msgbox|popup|tooltip|container|image_frame|seperator|paperdoll|staticbox/, 'frames'],
  [/button|close|refresh|back|minimize|plus|minus|next|prev|drop|save|extra|tutquest|page|cross|lock/, 'buttons'],
];

/** Группа детали. */
function groupOf(lib, cat, name) {
  const l = String(lib).toLowerCase();
  if (l !== 'version4.xml') return BY_LIB[l] || 'other';
  if (cat && BY_CAT[cat]) return BY_CAT[cat];
  const n = String(name).toLowerCase();
  for (const [re, g] of BY_NAME) if (re.test(n)) return g;
  return 'other';
}

/**
 * Что включать при сборке.
 * @returns {{mixer: boolean, v5: boolean, classic: boolean, hud: boolean, fix: boolean, maps: boolean,
 *   allowV5: Function|null, allowClassic: Function|null}}
 */
function resolve(profile) {
  const cl = profile.classic || {};
  const look = profile.look;
  if (!look || !look.groups) {
    return {
      mixer: false,
      v5: !!(profile.v5 && profile.v5.enabled),
      classic: !!cl.enabled,
      hud: !!(cl.hud && cl.hud.enabled),
      fix: !!cl.enabled,
      maps: !!cl.maps,
      allowV5: null,
      allowClassic: null,
    };
  }
  const src = (g) => (SOURCES.includes(look.groups[g]) ? look.groups[g] : 'own');
  const allow = (want) => (lib, cat, name) => src(groupOf(lib, cat, name)) === want;
  const any = (want) => GROUPS.some((g) => g.kind !== 'switch' && src(g.id) === want);
  return {
    mixer: true,
    v5: any('v5'),
    classic: any('classic'),
    hud: src('hudwin') === 'classic',
    fix: src('winfix') === 'classic',
    maps: src('maptiles') === 'classic',
    allowV5: allow('v5'),
    allowClassic: allow('classic'),
  };
}

/** Микшер из старых галочек — чтобы при первом открытии было то же, что собиралось. */
function fromLegacy(profile) {
  const r = resolve(Object.assign({}, profile, { look: null }));
  const off = (profile.classic && profile.classic.off) || {};
  const groups = {};
  for (const g of GROUPS) {
    if (g.kind === 'switch') {
      groups[g.id] = { hudwin: r.hud, winfix: r.fix, maptiles: r.maps }[g.id] ? 'classic' : 'own';
      continue;
    }
    groups[g.id] = r.classic ? 'classic' : r.v5 ? 'v5' : 'own';
  }
  // выключенные раньше группы Classic, целиком попавшие в одну нашу, — свои
  for (const k of Object.keys(off)) {
    const [lib, cat] = k.split('|');
    const g = groupOf(lib, cat, '');
    if (cat && groups[g] === 'classic') groups[g] = r.v5 ? 'v5' : 'own';
  }
  return { groups };
}

module.exports = { GROUPS, GROUP_IDS, SOURCES, SHOWCASE, groupOf, resolve, fromLegacy };
