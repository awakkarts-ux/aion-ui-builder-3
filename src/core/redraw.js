'use strict';
/**
 * Перерисовка атласа в стиле темы (17.11.2026) — не перекраска, а новые детали.
 *
 * Описаний скинов (прямоугольников из version4.xml) тут не нужно: каждая
 * деталь в атласе — отдельное пятно непрозрачных пикселей. Находим пятна,
 * решаем, что это, и рисуем на том же месте и в тех же границах заново:
 *
 *   панель   — почти прямоугольное пятно (рамка, кнопка, ячейка, поле):
 *              плоская тёмная плашка, срез правого верхнего и левого нижнего
 *              угла, линия 1 px. Яркость исходника задаёт состояние: светлее
 *              (наведение, нажатие) — плашка теплее, линия ярче;
 *   силуэт   — сложная форма (рамки HUD, сферы, завитки): форма остаётся,
 *              объёмный хром заменяется плоской заливкой, контур и резкие
 *              перепады яркости — линиями;
 *   значок   — цветное, мелкое, полупрозрачное или светлая надпись: только палитра темы
 *              (theme.recolor), рисунок не трогаем.
 *
 * Границы деталей сохраняются до пикселя, поэтому прямоугольники скинов в
 * клиенте подходят как были. Срез угла — не больше 10 px: он попадает в угловой
 * кусок девятичастных рамок и при растяжении не искажается. Узкие полосы
 * (меньше 14 px по одной из сторон) срезов не получают: это могут быть
 * отдельные куски краёв рамки.
 */

const dds = require('./dds');
const theme = require('./theme');

const lum = (r, g, b) => (0.299 * r + 0.587 * g + 0.114 * b) / 255;
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const clamp = (v, a, z) => Math.max(a, Math.min(z, v));

/** Пятна непрозрачных пикселей (8 соседей): метки и сводка по каждому. */
function components(img) {
  const { width: W, height: H, rgba } = img;
  const lab = new Int32Array(W * H);
  const comps = [null];
  const stack = new Int32Array(W * H);
  for (let start = 0; start < W * H; start++) {
    if (lab[start] || rgba[start * 4 + 3] <= 8) continue;
    const id = comps.length;
    const c = { id, x0: W, y0: H, x1: -1, y1: -1, area: 0, chroma: 0, l: 0, a: 0 };
    let sp = 0;
    stack[sp++] = start;
    lab[start] = id;
    while (sp) {
      const p = stack[--sp];
      const x = p % W, y = (p - x) / W;
      const o = p * 4;
      const r = rgba[o], g = rgba[o + 1], b = rgba[o + 2];
      c.area++;
      c.chroma += Math.max(r, g, b) - Math.min(r, g, b);
      c.l += lum(r, g, b);
      c.a += rgba[o + 3];
      if (x < c.x0) c.x0 = x;
      if (x > c.x1) c.x1 = x;
      if (y < c.y0) c.y0 = y;
      if (y > c.y1) c.y1 = y;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= H) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= W || (!dx && !dy)) continue;
          const q = yy * W + xx;
          if (lab[q] || rgba[q * 4 + 3] <= 8) continue;
          lab[q] = id;
          stack[sp++] = q;
        }
      }
    }
    c.w = c.x1 - c.x0 + 1;
    c.h = c.y1 - c.y0 + 1;
    c.chroma /= c.area;
    c.l /= c.area;
    c.a /= c.area;
    c.fill = c.area / (c.w * c.h);
    comps.push(c);
  }
  return { lab, comps };
}

/** Что за пятно: 'icon' | 'panel' | 'shape'. */
function classify(c) {
  if (c.chroma > 42) return 'icon'; // цветное: значки, полосы HP/MP
  if (c.a < 170) return 'icon'; // полупрозрачные подсветки и тени: перерисовка закрыла бы текст под ними
  if (c.w * c.h < 120) return 'icon'; // крошки, точки
  if (c.w <= 18 && c.h <= 18 && c.l > 0.5) return 'icon'; // стрелки, плюсы, цифры
  if (c.h <= 16 && c.w <= 120 && c.l > 0.55) return 'icon'; // строки цифр и надписей
  if (c.fill > 0.86 && c.w >= 8 && c.h >= 8) return 'panel';
  return 'shape';
}

function put(rgba, i, rgb, a) {
  rgba[i] = Math.round(rgb[0]);
  rgba[i + 1] = Math.round(rgb[1]);
  rgba[i + 2] = Math.round(rgb[2]);
  rgba[i + 3] = Math.round(a);
}

/** Плашка со срезанными углами на месте пятна. */
function drawPanel(img, src, lab, c, pal) {
  const { width: W, rgba } = img;
  const w = c.w, h = c.h;
  const cutOk = w >= 14 && h >= 14;
  const cut = cutOk ? clamp(Math.round(Math.min(w, h) * 0.22), 3, 10) : 0;
  // состояние по яркости исходника: тёмная — обычная, светлее — наведение/нажатие
  const k = clamp((c.l - 0.16) / 0.5, 0, 1);
  const fill = mix(pal.fill, pal.fillHot, k * 0.75);
  const line = mix(pal.lineDim, pal.line, 0.35 + 0.65 * k);
  const alpha = clamp(c.a * 0.94, 0, 245);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = (c.y0 + y) * W + (c.x0 + x);
      if (lab[p] && lab[p] !== c.id) continue; // чужое пятно в рамке — не трогаем
      const i = p * 4;
      const tr = (w - 1 - x) + y; // до правого верхнего угла
      const bl = x + (h - 1 - y); // до левого нижнего
      if (cut && (tr < cut || bl < cut)) { rgba[i + 3] = 0; continue; }
      // узкие куски: линия только по длинным сторонам, чтобы стыки не рябили
      const edge = cutOk
        ? x === 0 || y === 0 || x === w - 1 || y === h - 1 || tr === cut || bl === cut
        : (w >= h ? y === 0 || y === h - 1 : x === 0 || x === w - 1);
      if (edge) put(rgba, i, line, 255);
      else {
        // лёгкий вертикальный градиент, как свет сверху на плашке
        const v = 1 + 0.18 * (1 - y / Math.max(1, h - 1)) - 0.09;
        put(rgba, i, [fill[0] * v, fill[1] * v, fill[2] * v], alpha);
      }
    }
  }
  // внутренняя насечка у среза — фирменная деталь, только у крупных плашек
  if (cut >= 6 && w >= 40 && h >= 24) {
    for (let t = 0; t < 4; t++) {
      const x = w - 1 - cut - 3 + t, y = 2;
      const p = (c.y0 + y) * W + (c.x0 + x);
      if (!lab[p] || lab[p] === c.id) put(rgba, p * 4, pal.line, 255);
    }
  }
  void src;
}

/** Силуэт: форма прежняя, заливка плоская, контур и резкие грани — линиями. */
function drawShape(img, src, lab, c, pal) {
  const { width: W, height: H, rgba } = img;
  const L = (x, y) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return 0;
    const o = (y * W + x) * 4;
    return src[o + 3] > 8 ? lum(src[o], src[o + 1], src[o + 2]) : 0;
  };
  const inside = (x, y) => x >= 0 && y >= 0 && x < W && y < H && lab[y * W + x] === c.id;
  for (let y = c.y0; y <= c.y1; y++) {
    for (let x = c.x0; x <= c.x1; x++) {
      const p = y * W + x;
      if (lab[p] !== c.id) continue;
      const i = p * 4;
      const a = src[i + 3];
      const rim = !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1);
      const l = L(x, y);
      // Собель по яркости: резкие перепады исходника — это грани деталей
      const gx = L(x + 1, y - 1) + 2 * L(x + 1, y) + L(x + 1, y + 1) - L(x - 1, y - 1) - 2 * L(x - 1, y) - L(x - 1, y + 1);
      const gy = L(x - 1, y + 1) + 2 * L(x, y + 1) + L(x + 1, y + 1) - L(x - 1, y - 1) - 2 * L(x, y - 1) - L(x + 1, y - 1);
      const g = Math.sqrt(gx * gx + gy * gy) / 4;
      if (rim && a > 60) put(rgba, i, pal.line, a);
      else if (l > 0.62) put(rgba, i, mix(pal.line, pal.hi, clamp((l - 0.62) / 0.3, 0, 1)), a);
      else if (g > 0.07 && l > 0.14) put(rgba, i, mix(pal.edge, pal.line, clamp((g - 0.07) / 0.3, 0, 1)), a);
      else put(rgba, i, mix(pal.fill, pal.fillHot, clamp((l - 0.2) / 0.5, 0, 1) * 0.5), Math.min(a, 235));
    }
  }
}

/**
 * Перерисовывает атлас.
 * @param {{width, height, rgba: Buffer}} img меняется на месте
 * @param {object} th тема (theme.THEMES.x) с полем redraw — палитра деталей
 * @returns {{panels: number, shapes: number, icons: number}}
 */
function redraw(img, th) {
  const pal = th.redraw;
  const src = Buffer.from(img.rgba);
  const { lab, comps } = components(img);
  const kinds = new Map();
  const stat = { panels: 0, shapes: 0, icons: 0 };
  for (let n = 1; n < comps.length; n++) {
    const c = comps[n];
    const kind = classify(c);
    kinds.set(n, kind);
    if (kind === 'panel') { drawPanel(img, src, lab, c, pal); stat.panels++; }
    else if (kind === 'shape') { drawShape(img, src, lab, c, pal); stat.shapes++; }
    else stat.icons++;
  }
  // значкам — палитра темы, по их же пикселям
  const one = Buffer.alloc(4);
  for (let p = 0; p < lab.length; p++) {
    if (!lab[p] || kinds.get(lab[p]) !== 'icon') continue;
    const i = p * 4;
    src.copy(one, 0, i, i + 4);
    theme.recolor(one, th);
    one.copy(img.rgba, i);
  }
  return stat;
}

/** DDS -> перерисованный DDS A8R8G8B8. */
function redrawDds(raw, th) {
  const img = dds.toRgba(raw);
  redraw(img, th);
  return dds.fromRgba(img.width, img.height, img.rgba);
}

module.exports = { redraw, redrawDds, components, classify };
