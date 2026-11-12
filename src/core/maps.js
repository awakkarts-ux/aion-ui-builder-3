'use strict';
/**
 * Перерисованные карты из клиента-донора (большая карта — textures/ui/newmap,
 * мини-карта — textures/ui/zonemap).
 *
 * «Перерисовано по CRC» — не значит «можно заменить». Из ~3 400 таких тайлов
 * официального клиента:
 *   — треть — та же картинка, иначе пережатая;
 *   — половина — ДРУГАЯ МЕСТНОСТЬ под тем же именем зоны (lc1: у нас озеро,
 *     у официального — застройка; dc1 — скалы против корней). Мир игрок видит
 *     из своих файлов уровней, и такая карта с ним не совпадёт;
 *   — остальное — перекраска той же планировки (tiamat_down теплее и с
 *     подсветкой).
 * Поэтому тайлы сравниваются по структуре — корреляция яркости 32×32,
 * нечувствительная к перекраске, — и зона меняется только ЦЕЛИКОМ и только
 * если в ней нет ни одного тайла другой местности: иначе вышло бы лоскутное
 * одеяло из старой и новой карты.
 */

const fs = require('fs');
const path = require('path');
const pak = require('./pak');
const dds = require('./dds');
const donorlib = require('./donor');

const SUBS = [
  { dir: 'textures/ui/newmap', title: 'большая карта' },
  { dir: 'textures/ui/zonemap', title: 'мини-карта' },
];
/** Пикселей другого цвета меньше этой доли — картинка та же. */
const SAME_PCT = 1;
/** Корреляция структуры выше — та же планировка. */
const SAME_LAYOUT = 0.9;

function walk(d, o = []) {
  if (!d || !fs.existsSync(d)) return o;
  for (const n of fs.readdirSync(d)) {
    const p = path.join(d, n);
    if (fs.statSync(p).isDirectory()) walk(p, o);
    else if (/\.pak$/i.test(n)) o.push(p);
  }
  return o;
}

/**
 * Тайлы клиента: ключ «папка пака/запись» -> где лежит.
 * @param {(abs: string) => string} [source] откуда читать (у своего — резерв)
 */
function index(root, sub, source) {
  const m = new Map();
  const base = donorlib.findCI(root, sub);
  for (const p of walk(base)) {
    let es;
    try { es = pak.listPak(source ? source(p) : p).entries; } catch (e) { continue; }
    for (const e of es) {
      if (!/\.dds$/i.test(e.name)) continue;
      const k = (path.relative(base, path.dirname(p)).split(path.sep).join('/') + '/' + e.name).toLowerCase();
      m.set(k, { pak: p, entry: e.name, crc: e.crc });
    }
  }
  return m;
}

/** Яркость 32×32, нормированная: корреляция не замечает перекраску. */
function signature(img) {
  const N = 32;
  const v = new Float64Array(N * N);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      let s = 0, c = 0;
      const x0 = Math.floor(x * img.width / N), x1 = Math.floor((x + 1) * img.width / N);
      const y0 = Math.floor(y * img.height / N), y1 = Math.floor((y + 1) * img.height / N);
      for (let yy = y0; yy < y1; yy += 2) {
        for (let xx = x0; xx < x1; xx += 2) {
          const i = (yy * img.width + xx) * 4;
          s += 0.3 * img.rgba[i] + 0.59 * img.rgba[i + 1] + 0.11 * img.rgba[i + 2];
          c++;
        }
      }
      v[y * N + x] = c ? s / c : 0;
    }
  }
  let m = 0;
  for (const a of v) m += a;
  m /= v.length;
  let sd = 0;
  for (const a of v) sd += (a - m) ** 2;
  sd = Math.sqrt(sd / v.length) || 1;
  return v.map((a) => (a - m) / sd);
}

const correlation = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s / a.length; };

function pctDiff(a, b) {
  let d = 0;
  for (let i = 0; i < a.rgba.length; i += 4) {
    if (Math.abs(a.rgba[i] - b.rgba[i]) > 12 || Math.abs(a.rgba[i + 1] - b.rgba[i + 1]) > 12 ||
        Math.abs(a.rgba[i + 2] - b.rgba[i + 2]) > 12) d++;
  }
  return d / (a.rgba.length / 4) * 100;
}

/** Читает записи пачками по пакам: открывать пак на каждый тайл — долго. */
function readAll(locs, dll, source) {
  const byPak = new Map();
  for (const x of locs) {
    if (!byPak.has(x.pak)) byPak.set(x.pak, []);
    byPak.get(x.pak).push(x);
  }
  const out = new Map();
  for (const [p, xs] of byPak) {
    const data = pak.readSome(source ? source(p) : p, dll, xs.map((x) => x.entry));
    for (const x of xs) out.set(x, data.get(x.entry));
  }
  return out;
}

const cache = new Map();

/**
 * Что заменить. Считается минуту-другую (тысячи тайлов), поэтому
 * запоминается на время работы программы.
 * @param {import('./client').Client} client
 * @param {donorlib.Donor} donor
 */
function plan(client, donor) {
  const key = client.root + '|' + donor.root;
  if (cache.has(key)) return cache.get(key);
  const rel = (abs) => path.relative(client.root, abs).split(path.sep).join('/');
  const ourSource = (abs) => client.pristine(rel(abs));

  const zones = [];
  const tiles = []; // { rel, entry, from: {pak, entry} }
  for (const sub of SUBS) {
    const ours = index(client.root, sub.dir, ourSource);
    const theirs = index(donor.root, sub.dir);
    const keys = [...theirs.keys()].filter((k) => ours.has(k) && ours.get(k).crc !== theirs.get(k).crc);
    const a = readAll(keys.map((k) => ours.get(k)), client.dll, ourSource);
    const b = readAll(keys.map((k) => theirs.get(k)), donor.dll);

    const byZone = new Map();
    for (const k of keys) {
      const zone = k.replace(/^\/+/, '').split('/')[0];
      if (!byZone.has(zone)) byZone.set(zone, { zone, sub: sub.title, same: 0, take: [], other: 0 });
      const z = byZone.get(zone);
      let ia, ib;
      try { ia = dds.toRgba(a.get(ours.get(k))); ib = dds.toRgba(b.get(theirs.get(k))); } catch (e) { z.other++; continue; }
      if (ia.width !== ib.width || ia.height !== ib.height) { z.other++; continue; }
      if (pctDiff(ia, ib) <= SAME_PCT) { z.same++; continue; }
      if (correlation(signature(ia), signature(ib)) > SAME_LAYOUT) z.take.push(k);
      else z.other++;
    }
    for (const z of byZone.values()) {
      const ok = z.other === 0 && z.take.length > 0;
      zones.push({ zone: z.zone, sub: z.sub, take: z.take.length, same: z.same, other: z.other, replace: ok });
      if (!ok) continue;
      for (const k of z.take) {
        const o = ours.get(k);
        tiles.push({ rel: rel(o.pak), entry: o.entry, from: theirs.get(k) });
      }
    }
  }
  zones.sort((x, y) => Number(y.replace) - Number(x.replace) || (y.take + y.other) - (x.take + x.other));
  const result = { zones, tiles };
  cache.set(key, result);
  return result;
}

/**
 * Раскладывает замену по нашим пакам — в общую корзину «пак -> записи»,
 * которую сборка пишет одним проходом.
 * @returns {number} сколько тайлов
 */
function stage(p, donor, into) {
  const data = readAll(p.tiles.map((t) => t.from), donor.dll);
  let n = 0;
  for (const t of p.tiles) {
    const raw = data.get(t.from);
    if (!raw) continue;
    if (!into.has(t.rel)) into.set(t.rel, new Map());
    into.get(t.rel).set(t.entry, raw);
    n++;
  }
  return n;
}

/** Импорт донора переписан на месте — его прежний план больше не годится. */
const clearCache = () => cache.clear();

module.exports = { plan, stage, clearCache, SUBS };
