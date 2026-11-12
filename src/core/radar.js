'use strict';
/**
 * Квадратная мини-карта (как в Aion 2).
 *
 * Круглой карту делает не код, а скин `radar_mask` (библиотека
 * free_version.xml): картинка 128×128 `v3_radar_mask` с кругом в
 * прозрачности — по ней игра обрезает карту. Кольцо поверх — скины рамки
 * (`v4_hud_radar_wnd`, у официального — `v3_hud_radar_wnd` и подложка
 * `v3_hud_radar`). Замерено 27.09.2026.
 *
 * Поэтому: свой атлас `bld_radar` с квадратной маской, тонкой квадратной
 * рамкой и прозрачным куском, и те же скины по имени переводятся на него.
 * Атлас кладётся в свой пак BUILDER_PAK рядом с ui.pak.
 */

const dds = require('./dds');

/*
 * Маска — ОТДЕЛЬНОЙ текстурой: игра накладывает её на карту всей картинкой,
 * прямоугольник скина не смотрит. Первая версия держала маску в общем атласе
 * 512×256 — в игре карта вышла узкой полосой по форме всего атласа (27.09).
 */
const MASK_TEX = 'textures/ui/bld_radar_mask';
const ATLAS = 'textures/ui/bld_radar';
const W = 256;
const H = 256;
/** Куски атласа рамки. */
const MASK = { x: 0, y: 0, w: 128, h: 128 };
const FRAME = { x: 0, y: 0, w: 240, h: 240 };
const CLEAR = { x: 244, y: 0, w: 8, h: 8 };

/** Скин -> [текстура, кусок]. Недостающих в библиотеках просто нет — не страшно. */
const SKINS = {
  radar_mask: [MASK_TEX, MASK],
  v4_hud_radar_wnd: [ATLAS, FRAME],
  v5_hud_radar_wnd: [ATLAS, FRAME],
  v3_hud_radar_wnd: [ATLAS, FRAME],
  v3_hud_mini_radar_wnd: [ATLAS, FRAME],
  v3_hud_radar: [ATLAS, CLEAR], // круглая «тарелка» официального под картой
  // тёмный круг с кольцами поверх карты — у квадратной не нужен
  v4_hud_radar_sight: [ATLAS, CLEAR],
  v5_hud_radar_sight: [ATLAS, CLEAR],
};

/** Подложка официального (radar_bg) рисуется той же рамкой, но шире карты — её прячем. */
const HIDE_WIDGETS = ['radar_bg'];

/** Скругление углов в пикселях: у Aion 2 углы почти прямые. */
const RADIUS = 6;

function inRound(x, y, w, h, r) {
  const cx = x < r ? r : x >= w - r ? w - r - 1 : x;
  const cy = y < r ? r : y >= h - r ? h - r - 1 : y;
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

/** Маска: сплошной квадрат со скруглением, вся текстура — маска. */
function mask() {
  const n = MASK.w;
  const px = Buffer.alloc(n * n * 4);
  const r = Math.round(RADIUS * n / 177);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (!inRound(x, y, n, n, r)) continue;
      px.fill(255, (y * n + x) * 4, (y * n + x) * 4 + 4);
    }
  }
  return dds.fromRgba(n, n, px);
}

/** Атлас рамки: тёмная кайма с тонкой светлой линией внутри; прозрачный кусок — нули. */
function atlas() {
  const px = Buffer.alloc(W * H * 4);
  const put = (x, y, r, g, b, a) => { const i = (y * W + x) * 4; px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a; };
  // рамка 240×240, игра растягивает её на окно карты (177 px): толщины в долях
  const f = FRAME.w;
  const edge = 5;
  const rr = Math.round(RADIUS * f / 177);
  for (let y = 0; y < f; y++) {
    for (let x = 0; x < f; x++) {
      if (!inRound(x, y, f, f, rr)) continue;
      const d = Math.min(x, y, f - 1 - x, f - 1 - y);
      if (d < edge) put(FRAME.x + x, FRAME.y + y, 12, 15, 20, 235);
      else if (d < edge + 2) put(FRAME.x + x, FRAME.y + y, 170, 180, 195, 90);
    }
  }
  return dds.fromRgba(W, H, px);
}

/** Файлы пака: имя записи -> DDS. */
function files() {
  return new Map([
    [ATLAS.split('/').pop() + '.dds', atlas()],
    [MASK_TEX.split('/').pop() + '.dds', mask()],
  ]);
}

/** Правки скинов по имени: текстура и прямоугольник. */
function skinEdits() {
  const out = {};
  for (const [name, [texture, rect]] of Object.entries(SKINS)) out[name] = { texture, rect };
  return out;
}

module.exports = { ATLAS, MASK_TEX, SKINS, HIDE_WIDGETS, atlas, mask, files, skinEdits };
