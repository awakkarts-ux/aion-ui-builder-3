'use strict';
/**
 * Каталог иконок умений: семейства рангов, чьи они (классы), что это за
 * умения (русские названия, вид, назначение).
 *
 * Откуда что:
 *   data/skills/skills.pak — сами иконки `<семейство>_g<ранг>.dds` и серые
 *     `_gray`, а ещё две таблицы (UTF-16, обычный XML):
 *     client_skills.xml       — умение -> `skillicon_name`, `desc` (ключ
 *                               названия), `activation_attribute`, `sub_type`, `type`
 *     client_skill_learns.xml — класс -> умение, уровень изучения
 *   l10n/<язык>/data/data.pak — Strings/client_strings_skill.xml: ключ -> название
 *
 * Классы: стартовый отдаёт умения обоим своим (Разведчик -> Стрелок и
 * Убийца). У CLERIC и PRIEST в файлах игры имена наоборот: CLERIC —
 * стартовый «Жрец», PRIEST — «Целитель».
 */

const pak = require('./pak');
const iconranks = require('./iconranks');
const dds = require('./dds');

const SKILLS_PAK = 'data/skills/skills.pak';

const CLASSES = [
  ['FIGHTER', 'Гладиатор'], ['KNIGHT', 'Страж'], ['RANGER', 'Стрелок'], ['ASSASSIN', 'Убийца'],
  ['WIZARD', 'Волшебник'], ['ELEMENTALLIST', 'Заклинатель'], ['PRIEST', 'Целитель'], ['CHANTER', 'Чародей'],
];
const FINAL = CLASSES.map(([id]) => id);
const STARTERS = {
  WARRIOR: ['FIGHTER', 'KNIGHT'],
  SCOUT: ['RANGER', 'ASSASSIN'],
  MAGE: ['WIZARD', 'ELEMENTALLIST'],
  CLERIC: ['PRIEST', 'CHANTER'],
  ALL: FINAL,
};

/**
 * Класс по коду в имени иконки или умения (`cbt_ra_…`, `RA_…`). Таблица
 * изучения знает не всё: практику оружия и доспехов, ловушки светлых и
 * тёмных, умения из книг — у Стрелка из 105 его иконок она давала 43.
 */
const CODES = {
  fi: ['FIGHTER'], kn: ['KNIGHT'], ra: ['RANGER'], as: ['ASSASSIN'],
  wi: ['WIZARD'], el: ['ELEMENTALLIST'], pr: ['PRIEST'], ch: ['CHANTER'],
  wa: ['FIGHTER', 'KNIGHT'], sc: ['RANGER', 'ASSASSIN'], ma: ['WIZARD', 'ELEMENTALLIST'], cl: ['PRIEST', 'CHANTER'],
};
const codeClasses = (s) => {
  const m = String(s).toLowerCase().match(/^(?:(?:cbt|live)_)?([a-z]{2})_/);
  return (m && CODES[m[1]]) || [];
};

/** Вид умения: как оно срабатывает. */
const ACT = { active: 'active', passive: 'passive', toggle: 'toggle', maintain: 'toggle', provoked: 'provoked' };
/** Назначение. */
const SUB = {
  attack: 'attack', buff: 'buff', debuff: 'debuff', heal: 'heal', chant: 'chant',
  summon: 'summon', summontrap: 'summon', summonhoming: 'summon', none: 'other',
};

const utf16 = (b) => (b[0] === 0xff && b[1] === 0xfe ? b.toString('utf16le', 2) : b.toString('utf8'));
const tag = (rec, t) => {
  const m = rec.match(new RegExp('<' + t + '>([^<]*)</' + t + '>'));
  return m ? m[1] : '';
};
const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'").replace(/&amp;/g, '&');
/** Цветовые и прочие вставки в названиях: `[color:…]`, `%0`. */
const clean = (s) => decode(s).replace(/\[[^\]]*\]/g, '').replace(/\s+/g, ' ').trim();

/** `CBT_RA_ArrowStrike_G2.dds` -> { family: 'cbt_ra_arrowstrike', rank: 2, gray: false }. */
function parseIcon(name) {
  const low = name.toLowerCase();
  const m = low.match(/^(.+)_g(\d+)(_gray)?\.dds$/);
  if (m) return { family: m[1], rank: +m[2], gray: !!m[3] };
  const n = low.match(/^(.+?)(_gray)?\.dds$/);
  return n ? { family: n[1], rank: 0, gray: !!n[2] } : null;
}

const cache = new Map();

/**
 * @param {import('./client').Client} client
 * @param {string} lang
 */
function catalogue(client, lang) {
  const ck = client.root + '|' + lang;
  if (cache.has(ck)) return cache.get(ck);

  const file = client.pristine(SKILLS_PAK);
  const entries = pak.listPak(file).entries.map((e) => e.name);

  // семейства из самих картинок
  const fams = new Map();
  for (const entry of entries) {
    const p = parseIcon(entry);
    if (!p) continue;
    if (!fams.has(p.family)) {
      fams.set(p.family, { id: p.family, ranks: new Map(), skills: [], classes: new Set(), raw: new Set(),
        level: 0, act: new Set(), sub: new Set(), type: new Set() });
    }
    const f = fams.get(p.family);
    if (!f.ranks.has(p.rank)) f.ranks.set(p.rank, { rank: p.rank, key: '', grayKey: '' });
    f.ranks.get(p.rank)[p.gray ? 'grayKey' : 'key'] = SKILLS_PAK + '|' + entry;
  }

  // таблицы
  const tables = pak.readSome(file, client.dll, entries.filter((n) =>
    /^client_skills\.xml$|^client_skill_learns\.xml$/i.test(n)));
  const read = (re) => {
    const k = [...tables.keys()].find((n) => re.test(n));
    return k ? utf16(tables.get(k)) : '';
  };

  const learnt = new Map(); // умение (нижний регистр) -> { classes, level }
  for (const rec of read(/^client_skill_learns\.xml$/i).split('<client_skill_learn>').slice(1)) {
    const skill = tag(rec, 'skill').toLowerCase();
    if (!skill) continue;
    const cls = tag(rec, 'class').toUpperCase();
    const lvl = +tag(rec, 'pc_level') || 0;
    if (!learnt.has(skill)) learnt.set(skill, { classes: new Set(), level: lvl });
    const l = learnt.get(skill);
    l.classes.add(cls);
    if (lvl && (!l.level || lvl < l.level)) l.level = lvl;
  }

  const names = new Map(); // ключ названия (нижний регистр) -> текст
  try {
    const rel = client.l10nRel(lang);
    const all = pak.listPak(client.pristine(rel)).entries.map((e) => e.name);
    const k = all.find((n) => /(^|\/)client_strings_skill\.xml$/i.test(n));
    if (k) {
      const txt = utf16(pak.readSome(client.pristine(rel), client.dll, [k]).get(k));
      for (const rec of txt.split('<string>').slice(1)) {
        const n = tag(rec, 'name').toLowerCase();
        const body = rec.match(/<body>([\s\S]*?)<\/body>/);
        if (n && body) names.set(n, clean(body[1]));
      }
    }
  } catch (e) {
    // без названий каталог всё равно полезен — по именам файлов
  }

  let skillsTotal = 0;
  for (const rec of read(/^client_skills\.xml$/i).split('<skill_base_client>').slice(1)) {
    const icon = tag(rec, 'skillicon_name');
    const p = icon && parseIcon(icon);
    const f = p && fams.get(p.family);
    if (!f) continue;
    const name = tag(rec, 'name');
    const l = learnt.get(name.toLowerCase());
    // умение, которое никто не изучает (служебные, монстров), в классы не пишем
    if (l) {
      for (const c of l.classes) {
        f.raw.add(c);
        for (const fc of STARTERS[c] || [c]) if (FINAL.includes(fc)) f.classes.add(fc);
      }
      if (l.level && (!f.level || l.level < f.level)) f.level = l.level;
    }
    // не в таблице изучения, но умение классовое по имени (RA_…) — тоже его
    const byName = l ? [] : codeClasses(name);
    for (const fc of byName) f.classes.add(fc);
    const mine = !!l || byName.length > 0;
    const act = ACT[tag(rec, 'activation_attribute').toLowerCase()];
    const sub = SUB[tag(rec, 'sub_type').toLowerCase()];
    const type = tag(rec, 'type').toLowerCase();
    if (mine && act) f.act.add(act);
    if (mine && sub) f.sub.add(sub);
    if (mine && type) f.type.add(type);
    f.skills.push({
      name,
      title: names.get(tag(rec, 'desc').toLowerCase()) || '',
      rank: p.rank,
      learnt: mine,
    });
    skillsTotal++;
  }

  const list = [];
  for (const f of fams.values()) {
    const ranks = [...f.ranks.values()].filter((r) => r.key).sort((a, b) => a.rank - b.rank);
    if (!ranks.length) continue;
    // иконка с кодом класса в имени (cbt_ra_…) — его, даже если умения к ней не нашлось
    const byIcon = codeClasses(f.id);
    for (const fc of byIcon) f.classes.add(fc);
    // название — у изученного умения первого ранга, иначе любое
    const titled = f.skills.filter((s) => s.title).sort((a, b) =>
      Number(b.learnt) - Number(a.learnt) || a.rank - b.rank);
    const titles = [...new Set(titled.map((s) => s.title.replace(/\s+[IVX]+$/, '')))];
    list.push({
      id: f.id,
      title: titles[0] || '',
      titles: titles.slice(0, 6),
      ranks,
      classes: FINAL.filter((c) => f.classes.has(c)),
      starter: [...f.raw].some((c) => c in STARTERS && c !== 'ALL'),
      all: f.raw.has('ALL'),
      level: f.level,
      act: [...f.act],
      sub: [...f.sub],
      type: [...f.type],
      skills: f.skills.length,
      used: f.skills.some((s) => s.learnt) || byIcon.length > 0,
      prefix: (f.id.match(/^([a-z]+)_/) || [0, ''])[1],
    });
  }
  list.sort((a, b) => (a.title ? 0 : 1) - (b.title ? 0 : 1) ||
    a.title.localeCompare(b.title, 'ru') || a.id.localeCompare(b.id));

  const out = { families: list, classes: CLASSES, skills: skillsTotal, named: names.size };
  cache.set(ck, out);
  return out;
}

const maskCache = new Map();

/** Маски цифр рангов по всем семействам клиента (секунды две, один раз). */
function masks(client, lang) {
  const ck = client.root + '|' + lang;
  if (maskCache.has(ck)) return maskCache.get(ck);
  const cat = catalogue(client, lang);
  const multi = cat.families.filter((f) => f.ranks.length >= 2 && f.ranks[0].rank === 1);
  const data = client.packRead('skills', lang, multi.flatMap((f) => f.ranks.map((r) => r.key)));
  const fams = [];
  let width = 64;
  for (const f of multi) {
    const m = new Map();
    for (const r of f.ranks) {
      const raw = data.get(r.key);
      if (!raw) continue;
      try {
        const img = dds.toRgba(raw);
        if (img.width !== 64 || img.height !== 64) continue;
        m.set(r.rank, img.rgba);
      } catch (e) { /* не разобрали — пропуск */ }
    }
    if (m.has(1) && m.size >= 2) fams.push(m);
  }
  const out = iconranks.numeralMasks(fams, width);
  maskCache.set(ck, out);
  return out;
}

/**
 * Готовые картинки для семейства или одного ранга.
 * @param {object} o
 * @param {object} o.family   запись каталога
 * @param {Buffer} o.rgba     новая картинка в холсте родной иконки
 * @param {number} [o.rank]   только этот ранг
 * @returns {Array<{key: string, width: number, height: number, rgba: Buffer}>}
 */
function make(client, lang, o) {
  const f = o.family;
  const data = client.packRead('skills', lang, f.ranks.map((r) => r.key));
  const originals = new Map();
  let width = 0, height = 0;
  for (const r of f.ranks) {
    const img = dds.toRgba(data.get(r.key));
    if (!width) { width = img.width; height = img.height; }
    if (img.width !== width || img.height !== height) continue;
    originals.set(r.rank, img.rgba);
  }
  if (o.rgba.length !== width * height * 4) {
    throw new Error(`картинка ${o.rgba.length / 4} пикселей, а иконка ${width}×${height}`);
  }
  const m = width === 64 && height === 64 ? masks(client, lang) : new Map();
  const made = o.rank != null
    ? new Map([[o.rank, iconranks.makeRank(o.rgba, originals.get(o.rank), m.get(o.rank))]])
    : iconranks.makeFamily(o.rgba, originals, m, width);
  const out = [];
  for (const r of f.ranks) {
    const got = made.get(r.rank);
    if (!got) continue;
    out.push({ key: r.key, width, height, rgba: got.color });
    if (r.grayKey) out.push({ key: r.grayKey, width, height, rgba: got.gray });
  }
  return out;
}

module.exports = { catalogue, masks, make, parseIcon, CLASSES, SKILLS_PAK };
