'use strict';
/**
 * Иконки предметов: каталог для раздела «Иконки умений» → «Предметы».
 *
 * Иконки лежат в data/items/items.pak (корень пака, icon_*.dds, ~11 тысяч),
 * холст 64×64, рисунок 40×40 в левом верхнем углу — как у умений. Рангов и
 * серых двойников нет: одна иконка — один файл. В том же паке ~900 копий
 * иконок умений — они не icon_* и в каталог не попадают.
 *
 * Названия — из data/items/client_items.xml (262 МБ UTF-16, разбор меньше
 * секунды): у предмета icon_name, desc (ключ строки), equipment_slots,
 * weapon_type, quality. Одной иконкой пользуются многие предметы (3 тысячи
 * иконок на 62 тысячи предметов) — у иконки список названий.
 *
 * Правки — profile.packs.items (ключ «пак|запись» -> DDS), пишет их сборка
 * общим проходом наборов картинок.
 */

const pak = require('./pak');

const ITEMS_PAK = 'data/items/items.pak';

const tag = (rec, name) => {
  const m = rec.match(new RegExp('<' + name + '>([^<]*)</' + name + '>', 'i'));
  return m ? m[1].trim() : '';
};
const utf16 = (buf) => (buf[0] === 0xff && buf[1] === 0xfe ? buf.toString('utf16le', 2) : buf.toString(buf[1] === 0 ? 'utf16le' : 'utf8'));
const clean = (s) => s.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();

/** Слот предмета -> группа фильтра. */
function slotGroup(slots, weapon) {
  const s = String(slots || '').toLowerCase();
  if (/main|sub/.test(s) || (weapon && weapon !== 'noweapon')) return 'weapon';
  if (/torso|foot|leg|glove|shoulder|head/.test(s)) return 'armor';
  if (/finger|ear|neck|waist/.test(s)) return 'jewel';
  if (/wing/.test(s)) return 'wing';
  return 'other';
}
const GROUPS = [['weapon', 'оружие и щиты'], ['armor', 'броня'], ['jewel', 'бижутерия'], ['wing', 'крылья'], ['other', 'прочее']];
const QUALITY = [['common', 'обычное'], ['rare', 'редкое'], ['legend', 'легендарное'], ['unique', 'уникальное'],
  ['epic', 'эпическое'], ['mythic', 'мифическое'], ['junk', 'хлам']];
const QRANK = Object.fromEntries(QUALITY.map(([q], i) => [q, i]));

const cache = new Map();

/**
 * @param {import('./client').Client} client
 * @param {string} lang
 */
function catalogue(client, lang) {
  const ck = client.root + '|' + lang;
  if (cache.has(ck)) return cache.get(ck);
  const file = client.pristine(ITEMS_PAK);
  const entries = pak.listPak(file).entries.map((e) => e.name);
  const icons = new Map(); // имя иконки (нижний регистр) -> запись
  for (const e of entries) {
    if (!/^icon_[^/]*\.dds$/i.test(e)) continue;
    const id = e.replace(/\.dds$/i, '').toLowerCase();
    icons.set(id, { id, key: ITEMS_PAK + '|' + e, titles: new Map(), count: 0, groups: new Map(), quality: '' });
  }

  // названия предметов
  const names = new Map();
  try {
    const rel = client.l10nRel(lang);
    const all = pak.listPak(client.pristine(rel)).entries.map((e) => e.name);
    const files = all.filter((n) => /(^|\/)client_strings_item\d*\.xml$/i.test(n));
    for (const buf of pak.readSome(client.pristine(rel), client.dll, files).values()) {
      for (const m of utf16(buf).matchAll(/<name>([^<]+)<\/name>\s*<body>([^<]*)<\/body>/gi)) {
        names.set(m[1].toLowerCase(), clean(m[2]));
      }
    }
  } catch (e) { /* без названий — по именам файлов */ }

  // предметы -> иконки
  let items = 0;
  try {
    const raw = pak.readSome(file, client.dll, entries.filter((n) => /^client_items\.xml$/i.test(n)));
    const txt = raw.size ? utf16([...raw.values()][0]) : '';
    for (const rec of txt.split('<client_item>').slice(1)) {
      const ic = icons.get(tag(rec, 'icon_name').toLowerCase());
      if (!ic) continue;
      items++;
      ic.count++;
      const title = names.get(tag(rec, 'desc').toLowerCase());
      if (title) ic.titles.set(title, (ic.titles.get(title) || 0) + 1);
      const g = slotGroup(tag(rec, 'equipment_slots'), tag(rec, 'weapon_type'));
      ic.groups.set(g, (ic.groups.get(g) || 0) + 1);
      const q = tag(rec, 'quality').toLowerCase();
      if (q in QRANK && (!ic.quality || QRANK[q] > QRANK[ic.quality])) ic.quality = q;
    }
  } catch (e) { /* без таблицы — только файлы */ }

  const list = [...icons.values()].map((ic) => {
    // название — самое частое у предметов с этой иконкой
    const titles = [...ic.titles].sort((a, b) => b[1] - a[1]).map(([t]) => t);
    const group = [...ic.groups].sort((a, b) => b[1] - a[1]).map(([g]) => g)[0] || '';
    return { id: ic.id, key: ic.key, title: titles[0] || '', titles: titles.slice(0, 8), count: ic.count, group, quality: ic.quality };
  });
  list.sort((a, b) => (a.title ? 0 : 1) - (b.title ? 0 : 1) || a.title.localeCompare(b.title, 'ru') || a.id.localeCompare(b.id));
  const out = { icons: list, items, named: names.size, groups: GROUPS, qualities: QUALITY };
  cache.set(ck, out);
  return out;
}

module.exports = { catalogue, ITEMS_PAK };
