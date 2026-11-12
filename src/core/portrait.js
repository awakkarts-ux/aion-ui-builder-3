'use strict';
/**
 * Крупный 3D-портрет персонажа.
 *
 * Он собран из двух мест:
 *   1. виджет `portrait` (type="3dview") в basic_status_dialog — это окно,
 *      в которое рисуется модель: frame="0,15,128,128" в штатном виде;
 *   2. UI_ModelCam.xml в ui.pak — положение камеры для каждой модели:
 *      pos="сдвиг, дистанция, высота". Модели lm/lf — элийцы (м/ж),
 *      dm/df — асмодиане; расе камера общая, полу — нет.
 *
 * Растянуть одно окно мало: модель останется прежнего размера в углу, поэтому
 * вместе с окном отодвигаем камеру. Пресеты ниже — согласованные пары.
 */

const bxml = require('./bxml');

const DIALOG_ENTRY = 'basic_status_dialog.xml';
const WIDGET = 'portrait';
const CAM_ENTRY = 'UI_ModelCam.xml';
const MALE = ['lm.cgf', 'dm.cgf'];
const FEMALE = ['lf.cgf', 'df.cgf'];

const STOCK = { x: 0, y: 15, size: 128, maleDist: 1.38, maleHeight: 0.71,
                femaleDist: 1.3, femaleHeight: 0.55 };

/**
 * Готовые размеры. x/y подобраны так, чтобы окно росло влево и вверх от
 * штатного места и не наезжало на полосы здоровья справа.
 */
const PRESETS = [
  { id: 1, title: '01 — штатный', size: 128, x: 0, y: 15, dist: 1.38, height: 0.71 },
  { id: 2, title: '02 — чуть крупнее', size: 160, x: -16, y: -1, dist: 1.8, height: 0.66 },
  { id: 3, title: '03 — средний', size: 190, x: -31, y: -16, dist: 2.2, height: 0.62 },
  { id: 4, title: '04 — заметный', size: 220, x: -46, y: -37, dist: 2.6, height: 0.56 },
  { id: 5, title: '05 — крупный', size: 250, x: -61, y: -66, dist: 3.1, height: 0.48 },
  { id: 6, title: '06 — очень крупный', size: 280, x: -75, y: -105, dist: 3.6, height: 0.4 },
  { id: 7, title: '07 — во весь рост', size: 320, x: -95, y: -150, dist: 4.2, height: 0.3 },
];

function defaults() {
  return Object.assign({ enabled: false, preset: 1 }, STOCK);
}

/** Из пресета — полный набор чисел, женская камера чуть ближе, как в оригинале. */
function fromPreset(id) {
  const p = PRESETS.find((x) => x.id === id) || PRESETS[0];
  return {
    preset: p.id,
    x: p.x,
    y: p.y,
    size: p.size,
    maleDist: p.dist,
    maleHeight: p.height,
    femaleDist: Math.round(p.dist * 0.94 * 100) / 100,
    femaleHeight: Math.round(p.height * 0.78 * 100) / 100,
  };
}

/** Правка виджета портрета — в том же виде, что и обычные правки раскладки. */
function widgetEdit(p) {
  return { widgets: { [WIDGET]: { frame: { x: p.x, y: p.y, w: p.size, h: p.size } } } };
}

/**
 * Переписывает камеру в UI_ModelCam.xml.
 * @returns {Buffer|null} новый файл или null, если менять нечего
 */
function patchCamera(data, p) {
  const { root, strings } = bxml.parse(data);
  const map = root.kids.find((k) => k.attrs.get('type') === 'portrait');
  if (!map) return null;
  let touched = false;
  for (const model of map.kids) {
    const name = model.attrs.get('name');
    const male = MALE.includes(name);
    if (!male && !FEMALE.includes(name)) continue;
    const parts = String(model.attrs.get('pos') || '').split(',').map((s) => s.trim());
    if (parts.length !== 3) continue;
    const next = [parts[0], male ? p.maleDist : p.femaleDist, male ? p.maleHeight : p.femaleHeight]
      .join(',');
    if (next !== model.attrs.get('pos')) {
      model.attrs.set('pos', next);
      touched = true;
    }
  }
  return touched ? bxml.serialize(root, strings) : null;
}

module.exports = { PRESETS, STOCK, defaults, fromPreset, widgetEdit, patchCamera,
                   DIALOG_ENTRY, CAM_ENTRY, WIDGET };
