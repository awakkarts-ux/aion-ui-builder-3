'use strict';
/**
 * Импорт официального клиента в папку программы.
 *
 * Работать прямо с чужим клиентом неудобно: его обновляет лаунчер, его могут
 * удалить, а сборка каждый раз ходит по 900 МБ паков. Импорт один раз
 * забирает из него то, что нужно разделу «Вид официального Classic», и
 * кладёт рядом с настройками программы — в тех же путях, что у клиента,
 * поэтому Donor, hudport, dialogfix и maps читают импорт, как клиента.
 *
 * Паки импорта — обычные ZIP без шифрования головы: ключ донора (его
 * crysystem.dll) не копируется. Записи перекладываются сжатыми, как лежали.
 *
 * Что забирается:
 *   data/ui/preload/preload.pak     — целиком (библиотеки скинов)
 *   data/ui/ui.pak                  — только UI_Preload.xml (какие библиотеки грузятся)
 *   l10n/<язык>/data/data.pak       — только окна `UI/…/*.xml`
 *   атласы                          — те, на которые ссылаются скины библиотек,
 *                                     из того пака, где их нашёл бы клиент
 *   карты                           — только тайлы зон, которые заменятся в
 *                                     клиенте пользователя (maps.plan); без
 *                                     клиента — ничего: 750 МБ ради 11 тайлов
 */

const fs = require('fs');
const path = require('path');
const pak = require('./pak');
const bxml = require('./bxml');
const donorlib = require('./donor');
const mapslib = require('./maps');

const FORMAT = 1;

/** Атласы, на которые ссылаются скины донора. */
function textureRefs(donor) {
  const refs = new Set();
  for (const [name, data] of donor.preload()) {
    if (!/\.xml$/i.test(name)) continue;
    let root;
    try { root = bxml.parse(data).root; } catch (e) { continue; }
    for (const n of root.walk()) {
      const t = n.attrs.get('texture');
      if (t) refs.add(donorlib.normTex(t));
    }
  }
  return refs;
}

/** Метка файла донора: по ней видно, что лаунчер его обновил. */
function stamp(file) {
  try {
    const s = fs.statSync(file);
    return { size: s.size, mtime: s.mtime.toISOString() };
  } catch (e) {
    return null;
  }
}

/**
 * @param {object} o
 * @param {string} o.src   папка официального клиента
 * @param {string} o.dest  куда положить импорт (заменяется целиком)
 * @param {import('./client').Client} [o.client] клиент пользователя — для карт
 * @param {(msg: string) => void} [o.progress]
 * @returns {object} паспорт импорта
 */
function run(o) {
  const say = o.progress || (() => {});
  const src = new donorlib.Donor(o.src);
  if (src.imported) throw new Error('это уже импорт, а не клиент');
  const chk = src.check();
  if (!chk.ok) throw new Error('это не клиент Aion: не хватает ' + chk.missing.join(', '));

  /** Относительный путь пака донора -> записи к переносу. */
  const want = new Map();
  const add = (abs, entry) => {
    const rel = path.relative(o.src, abs).split(path.sep).join('/');
    if (!want.has(rel)) want.set(rel, new Set());
    want.get(rel).add(entry);
  };
  const whole = (abs) => { for (const e of pak.listPak(abs).entries) add(abs, e.name); };

  say('библиотеки скинов');
  const preloadAbs = donorlib.findCI(o.src, 'data/ui/preload/preload.pak');
  whole(preloadAbs);
  const uiAbs = donorlib.findCI(o.src, 'data/ui/ui.pak');
  if (uiAbs) {
    for (const e of pak.listPak(uiAbs).entries) if (/^ui_preload\.xml$/i.test(e.name)) add(uiAbs, e.name);
  }

  const langs = src.languages();
  for (const l of langs) {
    const f = donorlib.findCI(o.src, 'l10n/' + l + '/data/data.pak');
    if (!f) continue;
    say('окна интерфейса, язык ' + l);
    for (const e of pak.listPak(f).entries) if (/^ui\/.*\.xml$/i.test(e.name)) add(f, e.name);
  }

  say('атласы');
  const refs = textureRefs(src);
  let found = 0;
  for (const l of langs.length ? langs : ['']) {
    const finder = src.finder(l);
    for (const t of refs) {
      const loc = finder.resolve(t);
      if (loc) { add(loc.pak, loc.entry); found++; }
    }
  }
  say(`атласов по ссылкам скинов: ${refs.size}, найдено ${found}`);

  let maps = null;
  if (o.client) {
    say('карты: сравниваю с твоим клиентом — минуту-другую');
    const p = mapslib.plan(o.client, src);
    for (const t of p.tiles) add(t.from.pak, t.from.entry);
    maps = { tiles: p.tiles.length, zones: p.zones.filter((z) => z.replace).map((z) => z.zone) };
    say(`карты: тайлов ${maps.tiles}${maps.zones.length ? ' (' + maps.zones.join(', ') + ')' : ''}`);
  }

  // пишем во временную папку и меняем разом: полуимпорт хуже старого импорта
  const tmp = o.dest + '.part';
  fs.rmSync(tmp, { recursive: true, force: true });
  let entries = 0;
  let bytes = 0;
  let n = 0;
  for (const [rel, names] of want) {
    say(`перекладываю ${++n}/${want.size}: ${rel}`);
    const abs = path.join(o.src, rel.split('/').join(path.sep));
    const raw = pak.readRaw(abs, src.dll, [...names]);
    // порядок — как в паке донора: так проще сравнивать с оригиналом
    const files = new Map([...names].filter((x) => raw.has(x)).map((x) => [x, raw.get(x)]));
    const out = path.join(tmp, rel.split('/').join(path.sep));
    pak.writePak(out, files);
    entries += files.size;
    bytes += fs.statSync(out).size;
  }

  const info = {
    format: FORMAT,
    source: path.resolve(o.src),
    importedAt: new Date().toISOString(),
    languages: langs,
    // обновление клиента лаунчером меняет эти файлы
    stamps: {
      preload: stamp(preloadAbs),
      dll: stamp(donorlib.findCI(o.src, 'bin64/crysystem.dll')),
    },
    paks: want.size,
    entries,
    bytes,
    textures: refs.size,
    maps,
    client: o.client ? path.resolve(o.client.root) : null,
  };
  fs.writeFileSync(path.join(tmp, donorlib.MANIFEST), JSON.stringify(info, null, 2), 'utf8');

  fs.rmSync(o.dest, { recursive: true, force: true });
  fs.renameSync(tmp, o.dest);
  say(`готово: паков ${info.paks}, записей ${entries}, ${(bytes / 1e6).toFixed(0)} МБ`);
  return info;
}

/**
 * Устарел ли импорт: лаунчер обновил официальный клиент. Нет клиента на
 * месте — не устарел (импорт для того и нужен, чтобы жить без него).
 */
function stale(info) {
  if (!info || !info.source || !fs.existsSync(info.source)) return false;
  const now = stamp(donorlib.findCI(info.source, 'data/ui/preload/preload.pak'));
  const was = info.stamps && info.stamps.preload;
  return !!(now && was && (now.size !== was.size || now.mtime !== was.mtime));
}

module.exports = { run, stale, textureRefs, FORMAT };
