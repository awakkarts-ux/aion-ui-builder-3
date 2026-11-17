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
const dds = require('./dds');

const ATLAS = 'textures/ui/bldnc_hud';
const ATLAS_W = 512;
const ATLAS_H = 512;
const GAUGE_TEST = true;

/** Окно цели: размеры в единицах файла. */
const T = { w: 400, h: 60, lvl: [16, 5, 26, 18], name: [68, 4, 264, 22], bar: [16, 31, 368, 9] };

/** Типы цели: группа контейнера -> цвет скобок, метка, подпись. */
const TYPES = {
  normal: { ac: [139, 144, 155], tag: '', sub: 'TARGET // NORMAL', y: 0 },
  elite: { ac: [243, 230, 0], tag: 'ЭЛИТА', sub: 'TARGET // ELITE', y: 64 },
  hero: { ac: [255, 138, 61], tag: 'ГЕРОЙ', sub: 'TARGET // HERO', y: 128 },
  legend: { ac: [197, 107, 255], tag: 'ЛЕГЕНДА', sub: 'TARGET // LEGEND', y: 192 },
};
const GAUGE = { x: 0, y: 256, w: 168, h: 11 };
const EMPTY = { x: 200, y: 256, w: 4, h: 4 };
const TICK = { x: 220, y: 256, w: 1, h: 9 };

const RED = [255, 84, 73];
const CYAN = [82, 242, 238];
const MUTED = [84, 89, 102];

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

/** Фон окна цели одного типа: подложка, скобки, дорожка полосы, рамка уровня, метка, подписи. */
function drawTarget(cv, oy, t) {
  const { w, h } = T;
  // мягкая подложка: прозрачная к верхнему и нижнему краю
  for (let y = 2; y < h - 2; y++) {
    const k = Math.min(1, (y - 2) / 14, (h - 3 - y) / 14);
    cv.hline(10, oy + y, w - 20, [12, 14, 19], Math.round(150 * k));
  }
  // скобки
  for (const [x, dir] of [[0, 1], [w - 1, -1]]) {
    cv.vline(x, oy + 2, h - 4, t.ac);
    for (let i = 0; i < 8; i++) { cv.dot(x + dir * i, oy + 2, t.ac); cv.dot(x + dir * i, oy + h - 3, t.ac); }
  }
  // дорожка полосы HP со скошенными концами
  const [bx, by, bw, bh] = T.bar;
  for (let r = 0; r < bh; r++) {
    const inset = Math.round(8 * (1 - r / (bh - 1)));
    cv.hline(bx + inset, oy + by + r, bw - inset * 2, RED, 34);
  }
  // квадрат уровня со срезом справа сверху
  const [lx, ly, lw, lh] = T.lvl;
  for (let y = 0; y < lh; y++) {
    for (let x = 0; x < lw; x++) {
      if (x - (lw - 5) > y) continue; // срез 5 px
      const edge = x === 0 || y === lh - 1 || x === lw - 1 || y === 0 || x - (lw - 5) === y;
      cv.dot(lx + x, oy + ly + y, edge ? CYAN : [6, 20, 22], edge ? 255 : 215);
    }
  }
  // метка типа справа сверху
  if (t.tag) {
    const tw = textWidth(t.tag) + 8;
    const tx = bx + bw - tw;
    const ty = 8;
    cv.hline(tx, oy + ty, tw, t.ac); cv.hline(tx, oy + ty + 13, tw, t.ac);
    cv.vline(tx, oy + ty, 14, t.ac); cv.vline(tx + tw - 1, oy + ty, 14, t.ac);
    cv.rect(tx + 1, oy + ty + 1, tw - 2, 12, [12, 14, 19], 170);
    cv.text(tx + 4, oy + ty + 3, t.tag, t.ac);
  }
  // подписи снизу
  cv.text(bx, oy + 46, t.sub, MUTED);
  const lock = '// LOCK';
  cv.text(bx + bw - textWidth(lock), oy + 46, lock, t.ac, 210);
}

/** Полоса HP: линейка 0–9 (тест) или красная заливка со скосом слева. */
function drawGauge(cv) {
  const { x, y, w, h } = GAUGE;
  if (GAUGE_TEST) {
    for (let d = 0; d < 10; d++) {
      const x0 = x + Math.round((w * d) / 10);
      const x1 = x + Math.round((w * (d + 1)) / 10);
      cv.rect(x0, y, x1 - x0, h, d % 2 ? [255, 210, 204] : [255, 122, 111]);
      cv.vline(x0, y, h, [0, 0, 0]);
      cv.text(x0 + Math.floor((x1 - x0 - 5) / 2), y + 2, String(d), [0, 0, 0]);
    }
    return;
  }
  for (let r = 0; r < h; r++) {
    const inset = Math.round(4 * (1 - r / (h - 1)));
    const k = r / (h - 1);
    const c = [255, Math.round(122 - 63 * k), Math.round(111 - 62 * k)];
    cv.hline(x + inset, y + r, w - inset, c);
  }
}

/** Атлас темы (DDS). */
function atlas() {
  const cv = new Canvas(ATLAS_W, ATLAS_H);
  for (const t of Object.values(TYPES)) drawTarget(cv, t.y, t);
  drawGauge(cv);
  cv.rect(TICK.x, TICK.y, TICK.w, TICK.h, [6, 7, 10], 230);
  // EMPTY — полностью прозрачный, ничего не рисуем
  return dds.fromRgba(ATLAS_W, ATLAS_H, cv.px);
}

const node = (name, attrs, kids = []) => {
  const n = new bxml.Node(name);
  for (const [k, v] of Object.entries(attrs)) n.attrs.set(k, String(v));
  n.kids.push(...kids);
  return n;
};
const rect = (r) => `${r.x},${r.y},${r.w},${r.h}`;

/** Скины и пресеты темы — в библиотеку version4.xml. */
function library() {
  const out = [];
  for (const [g, t] of Object.entries(TYPES)) {
    out.push(node('Skin', { name: `bldnc_tgt_bg_${g}`, texture: ATLAS, src_image: rect({ x: 0, y: t.y, w: T.w, h: T.h }) }));
  }
  out.push(node('Skin', { name: 'bldnc_tgt_gauge', texture: ATLAS, src_image: rect(GAUGE) }));
  out.push(node('Skin', { name: 'bldnc_empty', texture: ATLAS, src_image: rect(EMPTY) }));
  out.push(node('Skin', { name: 'bldnc_tgt_tick', texture: ATLAS, src_image: rect(TICK) }));
  out.push(node('Preset', { name: 'bldnc_hp_gauge_target', type: 'gauge' }, [
    node('SkinRef', { main_state: 0, name: 'bldnc_tgt_gauge', sub_state: 'gauge' }),
    node('SkinRef', { main_state: 1, name: 'bldnc_tgt_gauge', sub_state: 'gauge' }),
  ]));
  out.push(node('Preset', { name: 'bldnc_gauge_empty', type: 'gauge' }, [
    node('SkinRef', { main_state: 0, name: 'bldnc_empty', sub_state: 'gauge' }),
    node('SkinRef', { main_state: 1, name: 'bldnc_empty', sub_state: 'gauge' }),
  ]));
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

/**
 * Окно цели в раскладке темы. Работает и с окном своего клиента, и с
 * перенесённым официальным: детали ищутся по имени внутри контейнеров
 * normal/elite/hero/legend; остальные контейнеры (питомцы) не трогаются.
 * @returns {number} сколько контейнеров переделано
 */
function applyTarget(root) {
  const dlg = [...root.walk()].find((n) => n.name === 'Dialog');
  if (!dlg) return 0;
  let n = 0;
  for (const c of dlg.kids) {
    const g = c.attrs.get('group');
    if (c.name !== 'Widget' || !TYPES[g]) continue;
    const cf = c.getFrame() || { x: 0, y: 0 };
    c.setFrame({ x: cf.x, y: cf.y, w: T.w, h: T.h });
    const dots = [];
    for (const w of c.kids) {
      if (w.name !== 'Widget') continue;
      const nm = w.attrs.get('name') || '';
      if (nm === 'bg') { w.setFrame({ x: 0, y: 0, w: T.w, h: T.h }); setSkin(w, `bldnc_tgt_bg_${g}`); }
      else if (nm === 'level') {
        w.setFrame(fr(T.lvl));
        w.attrs.set('text_color', '0.32,0.95,0.93,1.0');
        w.attrs.set('halign', 'center'); w.attrs.set('valign', 'middle');
      } else if (nm === 'name') {
        w.setFrame(fr(T.name));
        w.attrs.set('text_color', '0.93,0.9,0.86,1.0');
        w.attrs.set('halign', 'center'); w.attrs.set('valign', 'middle');
      } else if (nm === 'hp_gauge') { w.setFrame(fr(T.bar)); w.attrs.set('preset', 'bldnc_hp_gauge_target'); }
      else if (nm === 'hp_gauge_bg') { w.setFrame(fr(T.bar)); w.attrs.set('preset', 'bldnc_gauge_empty'); }
      else if (nm === 'timer') w.setFrame({ x: 140, y: 44, w: 120, h: 12 });
      else if (/^(emblem|execution_mark|boost_marker)$/.test(nm)) {
        // значки, которые показывает код, — справа за скобкой, чтобы не закрывать полосу
        const f = w.getFrame() || { w: 24, h: 24 };
        const s = Math.min(f.w, f.h, 36);
        w.setFrame({ x: T.w + 4, y: Math.round((T.h - s) / 2), w: s, h: s });
      } else if (!nm && /target_dot/i.test(skinOf(w))) dots.push(w);
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
    const f = dlg.getFrame();
    // окно цели стоит по центру (h_pos_align=center) — x игра не берёт, ширина своя
    if (f) dlg.setFrame({ x: f.x, y: f.y, w: T.w, h: Math.max(f.h, T.h) });
  }
  return n;
}

module.exports = { ATLAS, GAUGE_TEST, atlas, library, applyTarget, TYPES };
