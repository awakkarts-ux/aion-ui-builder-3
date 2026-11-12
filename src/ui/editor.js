'use strict';

/*
 * Редактор интерфейса: окна игры на экране предпросмотра, элементы с
 * понятными названиями, замена элемента на совместимый вариант или свою
 * картинку. Сцену и каталог считает главный процесс по сборке в памяти
 * (core/scene.js, core/elements.js) — здесь только рисование и выбор.
 *
 * Правки — profile.elements: id элемента -> { from: id варианта } или
 * { images: { состояние: файл DDS } }. Какие окна показаны — только
 * удобство окна, в профиль не пишется (иначе каждый щелчок пересобирал бы сцену).
 */

const ED_REST = ['frame', 'bg', 'slot', '0', 'up', 'normal', '0:up', 'wait_for_key', 'left_tabline'];
const ED_SHOWN_KEY = 'aionui.editor.shown';
const ED_VARIANT_KEY = 'aionui.editor.variants';

const ed = {
  data: null, // { elements, windows, kinds, skins, screen, set }
  byId: new Map(),
  sig: '',
  loading: null,
  tab: 'windows',
  shown: [], // id окон в порядке показа
  variant: {}, // id окна -> показанный вариант (цель: вид моба)
  pages: {}, // id окна -> { набор вкладок: номер показанной страницы }
  wins: new Map(), // id окна -> { x, y, w, h, ops }
  atlases: new Map(), // атлас -> ImageBitmap | null
  pending: new Map(),
  images: new Map(), // свой файл -> ImageBitmap
  fonts: new Map(), // гарнитура игры -> имя семейства в окне | null (нет файла) | Promise
  sel: null,
  hover: null,
  view: { k: 1, ox: 0, oy: 0 },
};

function edStore() {
  if (!state.profile.elements) state.profile.elements = {};
  return state.profile.elements;
}

function edLoadShown() {
  try {
    const v = JSON.parse(localStorage.getItem(ED_SHOWN_KEY) || 'null');
    if (Array.isArray(v)) return v;
  } catch (e) { /* нет — по умолчанию */ }
  return null;
}
function edSaveShown() {
  try {
    localStorage.setItem(ED_SHOWN_KEY, JSON.stringify(ed.shown));
    localStorage.setItem(ED_VARIANT_KEY, JSON.stringify({ variant: ed.variant, pages: ed.pages }));
  } catch (e) { /* не важно */ }
}
function edLoadVariants() {
  try {
    const v = JSON.parse(localStorage.getItem(ED_VARIANT_KEY) || 'null');
    if (v && v.variant) return v;
  } catch (e) { /* нет — первый вариант и первая вкладка */ }
  return { variant: {}, pages: {} };
}

function edSetState(text, cls) {
  const st = $('#ed-state');
  st.className = 'state' + (cls ? ' ' + cls : '');
  st.textContent = text;
}

/* ---------- данные ---------- */

async function loadEditor(force) {
  if (!state.ready) { edSetState('клиент не выбран', 'bad'); return; }
  const sig = JSON.stringify(Object.assign({}, state.profile, { elements: {} }));
  if (!force && ed.data && ed.sig === sig) { edResize(); return; }
  // настройки поменялись, пока собиралось, — соберём ещё раз по готовности
  if (ed.loading) { ed.again = true; return ed.loading; }
  edSetState('собираю предпросмотр из текущих настроек…');
  ed.loading = (async () => {
    const data = await guard(() => window.api.editor.open(state.profile));
    ed.loading = null;
    if (ed.again) { ed.again = false; setTimeout(() => loadEditor(), 0); }
    if (!data) { edSetState('не удалось собрать предпросмотр', 'bad'); return; }
    ed.data = data;
    ed.sig = sig;
    ed.byId = new Map(data.elements.map((e) => [e.id, e]));
    ed.wins.clear();
    ed.atlases.clear();
    ed.pending.clear();
    ed.fonts.clear(); // свой шрифт мог смениться в разделе «Шрифт»
    const ids = new Set(data.windows.map((w) => w.id));
    const saved = edLoadShown();
    ed.shown = (saved || data.windows.filter((w) => w.hud).map((w) => w.id)).filter((id) => ids.has(id));
    const vs = edLoadVariants();
    ed.variant = vs.variant || {};
    ed.pages = vs.pages || {};
    edSetState(`элементов ${data.elements.filter((e) => e.used).length} в ${data.windows.length} окнах · экран «Стиль Aion»`, 'ok');
    await Promise.all(ed.shown.map(edFetchWindow));
    edRenderList();
    edResize();
    if (ed.sel && ed.byId.has(ed.sel)) edRenderProps();
  })();
  skWait($('#ed-screen'), ed.loading);
  return ed.loading;
}

async function edFetchWindow(id) {
  const key = JSON.stringify([ed.variant[id] || '', ed.pages[id] || {}]);
  const cur = ed.wins.get(id);
  if (cur && cur.key === key) return cur;
  const w = await guard(() => window.api.editor.window(id, ed.variant[id], ed.pages[id]));
  if (w) w.key = key;
  ed.wins.set(id, w);
  return w;
}

/** Атлас: грузится один раз, после загрузки экран и миниатюры перерисуются. */
function edAtlas(texture) {
  const key = String(texture || '').toLowerCase().replace(/^.*\//, '');
  if (ed.atlases.has(key)) return ed.atlases.get(key);
  if (!ed.pending.has(key)) {
    ed.pending.set(key, (async () => {
      const img = await window.api.editor.atlas(texture).catch(() => null);
      let bmp = null;
      if (img) {
        bmp = await createImageBitmap(new ImageData(new Uint8ClampedArray(img.rgba), img.width, img.height));
      }
      ed.atlases.set(key, bmp);
      ed.pending.delete(key);
      edRepaintSoon();
    })());
  }
  return undefined;
}

/** Шрифт игры для текста: грузится один раз, до загрузки — похожий системный. */
function edFont(face) {
  const key = String(face || '').toLowerCase();
  const got = key ? ed.fonts.get(key) : null;
  if (typeof got === 'string') return `"${got}", Calibri, Arial, sans-serif`;
  if (key && got === undefined) {
    ed.fonts.set(key, (async () => {
      let family = null;
      try {
        const bytes = await window.api.editor.font(face);
        if (bytes && bytes.length) {
          family = `aion-${key}-${Date.now()}`;
          const ff = new FontFace(family, new Uint8Array(bytes));
          document.fonts.add(await ff.load());
        }
      } catch (e) { family = null; /* битый файл — останется системный */ }
      ed.fonts.set(key, family);
      edRepaintSoon();
    })());
  }
  return 'Calibri, Arial, sans-serif';
}

async function edImage(file) {
  if (ed.images.has(file)) return ed.images.get(file);
  ed.images.set(file, null);
  try {
    const img = await window.api.editor.readImage(file);
    if (img) {
      ed.images.set(file, await createImageBitmap(new ImageData(new Uint8ClampedArray(img.rgba), img.width, img.height)));
      edRepaintSoon();
    }
  } catch (e) { /* файла нет — покажем родное */ }
  return null;
}

/* ---------- рисование ---------- */

/** Скин (простой или из девяти кусков) в прямоугольник. */
function edDrawSkin(g, d, x, y, w, h) {
  if (!d) return false;
  const bmp = edAtlas(d.texture);
  if (!bmp) return false;
  const r = d.rects;
  if (!d.nine) {
    const s = r.src_image || r.src_middle_middle;
    if (s && s.w > 0 && s.h > 0) g.drawImage(bmp, s.x, s.y, s.w, s.h, x, y, w, h);
    return true;
  }
  const z = { x: 0, y: 0, w: 0, h: 0 };
  const q = (k) => r[k] || z;
  const lw = Math.max(q('src_left_top').w, q('src_left_middle').w, q('src_left_bottom').w);
  const rw = Math.max(q('src_right_top').w, q('src_right_middle').w, q('src_right_bottom').w);
  const th = Math.max(q('src_left_top').h, q('src_middle_top').h, q('src_right_top').h);
  const bh = Math.max(q('src_left_bottom').h, q('src_middle_bottom').h, q('src_right_bottom').h);
  const mw = Math.max(0, w - lw - rw);
  const mh = Math.max(0, h - th - bh);
  const cols = [[x, lw, 'left'], [x + lw, mw, 'middle'], [x + lw + mw, rw, 'right']];
  const rows = [[y, th, 'top'], [y + th, mh, 'middle'], [y + th + mh, bh, 'bottom']];
  for (const [cy, ch, rn] of rows) {
    for (const [cx, cw, cn] of cols) {
      const s = r[`src_${cn}_${rn}`];
      if (s && s.w > 0 && s.h > 0 && cw > 0 && ch > 0) g.drawImage(bmp, s.x, s.y, s.w, s.h, cx, cy, cw, ch);
    }
  }
  return true;
}

/** Скин элемента в нужном состоянии с учётом правки: вариант или своя картинка. */
function edResolve(elId, stateName, fallbackSkin) {
  const edit = edStore()[elId];
  if (edit && edit.images) {
    const file = edit.images[stateName] || Object.values(edit.images)[0];
    if (file) return { image: file };
  }
  const src = edit && edit.from ? ed.byId.get(edit.from) : null;
  const el = src || ed.byId.get(elId);
  if (!el) return fallbackSkin ? { draw: ed.data.skins[fallbackSkin] } : null;
  const by = new Map(el.states.map((s) => [s.state, s.skin]));
  const want = src ? (by.get(stateName) || by.get(ED_REST.find((r) => by.has(r))) || el.states[0].skin)
    : (by.get(stateName) || fallbackSkin || el.states[0].skin);
  return { draw: ed.data.skins[want] };
}

function edDrawResolved(g, res, x, y, w, h) {
  if (!res) return;
  if (res.image) {
    const bmp = ed.images.get(res.image);
    if (bmp) g.drawImage(bmp, x, y, w, h);
    else edImage(res.image);
    return;
  }
  edDrawSkin(g, res.draw, x, y, w, h);
}

function edTextOp(g, op) {
  const [r, gg, b, a] = op.color;
  g.save();
  g.beginPath();
  g.rect(op.x, op.y, op.w, op.h);
  g.clip();
  g.font = `${Math.max(8, Math.min(op.size, 40))}px ${edFont(op.face)}`;
  g.textBaseline = op.valign === 'top' ? 'top' : op.valign === 'bottom' ? 'bottom' : 'middle';
  g.textAlign = op.align === 'center' ? 'center' : op.align === 'right' ? 'right' : 'left';
  const tx = op.align === 'center' ? op.x + op.w / 2 : op.align === 'right' ? op.x + op.w - 3 : op.x + 3;
  const ty = g.textBaseline === 'top' ? op.y + 2 : g.textBaseline === 'bottom' ? op.y + op.h - 2 : op.y + op.h / 2;
  if (op.outline) {
    g.lineWidth = 3;
    g.strokeStyle = 'rgba(0,0,0,.85)';
    g.strokeText(op.text, tx, ty);
  }
  g.fillStyle = `rgba(${r},${gg},${b},${a == null ? 1 : a})`;
  g.fillText(op.text, tx, ty);
  g.restore();
}

function edPaint() {
  const cv = $('#ed-canvas');
  if (!cv || !ed.data) return;
  const g = cv.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, cv.width, cv.height);
  const { k, ox, oy } = ed.view;
  const zv = $('#ed-zoom-v');
  if (zv) zv.textContent = Math.round(k * 100) + '%';
  g.setTransform(k * dpr, 0, 0, k * dpr, ox * dpr, oy * dpr);
  // «игровой» фон — на нём видны прозрачность и тени деталей
  const S = ed.data.screen;
  const bg = g.createLinearGradient(0, 0, 0, S.h);
  bg.addColorStop(0, '#3a4a3c');
  bg.addColorStop(1, '#1f2822');
  g.fillStyle = bg;
  g.fillRect(0, 0, S.w, S.h);
  g.imageSmoothingEnabled = true;

  const marks = [];
  for (const id of ed.shown) {
    const w = ed.wins.get(id);
    if (!w) continue;
    g.save();
    g.translate(w.x, w.y);
    for (const op of w.ops) {
      if (op.op === 'text') { edTextOp(g, op); continue; }
      const res = edResolve(op.el, op.state, op.skin);
      edDrawResolved(g, res, op.x, op.y, op.w, op.h);
      if (op.el === ed.sel || op.el === ed.hover) marks.push([w.x + op.x, w.y + op.y, op.w, op.h, op.el === ed.sel]);
    }
    g.restore();
  }
  for (const [x, y, w, h, sel] of marks) {
    g.lineWidth = (sel ? 2 : 1) / k;
    g.strokeStyle = sel ? '#5865f2' : 'rgba(255,255,255,.7)';
    g.setLineDash(sel ? [] : [4 / k, 3 / k]);
    g.strokeRect(x + 0.5 / k, y + 0.5 / k, Math.max(1, w - 1 / k), Math.max(1, h - 1 / k));
  }
  g.setLineDash([]);
}
const edRepaintSoon = debounce(() => { edPaint(); edRefreshThumbs(); }, 30);

function edResize() {
  const box = $('#ed-screen');
  const cv = $('#ed-canvas');
  if (!box || !ed.data || !box.clientWidth) return;
  const dpr = window.devicePixelRatio || 1;
  cv.width = Math.round(box.clientWidth * dpr);
  cv.height = Math.round(box.clientHeight * dpr);
  cv.style.width = box.clientWidth + 'px';
  cv.style.height = box.clientHeight + 'px';
  if (!ed.zoomed) edFit();
  edPaint();
}

/** Весь экран игры в окно предпросмотра. */
function edFit() {
  const box = $('#ed-screen');
  const S = ed.data.screen;
  const k = Math.min(box.clientWidth / S.w, box.clientHeight / S.h);
  ed.view = { k, ox: (box.clientWidth - S.w * k) / 2, oy: (box.clientHeight - S.h * k) / 2 };
  ed.zoomed = false;
}
window.addEventListener('resize', debounce(edResize, 80));

/** Элемент под курсором: сверху вниз, как нарисовано. */
function edHit(ev) {
  if (!ed.data) return null;
  const r = $('#ed-canvas').getBoundingClientRect();
  const x = (ev.clientX - r.left - ed.view.ox) / ed.view.k;
  const y = (ev.clientY - r.top - ed.view.oy) / ed.view.k;
  for (let i = ed.shown.length - 1; i >= 0; i--) {
    const w = ed.wins.get(ed.shown[i]);
    if (!w) continue;
    const lx = x - w.x;
    const ly = y - w.y;
    if (lx < 0 || ly < 0 || lx > w.w || ly > w.h) continue;
    for (let j = w.ops.length - 1; j >= 0; j--) {
      const op = w.ops[j];
      if (op.op !== 'skin' || !op.el) continue;
      if (lx >= op.x && ly >= op.y && lx < op.x + op.w && ly < op.y + op.h) return op.el;
    }
  }
  return null;
}

/* ---------- миниатюры ---------- */

/** Миниатюра элемента в «покое» (или в состоянии) — в canvas с data-el. */
function edThumb(elId, stateName, w, h) {
  const cv = document.createElement('canvas');
  cv.className = 'ed__thumb';
  cv.dataset.el = elId;
  if (stateName != null) cv.dataset.state = stateName;
  cv.width = w;
  cv.height = h;
  edPaintThumb(cv);
  return cv;
}

function edPaintThumb(cv) {
  const el = ed.byId.get(cv.dataset.el);
  if (!el) return;
  const g = cv.getContext('2d');
  g.clearRect(0, 0, cv.width, cv.height);
  const by = new Map(el.states.map((s) => [s.state, s.skin]));
  const st = cv.dataset.state != null ? cv.dataset.state : (ED_REST.find((r) => by.has(r)) || el.states[0].state);
  // превью варианта в сетке замен рисуется без правки самого варианта
  const res = cv.dataset.raw ? { draw: ed.data.skins[by.get(st) || el.states[0].skin] } : edResolve(el.id, st, by.get(st));
  let [w, h] = el.size;
  if (el.nine) { w = Math.max(w, 48); h = Math.max(h, 32); }
  const k = Math.min(cv.width / Math.max(w, 1), cv.height / Math.max(h, 1), 2);
  const dw = Math.max(1, Math.round(w * k));
  const dh = Math.max(1, Math.round(h * k));
  edDrawResolved(g, res, Math.round((cv.width - dw) / 2), Math.round((cv.height - dh) / 2), dw, dh);
}

function edRefreshThumbs() {
  document.querySelectorAll('.view[data-view="editor"] canvas.ed__thumb').forEach(edPaintThumb);
}

/* ---------- списки слева ---------- */

function edRenderList() {
  if (!ed.data) return;
  const box = $('#ed-list');
  const q = $('#ed-search').value.trim().toLowerCase();
  box.innerHTML = '';
  if (ed.tab === 'windows') {
    const groups = [
      ['Частые окна', ed.data.windows.filter((w) => w.featured)],
      ['Остальные окна — без выверки', ed.data.windows.filter((w) => !w.featured)],
    ];
    for (const [title, list] of groups) {
      const rows = list.filter((w) => !q || w.title.toLowerCase().includes(q) || w.id.toLowerCase().includes(q));
      if (!rows.length) continue;
      const h = document.createElement('div');
      h.className = 'ed__group';
      h.textContent = title;
      box.appendChild(h);
      for (const w of rows) {
        const row = document.createElement('label');
        row.className = 'ed__win';
        row.innerHTML = `<input type="checkbox" ${ed.shown.includes(w.id) ? 'checked' : ''} />` +
          `<span><b>${esc(w.title)}</b><small>${esc(w.id)}</small></span>`;
        row.querySelector('input').onchange = (e) => guard(() => edToggleWindow(w.id, e.target.checked));
        box.appendChild(row);
        // варианты окна (цель: вид моба) и вкладки — игра показывает одно, выбираем что
        const pick = (choose) => guard(async () => {
          choose();
          await edFetchWindow(w.id);
          if (!ed.shown.includes(w.id)) {
            ed.shown.push(w.id);
            row.querySelector('input').checked = true;
          }
          edSaveShown();
          edPaint();
        });
        if (!ed.shown.includes(w.id)) continue; // переключатели — только у показанных окон
        if (w.variants && w.variants.length) {
          const on = ed.variant[w.id] || w.variants[0].id;
          box.appendChild(edSwitch(w.variants.map((v) => [v.id, v.title]), on,
            (v) => pick(() => { ed.variant[w.id] = v; })));
        }
        for (const sheet of w.tabs || []) {
          const opts = sheet.pages.map((p, i) => [i, p.title, p.hidden]).filter((p) => !p[2]);
          if (opts.length < 2) continue;
          const cur = ((ed.pages[w.id] || {})[sheet.name]);
          box.appendChild(edSwitch(opts, cur == null ? opts[0][0] : cur, (i) => pick(() => {
            ed.pages[w.id] = Object.assign({}, ed.pages[w.id], { [sheet.name]: i });
          })));
        }
      }
    }
    return;
  }
  // элементы: из показанных окон, при поиске — все
  const shown = new Set(ed.shown);
  const store = edStore();
  const list = ed.data.elements.filter((e) => e.used && (q
    ? e.title.toLowerCase().includes(q) || e.tech.toLowerCase().includes(q)
    : e.windows.some((w) => shown.has(w))));
  const byKind = new Map();
  for (const e of list) {
    if (!byKind.has(e.kindTitle)) byKind.set(e.kindTitle, []);
    byKind.get(e.kindTitle).push(e);
  }
  if (!list.length) {
    box.innerHTML = '<div class="muted pad">Нет элементов: включи окна на вкладке «Окна» или поищи по названию.</div>';
    return;
  }
  for (const [kind, els] of [...byKind].sort((a, b) => b[1].length - a[1].length)) {
    const h = document.createElement('div');
    h.className = 'ed__group';
    h.textContent = `${kind} · ${els.length}`;
    box.appendChild(h);
    for (const e of els.slice(0, 200)) {
      const row = document.createElement('div');
      row.className = 'ed__el' + (e.id === ed.sel ? ' is-active' : '') + (store[e.id] ? ' is-edited' : '');
      row.appendChild(edThumb(e.id, null, 44, 32));
      const t = document.createElement('span');
      t.innerHTML = `<b>${esc(e.title)}</b><small>${esc(e.tech)}</small>`;
      row.appendChild(t);
      row.onclick = () => edSelect(e.id);
      row.onmouseenter = () => { ed.hover = e.id; edPaint(); };
      row.onmouseleave = () => { ed.hover = null; edPaint(); };
      box.appendChild(row);
    }
  }
}

/** Переключатель под строкой окна: [значение, подпись]. */
function edSwitch(opts, on, onPick) {
  const seg = document.createElement('div');
  seg.className = 'seg ed__vars';
  for (const [value, title] of opts) {
    const b = document.createElement('button');
    b.textContent = title;
    b.classList.toggle('is-on', value === on);
    b.onclick = () => {
      seg.querySelectorAll('button').forEach((x) => x.classList.toggle('is-on', x === b));
      onPick(value);
    };
    seg.appendChild(b);
  }
  return seg;
}

async function edToggleWindow(id, on) {
  ed.shown = ed.shown.filter((x) => x !== id);
  if (on) {
    await edFetchWindow(id);
    ed.shown.push(id); // включённое — поверх остальных
  }
  edSaveShown();
  edPaint();
  // у включённого окна появляются переключатели вкладок — список перерисовать, не сбив прокрутку
  const list = $('#ed-list');
  const top = list.scrollTop;
  edRenderList();
  list.scrollTop = top;
}

/* ---------- карточка элемента ---------- */

function edSelect(id) {
  ed.sel = id;
  document.querySelectorAll('#ed-list .ed__el').forEach((n) => n.classList.remove('is-active'));
  edPaint();
  edRenderProps();
}

async function edRenderProps() {
  const box = $('#ed-props');
  const el = ed.byId.get(ed.sel);
  if (!el) { box.innerHTML = '<div class="muted pad">Выбери элемент на экране или в списке слева.</div>'; return; }
  const edit = edStore()[el.id];
  const winTitle = new Map(ed.data.windows.map((w) => [w.id, w.title]));
  const wins = el.windows.map((w) => winTitle.get(w) || w);
  // порядок — по частоте: на что заменить → своя картинка → где используется
  box.innerHTML = `
    <div class="props__head"><b>${esc(el.title)}</b><span>${esc(el.kindTitle)} · ${el.size[0]}×${el.size[1]}${el.nine ? ' · тянется' : ''} · ${el.used} мест</span></div>
    <div class="props__body">
      <div class="ed__now">
        <span class="state ${edit ? 'warn' : ''}">${edit ? (edit.from ? 'заменён на «' + esc((ed.byId.get(edit.from) || {}).title || edit.from) + '»' : 'своя картинка') : 'родной'}</span>
        <button class="btn btn--ghost" id="ed-reset" ${edit ? '' : 'disabled'}>Вернуть родной</button>
      </div>
      <h3 class="ed__h">Заменить на</h3>
      <div class="ed__cands" id="ed-cands"><span class="muted">подбираю варианты…</span></div>
      <h3 class="ed__h">Своя картинка</h3>
      <div class="ed__states" id="ed-states"></div>
      <details class="ed__more">
        <summary>Где используется — ${el.windows.length} ${el.windows.length === 1 ? 'окно' : 'окон'}</summary>
        <div class="ed__wins">${wins.slice(0, 12).map((t) => `<span>${esc(t)}</span>`).join('')}${wins.length > 12 ? `<span>ещё ${wins.length - 12}</span>` : ''}</div>
        <div id="ed-split"></div>
        <div class="ed__meta">${esc(el.tech)} · ${esc(el.lib)}</div>
      </details>
    </div>`;

  const st = $('#ed-states');
  for (const s of el.states) {
    const cell = document.createElement('div');
    cell.className = 'ed__state';
    cell.appendChild(edThumb(el.id, s.state, 72, 48));
    const cap = document.createElement('small');
    cap.textContent = s.title || 'обычная';
    cell.appendChild(cap);
    const up = document.createElement('button');
    up.className = 'btn btn--ghost ed__up';
    up.textContent = 'Своя…';
    up.title = 'Своя картинка для этого состояния (PNG, JPG)';
    up.onclick = () => guard(() => edPickImage(el, s.state));
    cell.appendChild(up);
    st.appendChild(cell);
  }
  edRenderSplit(el);
  $('#ed-reset').onclick = () => {
    delete edStore()[el.id];
    edChanged();
    edRenderProps();
  };

  const cands = await guard(() => window.api.editor.candidates(el.id, 80));
  if (ed.sel !== el.id) return;
  const box2 = $('#ed-cands');
  box2.innerHTML = '';
  if (!cands || !cands.length) { box2.innerHTML = '<span class="muted">подходящих вариантов нет — можно поставить свою картинку</span>'; return; }
  for (const c of cands) {
    const ce = ed.byId.get(c.id);
    if (!ce) continue;
    const b = document.createElement('button');
    b.className = 'ed__cand' + (edit && edit.from === c.id ? ' is-on' : '');
    b.title = `${ce.title}\n${ce.tech} · ${ce.size[0]}×${ce.size[1]}`;
    const th = edThumb(ce.id, null, 64, 44);
    th.dataset.raw = '1';
    edPaintThumb(th);
    b.appendChild(th);
    b.onclick = () => {
      edStore()[el.id] = { from: ce.id };
      edChanged();
      edRenderProps();
    };
    box2.appendChild(b);
  }
}

/* ---------- «сделать отдельным» ---------- */

/** Имя копии — как elements.splitName в главном процессе. */
function edSplitName(name, win, scope) {
  const tag = (scope || String(win).replace(/^.*\//, '').replace(/(_dialog)?\.xml$/i, '')).replace(/\W+/g, '_');
  return `${name}__bld_${tag}`;
}

/** Общий элемент — места с кнопкой «Отдельно»; копия — «Снова общий». */
function edRenderSplit(el) {
  const box = $('#ed-split');
  if (!box) return;
  const splits = state.profile.splits || [];
  const own = splits.find((s) => edSplitName(s.el.slice(2), s.win, s.scope) === el.tech);
  if (own) {
    const orig = ed.byId.get(own.el);
    box.innerHTML = `<div class="ed__split"><span>Отдельная копия${orig ? ' элемента «' + esc(orig.title) + '»' : ''}</span>` +
      '<button class="btn btn--ghost" id="ed-unsplit">Снова общий</button></div>';
    $('#ed-unsplit').onclick = () => guard(async () => {
      state.profile.splits = splits.filter((s) => s !== own);
      delete edStore()[el.id];
      await edReloadAndSelect(own.el);
    });
    return;
  }
  if (!el.scopes || el.scopes.length < 2) { box.innerHTML = ''; return; }
  box.innerHTML = '<h3 class="ed__h">Общий для нескольких мест</h3>' +
    '<div class="muted" style="font-size:11px">Замена меняет его везде. Чтобы менять одно место отдельно — отдели его.</div>' +
    el.scopes.map((sc, i) => `<div class="ed__split"><span>${esc(sc.title)}</span>` +
      `<button class="btn btn--ghost" data-i="${i}">Отдельно</button></div>`).join('');
  box.querySelectorAll('button[data-i]').forEach((b) => {
    b.onclick = () => guard(async () => {
      const sc = el.scopes[+b.dataset.i];
      const split = { win: sc.win, scope: sc.scope, el: el.id };
      state.profile.splits = [...splits, split];
      const copyId = el.id.slice(0, 2) + edSplitName(el.tech, sc.win, sc.scope);
      // замена, уже сделанная для общего, остаётся и у копии — вид не меняется
      if (edStore()[el.id]) edStore()[copyId] = JSON.parse(JSON.stringify(edStore()[el.id]));
      await edReloadAndSelect(copyId);
    });
  });
}

/** Разделение меняет окна и библиотеки — сцену собираем заново. */
async function edReloadAndSelect(id) {
  saveProfile();
  renderBadges();
  edSetState('пересобираю предпросмотр…');
  await loadEditor(true);
  if (ed.byId.has(id)) edSelect(id);
  edRenderList();
}

/** Своя картинка для состояния: окно готовит DDS, в профиль — путь к нему. */
async function edPickImage(el, stateName) {
  const picked = await window.api.packs.pickFile();
  if (!picked) return;
  const bin = atob(picked.data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const bmp = await createImageBitmap(new Blob([bytes]));
  const cv = document.createElement('canvas');
  cv.width = bmp.width;
  cv.height = bmp.height;
  const g = cv.getContext('2d');
  g.drawImage(bmp, 0, 0);
  const img = g.getImageData(0, 0, cv.width, cv.height);
  const file = await window.api.editor.stageImage({
    id: el.id, state: stateName, width: img.width, height: img.height, rgba: Array.from(img.data),
  });
  const cur = edStore()[el.id];
  const images = Object.assign({}, cur && cur.images);
  images[stateName] = file;
  edStore()[el.id] = { images };
  ed.images.set(file, bmp);
  edChanged();
  edRenderProps();
}

function edChanged() {
  saveProfile();
  renderBadges();
  edPaint();
  edRefreshThumbs();
  if (ed.tab === 'elements') edRenderList();
}

/* ---------- привязка ---------- */

(function edBind() {
  const cv = $('#ed-canvas');
  cv.onmousemove = (ev) => {
    const id = edHit(ev);
    if (id !== ed.hover) { ed.hover = id; edPaint(); }
    cv.style.cursor = id ? 'pointer' : 'default';
  };
  cv.onmouseleave = () => { ed.hover = null; edPaint(); };
  cv.onclick = (ev) => {
    if (ed.dragged) return; // конец перетаскивания — не выбор
    const id = edHit(ev);
    if (id) edSelect(id);
  };
  // колесо — масштаб вокруг курсора, перетаскивание — сдвиг, двойной щелчок — весь экран
  cv.onwheel = (ev) => {
    if (!ed.data) return;
    ev.preventDefault();
    const r = cv.getBoundingClientRect();
    const mx = ev.clientX - r.left;
    const my = ev.clientY - r.top;
    const v = ed.view;
    const k = Math.max(0.2, Math.min(4, v.k * (ev.deltaY < 0 ? 1.15 : 1 / 1.15)));
    ed.view = { k, ox: mx - (mx - v.ox) * (k / v.k), oy: my - (my - v.oy) * (k / v.k) };
    ed.zoomed = true;
    edPaint();
  };
  cv.onmousedown = (ev) => {
    if (ev.button !== 0) return;
    const start = { x: ev.clientX, y: ev.clientY, ox: ed.view.ox, oy: ed.view.oy };
    ed.dragged = false;
    const move = (e) => {
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (!ed.dragged && Math.abs(dx) + Math.abs(dy) < 4) return;
      ed.dragged = true;
      ed.zoomed = true;
      ed.view = Object.assign({}, ed.view, { ox: start.ox + dx, oy: start.oy + dy });
      edPaint();
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      setTimeout(() => { ed.dragged = false; }, 0);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };
  cv.ondblclick = () => { if (ed.data) { edFit(); edPaint(); } };
  // панель над сценой: масштаб вокруг центра и «весь экран»
  const zoomBy = (f) => {
    if (!ed.data) return;
    const box = $('#ed-screen');
    const mx = box.clientWidth / 2;
    const my = box.clientHeight / 2;
    const v = ed.view;
    const k = Math.max(0.2, Math.min(4, v.k * f));
    ed.view = { k, ox: mx - (mx - v.ox) * (k / v.k), oy: my - (my - v.oy) * (k / v.k) };
    ed.zoomed = true;
    edPaint();
  };
  $('#ed-zoom-in').onclick = () => zoomBy(1.25);
  $('#ed-zoom-out').onclick = () => zoomBy(1 / 1.25);
  $('#ed-zoom-v').onclick = $('#ed-fit').onclick = () => { if (ed.data) { edFit(); edPaint(); } };
  $('#ed-tabs').querySelectorAll('button').forEach((b) => {
    b.onclick = () => {
      ed.tab = b.dataset.tab;
      $('#ed-tabs').querySelectorAll('button').forEach((x) => x.classList.toggle('is-on', x === b));
      edRenderList();
    };
  });
  $('#ed-search').oninput = debounce(edRenderList, 150);
})();
