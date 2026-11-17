'use strict';
/**
 * Темы — перекраска атласов интерфейса целиком (17.11.2026).
 *
 * Тема не трогает ни скины, ни окна: берёт штатные атласы `v4_*` из клиента,
 * перекрашивает каждый пиксель и кладёт результат в тот же пак через набор
 * «Картинки интерфейса» (uiatlas). Форма деталей остаётся прежней, меняются
 * только цвета. Это первый, тестовый шаг редизайна; детали другой формы —
 * следующий (см. HANDOFF, «Мой дизайн» как третий донор).
 *
 * Перекраска:
 *   — «хром» (серо-синие рамки, плашки, кнопки — малая насыщенность) идёт по
 *     рампе яркости темы: тени почти в чёрный, светлые фаски — в цвет сигнала;
 *   — насыщенные пиксели (полосы HP/MP, значки) сохраняют яркость и
 *     насыщенность, но их оттенок переводится по таблице темы
 *     (синий -> бирюза, золото -> жёлтый);
 *   — прозрачность не меняется.
 *
 * Атласы, где уже лежат свои картинки пользователя (profile.packs.uiatlas),
 * тема не трогает: ручная правка сильнее.
 */

const dds = require('./dds');

/**
 * Какие атласы перекрашивать: все детали интерфейса Classic (`v4_*`), кроме
 * экранов лобби и локализованных надписей — там рисованные фоны и логотипы.
 */
const ATLAS_RE = /^v4_(?!lobby|l10n)\w+\.dds$/i;

const THEMES = {
  nightcity: {
    id: 'nightcity',
    title: 'Night City',
    hint: 'Тестовый вариант: плоские плашки со срезанными углами, красные линии, бирюза и жёлтый — в ключе Cyberpunk 2077',
    // рампа хрома по яркости 0..1 -> RGB
    ramp: [
      [0.00, [5, 6, 9]],
      [0.22, [12, 13, 18]],
      [0.42, [34, 18, 22]],
      [0.58, [128, 36, 32]],
      [0.74, [255, 84, 73]],
      [0.90, [255, 170, 160]],
      [1.00, [255, 236, 230]],
    ],
    // насыщенным пикселям: [от, до) оттенка в градусах -> новый оттенок (null — оставить)
    hues: [
      [0, 20, 4], // красное — в красный сигнал
      [20, 75, 56], // оранжевое и золото — в жёлтый
      [75, 165, null], // зелёное как есть
      [165, 265, 178], // синее и голубое — в бирюзу
      [265, 335, null], // фиолетовое как есть
      [335, 361, 4],
    ],
    keep: 70, // разброс каналов (max - min), выше которого пиксель «цветной»
    // варианты палитры деталей: profile.themeVariant, по умолчанию — variant
    variant: 'mix',
    variants: {
      red: { title: 'Красный', redraw: {} },
      cyan: {
        title: 'Бирюза',
        redraw: { line: [82, 242, 238], lineDim: [24, 98, 102], edge: [16, 46, 50], fillHot: [10, 46, 50], hi: [214, 255, 252] },
      },
      mix: {
        title: 'Смешанный',
        // рамки красные, светлые состояния бирюзовые, грани внутри HUD бирюзовые
        redraw: { lineHot: [82, 242, 238], inner: [60, 190, 186], fillHot: [10, 42, 46] },
      },
    },
    font: 'fira-cond', // готовый шрифт темы (core/fonts.js), если свой не включён
    // палитра перерисовки деталей (core/redraw.js); нет поля — тема только перекрашивает
    redraw: {
      fill: [9, 10, 14], // плашка в обычном состоянии
      fillHot: [62, 16, 18], // плашка светлых состояний (наведение, нажатие)
      line: [255, 84, 73], // линия 1 px
      lineDim: [118, 34, 32], // линия тёмных состояний и мелких граней
      edge: [58, 22, 24], // слабые грани внутри сложных рамок
      hi: [255, 214, 205], // блики
      neutral: [236, 230, 220], // лёгкий тёплый оттенок белого у цифр и надписей
    },
  },
};

function lerp(a, b, t) { return a + (b - a) * t; }

function rampAt(ramp, t) {
  if (t <= ramp[0][0]) return ramp[0][1];
  for (let i = 1; i < ramp.length; i++) {
    const [t1, c1] = ramp[i];
    if (t <= t1) {
      const [t0, c0] = ramp[i - 1];
      const k = (t - t0) / (t1 - t0);
      return [lerp(c0[0], c1[0], k), lerp(c0[1], c1[1], k), lerp(c0[2], c1[2], k)];
    }
  }
  return ramp[ramp.length - 1][1];
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn;
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  let h;
  if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0));
  else if (mx === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}

function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360 / 360;
  if (!s) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
}

/** Перекрашивает пиксели RGBA на месте. */
function recolor(rgba, theme) {
  // таблица на 256 уровней яркости: рампа считается один раз на тему
  if (!theme._lut) {
    theme._lut = new Array(256);
    for (let i = 0; i < 256; i++) theme._lut[i] = rampAt(theme.ramp, i / 255);
  }
  const lut = theme._lut;
  for (let i = 0; i < rgba.length; i += 4) {
    if (!rgba[i + 3]) continue;
    const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    let out;
    if (mx - mn <= theme.keep) {
      const y = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
      out = lut[y];
    } else {
      const [h, s, l] = rgbToHsl(r, g, b);
      const rule = theme.hues.find(([a, z]) => h >= a && h < z);
      out = rule && rule[2] !== null ? hslToRgb(rule[2], s, l) : [r, g, b];
    }
    rgba[i] = Math.round(out[0]);
    rgba[i + 1] = Math.round(out[1]);
    rgba[i + 2] = Math.round(out[2]);
  }
  return rgba;
}

/** DDS -> DDS темы: перерисовка деталей, если у темы есть палитра redraw, иначе перекраска. */
function makeDds(raw, theme) {
  return theme.redraw ? require('./redraw').redrawDds(raw, theme) : recolorDds(raw, theme);
}

/** DDS -> перекрашенный DDS A8R8G8B8 того же размера. */
function recolorDds(raw, theme) {
  const img = dds.toRgba(raw);
  recolor(img.rgba, theme);
  return dds.fromRgba(img.width, img.height, img.rgba);
}

/** Тема профиля или null. `profile.theme` — id темы. */
function resolve(profile) {
  const id = profile && profile.theme;
  const base = (id && THEMES[id]) || null;
  if (!base || !base.variants) return base;
  const vid = base.variants[profile.themeVariant] ? profile.themeVariant : base.variant;
  const key = base.id + ':' + vid;
  if (!variantCache.has(key)) {
    const v = base.variants[vid];
    // id с вариантом — у кэша атласов и таблицы рампы свой ключ на каждый вариант
    variantCache.set(key, Object.assign({}, base, { id: key, variantId: vid, _lut: null,
      redraw: Object.assign({}, base.redraw, v.redraw) }));
  }
  return variantCache.get(key);
}
const variantCache = new Map();

/**
 * Перекрашенные атласы для сборки: ключ описи uiatlas -> DDS.
 * @param {import('./client').Client} client
 * @param {string} lang
 * @param {object} theme
 * @param {Set<string>} skip ключи, где у пользователя своя картинка
 */
const cache = new Map(); // тема|ключ|размер -> готовый DDS: предпросмотр собирает часто

function stage(client, lang, theme, skip) {
  const keys = [...client.packIndex('uiatlas', lang).values()]
    .filter((r) => ATLAS_RE.test(r.short) && !(skip && skip.has(r.key)))
    .map((r) => r.key);
  const raw = client.packRead('uiatlas', lang, keys);
  const out = new Map();
  const failed = [];
  for (const [key, data] of raw) {
    const ck = theme.id + '|' + key + '|' + data.length;
    try {
      if (!cache.has(ck)) cache.set(ck, makeDds(data, theme));
      out.set(key, cache.get(ck));
    } catch (e) { failed.push(key.split('|').pop()); }
  }
  return { atlases: out, failed };
}

/** Для окна: список тем без рамп. */
function list() {
  return Object.values(THEMES).map((t) => ({ id: t.id, title: t.title, hint: t.hint, variant: t.variant,
    variants: Object.entries(t.variants || {}).map(([id, v]) => ({ id, title: v.title })) }));
}

module.exports = { THEMES, ATLAS_RE, recolor, recolorDds, makeDds, resolve, stage, list };
