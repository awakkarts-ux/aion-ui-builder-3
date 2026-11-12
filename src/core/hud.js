'use strict';
/**
 * Диалоги интерфейса: опись, чтение раскладки и применение правок.
 *
 * Координаты во всех файлах заданы в виртуальном экране 1280x960 — клиент сам
 * растягивает его под реальное разрешение, опираясь на h_pos_align/v_pos_align
 * (к какому краю прижат диалог). Поэтому редактор показывает ровно это поле.
 */

const bxml = require('./bxml');
const dds = require('./dds');

const DESIGN_W = 1280;
const DESIGN_H = 960;

/** Понятные имена и группировка. Всё, чего здесь нет, попадает в «Прочее». */
const KNOWN = {
  radar_dialog: ['Мини-карта', 'HUD'],
  basic_status_dialog: ['Портрет и полосы', 'HUD'],
  quickbar_dialog: ['Панель умений', 'HUD'],
  quickbar_dialog_ctrl: ['Панель умений (Ctrl)', 'HUD'],
  quickbar_dialog_alt: ['Панель умений (Alt)', 'HUD'],
  quickbar_dialog_extra: ['Боковая панель умений', 'HUD'],
  quickbar_dialog_sep: ['Отдельная панель умений', 'HUD'],
  exp_bar_dialog: ['Полоса опыта', 'HUD'],
  buff_status_dialog: ['Бафы', 'HUD'],
  debuff_status_dialog: ['Дебафы', 'HUD'],
  target_dialog: ['Цель', 'HUD'],
  target_buff_status_dialog: ['Бафы цели', 'HUD'],
  target_assist_dialog: ['Цель цели', 'HUD'],
  party_dialog: ['Группа', 'HUD'],
  party_sub_dialog: ['Группа (свёрнутая)', 'HUD'],
  party_buff_dialog: ['Бафы группы', 'HUD'],
  chat_dialog: ['Чат', 'HUD'],
  chat_input_dialog: ['Строка ввода', 'HUD'],
  pet_dialog: ['Питомец', 'HUD'],
  start_dialog: ['Кнопка меню', 'HUD'],
  subzone_name_dialog: ['Название зоны', 'HUD'],
  quest_indicator_dialog: ['Список заданий', 'HUD'],
  move_state_dialog: ['Состояние движения', 'HUD'],
  timer_dialog: ['Таймер', 'HUD'],
  skill_penalty_dialog: ['Штраф умений', 'HUD'],
  mercenary_dialog: ['Наёмник', 'HUD'],
  gm_indicator_dialog: ['Метка ГМ', 'HUD'],
  help_indicator_dialog: ['Подсказка', 'HUD'],
  indun_info_dialog: ['Информация инстанса', 'HUD'],
  widewing_left_dialog: ['Крыло слева', 'HUD'],
  widewing_right_dialog: ['Крыло справа', 'HUD'],
  inventory_dialog: ['Инвентарь', 'Окна'],
  skill_dialog: ['Умения', 'Окна'],
  player_info_dialog: ['Персонаж', 'Окна'],
  quest_dialog: ['Задания', 'Окна'],
  new_map_dialog: ['Карта мира', 'Окна'],
  mailbox_dialog: ['Почта', 'Окна'],
  warehouse_dialog: ['Склад', 'Окна'],
  trade_dialog: ['Обмен', 'Окна'],
  vendor_dialog: ['Торговец', 'Окна'],
  macro_dialog: ['Макросы', 'Окна'],
  global_option_dialog: ['Настройки', 'Окна'],
  system_menu_dialog: ['Системное меню', 'Окна'],
};

/**
 * Собирает опись диалогов из уже распакованных паков.
 * @param {Object<string, Map<string, Buffer>>} paks ключ пака -> его записи
 */
function catalogue(paks) {
  const out = [];
  for (const [pakKey, files] of Object.entries(paks)) {
    for (const [entry, data] of files) {
      if (!data || data.length < 4 || data[0] !== 0x80) continue;
      let root;
      try { root = bxml.parse(data).root; } catch (e) { continue; }
      if (root.name !== 'Dialog') continue;
      const frame = root.getFrame();
      if (!frame) continue;
      const id = root.attrs.get('name') || entry.replace(/\.xml$/i, '');
      const meta = KNOWN[id];
      out.push({
        id: pakKey + '/' + entry,
        pak: pakKey,
        entry,
        dialog: id,
        title: meta ? meta[0] : id,
        group: meta ? meta[1] : 'Прочее',
        type: root.attrs.get('type') || '',
        frame,
        flags: root.getFlags(),
        movable: !root.getFlags().includes('not_movable'),
        visible: !root.getFlags().includes('not_visible'),
        hAlign: root.attrs.get('h_pos_align') || '',
        vAlign: root.attrs.get('v_pos_align') || '',
        widgets: root.kids
          .filter((k) => k.attrs.get('name'))
          .map((k) => ({
            name: k.attrs.get('name'),
            type: k.attrs.get('type') || k.name,
            frame: k.getFrame(),
            visible: !k.getFlags().includes('not_visible'),
          })),
      });
    }
  }
  out.sort((a, b) => a.title.localeCompare(b.title, 'ru'));
  return out;
}

/**
 * Применяет правки профиля к дереву одного диалога.
 * @param {bxml.Node} root
 * @param {{frame?: object, movable?: boolean, visible?: boolean,
 *          widgets?: Object<string, {visible: boolean}>}} edit
 * @returns {boolean} менялось ли что-нибудь
 */
function applyEdit(root, edit) {
  let touched = false;

  if (edit.frame) {
    const cur = root.getFrame();
    const f = Object.assign({}, cur, edit.frame);
    if (!cur || cur.x !== f.x || cur.y !== f.y || cur.w !== f.w || cur.h !== f.h) {
      root.setFrame(f);
      touched = true;
    }
  }

  if (typeof edit.movable === 'boolean') {
    const locked = root.getFlags().includes('not_movable');
    if (edit.movable && locked) { root.removeFlag('not_movable'); touched = true; }
    if (!edit.movable && !locked) { root.addFlag('not_movable'); touched = true; }
  }

  // Окно, которое таскается мышью в игре. Проверено 03.10:
  //  — с привязкой (h_pos_align/v_pos_align) и замками окно HUD не двигается;
  //  — без них таскается за пустое место окна (title_frame — область захвата);
  //  — место игра НЕ запоминает: после перезахода окно снова там, где его
  //    ставит код. Координаты из файла для бафов, карты, панели умений, HP/MP,
  //    меню и цели игра тоже не берёт (записанные x/y игнорировались) — задать
  //    место из программы нельзя, только перетащить в игре на время сессии.
  if (edit.free) {
    for (const k of ['h_pos_align', 'v_pos_align']) {
      if (root.attrs.has(k)) { root.attrs.delete(k); touched = true; }
    }
    // transparent — сквозь окно мышь его не захватит; not_focusable мешал цели
    for (const f of ['not_movable', 'not_active', 'transparent', 'not_focusable']) {
      if (root.getFlags().includes(f)) { root.removeFlag(f); touched = true; }
    }
    // окну без своей рамки — невидимое тело, за которое его тащат (см. GRIP_PRESET)
    if (!root.attrs.get('preset')) { root.attrs.set('preset', GRIP_PRESET); touched = true; }
  }

  if (typeof edit.visible === 'boolean') {
    const hidden = root.getFlags().includes('not_visible');
    if (edit.visible && hidden) { root.removeFlag('not_visible'); touched = true; }
    if (!edit.visible && !hidden) { root.addFlag('not_visible'); touched = true; }
  }

  if (edit.grid) touched = applyGrid(root, edit.grid) || touched;

  if (edit.widgets) {
    for (const [name, w] of Object.entries(edit.widgets)) {
      const node = root.kids.find((k) => k.attrs.get('name') === name);
      if (!node) continue;
      if (typeof w.visible === 'boolean') {
        const hidden = node.getFlags().includes('not_visible');
        if (w.visible && hidden) { node.removeFlag('not_visible'); touched = true; }
        if (!w.visible && !hidden) { node.addFlag('not_visible'); touched = true; }
      }
      if (w.frame) {
        const cur = node.getFrame();
        const f = Object.assign({}, cur, w.frame);
        if (!cur || cur.x !== f.x || cur.y !== f.y || cur.w !== f.w || cur.h !== f.h) {
          node.setFrame(f);
          touched = true;
        }
      }
    }
  }

  return touched;
}

/** Окна со значками эффектов — раздел «Бафы». */
const BUFF_WINDOWS = [
  ['game/buff_status_dialog.xml', 'Бафы'],
  ['game/debuff_status_dialog.xml', 'Дебафы'],
  ['game/target_buff_status_dialog.xml', 'Эффекты на цели'],
  ['game/pet_buff_status_dialog.xml', 'Эффекты на питомце'],
];

/** Ячейки сетки значков: `buff_item1…N` по порядку номера. */
function gridItems(root) {
  return root.kids
    .filter((k) => k.name === 'Widget' && /_item\d+$/i.test(k.attrs.get('name') || ''))
    .sort((a, b) => +a.attrs.get('name').match(/(\d+)$/)[1] - +b.attrs.get('name').match(/(\d+)$/)[1]);
}

/**
 * Сетка значков окна бафов: размер ячейки и сколько в ряду.
 *
 * Окна бафов в наборе s2 игра ставит сама — координаты и «можно двигать» из
 * файлов не слушает (проверено в игре 27.09.2026), но раскладку внутри окна и
 * его размер берёт из файла, как у портрета. У бафов цели и питомца все ячейки
 * лежат в одной точке, раскладывает их код — там меняется только размер.
 * @param {{size?: number, perRow?: number}} g
 */
function applyGrid(root, g) {
  const items = gridItems(root);
  if (!items.length) return false;
  const size = Math.round(g.size || +items[0].attrs.get('item_width') || 32);
  const frames = items.map((k) => k.getFrame());
  const auto = frames.every((f) => f && f.x === frames[0].x && f.y === frames[0].y);
  let touched = false;
  const setAttr = (node, k, v) => {
    if (node.attrs.has(k) && node.attrs.get(k) !== String(v)) { node.attrs.set(k, String(v)); touched = true; }
  };
  const setFrame = (node, f) => {
    const cur = node.getFrame();
    if (!cur || cur.x !== f.x || cur.y !== f.y || cur.w !== f.w || cur.h !== f.h) { node.setFrame(f); touched = true; }
  };
  if (auto) {
    for (const k of items) {
      const f = k.getFrame();
      setFrame(k, { x: f.x, y: f.y, w: size, h: size });
      setAttr(k, 'item_width', size);
      setAttr(k, 'item_height', size);
    }
    return touched;
  }
  const perRow = Math.max(1, Math.min(items.length, Math.round(g.perRow || gridInfo(root).perRow || 8)));
  const pad = frames[0].x; // отступ первой ячейки — как у родного окна (3)
  // Сдвиг влево. Проверено в игре 27.09 («Стиль Aion»): значки внутри окна
  // бафов раскладывает сама игра от левого края окна (наши кадры ячеек не
  // читает), а окно держит за ПРАВЫЙ край. Окно шире на N — левый край и все
  // значки уезжают влево на N. Вверх-вниз так не сдвинуть (y окна не слушает).
  const left = Math.max(0, Math.round(g.left || 0));
  items.forEach((k, i) => {
    setFrame(k, { x: pad + (i % perRow) * size, y: pad + Math.floor(i / perRow) * size, w: size, h: size });
    setAttr(k, 'item_width', size);
    setAttr(k, 'item_height', size);
  });
  const rows = Math.ceil(items.length / perRow);
  const cur = root.getFrame();
  setFrame(root, { x: cur.x, y: cur.y, w: perRow * size + pad * 2 + left, h: rows * size + pad * 2 });
  return touched;
}

/** Что сейчас в окне: ячеек, размер, в ряд, раскладывает ли код. */
function gridInfo(root) {
  const items = gridItems(root);
  if (!items.length) return null;
  const frames = items.map((k) => k.getFrame());
  const auto = frames.every((f) => f && f.x === frames[0].x && f.y === frames[0].y);
  return {
    count: items.length,
    size: +items[0].attrs.get('item_width') || frames[0].w,
    perRow: auto ? 0 : new Set(frames.map((f) => f.x)).size,
    auto,
  };
}

/** Полоса захвата справа: детали окна (ячейки бафов, портрет цели) клики перехватывают. */
const FREE_GRIP = 16;

/*
 * Невидимое тело окна. Окна с ячейками (бафы, ряды умений) игра тащит за
 * ячейки, а окна без них (карта, цель) — только за тело окна, то есть за его
 * рамку-пресет. Без пресета тела нет, и тащить не за что: с видимой подложкой
 * (v4_tooltip) карта и цель таскались, без неё — нет (проверено 03.10).
 * Даём таким окнам пресет с почти прозрачной картинкой (alpha 1 из 255:
 * глазом не видно, но это картинка, а не пустота).
 */
const GRIP_PRESET = 'bld_grip';
const GRIP_ATLAS = 'textures/ui/bld_grip';

/** Картинка тела — в пак программы (zz_builder.pak). */
function gripAtlas() {
  const px = Buffer.alloc(8 * 8 * 4);
  for (let i = 3; i < px.length; i += 4) px[i] = 1;
  return dds.fromRgba(8, 8, px);
}

/** Скин и пресет тела — в библиотеку version4.xml. */
function gripLibrary() {
  const sk = new bxml.Node('Skin');
  sk.attrs.set('name', GRIP_PRESET);
  sk.attrs.set('texture', GRIP_ATLAS);
  sk.attrs.set('src_image', '0,0,8,8');
  const pr = new bxml.Node('Preset');
  pr.attrs.set('name', GRIP_PRESET);
  pr.attrs.set('type', 'window');
  const ref = new bxml.Node('SkinRef');
  ref.attrs.set('name', GRIP_PRESET);
  ref.attrs.set('state', 'frame');
  pr.kids.push(ref);
  return [sk, pr];
}

/**
 * Область захвата перетаскиваемого окна: окно шире на FREE_GRIP справа,
 * захват — всё окно. Вызывать один раз, после всех правок размера.
 */
function addGrip(root) {
  const f = root.getFrame();
  if (!f) return false;
  const w = f.w + FREE_GRIP;
  root.setFrame({ x: f.x, y: f.y, w, h: f.h });
  root.attrs.set('title_frame', `0,0,${w},${f.h}`);
  return true;
}

/**
 * Окна HUD, которые можно таскать мышью в игре («Вид интерфейса» → «Двигать
 * мышью в игре»): ключ профиля -> окна в обоих наборах.
 */
const FREE_WINDOWS = {
  buffs: ['game/buff_status_dialog.xml'],
  debuffs: ['game/debuff_status_dialog.xml'],
  radar: ['hud_s1/radar_dialog.xml', 'hud_s2/radar_dialog.xml'],
  // Цель, бафы цели и HP/MP не таскаются ни с телом, ни с видимой подложкой —
  // их место держит код (цель по центру сверху / у полос HP, HP/MP в нижней
  // группе), проверено 03.10. В список не входят.
  quickbar: ['hud_s1/quickbar_dialog.xml', 'hud_s2/quickbar_dialog.xml'],
  extra: ['game/quickbar_dialog_extra.xml'],
  ctrl: ['game/quickbar_dialog_ctrl.xml'],
  alt: ['game/quickbar_dialog_alt.xml'],
  start: ['hud_s1/start_dialog.xml', 'hud_s2/start_dialog.xml'],
};

module.exports = { catalogue, applyEdit, applyGrid, gridInfo, addGrip, gripAtlas, gripLibrary,
  GRIP_ATLAS, BUFF_WINDOWS, FREE_WINDOWS, FREE_GRIP, DESIGN_W, DESIGN_H, KNOWN };
