'use strict';
/**
 * Свои карты: картинка пользователя вместо большой карты зоны (окно карты, M).
 *
 * Большая карта зоны — textures/ui/newmap/<зона>/<зона>.pak: квадратная сетка
 * тайлов 1024×1024 (Элизиум — 3×3) и обзорная <зона>_a.dds с подсветкой
 * районов. Тайлы идут ПО СТОЛБЦАМ: _000, _001, _002 — левый столбец сверху
 * вниз, затем следующий (проверено на lc1 — сборка по строкам даёт кашу).
 * У многоэтажных зон несколько сеток: ab1_1_000…, ab1_2_000… — «слой».
 *
 * Картинку режет окно программы (canvas), сюда приходят готовые тайлы RGBA:
 * пишутся в userData/staged/maps/<зона> как DDS A8R8G8B8 (несжатые игра
 * читает), пути — в profile.maps. Сборка кладёт их в пак зоны тем же
 * проходом, что и карты официального клиента, — после них, так что своя
 * карта главнее.
 *
 * Обзорную _a не трогаем: в её прозрачности — подсветка районов игры.
 */

const fs = require('fs');
const path = require('path');
const pak = require('./pak');
const dds = require('./dds');
const { assertImage, relativePath } = require('./safe');
const donorlib = require('./donor');

const NEWMAP = 'textures/ui/newmap';
const TILE_RE = /^(.+)_(\d{3})\.dds$/i;

/** Названия зон: STR_ZONE_NAME_<КОД> из строк локали. */
function zoneNames(client, lang) {
  const out = new Map();
  const files = ['Strings/client_strings_ui.xml', 'Strings/client_strings_etc.xml', 'Strings/client_strings_level.xml'];
  let got;
  try { got = client.l10nRead(lang, files); } catch (e) { return out; }
  for (const v of got.values()) {
    const t = v[0] === 0xff && v[1] === 0xfe ? v.toString('utf16le') : v.toString('utf8');
    for (const m of t.matchAll(/<name>STR_ZONE_NAME_([^<]+)<\/name>\s*<body>([^<]*)<\/body>/gi)) {
      const k = m[1].toLowerCase();
      if (!out.has(k)) out.set(k, m[2].split(';')[0].replace(/^\[PVP\]\s*/i, '').trim());
    }
  }
  return out;
}

/** Открытый мир — наверх списка; остальное — подземелья. */
const isWorld = (z) => /^(lc|dc|lf|df|ldf)\d|^ab1$|^underpass$|^tiamat_down$/i.test(z);

/**
 * Зоны с большой картой.
 * @returns {{zone, name, world, rel, layers: {key, prefix, grid, tile, entries: string[]}[]}[]}
 */
function zones(client, lang) {
  const base = donorlib.findCI(client.root, NEWMAP);
  if (!base) return [];
  const names = zoneNames(client, lang);
  const out = [];
  for (const dir of fs.readdirSync(base)) {
    const abs = path.join(base, dir);
    if (!fs.statSync(abs).isDirectory()) continue;
    const pk = fs.readdirSync(abs).find((n) => /\.pak$/i.test(n));
    if (!pk) continue;
    const rel = path.relative(client.root, path.join(abs, pk)).split(path.sep).join('/');
    let entries;
    try { entries = pak.listPak(client.pristine(rel)).entries.map((e) => e.name); } catch (e) { continue; }
    const groups = new Map();
    for (const e of entries) {
      const m = TILE_RE.exec(e);
      if (!m) continue;
      if (!groups.has(m[1])) groups.set(m[1], []);
      groups.get(m[1]).push(e);
    }
    const layers = [];
    for (const [prefix, list] of groups) {
      const grid = Math.round(Math.sqrt(list.length));
      if (grid * grid !== list.length) continue; // не квадрат — не карта зоны
      list.sort((a, b) => Number(TILE_RE.exec(a)[2]) - Number(TILE_RE.exec(b)[2]));
      layers.push({ key: dir.toLowerCase() + '/' + prefix.toLowerCase(), prefix, grid, tile: 0, entries: list });
    }
    if (!layers.length) continue;
    layers.sort((a, b) => a.prefix.localeCompare(b.prefix));
    // размер тайла — по заголовку первого
    try {
      const first = pak.readSome(client.pristine(rel), client.dll, [layers[0].entries[0]]).get(layers[0].entries[0]);
      const h = dds.readHeader(first);
      for (const l of layers) l.tile = h.width;
    } catch (e) { for (const l of layers) l.tile = 1024; }
    const zone = dir.toLowerCase();
    out.push({ zone, name: names.get(zone) || zone, world: isWorld(zone), rel, layers });
  }
  out.sort((a, b) => Number(b.world) - Number(a.world) || a.name.localeCompare(b.name, 'ru'));
  return out;
}

/** Слой по ключу «зона/префикс». */
function findLayer(list, key) {
  for (const z of list) for (const l of z.layers) if (l.key === key) return { zone: z, layer: l };
  return null;
}

/**
 * Родная карта слоя целиком, уменьшенная до size (для сравнения со своей).
 * @returns {{width, height, rgba: Buffer}}
 */
function preview(client, z, layer, size) {
  return compose(layer, pak.readSome(client.pristine(z.rel), client.dll, layer.entries), size);
}

/** Своя сохранённая карта слоя — из DDS в userData. */
function previewOwn(layer, tiles, size) {
  const raw = new Map();
  for (const e of layer.entries) {
    const f = tiles && tiles[e];
    if (f && fs.existsSync(f)) raw.set(e, fs.readFileSync(f));
  }
  return compose(layer, raw, size);
}

/** Тайлы (запись -> DDS) в одну картинку size×size, раскладка по столбцам. */
function compose(layer, raw, size) {
  const S = Math.max(64, Math.min(2048, size || 768));
  const cell = S / layer.grid;
  const out = Buffer.alloc(S * S * 4);
  layer.entries.forEach((e, i) => {
    const buf = raw.get(e);
    if (!buf) return;
    const img = dds.toRgba(buf);
    const ox = Math.floor(i / layer.grid) * cell; // по столбцам
    const oy = (i % layer.grid) * cell;
    for (let y = 0; y < cell; y++) {
      const sy = Math.floor(y * img.height / cell);
      for (let x = 0; x < cell; x++) {
        const sx = Math.floor(x * img.width / cell);
        const si = (sy * img.width + sx) * 4;
        const di = ((Math.floor(oy) + y) * S + Math.floor(ox) + x) * 4;
        out[di] = img.rgba[si]; out[di + 1] = img.rgba[si + 1]; out[di + 2] = img.rgba[si + 2]; out[di + 3] = 255;
      }
    }
  });
  return { width: S, height: S, rgba: out };
}

/** Тайл своей карты — DDS в userData. @returns {string} путь */
function stageTile(dir, layerKey, entry, width, height, rgba) {
  if (!/^[\w.-]+\.dds$/i.test(entry)) throw new Error('плохое имя тайла');
  const pixels = assertImage(width, height, rgba, 'map tile');
  const to = relativePath(dir, path.join(layerKey.replace(/[^\w/-]+/g, '_'), entry), 'map tile path');
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.writeFileSync(to, dds.fromRgba(width, height, pixels));
  return to;
}

/**
 * Свои карты из профиля — в общую корзину «пак -> записи».
 * @param {Object<string, {tiles: Object<string, string>}>} maps profile.maps
 * @returns {{tiles: number, zones: string[], missing: string[]}}
 */
function stage(client, lang, maps, into) {
  const res = { tiles: 0, zones: [], missing: [] };
  const keys = Object.keys(maps || {});
  if (!keys.length) return res;
  const list = zones(client, lang);
  for (const key of keys) {
    const hit = findLayer(list, key);
    const m = maps[key] || {};
    if (!hit) { res.missing.push(key); continue; }
    const files = new Map();
    for (const e of hit.layer.entries) {
      const f = m.tiles && m.tiles[e];
      if (!f || !fs.existsSync(f)) continue;
      files.set(e, fs.readFileSync(f));
    }
    if (files.size !== hit.layer.entries.length) { res.missing.push(key); continue; }
    if (!into.has(hit.zone.rel)) into.set(hit.zone.rel, new Map());
    for (const [e, raw] of files) into.get(hit.zone.rel).set(e, raw);
    res.tiles += files.size;
    res.zones.push(hit.zone.name + (hit.zone.layers.length > 1 ? ' (' + hit.layer.prefix + ')' : ''));
  }
  return res;
}

module.exports = { zones, findLayer, preview, previewOwn, stageTile, stage, NEWMAP };
