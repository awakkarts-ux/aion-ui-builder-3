'use strict';
/**
 * Ранги и серые двойники иконок умений из одной картинки.
 *
 * Как устроены родные иконки (замерено 27.09.2026 на skills.pak AionEmpire):
 *   - холст 64×64, но сама картинка — 40×40 в левом верхнем углу (7395 из
 *     7474), остальное прозрачно: игра берёт только этот угол;
 *   - ранг k семейства `<имя>_g<k>` — та же картинка, что ранг 1, с
 *     повёрнутым тоном (как «Цветовой тон/Насыщенность» в Photoshop) и
 *     римской цифрой в левом нижнем углу. Поворот у каждого семейства свой:
 *     у одних ранги идут в зелень, у других в фиолет;
 *   - цифры рангов стоят в одном месте у всех иконок, цвет цифры задан
 *     рангом (II жёлтая, III зелёная, V красная…);
 *   - серый двойник `_gray` — светлота HSL, (max + min) / 2, как «Обесцветить»
 *     в Photoshop: ошибка 2 из 255 — шум сжатия.
 *
 * Поэтому новая картинка становится рангом 1, а ранг k получается поворотом
 * её тона на столько же, на сколько повёрнут родной ранг k семейства, плюс
 * цифра из родного ранга k. Поворот мерим по средним цветам картинки, а не
 * по пикселям: часть рангов дорисована позже со сдвигом на пиксель-другой.
 *
 * Все картинки здесь — RGBA одного размера с родной иконкой (обычно 64×64).
 */

/** Занятая (непрозрачная) область от левого верхнего угла. */
function contentOf(rgba, width) {
  const h = rgba.length / 4 / width;
  let mx = 0, my = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < width; x++) {
      if (rgba[(y * width + x) * 4 + 3] > 0) { if (x > mx) mx = x; if (y > my) my = y; }
    }
  }
  return { width, w: mx + 1, h: my + 1 };
}

/** Угол с цифрой ранга: левая нижняя четверть картинки. */
function numBox(c) {
  return { x0: 0, y0: Math.floor(c.h * 0.55), x1: Math.ceil(c.w * 0.5), y1: c.h };
}

function inBox(p, width, box) {
  const x = p % width;
  const y = (p / width) | 0;
  return x >= box.x0 && x < box.x1 && y >= box.y0 && y < box.y1;
}

function rgb2hsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn;
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  let h;
  if (mx === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (mx === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}

function hsl2rgb(h, s, l) {
  h = (((h % 360) + 360) % 360) / 360;
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t) => {
    t = ((t % 1) + 1) % 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
}

/** Средний тон (по кругу, с весом по хроме), насыщенность и светлота — без угла с цифрой. */
function colorStats(rgba, c) {
  const box = numBox(c);
  let sx = 0, sy = 0, ss = 0, sl = 0, n = 0;
  for (let i = 0, p = 0; i < rgba.length; i += 4, p++) {
    if (rgba[i + 3] < 128 || inBox(p, c.width, box)) continue;
    const [h, s, l] = rgb2hsl(rgba[i], rgba[i + 1], rgba[i + 2]);
    const w = s * (1 - Math.abs(2 * l - 1)); // хрома: серое тон не задаёт
    sx += Math.cos(h * Math.PI / 180) * w;
    sy += Math.sin(h * Math.PI / 180) * w;
    ss += s;
    sl += l;
    n++;
  }
  return {
    hue: Math.atan2(sy, sx) * 180 / Math.PI,
    chroma: Math.hypot(sx, sy) / (n || 1),
    s: ss / (n || 1),
    l: sl / (n || 1),
  };
}

/** Насыщенность/светлота «как в Photoshop»: +d тянет к 1, −d — к 0. */
const push = (v, d) => (d >= 0 ? v + (1 - v) * d : v * (1 + d));
const pushOf = (from, to) => (to >= from ? (to - from) / ((1 - from) || 1) : to / (from || 1) - 1);

/** Чем родной ранг k отличается по цвету от ранга 1. */
function shiftBetween(base, rank, c) {
  const a = colorStats(base, c);
  const b = colorStats(rank, c);
  let dh = b.hue - a.hue;
  dh = ((dh + 540) % 360) - 180;
  // у почти серой иконки тон не определён — не крутим
  if (a.chroma < 0.02 || b.chroma < 0.02) dh = 0;
  return { dh, ds: pushOf(a.s, b.s), dl: pushOf(a.l, b.l) };
}

function recolor(rgba, shift) {
  const out = Buffer.alloc(rgba.length);
  for (let i = 0; i < rgba.length; i += 4) {
    const [h, s, l] = rgb2hsl(rgba[i], rgba[i + 1], rgba[i + 2]);
    const [r, g, b] = hsl2rgb(h + shift.dh, Math.min(1, Math.max(0, push(s, shift.ds))),
      Math.min(1, Math.max(0, push(l, shift.dl))));
    out[i] = Math.round(r);
    out[i + 1] = Math.round(g);
    out[i + 2] = Math.round(b);
    out[i + 3] = rgba[i + 3];
  }
  return out;
}

/** Серый двойник: светлота HSL. */
function gray(rgba) {
  const out = Buffer.alloc(rgba.length);
  for (let i = 0; i < rgba.length; i += 4) {
    const v = Math.round((Math.max(rgba[i], rgba[i + 1], rgba[i + 2]) +
      Math.min(rgba[i], rgba[i + 1], rgba[i + 2])) / 2);
    out[i] = out[i + 1] = out[i + 2] = v;
    out[i + 3] = rgba[i + 3];
  }
  return out;
}

const diff = (a, b, i) => Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);

/** Средняя ошибка на канал вне угла с цифрой: сдвинута ли картинка ранга. */
function errOutside(a, b, c) {
  const box = numBox(c);
  let e = 0, n = 0;
  for (let i = 0, p = 0; i < a.length; i += 4, p++) {
    if (a[i + 3] === 0 || inBox(p, c.width, box)) continue;
    e += diff(a, b, i);
    n += 3;
  }
  return n ? e / n : 0;
}

/**
 * Маски цифр рангов: какие пиксели угла — цифра. Меряется на родных
 * семействах одного размера: ранг k против ранга 1, повёрнутого в цвет
 * ранга k; пиксель — цифра, если отличается у большинства семейств.
 * Семейства, где картинка ранга сдвинута, в голосование не берутся.
 * @param {Array<Map<number, Buffer>>} families ранг -> RGBA
 * @param {number} width ширина холста
 * @returns {Map<number, Uint8Array>} ранг -> маска (1 — цифра)
 */
function numeralMasks(families, width) {
  const votes = new Map();
  const seen = new Map();
  let c = null;
  for (const fam of families) {
    const base = fam.get(1);
    if (!base) continue;
    const fc = contentOf(base, width);
    if (!c) c = fc;
    if (fc.w !== c.w || fc.h !== c.h) continue; // другая раскладка — не голосует
    const box = numBox(c);
    for (const [k, img] of fam) {
      if (k === 1) continue;
      const fitted = recolor(base, shiftBetween(base, img, c));
      if (errOutside(img, fitted, c) > 12) continue;
      if (!votes.has(k)) { votes.set(k, new Uint16Array(img.length / 4)); seen.set(k, 0); }
      const v = votes.get(k);
      seen.set(k, seen.get(k) + 1);
      for (let i = 0, p = 0; i < img.length; i += 4, p++) {
        if (inBox(p, width, box) && diff(img, fitted, i) > 60) v[p]++;
      }
    }
  }
  const out = new Map();
  for (const [k, v] of votes) {
    const n = seen.get(k);
    if (n < 3) continue;
    const m = new Uint8Array(v.length);
    for (let p = 0; p < m.length; p++) m[p] = v[p] * 2 > n ? 1 : 0;
    out.set(k, m);
  }
  return out;
}

/** Кладёт цифру ранга из родной иконки поверх картинки. */
function stamp(rgba, from, mask) {
  const out = Buffer.from(rgba);
  if (!mask || !from || from.length !== out.length) return out;
  for (let p = 0; p < mask.length; p++) {
    if (mask[p]) from.copy(out, p * 4, p * 4, p * 4 + 4);
  }
  return out;
}

/**
 * Картинку пользователя — в холст родной иконки: вписать в её занятую
 * область, остальное прозрачно. Вход — RGBA уже нужного размера c.w×c.h.
 */
function place(rgba, c, height) {
  const out = Buffer.alloc(c.width * height * 4);
  for (let y = 0; y < c.h; y++) {
    Buffer.from(rgba.buffer, rgba.byteOffset + y * c.w * 4, c.w * 4)
      .copy(out, y * c.width * 4);
  }
  return out;
}

/**
 * Всё семейство из одной картинки.
 * @param {Buffer} base новая картинка в холсте родной иконки (place) — станет рангом 1
 * @param {Map<number, Buffer>} originals родные ранги семейства
 * @param {Map<number, Uint8Array>} masks numeralMasks
 * @param {number} width ширина холста
 * @returns {Map<number, {color: Buffer, gray: Buffer}>}
 */
function makeFamily(base, originals, masks, width) {
  const out = new Map();
  const first = Math.min(...originals.keys());
  const orig1 = originals.get(first);
  const c = contentOf(orig1, width);
  for (const [k, orig] of originals) {
    let color = k === first ? Buffer.from(base) : recolor(base, shiftBetween(orig1, orig, c));
    color = stamp(color, orig, masks.get(k));
    out.set(k, { color, gray: gray(color) });
  }
  return out;
}

/** Один ранг своей картинкой: без поворота тона, но с его цифрой. */
function makeRank(base, original, mask) {
  const color = stamp(Buffer.from(base), original, mask);
  return { color, gray: gray(color) };
}

module.exports = {
  contentOf, numBox, rgb2hsl, hsl2rgb, colorStats, shiftBetween, recolor, gray, errOutside,
  numeralMasks, stamp, place, makeFamily, makeRank,
};
