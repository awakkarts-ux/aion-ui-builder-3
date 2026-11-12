'use strict';
/**
 * Скины интерфейса — библиотеки из `data/ui/preload/preload.pak`.
 *
 * Каждая видимая деталь интерфейса (кнопка, рамка, ячейка, полоса) описана
 * записью `Skin`: имя, атлас в `texture` и прямоугольник в нём. Простые скины
 * задают один прямоугольник в `src_image`, растягиваемые — девять кусков
 * (`src_left_top`, `src_middle_middle` и так далее), чтобы рамка тянулась без
 * искажения углов.
 *
 * Клиент подгружает библиотеки по списку из `UI_Preload.xml`. Их две полных:
 * `version4.xml` (1068 скинов, атласы `v4_*`) — её и использует Classic, и
 * `version5.xml` (2665 скинов, атласы `v5_*`) — интерфейс Aion 5.x. Просто
 * переключить одну на другую нельзя: имена скинов почти не пересекаются
 * (общих 36), а диалоги Classic просят именно `v4_*`. Зато можно перенаправить
 * любой скин v4 на кусок любого атласа, в том числе `v5_*` — картинки-то в
 * клиенте лежат.
 */

const bxml = require('./bxml');

/** Поля, в которых лежат прямоугольники: обычный и девять кусков. */
const RECT_FIELDS = [
  'src_image',
  'src_left_top', 'src_middle_top', 'src_right_top',
  'src_left_middle', 'src_middle_middle', 'src_right_middle',
  'src_left_bottom', 'src_middle_bottom', 'src_right_bottom',
];

function parseRect(s) {
  if (!s) return null;
  const p = String(s).split(',').map((x) => parseInt(x, 10));
  if (p.length !== 4 || p.some(Number.isNaN)) return null;
  return { x: p[0], y: p[1], w: p[2], h: p[3] };
}

const rectToString = (r) => [r.x, r.y, r.w, r.h].join(',');

/** Имя атласа приводим к виду `v4_common` — в файлах регистр гуляет. */
function atlasKey(texture) {
  return String(texture || '').toLowerCase().replace(/^.*\//, '');
}

/**
 * Опись скинов одной библиотеки.
 * @param {Buffer} data содержимое versionN.xml
 * @param {string} lib имя файла, оно же ключ библиотеки
 */
function list(data, lib) {
  const root = bxml.parse(data).root;
  const out = [];
  for (const category of root.kids) {
    const cat = category.attrs.get('name') || '';
    for (const node of category.walk()) {
      if (node.name !== 'Skin') continue;
      const name = node.attrs.get('name');
      if (!name) continue;
      const rects = {};
      for (const f of RECT_FIELDS) {
        const r = parseRect(node.attrs.get(f));
        if (r) rects[f] = r;
      }
      if (!Object.keys(rects).length) continue;
      out.push({
        key: lib + '|' + cat + '|' + name,
        lib,
        category: cat,
        name,
        type: node.attrs.get('type') || 'single',
        texture: node.attrs.get('texture') || '',
        atlas: atlasKey(node.attrs.get('texture')),
        rects,
        nine: Object.keys(rects).length > 1,
      });
    }
  }
  return out;
}

/**
 * Применяет правки к дереву библиотеки.
 * @param {bxml.Node} root
 * @param {Object<string, {texture?: string, rects?: object}>} edits ключ -> правка
 * @returns {number} сколько скинов поменяли
 */
function applyEdits(root, edits, lib) {
  let touched = 0;
  for (const category of root.kids) {
    const cat = category.attrs.get('name') || '';
    for (const node of category.walk()) {
      if (node.name !== 'Skin') continue;
      const name = node.attrs.get('name');
      if (!name) continue;
      const edit = edits[lib + '|' + cat + '|' + name];
      if (!edit) continue;
      let changed = false;
      if (edit.texture && edit.texture !== node.attrs.get('texture')) {
        node.attrs.set('texture', edit.texture);
        changed = true;
      }
      for (const [field, rect] of Object.entries(edit.rects || {})) {
        if (!RECT_FIELDS.includes(field)) continue;
        const next = rectToString(rect);
        if (node.attrs.get(field) !== next) {
          node.attrs.set(field, next);
          changed = true;
        }
      }
      if (changed) touched++;
    }
  }
  return touched;
}

/**
 * Скин по имени — на свою картинку одним куском (мини-карта и т. п.):
 * старое описание внешности снимается целиком, у рамок из девяти кусков тоже.
 * @param {Object<string, {texture: string, rect: {x,y,w,h}}>} edits имя -> правка
 * @returns {number} сколько скинов поменяли
 */
function applyByName(root, edits) {
  let touched = 0;
  for (const node of root.walk()) {
    if (node.name !== 'Skin') continue;
    const edit = edits[node.attrs.get('name')];
    if (!edit) continue;
    for (const k of [...node.attrs.keys()]) if (/^(src_|size_)/.test(k) || k === 'type') node.attrs.delete(k);
    node.attrs.set('texture', edit.texture);
    node.attrs.set('src_image', rectToString(edit.rect));
    touched++;
  }
  return touched;
}

module.exports = { list, applyEdits, applyByName, parseRect, rectToString, atlasKey, RECT_FIELDS };
