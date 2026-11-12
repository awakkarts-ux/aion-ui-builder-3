'use strict';
/**
 * Предпросмотр редактора: окна такими, какими их нарисует игра.
 *
 * Берёт итог сборки в памяти (build.apply с dry) — окна, библиотеки скинов и
 * атласы после всех слоёв (вид 5.x, официальный Classic, окна HUD, ручные
 * правки) — и превращает окно в плоский список того, что рисовать: куски
 * атласов в абсолютных координатах окна и тексты. Рисует окно программы
 * (canvas), здесь только геометрия и данные.
 *
 * Это не снимок игры: то, что рисует код (портреты, 3D, предметы в ячейках,
 * списки с данными), здесь не появится; раскладка и скины — из файлов.
 */

const bxml = require('./bxml');
const pak = require('./pak');
const dds = require('./dds');
const skins = require('./skins');
const arrange = require('./arrange');
const elementsLib = require('./elements');

/** Какой кусок пресета рисовать в покое: первое найденное состояние. */
const { REST_STATES } = elementsLib;

/**
 * Где стоят окна HUD «Стиля Aion» (s1) — правила из arrange.js, в единицах
 * файла (экран / SCALE). Остальные окна — по своей рамке из файла.
 */
const BUFFS_RIGHT_PX = 731;
const DEBUFFS_LEFT_PX = 1188;

/**
 * Шрифты текста — как у игры: шейдер из Fonts/fontshader.xml локали (гарнитура,
 * размер, цвет). Виджет называет шейдер атрибутом font; без него кнопки и
 * вкладки берут свой, остальное — default. В русском клиенте это Calibri и
 * Myriad Pro 12 px, файлы шрифтов лежат рядом в том же паке.
 */
const FONT_SHADERS = 'Fonts/fontshader.xml';
const TYPE_FONT = { button: 'v3_button', tabbutton: 'v3_tab' };
const TITLE_FONT = 'v3_title_name';

const attrsOf = (s) => {
  const out = {};
  for (const m of String(s).matchAll(/([\w:]+)\s*=\s*"([^"]*)"/g)) out[m[1]] = m[2];
  return out;
};

const colorOf = (s, def) => {
  if (!s) return def;
  const p = String(s).split(',').map(Number);
  if (p.length < 3 || p.some(Number.isNaN)) return def;
  return p.slice(0, 4).map((v, i) => (i < 3 ? Math.round(Math.max(0, Math.min(1, v)) * 255) : v));
};

class Scene {
  /**
   * @param {import('./client').Client} client
   * @param {string} lang
   * @param {object} dry report.dry из build.apply
   * @param {{w: number, h: number}} screen экран в px
   * @param {string} set набор HUD: s1 | s2
   */
  constructor(client, lang, dry, screen, set) {
    this.client = client;
    this.lang = lang;
    this.dry = dry;
    this.set = set || 's1';
    this.screen = { w: screen.w / arrange.SCALE, h: screen.h / arrange.SCALE };
    this.strings = elementsLib.readStrings(client, lang);
    this._libs = null;
    this._dialogs = new Map();
    this._atlases = new Map();
    this._index = null;
  }

  /** Окно после сборки: переведённая копия (её читает игра), иначе data/ui. */
  dialogData(id) {
    const cut = id.indexOf('/');
    const key = id.slice(0, cut);
    const entry = id.slice(cut + 1);
    const l10nName = this.client.l10nName(key, entry);
    if (l10nName && this.dry.l10n.has(l10nName)) return this.dry.l10n.get(l10nName);
    const pak = this.dry.paks.get(key);
    if (pak && pak.has(entry)) return pak.get(entry);
    if (l10nName) {
      const got = this.client.l10nRead(this.lang, [l10nName]).get(l10nName);
      if (got) return got;
    }
    return this.client.has(key) ? this.client.original(key).get(entry) || null : null;
  }

  /** Все окна четырёх паков после сборки — для каталога элементов. */
  allDialogs() {
    const out = new Map();
    for (const key of elementsLib.DIALOG_PAKS) {
      if (!this.client.has(key)) continue;
      for (const entry of this.client.original(key).keys()) {
        if (!/\.xml$/i.test(entry)) continue;
        const id = key + '/' + entry;
        const pak = this.dry.paks.get(key);
        const l10nName = this.client.l10nName(key, entry);
        out.set(id, (l10nName && this.dry.l10n.get(l10nName)) || (pak && pak.get(entry)) ||
          this.client.original(key).get(entry));
      }
    }
    return out;
  }

  /** Библиотеки скинов после сборки. */
  libs() {
    if (this._libs) return this._libs;
    const out = new Map(this.client.original('preload'));
    const done = this.dry.paks.get('preload');
    if (done) for (const [k, v] of done) out.set(k, v);
    this._libs = out;
    return out;
  }

  /** Шейдеры шрифтов локали: имя -> {face, size, color}. */
  fontShaders() {
    if (this._shaders) return this._shaders;
    const out = new Map();
    let raw = null;
    try { raw = this.client.l10nRead(this.lang, [FONT_SHADERS]).get(FONT_SHADERS); } catch (e) { /* нет — шрифт по умолчанию */ }
    const add = (shader, a) => {
      if (!shader || !a.name || out.has(shader.toLowerCase())) return;
      const c = String(a.color || '').split(',').map(Number);
      out.set(shader.toLowerCase(), {
        face: a.name,
        size: Math.abs(parseInt(a.logical_size, 10)) || 12,
        color: c.length >= 3 && !c.some(Number.isNaN) ? [c[0], c[1], c[2], (c[3] == null ? 255 : c[3]) / 255] : null,
      });
    };
    if (raw && bxml.isBxml(raw)) {
      let cur = null;
      for (const n of bxml.parse(raw).root.walk()) {
        if (n.name === 'fontshader') cur = n.attrs.get('name');
        else if (n.name === 'font') add(cur, Object.fromEntries(n.attrs));
      }
    } else if (raw) {
      const t = raw[0] === 0xff && raw[1] === 0xfe ? raw.toString('utf16le') : raw.toString('utf8');
      for (const m of t.matchAll(/<fontshader\b([^>]*)>\s*<font\b([^>]*)>/gi)) add(attrsOf(m[1]).name, attrsOf(m[2]));
    }
    this._shaders = out;
    return out;
  }

  /** Файл шрифта гарнитуры из пака локали (Calibri -> Fonts/CALIBRI.TTF). */
  fontFile(face) {
    const want = String(face || '').toLowerCase();
    if (!this._fontNames) {
      this._fontNames = new Map();
      try {
        for (const e of pak.listPak(this.client.pristine(this.client.l10nRel(this.lang))).entries) {
          const m = /^fonts\/([^/]+)\.(ttf|otf)$/i.exec(e.name);
          if (m) this._fontNames.set(m[1].toLowerCase(), e.name);
        }
      } catch (e) { /* нет пака — без шрифтов игры */ }
    }
    const entry = this._fontNames.get(want);
    if (!entry) return null;
    return this.client.l10nRead(this.lang, [entry]).get(entry) || null;
  }

  /** Скины и пресеты по имени (как в каталоге: первая библиотека главная). */
  index() {
    if (this._index) return this._index;
    const cat = elementsLib.build({ libs: this.libs(), dialogs: new Map(), strings: this.strings });
    const presets = new Map();
    for (const e of cat.elements) if (e.id.startsWith('p:')) presets.set(e.tech, e);
    this._index = { skins: cat.skinByName, presets };
    return this._index;
  }

  /** Как рисовать скин: атлас, тип, прямоугольники. */
  skinDraw(name) {
    const row = this.index().skins.get(name);
    if (!row) return null;
    return { skin: name, atlas: row.atlas, texture: row.texture, nine: row.nine, rects: row.rects };
  }

  /** Кусок пресета «в покое»: рамка, фон, обычная кнопка. */
  presetRest(name, prefer) {
    const p = this.index().presets.get(name);
    if (!p) return null;
    const by = new Map(p.states.map((s) => [s.state, s.skin]));
    const st = (prefer && by.has(prefer) && prefer) || REST_STATES.find((s) => by.has(s)) || p.states[0].state;
    return { el: p.id, state: st, draw: this.skinDraw(by.get(st)), kind: p.kind, gauge: by.get('gauge') || null };
  }

  /**
   * Окно — в список того, что рисовать.
   * @returns {{id, x, y, w, h, ops: object[]}|null}
   */
  /**
   * @param {string} id окно
   * @param {string} [variant] контейнер варианта (цель: вид моба)
   * @param {Object<string, number>} [tabs] набор вкладок -> номер показанной страницы
   */
  window(id, variant, tabs) {
    const data = this.dialogData(id);
    if (!data) return null;
    const root = bxml.parse(data).root;
    const dlg = root.name === 'Dialog' ? root : [...root.walk()].find((n) => n.name === 'Dialog');
    if (!dlg) return null;
    const f = Object.assign({ x: 0, y: 0, w: 100, h: 100 }, dlg.getFrame());
    // окно с вариантами: игра показывает один контейнер — его и рисуем, вверху окна
    const vars = elementsLib.VARIANTS[id] || [];
    const varNames = new Set(vars.map((v) => v[0]));
    const pick = varNames.has(variant) ? variant : (vars[0] || [])[0];
    const shift = new Map(); // контейнер варианта -> сдвиг к верху окна
    if (pick) {
      const c = dlg.kids.find((k) => k.attrs.get('name') === pick);
      const cf = c && c.getFrame();
      if (cf) {
        shift.set(pick, { x: -cf.x, y: -cf.y });
        f.w = Math.max(f.w, cf.w);
        f.h = Math.max(cf.h, ...dlg.kids.filter((k) => k.name === 'Widget' && !varNames.has(k.attrs.get('name')))
          .map((k) => (k.getFrame() ? k.getFrame().y + k.getFrame().h : 0)));
      }
    }
    const ops = [];
    // окна бафов: пустые ячейки игра не рисует — без бафов окна не видно
    const noSlots = /_buff(_status)?$/.test(dlg.attrs.get('type') || '');
    const str = (k) => (k && this.strings.get(String(k).toLowerCase())) || '';

    const pushDraw = (d, x, y, w, h, el, widget, extra) => {
      if (!d || !d.draw) return;
      ops.push(Object.assign({ op: 'skin', x, y, w, h, el, widget, state: d.state || '' }, d.draw, extra));
    };
    const shaders = this.fontShaders();
    const text = (n, x, y, w, h, s, center, defShader) => {
      if (!s) return;
      const sh = shaders.get(String(n.attrs.get('font') || defShader || 'default').toLowerCase()) ||
        shaders.get('default') || {};
      ops.push({
        op: 'text', x, y, w, h, text: s,
        color: colorOf(n.attrs.get('text_color'), sh.color || [255, 255, 255, 1]),
        face: sh.face || '',
        size: Math.abs(parseInt(n.attrs.get('font_size'), 10)) || sh.size || 12,
        align: center ? 'center' : (n.attrs.get('halign') || 'left'),
        valign: n.attrs.get('valign') || 'middle',
        outline: n.attrs.get('text_outline') === 'True',
      });
    };

    // рамка окна
    const dp = dlg.attrs.get('preset');
    if (dp) pushDraw(this.presetRest(dp), 0, 0, f.w, f.h, 'p:' + dp, '', { frame: true });
    const title = str(dlg.attrs.get('title_text'));
    if (title) {
      const tf = (dlg.attrs.get('title_frame') || '').split(',').map(Number);
      const th = tf.length === 4 && tf[3] > 0 ? tf[3] + 8 : 24;
      text(dlg, 0, 2, f.w, th, title, true, TITLE_FONT);
    }

    // вкладки: показываем одну страницу, её кнопка — «выбрана» (второй режим кнопки)
    const hiddenPages = new Set();
    const selButtons = new Set();
    const sheets = [];
    for (const n of dlg.walk()) {
      if (n.name !== 'Widget' || n.attrs.get('type') !== 'tabsheet') continue;
      const t = elementsLib.tabsOf(n, str);
      if (!t) continue;
      const want = tabs && Number.isInteger(tabs[t.name]) ? tabs[t.name] : -1;
      const sel = t.pages[want] ? want : Math.max(0, t.pages.findIndex((p) => !p.hidden));
      t.pages.forEach((p, i) => {
        if (i !== sel) hiddenPages.add(p.node);
        else if (p.button) selButtons.add(p.button);
      });
      sheets.push({ name: t.name, sel, pages: t.pages.map((p) => ({ title: p.title, hidden: !!p.hidden })) });
    }

    const walk = (n, ox, oy) => {
      for (const k of n.kids) {
        if (hiddenPages.has(k)) continue;
        if (k.name !== 'Widget') continue;
        if (k.getFlags().includes('not_visible')) continue;
        const kf = k.getFrame();
        if (!kf) continue;
        const kname = k.attrs.get('name');
        if (n === dlg && varNames.has(kname) && kname !== pick) continue;
        const sh = n === dlg ? shift.get(kname) : null;
        const x = ox + kf.x + (sh ? sh.x : 0);
        const y = oy + kf.y + (sh ? sh.y : 0);
        const widget = k.attrs.get('name') || '';
        const type = k.attrs.get('type') || '';
        const pr = k.attrs.get('preset');
        if (pr) {
          const rest = this.presetRest(pr, selButtons.has(k) ? '1:up' : null);
          if (rest && !(noSlots && rest.kind === 'slot')) {
            pushDraw(rest, x, y, kf.w, kf.h, 'p:' + pr, widget);
            // полоса: заполнение на две трети — чтобы было видно, как выглядит
            if (rest.gauge) {
              pushDraw({ draw: this.skinDraw(rest.gauge), state: 'gauge' }, x, y, Math.round(kf.w * 0.66), kf.h, 'p:' + pr, widget);
            }
          }
        }
        for (const s of k.kids) {
          if (s.name !== 'Skin') continue;
          const nm = s.attrs.get('name');
          if (this.index().presets.has(nm)) pushDraw(this.presetRest(nm), x, y, kf.w, kf.h, 'p:' + nm, widget);
          else if (this.index().skins.has(nm)) pushDraw({ draw: this.skinDraw(nm) }, x, y, kf.w, kf.h, 's:' + nm, widget);
        }
        const t = str(k.attrs.get('text'));
        if (t && type !== 'editbox') text(k, x, y, kf.w, kf.h, t, type === 'button' || type === 'tabbutton', TYPE_FONT[type]);
        walk(k, x, y);
      }
    };
    walk(dlg, 0, 0);

    // кнопка закрытия: close_offset — от правого верхнего угла
    const cp = dlg.attrs.get('close_preset');
    if (cp && dlg.getFlags().includes('close')) {
      const rest = this.presetRest(cp);
      if (rest && rest.draw) {
        const r = rest.draw.rects.src_image || rest.draw.rects.src_middle_middle;
        const off = (dlg.attrs.get('close_offset') || '5,5').split(',').map(Number);
        pushDraw(rest, f.w - off[0] - r.w, off[1], r.w, r.h, 'p:' + cp, '(закрыть)');
      }
    }

    const pos = this.place(id, dlg, f);
    return { id, x: pos.x, y: pos.y, w: f.w, h: f.h, ops, variant: pick || null, variants: vars, tabs: sheets };
  }

  /** Место окна на экране предпросмотра (в единицах файла). */
  place(id, dlg, f) {
    const S = this.screen;
    const type = dlg.attrs.get('type') || '';
    // Окна HUD игра ставит сама даже без привязки (координаты файла не берёт,
    // проверено 03.10) — предпросмотр всегда по её правилам
    if (this.set === 's1') {
      const bottom = ['hud_s1/basic_status_dialog.xml', 'hud_s1/quickbar_dialog.xml',
        'hud_s1/start_dialog.xml', 'hud_s1/radar_dialog.xml'];
      if (bottom.includes(id) || id === 'hud_s1/exp_bar_dialog.xml') {
        const ws = bottom.map((b) => {
          const d = b === id ? f : this.frameOf(b);
          return d ? d.w : 0;
        });
        const total = ws.reduce((a, b) => a + b, 0) + 3 * 3;
        const left = S.w / 2 - total / 2;
        if (id === 'hud_s1/exp_bar_dialog.xml') return { x: left + f.x, y: S.h - f.h };
        const i = bottom.indexOf(id);
        const x = left + ws.slice(0, i).reduce((a, b) => a + b + 3, 0);
        return { x, y: S.h - f.h };
      }
      if (type === 'dlg_target') return { x: S.w / 2 - f.w / 2, y: f.y };
      if (type === 'dlg_buff_status') return { x: BUFFS_RIGHT_PX / arrange.SCALE - f.w, y: f.y };
      if (type === 'dlg_debuff_status') return { x: DEBUFFS_LEFT_PX / arrange.SCALE, y: f.y };
    }
    return { x: Math.max(0, Math.min(f.x, S.w - f.w)), y: Math.max(0, Math.min(f.y, S.h - f.h)) };
  }

  frameOf(id) {
    const data = this.dialogData(id);
    if (!data) return null;
    const root = bxml.parse(data).root;
    const dlg = root.name === 'Dialog' ? root : [...root.walk()].find((n) => n.name === 'Dialog');
    return dlg ? dlg.getFrame() : null;
  }

  /** Есть ли атлас в сборке — без чтения картинки (подбор вариантов замены). */
  hasAtlas(texture) {
    const key = skins.atlasKey(texture);
    const d = this.dry;
    if (d.atlases.has(key + '.dds') || d.made.has(key) || (d.shipLocs.has(key) && d.donor)) return true;
    if (!this._atlasNames) {
      this._atlasNames = new Set([...this.client.packIndex('uiatlas', this.lang).values()]
        .map((r) => r.short.toLowerCase().replace(/\.dds$/, '')));
    }
    return this._atlasNames.has(key);
  }

  /**
   * Атлас по имени из скина — в том виде, в каком его увидит игра: свои
   * картинки программы, атласы донора, подменённые, штатные.
   * @returns {{width, height, rgba: Buffer}|null}
   */
  atlas(texture) {
    const key = skins.atlasKey(texture);
    if (this._atlases.has(key)) return this._atlases.get(key);
    let raw = null;
    const d = this.dry;
    if (d.atlases.has(key + '.dds')) raw = d.atlases.get(key + '.dds');
    else if (d.made.has(key)) raw = d.made.get(key);
    else if (d.shipLocs.has(key) && d.donor) {
      raw = d.donor.readAtlases(new Map([[key, d.shipLocs.get(key)]]), this.lang).get(key) || null;
    } else {
      for (const row of this.client.packIndex('uiatlas', this.lang).values()) {
        if (row.short.toLowerCase().replace(/\.dds$/, '') !== key) continue;
        const staged = d.images.get(row.rel);
        raw = (staged && staged.get(row.entry)) ||
          this.client.packRead('uiatlas', this.lang, [row.key]).get(row.key) || null;
        if (raw) break;
      }
    }
    let img = null;
    if (raw) {
      try { img = dds.toRgba(raw); } catch (e) { img = null; }
    }
    this._atlases.set(key, img);
    return img;
  }
}

module.exports = { Scene, REST_STATES };
