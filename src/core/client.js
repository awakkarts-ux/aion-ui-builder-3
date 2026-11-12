'use strict';
/**
 * Клиент игры: где что лежит, резервные копии и запись изменённых паков.
 *
 * Правило одно: исходником для правки всегда служит резервная копия, а не то,
 * что сейчас в игре. Иначе повторное применение профиля накладывалось бы на
 * уже пропатченный файл и изменения копились бы друг на друге.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const pak = require('./pak');
const { relativePath } = require('./safe');

/** Паки, которые мы правим. Ключ — как на него ссылается профиль. */
const PAKS = {
  hud_s1: 'data/ui/game_hud_s1/game_hud_s1.pak',
  hud_s2: 'data/ui/game_hud_s2/game_hud_s2.pak',
  game: 'data/ui/game/game.pak',
  ui: 'data/ui/ui.pak',
  preload: 'data/ui/preload/preload.pak',
};

/**
 * Те же диалоги лежат ВТОРОЙ раз в локализованном паке под префиксом `UI/`,
 * и клиент читает именно их — правки в `data/ui/*` он игнорирует. Проверено:
 * после записи только в data/ui интерфейс в игре не сдвинулся, а копия в
 * l10n осталась со штатными координатами.
 */
const L10N_PREFIX = {
  ui: 'UI/',
  game: 'UI/game/',
  hud_s1: 'UI/game_hud_s1/',
  hud_s2: 'UI/game_hud_s2/',
  preload: 'UI/preload/',
};
const L10N_PAK = 'l10n/{lang}/data/data.pak';

const FONT_PAK = 'l10n/{lang}/data/Fonts/fonts.pak';

/**
 * Наборы картинок, которые программа умеет подменять.
 *
 * Одна и та же картинка нередко лежит в нескольких паках сразу: `v4_common.dds`
 * есть и в `textures/ui/ui.pak`, и в локализованном `textures.pak`, и в
 * пользовательском паке-перебивалке. Кто из них выигрывает — зависит от порядка
 * монтирования, и надёжно мы его не знаем.
 *
 * Поэтому копии НЕ схлопываются: каждая показывается своей строкой с указанием
 * пака. Так видно, что именно правишь, и можно заменить хоть все копии — вместо
 * того чтобы угадывать приоритет и снова промахнуться, как это вышло с
 * диалогами в `data/ui`.
 *
 * Каждый пак правим НА МЕСТЕ через patchPak.
 */
const PACKS = {
  skills: {
    title: 'Иконки умений',
    size: 64, // все иконки одного размера
    // серые двойники в списке не показываем, но в описи держим: их пишет
    // раздел «Иконки умений» вместе с цветными (skillicons.make)
    hide: /_gray\.dds$/i,
    sources: [{ rel: 'data/skills/skills.pak', prefix: '' }],
  },
  items: {
    title: 'Иконки предметов',
    size: 64,
    // в паке ещё таблицы предметов и копии иконок умений — берём только icon_*
    sources: [{ rel: 'data/items/items.pak', prefix: '', only: /^icon_[^/]*\.dds$/i }],
  },
  hitnum: {
    title: 'Цифры урона',
    size: 0, // размер у каждой записи свой, берём у оригинала
    sources: [
      { rel: 'l10n/{lang}/textures/textures.pak', prefix: 'UI/hit_number/' },
      { rel: 'textures/ui/hit_number/hit_number.pak', prefix: '' },
    ],
  },
  uiatlas: {
    title: 'Картинки интерфейса',
    size: 0,
    sources: [
      // локализованные версии (радар, подложка карты) перекрывают общие
      { rel: 'l10n/{lang}/textures/textures.pak', prefix: 'UI/', only: /^[^/]+\.dds$/i },
      // свои паки-перебивалки в той же папке: позже по имени — сильнее.
      // Пак с атласами официального Classic сборка пересобирает каждый раз
      // сама — править его здесь бессмысленно, поэтому в список не берём.
      { dir: 'textures/ui', except: /^(ui|zz_classic_look|zz_builder)\.pak$/i, prefix: '' },
      { rel: 'textures/ui/ui.pak', prefix: '' },
    ],
  },
};

/** Пак-перебивалка из ранних версий: при откате её надо убрать. */
const LEGACY_ICON_PAK = 'data/skills/zz_custom_icons.pak';

/** Атласы, привезённые из клиента-донора (см. donor.js). Свой файл, без резерва. */
const DONOR_PAK = 'textures/ui/zz_classic_look.pak';

/** Картинки, нарисованные самой программой (квадратная мини-карта и т. п.). Свой файл, без резерва. */
const BUILDER_PAK = 'textures/ui/zz_builder.pak';

class Client {
  /**
   * @param {string} root путь к папке classic
   * @param {string} backupDir куда складывать оригиналы
   */
  constructor(root, backupDir) {
    this.root = root;
    this.backupDir = backupDir;
    this.cache = new Map();
  }

  abs(rel) {
    return relativePath(this.root, String(rel).replace(/\//g, path.sep), 'client path');
  }

  get dll() {
    return this.abs('bin64/crysystem.dll');
  }

  /** Похоже ли это на клиент Aion Classic и чего не хватает. */
  check() {
    const need = ['bin64/crysystem.dll', 'data/ui/ui.pak', 'data/ui/game/game.pak'];
    const missing = need.filter((r) => !fs.existsSync(this.abs(r)));
    return { ok: missing.length === 0, missing };
  }

  backupPath(rel) {
    return path.join(this.backupDir, rel.replace(/[\/\\]/g, '__'));
  }

  /** Копирует файл в резерв, если копии ещё нет. Возвращает путь к оригиналу. */
  ensureBackup(rel) {
    const src = this.abs(rel);
    const bak = this.backupPath(rel);
    if (!fs.existsSync(bak)) {
      if (!fs.existsSync(src)) return null;
      fs.mkdirSync(this.backupDir, { recursive: true });
      fs.copyFileSync(src, bak);
    }
    return bak;
  }

  hasBackup(rel) {
    return fs.existsSync(this.backupPath(rel));
  }

  /** Есть ли такой пак в клиенте: наборы s1/s2 встречаются не во всех сборках. */
  has(key) {
    const rel = PAKS[key];
    return !!rel && (this.hasBackup(rel) || fs.existsSync(this.abs(rel)));
  }

  /** Содержимое пака в исходном, непропатченном виде. */
  original(key) {
    const rel = PAKS[key];
    if (!rel) throw new Error('неизвестный пак: ' + key);
    if (this.cache.has(key)) return this.cache.get(key);
    const from = this.hasBackup(rel) ? this.backupPath(rel) : this.abs(rel);
    const files = pak.readPak(from, this.dll);
    this.cache.set(key, files);
    return files;
  }

  /**
   * Подменяет в штатном паке только названные записи.
   *
   * Раньше пак пересобирался целиком, и файл получался хоть и рабочим, но
   * отличным от оригинала во всех записях сразу. Точечная правка оставляет всё
   * остальное байт-в-байт — проверено: пересборка без изменений даёт файл,
   * идентичный исходному.
   * @param {Map<string, Buffer>} changes
   */
  writePak(key, changes) {
    const rel = PAKS[key];
    this.ensureBackup(rel);
    return pak.patchPak(this.backupPath(rel), this.abs(rel), changes, this.dll);
  }

  /** Языки, в чьих паках есть такая запись: какой из них читает клиент — неизвестно. */
  langsWith(name) {
    return this.languages().filter((l) => {
      const f = this.pristine(this.l10nRel(l));
      if (!fs.existsSync(f)) return false;
      try {
        return pak.readDirectory(fs.readFileSync(f)).entries.some((e) => e.name === name);
      } catch (e) {
        return false;
      }
    });
  }

  /** Путь к локализованному паку — главному источнику интерфейса. */
  l10nRel(lang) {
    return L10N_PAK.replace('{lang}', lang || 'rus');
  }

  hasL10n(lang) {
    return fs.existsSync(this.abs(this.l10nRel(lang)));
  }

  /** `hud_s1/radar_dialog.xml` -> `UI/game_hud_s1/radar_dialog.xml`. */
  l10nName(pakKey, entry) {
    const prefix = L10N_PREFIX[pakKey];
    return prefix ? prefix + entry : null;
  }

  /** Читает из локализованного пака только нужные записи, всегда из оригинала. */
  l10nRead(lang, names) {
    const rel = this.l10nRel(lang);
    const from = this.hasBackup(rel) ? this.backupPath(rel) : this.abs(rel);
    return pak.readSome(from, this.dll, names);
  }

  /**
   * Подменяет в локализованном паке только названные записи.
   * Пак на 119 МБ и 22 тысячи файлов, поэтому остальное копируется байтами.
   */
  l10nWrite(lang, changes) {
    const rel = this.l10nRel(lang);
    if (!fs.existsSync(this.abs(rel))) return 0;
    this.ensureBackup(rel);
    return pak.patchPak(this.backupPath(rel), this.abs(rel), changes, this.dll);
  }

  /**
   * Пишет во ВСЕ языковые паки, где такие записи есть.
   *
   * Какой из них читает клиент, мы не знаем: `l10n/rus`, `l10n/enu` и
   * `l10n/chs` содержат одни и те же диалоги. Вместо того чтобы угадывать
   * приоритет — правим везде, где запись вообще встречается.
   * @param {Map<string, Buffer>} changes
   */
  l10nWriteAll(changes) {
    const done = [];
    for (const lang of this.languages()) {
      const rel = this.l10nRel(lang);
      const file = this.pristine(rel);
      if (!fs.existsSync(file)) continue;
      let names;
      try {
        names = new Set(pak.readDirectory(fs.readFileSync(file)).entries.map((e) => e.name));
      } catch (e) { continue; }
      const mine = new Map([...changes].filter(([n]) => names.has(n)));
      if (!mine.size) continue;
      const n = this.l10nWrite(lang, mine);
      done.push({ lang, count: n });
    }
    return done;
  }

  // ---- наборы картинок -------------------------------------------------

  pack(id) {
    const p = PACKS[id];
    if (!p) throw new Error('неизвестный набор картинок: ' + id);
    return p;
  }

  /**
   * Источник может быть одним паком или целой папкой. Для папки паки
   * возвращаются в обратном алфавитном порядке: клиент монтирует их по имени,
   * и то, что сортируется позже, перебивает предыдущее — на этом держится
   * приём с именем на `zz`.
   */
  expandSource(s, lang) {
    if (s.rel) return [s.rel.replace('{lang}', lang || 'rus')];
    const dir = this.abs(s.dir);
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
      .filter((f) => /\.pak$/i.test(f) && !(s.except && s.except.test(f)))
      .sort((a, b) => b.localeCompare(a))
      .map((f) => s.dir + '/' + f);
  }

  /** Источник — всегда нетронутый пак, чтобы видеть оригиналы, а не свои правки. */
  pristine(rel) {
    return this.hasBackup(rel) ? this.backupPath(rel) : this.abs(rel);
  }

  /**
   * Опись набора: ключ `пак|запись` -> где картинка лежит и как её показать.
   * Ключ включает пак, потому что одноимённые копии живут в разных паках и
   * схлопывать их нельзя.
   */
  packIndex(id, lang) {
    const p = this.pack(id);
    const cacheKey = id + '|' + (lang || 'rus');
    if (!this._packIndex) this._packIndex = new Map();
    if (this._packIndex.has(cacheKey)) return this._packIndex.get(cacheKey);

    const rows = [];
    for (const s of p.sources) {
      for (const rel of this.expandSource(s, lang)) {
        const file = this.pristine(rel);
        if (!fs.existsSync(file)) continue;
        let entries;
        try { entries = pak.readDirectory(fs.readFileSync(file)).entries; } catch (e) { continue; }
        for (const e of entries) {
          if (s.prefix && !e.name.startsWith(s.prefix)) continue;
          const short = e.name.slice((s.prefix || '').length);
          if (!short || short.endsWith('/')) continue;
          if (s.only && !s.only.test(short)) continue;
          if (p.skip && p.skip.test(short)) continue;
          rows.push({ key: rel + '|' + e.name, rel, entry: e.name, short });
        }
      }
    }
    // одноимённые копии держим рядом, чтобы разницу было видно сразу
    rows.sort((a, b) =>
      a.short.toLowerCase().localeCompare(b.short.toLowerCase()) || a.rel.localeCompare(b.rel));
    const index = new Map(rows.map((r) => [r.key, r]));
    this._packIndex.set(cacheKey, index);
    return index;
  }

  /** Сколько паков содержат запись с таким же именем — чтобы отметить копии. */
  packTwins(id, lang) {
    const count = new Map();
    for (const r of this.packIndex(id, lang).values()) {
      const low = r.short.toLowerCase();
      count.set(low, (count.get(low) || 0) + 1);
    }
    return count;
  }

  hasPack(id, lang) {
    return this.packIndex(id, lang).size > 0;
  }

  /** Строки описи для окна: ключ, короткое имя, пак и признак копии. */
  packRows(id, lang) {
    const twins = this.packTwins(id, lang);
    const hide = this.pack(id).hide;
    return [...this.packIndex(id, lang).values()].filter((r) => !(hide && hide.test(r.short))).map((r) => ({
      key: r.key,
      short: r.short,
      pak: r.rel,
      twin: twins.get(r.short.toLowerCase()) > 1,
    }));
  }

  /** @returns {Map<ключ, Buffer>} */
  packRead(id, lang, keys) {
    const index = this.packIndex(id, lang);
    const byPak = new Map();
    for (const k of keys) {
      const loc = index.get(k);
      if (!loc) continue;
      if (!byPak.has(loc.rel)) byPak.set(loc.rel, []);
      byPak.get(loc.rel).push(loc);
    }
    const out = new Map();
    for (const [rel, locs] of byPak) {
      const data = pak.readSome(this.pristine(rel), this.dll, locs.map((x) => x.entry));
      for (const loc of locs) {
        if (data.has(loc.entry)) out.set(loc.key, data.get(loc.entry));
      }
    }
    return out;
  }

  /**
   * Раскладывает правки набора по настоящим пакам.
   * @param {Map<ключ, Buffer>} changes
   * @param {Map<string, Map<string, Buffer>>} into общая корзина «пак -> записи»
   */
  packStage(id, lang, changes, into) {
    const index = this.packIndex(id, lang);
    let n = 0;
    for (const [key, data] of changes) {
      const loc = index.get(key);
      if (!loc) continue;
      if (!into.has(loc.rel)) into.set(loc.rel, new Map());
      into.get(loc.rel).set(loc.entry, data);
      n++;
    }
    return n;
  }

  /**
   * Записывает накопленные правки: каждый пак ровно один раз.
   * Иначе второй заход в тот же пак затрёт первый — он ведь начинает с
   * резервной копии. Наборы «Цифры урона» и «Картинки интерфейса» как раз
   * делят между собой локализованный `textures.pak`.
   * @param {Map<string, Map<string, Buffer>>} byRel
   */
  writeByRel(byRel) {
    let total = 0;
    const paks = [];
    for (const [rel, map] of byRel) {
      this.ensureBackup(rel);
      total += pak.patchPak(this.backupPath(rel), this.abs(rel), map, this.dll);
      paks.push(rel);
    }
    return { count: total, paks };
  }

  fontPakPath(lang) {
    return this.abs(FONT_PAK.replace('{lang}', lang || 'rus'));
  }

  /** Языки, для которых в клиенте есть папка l10n. */
  languages() {
    const dir = this.abs('l10n');
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  }

  /** Всё, что сборка может переписать, — чтобы проверить занятость заранее. */
  writeTargets(lang) {
    const out = Object.values(PAKS).map((rel) => this.abs(rel));
    out.push(this.abs(this.l10nRel(lang)));
    out.push(this.abs(DONOR_PAK));
    out.push(this.abs(BUILDER_PAK));
    for (const l of this.languages()) out.push(this.fontPakPath(l));
    for (const id of Object.keys(PACKS)) {
      for (const s of PACKS[id].sources) {
        for (const rel of this.expandSource(s, lang)) out.push(this.abs(rel));
      }
    }
    return [...new Set(out)];
  }

  /**
   * Снимок живых файлов для одной сборки. Он нужен для автоматического
   * rollback, если запись одного из следующих паков завершится ошибкой.
   * Резерв пользователя хранит исходник клиента, а этот снимок хранит
   * состояние непосредственно перед текущей попыткой сборки.
   */
  beginTransaction(lang) {
    const targets = new Set(this.writeTargets(lang));
    for (const l of this.languages()) targets.add(this.abs(this.l10nRel(l)));

    const collect = (dir) => {
      if (!fs.existsSync(dir)) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const abs = path.join(dir, entry.name);
        if (entry.isDirectory()) collect(abs);
        else if (/\.pak$/i.test(entry.name)) targets.add(abs);
      }
    };
    collect(this.abs('textures/ui/newmap'));
    collect(this.abs('textures/ui/zonemap'));

    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'aionui-build-'));
    const files = [];
    try {
      for (const abs of targets) {
        const existed = fs.existsSync(abs);
        const copy = path.join(temp, String(files.length));
        if (existed) fs.copyFileSync(abs, copy);
        files.push({ abs, copy, existed });
      }
    } catch (error) {
      fs.rmSync(temp, { recursive: true, force: true });
      throw error;
    }

    let closed = false;
    const cleanup = () => {
      if (closed) return;
      closed = true;
      fs.rmSync(temp, { recursive: true, force: true });
    };
    return {
      commit: cleanup,
      rollback: () => {
        if (closed) return;
        for (const file of files) {
          if (file.existed) {
            fs.mkdirSync(path.dirname(file.abs), { recursive: true });
            fs.copyFileSync(file.copy, file.abs);
          } else if (fs.existsSync(file.abs)) {
            fs.rmSync(file.abs, { force: true });
          }
        }
        cleanup();
      },
    };
  }

  /** Все резервные копии: имя файла — это путь, где `__` вместо разделителя. */
  backups() {
    if (!fs.existsSync(this.backupDir)) return [];
    return fs.readdirSync(this.backupDir).map((f) => ({
      file: path.join(this.backupDir, f),
      rel: f.split('__').join('/'),
    }));
  }

  /** Возвращает всё как было: паки из резерва, наши файлы — удалить. */
  restoreAll() {
    const done = [];
    for (const { file, rel } of this.backups()) {
      fs.copyFileSync(file, this.abs(rel));
      done.push(rel);
    }
    for (const lang of this.languages()) {
      const f = this.fontPakPath(lang);
      if (fs.existsSync(f)) { fs.unlinkSync(f); done.push(path.relative(this.root, f)); }
    }
    for (const rel of [LEGACY_ICON_PAK, DONOR_PAK, BUILDER_PAK]) {
      const f = this.abs(rel);
      if (fs.existsSync(f)) { fs.unlinkSync(f); done.push(rel); }
    }
    this.cache.clear();
    return done;
  }

  /** Список того, что сейчас подменено. */
  status() {
    const rows = [];
    for (const { file, rel } of this.backups()) {
      const a = fs.statSync(file).size;
      const b = fs.existsSync(this.abs(rel)) ? fs.statSync(this.abs(rel)).size : -1;
      rows.push({ key: rel, rel, patched: a !== b, backup: file });
    }
    for (const lang of this.languages()) {
      const f = this.fontPakPath(lang);
      if (fs.existsSync(f)) rows.push({ key: 'font:' + lang, rel: path.relative(this.root, f), patched: true });
    }
    if (fs.existsSync(this.abs(LEGACY_ICON_PAK))) {
      rows.push({ key: 'legacy', rel: LEGACY_ICON_PAK, patched: true });
    }
    if (fs.existsSync(this.abs(DONOR_PAK))) {
      rows.push({ key: 'classic', rel: DONOR_PAK, patched: true });
    }
    if (fs.existsSync(this.abs(BUILDER_PAK))) {
      rows.push({ key: 'builder', rel: BUILDER_PAK, patched: true });
    }
    return rows;
  }
}

module.exports = { Client, PAKS, PACKS, DONOR_PAK, BUILDER_PAK };
