'use strict';

/*
 * Конструктор цифр урона. Рисует здесь же, в окне (шрифты и эффекты canvas),
 * и кладёт готовые картинки в набор hitnum — сборка пишет их как любые
 * подменённые картинки. Настройки — profile.hitnum; `staged` — подпись
 * настроек, из которых картинки уже подготовлены: разошлись — сборка
 * подготовит заново (hnEnsureStaged).
 *
 * Как устроены родные (замерено 27.09.2026): цифры 0–9 — 32×32 в восьми
 * цветах (серые — DXT3), курсивная антиква на всю высоту, по центру, с тёмной
 * тенью; плюс и минус — в семи цветах, без серого; надписи critical/block/
 * dodge/parry/resist — `_r` красные и `_w` жёлтые, прижаты вправо. Игрок
 * видит переведённые из l10n/<язык>/textures (248×76 и 268×76), корейские
 * 194×70 в hit_number.pak — вторая копия; пишем обе, каждую своего размера.
 *
 * Размер цифр (`scale`) и надписей (`plateScale`) — отдельно, до 250%: выше
 * HN_FIT растёт сама картинка (см. hnGrow).
 */

const HN_COLORS = [['white', 'белый'], ['yellow', 'жёлтый'], ['orange', 'оранжевый'], ['red', 'красный'],
  ['violet', 'фиолетовый'], ['blue', 'синий'], ['green', 'зелёный'], ['gray', 'серый']];
const HN_PLATES = [['critical', 'Крит!'], ['block', 'Блок!'], ['dodge', 'Уворот!'],
  ['parry', 'Парировано!'], ['resist', 'Отражено!']];
const HN_FAMILIES = ['Georgia', 'Times New Roman', 'Palatino Linotype', 'Cambria', 'Constantia',
  'Arial', 'Arial Black', 'Segoe UI', 'Trebuchet MS', 'Verdana', 'Impact', 'Consolas'];
const HN_CUSTOM = 'hn-custom';
const HN_COMPONENTS = [['digit:white','Обычный белый'],['digit:yellow','Обычный жёлтый'],['digit:orange','Обычный оранжевый'],['digit:red','Обычный красный'],['digit:violet','Обычный фиолетовый'],['digit:blue','Обычный синий'],['digit:green','Обычный зелёный'],['digit:gray','Обычный серый'],['sign:plus','Плюс'],['sign:minus','Минус'],['plate:critical','Крит'],['plate:block','Блок'],['plate:dodge','Уворот'],['plate:parry','Парирование'],['plate:resist','Отражение']];

const hn = {
  rows: null, // строки набора: { key, short, pak }
  sizes: new Map(), // ключ -> [w, h] родной картинки
  orig: new Map(), // ключ -> родная картинка (для «показать родные» и цветов)
  defColors: {}, // цвета родных цифр
  fontReady: '', // какой свой шрифт загружен
  icon: null, // ImageBitmap значка надписей
  iconFor: '',
};

function hnDefaults() {
  return {
    enabled: false, font: '', family: 'Georgia', italic: true, bold: true, scale: 100, plateScale: 100,
    colors: {}, scales: {},
    gradient: { on: false, color: '#ffffff', amount: 45 },
    outline: { width: 0, color: '#000000' },
    shadow: { dx: 1, dy: 1.5, blur: 0.5, color: '#000000', alpha: 75 },
    plates: { on: true, text: {}, r: '#d51f1f', w: '#ffe21a', icon: '' },
    staged: '', // подпись настроек, из которых подготовлены картинки
    keys: [], // какие картинки набора подготовил конструктор — только их и убираем
  };
}

const hnNormalized = new WeakSet();
/** Настройки из профиля, дополненные умолчаниями (один раз на объект). */
function hnState() {
  const p = state.profile.hitnum;
  if (p && hnNormalized.has(p)) return p;
  const d = hnDefaults();
  const s = Object.assign({}, d, p);
  // до 29.09.2026 размер был общий — надписи наследуют его
  if (p && !('plateScale' in p)) s.plateScale = s.scale;
  for (const k of ['gradient', 'outline', 'shadow', 'plates']) s[k] = Object.assign({}, d[k], p && p[k]);
  s.plates.text = Object.assign({}, s.plates.text);
  s.colors = Object.assign({}, s.colors);
  s.scales = Object.assign({}, s.scales);
  s.keys = Array.isArray(s.keys) ? s.keys : [];
  state.profile.hitnum = s;
  hnNormalized.add(s);
  return s;
}

/** Подпись настроек: что влияет на картинки. */
function hnSig(s) {
  const { enabled, staged, keys, ...rest } = s;
  return JSON.stringify(rest);
}

const hnColor = (s, c) => s.colors[c] || hn.defColors[c] || '#ffffff';
const hnComponentKey = (what) => what.kind === 'plate' ? `plate:${what.plate}` : `${what.kind}:${what.color || what.text}`;
const hnScale = (s, what) => s.scales[hnComponentKey(what)] || (what.kind === 'plate' ? s.plateScale : s.scale);
const hnComponentColor = (s, what) => what.kind === 'plate' ? (what.variant === 'r' ? s.plates.r : s.plates.w) : hnColor(s, what.color);
const hnPlateText = (s, p) => (p in s.plates.text ? s.plates.text[p] : (HN_PLATES.find((x) => x[0] === p) || [p, p])[1]);

/** Что за картинка: цифра, знак или надпись. */
function hnWhat(short) {
  const low = short.toLowerCase();
  let m = low.match(/^(\d)_([a-z]+)\.dds$/);
  if (m) return { kind: 'digit', text: m[1], color: m[2] };
  m = low.match(/^(plus|minus)_([a-z]+)\.dds$/);
  if (m) return { kind: 'sign', text: m[1] === 'plus' ? '+' : '−', color: m[2] };
  m = low.match(/^(critical|block|dodge|parry|resist)_([rw])\.dds$/);
  if (m) return { kind: 'plate', plate: m[1], variant: m[2] };
  return null;
}

/* ---------- рисование ---------- */

const hex2rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const mix = (a, b, t) => {
  const x = hex2rgb(a);
  const y = hex2rgb(b);
  return `rgb(${x.map((v, i) => Math.round(v + (y[i] - v) * t)).join(',')})`;
};
const rgba = (h, a) => `rgba(${hex2rgb(h).join(',')},${a})`;

function hnFamily(s) {
  return s.font && hn.fontReady === s.font ? `"${HN_CUSTOM}"` : `"${s.family}"`;
}
const hnFont = (s, px) => `${s.italic ? 'italic ' : ''}${s.bold ? 'bold ' : ''}${px}px ${hnFamily(s)}, serif`;
const hnPad = (s) => Math.ceil(s.outline.width + Math.max(Math.abs(s.shadow.dx), Math.abs(s.shadow.dy)) + s.shadow.blur) + 1;

/**
 * До HN_FIT% текст рисуется в родной картинке (как было всегда). Крупнее —
 * растим саму картинку в пропорциях родной, а текст в ней — впритык: на
 * 110% длинные надписи уже чуть вылезают за край. Что игра показывает
 * картинку крупнее родной в её размере — проверяется в игре.
 */
const HN_FIT = 110;
const hnGrow = (pct) => (pct > HN_FIT ? pct / 100 : 1);
const hnCanvas = ([w, h], pct) => [Math.round(w * hnGrow(pct)), Math.round(h * hnGrow(pct))];
/** Доля от «впритык» внутри (уже выращенной) картинки. */
const hnFill = (pct) => pct / 100 / hnGrow(pct);

const measureCtx = document.createElement('canvas').getContext('2d');

/** Рамка текста при 100 px: слева/справа от точки вывода, над/под базовой линией. */
function hnMeasure(s, text) {
  measureCtx.font = hnFont(s, 100);
  const m = measureCtx.measureText(text);
  return { l: m.actualBoundingBoxLeft, r: m.actualBoundingBoxRight,
    a: m.actualBoundingBoxAscent, d: m.actualBoundingBoxDescent };
}

/** Размер шрифта для цифр — общий на все, чтобы 1 не была крупнее 8. */
function hnDigitPx(s, w, h) {
  let hh = 0, ww = 0;
  for (const t of '0123456789') {
    const m = hnMeasure(s, t);
    hh = Math.max(hh, m.a + m.d);
    ww = Math.max(ww, m.l + m.r);
  }
  const pad = hnPad(s);
  return Math.max(4, Math.min((h - 2 * pad) / hh, (w - 2 * pad) / ww) * 100 * hnFill(s.scale));
}

/**
 * Один знак или надпись на прозрачном холсте w×h.
 * @param {'center'|'right'} align
 * @param {number} [fixedPx] размер шрифта (у цифр общий)
 */
function hnDraw(s, text, w, h, fill, align, fixedPx, icon) {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const g = cv.getContext('2d');
  const pad = hnPad(s);
  const m = hnMeasure(s, text);
  const iconGap = icon ? 0.15 : 0; // доля высоты текста между значком и текстом
  const textH = m.a + m.d;
  const iconW = icon ? (textH * 1.15) * (icon.width / icon.height) : 0;
  const fullW = m.l + m.r + (icon ? iconW + textH * iconGap : 0);
  const px = fixedPx || Math.max(4, Math.min((h - 2 * pad) / textH, (w - 2 * pad) / fullW) * 100 *
    (align === 'right' ? hnFill(s.plateScale) : 1));
  const k = px / 100;
  g.font = hnFont(s, px);
  g.textBaseline = 'alphabetic';
  // по вертикали — рамка знака по центру
  const y = (h - textH * k) / 2 + m.a * k;
  let x;
  if (align === 'right') x = w - pad - m.r * k;
  else x = (w - (m.l + m.r) * k) / 2 + m.l * k;

  if (icon) {
    const ih = textH * 1.15 * k;
    const iw = iconW * k;
    const ix = x - m.l * k - textH * iconGap * k - iw;
    g.drawImage(icon, ix, (h - ih) / 2, iw, ih);
  }

  const shape = (dx, dy) => {
    if (s.outline.width > 0) {
      g.lineJoin = 'round';
      g.lineWidth = s.outline.width * 2;
      g.strokeText(text, x + dx, y + dy);
    }
    g.fillText(text, x + dx, y + dy);
  };
  if (s.shadow.alpha > 0 && (s.shadow.dx || s.shadow.dy || s.shadow.blur)) {
    g.save();
    g.filter = s.shadow.blur ? `blur(${s.shadow.blur}px)` : 'none';
    g.fillStyle = g.strokeStyle = rgba(s.shadow.color, s.shadow.alpha / 100);
    shape(s.shadow.dx, s.shadow.dy);
    g.restore();
  }
  if (s.outline.width > 0) {
    g.lineJoin = 'round';
    g.lineWidth = s.outline.width * 2;
    g.strokeStyle = s.outline.color;
    g.strokeText(text, x, y);
  }
  if (s.gradient.on) {
    const gr = g.createLinearGradient(0, y - m.a * k, 0, y + m.d * k);
    gr.addColorStop(0, mix(fill, s.gradient.color, s.gradient.amount / 100));
    gr.addColorStop(1, fill);
    g.fillStyle = gr;
  } else {
    g.fillStyle = fill;
  }
  g.fillText(text, x, y);
  return g.getImageData(0, 0, w, h);
}

/** Все картинки набора по настройкам: ключ -> ImageData. */
/**
 * Общий размер шрифта надписей для холстов одной высоты: как у родных, буквы
 * «Блок!» и «Парировано!» одного роста — длинная надпись задаёт размер всем.
 */
function hnPlatePx(s, icon) {
  const pad = hnPad(s);
  const byH = new Map();
  for (const r of hn.rows) {
    const what = hnWhat(r.short);
    const size = hn.sizes.get(r.key);
    if (!what || what.kind !== 'plate' || !size) continue;
    const text = hnPlateText(s, what.plate);
    if (!text) continue;
    const [w, h] = hnCanvas(size, hnScale(s, { kind: 'plate', plate: what.plate }));
    const m = hnMeasure(s, text);
    const textH = m.a + m.d;
    const fullW = m.l + m.r + (icon ? textH * 1.15 * (icon.width / icon.height) + textH * 0.15 : 0);
    const px = Math.max(4, Math.min((h - 2 * pad) / textH, (w - 2 * pad) / fullW) * 100 * hnFill(s.plateScale));
    byH.set(h, Math.min(byH.get(h) || Infinity, px));
  }
  return byH;
}

function hnRenderAll(s) {
  const out = new Map();
  const digitPx = new Map(); // размер холста -> px
  const icon = s.plates.icon && hn.iconFor === s.plates.icon ? hn.icon : null;
  const platePx = s.plates.on ? hnPlatePx(s, icon) : new Map();
  for (const r of hn.rows) {
    const what = hnWhat(r.short);
    const size = hn.sizes.get(r.key);
    if (!what || !size) continue;
    if (what.kind === 'plate') {
      if (!s.plates.on) continue;
      const text = hnPlateText(s, what.plate);
      if (!text) continue;
      const [w, h] = hnCanvas(size, hnScale(s, { kind: 'plate', plate: what.plate }));
      out.set(r.key, hnDraw(s, text, w, h, what.variant === 'r' ? s.plates.r : s.plates.w, 'right',
        platePx.get(h), icon));
      continue;
    }
    const [w, h] = hnCanvas(size, hnScale(s, what));
    const sk = w + 'x' + h;
    if (!digitPx.has(sk)) digitPx.set(sk, hnDigitPx(s, w, h));
    out.set(r.key, hnDraw(s, what.text, w, h, hnComponentColor(s, what), 'center', digitPx.get(sk)));
  }
  return out;
}

/* ---------- данные ---------- */

async function hnLoad() {
  if (hn.rows || !state.ready) return !!hn.rows;
  const res = await guard(() => window.api.packs.list('hitnum', ''));
  if (!res) return false;
  const rows = res.rows.filter((r) => hnWhat(r.short));
  const imgs = [];
  for (let i = 0; i < rows.length; i += 60) {
    imgs.push(...((await guard(() => window.api.packs.images('hitnum', rows.slice(i, i + 60).map((r) => r.key)))) || []));
  }
  for (const img of imgs) {
    if (img.error) continue;
    hn.sizes.set(img.name, img.full || [img.width, img.height]);
    hn.orig.set(img.name, img);
  }
  hn.rows = rows.filter((r) => hn.sizes.has(r.key));
  // цвета родных: средний цвет заливки (светлая половина непрозрачных пикселей — без тени)
  for (const [c] of HN_COLORS) {
    const px = [];
    for (const r of hn.rows) {
      const w = hnWhat(r.short);
      if (!w || w.kind !== 'digit' || w.color !== c) continue;
      const im = hn.orig.get(r.key);
      for (let i = 0; i < im.rgba.length; i += 4) {
        if (im.rgba[i + 3] > 200) px.push([im.rgba[i], im.rgba[i + 1], im.rgba[i + 2]]);
      }
    }
    if (!px.length) continue;
    const lum = (p) => p[0] * 0.3 + p[1] * 0.59 + p[2] * 0.11;
    px.sort((a, b) => lum(b) - lum(a));
    const top = px.slice(0, Math.max(1, Math.floor(px.length * 0.4)));
    const avg = [0, 1, 2].map((i) => Math.round(top.reduce((t, p) => t + p[i], 0) / top.length));
    hn.defColors[c] = '#' + avg.map((v) => v.toString(16).padStart(2, '0')).join('');
  }
  return true;
}

async function hnEnsureFont(s) {
  if (!s.font || hn.fontReady === s.font) return;
  try {
    const url = 'file:///' + s.font.replace(/\\/g, '/').replace(/^\/+/, '');
    const face = new FontFace(HN_CUSTOM, `url("${url}")`);
    await face.load();
    document.fonts.add(face);
    hn.fontReady = s.font;
  } catch (e) {
    toast('шрифт не загрузился: ' + s.font, true);
  }
}

async function hnEnsureIcon(s, data) {
  const f = s.plates.icon;
  if (!f) { hn.icon = null; hn.iconFor = ''; return; }
  if (hn.iconFor === f && hn.icon) return;
  try {
    let blob;
    if (data) {
      const bin = atob(data);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      blob = new Blob([bytes]);
    } else {
      blob = await (await fetch('file:///' + f.replace(/\\/g, '/').replace(/^\/+/, ''))).blob();
    }
    hn.icon = await createImageBitmap(blob);
    hn.iconFor = f;
  } catch (e) {
    hn.icon = null;
    hn.iconFor = '';
  }
}

/* ---------- окно ---------- */

async function loadHitnum() {
  const s = hnState();
  hnFillForm(s);
  if (!state.ready) { hnSetState('клиент не выбран'); return; }
  hnSetState('читаю родные картинки…');
  if (!(await hnLoad())) { hnSetState('не удалось прочитать набор', 'bad'); return; }
  await hnEnsureFont(s);
  await hnEnsureIcon(s);
  hnFillForm(s);
  hnPreview();
  hnShowStaged();
}

function hnSetState(text, cls) {
  const st = $('#hn-state');
  st.className = 'state' + (cls ? ' ' + cls : '');
  st.textContent = text;
}

function hnShowStaged() {
  const s = hnState();
  if (!hn.rows) return;
  const n = hn.rows.filter((r) => packStore('hitnum')[r.key]).length;
  if (!s.enabled) hnSetState(n ? `подменено картинок: ${n} (вручную или раньше)` : 'выключено — в игре родные');
  else if (s.staged === hnSig(s) && n) hnSetState(`подготовлено ${n} картинок — пойдут в сборку`, 'ok');
  else hnSetState('настройки изменились — подготовлю при сборке или кнопкой ниже', 'warn');
}

const HN_RANGES = [
  ['#hn-scale', (s) => s, 'scale', '%'],
  ['#hn-plate-scale', (s) => s, 'plateScale', '%'],
  ['#hn-grad-amount', (s) => s.gradient, 'amount', '%'],
  ['#hn-outline-width', (s) => s.outline, 'width', ''],
  ['#hn-shadow-dx', (s) => s.shadow, 'dx', ''],
  ['#hn-shadow-dy', (s) => s.shadow, 'dy', ''],
  ['#hn-shadow-blur', (s) => s.shadow, 'blur', ''],
  ['#hn-shadow-alpha', (s) => s.shadow, 'alpha', '%'],
];

function hnFillForm(s) {
  const fam = $('#hn-family');
  if (!fam.options.length) fam.innerHTML = HN_FAMILIES.map((f) => `<option>${f}</option>`).join('');
  fam.value = s.family;
  fam.disabled = !!s.font;
  $('#hn-on').checked = !!s.enabled;
  $('#hn-font').value = s.font || '';
  $('#hn-italic').checked = !!s.italic;
  $('#hn-bold').checked = !!s.bold;
  for (const [sel, obj, key, unit] of HN_RANGES) {
    $(sel).value = obj(s)[key];
    $(sel + '-v').textContent = obj(s)[key] + unit;
  }
  const comp = $('#hn-component');
  if (!comp.options.length) comp.innerHTML = HN_COMPONENTS.map(([k, n]) => `<option value="${k}">${n}</option>`).join('');
  const ck = comp.value || HN_COMPONENTS[0][0];
  const fallback = ck.startsWith('plate:') ? s.plateScale : s.scale;
  $('#hn-component-scale').value = s.scales[ck] || fallback;
  $('#hn-component-scale-v').textContent = (s.scales[ck] || fallback) + '%';
  const [kind, value] = ck.split(':');
  $('#hn-component-color').value = kind === 'plate' ? (value === 'critical' ? s.plates.r : s.plates.w) : hnColor(s, value);
  $('#hn-grad-on').checked = !!s.gradient.on;
  $('#hn-grad-color').value = s.gradient.color;
  $('#hn-outline-color').value = s.outline.color;
  $('#hn-shadow-color').value = s.shadow.color;
  $('#hn-colors').innerHTML = HN_COLORS.map(([c, ru]) =>
    `<label class="scrub scrub--color"><span>${ru[0].toUpperCase() + ru.slice(1)}</span><span class="scrub__cc">` +
    `<input type="color" data-c="${c}" value="${hnColor(s, c)}" />` +
    `<input type="text" class="scrub__hex" maxlength="7" spellcheck="false" aria-label="${ru}, hex" /></span></label>`).join('');
  $('#hn-colors').querySelectorAll('input[type="color"]').forEach((i) => {
    i.oninput = () => { hnState().colors[i.dataset.c] = i.value; hnChanged(); };
  });
  $('#hn-plates-on').checked = !!s.plates.on;
  $('#hn-plates').innerHTML = HN_PLATES.map(([p, def]) =>
    `<span>${p}</span><input type="text" data-p="${p}" value="${esc(hnPlateText(s, p))}" placeholder="${esc(def)}" />`).join('');
  $('#hn-plates').querySelectorAll('input').forEach((i) => {
    i.oninput = () => { hnState().plates.text[i.dataset.p] = i.value; hnChanged(); };
  });
  $('#hn-plate-r').value = s.plates.r;
  $('#hn-plate-w').value = s.plates.w;
  $('#hn-icon').value = s.plates.icon || '';
}

/** Любая правка: запомнить, перерисовать предпросмотр. */
const hnSave = debounce(() => saveProfile(), 300);
function hnChanged() {
  hnSave();
  hnPreviewSoon();
  hnShowStaged();
}
const hnPreviewSoon = debounce(() => hnPreview(), 60);

function hnBind() {
  const on = (sel, ev, fn) => { $(sel)[ev] = (e) => { fn(hnState(), e.target); hnChanged(); }; };
  on('#hn-family', 'onchange', (s, t) => { s.family = t.value; });
  on('#hn-italic', 'onchange', (s, t) => { s.italic = t.checked; });
  on('#hn-bold', 'onchange', (s, t) => { s.bold = t.checked; });
  on('#hn-grad-on', 'onchange', (s, t) => { s.gradient.on = t.checked; });
  on('#hn-grad-color', 'oninput', (s, t) => { s.gradient.color = t.value; });
  on('#hn-outline-color', 'oninput', (s, t) => { s.outline.color = t.value; });
  on('#hn-shadow-color', 'oninput', (s, t) => { s.shadow.color = t.value; });
  on('#hn-component-scale', 'oninput', (s, t) => { s.scales[$('#hn-component').value] = Number(t.value); $('#hn-component-scale-v').textContent = t.value + '%'; });
  $('#hn-component').onchange = () => { hnFillForm(hnState()); };
  $('#hn-component-color').oninput = (e) => { const [kind, value] = $('#hn-component').value.split(':'); if (kind === 'plate') { if (value === 'critical') hnState().plates.r = e.target.value; else hnState().plates.w = e.target.value; } else hnState().colors[value] = e.target.value; hnChanged(); };
  on('#hn-plates-on', 'onchange', (s, t) => { s.plates.on = t.checked; });
  on('#hn-plate-r', 'oninput', (s, t) => { s.plates.r = t.value; });
  on('#hn-plate-w', 'oninput', (s, t) => { s.plates.w = t.value; });
  for (const [sel, obj, key, unit] of HN_RANGES) {
    on(sel, 'oninput', (s, t) => { obj(s)[key] = Number(t.value); $(sel + '-v').textContent = t.value + unit; });
  }
  $('#hn-orig').onchange = () => hnPreview();

  $('#hn-on').onchange = (e) => guard(async () => {
    const s = hnState();
    s.enabled = e.target.checked;
    if (s.enabled) await hnStage();
    else hnUnstage();
    saveProfile();
    renderBadges();
    renderSummary();
    hnShowStaged();
  });
  $('#hn-font-pick').onclick = () => guard(async () => {
    const f = await window.api.font.pick();
    if (!f) return;
    const s = hnState();
    s.font = f;
    await hnEnsureFont(s);
    hnFillForm(s);
    hnChanged();
  });
  $('#hn-font-clear').onclick = () => { hnState().font = ''; hnFillForm(hnState()); hnChanged(); };
  $('#hn-icon-pick').onclick = () => guard(async () => {
    const picked = await window.api.packs.pickFile();
    if (!picked) return;
    const s = hnState();
    s.plates.icon = picked.path;
    await hnEnsureIcon(s, picked.data);
    hnFillForm(s);
    hnChanged();
  });
  $('#hn-icon-clear').onclick = () => { hnState().plates.icon = ''; hn.icon = null; hn.iconFor = ''; hnFillForm(hnState()); hnChanged(); };
  $('#hn-colors-reset').onclick = () => { hnState().colors = {}; hnFillForm(hnState()); hnChanged(); };
  $('#hn-stage').onclick = () => guard(async () => {
    const s = hnState();
    if (!s.enabled) { s.enabled = true; $('#hn-on').checked = true; }
    await hnStage();
    saveProfile();
    renderBadges();
    renderSummary();
  });
  $('#hn-revert').onclick = () => {
    const s = hnState();
    s.enabled = false;
    $('#hn-on').checked = false;
    hnUnstage(true);
    saveProfile();
    renderBadges();
    renderSummary();
    toast('при следующей сборке вернутся родные цифры');
  };
  $('#hn-single').onclick = () => {
    const b = $('.nav[data-view="icons"][data-pack="hitnum"]') || null;
    if (b) { b.click(); return; }
    // отдельной кнопки у набора больше нет — открываем общий раздел картинок на нём
    icons.pack = 'hitnum';
    $('#icon-search').value = '';
    $$('.nav').forEach((x) => x.classList.remove('is-active'));
    $$('.view').forEach((v) => v.classList.toggle('is-active', v.dataset.view === 'icons'));
    loadIcons(true);
  };
}

/** Картинки из конструктора — в набор hitnum. */
async function hnStage() {
  if (!(await hnLoad())) throw new Error('набор цифр не прочитан');
  const s = hnState();
  await hnEnsureFont(s);
  await hnEnsureIcon(s);
  hnSetState('рисую и готовлю картинки…');
  const all = hnRenderAll(s);
  const store = packStore('hitnum');
  // прежние картинки конструктора, которых теперь нет (выключили надписи), — убрать
  for (const k of s.keys) if (!all.has(k)) delete store[k];
  let n = 0;
  for (const [key, img] of all) {
    store[key] = await window.api.packs.stage({
      pack: 'hitnum', name: key, width: img.width, height: img.height, rgba: Array.from(img.data),
    });
    n++;
  }
  s.keys = [...all.keys()];
  s.staged = hnSig(s);
  hnShowStaged();
  toast(`подготовлено ${n} картинок цифр и надписей`);
  return n;
}

/** Убрать подготовленное конструктором (all — и заменённое вручную по одной). */
function hnUnstage(all) {
  const s = hnState();
  const store = packStore('hitnum');
  for (const k of all ? Object.keys(store) : s.keys) delete store[k];
  s.keys = [];
  s.staged = '';
}

/** Перед сборкой: включено и настройки менялись — подготовить заново. */
async function hnEnsureStaged() {
  const s = state.profile.hitnum;
  if (!s || !s.enabled || !state.ready) return;
  if (s.staged === hnSig(hnState())) return;
  await hnStage();
  saveProfile();
}

/* ---------- предпросмотр ---------- */

function hnPreview() {
  const cv = $('#hn-canvas');
  const g = cv.getContext('2d');
  g.fillStyle = '#26301f';
  g.fillRect(0, 0, cv.width, cv.height);
  // «трава» — фон, на котором видно тень и обводку
  const bg = g.createLinearGradient(0, 0, cv.width, cv.height);
  bg.addColorStop(0, 'rgba(90,120,70,.35)');
  bg.addColorStop(1, 'rgba(20,30,20,.2)');
  g.fillStyle = bg;
  g.fillRect(0, 0, cv.width, cv.height);
  if (!hn.rows) return;
  const s = hnState();
  const useOrig = $('#hn-orig').checked;
  const imgs = useOrig ? null : hnRenderAll(s);
  const pick = (short) => {
    const r = hn.rows.find((x) => x.short.toLowerCase() === short &&
      (!/_(r|w)\.dds$/.test(short) || /textures\.pak$/i.test(x.pak))) ||
      hn.rows.find((x) => x.short.toLowerCase() === short);
    if (!r) return null;
    if (useOrig) {
      const o = hn.orig.get(r.key);
      if (!o) return null;
      // широкие приходят в окно уменьшенными — возвращаем им родной размер при выводе
      const im = new ImageData(new Uint8ClampedArray(o.rgba), o.width, o.height);
      im.shown = hn.sizes.get(r.key);
      return im;
    }
    return imgs.get(r.key) || null;
  };
  const tmp = document.createElement('canvas');
  const blit = (im, x, y, sc) => {
    if (!im) return;
    tmp.width = im.width;
    tmp.height = im.height;
    tmp.getContext('2d').putImageData(im, 0, 0);
    const [w, h] = im.shown || [im.width, im.height];
    g.imageSmoothingEnabled = sc !== 1 || w !== im.width;
    g.drawImage(tmp, x, y, w * sc, h * sc);
  };
  // картинки крупнее родных: всё окно предпросмотра уменьшаем одним масштабом,
  // чтобы влезло и цифры с надписями остались в верном соотношении
  const gd = useOrig ? 1 : hnGrow(s.scale);
  const gp = useOrig || !s.plates.on ? 1 : hnGrow(s.plateScale);
  const v = 1 / Math.max(gd, gp);
  const note = $('#hn-pnote');
  note.hidden = v === 1;
  note.textContent = `уменьшено в ${(1 / v).toFixed(1).replace('.', ',')} раза — в игре крупнее`;
  // цифры: как в бою — «+12 345» знаками по 32 px с нахлёстом
  const dk = gd * v;
  const step = 21 * dk;
  HN_COLORS.forEach(([c], i) => {
    const y = 8 + i * 36 * dk;
    let x = 8;
    if (c !== 'gray') blit(pick(`plus_${c}.dds`), x, y, v);
    x += step;
    for (const d of '1234567890') { blit(pick(`${d}_${c}.dds`), x, y, v); x += step; }
  });
  // надписи — уменьшенные, две в ряд: красная и жёлтая
  const pk = gp * v;
  const py = 8 + HN_COLORS.length * 36 * dk + 4;
  const ph = Math.max(...[...hn.sizes.values()].filter(([w]) => w > 64).map(([, h]) => h), 70);
  const sc = 0.6;
  HN_PLATES.forEach(([p], i) => {
    const y = py + i * Math.ceil(ph * sc * pk + 2);
    blit(pick(`${p}_r.dds`), 4, y, sc * v);
    blit(pick(`${p}_w.dds`), 4 + 168 * pk, y, sc * v);
  });
}

hnBind();
