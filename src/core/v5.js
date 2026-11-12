'use strict';
/**
 * Перевод интерфейса на внешний вид Aion 5.x.
 *
 * В клиенте лежат две библиотеки скинов: `version4.xml` (её использует Classic)
 * и `version5.xml`. Подменить одну на другую нельзя — диалоги зовут скины по
 * именам `v4_*`, которых в пятой версии нет.
 *
 * Зато имена устроены одинаково: `v4_button_up` и `v5_button_up`. Поэтому мы
 * не меняем библиотеку, а переписываем каждой записи v4 её «внешность» —
 * атлас, прямоугольники и размеры кусков — беря их у одноимённой записи v5.
 * Имя остаётся прежним, значит диалоги и пресеты продолжают её находить.
 *
 * Пара находится у 941 записи из 1068. Остальные (инвентарь, почта, часть
 * значков) в пятой версии названы иначе и остаются в старом виде — поэтому
 * «по максимуму», а не «целиком».
 */

const bxml = require('./bxml');

const V4_LIB = 'version4.xml';
const V5_LIB = 'version5.xml';

/** Всё, что описывает внешность. Имя сюда не входит — оно должно остаться. */
const VISUAL = /^(texture|type|border|src_|size_)/;

/**
 * Как ищется пара. Правила идут по убыванию надёжности, и каждое подписано —
 * в окне видно, каким именно правилом подобрана деталь, и любое можно
 * выключить.
 */
const RULES = [
  { id: 'exact', title: 'по имени', hint: 'v4_button_up → v5_button_up', safe: true },
  { id: 'norm', title: 'с точностью до подчёркиваний', hint: 'v4_tab_button_up → v5_tabbutton_up', safe: true },
  { id: 'state', title: 'подставить обычное состояние', hint: 'v4_mailicon → v5_mailicon_up', safe: true },
  { id: 'variant', title: 'свести варианты к одному', hint: 'v4_dialog3 → v5_dialog', safe: false },
];

/** Убираем префикс версии, подчёркивания и разворачиваем сокращения. */
const EXPAND = [
  ['inv', 'inventory'], ['mb', 'mailbox'], ['btn', 'button'],
  ['ind', 'indicator'], ['potrait', 'portrait'],
];
function norm(s) {
  let t = String(s).toLowerCase().replace(/^v[3-8]_/, '');
  for (const [a, b] of EXPAND) {
    t = t.replace(new RegExp('(^|_)' + a + '(_|$)', 'g'), '$1' + b + '$2');
  }
  return t.replace(/_/g, '');
}

const STATES = ['_up', '_over', '_down'];
const hasState = (s) => STATES.some((x) => s.endsWith(x));
/** `dialog3` -> `dialog`, `plus2_up` -> `plus_up`: цифра варианта в конце основы. */
const dropVariant = (s) => s.replace(/(\d+)(?=(_up|_over|_down)?$)/, '');

/** Готовит быстрый поиск по именам v5. */
function makeIndex(names) {
  const byName = new Set(names);
  const byNorm = new Map();
  for (const n of names) if (!byNorm.has(norm(n))) byNorm.set(norm(n), n);
  return { byName, byNorm };
}

/**
 * Пара для имени из v4.
 * @returns {{to: string, rule: string}|null}
 */
function findPair(name, idx, rules) {
  const on = (id) => !rules || rules[id] !== false;
  const tails = /^v4_/.test(name) ? [name.slice(3)] : [];
  const direct = [...tails.flatMap((t) => ['v5_' + t, 'v7_' + t, 'v6_' + t]), name];

  if (on('exact')) {
    const hit = direct.find((x) => idx.byName.has(x));
    if (hit) return { to: hit, rule: 'exact' };
  }
  if (on('norm')) {
    const hit = idx.byNorm.get(norm(name));
    if (hit) return { to: hit, rule: 'norm' };
  }
  if (on('state') && !hasState(name)) {
    const hit = idx.byNorm.get(norm(name + '_up'));
    if (hit) return { to: hit, rule: 'state' };
  }
  if (on('variant')) {
    const base = dropVariant(name);
    if (base !== name) {
      const hit = idx.byNorm.get(norm(base));
      if (hit) return { to: hit, rule: 'variant' };
    }
  }
  return null;
}

/** Совместимость со старым вызовом: только точные кандидаты. */
function candidates(name) {
  const out = [];
  if (/^v4_/.test(name)) {
    const tail = name.slice(3);
    out.push('v5_' + tail, 'v7_' + tail, 'v6_' + tail);
  }
  out.push(name);
  return out;
}

function indexSkins(root) {
  const map = new Map();
  for (const category of root.kids) {
    const cat = category.attrs.get('name') || '';
    for (const node of category.walk()) {
      if (node.name !== 'Skin') continue;
      const name = node.attrs.get('name');
      if (name && !map.has(name)) map.set(name, { node, cat });
    }
  }
  return map;
}

/**
 * Что получится при переносе — без изменения файлов.
 * @param {Buffer} v4data содержимое version4.xml
 * @param {Buffer} v5data содержимое version5.xml
 */
const atlasKey = (t) => String(t || '').toLowerCase().replace(/^.*\//, '');

/**
 * @param {Buffer} v4data содержимое version4.xml
 * @param {Buffer} v5data содержимое version5.xml
 * @param {Set<string>} [have] какие атласы есть в клиенте (короткие имена)
 */
function plan(v4data, v5data, have, rules) {
  const v4 = indexSkins(bxml.parse(v4data).root);
  const v5 = indexSkins(bxml.parse(v5data).root);
  const idx = makeIndex([...v5.keys()]);

  const pairs = [];
  const unmatched = [];
  const noAtlas = [];
  for (const [name, a] of v4) {
    const pair = findPair(name, idx, rules);
    if (!pair) { unmatched.push({ name, category: a.cat }); continue; }
    const found = pair.to;
    const b = v5.get(found);
    const texture = b.node.attrs.get('texture') || '';
    // нет картинки — нет и переноса, иначе деталь пропадёт с экрана
    if (have && texture && !have.has(atlasKey(texture))) {
      noAtlas.push({ name, category: a.cat, texture });
      continue;
    }
    pairs.push({
      name,
      to: found,
      rule: pair.rule,
      category: a.cat,
      from: {
        texture: a.node.attrs.get('texture') || '',
        rect: a.node.attrs.get('src_image') || a.node.attrs.get('src_middle_middle') || '',
      },
      after: {
        texture,
        rect: b.node.attrs.get('src_image') || b.node.attrs.get('src_middle_middle') || '',
      },
    });
  }

  const atlases = new Set();
  for (const p of pairs) if (p.after.texture) atlases.add(p.after.texture);

  const byCategory = new Map();
  for (const p of pairs) byCategory.set(p.category, (byCategory.get(p.category) || 0) + 1);
  const byRule = new Map();
  for (const p of pairs) byRule.set(p.rule, (byRule.get(p.rule) || 0) + 1);

  const restByCategory = new Map();
  for (const u of unmatched) {
    restByCategory.set(u.category, (restByCategory.get(u.category) || 0) + 1);
  }

  return {
    total: v4.size,
    matched: pairs.length,
    unmatched,
    noAtlas,
    pairs,
    rules: RULES.map((r) => Object.assign({ count: byRule.get(r.id) || 0 }, r)),
    atlases: [...atlases].sort(),
    byCategory: [...byCategory].sort((x, y) => y[1] - x[1]),
    restByCategory: [...restByCategory].sort((x, y) => y[1] - x[1]),
  };
}

/**
 * Переписывает внешность записей v4 по их парам из v5.
 * @param {bxml.Node} v4root дерево version4.xml (меняется на месте)
 * @param {Buffer} v5data содержимое version5.xml
 * @param {Set<string>} [skip] имена, которые не трогать
 * @returns {number} сколько записей переписали
 */
function convert(v4root, v5data, opts) {
  const o = opts || {};
  const skip = o.skip;
  const have = o.have;
  const v5 = indexSkins(bxml.parse(v5data).root);
  const idx = makeIndex([...v5.keys()]);
  let touched = 0;
  for (const category of v4root.kids) {
    // категория — как у donor.js: одиночный скин верхнего уровня — без категории
    const cat = category.name === 'Skin' ? '' : category.attrs.get('name') || '';
    for (const node of category.walk()) {
      if (node.name !== 'Skin') continue;
      const name = node.attrs.get('name');
      if (!name || (skip && skip.has(name))) continue;
      // микшер вида (look.js): деталь из группы с другим источником не трогаем
      if (o.allow && !o.allow(V4_LIB, cat, name)) continue;
      const pair = findPair(name, idx, o.rules);
      if (!pair) continue;
      const found = pair.to;
      const texture = v5.get(found).node.attrs.get('texture') || '';
      if (have && texture && !have.has(atlasKey(texture))) continue;

      // Снимаем старое описание целиком: у пары может быть другой набор полей
      // (простая картинка вместо растягиваемой рамки и наоборот), и остатки
      // прежних координат сломали бы отрисовку.
      for (const k of [...node.attrs.keys()]) if (VISUAL.test(k)) node.attrs.delete(k);
      for (const [k, v] of v5.get(found).node.attrs) {
        if (VISUAL.test(k)) node.attrs.set(k, v);
      }
      touched++;
    }
  }
  return touched;
}

module.exports = { plan, convert, candidates, findPair, makeIndex, atlasKey, RULES, VISUAL, V4_LIB, V5_LIB };
