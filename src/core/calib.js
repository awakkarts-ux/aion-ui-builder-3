'use strict';
/**
 * Режим разметки окон HUD — для конструктора раскладки.
 *
 * Окна HUD игра ставит сама: координаты из файла не слушает, размер и
 * раскладку внутри окна (кроме окон, где её делает код, как у бафов) —
 * слушает. Чтобы двигать содержимое окна, надо знать, за какой угол игра
 * держит окно и куда оно растёт. Разметка отвечает на это одним заходом:
 * каждое окно шире и выше на GROW и обведено рамкой своего цвета, содержимое
 * стоит как было (от левого верхнего угла окна). По скриншоту видно, куда
 * ушла рамка относительно содержимого — это и есть правило окна.
 */

const bxml = require('./bxml');
const dds = require('./dds');

const ATLAS = 'textures/ui/bld_calib';
const CELL = 16; // одна клетка на цвет: рамка 3 px, заливка полупрозрачная
const GROW = { w: 200, h: 100 };

/** Окна разметки: [имя окна, цвет, подпись в легенде]. `hud` — в наборе стиля, иначе в game/. */
const WINDOWS = [
  ['basic_status_dialog', [230, 40, 40], 'портрет и полосы HP/MP', 'hud'],
  ['radar_dialog', [40, 200, 230], 'мини-карта', 'hud'],
  ['quickbar_dialog', [240, 200, 30], 'панель умений', 'hud'],
  ['exp_bar_dialog', [255, 255, 255], 'полоса опыта', 'hud'],
  ['start_dialog', [240, 120, 20], 'меню', 'hud'],
  ['target_dialog', [220, 50, 230], 'цель', 'game'],
  ['target_assist_dialog', [255, 140, 200], 'цель цели', 'game'],
  ['buff_status_dialog', [60, 220, 80], 'бафы', 'game'],
  ['debuff_status_dialog', [40, 90, 240], 'дебафы', 'game'],
  ['quickbar_dialog_extra', [160, 255, 60], 'боковая панель III', 'game'],
];

/** Атлас: по клетке на окно. */
function atlas() {
  const W = CELL * WINDOWS.length;
  const px = Buffer.alloc(W * CELL * 4);
  WINDOWS.forEach(([, [r, g, b]], i) => {
    for (let y = 0; y < CELL; y++) {
      for (let x = 0; x < CELL; x++) {
        const d = Math.min(x, y, CELL - 1 - x, CELL - 1 - y);
        const o = (y * W + i * CELL + x) * 4;
        px[o] = r; px[o + 1] = g; px[o + 2] = b;
        px[o + 3] = d < 3 ? 255 : 40;
      }
    }
  });
  return dds.fromRgba(W, CELL, px);
}

const skinName = (i) => 'bld_calib_' + i;

/** Скины рамки из девяти кусков — толщина рамки не растягивается с окном. */
function skins() {
  return WINDOWS.map((_, i) => {
    const n = new bxml.Node('Skin');
    const x = i * CELL;
    const c = 3;
    const m = CELL - 2 * c;
    const rect = (rx, ry, rw, rh) => `${x + rx},${ry},${rw},${rh}`;
    n.attrs.set('name', skinName(i));
    n.attrs.set('texture', ATLAS);
    n.attrs.set('type', 'tiled');
    n.attrs.set('src_image', rect(0, 0, CELL, CELL));
    n.attrs.set('src_left_top', rect(0, 0, c, c));
    n.attrs.set('src_middle_top', rect(c, 0, m, c));
    n.attrs.set('src_right_top', rect(c + m, 0, c, c));
    n.attrs.set('src_left_middle', rect(0, c, c, m));
    n.attrs.set('src_middle_middle', rect(c, c, m, m));
    n.attrs.set('src_right_middle', rect(c + m, c, c, m));
    n.attrs.set('src_left_bottom', rect(0, c + m, c, c));
    n.attrs.set('src_middle_bottom', rect(c, c + m, m, c));
    n.attrs.set('src_right_bottom', rect(c + m, c + m, c, c));
    for (const k of ['left_top', 'right_top', 'left_bottom', 'right_bottom']) n.attrs.set('size_' + k, `${c},${c}`);
    for (const k of ['middle_top', 'middle_bottom']) n.attrs.set('size_' + k, `0,${c}`);
    for (const k of ['left_middle', 'right_middle']) n.attrs.set('size_' + k, `${c},0`);
    n.attrs.set('size_middle_middle', '0,0');
    return n;
  });
}

/** id окна в сборке (`hud_s2/radar_dialog.xml`) -> номер в WINDOWS или -1. */
function indexOf(id, set) {
  return WINDOWS.findIndex(([name, , , where]) =>
    id === (where === 'hud' ? `hud_${set}/` : 'game/') + name + '.xml');
}

/** Окно: шире и выше на GROW, рамка во всё окно — первым виджетом, под содержимым. */
function apply(root, i) {
  const f = root.getFrame();
  root.setFrame({ x: f.x, y: f.y, w: f.w + GROW.w, h: f.h + GROW.h });
  const img = new bxml.Node('Widget');
  img.attrs.set('frame', `0,0,${f.w + GROW.w},${f.h + GROW.h}`);
  img.attrs.set('name', 'bld_calib');
  img.attrs.set('type', 'image');
  const sk = new bxml.Node('Skin');
  sk.attrs.set('name', skinName(i));
  img.kids.push(sk);
  root.kids.unshift(img);
  if (!root.getFlags().includes('transparent')) root.addFlag('transparent');
}

/** Все id окон разметки для стиля. */
function ids(set) {
  return WINDOWS.map(([name, , , where]) => (where === 'hud' ? `hud_${set}/` : 'game/') + name + '.xml');
}

module.exports = { ATLAS, GROW, WINDOWS, atlas, skins, apply, ids, indexOf };
