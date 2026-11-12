'use strict';
/**
 * Пресеты — сохранённые наборы всех настроек: интерфейс, портрет, бафы, шрифт,
 * иконки, цифры, карты. Переключение в пару кликов, обмен файлом.
 *
 * Пресет — папка в userData/presets/<id>:
 *   preset.json — { id, name, description, created, updated, profile }
 *   files/      — копии всех файлов, на которые ссылается профиль (свои
 *                 картинки, подготовленные DDS, шрифт). Копии — потому что
 *                 рабочие файлы программа переписывает, а пресет меняться не должен.
 *
 * Включить пресет — его файлы копируются в userData/staged/preset, пути в
 * профиле переписываются туда. Рабочий профиль никогда не ссылается на папку
 * пресета: пресет можно удалить или пересохранить, не сломав текущие настройки.
 *
 * Файл обмена (.aionpreset) — zip: preset.json с путями вида files/<имя> и сами
 * файлы.
 *
 * Что относится к компьютеру, а не к пресету, — не сохраняется и при
 * включении остаётся как было: папки официального клиента и его импорта,
 * язык, мастер.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const pak = require('./pak');

const MACHINE = [['classic', 'root'], ['classic', 'source'], ['lang'], ['wizard']];
const EXT = '.aionpreset';
const FILE_REF = /^files\/[^/\\]+$/;

const isAbs = (s) => typeof s === 'string' && /^([a-z]:[\\/]|\\\\|\/\/)/i.test(s) && !/[\r\n]/.test(s);
const clone = (o) => JSON.parse(JSON.stringify(o));

/** Обход всех строк профиля с заменой: fn(строка) -> новая строка | undefined (не менять). */
function mapStrings(v, fn) {
  if (typeof v === 'string') {
    const r = fn(v);
    return r === undefined ? v : r;
  }
  if (Array.isArray(v)) return v.map((x) => mapStrings(x, fn));
  if (v && typeof v === 'object') {
    const out = {};
    for (const [k, x] of Object.entries(v)) out[k] = mapStrings(x, fn);
    return out;
  }
  return v;
}

/** Профиль без того, что относится к компьютеру. */
function strip(profile) {
  const p = clone(profile || {});
  for (const keys of MACHINE) {
    let o = p;
    for (let i = 0; i < keys.length - 1 && o; i++) o = o[keys[i]];
    if (o) delete o[keys[keys.length - 1]];
  }
  return p;
}

/** Вернуть в профиль пресета то, что относится к компьютеру, из текущего. */
function keepMachine(profile, current) {
  const p = clone(profile);
  for (const keys of MACHINE) {
    let src = current;
    for (const k of keys) src = src == null ? undefined : src[k];
    if (src === undefined) continue;
    let o = p;
    for (let i = 0; i < keys.length - 1; i++) o = o[keys[i]] = o[keys[i]] || {};
    o[keys[keys.length - 1]] = src;
  }
  return p;
}

class Presets {
  /** @param {string} userDir userData программы */
  constructor(userDir) {
    this.root = path.join(userDir, 'presets');
    this.active = path.join(userDir, 'staged', 'preset');
    this._hash = new Map(); // путь -> { key, sum }
  }

  dir(id) {
    if (!/^[a-z0-9-]+$/i.test(String(id))) throw new Error('плохой id пресета');
    return path.join(this.root, id);
  }

  read(id) {
    try {
      return JSON.parse(fs.readFileSync(path.join(this.dir(id), 'preset.json'), 'utf8'));
    } catch (e) {
      return null;
    }
  }

  /** Список без профилей — для меню. */
  list() {
    if (!fs.existsSync(this.root)) return [];
    return fs.readdirSync(this.root)
      .map((id) => { try { return this.read(id); } catch (e) { return null; } })
      .filter(Boolean)
      .map(({ id, name, description, created, updated, sum }) => ({ id, name, description, created, updated, sum }))
      .sort((a, b) => String(a.name).localeCompare(String(b.name), 'ru'));
  }

  /** Сумма файла по содержимому (кэш по времени и размеру). */
  fileSum(file) {
    let st;
    try { st = fs.statSync(file); } catch (e) { return 'missing'; }
    const key = st.size + ':' + st.mtimeMs;
    const got = this._hash.get(file);
    if (got && got.key === key) return got.sum;
    const sum = crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex');
    this._hash.set(file, { key, sum });
    return sum;
  }

  /**
   * Отпечаток настроек: профиль без машинного, пути заменены суммами файлов.
   * Совпал — пресет не изменён, сколько бы раз файлы ни переложили.
   */
  fingerprint(profile, base) {
    const norm = mapStrings(strip(profile), (s) => {
      const abs = base && FILE_REF.test(s) ? path.join(base, s) : s;
      if (isAbs(abs) && fs.existsSync(abs) && fs.statSync(abs).isFile()) return 'file:' + this.fileSum(abs);
      return undefined;
    });
    return crypto.createHash('sha1').update(JSON.stringify(norm)).digest('hex');
  }

  /**
   * Сохранить текущий профиль: новый пресет (id не задан) или поверх.
   * @returns {object} запись пресета без профиля
   */
  save(profile, { id, name, description }) {
    const old = id ? this.read(id) : null;
    if (id && !old) throw new Error('нет такого пресета');
    const pid = id || Date.now().toString(36) + '-' + crypto.randomBytes(3).toString('hex');
    const dir = this.dir(pid);
    const tmp = path.join(this.root, pid + '.tmp');
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.mkdirSync(path.join(tmp, 'files'), { recursive: true });

    // файлы — копиями в files/, в профиле — относительные ссылки
    const names = new Map();
    const used = new Set();
    const p = mapStrings(strip(profile), (s) => {
      if (!isAbs(s) || !fs.existsSync(s) || !fs.statSync(s).isFile()) return undefined;
      if (names.has(s)) return names.get(s);
      let base = path.basename(s).replace(/[^\w.\-]+/g, '_');
      for (let n = 2; used.has(base.toLowerCase()); n++) base = path.basename(s).replace(/[^\w.\-]+/g, '_').replace(/(\.[^.]*)?$/, `_${n}$1`);
      used.add(base.toLowerCase());
      fs.copyFileSync(s, path.join(tmp, 'files', base));
      names.set(s, 'files/' + base);
      return 'files/' + base;
    });
    const now = new Date().toISOString();
    const rec = {
      id: pid,
      name: String(name || (old && old.name) || 'Без названия').trim().slice(0, 80),
      description: String(description != null ? description : (old && old.description) || '').trim().slice(0, 600),
      created: (old && old.created) || now,
      updated: now,
      profile: p,
    };
    rec.sum = this.fingerprint(rec.profile, tmp);
    fs.writeFileSync(path.join(tmp, 'preset.json'), JSON.stringify(rec, null, 2), 'utf8');
    fs.rmSync(dir, { recursive: true, force: true });
    fs.renameSync(tmp, dir);
    const { profile: _, ...meta } = rec;
    return meta;
  }

  /** Поменять только название и описание. */
  rename(id, { name, description }) {
    const rec = this.read(id);
    if (!rec) throw new Error('нет такого пресета');
    if (name != null) rec.name = String(name).trim().slice(0, 80) || rec.name;
    if (description != null) rec.description = String(description).trim().slice(0, 600);
    fs.writeFileSync(path.join(this.dir(id), 'preset.json'), JSON.stringify(rec, null, 2), 'utf8');
    return true;
  }

  remove(id) {
    fs.rmSync(this.dir(id), { recursive: true, force: true });
    return true;
  }

  /**
   * Профиль для включения: файлы пресета — в staged/preset, пути — туда,
   * машинные настройки — из текущего.
   */
  apply(id, current) {
    const rec = this.read(id);
    if (!rec) throw new Error('нет такого пресета');
    const src = this.dir(id);
    fs.rmSync(this.active, { recursive: true, force: true });
    fs.mkdirSync(this.active, { recursive: true });
    const p = mapStrings(rec.profile, (s) => {
      if (!FILE_REF.test(s)) return undefined;
      const from = path.join(src, s);
      if (!fs.existsSync(from)) return '';
      const to = path.join(this.active, path.basename(s));
      if (!fs.existsSync(to)) fs.copyFileSync(from, to);
      return to;
    });
    return keepMachine(p, current || {});
  }

  /** Отличается ли текущий профиль от пресета. */
  changed(id, profile) {
    const rec = id ? this.read(id) : null;
    if (!rec) return null;
    return this.fingerprint(profile) !== (rec.sum || this.fingerprint(rec.profile, this.dir(id)));
  }

  /** В файл обмена. */
  exportTo(id, file) {
    const rec = this.read(id);
    if (!rec) throw new Error('нет такого пресета');
    const files = new Map([['preset.json', Buffer.from(JSON.stringify(rec, null, 2), 'utf8')]]);
    const fdir = path.join(this.dir(id), 'files');
    if (fs.existsSync(fdir)) for (const f of fs.readdirSync(fdir)) files.set('files/' + f, fs.readFileSync(path.join(fdir, f)));
    pak.writePak(file, files);
    return file;
  }

  /**
   * Из файла обмена — новым пресетом (имя занято — с номером). Чужой файл —
   * данные, не доверяем: только files/<имя> без путей, абсолютные пути из
   * чужого профиля выкидываются.
   */
  importFrom(file) {
    const m = pak.readPak(file);
    const raw = m.get('preset.json');
    if (!raw) throw new Error('это не файл пресета: нет preset.json');
    let rec;
    try { rec = JSON.parse(raw.toString('utf8')); } catch (e) { throw new Error('файл пресета повреждён'); }
    if (!rec || typeof rec.profile !== 'object' || !rec.profile) throw new Error('в файле нет настроек');
    const have = new Set(this.list().map((x) => x.name));
    let name = String(rec.name || path.basename(file, EXT)).trim().slice(0, 80) || 'Пресет';
    for (let n = 2, b = name; have.has(name); n++) name = `${b} (${n})`;

    const pid = Date.now().toString(36) + '-' + crypto.randomBytes(3).toString('hex');
    const dir = this.dir(pid);
    fs.mkdirSync(path.join(dir, 'files'), { recursive: true });
    for (const [k, v] of m) {
      if (FILE_REF.test(k) && !/^files\/\.\.?$/.test(k)) fs.writeFileSync(path.join(dir, k), v);
    }
    const profile = mapStrings(strip(rec.profile), (s) => {
      if (FILE_REF.test(s)) return fs.existsSync(path.join(dir, s)) ? s : '';
      return isAbs(s) ? '' : undefined;
    });
    const now = new Date().toISOString();
    const out = {
      id: pid, name,
      description: String(rec.description || '').slice(0, 600),
      created: now, updated: now, profile,
    };
    out.sum = this.fingerprint(profile, dir);
    fs.writeFileSync(path.join(dir, 'preset.json'), JSON.stringify(out, null, 2), 'utf8');
    const { profile: _, ...meta } = out;
    return meta;
  }
}

module.exports = { Presets, EXT, strip, keepMachine, mapStrings };
