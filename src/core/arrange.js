'use strict';
/**
 * Раскладка HUD в «Стиле Aion» (s1): то, что игра не даёт двигать, двигаем
 * размерами окон и сдвигом их содержимого.
 *
 * Правила сняты разметкой окон (calib.js) по скриншоту пользователя 27.09.2026,
 * экран 1920×1009, размер интерфейса в игре 0,95 (1 единица файла = 0,945 px):
 *   - нижние окна — одна группа, стоят встык в порядке [портрет и HP/MP]
 *     [панель умений][меню][карта] с зазором ~3 и центрируются на экране;
 *     каждое прижато к низу экрана и растёт вверх, содержимое — от левого
 *     верхнего угла окна;
 *   - полоса опыта: левый край = левый край группы + её x из файла (152),
 *     низ у края экрана;
 *   - координаты x/y самих окон игра не слушает.
 * Поэтому: окно карты во всю высоту экрана и шире на W — карта уходит вправо
 * вверх; окно HP/MP шире на те же W, а его содержимое сдвинуто на W вправо —
 * левый край группы уходит на W влево, панель умений и меню стоят где стояли.
 * Полосу опыта (она от левого края группы) сдвигаем обратно на W.
 */

/** 1 единица файла в px экрана — замерено разметкой (0,95 в настройках игры). */
const SCALE = 0.945;
const GAP = 3;
const MARGIN = 10;

const ID = {
  hp: 'hud_s1/basic_status_dialog.xml',
  qb: 'hud_s1/quickbar_dialog.xml',
  menu: 'hud_s1/start_dialog.xml',
  radar: 'hud_s1/radar_dialog.xml',
  exp: 'hud_s1/exp_bar_dialog.xml',
};

/** Рамка содержимого окна: крайние точки его виджетов верхнего уровня. */
function contentBox(root) {
  const fr = root.kids.filter((k) => k.name === 'Widget' && k.getFrame()).map((k) => k.getFrame());
  if (!fr.length) return { x0: 0, y0: 0, x1: 0, y1: 0 };
  return {
    x0: Math.min(...fr.map((f) => f.x)),
    y0: Math.min(...fr.map((f) => f.y)),
    x1: Math.max(...fr.map((f) => f.x + f.w)),
    y1: Math.max(...fr.map((f) => f.y + f.h)),
  };
}

/**
 * Правки окон.
 * @param {Object<string, bxml.Node>} roots окна по ключам ID (как их запишет сборка)
 * @param {{w: number, h: number}} screen экран в px (system.cfg)
 * @param {{mapTopRight?: boolean, hpOverBar?: boolean}} opts
 * @returns {Map<string, {addW?: number, shiftX?: number, shiftY?: number, setH?: number}>}
 */
function plan(roots, screen, opts) {
  const out = new Map();
  const need = ['hp', 'qb', 'menu', 'radar'];
  if (need.some((k) => !roots[k])) return out;
  const D = screen.w / SCALE;
  const Dh = screen.h / SCALE;
  const w = Object.fromEntries(need.map((k) => [k, roots[k].getFrame().w]));
  const total = w.hp + w.qb + w.menu + w.radar + 3 * GAP;
  const left = D / 2 - total / 2;
  const qbLeft = left + w.hp + GAP;
  const radarLeft = qbLeft + w.qb + GAP + w.menu + GAP;
  const add = (id, e) => out.set(id, Object.assign({}, out.get(id), e));

  let W = 0;
  if (opts.mapTopRight) {
    // правый край карты (виджет radar_wnd, иначе всё содержимое) — к краю экрана
    const map = roots.radar.kids.find((k) => k.attrs.get('name') === 'radar_wnd');
    const mf = map ? map.getFrame() : null;
    const cb = contentBox(roots.radar);
    const right = mf ? mf.x + mf.w : cb.x1;
    W = Math.max(0, Math.round(D - MARGIN - (radarLeft + right)));
    add(ID.radar, { addW: W, shiftX: W, shiftY: MARGIN - cb.y0, setH: Math.round(Dh) });
    add(ID.hp, { addW: W, shiftX: W });
    if (roots.exp) add(ID.exp, { addW: W, shiftX: W });
  }

  // Полосы HP/MP над панелью умений — НЕ ДЕЛАЕТСЯ: окно HP/MP стоит в группе
  // левее панели, а игра обрезает всё, что за границей окна (27.09 полосы и
  // портрет пропали целиком). Флаг hpOverBar из профилей игнорируется.
  return out;
}

/** Правка окна: ширина, высота, сдвиг всех виджетов верхнего уровня. */
function apply(root, e) {
  const f = root.getFrame();
  root.setFrame({ x: f.x, y: f.y, w: f.w + (e.addW || 0), h: e.setH || f.h });
  if (e.shiftX || e.shiftY) {
    for (const k of root.kids) {
      const kf = k.name === 'Widget' && k.getFrame();
      if (kf) k.setFrame({ x: kf.x + (e.shiftX || 0), y: kf.y + (e.shiftY || 0), w: kf.w, h: kf.h });
    }
  }
  // пустое место растянутого окна не должно ловить клики
  if (!root.getFlags().includes('transparent')) root.addFlag('transparent');
}

module.exports = { SCALE, ID, plan, apply, contentBox };
