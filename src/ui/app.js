'use strict';

/* Окно сборщика. Вся работа с клиентом — через preload (window.api). */

const DESIGN_W = 1280;
const DESIGN_H = 960;

const state = {
  profile: {
    layout: {},
    font: { enabled: false, file: '', langs: [] },
    packs: { skills: {}, hitnum: {}, uiatlas: {}, items: {} },
    skins: {},
    lang: 'rus',
  },
  dialogs: [],
  byId: new Map(),
  selected: null,
  scale: 1,
  languages: [],
  ready: false,
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

function toast(msg, bad) {
  const el = $('#toast');
  el.textContent = msg;
  el.className = 'toast on' + (bad ? ' bad' : '');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (el.className = 'toast'), 3200);
}

async function guard(fn) {
  try {
    return await fn();
  } catch (e) {
    toast(String(e && e.message ? e.message : e), true);
    return null;
  }
}

const saveProfile = debounce(async () => {
  await window.api.profile.save(state.profile);
  if (typeof presetRefresh === 'function') presetRefresh(); // presets.js: изменён ли включённый пресет
}, 400);

function debounce(fn, ms) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

/* ======================= опись диалогов ======================= */

async function loadCatalogue() {
  const list = await guard(() => window.api.catalogue.load());
  if (!list) return;
  state.dialogs = list;
  state.byId = new Map(list.map((d) => [d.id, d]));
  renderList();
  renderBoxes();
  renderBadges();
  fitCanvas();
}

function edited(id) {
  return !!state.profile.layout[id];
}

function effective(d) {
  const e = state.profile.layout[d.id] || {};
  return {
    frame: Object.assign({}, d.frame, e.frame || {}),
    movable: typeof e.movable === 'boolean' ? e.movable : d.movable,
    visible: typeof e.visible === 'boolean' ? e.visible : d.visible,
    widgets: e.widgets || {},
  };
}

function editOf(id) {
  if (!state.profile.layout[id]) state.profile.layout[id] = {};
  return state.profile.layout[id];
}

/** Если правка вернулась к исходному состоянию — убираем её совсем. */
function normalize(id) {
  const d = state.byId.get(id);
  const e = state.profile.layout[id];
  if (!d || !e) return;
  if (e.frame) {
    const f = e.frame;
    if (f.x === d.frame.x && f.y === d.frame.y && f.w === d.frame.w && f.h === d.frame.h) {
      delete e.frame;
    }
  }
  if (e.movable === d.movable) delete e.movable;
  if (e.visible === d.visible) delete e.visible;
  if (e.widgets && !Object.keys(e.widgets).length) delete e.widgets;
  if (!Object.keys(e).length) delete state.profile.layout[id];
}

function visibleDialogs() {
  const q = $('#dlg-search').value.trim().toLowerCase();
  const hudOnly = $('#dlg-hud-only').checked;
  const set = $('#hud-set').value;
  return state.dialogs.filter((d) => {
    // s1 и s2 — два набора одних и тех же диалогов; показываем только выбранный,
    // иначе в списке всё двоится.
    if ((d.pak === 'hud_s1' || d.pak === 'hud_s2') && d.pak !== set && !edited(d.id)) return false;
    if (hudOnly && d.group !== 'HUD' && !edited(d.id)) return false;
    if (!q) return true;
    return d.title.toLowerCase().includes(q) || d.dialog.toLowerCase().includes(q);
  });
}

function renderList() {
  const list = visibleDialogs();
  const groups = new Map();
  for (const d of list) {
    if (!groups.has(d.group)) groups.set(d.group, []);
    groups.get(d.group).push(d);
  }
  const html = [];
  for (const [g, items] of groups) {
    html.push(`<div class="list__group">${g}</div>`);
    for (const d of items) {
      const f = effective(d).frame;
      html.push(
        `<div class="item ${d.id === state.selected ? 'is-active' : ''} ` +
          `${edited(d.id) ? 'is-edited' : ''}" data-id="${d.id}">` +
          `<span>${d.title}</span><small>${f.x},${f.y}</small></div>`
      );
    }
  }
  const el = $('#dlg-list');
  el.innerHTML = html.join('');
  el.querySelectorAll('.item').forEach((n) => {
    n.onclick = () => select(n.dataset.id);
  });
}

function renderBadges() {
  const n = Object.keys(state.profile.layout).length;
  $('#badge-layout').textContent = n || '';
  $('#badge-font').textContent = state.profile.font.enabled ? '1' : '';
  const pt = state.profile.portrait;
  $('#badge-portrait').textContent = pt && pt.enabled ? '1' : '';
  $('#badge-buffs').textContent = Object.keys(state.profile.buffs || {}).length || '';
  const lookN = state.profile.look ? Object.values(state.profile.look.groups || {}).filter((s) => s !== 'own').length : 0;
  for (const id of ['skills', 'hitnum', 'uiatlas']) {
    const store = (state.profile.packs && state.profile.packs[id]) || {};
    // у иконок умений считаем семейства: ранги и серые — одна замена
    // у раздела «Иконки умений» — и семейства умений, и иконки предметов
    const n = id === 'skills'
      ? skFamilyCount(store) + Object.keys((state.profile.packs && state.profile.packs.items) || {}).length
      : Object.keys(store).length;
    $('#badge-' + id).textContent = n || '';
  }
  $('#badge-skins').textContent = Object.keys(state.profile.skins || {}).length || '';
  $('#badge-look').textContent = lookN || '';
  $('#badge-editor').textContent = Object.keys(state.profile.elements || {}).length || '';
  $('#badge-maps').textContent = Object.keys(state.profile.maps || {}).length || '';
  $('#badge-v5').textContent = state.profile.v5 && state.profile.v5.enabled ? '1' : '';
  const cl = state.profile.classic;
  const clOn = cl && cl.root ? (cl.enabled ? 1 : 0) + (cl.hud && cl.hud.enabled ? 1 : 0) : 0;
  $('#badge-classic').textContent = clOn || '';
}

/* ======================= поле раскладки ======================= */

function shownOnCanvas() {
  if ($('#opt-all').checked) return visibleDialogs();
  const set = new Set(visibleDialogs().filter((d) => d.group === 'HUD').map((d) => d.id));
  for (const id of Object.keys(state.profile.layout)) set.add(id);
  if (state.selected) set.add(state.selected);
  return [...set].map((id) => state.byId.get(id)).filter(Boolean);
}

function renderBoxes() {
  const canvas = $('#canvas');
  canvas.querySelectorAll('.box').forEach((n) => n.remove());
  for (const d of shownOnCanvas()) {
    const eff = effective(d);
    const box = document.createElement('div');
    box.className =
      'box' + (edited(d.id) ? ' is-edited' : '') + (d.id === state.selected ? ' is-active' : '');
    box.style.left = eff.frame.x + 'px';
    box.style.top = eff.frame.y + 'px';
    box.style.width = Math.max(eff.frame.w, 8) + 'px';
    box.style.height = Math.max(eff.frame.h, 8) + 'px';
    box.style.opacity = eff.visible ? '1' : '.35';
    box.dataset.id = d.id;
    box.innerHTML = `<span class="box__tag">${d.title}</span><span class="box__grip"></span>`;
    canvas.appendChild(box);
  }
}

function fitCanvas() {
  const wrap = $('.canvas-wrap');
  if (!wrap.clientWidth) return;
  const s = Math.min(wrap.clientWidth / DESIGN_W, wrap.clientHeight / DESIGN_H);
  state.scale = Math.max(0.2, Math.min(1, s));
  const c = $('#canvas');
  c.style.transform = `scale(${state.scale})`;
  // Трансформа не меняет место элемента в потоке, поэтому лишние габариты
  // снимаем обёрткой фиксированного размера — иначе появляется прокрутка.
  const holder = c.parentElement;
  holder.style.width = DESIGN_W * state.scale + 'px';
  holder.style.height = DESIGN_H * state.scale + 'px';
}

window.addEventListener('resize', fitCanvas);

$('#dlg-search').oninput = () => { renderList(); renderBoxes(); };
$('#dlg-hud-only').onchange = () => { renderList(); renderBoxes(); };
$('#opt-all').onchange = renderBoxes;
$('#opt-grid').onchange = (e) => $('#canvas-grid').classList.toggle('on', e.target.checked);
$('#hud-set').onchange = () => { renderList(); renderBoxes(); };

/* --- перетаскивание --- */

let drag = null;

$('#canvas').addEventListener('pointerdown', (e) => {
  const box = e.target.closest('.box');
  if (!box) return;
  const d = state.byId.get(box.dataset.id);
  if (!d) return;
  select(d.id);
  const f = effective(d).frame;
  const mode = e.target.classList.contains('box__grip') ? 'size' : 'move';
  // место таких окон игра выбирает сама — перетаскивание дало бы пустую правку
  if (mode === 'move' && codePlaced(d.id)) {
    toast('место этого окна игра выбирает сама — двигать бесполезно, меняется только размер');
    return;
  }
  drag = {
    id: d.id,
    mode,
    sx: e.clientX,
    sy: e.clientY,
    start: Object.assign({}, f),
  };
  // Захват указателя не обязателен: у синтетических событий его нет,
  // а вверх мы всё равно ловим на окне.
  try { box.setPointerCapture(e.pointerId); } catch (_) {}
  e.preventDefault();
});

window.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const step = e.shiftKey ? 10 : 1;
  const dx = Math.round((e.clientX - drag.sx) / state.scale / step) * step;
  const dy = Math.round((e.clientY - drag.sy) / state.scale / step) * step;
  const s = drag.start;
  const f =
    drag.mode === 'move'
      ? { x: s.x + dx, y: s.y + dy, w: s.w, h: s.h }
      : { x: s.x, y: s.y, w: Math.max(8, s.w + dx), h: Math.max(8, s.h + dy) };
  setFrame(drag.id, f, true);
});

function endDrag() {
  if (!drag) return;
  normalize(drag.id);
  drag = null;
  renderList();
  renderBadges();
  saveProfile();
}

window.addEventListener('pointerup', endDrag);
window.addEventListener('pointercancel', endDrag);

document.addEventListener('keydown', (e) => {
  if (!state.selected) return;
  if (document.activeElement && /INPUT|SELECT/.test(document.activeElement.tagName)) return;
  const map = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  const m = map[e.key];
  if (!m) return;
  const k = e.shiftKey ? 10 : 1;
  const f = Object.assign({}, effective(state.byId.get(state.selected)).frame);
  f.x += m[0] * k;
  f.y += m[1] * k;
  setFrame(state.selected, f);
  e.preventDefault();
});

function setFrame(id, f, light) {
  editOf(id).frame = f;
  const box = $(`.box[data-id="${CSS.escape(id)}"]`);
  if (box) {
    box.style.left = f.x + 'px';
    box.style.top = f.y + 'px';
    box.style.width = Math.max(f.w, 8) + 'px';
    box.style.height = Math.max(f.h, 8) + 'px';
    box.classList.add('is-edited');
  }
  syncPropInputs(f);
  if (!light) {
    normalize(id);
    renderList();
    renderBadges();
    saveProfile();
  }
}

function syncPropInputs(f) {
  const set = (sel, v) => {
    const el = $(sel);
    if (el && document.activeElement !== el) el.value = v;
  };
  set('#p-x', f.x); set('#p-y', f.y); set('#p-w', f.w); set('#p-h', f.h);
}

/* ======================= свойства ======================= */

function select(id) {
  state.selected = id;
  renderList();
  renderBoxes();
  renderProps();
}

/**
 * Окна, место которых игра выбирает сама: x/y из файла не читает (проверено в
 * игре 27.09 — окна наборов HUD, бафы, дебафы, цель, ряды умений). Размер и
 * элементы внутри — читает.
 */
const CODE_PLACED = new Set(['buff_status_dialog', 'debuff_status_dialog', 'target_dialog',
  'target_assist_dialog', 'quickbar_dialog_ctrl', 'quickbar_dialog_alt', 'quickbar_dialog_extra']);
const codePlaced = (id) => /^hud_s\d\//.test(id) ||
  CODE_PLACED.has(String(id).replace(/^game\//, '').replace(/\.xml$/, ''));

function renderProps() {
  const el = $('#props');
  const d = state.byId.get(state.selected);
  if (!d) {
    el.innerHTML = '<div class="muted pad">Выбери диалог слева или прямоугольник на поле.</div>';
    return;
  }
  const eff = effective(d);
  const widgets = d.widgets
    .map((w) => {
      const e = eff.widgets[w.name] || {};
      const on = typeof e.visible === 'boolean' ? e.visible : w.visible;
      const f = Object.assign({}, w.frame, e.frame || {});
      const changed = !!e.frame;
      const geom = w.frame
        ? `<div class="wgeom${changed ? ' is-edited' : ''}">` +
          ['x', 'y', 'w', 'h'].map((k) =>
            `<input type="number" data-wframe="${w.name}" data-k="${k}" value="${f[k]}" />`
          ).join('') +
          '</div>'
        : '';
      return (
        `<div class="wrow"><label class="check"><input type="checkbox" data-widget="${w.name}" ` +
        `${on ? 'checked' : ''} /> ${w.name} <span class="muted">${w.type}</span></label>${geom}</div>`
      );
    })
    .join('');

  el.innerHTML = `
    <div class="props__head">
      <b>${d.title}</b>
      <span>${d.dialog} · ${d.pak}</span>
    </div>
    <div class="props__body">
      <div class="props__grid">
        <label class="field"><span>X</span><input type="number" id="p-x" value="${eff.frame.x}" ${codePlaced(d.id) ? 'disabled' : ''} /></label>
        <label class="field"><span>Y</span><input type="number" id="p-y" value="${eff.frame.y}" ${codePlaced(d.id) ? 'disabled' : ''} /></label>
        <label class="field"><span>Ширина</span><input type="number" id="p-w" value="${eff.frame.w}" /></label>
        <label class="field"><span>Высота</span><input type="number" id="p-h" value="${eff.frame.h}" /></label>
      </div>
      <label class="check"><input type="checkbox" id="p-move" ${eff.movable ? 'checked' : ''} />
        можно таскать мышью в игре</label>
      <label class="check"><input type="checkbox" id="p-vis" ${eff.visible ? 'checked' : ''} />
        показывать</label>
      <div class="muted" style="font-size:12px">
        Привязка: ${d.hAlign || '—'} / ${d.vAlign || '—'}
      </div>
      <div class="hintbox">${codePlaced(d.id)
        ? '<b>Место этого окна игра выбирает сама</b> — X и Y из файла не читает, двигать его здесь бесполезно ' +
          '(проверено в игре). Размер и элементы внутри — читает. Карту и полосы HP/MP двигает ' +
          '«Вид интерфейса» → «Место карты».'
        : 'X и Y самого окна клиент может перекрыть своей сохранённой раскладкой — после установки нажми в игре ' +
          '<b>Настройки → «Расположить окна по умолчанию»</b>. Размеры и элементы внутри окна применяются сразу.'}
      </div>
      ${widgets ? '<h2 style="margin:8px 0 2px">Элементы внутри</h2>' +
        '<div class="muted" style="font-size:11px;margin:-4px 0 4px">' +
        'галка — показывать, четыре поля — X, Y, ширина, высота</div>' +
        '<div class="widgets">' + widgets + '</div>' : ''}
      <div class="row" style="margin-top:8px">
        <button class="btn" id="p-xml">Показать XML</button>
        <button class="btn btn--danger" id="p-reset" ${edited(d.id) ? '' : 'disabled'}>Сбросить</button>
      </div>
    </div>`;

  ['x', 'y', 'w', 'h'].forEach((k) => {
    $('#p-' + k).oninput = () => {
      const f = {
        x: +$('#p-x').value || 0,
        y: +$('#p-y').value || 0,
        w: +$('#p-w').value || 0,
        h: +$('#p-h').value || 0,
      };
      setFrame(d.id, f);
    };
  });

  $('#p-move').onchange = (e) => {
    editOf(d.id).movable = e.target.checked;
    normalize(d.id);
    renderList(); renderBadges(); saveProfile();
  };
  $('#p-vis').onchange = (e) => {
    editOf(d.id).visible = e.target.checked;
    normalize(d.id);
    renderList(); renderBoxes(); renderBadges(); saveProfile();
  };
  const widgetEdit = (name) => {
    const e = editOf(d.id);
    if (!e.widgets) e.widgets = {};
    if (!e.widgets[name]) e.widgets[name] = {};
    return e.widgets[name];
  };
  /** Правка виджета, совпавшая с оригиналом, из профиля убирается. */
  const tidyWidget = (name) => {
    const e = state.profile.layout[d.id];
    const w = d.widgets.find((x) => x.name === name);
    const cur = e && e.widgets && e.widgets[name];
    if (!cur || !w) return;
    if (cur.visible === w.visible) delete cur.visible;
    if (cur.frame && w.frame && ['x', 'y', 'w', 'h'].every((k) => cur.frame[k] === w.frame[k])) {
      delete cur.frame;
    }
    if (!Object.keys(cur).length) delete e.widgets[name];
    normalize(d.id);
  };

  el.querySelectorAll('[data-widget]').forEach((n) => {
    n.onchange = () => {
      widgetEdit(n.dataset.widget).visible = n.checked;
      tidyWidget(n.dataset.widget);
      renderList(); renderBadges(); saveProfile();
    };
  });

  el.querySelectorAll('[data-wframe]').forEach((n) => {
    n.oninput = () => {
      const name = n.dataset.wframe;
      const w = d.widgets.find((x) => x.name === name);
      const cur = widgetEdit(name);
      const f = Object.assign({}, w.frame, cur.frame || {});
      f[n.dataset.k] = Number(n.value) || 0;
      cur.frame = f;
      n.closest('.wgeom').classList.add('is-edited');
      tidyWidget(name);
      renderList(); renderBadges(); saveProfile();
    };
  });
  $('#p-xml').onclick = () =>
    guard(async () => {
      const xml = await window.api.catalogue.xml(d.id);
      showXml(d.title, xml);
    });
  $('#p-reset').onclick = () => {
    delete state.profile.layout[d.id];
    renderList(); renderBoxes(); renderProps(); renderBadges(); saveProfile();
  };
}

function showXml(title, xml) {
  const view = $('.view[data-view="apply"]');
  $$('.nav').forEach((x) => x.classList.toggle('is-active', x.dataset.view === 'apply'));
  $$('.view').forEach((v) => v.classList.toggle('is-active', v === view));
  $('#apply-log').textContent = '// ' + title + '\n' + xml;
}

/* ======================= подложка ======================= */

async function loadShots() {
  const names = await window.api.shots.list();
  const sel = $('#shot-pick');
  sel.innerHTML =
    '<option value="">без подложки</option>' +
    names.map((n) => `<option value="${n}">${n}</option>`).join('');
  sel.onchange = async () => {
    const img = $('#canvas-shot');
    if (!sel.value) { img.removeAttribute('src'); return; }
    img.src = (await window.api.shots.read(sel.value)) || '';
  };
  if (names.length) { sel.value = names[0]; sel.onchange(); }
}

/* ======================= вид Aion 5.x ======================= */

let v5plan = null;

function v5rules() {
  if (!state.profile.v5) state.profile.v5 = {};
  if (!state.profile.v5.rules) state.profile.v5.rules = { variant: false };
  return state.profile.v5.rules;
}

async function loadV5(force) {
  if (!state.ready) return;
  $('#v5-on').checked = !!(state.profile.v5 && state.profile.v5.enabled);
  if (v5plan && !force) return;
  const p = await guard(() => window.api.v5.plan(v5rules()));
  if (!p) return;
  v5plan = p;

  $('#v5-stats').innerHTML = [
    ['Деталей всего', p.total],
    ['Переносится на вид 5.x', p.matched],
    ['Останется прежними', p.unmatched],
    ['Пропущено — нет картинки', p.noAtlas.length ? p.noAtlas.join(', ') : 'нет'],
  ].map(([k, v]) => `<b>${k}</b><span>${v}</span>`).join('');

  const rules = v5rules();
  $('#v5-rules').innerHTML = p.rules.map((r) =>
    `<label class="v5rule${r.safe ? '' : ' is-risky'}">` +
    `<span class="check"><input type="checkbox" data-rule="${r.id}" ` +
    `${rules[r.id] === false ? '' : 'checked'} ${r.id === 'exact' ? 'disabled' : ''} /></span>` +
    `<b>+${r.count}</b><span>${r.title}</span> <small>${r.hint}</small></label>`
  ).join('');
  $('#v5-rules').querySelectorAll('[data-rule]').forEach((n) => {
    n.onchange = () => {
      v5rules()[n.dataset.rule] = n.checked;
      saveProfile();
      loadV5(true);
    };
  });

  $('#v5-extra').innerHTML = p.extra.length
    ? p.extra.map((x) => `${x.name} &rarr; ${x.to} <span>[${x.rule}]</span>`).join('<br>')
    : '<span>правила ничего не добавили</span>';

  $('#v5-cats').innerHTML = p.byCategory
    .map(([cat, n]) => `<div><b>${n}</b><span>${cat}</span></div>`).join('');
  $('#v5-rest').innerHTML = p.restByCategory
    .map(([cat, n]) => `<div><b>${n}</b><span>${cat}</span></div>`).join('')
    || '<span class="muted">не осталось</span>';

  const box = $('#v5-samples');
  box.innerHTML = '';
  for (const s of p.samples) {
    const cell = document.createElement('div');
    cell.className = 'v5pair';
    cell.innerHTML =
      `<div class="v5pair__name">${s.name}</div>` +
      '<div class="v5pair__row">' +
      '<div class="v5pair__cell"><div class="skinprev" data-side="from"></div><small>было</small></div>' +
      '<div class="v5pair__arrow">&rarr;</div>' +
      '<div class="v5pair__cell"><div class="skinprev" data-side="to"></div><small>станет</small></div>' +
      '</div>';
    box.appendChild(cell);
    paintSkinInto(cell.querySelector('[data-side="from"]'), s.from);
    paintSkinInto(cell.querySelector('[data-side="to"]'), s.after);
  }
}

/**
 * @param {Function} [get] откуда брать кусок атласа; по умолчанию — наш клиент
 */
async function paintSkinInto(box, spec, get) {
  const parts = String(spec.rect || '').split(',').map(Number);
  if (parts.length !== 4) { box.innerHTML = '<span class="muted">—</span>'; return; }
  const piece = get || ((t, r, pad) => window.api.skins.preview(t, r, pad));
  const img = await skWait(box, guard(() => piece(spec.texture,
    { x: parts[0], y: parts[1], w: parts[2], h: parts[3] }, 2)));
  if (!img) { box.innerHTML = '<span class="muted">нет картинки</span>'; box.classList.add('is-empty'); return; }
  const cv = document.createElement('canvas');
  cv.width = img.width;
  cv.height = img.height;
  cv.getContext('2d').putImageData(
    new ImageData(new Uint8ClampedArray(img.rgba), img.width, img.height), 0, 0);
  const scale = Math.min(3, Math.max(1, Math.floor(120 / Math.max(img.width, 1))));
  cv.style.width = img.width * scale + 'px';
  box.innerHTML = '';
  box.appendChild(cv);
}

$('#v5-on').onchange = (e) => {
  if (!state.profile.v5) state.profile.v5 = {};
  state.profile.v5.enabled = e.target.checked;
  clNote();
  renderBadges();
  renderSummary();
  saveProfile();
};

/* ======================= вид официального Classic ======================= */

let clPlan = null;
let clPlanFor = '';

function clState() {
  if (!state.profile.classic) state.profile.classic = { enabled: false, root: '', off: {}, rules: {} };
  if (!state.profile.classic.off) state.profile.classic.off = {};
  if (!state.profile.classic.rules) state.profile.classic.rules = {};
  if (!state.profile.classic.hud) state.profile.classic.hud = { enabled: false, off: {} };
  if (!state.profile.classic.hud.off) state.profile.classic.hud.off = {};
  return state.profile.classic;
}

/* окна HUD */

async function loadClassicHud() {
  const cl = clState();
  $('#cl-hud-on').checked = !!cl.hud.enabled;
  if (!cl.root) return;
  const h = await guard(() => window.api.classic.hud(cl.root, cl.hud));
  const box = $('#cl-hud');
  if (!h) { box.innerHTML = '<span class="muted">не удалось прочитать</span>'; return; }
  const fr = (f) => (f ? `${f.w}×${f.h}` : '—');
  box.innerHTML =
    h.dialogs.map((d) =>
      `<div class="clhud__row${d.error ? ' is-bad' : ''}">` +
      `<label class="check"><input type="checkbox" data-hud="${esc(d.id)}" ${d.on && !d.error ? 'checked' : ''} ${d.error ? 'disabled' : ''} />` +
      `<b>${esc(d.title)}</b></label>` +
      `<span class="clhud__size">${d.error ? esc(d.error) : fr(d.frame[0]) + ' → ' + fr(d.frame[1])}` +
      `${d.shared ? ' · в обоих наборах' : ''}</span>` +
      (d.error ? '' :
        `<small>${d.dropped.length ? 'убрано чужих: ' + esc(d.dropped.join(', ')) : 'чужих виджетов нет'}` +
        `${d.grafted.length ? '; возвращено своих: ' + esc(d.grafted.join(', ')) : ''}</small>`) +
      '</div>').join('') +
    '<div class="clhud__opts">' +
    `<label class="field"><span>Куда ставить новый HUD</span><select id="cl-hud-set" class="sel sel--sm">` +
    '<option value="s1">«Стиль Aion» — цель по центру, всё внизу</option>' +
    '<option value="s2">«Обычный стиль» — полосы вверху, цель прилипает к ним</option></select></label>' +
    `<label class="field"><span>Мини-карта</span><select id="cl-radar-size" class="sel sel--sm">` +
    `<option value="ours">размером как была</option><option value="official">размером как у официального</option></select></label>` +
    `<label class="field"><span>Значки почты, магазинов, пропуска</span><select id="cl-icons" class="sel sel--sm">` +
    '<option value="under">в ряд под картой</option>' +
    '<option value="corner">в правый нижний угол экрана (пропадёт боковая панель III)</option>' +
    '<option value="off">вокруг карты, как были</option></select></label>' +
    '<small class="muted">В наборе s2 игра расставляет окна HUD сама: координаты из файлов не слушает, ' +
    'только размеры. Поэтому панель умений и полоса опыта делаются шириной в экран (размер экрана — из ' +
    'system.cfg), меню уходит в правый нижний угол. Значки «в угол» требуют растянуть окно карты до низа ' +
    'экрана — тогда игре некуда поставить боковую панель умений (III), она уходит за экран. ' +
    'Место цели не поддаётся ни координатам, ни размерам — ' +
    'окно цели подвижное, как у официального: поставь его мышью, игра запомнит.</small>' +
    '</div>' +
    `<div class="clhud__foot muted">допишется в библиотеку: скинов ${h.skins}, пресетов ${h.presets}; ` +
    `атласов к паку ${h.atlases}${h.missing.length ? '; не нашлось: ' + esc(h.missing.join(', ')) : ''}</div>`;
  const hud = clState().hud;
  $('#cl-hud-set').value = hud.set || h.setDefault || 's1';
  // другой набор — другие окна в списке: перечитать
  $('#cl-hud-set').onchange = (e) => { hud.set = e.target.value; saveProfile(); renderSummary(); loadClassicHud(); };
  $('#cl-radar-size').value = hud.radarSize || 'ours';
  $('#cl-icons').value = hud.icons || (hud.iconsRow === false ? 'off' : h.iconsDefault || 'under');
  delete hud.targetPad; // больше не используется: цель ставится мышью
  const hudChanged = () => { saveProfile(); renderSummary(); };
  $('#cl-radar-size').onchange = (e) => { hud.radarSize = e.target.value; hudChanged(); };
  $('#cl-icons').onchange = (e) => { hud.icons = e.target.value; delete hud.iconsRow; hudChanged(); };
  box.querySelectorAll('[data-hud]').forEach((n) => {
    n.onchange = () => {
      // false — «включено явно»: у цели по умолчанию выключено
      clState().hud.off[n.dataset.hud] = !n.checked;
      saveProfile();
      renderSummary();
      loadClassicHud();
    };
  });
}

/* карты */

let clMapsFor = '';
async function loadClassicMaps() {
  const cl = clState();
  $('#cl-maps-on').checked = !!cl.maps;
  if (!cl.root || clMapsFor === cl.root) return;
  const box = $('#cl-maps');
  box.innerHTML = '<span class="muted">сравниваю карты двух клиентов — секунд десять…</span>';
  const m = await guard(() => window.api.classic.maps(cl.root));
  if (!m) { box.innerHTML = '<span class="muted">не удалось прочитать</span>'; return; }
  clMapsFor = cl.root;
  const row = (z) =>
    `<div class="${z.replace ? 'is-on' : ''}"><b>${z.replace ? 'меняем' : 'не трогаем'}</b>` +
    `<span>${esc(z.zone)}</span><small>${esc(z.sub)}: перекрашено ${z.take}, та же картинка ${z.same}, ` +
    `другая местность ${z.other}</small></div>`;
  box.innerHTML = `<div class="clmaps__sum">заменится тайлов: <b>${m.tiles}</b></div>` +
    m.zones.map(row).join('');
}

$('#cl-maps-on').onchange = (e) => {
  clState().maps = e.target.checked;
  renderSummary();
  saveProfile();
};

$('#cl-hud-on').onchange = (e) => {
  clState().hud.enabled = e.target.checked;
  renderBadges();
  renderSummary();
  saveProfile();
};

const CL_SRC = { same: 'перерисовано' };
const clCat = (cat) => cat || 'без группы';
const clLib = (lib) => lib.replace(/\.xml$/i, '');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function clSetState(text, cls) {
  const st = $('#cl-state');
  st.className = 'state' + (cls ? ' ' + cls : '');
  st.textContent = text;
}

function clNote() {
  const cl = clState();
  $('#cl-v5-note').style.display =
    cl.enabled && state.profile.v5 && state.profile.v5.enabled ? '' : 'none';
}

/* импорт официального клиента в папку программы */

async function renderImportState() {
  const cl = clState();
  const st = $('#cl-import-state');
  const re = $('#cl-reimport');
  re.style.display = 'none';
  const info = cl.root ? await guard(() => window.api.classic.info(cl.root)) : null;
  if (!info) { st.className = 'state'; st.textContent = 'нет'; return; }
  if (!info.imported) {
    st.className = 'state warn';
    st.textContent = 'читаю прямо из клиента — импортируй, чтобы программа не зависела от него';
    re.textContent = 'Импортировать';
    re.style.display = '';
    re.onclick = () => runImport(cl.root);
    return;
  }
  const when = new Date(info.importedAt).toLocaleString('ru-RU',
    { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const maps = info.maps ? `, карт ${info.maps.tiles}` : '';
  st.className = 'state ' + (info.stale ? 'warn' : 'ok');
  st.textContent = `${when} из ${info.source} — ${Math.round(info.bytes / 1e6)} МБ${maps}` +
    (info.stale ? '. Официальный клиент обновился — обнови импорт' : '');
  re.textContent = 'Обновить импорт';
  re.style.display = '';
  re.onclick = () => runImport(info.source);
}

async function runImport(src) {
  const cl = clState();
  const btns = [$('#cl-pick'), $('#cl-reimport')];
  btns.forEach((b) => { b.disabled = true; });
  clSetState('импорт: начинаю…');
  let info = null;
  try {
    info = await guard(() => window.api.classic.import(src));
  } finally {
    btns.forEach((b) => { b.disabled = false; });
  }
  if (!info) { clSetState('импорт не удался', 'bad'); return; }
  cl.root = info.root;
  cl.source = info.source;
  saveProfile();
  // всё, что читалось из прежней папки, перечитать
  lk.plan = null;
  clPlan = null;
  clMapsFor = '';
  toast(`импортировано: ${Math.round(info.bytes / 1e6)} МБ`);
  await loadClassic(true);
}

window.api.classic.onImportProgress((msg) => clSetState('импорт: ' + msg));

async function loadClassic(force) {
  if (!state.ready) return;
  const cl = clState();
  $('#cl-on').checked = !!cl.enabled;
  clNote();
  if (!cl.root) {
    const guess = await guard(() => window.api.classic.guess());
    if (guess) { cl.root = guess; saveProfile(); }
  }
  $('#cl-path').value = cl.root || '';
  renderImportState();
  if (!cl.root) {
    clSetState('папка не выбрана');
    return;
  }
  const key = cl.root + '|' + (state.profile.lang || 'rus');
  if (clPlan && clPlanFor === key && !force) { renderClassic(); loadClassicHud(); loadClassicMaps(); return; }
  clSetState('читаю официальный клиент…');
  const p = await guard(() => window.api.classic.plan(cl.root, cl.rules));
  if (!p) { clSetState('не удалось прочитать', 'bad'); return; }
  if (!p.ok) {
    clPlan = null;
    clSetState('не хватает: ' + (p.missing || []).join(', '), 'bad');
    return;
  }
  clPlan = p;
  clPlanFor = key;
  renderClassic();
  paintClassicSamples();
  loadClassicHud();
  loadClassicMaps();
}

function clPicked() {
  const off = clState().off;
  return clPlan ? clPlan.cats.filter((c) => !off[c.key]).reduce((s, c) => s + c.count, 0) : 0;
}

function renderClassic() {
  const p = clPlan;
  if (!p) return;
  const cl = clState();
  const off = cl.off;
  clSetState('прочитан, языки: ' + (p.languages.join(', ') || 'нет'), 'ok');

  $('#cl-stats').innerHTML = [
    ['Изменится на экране', p.total],
    ['Выбрано к переносу', clPicked()],
    ['Атласов доложить', `до ${p.atlases} (${p.atlasMb} МБ до сжатия)`],
    ['Нет картинки у донора', p.noAtlas.length ? p.noAtlas.join(', ') : 'нет'],
  ].map(([k, v]) => `<b>${k}</b><span>${v}</span>`).join('');

  $('#cl-rules').innerHTML = p.sources.map((s) =>
    `<label class="v5rule${s.safe ? '' : ' is-risky'}">` +
    `<span class="check"><input type="checkbox" data-src="${s.id}" ${s.on ? 'checked' : ''} /></span>` +
    `<b>${p.bySource[s.id]}</b><span>${esc(s.title)}</span> <small>${esc(s.hint)}</small></label>`
  ).join('');
  $('#cl-rules').querySelectorAll('[data-src]').forEach((n) => {
    n.onchange = async () => {
      // явно и «да», и «нет»: у части источников умолчание — выключено
      clState().rules[n.dataset.src] = n.checked;
      saveProfile();
      await loadClassic(true);
      renderSummary();
    };
  });

  // группы — по библиотекам
  const byLib = new Map();
  for (const c of p.cats) {
    if (!byLib.has(c.lib)) byLib.set(c.lib, []);
    byLib.get(c.lib).push(c);
  }
  $('#cl-cats').innerHTML = [...byLib].map(([lib, cats]) =>
    '<div class="clcats__lib">' +
    `<div class="clcats__head">${esc(clLib(lib))}</div>` +
    '<div class="clcats__grid">' +
    cats.map((c) =>
      `<label class="check${c.count ? '' : ' is-empty'}">` +
      `<input type="checkbox" data-key="${esc(c.key)}" ${off[c.key] ? '' : 'checked'} />` +
      `<span>${esc(clCat(c.cat))}</span>${c.v3 ? '<i class="cltag" title="есть детали нового вида">v3</i>' : ''}` +
      `<b>${c.count}</b></label>`).join('') +
    '</div></div>'
  ).join('') || '<span class="muted">переносить нечего — всё уже совпадает</span>';
  $('#cl-cats').querySelectorAll('[data-key]').forEach((n) => {
    n.onchange = () => {
      if (n.checked) delete clState().off[n.dataset.key];
      else clState().off[n.dataset.key] = true;
      clAfterPick();
    };
  });
  $('#cl-picked').textContent = `выбрано ${clPicked()} из ${p.total}`;

  $('#cl-libs').innerHTML = p.perLib.map((l) => l.absent
    ? `<div><b>—</b><span>${esc(clLib(l.lib))}</span><small>у официального клиента такой библиотеки нет</small></div>`
    : `<div><b>${l.moved}</b><span>${esc(clLib(l.lib))}</span>` +
      `<small>из ${l.total}` +
      `${l.v3 ? '; новый вид ' + l.v3 : ''}${l.redrawn ? '; перерисовано ' + l.redrawn : ''}` +
      `; выглядит так же ${l.same}; нет у официального ${l.only}</small></div>`
  ).join('');
}

function clAfterPick() {
  $('#cl-picked').textContent = `выбрано ${clPicked()} из ${clPlan ? clPlan.total : 0}`;
  renderClassic();
  renderSummary();
  saveProfile();
}

function paintClassicSamples() {
  const box = $('#cl-samples');
  box.innerHTML = '';
  if (!clPlan || !clPlan.samples.length) {
    box.innerHTML = '<span class="muted">нечего показать</span>';
    return;
  }
  const root = clState().root;
  const fromDonor = (t, r, pad) => window.api.classic.preview(root, t, r, pad);
  for (const s of clPlan.samples) {
    const cell = document.createElement('div');
    cell.className = 'v5pair';
    cell.innerHTML =
      `<div class="v5pair__name">${esc(s.name)} <span class="v5pair__why">` +
      `${s.src === 'same' ? CL_SRC.same : '→ ' + esc(s.to)}</span></div>` +
      '<div class="v5pair__row">' +
      '<div class="v5pair__cell"><div class="skinprev" data-side="from"></div><small>сейчас</small></div>' +
      '<div class="v5pair__arrow">&rarr;</div>' +
      '<div class="v5pair__cell"><div class="skinprev" data-side="to"></div><small>официальный</small></div>' +
      '</div>';
    box.appendChild(cell);
    paintSkinInto(cell.querySelector('[data-side="from"]'), s.from);
    paintSkinInto(cell.querySelector('[data-side="to"]'), s.after, fromDonor);
  }
}

$('#cl-on').onchange = (e) => {
  clState().enabled = e.target.checked;
  clNote();
  renderBadges();
  renderSummary();
  saveProfile();
};

$('#cl-pick').onclick = () =>
  guard(async () => {
    const r = await window.api.classic.pick();
    if (!r) return;
    if (!r.ok) throw new Error('это не клиент Aion: не хватает ' + r.missing.join(', '));
    await runImport(r.root);
  });

$('#cl-all').onclick = () => { clState().off = {}; clAfterPick(); };
$('#cl-none').onclick = () => {
  const off = {};
  for (const c of (clPlan ? clPlan.cats : [])) off[c.key] = true;
  clState().off = off;
  clAfterPick();
};

/* ======================= скины ======================= */

const skins = { rows: [], selected: null, atlases: [], loadedFor: null };

function skinStore() {
  if (!state.profile.skins) state.profile.skins = {};
  return state.profile.skins;
}

async function loadSkins(force) {
  if (!state.ready) return; // клиент ещё не выбран — данных взять неоткуда
  const key = $('#skin-lib').value + '|' + $('#skin-search').value.trim();
  if (skins.loadedFor === key && !force) return;
  if (!skins.atlases.length) {
    skins.atlases = (await guard(() => window.api.skins.atlases())) || [];
  }
  const res = await guard(() =>
    window.api.skins.list($('#skin-search').value.trim(), $('#skin-lib').value));
  if (!res) return;
  skins.loadedFor = key;
  skins.rows = res.rows;

  const sel = $('#skin-lib');
  if (!sel.options.length) {
    sel.innerHTML = '<option value="">обе библиотеки</option>' +
      res.libs.map((l) => `<option value="${l}">${l.replace(/\.xml$/, '')}</option>`).join('');
  }
  $('#skin-count').textContent = res.found > res.shown
    ? `показано ${res.shown} из ${res.found} (всего ${res.total})`
    : `найдено ${res.found} из ${res.total}`;

  const store = skinStore();
  $('#skin-list').innerHTML = res.rows.map((r) =>
    `<div class="skin${store[r.key] ? ' is-edited' : ''}" data-key="${r.key}">` +
    `<b>${r.name}</b><em>${r.category}</em><span>${r.atlas}${r.nine ? ' · 9' : ''}</span></div>`
  ).join('');
  $('#skin-list').querySelectorAll('.skin').forEach((n) => {
    n.onclick = () => selectSkin(n.dataset.key);
  });
}

function skinEdit(key) {
  const store = skinStore();
  if (!store[key]) store[key] = {};
  return store[key];
}

function effectiveSkin(row) {
  const e = skinStore()[row.key] || {};
  return {
    texture: e.texture || row.texture,
    rect: Object.assign({}, row.rect, (e.rects || {})[row.fields[0]] || {}),
  };
}

async function selectSkin(key) {
  skins.selected = key;
  const row = skins.rows.find((r) => r.key === key);
  $('#skin-list').querySelectorAll('.skin').forEach((n) =>
    n.classList.toggle('is-active', n.dataset.key === key));
  if (!row) return;

  const eff = effectiveSkin(row);
  const el = $('#skin-props');
  el.innerHTML = `
    <div class="props__head"><b>${row.name}</b><span>${row.category} · ${row.lib}</span></div>
    <div class="props__body">
      <div class="skinprev" id="skin-prev"><span class="muted">рисую…</span></div>
      <div class="muted" style="font-size:11px" id="skin-from"></div>
      <label class="field"><span>Атлас</span>
        <select id="skin-tex" class="sel" style="width:100%"></select></label>
      <div class="props__grid">
        <label class="field"><span>X</span><input type="number" id="skin-x" value="${eff.rect.x}" /></label>
        <label class="field"><span>Y</span><input type="number" id="skin-y" value="${eff.rect.y}" /></label>
        <label class="field"><span>Ширина</span><input type="number" id="skin-w" value="${eff.rect.w}" /></label>
        <label class="field"><span>Высота</span><input type="number" id="skin-h" value="${eff.rect.h}" /></label>
      </div>
      ${row.nine ? '<div class="muted" style="font-size:11px">У этой детали девять кусков ' +
        '(растягивающаяся рамка). Здесь правится только средний — остальные пока не трогаем.</div>' : ''}
      <div class="row">
        <button class="btn btn--danger" id="skin-reset" ${skinStore()[row.key] ? '' : 'disabled'}>Сбросить</button>
      </div>
    </div>`;

  const tex = $('#skin-tex');
  const all = skins.atlases.includes(eff.texture) ? skins.atlases : [eff.texture, ...skins.atlases];
  tex.innerHTML = all.map((a) =>
    `<option value="${a}"${a.toLowerCase() === eff.texture.toLowerCase() ? ' selected' : ''}>` +
    `${a.replace(/^textures\/ui\//i, '')}</option>`).join('');

  const push = () => {
    const e = skinEdit(row.key);
    e.texture = tex.value;
    e.rects = e.rects || {};
    e.rects[row.fields[0]] = {
      x: +$('#skin-x').value || 0, y: +$('#skin-y').value || 0,
      w: +$('#skin-w').value || 0, h: +$('#skin-h').value || 0,
    };
    // правка, совпавшая с оригиналом, из профиля убирается
    const same = e.texture === row.texture &&
      ['x', 'y', 'w', 'h'].every((k) => e.rects[row.fields[0]][k] === row.rect[k]);
    if (same) delete skinStore()[row.key];
    renderBadges();
    saveProfile();
    drawSkinPreview(row);
    const li = $(`#skin-list .skin[data-key="${CSS.escape(row.key)}"]`);
    if (li) li.classList.toggle('is-edited', !same);
  };
  tex.onchange = push;
  ['x', 'y', 'w', 'h'].forEach((k) => { $('#skin-' + k).oninput = push; });
  $('#skin-reset').onclick = () => {
    delete skinStore()[row.key];
    renderBadges(); saveProfile(); selectSkin(key);
  };

  drawSkinPreview(row);
}

async function drawSkinPreview(row) {
  const eff = effectiveSkin(row);
  const box = $('#skin-prev');
  if (!box) return;
  const img = await skWait(box, guard(() => window.api.skins.preview(eff.texture, eff.rect, 6)));
  if (!img || !box.isConnected) return;
  const cv = document.createElement('canvas');
  cv.width = img.width;
  cv.height = img.height;
  cv.getContext('2d').putImageData(
    new ImageData(new Uint8ClampedArray(img.rgba), img.width, img.height), 0, 0);
  const scale = Math.min(4, Math.max(1, Math.floor(240 / Math.max(img.width, 1))));
  cv.style.width = img.width * scale + 'px';
  box.innerHTML = '';
  box.appendChild(cv);
  const from = $('#skin-from');
  if (from) {
    from.textContent = `вырезано из ${img.from} · атлас ${img.atlas[0]}×${img.atlas[1]}`;
  }
}

$('#skin-search').oninput = debounce(() => loadSkins(true), 250);
$('#skin-lib').onchange = () => loadSkins(true);

/* ======================= портрет ======================= */

const PT_FIELDS = {
  '#pt-x': 'x', '#pt-y': 'y', '#pt-size': 'size',
  '#pt-md': 'maleDist', '#pt-fd': 'femaleDist',
  '#pt-mh': 'maleHeight', '#pt-fh': 'femaleHeight',
};

async function initPortrait() {
  const { presets, stock, defaults } = await window.api.portrait.presets();
  state.portraitStock = stock;
  if (!state.profile.portrait) state.profile.portrait = defaults;
  $('#pt-preset').innerHTML = presets
    .map((p) => `<option value="${p.id}">${p.title}</option>`)
    .join('');

  $('#pt-preset').onchange = async () => {
    const next = await window.api.portrait.fromPreset(+$('#pt-preset').value);
    Object.assign(state.profile.portrait, next);
    renderPortrait();
    saveProfile();
  };
  $('#pt-on').onchange = (e) => {
    state.profile.portrait.enabled = e.target.checked;
    renderBadges();
    saveProfile();
  };
  $('#pt-stock').onclick = () => {
    Object.assign(state.profile.portrait, state.portraitStock, { preset: 1 });
    renderPortrait();
    saveProfile();
  };
  for (const [sel, key] of Object.entries(PT_FIELDS)) {
    $(sel).oninput = () => {
      state.profile.portrait[key] = Number($(sel).value) || 0;
      drawPortraitBox();
      saveProfile();
    };
  }
  renderPortrait();
}

function renderPortrait() {
  const p = state.profile.portrait;
  if (!p) return;
  $('#pt-on').checked = !!p.enabled;
  $('#pt-preset').value = p.preset || 1;
  for (const [sel, key] of Object.entries(PT_FIELDS)) $(sel).value = p[key];
  drawPortraitBox();
  renderBadges();
}

function drawPortraitBox() {
  const p = state.profile.portrait;
  const box = $('#pt-box');
  if (!box || !p) return;
  // Координаты виджета отсчитываются от левого верхнего угла диалога,
  // а диалог в предпросмотре стоит в точке (20; 360-20-151).
  box.style.left = 20 + p.x + 'px';
  box.style.top = 360 - 20 - 151 + p.y + 'px';
  box.style.width = p.size + 'px';
  box.style.height = p.size + 'px';
  $('#pt-box-label').textContent = `${p.size}×${p.size}`;
}

/* ======================= шрифт ======================= */

function renderFontLangs() {
  const box = $('#font-langs');
  const chosen = state.profile.font.langs || [];
  box.innerHTML = state.languages
    .map(
      (l) =>
        `<button class="chip ${!chosen.length || chosen.includes(l) ? 'is-on' : ''}" ` +
        `data-lang="${l}">${l}</button>`
    )
    .join('') || '<span class="muted">языков не нашёл</span>';
  box.querySelectorAll('.chip').forEach((c) => {
    c.onclick = () => {
      const cur = new Set(state.profile.font.langs && state.profile.font.langs.length
        ? state.profile.font.langs
        : state.languages);
      const l = c.dataset.lang;
      if (cur.has(l)) cur.delete(l); else cur.add(l);
      state.profile.font.langs = [...cur];
      renderFontLangs();
      saveProfile();
    };
  });
}

$('#font-pick').onclick = () =>
  guard(async () => {
    const f = await window.api.font.pick();
    if (!f) return;
    state.profile.font.file = f;
    state.profile.font.enabled = true;
    $('#font-path').value = f;
    $('#font-on').checked = true;
    applyFontPreview(f);
    renderBadges();
    saveProfile();
  });

$('#font-on').onchange = (e) => {
  state.profile.font.enabled = e.target.checked;
  renderBadges();
  saveProfile();
};

function applyFontPreview(file) {
  if (!file) return;
  const url = 'file:///' + file.replace(/\\/g, '/').replace(/^\/+/, '');
  const style = document.getElementById('font-face') || document.createElement('style');
  style.id = 'font-face';
  style.textContent = `@font-face { font-family: 'aion-pick'; src: url("${url}"); }
    #font-preview { font-family: 'aion-pick', var(--font); }`;
  document.head.appendChild(style);
}

/* ======================= картинки ======================= */

/*
 * Иконок семь тысяч, поэтому ячейки создаём сразу все (это дёшево), а сами
 * картинки просим у клиента пачками по мере прокрутки.
 */
const icons = { pack: 'skills', info: [], loadedFor: null, observer: null, pending: new Set() };

function packInfo(id) {
  return icons.info.find((p) => p.id === id) || { title: 'Картинки', rel: '', size: 0 };
}

function packStore(id) {
  if (!state.profile.packs) state.profile.packs = {};
  if (!state.profile.packs[id]) state.profile.packs[id] = {};
  return state.profile.packs[id];
}

async function loadIcons(force) {
  const key = icons.pack + '|' + $('#icon-search').value.trim();
  if (icons.loadedFor === key && !force) return;
  if (!icons.info.length) icons.info = (await guard(() => window.api.packs.info())) || [];

  const info = packInfo(icons.pack);
  $('#icon-title').textContent = info.title;
  const ledes = {
    skills: 'Иконки лежат в <code>data/skills/skills.pak</code>, 64×64. Серые двойники скрыты — ' +
      'их клиент показывает на откате умения.',
    hitnum: 'Цифры 0–9 в восьми цветах и знаки — из <code>textures/ui/hit_number</code>. ' +
      'Таблички <code>critical</code>, <code>block</code>, <code>dodge</code>, ' +
      '<code>parry</code>, <code>resist</code> показываются переведённые, из ' +
      '<code>l10n/&lt;язык&gt;/textures</code> — здесь именно они, общие корейские скрыты. ' +
      'Размер берётся у оригинала.',
    uiatlas: 'Атласы и картинки интерфейса из <code>textures/ui</code>: рамки, кнопки, ячейки, ' +
      'полосы. Если поверх стоит свой пак-перебивалка, показывается и правится он. ' +
      '«Выгрузить PNG» сохранит оригиналы для правки в редакторе — размер менять нельзя.',
  };
  $('#icon-lede').innerHTML = ledes[icons.pack] || '';

  const res = await guard(() => window.api.packs.list(icons.pack, $('#icon-search').value.trim()));
  if (!res) return;
  icons.loadedFor = key;
  $('#icon-count').textContent = res.shown === res.total
    ? `всего ${res.total}`
    : `найдено ${res.shown} из ${res.total}`;

  const store = packStore(icons.pack);
  const grid = $('#icon-grid');
  grid.innerHTML = '';
  if (icons.observer) icons.observer.disconnect();
  icons.pending = new Set();

  const frag = document.createDocumentFragment();
  for (const row of res.rows) {
    const cell = document.createElement('div');
    cell.className = 'icon' + (store[row.key] ? ' is-set' : '');
    cell.dataset.name = row.key;
    // у копий подписываем пак, иначе не отличить одну от другой
    // подписываем именем самого пака: `textures/ui/ui.pak` и
    // `textures/ui/zz_aion2.pak` лежат в одной папке, по папке их не различить
    const where = row.twin
      ? `<span class="icon__pak" title="${row.pak}">` +
        `${row.pak.split('/').pop().replace(/\.pak$/i, '')}</span>`
      : '';
    cell.innerHTML = `<canvas width="64" height="64"></canvas>` +
      `<div title="${row.short}\n${row.pak}">${row.short.replace(/\.dds$/i, '')}</div>${where}`;
    cell.onclick = () => replaceIcon(row, cell);
    frag.appendChild(cell);
  }
  grid.appendChild(frag);

  icons.observer = new IntersectionObserver(onIconsVisible, { root: null, rootMargin: '300px' });
  grid.querySelectorAll('.icon').forEach((c) => icons.observer.observe(c));
}

const flushIcons = debounce(async () => {
  const names = [...icons.pending].slice(0, 120);
  if (!names.length) return;
  names.forEach((n) => icons.pending.delete(n));
  const pack = icons.pack;
  const cvs = names.map((n) => $(`#icon-grid .icon[data-name="${CSS.escape(n)}"] canvas`));
  const imgs = await skWait(cvs, guard(() => window.api.packs.images(pack, names)));
  if (!imgs || pack !== icons.pack) return;
  for (const img of imgs) {
    const cell = $(`#icon-grid .icon[data-name="${CSS.escape(img.name)}"]`);
    if (!cell || img.error) continue;
    cell.dataset.full = (img.full || [img.width, img.height]).join(',');
    paintIcon(cell.querySelector('canvas'), img);
  }
  if (icons.pending.size) flushIcons();
}, 60);

function onIconsVisible(entries) {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    const cell = e.target;
    icons.observer.unobserve(cell);
    if (cell.dataset.painted) continue;
    cell.dataset.painted = '1';
    icons.pending.add(cell.dataset.name);
  }
  if (icons.pending.size) flushIcons();
}

function paintIcon(cv, img) {
  cv.width = img.width;
  cv.height = img.height;
  cv.style.width = Math.min(96, img.width) + 'px';
  cv.style.height = 'auto';
  cv.getContext('2d').putImageData(
    new ImageData(new Uint8ClampedArray(img.rgba), img.width, img.height), 0, 0
  );
}

async function replaceIcon(row, cell) {
  await guard(async () => {
    // Размер берём у оригинала — клиент ждёт ровно его. Превью крупных атласов
    // приходит уменьшенным, поэтому настоящий размер берём из поля full.
    const src = cell.querySelector('canvas');
    if (!cell.dataset.full) {
      const [img] = (await window.api.packs.images(icons.pack, [row.key])) || [];
      if (img && !img.error) { paintIcon(src, img); cell.dataset.painted = '1'; }
    }
    const [fw, fh] = (cell.dataset.full || '').split(',').map(Number);

    const picked = await window.api.packs.pickFile();
    if (!picked) return;
    const bin = atob(picked.data);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const bmp = await createImageBitmap(new Blob([bytes]));

    const w = packInfo(icons.pack).size || fw || bmp.width;
    const h = packInfo(icons.pack).size || fh || bmp.height;

    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    cv.getContext('2d').drawImage(bmp, 0, 0, w, h);
    const px = cv.getContext('2d').getImageData(0, 0, w, h).data;
    const file = await window.api.packs.stage({
      pack: icons.pack, name: row.key, width: w, height: h, rgba: Array.from(px),
    });
    packStore(icons.pack)[row.key] = file;
    cell.classList.add('is-set');
    paintIcon(src, { width: w, height: h, rgba: px });
    renderBadges();
    saveProfile();
    toast(`подготовлено: ${row.short} (${w}×${h}) в ${row.pak}`);
  });
}

$('#icon-search').oninput = debounce(() => loadIcons(true), 250);

$('#icon-export').onclick = () =>
  guard(async () => {
    const names = [...document.querySelectorAll('#icon-grid .icon')].map((c) => c.dataset.name);
    if (!names.length) { toast('нечего выгружать', true); return; }
    if (names.length > 300) {
      toast(`${names.length} штук — сначала сузь поиск, иначе это надолго`, true);
      return;
    }
    const res = await window.api.packs.export(icons.pack, names);
    if (res) toast(`выгружено ${res.count} PNG в ${res.dir}`);
  });

/* ======================= иконки умений ======================= */

/*
 * Семейство — ранги одной иконки и их серые двойники. Правки лежат там же,
 * где раньше, в profile.packs.skills (ключ `пак|запись` -> готовый DDS),
 * так что сборка их пишет без изменений.
 */
const sk = { cat: null, selected: null, act: new Set(), sub: new Set(), observer: null,
  pending: new Set(), images: new Map() };
const SK_ACT = [['active', 'активные'], ['passive', 'пассивные'], ['toggle', 'переключаемые']];
const SK_SUB = [['attack', 'атака'], ['buff', 'усиление'], ['debuff', 'ослабление'], ['heal', 'лечение'],
  ['chant', 'песнь'], ['summon', 'призыв'], ['other', 'прочее']];
const SK_TYPE = { physical: 'физическое', magical: 'магическое' };
const ROMAN = ['0', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

const skStore = () => packStore('skills');
const skKeys = (f) => f.ranks.flatMap((r) => (r.grayKey ? [r.key, r.grayKey] : [r.key]));
const skChanged = (f) => skKeys(f).some((k) => skStore()[k]);
const skClassName = (id) => ((sk.cat && sk.cat.classes.find((c) => c[0] === id)) || [id, id])[1];
/** Сколько семейств изменено — для бейджа и сводки (ключи — ранги и серые). */
const skFamilyCount = (store) => new Set(Object.keys(store || {}).map((k) =>
  k.split('|').pop().toLowerCase().replace(/(_g\d+)?(_gray)?\.dds$/, ''))).size;

async function loadSkillIcons(force) {
  if (!state.ready) return;
  if (!sk.cat || force) {
    $('#si-grid').innerHTML = '<span class="muted">читаю таблицы умений…</span>';
    sk.cat = await guard(() => window.api.skillicons.catalogue());
    if (!sk.cat) { $('#si-grid').innerHTML = '<span class="muted">не удалось прочитать</span>'; return; }
    const keep = $('#si-class').value;
    $('#si-class').innerHTML = '<option value="">все классы</option>' +
      sk.cat.classes.map(([id, ru]) => `<option value="${id}">${ru}</option>`).join('') +
      '<option value="#shared">общие у нескольких классов</option>';
    $('#si-class').value = keep || '';
    const chips = (box, list, set) => {
      box.innerHTML = list.map(([id, ru]) =>
        `<button class="chip${set.has(id) ? ' is-on' : ''}" data-id="${id}">${ru}</button>`).join('');
      box.querySelectorAll('.chip').forEach((c) => {
        c.onclick = () => {
          if (set.has(c.dataset.id)) set.delete(c.dataset.id); else set.add(c.dataset.id);
          c.classList.toggle('is-on');
          renderSkillGrid();
        };
      });
    };
    chips($('#si-act'), SK_ACT, sk.act);
    chips($('#si-sub'), SK_SUB, sk.sub);
  }
  renderSkillGrid();
  if (sk.selected) renderSkillCard();
}

function skFiltered() {
  const q = $('#si-search').value.trim().toLowerCase();
  const cls = $('#si-class').value;
  const scope = $('#si-scope').value;
  const own = $('#si-own').checked;
  const changed = $('#si-changed').checked;
  return sk.cat.families.filter((f) => {
    if (scope === 'used' && !f.used) return false;
    if (scope === 'unused' && f.used) return false;
    if (cls === '#shared') { if (f.classes.length < 2) return false; } else if (cls && !f.classes.includes(cls)) return false;
    if (own && f.classes.length > 1) return false;
    if (sk.act.size && !f.act.some((a) => sk.act.has(a))) return false;
    if (sk.sub.size && !f.sub.some((a) => sk.sub.has(a))) return false;
    if (changed && !skChanged(f)) return false;
    if (q && !f.id.includes(q) && !f.titles.some((t) => t.toLowerCase().includes(q))) return false;
    return true;
  });
}

function skCellMeta(f) {
  const ranks = f.ranks.length > 1
    ? `${ROMAN[f.ranks[0].rank] || f.ranks[0].rank}–${ROMAN[f.ranks[f.ranks.length - 1].rank] || ''}` : '';
  if (f.classes.length > 1) {
    const who = f.classes.length === 8 ? 'все классы' : f.classes.map(skClassName).join(', ');
    return `<small class="is-shared" title="общая: ${esc(who)}">${ranks ? ranks + ' · ' : ''}общая: ${esc(who)}</small>`;
  }
  const who = f.classes.length ? skClassName(f.classes[0]) : 'без класса';
  return `<small>${ranks ? ranks + ' · ' : ''}${esc(who)}</small>`;
}

function renderSkillGrid() {
  if (!sk.cat) return;
  const list = skFiltered();
  $('#si-count').textContent = `${list.length} из ${sk.cat.families.length}`;
  const grid = $('#si-grid');
  grid.innerHTML = '';
  if (sk.observer) sk.observer.disconnect();
  sk.pending = new Set();
  if (!list.length) { grid.innerHTML = '<span class="muted">ничего не нашлось</span>'; return; }
  const frag = document.createDocumentFragment();
  for (const f of list) {
    const cell = document.createElement('div');
    cell.className = 'skcell' + (skChanged(f) ? ' is-set' : '') + (sk.selected === f.id ? ' is-sel' : '');
    cell.dataset.id = f.id;
    cell.innerHTML = '<canvas width="40" height="40"></canvas>' +
      `<b title="${esc(f.title || f.id)}">${esc(f.title || f.id)}</b>${skCellMeta(f)}`;
    cell.onclick = () => selectSkill(f.id);
    frag.appendChild(cell);
  }
  grid.appendChild(frag);
  sk.observer = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      sk.observer.unobserve(e.target);
      sk.pending.add(e.target.dataset.id);
    }
    if (sk.pending.size) flushSkillCells();
  }, { rootMargin: '300px' });
  grid.querySelectorAll('.skcell').forEach((c) => sk.observer.observe(c));
}

/**
 * Картинки по ключам: подготовленная (если есть) или родная. Кэш — по ключу
 * и файлу: после замены или смены профиля файл другой.
 * @param {string[]} keys
 * @param {boolean} [original] только родные
 */
async function skImages(keys, original) {
  const store = skStore();
  const tag = (k) => k + '|' + (original ? '' : store[k] || '');
  const staged = keys.filter((k) => !original && store[k] && !sk.images.has(tag(k)));
  const orig = keys.filter((k) => (original || !store[k]) && !sk.images.has(tag(k)));
  if (staged.length) {
    const got = (await guard(() => window.api.skillicons.staged(staged.map((k) => store[k])))) || [];
    got.forEach((img, i) => { if (!img.error) sk.images.set(tag(staged[i]), img); });
  }
  for (let i = 0; i < orig.length; i += 120) {
    const part = orig.slice(i, i + 120);
    const got = (await guard(() => window.api.packs.images('skills', part))) || [];
    for (const img of got) if (!img.error) sk.images.set(img.name + '|', img);
  }
  return new Map(keys.map((k) => [k, sk.images.get(tag(k))]));
}

function paintSmall(cv, img) {
  if (!cv || !img) return;
  // иконка — угол 40×40 холста 64×64: показываем занятую часть
  const c = img.content || (img.content = contentOf(img));
  cv.width = c.w;
  cv.height = c.h;
  const full = document.createElement('canvas');
  full.width = img.width;
  full.height = img.height;
  full.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(img.rgba), img.width, img.height), 0, 0);
  cv.getContext('2d').drawImage(full, 0, 0);
}

/** Занятая (непрозрачная) область от левого верхнего угла — как у родных иконок. */
function contentOf(img) {
  let mx = 0, my = 0;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (img.rgba[(y * img.width + x) * 4 + 3] > 0) { if (x > mx) mx = x; if (y > my) my = y; }
    }
  }
  return { w: mx + 1, h: my + 1 };
}

const flushSkillCells = debounce(async () => {
  const ids = [...sk.pending].slice(0, 120);
  ids.forEach((id) => sk.pending.delete(id));
  const fams = ids.map((id) => sk.cat.families.find((f) => f.id === id)).filter(Boolean);
  const imgs = await skImages(fams.map((f) => f.ranks[0].key));
  for (const f of fams) {
    const cell = $(`#si-grid .skcell[data-id="${CSS.escape(f.id)}"]`);
    if (cell) paintSmall(cell.querySelector('canvas'), imgs.get(f.ranks[0].key));
  }
  if (sk.pending.size) flushSkillCells();
}, 40);

function selectSkill(id) {
  sk.selected = id;
  $$('#si-grid .skcell').forEach((c) => c.classList.toggle('is-sel', c.dataset.id === id));
  renderSkillCard();
}

async function renderSkillCard() {
  const box = $('#si-card');
  const f = sk.cat && sk.cat.families.find((x) => x.id === sk.selected);
  if (!f) return;
  const store = skStore();
  const acts = f.act.map((a) => (SK_ACT.find((x) => x[0] === a) || [a, a])[1]);
  const subs = f.sub.map((a) => (SK_SUB.find((x) => x[0] === a) || [a, a])[1]);
  const meta = [
    f.classes.length ? 'классы: ' + (f.classes.length === 8 ? 'все' : f.classes.map(skClassName).join(', ')) : 'классам не выдаётся',
    f.level ? `с ${f.level} ур.` : '',
    [...acts, ...subs, ...f.type.map((t) => SK_TYPE[t] || t)].join(', '),
    f.titles.length > 1 ? 'та же иконка у: ' + f.titles.slice(1).join(', ') : '',
  ].filter(Boolean);
  const warn = f.classes.length > 1
    ? `<div class="skc__warn">Иконка общая: ${f.classes.length === 8 ? 'все классы' : f.classes.map(skClassName).join(', ')}. ` +
      'Замена поменяет её у всех.</div>'
    : '';
  box.innerHTML =
    `<div><h3 class="skc__title">${esc(f.title || f.id)}</h3><div class="skc__id">${esc(f.id)}</div></div>` +
    `<div class="skc__meta">${meta.map(esc).join('<br>')}</div>${warn}` +
    '<div class="skc__acts">' +
    `<button class="btn btn--primary" id="skc-all">${f.ranks.length > 1 ? 'Заменить все ранги…' : 'Заменить…'}</button>` +
    `<button class="btn btn--danger" id="skc-revert" ${skChanged(f) ? '' : 'disabled'}>Вернуть как было</button>` +
    '<button class="btn btn--ghost" id="skc-export">PNG</button></div>' +
    '<div class="skc__hint">Картинка впишется в квадрат иконки с обрезкой по краям.' +
    (f.ranks.length > 1 ? ' Ранги получат цвета родного семейства и его цифры, серые соберутся сами.' : ' Серая соберётся сама.') +
    '</div>' +
    '<div class="skc__ranks">' + f.ranks.map((r) =>
      `<div class="skc__rank${store[r.key] ? ' is-set' : ''}" data-rank="${r.rank}">` +
      `<span>${ROMAN[r.rank] || '—'}</span><canvas data-k="c"></canvas><canvas data-k="g"></canvas>` +
      (f.ranks.length > 1 ? '<button class="btn btn--ghost">этот ранг…</button>' : '<i></i>') + '</div>').join('') +
    '</div>';

  $('#skc-all').onclick = () => skReplace(f);
  $('#skc-revert').onclick = () => skRevert(f);
  $('#skc-export').onclick = () => guard(async () => {
    const res = await window.api.packs.export('skills', skKeys(f));
    if (res) toast(`выгружено ${res.count} PNG в ${res.dir}`);
  });
  box.querySelectorAll('.skc__rank .btn').forEach((b) => {
    b.onclick = () => skReplace(f, +b.closest('.skc__rank').dataset.rank);
  });

  const imgs = await skImages(skKeys(f));
  if (sk.selected !== f.id) return;
  for (const r of f.ranks) {
    const row = box.querySelector(`.skc__rank[data-rank="${r.rank}"]`);
    paintSmall(row.querySelector('[data-k="c"]'), imgs.get(r.key));
    if (r.grayKey) paintSmall(row.querySelector('[data-k="g"]'), imgs.get(r.grayKey));
  }
}

/** Картинка пользователя в холсте родной иконки: вписана в занятый угол с обрезкой. */
async function skPickImage(orig) {
  const picked = await window.api.packs.pickFile();
  if (!picked) return null;
  const bin = atob(picked.data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const bmp = await createImageBitmap(new Blob([bytes]));
  const c = orig.content || (orig.content = contentOf(orig));
  const cv = document.createElement('canvas');
  cv.width = orig.width;
  cv.height = orig.height;
  const g = cv.getContext('2d');
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  const s = Math.max(c.w / bmp.width, c.h / bmp.height);
  const dw = bmp.width * s;
  const dh = bmp.height * s;
  g.save();
  g.beginPath();
  g.rect(0, 0, c.w, c.h);
  g.clip();
  g.drawImage(bmp, (c.w - dw) / 2, (c.h - dh) / 2, dw, dh);
  g.restore();
  return g.getImageData(0, 0, orig.width, orig.height).data;
}

/** Всё семейство (rank не задан) или один ранг. */
function skReplace(f, rank) {
  return guard(async () => {
    const r = f.ranks.find((x) => x.rank === rank) || f.ranks[0];
    const orig = (await skImages([r.key], true)).get(r.key);
    if (!orig) throw new Error('не удалось прочитать родную иконку');
    const px = await skPickImage(orig);
    if (!px) return;
    const made = await window.api.skillicons.make(f.id, px, rank);
    const store = skStore();
    for (const m of made) {
      store[m.key] = m.file;
      sk.images.set(m.key + '|' + m.file, m);
    }
    renderBadges();
    saveProfile();
    renderSkillCard();
    const cell = $(`#si-grid .skcell[data-id="${CSS.escape(f.id)}"]`);
    if (cell) {
      cell.classList.add('is-set');
      paintSmall(cell.querySelector('canvas'), (await skImages([f.ranks[0].key])).get(f.ranks[0].key));
    }
    toast(rank != null ? `ранг ${ROMAN[rank] || rank}: готово к сборке` : `готово к сборке: ${made.length} картинок`);
  });
}

async function skRevert(f) {
  const store = skStore();
  for (const k of skKeys(f)) delete store[k];
  renderBadges();
  saveProfile();
  renderSkillCard();
  const cell = $(`#si-grid .skcell[data-id="${CSS.escape(f.id)}"]`);
  if (cell) {
    cell.classList.remove('is-set');
    paintSmall(cell.querySelector('canvas'), (await skImages([f.ranks[0].key])).get(f.ranks[0].key));
  }
  toast('вернётся родная при следующей сборке');
}

$('#si-search').oninput = debounce(renderSkillGrid, 200);
['#si-class', '#si-scope', '#si-own', '#si-changed'].forEach((s) => { $(s).onchange = renderSkillGrid; });

// сохранить и загрузить набор правок — пресеты (presets.js)

$('#profile-clear').onclick = () => {
  state.profile = {
    layout: {},
    font: { enabled: false, file: '', langs: [] },
    packs: { skills: {}, hitnum: {}, uiatlas: {}, items: {} },
    skins: {},
    // папку официального клиента помним: выбирать её заново незачем
    classic: { enabled: false, root: clState().root, off: {}, rules: {}, hud: { enabled: false, off: {} } },
    lang: state.profile.lang || 'rus',
  };
  afterProfileLoad();
  toast('профиль очищен');
};

function afterProfileLoad() {
  $('#font-path').value = state.profile.font.file || '';
  $('#font-on').checked = !!state.profile.font.enabled;
  applyFontPreview(state.profile.font.file);
  renderFontLangs();
  if (state.portraitStock) renderPortrait();
  renderList();
  renderBoxes();
  renderProps();
  renderBadges();
  renderSummary();
  icons.loadedFor = null;
  // другой профиль — другие подготовленные иконки: пометки и карточку перерисовать
  if (sk.cat) { renderSkillGrid(); if (sk.selected) renderSkillCard(); }
  if (it.cat) { renderItemGrid(); if (it.selected) renderItemCard(); }
  if ($('.view[data-view="hitnum"]').classList.contains('is-active')) loadHitnum();
  if (bf.info && $('.view[data-view="buffs"]').classList.contains('is-active')) renderBuffs();
  lkNotes();
  if (lk.plan) renderLook();
  calibSync();
  skins.loadedFor = null;
  if (state.ready && $('.view[data-view="classic"]').classList.contains('is-active')) loadClassic();
  // другой профиль (пресет) — другие свои карты
  mp.own.clear();
  mp.img = null;
  if (mp.zones && $('.view[data-view="maps"]').classList.contains('is-active')) loadMaps();
  saveProfile();
}

/* ======================= старт ======================= */

// после всех скриптов страницы: hitnum.js подключается следом за этим файлом
window.addEventListener('DOMContentLoaded', async function boot() {
  state.profile = Object.assign({}, state.profile, await window.api.profile.get());
  const pending = await window.api.profile.sync();
  if (pending) {
    const message = pending.status === 'profile-save-failed'
      ? 'Предыдущая сборка завершилась, но профиль не сохранился. Повтори сборку после проверки диска.'
      : 'Предыдущая сборка завершилась с ошибкой. Проверь журнал и состояние клиента.';
    toast(message, true);
  }
  afterProfileLoad();
  await initPortrait();
  setClient(await window.api.client.init());
  fitCanvas();
  // первый запуск (профиль пустой) — мастер
  if (wzNeeded()) wzOpen();
});
