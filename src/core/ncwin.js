'use strict';
/**
 * Окна темы Night City (17.11.2026) — своя раскладка окон HUD, а не
 * перекраска чужих. Так же, как переносятся окна официального Classic
 * (hudport.js): детали окна сохраняют имена — код игры находит их по имени, —
 * а место, размер и скины задаём свои. Скины дописываются в version4.xml,
 * картинки рисуются здесь и кладутся в пак программы (zz_builder.pak).
 *
 * Пока сделано окно цели (target_dialog.xml), обычный/элита/герой/легенда:
 *   скобки по бокам, уровень в квадрате слева, имя по центру сверху,
 *   длинная полоса HP во всю ширину, метка типа справа, подпись снизу.
 * Превью, одобренное пользователем: claude.ai/artifact/DqXD7MW8TkixuVb6q2RUJf
 *
 * ТЕСТ: полоса HP цели нарисована линейкой 0–9 (GAUGE_TEST). По скриншоту
 * при неполном HP видно, обрезает игра картинку полосы или сжимает её.
 */

const bxml = require('./bxml');
const fs = require('fs');
const path = require('path');
const dds = require('./dds');

const ATLAS = 'textures/ui/bldnc_hud';
const ATLAS_W = 1024;
const ATLAS_H = 1024;
/** Тест 0.1.14 показал: игра СЖИМАЕТ картинку полосы под долю HP (не обрезает). */
const GAUGE_TEST = false;

/**
 * Окно цели v2 (превью claude.ai/artifact/8eux1DUJxGFMo54hkbYgzg): 400×38.
 * «Цель цели» игра ставит ~42 единицы ниже верха окна цели — в 60 она
 * налезала на полосу, в 38 встаёт под ней.
 */
const T = { w: 400, h: 38, lvl: [14, 2, 24, 26], name: [46, 1, 280, 20], bar: [46, 22, 338, 10], tag: [340, 4, 44, 13] };

/** Типы цели: группа контейнера -> цвет метки, метка, место в атласе. */
const TYPES = {
  normal: { ac: [139, 144, 155], tag: '', y: 0 },
  elite: { ac: [243, 230, 0], tag: 'ЭЛИТА', y: 40 },
  hero: { ac: [255, 138, 61], tag: 'ГЕРОЙ', y: 80 },
  legend: { ac: [197, 107, 255], tag: 'ЛЕГЕНДА', y: 120 },
};
// места в атласе (x, y, w, h)
const A = {
  tgtGauge: { x: 0, y: 168, w: 338, h: 10 },
  empty: { x: 1000, y: 0, w: 4, h: 4 },
  tick: { x: 1010, y: 0, w: 1, h: 16 },
  dist: { x: 420, y: 0, w: 96, h: 34 },
  tot: { x: 420, y: 40, w: 220, h: 51 },
  st: { x: 0, y: 200, w: 384, h: 102 },
  hp: { x: 0, y: 310, w: 250, h: 13 },
  mp: { x: 0, y: 326, w: 250, h: 13 },
  mpGap: { x: 0, y: 342, w: 250, h: 13 },
  dp: { x: 0, y: 358, w: 250, h: 4 },
  slot: { x: 400, y: 200, w: 40, h: 40 },
  slotOver: { x: 444, y: 200, w: 40, h: 40 },
  arrow: { x: 490, y: 200, w: 20, h: 80 },
  btn: { x: 520, y: 200, w: 22, h: 22 }, // 6 в ряд: unlock up/over/down, lock up/over/down
  pgUp: { x: 520, y: 230, w: 14, h: 10 },
  pgDn: { x: 520, y: 245, w: 14, h: 10 },
  radar: { x: 700, y: 200, w: 242, h: 246 },
  exp: { x: 0, y: 460, w: 978, h: 6 },
  member: { x: 0, y: 480, w: 210, h: 62 },
  pHp: { x: 220, y: 480, w: 120, h: 9 },
  pMp: { x: 220, y: 492, w: 120, h: 9 },
  pGap: { x: 220, y: 504, w: 120, h: 9 },
  totHp: { x: 220, y: 516, w: 186, h: 6 },
  sel: { x: 350, y: 480, w: 213, h: 66 },
  cls: { x: 0, y: 560, w: 64, h: 64 }, // 8 значков классов, бледные — со сдвигом 512
};
const EMPTY = A.empty;
const TICK = A.tick;
const GAUGE = A.tgtGauge;

/** Свой персонаж: HP / MP / DP (единицы окна 384×102). */
const ST = { lvl: [3, 38, 22, 24], port: [25, 10, 84, 84], hp: [116, 28, 250, 13], mp: [116, 45, 250, 13], dp: [116, 74, 250, 4] };
/** Карточка участника группы 210×62. */
const PM = { lvl: [6, 19, 20, 22], name: [84, 8, 120, 16], hp: [84, 27, 120, 9], mp: [84, 40, 120, 9] };
/** «Цель цели» 220×51. */
const TT = { lvl: [4, 3, 18, 20], name: [28, 1, 186, 16], hp: [28, 18, 186, 6] };
/** Сегменты MP: ширина и зазор. */
const SEG = { st: [7, 2], party: [5, 2] };

const RED = [255, 84, 73];
const CYAN = [82, 242, 238];
const YEL = [243, 230, 0];
const MUTED = [84, 89, 102];
const PLATE = [12, 14, 19];
const HPC = [232, 240, 64];
const MPC = [79, 109, 255];
const DPC = [255, 138, 61];
const GREEN = [127, 224, 95];
const GAPC = [10, 12, 16];

/* ---------------- пиксельный шрифт 5×7 (только нужные буквы) ---------------- */
const G = {
  ' ': ['.....', '.....', '.....', '.....', '.....', '.....', '.....'],
  '/': ['....#', '....#', '...#.', '..#..', '.#...', '#....', '#....'],
  0: ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
  1: ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  2: ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  3: ['####.', '....#', '....#', '.###.', '....#', '....#', '####.'],
  4: ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  5: ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  6: ['..##.', '.#...', '#....', '####.', '#...#', '#...#', '.###.'],
  7: ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
  8: ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  9: ['.###.', '#...#', '#...#', '.####', '....#', '...#.', '.##..'],
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  C: ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'],
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  G: ['.###.', '#...#', '#....', '#.###', '#...#', '#...#', '.###.'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  I: ['.###.', '..#..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
  N: ['#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  А: null, Е: null, О: null, Р: null, Т: null, Н: null, // как латинские
  Э: ['.###.', '#...#', '....#', '..###', '....#', '#...#', '.###.'],
  Л: ['..###', '.#..#', '.#..#', '.#..#', '.#..#', '.#..#', '##..#'],
  И: ['#...#', '#...#', '#..##', '#.#.#', '##..#', '#...#', '#...#'],
  Г: ['#####', '#....', '#....', '#....', '#....', '#....', '#....'],
  Й: ['.#.#.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '#...#'],
  Д: ['.###.', '.#.#.', '.#.#.', '.#.#.', '.#.#.', '#####', '#...#'],
};
for (const [cy, lat] of [['А', 'A'], ['Е', 'E'], ['О', 'O'], ['Р', 'P'], ['Т', 'T'], ['Н', 'H']]) G[cy] = G[lat];
G['Р'] = ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'];

/* ---------------- холст RGBA ---------------- */
class Canvas {
  constructor(w, h) { this.w = w; this.h = h; this.px = Buffer.alloc(w * h * 4); }
  /** Наложение цвета с непрозрачностью a (0..255) поверх того, что есть. */
  dot(x, y, [r, g, b], a = 255) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h || a <= 0) return;
    const i = (y * this.w + x) * 4;
    const p = this.px;
    const da = p[i + 3] / 255;
    const sa = Math.min(1, a / 255);
    const oa = sa + da * (1 - sa);
    if (oa <= 0) return;
    p[i] = Math.round((r * sa + p[i] * da * (1 - sa)) / oa);
    p[i + 1] = Math.round((g * sa + p[i + 1] * da * (1 - sa)) / oa);
    p[i + 2] = Math.round((b * sa + p[i + 2] * da * (1 - sa)) / oa);
    p[i + 3] = Math.round(oa * 255);
  }
  rect(x, y, w, h, c, a) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.dot(x + i, y + j, c, a); }
  hline(x, y, w, c, a) { this.rect(x, y, w, 1, c, a); }
  vline(x, y, h, c, a) { this.rect(x, y, 1, h, c, a); }
  text(x, y, s, c, a = 255) {
    let cx = x;
    for (const ch of s) {
      const g = G[ch] || G[' '];
      for (let j = 0; j < 7; j++) for (let i = 0; i < 5; i++) if (g[j][i] === '#') this.dot(cx + i, y + j, c, a);
      cx += 6;
    }
    return cx - x - 1;
  }
}
const textWidth = (s) => [...s].length * 6 - 1;

/**
 * Значки классов темы (нарисованы пользователем, 17.11.2026): 64×64 RGBA,
 * бирюзовые линии на прозрачном. Порядок — как классы в именах скинов игры.
 */
const CLASSES = ['ranger', 'assassin', 'priest', 'chanter', 'elementalist', 'knight', 'fighter', 'wizard'];
let classIcons = null;
function loadClassIcons() {
  if (classIcons) return classIcons;
  try {
    const j = JSON.parse(fs.readFileSync(path.join(__dirname, 'ncclass.json'), 'utf8'));
    classIcons = { size: j.size, icons: Object.fromEntries(Object.entries(j.icons).map(([k, v]) => [k, Buffer.from(v, 'base64')])) };
  } catch (e) { classIcons = { size: 0, icons: {} }; }
  return classIcons;
}
const clsCell = (i, dimmed) => ({ x: A.cls.x + i * 64 + (dimmed ? 512 : 0), y: A.cls.y, w: 64, h: 64 });

function drawClasses(cv) {
  const { size, icons } = loadClassIcons();
  CLASSES.forEach((c, i) => {
    const px = icons[c];
    if (!px || size !== 64) return;
    for (const dimmed of [false, true]) {
      const r = clsCell(i, dimmed);
      for (let j = 0; j < 64; j++) {
        for (let k = 0; k < 64; k++) {
          const o = (j * 64 + k) * 4;
          const a = dimmed ? Math.round(px[o + 3] * 0.45) : px[o + 3];
          if (a) cv.dot(r.x + k, r.y + j, [px[o], px[o + 1], px[o + 2]], a);
        }
      }
    }
  });
}

/**
 * Перекраска деталей в любой библиотеке по имени скина: кольцо мини-карты
 * (скины пресета v3_hud_radar) и значки классов (v4_class_*, v5_class_*,
 * v5_class_*_dimmed — какой набор игра берёт в каком окне, решает её код).
 * @returns {number} скинов переписано
 */
function restyle(root) {
  const to = new Map();
  if (loadClassIcons().size === 64) {
    CLASSES.forEach((c, i) => {
      to.set(`v4_class_${c}`, clsCell(i, false));
      to.set(`v5_class_${c}`, clsCell(i, false));
      to.set(`v5_class_${c}_dimmed`, clsCell(i, true));
    });
  }
  const pre = [...root.walk()].find((k) => k.name === 'Preset' && k.attrs.get('name') === 'v3_hud_radar');
  if (pre) for (const r of pre.kids) if (r.attrs.get('name')) to.set(r.attrs.get('name'), A.radar);
  let n = 0;
  for (const k of root.walk()) {
    const r = k.name === 'Skin' && to.get(k.attrs.get('name'));
    if (!r) continue;
    for (const a of [...k.attrs.keys()]) if (/^(src_|size_)/.test(a) || a === 'type') k.attrs.delete(a);
    k.attrs.set('texture', ATLAS);
    k.attrs.set('src_image', `${r.x},${r.y},${r.w},${r.h}`);
    n++;
  }
  return n;
}

/* ---------------- рисование ---------------- */

/** Щиток уровня: прямоугольник с острием вниз, контур 1 px (сплошной и на скосах). */
function shield(cv, x, y, w, h, line = CYAN) {
  const b = Math.round(h * 0.7); // где начинается острие
  const mid = (w - 1) / 2;
  // граница по строкам: левый и правый край
  const edge = (j) => {
    if (j < b) return [0, w - 1];
    const k = (j - b) / Math.max(1, h - 1 - b);
    return [Math.round(k * mid), Math.round(w - 1 - k * mid)];
  };
  for (let j = 0; j < h; j++) {
    const [l, r] = edge(j);
    for (let i = l + 1; i < r; i++) cv.dot(x + i, y + j, line, 30);
    // контур: края строки плюс перемычка до краёв соседней строки — без разрывов на скосе
    const [pl, pr] = j > 0 ? edge(j - 1) : [l, r];
    for (let i = Math.min(l, pl); i <= Math.max(l, pl); i++) cv.dot(x + i, y + j, line);
    for (let i = Math.min(r, pr); i <= Math.max(r, pr); i++) cv.dot(x + i, y + j, line);
  }
  cv.hline(x, y, w, line);
  if (h - 1 >= b) cv.dot(x + Math.round(mid), y + h - 1, line);
}

/** Полоса: ровная заливка цветом c (без окантовки и градиента). */
function flat(cv, r, c) { cv.rect(r.x, r.y, r.w, r.h, c); }

/** Пустая часть полосы — тусклая. */
function dim(cv, x, y, w, h, c, a = 51) { cv.rect(x, y, w, h, c, a); }

/** Сегменты: dim — тусклая дорожка; gap — тёмные зазоры поверх заливки. */
function segs(cv, x, y, w, h, [seg, gap], mode) {
  const step = seg + gap;
  for (let s0 = 0; s0 < w; s0 += step) {
    if (mode === 'dim') cv.rect(x + s0, y, Math.min(seg, w - s0), h, MPC, 56);
    else if (s0 + seg < w) cv.rect(x + s0 + seg, y, Math.min(gap, w - s0 - seg), h, GAPC, 150); // мягко: зазоры видны и на пустой части
  }
}

/** Окно цели: щиток, метка типа, тусклая дорожка полосы. Без подложки. */
function drawTarget(cv, oy, t) {
  shield(cv, T.lvl[0], oy + T.lvl[1], T.lvl[2], T.lvl[3]);
  const [bx, by, bw, bh] = T.bar;
  dim(cv, bx, oy + by, bw, bh, RED);
  if (t.tag) {
    const [tx, ty, tw, th] = T.tag;
    cv.hline(tx, oy + ty, tw, t.ac); cv.hline(tx, oy + ty + th - 1, tw, t.ac);
    cv.vline(tx, oy + ty, th, t.ac); cv.vline(tx + tw - 1, oy + ty, th, t.ac);
    cv.text(tx + Math.round((tw - textWidth(t.tag)) / 2), oy + ty + 3, t.tag, t.ac);
  }
}

/** «Высота / Дистанция»: только бирюзовая черта слева. */
function drawDist(cv) {
  cv.vline(A.dist.x, A.dist.y + 2, 26, CYAN, 180);
}

/** «Цель цели»: щиток и тусклая дорожка. */
function drawTot(cv) {
  const { x, y } = A.tot;
  shield(cv, x + TT.lvl[0], y + TT.lvl[1], TT.lvl[2], TT.lvl[3]);
  dim(cv, x + TT.hp[0], y + TT.hp[1], TT.hp[2], TT.hp[3], RED);
}

/** Окно игрока: уголки портрета, щиток, тусклые дорожки, подписи. Без подложки. */
function drawStatus(cv) {
  const { x, y } = A.st;
  const [px, py, pw, ph] = ST.port;
  for (const [cx, cy, dx, dy] of [[px, py, 1, 1], [px + pw - 1, py, -1, 1], [px, py + ph - 1, 1, -1], [px + pw - 1, py + ph - 1, -1, -1]]) {
    for (let i = 0; i < 8; i++) { cv.dot(x + cx + dx * i, y + cy, CYAN); cv.dot(x + cx, y + cy + dy * i, CYAN); }
  }
  shield(cv, x + ST.lvl[0], y + ST.lvl[1], ST.lvl[2], ST.lvl[3]);
  dim(cv, x + ST.hp[0], y + ST.hp[1], ST.hp[2], ST.hp[3], HPC);
  segs(cv, x + ST.mp[0], y + ST.mp[1], ST.mp[2], ST.mp[3], SEG.st, 'dim');
  dim(cv, x + ST.dp[0], y + ST.dp[1], ST.dp[2], ST.dp[3], DPC);
  cv.text(x + ST.dp[0], y + ST.dp[1] + 7, 'DP', DPC);
}

/** Карточка участника: щиток, тусклые дорожки. Без подложки. */
function drawMember(cv) {
  const { x, y } = A.member;
  shield(cv, x + PM.lvl[0], y + PM.lvl[1], PM.lvl[2], PM.lvl[3]);
  dim(cv, x + PM.hp[0], y + PM.hp[1], PM.hp[2], PM.hp[3], HPC);
  segs(cv, x + PM.mp[0], y + PM.mp[1], PM.mp[2], PM.mp[3], SEG.party, 'dim');
}

function drawSlot(cv, a, line, la) {
  cv.rect(a.x + 1, a.y + 1, a.w - 2, a.h - 2, [10, 12, 16], 110);
  cv.hline(a.x, a.y, a.w, line, la); cv.hline(a.x, a.y + a.h - 1, a.w, line, la);
  cv.vline(a.x, a.y, a.h, line, la); cv.vline(a.x + a.w - 1, a.y, a.h, line, la);
}

/** Кнопка 22×22 с замком (открытым или закрытым). */
function drawLock(cv, bx, by, line, locked) {
  cv.rect(bx + 6, by + 10, 10, 7, line);
  cv.rect(bx + 8, by + 12, 6, 3, GAPC);
  const dx = locked ? 0 : 4;
  cv.vline(bx + 7 + dx, by + 5, 5, line); cv.vline(bx + 14 + dx, by + (locked ? 5 : 3), locked ? 5 : 2, line);
  cv.hline(bx + 7 + dx, by + 4, 8, line);
}

/** Стрелка 14×10 вверх/вниз. */
function drawArrow(cv, ax, ay, up, c) {
  for (let r = 0; r < 5; r++) {
    const yy = up ? ay + 2 + r : ay + 7 - r;
    cv.hline(ax + 6 - r, yy, 2 + r * 2, c);
  }
}

/** Кольцо мини-карты: тонкий красный круг, риски, «N». */
function drawRadar(cv) {
  const { x, y, w, h } = A.radar;
  const cx = x + 121.5;
  const cy = y + 120.5;
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const d = Math.hypot(x + i - cx, y + j - cy);
      if (Math.abs(d - 98.5) < 0.75) cv.dot(x + i, y + j, RED, 235);
    }
  }
  for (const [ddx, ddy] of [[1, 0], [-1, 0], [0, 1]]) {
    cv.rect(Math.round(cx + ddx * 98.5) - 2, Math.round(cy + ddy * 98.5) - 2, 4, 4, RED);
  }
  cv.text(Math.round(cx) - 2, Math.round(cy - 98.5) - 12, 'N', YEL);
}

/** Атлас темы (DDS). */
function atlas() {
  const cv = new Canvas(ATLAS_W, ATLAS_H);
  for (const t of Object.values(TYPES)) drawTarget(cv, t.y, t);
  flat(cv, GAUGE, RED);
  cv.rect(TICK.x, TICK.y, TICK.w, TICK.h, GAPC, 230);
  drawDist(cv);
  drawTot(cv);
  flat(cv, A.totHp, RED);
  drawStatus(cv);
  flat(cv, A.hp, HPC);
  flat(cv, A.mp, MPC);
  segs(cv, A.mpGap.x, A.mpGap.y, A.mpGap.w, A.mpGap.h, SEG.st, 'gap');
  flat(cv, A.dp, DPC);
  drawMember(cv);
  flat(cv, A.pHp, HPC);
  flat(cv, A.pMp, MPC);
  segs(cv, A.pGap.x, A.pGap.y, A.pGap.w, A.pGap.h, SEG.party, 'gap');
  cv.rect(A.sel.x, A.sel.y + 8, 2, 46, CYAN);
  drawSlot(cv, A.slot, RED, 110);
  drawSlot(cv, A.slotOver, CYAN, 255);
  cv.vline(A.arrow.x + 10, A.arrow.y + 4, A.arrow.h - 8, CYAN, 70);
  const states = [RED, [255, 150, 140], [255, 255, 255]];
  states.forEach((c, i) => {
    drawLock(cv, A.btn.x + i * 24, A.btn.y, c, false);
    drawLock(cv, A.btn.x + (i + 3) * 24, A.btn.y, c, true);
    const cc = [CYAN, [180, 255, 252], [255, 255, 255]][i];
    drawArrow(cv, A.pgUp.x + i * 16, A.pgUp.y, true, cc);
    drawArrow(cv, A.pgDn.x + i * 16, A.pgDn.y, false, cc);
  });
  drawRadar(cv);
  flat(cv, A.exp, CYAN);
  drawClasses(cv);
  return dds.fromRgba(ATLAS_W, ATLAS_H, cv.px);
}

const node = (name, attrs, kids = []) => {
  const n = new bxml.Node(name);
  for (const [k, v] of Object.entries(attrs)) n.attrs.set(k, String(v));
  n.kids.push(...kids);
  return n;
};
const rect = (r) => `${r.x},${r.y},${r.w},${r.h}`;
const at = (r, i, step) => ({ x: r.x + i * step, y: r.y, w: r.w, h: r.h });
const skin = (name, r) => node('Skin', { name, texture: ATLAS, src_image: rect(r) });
const gaugePreset = (name, skins) => node('Preset', { name, type: 'gauge' },
  skins.map((sk, i) => node('SkinRef', { main_state: i, name: sk, sub_state: 'gauge' })));
const buttonPreset = (name, states) => node('Preset', { name, type: 'button' },
  states.flatMap((names, ms) => ['up', 'over', 'down'].map((sub, i) =>
    node('SkinRef', { main_state: ms, name: names[i], sub_state: sub }))));

/**
 * Скины и пресеты темы — в библиотеку version4.xml.
 * @param {bxml.Node} [root] библиотека: состояния «отравление» и «испытание
 *   смертью» берутся у официального (их цвет задаёт игра); рамка мини-карты
 *   официального (пресет v3_hud_radar) переводится на кольцо темы.
 */
function library(root) {
  const has = (n) => !!(root && [...root.walk()].some((k) => k.name === 'Skin' && k.attrs.get('name') === n));
  const or = (n, fb) => (has(n) ? n : fb);
  const out = [];
  for (const [g, t] of Object.entries(TYPES)) out.push(skin(`bldnc_tgt_bg_${g}`, { x: 0, y: t.y, w: T.w, h: T.h }));
  out.push(skin('bldnc_tgt_gauge', GAUGE), skin('bldnc_empty', EMPTY), skin('bldnc_tgt_tick', TICK), skin('bldnc_dist_bg', A.dist));
  out.push(gaugePreset('bldnc_hp_gauge_target', ['bldnc_tgt_gauge', or('v3_gauge_abnormal', 'bldnc_tgt_gauge'), or('v5_gauge_deathtrial', 'bldnc_tgt_gauge')]));
  out.push(gaugePreset('bldnc_gauge_empty', ['bldnc_empty', 'bldnc_empty', 'bldnc_empty']));
  // цель цели
  out.push(skin('bldnc_tot_bg', A.tot), skin('bldnc_tot_hp', A.totHp));
  out.push(gaugePreset('bldnc_tot_gauge', ['bldnc_tot_hp', or('v3_gauge_s_abnormal_target_monster', 'bldnc_tot_hp'), or('v5_gauge_s_deathtrial_target_monster', 'bldnc_tot_hp')]));
  // свой персонаж
  out.push(skin('bldnc_st_bg', A.st), skin('bldnc_hp', A.hp), skin('bldnc_mp', A.mp), skin('bldnc_mp_gap', A.mpGap), skin('bldnc_dp', A.dp));
  out.push(node('Preset', { name: 'bldnc_st_frame', type: 'window' }, [node('SkinRef', { name: 'bldnc_st_bg', state: 'frame' })]));
  out.push(gaugePreset('bldnc_hp_gauge', ['bldnc_hp', or('v3_gauge_abnormal', 'bldnc_hp'), or('v5_gauge_deathtrial', 'bldnc_hp')]));
  out.push(gaugePreset('bldnc_mp_gauge', ['bldnc_mp', 'bldnc_mp']));
  out.push(gaugePreset('bldnc_dp_gauge', ['bldnc_dp', 'bldnc_dp']));
  // группа
  out.push(skin('bldnc_member_bg', A.member), skin('bldnc_party_hp', A.pHp), skin('bldnc_party_mp', A.pMp), skin('bldnc_party_gap', A.pGap), skin('bldnc_party_sel', A.sel));
  out.push(gaugePreset('bldnc_party_hp_gauge', ['bldnc_party_hp', or('v3_party_gauge_abnormal', 'bldnc_party_hp'), or('v5_party_gauge_death', 'bldnc_party_hp')]));
  out.push(gaugePreset('bldnc_party_mp_gauge', ['bldnc_party_mp', 'bldnc_party_mp']));
  // панель умений
  out.push(skin('bldnc_slot_bg', A.slot), skin('bldnc_slot_over', A.slotOver), skin('bldnc_arrow_bg', A.arrow));
  out.push(node('Preset', { name: 'bldnc_slot', type: 'itemview' }, [
    node('SkinRef', { name: 'bldnc_slot_bg', state: 'slot' }),
    node('SkinRef', { name: 'bldnc_slot_over', state: 'slot_mouseover' }),
  ]));
  const lk = ['up', 'over', 'down'];
  lk.forEach((st, i) => {
    out.push(skin(`bldnc_unlock_${st}`, at(A.btn, i, 24)), skin(`bldnc_lock_${st}`, at(A.btn, i + 3, 24)));
    out.push(skin(`bldnc_pgup_${st}`, at(A.pgUp, i, 16)), skin(`bldnc_pgdn_${st}`, at(A.pgDn, i, 16)));
  });
  out.push(buttonPreset('bldnc_lock', [lk.map((s) => `bldnc_unlock_${s}`), lk.map((s) => `bldnc_lock_${s}`)]));
  out.push(buttonPreset('bldnc_pageup', [lk.map((s) => `bldnc_pgup_${s}`)]));
  out.push(buttonPreset('bldnc_pagedown', [lk.map((s) => `bldnc_pgdn_${s}`)]));
  // полоса опыта, кольцо карты
  out.push(skin('bldnc_exp', A.exp), gaugePreset('bldnc_exp_gauge', ['bldnc_exp', 'bldnc_exp']));
  out.push(skin('bldnc_radar', A.radar));
  return out;
}

const setSkin = (w, name) => {
  let sk = w.kids.find((k) => k.name === 'Skin');
  if (!sk) { sk = node('Skin', {}); w.kids.unshift(sk); }
  sk.attrs.clear();
  sk.attrs.set('name', name);
};
const skinOf = (w) => { const sk = w.kids.find((k) => k.name === 'Skin'); return sk ? sk.attrs.get('name') || '' : ''; };
const fr = ([x, y, w, h]) => ({ x, y, w, h });
const dialogOf = (root) => [...root.walk()].find((n) => n.name === 'Dialog');
const widgets = (n) => n.kids.filter((k) => k.name === 'Widget');
const byName = (n, name) => widgets(n).find((k) => k.attrs.get('name') === name);
const image = (frame, skinName) => node('Widget', { frame: frame.join(','), type: 'image', flag: 'transparent' }, [node('Skin', { name: skinName })]);
/** Вставить картинку сразу после виджета (поверх него, под следующими). */
const insertAfter = (parent, w, img) => { parent.kids.splice(parent.kids.indexOf(w) + 1, 0, img); };
const cyanText = (w) => { w.attrs.set('text_color', '0.32,0.95,0.93,1.0'); w.attrs.set('halign', 'center'); w.attrs.set('valign', 'middle'); };
const nameText = (w, left) => {
  w.attrs.set('text_color', '0.93,0.9,0.86,1.0');
  w.attrs.set('halign', left ? 'left' : 'center'); w.attrs.set('valign', 'middle');
  w.attrs.set('text_shade', 'True'); w.attrs.set('shade_color', '0.0,0.0,0.0,1.0'); w.attrs.set('shade_offset', '1,1');
};

/**
 * Окно цели: детали ищутся по имени внутри контейнеров normal/elite/hero/
 * legend; питомцы не трогаются. @returns {number} контейнеров переделано
 */
function applyTarget(root) {
  const dlg = dialogOf(root);
  if (!dlg) return 0;
  let n = 0;
  for (const c of dlg.kids) {
    const g = c.attrs.get('group');
    if (c.name !== 'Widget' || !TYPES[g]) continue;
    const cf = c.getFrame() || { x: 0, y: 0 };
    c.setFrame({ x: cf.x, y: cf.y, w: T.w, h: T.h });
    const dots = [];
    for (const w of widgets(c)) {
      const nm = w.attrs.get('name') || '';
      if (nm === 'bg') { w.setFrame({ x: 0, y: 0, w: T.w, h: T.h }); setSkin(w, `bldnc_tgt_bg_${g}`); }
      else if (nm === 'level') { w.setFrame({ x: T.lvl[0], y: T.lvl[1], w: T.lvl[2], h: T.lvl[3] - 6 }); cyanText(w); }
      else if (nm === 'name') {
        const [x, y, ww, h] = T.name;
        w.setFrame({ x, y, w: TYPES[g].tag ? ww : ww + 58, h });
        nameText(w, true);
      } else if (nm === 'hp_gauge') { w.setFrame(fr(T.bar)); w.attrs.set('preset', 'bldnc_hp_gauge_target'); }
      else if (nm === 'hp_gauge_bg') { w.setFrame(fr(T.bar)); w.attrs.set('preset', 'bldnc_gauge_empty'); }
      else if (nm === 'timer') w.setFrame({ x: 150, y: 34, w: 120, h: 12 });
      else if (/^(emblem|execution_mark|boost_marker)$/.test(nm)) {
        const f = w.getFrame() || { w: 24, h: 24 };
        const sz = Math.min(f.w, f.h, 32);
        w.setFrame({ x: T.w + 4, y: Math.round((T.h - sz) / 2), w: sz, h: sz });
      } else if (!nm && /target_dot|bldnc_tgt_tick/i.test(skinOf(w))) dots.push(w);
    }
    dots.sort((a, b) => (a.getFrame() || { x: 0 }).x - (b.getFrame() || { x: 0 }).x);
    const marks = [0.25, 0.5, 0.75];
    dots.forEach((w, i) => {
      const p = marks[i];
      if (p === undefined) { w.addFlag('not_visible'); return; }
      w.setFrame({ x: T.bar[0] + Math.round(T.bar[2] * p), y: T.bar[1], w: 1, h: T.bar[3] });
      setSkin(w, 'bldnc_tgt_tick');
    });
    n++;
  }
  if (n) {
    // «Высота / Дистанция»: место держит код (справа от цели), вид — наш
    const dist = byName(dlg, 'dist_info');
    if (dist) {
      const f = dist.getFrame() || { x: T.w + 4, y: 2 };
      dist.setFrame({ x: f.x, y: f.y, w: A.dist.w, h: A.dist.h });
      setSkin(dist, 'bldnc_dist_bg');
      for (const w of widgets(dist)) {
        const nm = w.attrs.get('name') || '';
        const tx = w.attrs.get('text') || '';
        if (/HEIGHT/.test(tx)) w.setFrame({ x: 6, y: 2, w: 54, h: 14 });
        else if (/DIST/.test(tx)) w.setFrame({ x: 6, y: 16, w: 54, h: 14 });
        else if (nm === 'target_height') w.setFrame({ x: 62, y: 4, w: 12, h: 11 });
        else if (nm === 'target_dist') { w.setFrame({ x: 56, y: 16, w: 36, h: 14 }); w.attrs.set('text_color', '0.32,0.95,0.93,1.0'); }
      }
    }
    const f = dlg.getFrame();
    // окно цели стоит по центру (h_pos_align=center) — x игра не берёт, ширина своя
    if (f) dlg.setFrame({ x: f.x, y: f.y, w: T.w, h: Math.max(f.h, T.h) });
  }
  return n;
}

/** «Цель цели» 220×51: щиток, имя слева, тонкая полоса. */
function applyAssist(root) {
  const dlg = dialogOf(root);
  if (!dlg) return 0;
  let n = 0;
  for (const c of widgets(dlg)) {
    if (!byName(c, 'hp_gauge')) continue;
    for (const w of widgets(c)) {
      const nm = w.attrs.get('name') || '';
      if (nm === 'bg') { w.attrs.delete('preset'); setSkin(w, 'bldnc_tot_bg'); w.setFrame({ x: 0, y: 0, w: A.tot.w, h: A.tot.h }); }
      else if (nm === 'level') { w.setFrame({ x: TT.lvl[0], y: TT.lvl[1], w: TT.lvl[2], h: TT.lvl[3] - 5 }); cyanText(w); }
      else if (nm === 'name') { w.setFrame(fr(TT.name)); nameText(w, true); }
      else if (nm === 'hp_gauge') { w.setFrame(fr(TT.hp)); w.attrs.set('preset', 'bldnc_tot_gauge'); }
      else if (nm === 'hp_gauge_bg') { w.setFrame(fr(TT.hp)); w.attrs.set('preset', 'bldnc_gauge_empty'); }
    }
    n++;
  }
  return n;
}

/** Свой персонаж (окно официального Classic 384×102): без подложки, HP жёлтая, MP сегментами. */
function applyStatus(root) {
  const dlg = dialogOf(root);
  if (!dlg || !byName(dlg, 'hp_gauge')) return 0;
  dlg.attrs.set('preset', 'bldnc_st_frame');
  const set = (nm, frame, preset) => {
    const w = byName(dlg, nm);
    if (!w) return null;
    if (frame) w.setFrame(fr(frame));
    if (preset) w.attrs.set('preset', preset);
    return w;
  };
  set('portrait', ST.port);
  const lv = set('level', [ST.lvl[0], ST.lvl[1], ST.lvl[2], ST.lvl[3] - 6]);
  if (lv) cyanText(lv);
  set('hp_gauge_bg', ST.hp, 'bldnc_gauge_empty');
  set('hp_gauge', ST.hp, 'bldnc_hp_gauge');
  set('mp_gauge_bg', ST.mp, 'bldnc_gauge_empty');
  const mp = set('mp_gauge', ST.mp, 'bldnc_mp_gauge');
  // зазоры сегментов — неподвижной картинкой поверх заливки: сегменты гаснут по одному
  if (mp) insertAfter(dlg, mp, image(ST.mp, 'bldnc_mp_gap'));
  for (const nm of ['dp_gauge_1', 'dp_gauge_2', 'dp_gauge_3']) set(nm, ST.dp, 'bldnc_dp_gauge');
  set('dp_gauge_text', [140, 78, 170, 14]);
  set('dp_level', [ST.dp[0] + 14, 79, 28, 14]);
  set('boost_marker', [350, 60, 30, 30]);
  return 1;
}

/** Группа: карточки участников без подложки, щиток, HP жёлтая, MP сегментами. */
function applyParty(root) {
  const dlg = dialogOf(root);
  if (!dlg) return 0;
  let n = 0;
  for (const c of widgets(dlg)) {
    if (!/^ctn_member/.test(c.attrs.get('name') || '') || !byName(c, 'hp')) continue;
    setSkin(c, 'bldnc_member_bg');
    for (const w of widgets(c)) {
      const nm = w.attrs.get('name') || '';
      if (nm === 'level') { w.setFrame({ x: PM.lvl[0], y: PM.lvl[1], w: PM.lvl[2], h: PM.lvl[3] - 5 }); cyanText(w); }
      else if (nm === 'title') { w.setFrame(fr(PM.name)); nameText(w, true); }
      else if (nm === 'hp_bg' || nm === 'mp_bg') { w.setFrame(fr(nm === 'hp_bg' ? PM.hp : PM.mp)); w.attrs.set('preset', 'bldnc_gauge_empty'); }
      else if (nm === 'hp') { w.setFrame(fr(PM.hp)); w.attrs.set('preset', 'bldnc_party_hp_gauge'); }
      else if (nm === 'mp') { w.setFrame(fr(PM.mp)); w.attrs.set('preset', 'bldnc_party_mp_gauge'); }
    }
    const mp = byName(c, 'mp');
    if (mp) insertAfter(c, mp, image(PM.mp, 'bldnc_party_gap'));
    n++;
  }
  const sel = byName(dlg, 'select');
  if (sel) { sel.attrs.delete('preset'); setSkin(sel, 'bldnc_party_sel'); }
  return n;
}

/** Панель умений и ряды над ней: ячейки, колонка стрелок, замок. */
function applyQuickbar(root) {
  const dlg = dialogOf(root);
  if (!dlg) return 0;
  let n = 0;
  for (const w of dlg.walk()) {
    const p = w.attrs.get('preset') || '';
    if (/quickbar_slot$/i.test(p)) { w.attrs.set('preset', 'bldnc_slot'); n++; }
    else if (/_shortcut_lock$/i.test(p)) { w.attrs.set('preset', 'bldnc_lock'); n++; }
    else if (/_shortcut_pageup$/i.test(p)) { w.attrs.set('preset', 'bldnc_pageup'); n++; }
    else if (/_shortcut_pagedown$/i.test(p)) { w.attrs.set('preset', 'bldnc_pagedown'); n++; }
  }
  const arrow = byName(dlg, 'arrow_bg');
  if (arrow) {
    const f = arrow.getFrame();
    arrow.attrs.delete('preset');
    if (f) arrow.setFrame({ x: f.x - 2, y: f.y, w: 20, h: f.h });
    setSkin(arrow, 'bldnc_arrow_bg');
  }
  return n ? 1 : 0;
}

/** Полоса опыта: бирюзовая заливка. */
function applyExp(root) {
  const dlg = dialogOf(root);
  const g = dlg && byName(dlg, 'exp_gauge');
  if (!g) return 0;
  g.attrs.set('preset', 'bldnc_exp_gauge');
  return 1;
}

/**
 * Окна, которые тема строит сама: id окна сборки -> функция раскладки.
 * `classic: true` — только поверх перенесённого окна официального Classic:
 * раскладка рассчитана на его размеры (своё окно устроено иначе).
 *
 * Правила места (для всех окон темы): игра ставит окно по привязке
 * h/v_pos_align (в «Стиле Aion» нижние — встык по центру, по сумме ширин),
 * внутри окна детали стоят по своим координатам и находятся кодом по имени.
 * Поэтому размеры нижних окон не меняем, двигаем и перерисовываем содержимое.
 */
const WINDOWS = {
  'game/target_dialog.xml': { fn: applyTarget },
  'game/target_assist_dialog.xml': { fn: applyAssist, classic: true },
  'game/party_dialog.xml': { fn: applyParty, classic: true },
};
for (const set of ['hud_s1', 'hud_s2']) {
  WINDOWS[`${set}/basic_status_dialog.xml`] = { fn: applyStatus, classic: true };
  WINDOWS[`${set}/quickbar_dialog.xml`] = { fn: applyQuickbar, classic: true };
  // полоса опыта: в «Стиле Aion» остаётся своя (официальная уезжает), имя полосы то же
  WINDOWS[`${set}/exp_bar_dialog.xml`] = { fn: applyExp };
}
for (const id of ['game/quickbar_dialog_ctrl.xml', 'game/quickbar_dialog_alt.xml', 'game/quickbar_dialog_extra.xml', 'game/quickbar_dialog_sep.xml']) {
  WINDOWS[id] = { fn: applyQuickbar, classic: true };
}

/** Раскладка темы для окна id. @returns {boolean} окно изменено */
function apply(id, root) {
  const w = WINDOWS[id];
  return w ? w.fn(root) > 0 : false;
}

module.exports = { ATLAS, GAUGE_TEST, WINDOWS, CLASSES, apply, atlas, library, restyle, applyTarget, TYPES };
