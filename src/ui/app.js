'use strict';

/* Окно сборщика. Вся работа с клиентом — через preload (window.api). */

const state = {
  profile: {
    layout: {},
    font: { enabled: false, file: '', langs: [] },
    packs: { skills: {}, hitnum: {}, uiatlas: {}, items: {} },
    skins: {},
    lang: 'rus',
  },
  languages: [],
  ready: false,
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

async function initUpdates() {
  const version = $('#app-version');
  const check = $('#app-check-update');
  const button = $('#app-update');
  if (!version || !check || !button || !window.api.update) return;
  const info = await window.api.update.info();
  version.textContent = `v${info.version}`;
  const setStatus = (s) => {
    if (s.state === 'available') {
      button.hidden = false;
      button.disabled = false;
      button.textContent = `Обновить до v${s.version}`;
      button.dataset.state = 'available';
    } else if (s.state === 'downloading') {
      button.hidden = false;
      button.disabled = true;
      button.textContent = `Загрузка ${Math.round(s.percent || 0)}%`;
    } else if (s.state === 'ready') {
      button.hidden = false;
      button.disabled = false;
      button.textContent = 'Перезапустить и обновить';
      button.dataset.state = 'ready';
    } else if (s.state === 'error') {
      // Без этой ветки ошибка загрузки молча оставляла кнопку в «Загрузка…».
      if (button.dataset.state !== 'available' && button.dataset.state !== 'downloading') return;
      button.hidden = false;
      button.disabled = false;
      button.textContent = 'Повторить обновление';
      button.dataset.state = 'available';
      toast(`Обновление не скачалось: ${s.message || 'нет связи'}`, true);
    }
  };
  window.api.update.onStatus(setStatus);
  check.onclick = () => guard(async () => {
    check.disabled = true;
    check.textContent = 'Проверка…';
    await window.api.update.check();
    setTimeout(() => { check.disabled = false; check.textContent = 'Проверить обновления'; }, 1200);
  });
  button.onclick = () => guard(async () => {
    if (button.dataset.state === 'ready') {
      button.disabled = true;
      button.textContent = 'Устанавливаю…';
      return window.api.update.install();
    }
    // Состояние ставим ДО загрузки: download() завершается уже после события
    // «ready», и запись «Загрузка…» после await навсегда блокировала кнопку.
    button.disabled = true;
    button.textContent = 'Загрузка…';
    button.dataset.state = 'downloading';
    await window.api.update.download();
  });
}

initUpdates();

function toast(msg, bad) {
  // красные сообщения — в журнал (guard пишет сам, со стеком)
  if (bad && !toast.logged) logError('сообщение', msg);
  toast.logged = false;
  const el = $('#toast');
  el.textContent = msg;
  el.className = 'toast on' + (bad ? ' bad' : '');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (el.className = 'toast'), 3200);
}

/** Ошибку окна — в журнал программы (core/errlog.js, logs/errors.log). */
function logError(where, e) {
  try {
    if (window.api && window.api.log) {
      window.api.log.error({ where, message: String(e && e.message ? e.message : e), stack: e && e.stack ? String(e.stack) : '' }).catch(() => {});
    }
  } catch (x) { /* журнал не должен ронять окно */ }
}
window.addEventListener('error', (ev) => logError('окно: ' + (ev.filename || '').split('/').pop() + ':' + ev.lineno, ev.error || ev.message));
window.addEventListener('unhandledrejection', (ev) => logError('окно: promise', ev.reason));

async function guard(fn) {
  try {
    return await fn();
  } catch (e) {
    logError('guard', e);
    toast.logged = true;
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

/* ======================= счётчики в меню ======================= */

function renderBadges() {
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
    const b = $('#badge-' + id);
    if (b) b.textContent = n || '';
  }
  if ($('#badge-look')) $('#badge-look').textContent = lookN || '';
  $('#badge-editor').textContent = Object.keys(state.profile.elements || {}).length || '';
  $('#badge-maps').textContent = Object.keys(state.profile.maps || {}).length || '';
  $('#badge-v5').textContent = state.profile.v5 && state.profile.v5.enabled ? '1' : '';
  const cl = state.profile.classic;
  const clOn = cl && cl.root ? (cl.enabled ? 1 : 0) + (cl.hud && cl.hud.enabled ? 1 : 0) : 0;
  $('#badge-classic').textContent = clOn || '';
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
  $('#cl-hud-on').checked = lookMix(state.profile).hud;
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
  $('#cl-maps-on').checked = lookMix(state.profile).maps;
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
  const g = state.profile.look && state.profile.look.groups;
  if (g) g.maptiles = e.target.checked ? 'classic' : 'own';
  renderSummary();
  saveProfile();
};

$('#cl-hud-on').onchange = (e) => {
  clState().hud.enabled = e.target.checked;
  const g = state.profile.look && state.profile.look.groups;
  if (g) g.hudwin = e.target.checked ? 'classic' : 'own';
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
  $('#cl-on').checked = lookMix(state.profile).classic;
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
  // есть микшер — сборка смотрит на него, а не на галочку: переводим все
  // группы деталей (не переключатели окон) на Classic или обратно на свой
  const g = state.profile.look && state.profile.look.groups;
  if (g) {
    for (const id of Object.keys(g)) {
      if (LK_SWITCHES.includes(id)) continue;
      if (e.target.checked) g[id] = 'classic';
      else if (g[id] === 'classic') g[id] = 'own';
    }
    if (typeof lk !== 'undefined' && lk) lk.planFor = '';
  }
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

/** Готовые шрифты программы (core/fonts.js): id, название, путь для окна. */
let fontBuiltin = [];

function renderFontBuiltin() {
  const f = state.profile.font;
  const box = $('#font-builtin');
  // у каждой карточки свой @font-face — образец её же шрифтом
  let faces = document.getElementById('font-builtin-faces');
  if (!faces) {
    faces = document.createElement('style');
    faces.id = 'font-builtin-faces';
    document.head.appendChild(faces);
  }
  faces.textContent = fontBuiltin.map((x) =>
    `@font-face { font-family: 'aion-b-${x.id}'; src: url("${x.url}"); }`).join('\n');
  box.innerHTML = fontBuiltin.map((x) => {
    const on = f.enabled && f.builtin === x.id;
    return `<button class="fnt__it${on ? ' is-on' : ''}" data-id="${x.id}" style="font-family:'aion-b-${x.id}', var(--font)">` +
      `<i>Абевега 1234</i><small style="font-family:var(--font)"><b>${esc(x.title)}</b>${esc(x.note)}</small></button>`;
  }).join('');
  box.querySelectorAll('.fnt__it').forEach((b) => {
    b.onclick = () => {
      const same = f.enabled && f.builtin === b.dataset.id;
      if (same) { f.enabled = false; } else { f.builtin = b.dataset.id; f.enabled = true; }
      renderFont();
      renderBadges();
      saveProfile();
    };
  });
  const note = $('#font-theme-note');
  const th = state.profile.theme === 'nightcity' && !f.enabled;
  note.hidden = !th;
  if (th) note.textContent = 'Сейчас шрифт даёт тестовый вариант Night City — Fira Sans Condensed. Выберите другой, чтобы заменить.';
}

/** Раздел целиком по профилю: готовый шрифт, свой файл, галочка, образец. */
function renderFont() {
  const f = state.profile.font;
  const b = f.builtin && fontBuiltin.find((x) => x.id === f.builtin);
  $('#font-path').value = b ? '' : f.file || '';
  $('#font-path').placeholder = b ? `готовый: ${b.title}` : 'не выбран';
  $('#font-on').checked = !!f.enabled;
  if (b) applyFontPreview(null, b.url);
  else if (f.file) applyFontPreview(f.file);
  else if (state.profile.theme === 'nightcity') applyFontPreview(null, 'fonts/game/FiraSansCondensed-Medium.ttf');
  renderFontBuiltin();
}

(async () => {
  try { fontBuiltin = (window.api.font.builtin && await window.api.font.builtin()) || []; } catch (e) { fontBuiltin = []; }
  if (state.profile) renderFont();
})();

$('#font-pick').onclick = () =>
  guard(async () => {
    const f = await window.api.font.pick();
    if (!f) return;
    state.profile.font.file = f;
    delete state.profile.font.builtin;
    state.profile.font.enabled = true;
    renderFont();
    renderBadges();
    saveProfile();
  });

$('#design-dump').onclick = () =>
  guard(async () => {
    const btn = $('#design-dump');
    btn.disabled = true;
    btn.textContent = 'Выгружаю…';
    try {
      const r = await window.api.design.dump();
      if (!r) return;
      toast(`Готово: окон ${r.windows}, деталей ${r.skins}, атласов ${r.atlases}` +
        (r.classic ? `, Classic — окон ${r.classic.windows}` : '') + '. Пришлите архив в чат.');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Выгрузить…';
    }
  });

$('#font-on').onchange = (e) => {
  state.profile.font.enabled = e.target.checked;
  renderFont();
  renderBadges();
  saveProfile();
};

function applyFontPreview(file, rel) {
  if (!file && !rel) return;
  const url = rel || 'file:///' + file.replace(/\\/g, '/').replace(/^\/+/, '');
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
  renderFont();
  renderFontLangs();
  if (state.portraitStock) renderPortrait();
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
  // первый запуск (профиль пустой) — мастер
  if (wzNeeded()) wzOpen();
});
