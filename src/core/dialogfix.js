'use strict';
/**
 * Правки обычных окон под вид официального Classic — там, где одной
 * перекраски скинов мало, потому что официальный клиент поменял не картинку,
 * а устройство окна.
 *
 *   списки   — строки у официального разделены зазором (`cell_space` 3,2),
 *              подложки строки у него нет. У нас зазор 0,0 и подложка строки,
 *              которая после переноса стала сплошной: умения слились в одну
 *              полосу. Берём зазор официального списка с тем же именем.
 *   вкладки  — под вкладками у официального сплошная полоса `v3_tab_line`
 *              (виджет `tab`), у нас тонкая линия `v4_tab`. Без полосы новые
 *              вкладки выглядят узкими и висят в воздухе.
 *
 * Окна берутся из локализованного пака (его читает игра), пара — официальное
 * `v3_X` или одноимённое, как в donor.dialogPresetPairs. Окна HUD не трогаем:
 * их переносит hudport. Файлы не меняются.
 */

const bxml = require('./bxml');
const pak = require('./pak');
const donorlib = require('./donor');

/** Пресет полосы под вкладками у официального. */
const TAB_LINE = 'v3_tab_line';

const lc = (s) => String(s || '').toLowerCase();
const isWidget = (n) => n.name === 'Widget';

function clone(n) {
  const c = new bxml.Node(n.name);
  c.text = n.text;
  for (const [k, v] of n.attrs) c.attrs.set(k, v);
  c.kids = n.kids.map(clone);
  return c;
}

/** Виджеты окна по имени (первый с таким именем). */
function byName(root) {
  const m = new Map();
  for (const w of root.walk()) {
    const n = isWidget(w) && lc(w.attrs.get('name'));
    if (n && !m.has(n)) m.set(n, w);
  }
  return m;
}

/**
 * Правит одно окно на месте. @returns {string[]} что поправлено
 */
function fixDialog(ours, theirs) {
  const done = [];
  const tw = byName(theirs);
  const theirTabLine = [...theirs.walk()].some((w) => isWidget(w) && lc(w.attrs.get('type')) === 'tab' &&
    w.attrs.get('preset') === TAB_LINE);
  for (const w of ours.walk()) {
    if (!isWidget(w)) continue;
    const type = lc(w.attrs.get('type'));
    // только таблицы: в сетке иконок зазор съел бы ячейку в ряду
    if (type === 'listview' && lc(w.attrs.get('viewmode')) === 'detail') {
      const t = tw.get(lc(w.attrs.get('name')));
      const space = t && lc(t.attrs.get('type')) === 'listview' && t.attrs.get('cell_space');
      const mine = w.attrs.get('cell_space') || '0,0';
      if (space && space !== mine && /^0,\s*0$/.test(mine)) {
        w.attrs.set('cell_space', space);
        done.push('зазор строк ' + (w.attrs.get('name') || ''));
      }
    }
    if (type === 'tab' && w.attrs.get('preset') === 'v4_tab' && theirTabLine) {
      w.attrs.set('preset', TAB_LINE);
      done.push('полоса под вкладками');
      if (fillTabs(ours, w, tw)) done.push('вкладки во всю ширину');
    }
  }
  return done;
}

/** Рамка виджета в координатах окна (сумма смещений предков). */
function absOf(root, node) {
  let hit = null;
  (function walk(n, dx, dy) {
    for (const k of n.kids) {
      if (hit || !isWidget(k)) continue;
      const f = k.getFrame() || { x: 0, y: 0, w: 0, h: 0 };
      if (k === node) { hit = { x: dx + f.x, y: dy + f.y, w: f.w, h: f.h }; return; }
      walk(k, dx + f.x, dy + f.y);
    }
  })(root, 0, 0);
  return hit;
}

/**
 * Вкладки встык на всю полосу, как у официального. Ширины — пропорции его
 * одноимённых вкладок (подписи разной длины), безымянные — поровну. Порядок —
 * наш. Если в полосу заходит соседний виджет окна (кнопка «Серии» над
 * вкладками умений), вкладки занимают место до него.
 * @returns {boolean} поправлено ли
 */
function fillTabs(root, tab, theirByName) {
  const btns = tab.kids.filter((k) => isWidget(k) && lc(k.attrs.get('type')) === 'tabbutton' && k.getFrame())
    .sort((a, b) => a.getFrame().x - b.getFrame().x);
  const strip = absOf(root, tab);
  if (btns.length < 2 || !strip) return false;
  let avail = strip.w;
  // виджеты верхнего уровня окна, кроме ветки с самими вкладками
  const inside = (n) => n === tab || [...n.walk()].includes(tab);
  for (const k of root.kids) {
    if (!isWidget(k) || inside(k)) continue;
    const o = absOf(root, k);
    if (!o || !o.w || !o.h || /not_visible/.test(k.attrs.get('flag') || '')) continue;
    const overlapY = o.y < strip.y + strip.h && strip.y < o.y + o.h;
    if (overlapY && o.x > strip.x && o.x < strip.x + avail) avail = o.x - 2 - strip.x;
  }
  const weights = btns.map((b) => {
    const t = theirByName.get(lc(b.attrs.get('name')));
    return t && lc(t.attrs.get('type')) === 'tabbutton' && t.getFrame() ? t.getFrame().w : 0;
  });
  const w = weights.every((x) => x > 0) ? weights : btns.map(() => 1);
  const sum = w.reduce((a, b) => a + b, 0);
  let x = 0;
  let acc = 0;
  btns.forEach((b, i) => {
    acc += w[i];
    const right = Math.round((acc / sum) * avail);
    const f = b.getFrame();
    b.setFrame({ x, y: f.y, w: right - x, h: f.h });
    x = right;
  });
  return true;
}

/**
 * @param {import('./client').Client} client
 * @param {donorlib.Donor} donor
 * @param {string} lang
 * @returns {{dialogs: Map<string, Buffer>, notes: Map<string, string[]>,
 *   presets: object[], skins: object[], ships: Map<string, object>, missing: string[]}}
 *   dialogs — `game/имя.xml` -> новое окно (то же для data/ui и l10n)
 */
function plan(client, donor, lang) {
  const l10nRel = 'l10n/' + (lang || 'rus') + '/data/data.pak';
  const file = client.pristine(l10nRel);
  const names = pak.listPak(file).entries.map((e) => e.name).filter((n) => /^ui\/game\/[^/]+\.xml$/i.test(n));
  const bufs = pak.readSome(file, client.dll, names);
  const theirDialogs = donor.dialogs(lang);
  const gameEntries = client.has('game') ? new Map([...client.original('game').keys()].map((k) => [lc(k), k])) : new Map();

  const dialogs = new Map();
  const notes = new Map();
  let tabLine = false;
  for (const name of names) {
    const k = lc(name);
    const cut = k.lastIndexOf('/');
    const theirs = theirDialogs.get(k.slice(0, cut + 1) + 'v3_' + k.slice(cut + 1)) || theirDialogs.get(k);
    if (!theirs) continue;
    let parsed;
    try { parsed = bxml.parse(bufs.get(name)); } catch (e) { continue; }
    const done = fixDialog(parsed.root, theirs);
    if (!done.length) continue;
    if (done.includes('полоса под вкладками')) tabLine = true;
    const entry = gameEntries.get(k.slice(cut + 1)) || name.slice(name.lastIndexOf('/') + 1);
    dialogs.set('game/' + entry, bxml.serialize(parsed.root, parsed.strings));
    notes.set('game/' + entry, [...new Set(done)]);
  }

  // пресет полосы под вкладками и его скины — в нашу библиотеку, атлас — к паку донора
  const presets = [];
  const skins = [];
  const ships = new Map();
  const missing = [];
  if (tabLine) {
    const ourLib = libIndex(client.original('preload'));
    const theirLib = libIndex(donor.preload());
    const oursFind = donorlib.ourFinder(client, lang);
    const theirsFind = donor.finder(lang);
    if (!ourLib.presets.has(TAB_LINE)) {
      const p = theirLib.presets.get(TAB_LINE);
      if (!p) missing.push('пресет ' + TAB_LINE);
      else {
        presets.push(clone(p));
        for (const r of p.kids) {
          const s = r.name === 'SkinRef' && r.attrs.get('name');
          if (!s || ourLib.skins.has(s)) continue;
          const node = theirLib.skins.get(s);
          if (!node) { missing.push('скин ' + s); continue; }
          const copy = clone(node);
          const tex = node.attrs.get('texture');
          const theirLoc = tex && theirsFind.resolve(tex);
          if (tex && !theirLoc) { missing.push('атлас ' + tex); continue; }
          const ourLoc = tex && oursFind.resolve(tex);
          if (tex && !(ourLoc && ourLoc.crc === theirLoc.crc && ourLoc.size === theirLoc.size)) {
            const ship = donorlib.shipName(tex);
            ships.set(ship, theirLoc);
            copy.attrs.set('texture', 'textures/ui/' + ship);
          }
          skins.push(copy);
        }
      }
    }
    // без пресета полосу ставить нельзя — окна без неё
    if (missing.length) {
      for (const [id, data] of dialogs) {
        const { root, strings } = bxml.parse(data);
        for (const w of root.walk()) if (w.attrs.get('preset') === TAB_LINE) w.attrs.set('preset', 'v4_tab');
        dialogs.set(id, bxml.serialize(root, strings));
      }
    }
  }
  return { dialogs, notes, presets, skins, ships, missing };
}

/** Скины и пресеты набора библиотек: имя -> узел (первый). */
function libIndex(files) {
  const skins = new Map();
  const presets = new Map();
  for (const [k, buf] of files) {
    if (!/\.xml$/i.test(k)) continue;
    let root;
    try { root = bxml.parse(buf).root; } catch (e) { continue; }
    if (root.name !== 'Preload') continue;
    for (const n of root.walk()) {
      const nm = n.attrs.get('name');
      if (!nm) continue;
      if (n.name === 'Skin' && !skins.has(nm)) skins.set(nm, n);
      if (n.name === 'Preset' && !presets.has(nm)) presets.set(nm, n);
    }
  }
  return { skins, presets };
}

module.exports = { plan, fixDialog, TAB_LINE };
