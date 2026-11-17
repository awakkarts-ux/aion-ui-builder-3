'use strict';
/**
 * Выгрузка для дизайна (17.11.2026) — один zip со всем, что нужно, чтобы
 * рисовать новый интерфейс по точной сетке клиента: устройство окон HUD,
 * опись всех скинов (имя → атлас и прямоугольники) и атласы картинками.
 *
 * Свой клиент читается из резерва (то есть штатный вид, без наших правок).
 * Если импортирован официальный Classic — его окна HUD, скины и атласы
 * кладутся рядом в classic/. Клиент только читается.
 *
 * Внутри архива:
 *   README.txt
 *   own/windows/<пак>/<окно>.xml       окна HUD и основные окна, читаемый XML
 *   own/skins.csv                      все скины: библиотека, категория, имя, тип, атлас, прямоугольники
 *   own/atlases/<атлас>.png            атласы v4_*
 *   classic/windows/…, classic/skins.csv, classic/atlases/…  — то же у официального
 */

const pak = require('./pak');
const bxml = require('./bxml');
const dds = require('./dds');
const png = require('./png');
const skins = require('./skins');

/** Окна, по которым идёт редизайн HUD (остальные окна тоже кладём — они маленькие). */
const GAME_RE = /(target|party|force|status|pet|exp|quick|basic|buff|radar|chat|inventory|cube|skill|tooltip|msgbox|system_menu)/i;

const csvq = (s) => '"' + String(s).replace(/"/g, '""') + '"';

function skinsCsv(libs) {
  const rows = ['lib,category,name,type,atlas,texture,rects'];
  for (const { lib, list } of libs) {
    for (const s of list) {
      rows.push([csvq(lib), csvq(s.category), csvq(s.name), s.type, s.atlas, csvq(s.texture), csvq(JSON.stringify(s.rects))].join(','));
    }
  }
  return Buffer.from('﻿' + rows.join('\n'), 'utf8');
}

function toXml(buf) {
  return Buffer.from(bxml.isBxml(buf) ? bxml.parse(buf).root.toXml() : buf.toString('utf8'), 'utf8');
}

function ddsPng(raw) {
  const img = dds.toRgba(raw);
  return png.encode(img.width, img.height, img.rgba);
}

/**
 * @param {import('./client').Client} client
 * @param {{lang?: string, donor?: object|null, outFile: string, log?: (s: string) => void}} o
 * @returns {{file: string, windows: number, skins: number, atlases: number, classic: object|null}}
 */
function run(client, o) {
  const say = o.log || (() => {});
  const lang = o.lang || 'rus';
  const out = new Map();
  const res = { file: o.outFile, windows: 0, skins: 0, atlases: 0, classic: null, problems: [] };
  const tryIt = (what, fn) => { try { fn(); } catch (e) { res.problems.push(what + ': ' + e.message); } };

  // --- свои окна: data/ui/* и их копии в локализованном паке (их и читает игра)
  for (const key of ['hud_s1', 'hud_s2', 'game']) {
    if (!client.has(key)) continue;
    tryIt('окна ' + key, () => {
      const files = client.original(key);
      const names = [...files.keys()].filter((n) => /\.xml$/i.test(n) && (key !== 'game' || GAME_RE.test(n)));
      for (const n of names) {
        out.set(`own/windows/${key}/${n}`, toXml(files.get(n)));
        res.windows++;
      }
      const l10nNames = names.map((n) => client.l10nName(key, n)).filter(Boolean);
      const loc = client.l10nRead(lang, l10nNames);
      for (const [n, buf] of loc) out.set(`own/windows/l10n_${lang}/${n}`, toXml(buf));
    });
  }
  say(`выгрузка: окон ${res.windows}`);

  // --- свои скины
  tryIt('скины', () => {
    const files = client.original('preload');
    const libs = [];
    for (const [k, buf] of files) {
      if (!/\.xml$/i.test(k)) continue;
      try { libs.push({ lib: k, list: skins.list(buf, k) }); } catch (e) { /* не библиотека скинов */ }
      if (/ui_preload/i.test(k)) out.set('own/preload/' + k, toXml(buf));
    }
    out.set('own/skins.csv', skinsCsv(libs));
    res.skins = libs.reduce((n, l) => n + l.list.length, 0);
  });
  say(`выгрузка: скинов ${res.skins}`);

  // --- свои атласы v4_* (штатные, из резерва)
  tryIt('атласы', () => {
    const rows = [...client.packIndex('uiatlas', lang).values()].filter((r) => /^v4_\w+\.dds$/i.test(r.short));
    const seen = new Set();
    const keys = rows.filter((r) => !seen.has(r.short.toLowerCase()) && seen.add(r.short.toLowerCase())).map((r) => r.key);
    const raw = client.packRead('uiatlas', lang, keys);
    for (const [key, buf] of raw) {
      const name = key.split('|').pop().replace(/\.dds$/i, '');
      try { out.set(`own/atlases/${name}.png`, ddsPng(buf)); res.atlases++; } catch (e) { res.problems.push('атлас ' + name); }
    }
  });
  say(`выгрузка: атласов ${res.atlases}`);

  // --- официальный Classic, если импортирован
  if (o.donor) {
    const cl = { windows: 0, skins: 0, atlases: 0 };
    tryIt('Classic', () => {
      const d = o.donor;
      const dialogs = d.dialogs(lang);
      const wanted = [...dialogs.keys()].filter((n) => /game_hud_s\d\//.test(n) || GAME_RE.test(n));
      const used = new Set();
      for (const n of wanted) {
        const root = dialogs.get(n);
        out.set('classic/windows/' + n, Buffer.from(root.toXml(), 'utf8'));
        for (const node of root.walk()) for (const v of node.attrs.values()) used.add(v);
        cl.windows++;
      }
      const libs = [];
      for (const [k, buf] of d.preload()) {
        if (!/\.xml$/i.test(k)) continue;
        try { libs.push({ lib: k, list: skins.list(buf, k) }); } catch (e) { /* не библиотека */ }
      }
      out.set('classic/skins.csv', skinsCsv(libs));
      cl.skins = libs.reduce((n, l) => n + l.list.length, 0);
      // атласы, на которые смотрят скины этих окон
      const textures = new Set();
      for (const { list } of libs) for (const s of list) if (used.has(s.name) && s.texture) textures.add(s.texture);
      const finder = d.finder(lang);
      const locs = new Map();
      for (const t of textures) { const loc = finder.resolve(t); if (loc) locs.set(t, loc); }
      for (const [t, buf] of finder.readMany(locs)) {
        const name = String(t).replace(/\\/g, '/').split('/').pop();
        try { out.set(`classic/atlases/${name}.png`, ddsPng(buf)); cl.atlases++; } catch (e) { res.problems.push('атлас Classic ' + name); }
      }
    });
    res.classic = cl;
    say(`выгрузка: Classic — окон ${cl.windows}, скинов ${cl.skins}, атласов ${cl.atlases}`);
  }

  out.set('README.txt', Buffer.from([
    'Выгрузка Aion UI Builder для дизайна интерфейса.',
    `Язык: ${lang}. Окон: ${res.windows}, скинов: ${res.skins}, атласов: ${res.atlases}.`,
    res.classic ? `Официальный Classic: окон ${res.classic.windows}, скинов ${res.classic.skins}, атласов ${res.classic.atlases}.` : 'Официальный Classic не импортирован.',
    res.problems.length ? 'Проблемы: ' + res.problems.join('; ') : 'Проблем нет.',
    '',
    'Пришлите этот файл в чат с Claude целиком.',
  ].join('\r\n'), 'utf8'));

  pak.writePak(o.outFile, out);
  return res;
}

module.exports = { run };
