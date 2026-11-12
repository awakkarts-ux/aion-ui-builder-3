'use strict';
/**
 * Пресеты внизу левой панели: выбрать — «Собрать и установить», два клика.
 * Сохранение, файлы и сравнение — в main (core/presets.js), здесь меню и
 * окно с названием и описанием.
 */

const ps = { list: [], active: null, changed: null, open: false };

function psApplyState(s) {
  if (!s) return;
  ps.list = s.list || [];
  ps.active = s.active || null;
  ps.changed = s.changed;
  psRender();
}

/** После каждой правки профиля (saveProfile) — изменён ли включённый пресет. */
const presetRefresh = debounce(async () => {
  const s = await window.api.preset.state(state.profile).catch(() => null);
  psApplyState(s);
}, 300);

const psCur = () => ps.list.find((p) => p.id === ps.active) || null;

function psRender() {
  const cur = psCur();
  $('#pset-name').textContent = cur ? cur.name : (ps.list.length ? 'не выбран' : 'не сохранён');
  $('#pset-mark').hidden = !(cur && ps.changed);
  $('#pset-btn').title = cur && cur.description ? cur.description : '';
  if (ps.open) psRenderMenu();
}

function psRenderMenu() {
  const cur = psCur();
  const items = ps.list.map((p) =>
    `<button class="pset__item${p.id === ps.active ? ' is-on' : ''}" role="menuitemradio" aria-checked="${p.id === ps.active}" data-pid="${esc(p.id)}">` +
      `<b>${esc(p.name)}</b>${p.description ? `<small>${esc(p.description)}</small>` : ''}</button>`).join('');
  $('#pset-menu').innerHTML =
    (items ? `<div class="pset__list">${items}</div>` : '<div class="pset__empty">Сохраните текущие настройки, чтобы потом вернуться к ним в пару кликов.</div>') +
    '<div class="pset__acts">' +
      (cur ? `<button class="pset__act" data-act="save" ${ps.changed ? '' : 'disabled'}>Сохранить в «${esc(cur.name)}»</button>` : '') +
      (cur && ps.changed ? '<button class="pset__act" data-act="revert">Откатить изменения</button>' : '') +
      '<button class="pset__act" data-act="new">Сохранить как новый…</button>' +
      (cur ? '<button class="pset__act" data-act="rename">Переименовать…</button>' : '') +
      (cur ? '<button class="pset__act" data-act="export">Экспорт в файл…</button>' : '') +
      '<button class="pset__act" data-act="import">Импорт из файла…</button>' +
      (cur ? '<button class="pset__act pset__act--danger" data-act="remove">Удалить пресет</button>' : '') +
    '</div>';
  motionFit($('#pset-menu'));
}

function psToggle(open) {
  ps.open = open == null ? !ps.open : open;
  $('#pset-btn').setAttribute('aria-expanded', String(ps.open));
  if (ps.open) psRenderMenu();
  motionPanel($('#pset-menu'), ps.open);
}

/* ---------- окно: название и описание / подтверждение ---------- */

/**
 * @param {{title, ok, text?, name?, description?, fields?: boolean, danger?: boolean}} o
 * @returns {Promise<{name, description}|null>}
 */
function psDialog(o) {
  const box = $('#pdlg');
  const fields = o.fields !== false;
  $('#pdlg-title').textContent = o.title;
  $('#pdlg-text').hidden = !o.text;
  $('#pdlg-text').textContent = o.text || '';
  $('#pdlg-name-f').hidden = !fields;
  $('#pdlg-desc-f').hidden = !fields;
  $('#pdlg-name').value = o.name || '';
  $('#pdlg-desc').value = o.description || '';
  $('#pdlg-ok').textContent = o.ok;
  $('#pdlg-ok').classList.toggle('btn--danger', !!o.danger);
  box.hidden = false;
  setTimeout(() => (fields ? $('#pdlg-name') : $('#pdlg-ok')).focus(), 0);
  return new Promise((resolve) => {
    const done = (v) => {
      box.hidden = true;
      $('#pdlg-form').onsubmit = null;
      $('#pdlg-cancel').onclick = null;
      box.onkeydown = null;
      resolve(v);
    };
    $('#pdlg-form').onsubmit = (e) => {
      e.preventDefault();
      const name = $('#pdlg-name').value.trim();
      if (fields && !name) { $('#pdlg-name').focus(); return; }
      done({ name, description: $('#pdlg-desc').value.trim() });
    };
    $('#pdlg-cancel').onclick = () => done(null);
    box.onkeydown = (e) => { if (e.key === 'Escape') done(null); };
  });
}

/* ---------- действия ---------- */

/** @param {boolean} [force] без проверок — откат к сохранённому */
async function psSwitch(id, force) {
  if (!force && id === ps.active && !ps.changed) { psToggle(false); return; }
  const cur = psCur();
  if (!force && cur && ps.changed) {
    const ok = await psDialog({
      title: 'Изменения не сохранены',
      text: `Правки после сохранения «${cur.name}» пропадут. Переключиться всё равно?`,
      ok: 'Переключиться', fields: false,
    });
    if (!ok) return;
  }
  psToggle(false);
  await guard(async () => {
    const r = await window.api.preset.apply(id, state.profile);
    state.profile = r.profile;
    afterProfileLoad();
    if (typeof loadEditor === 'function' && ed.data) loadEditor(true);
    psApplyState(r.state);
    toast(`включён пресет «${psCur() ? psCur().name : ''}» — нажмите «Собрать и установить»`);
  });
}

async function psAction(act) {
  const cur = psCur();
  if (act === 'save' && cur) {
    psToggle(false);
    await guard(async () => {
      psApplyState(await window.api.preset.save({ profile: state.profile, id: cur.id }));
      toast(`сохранено в «${cur.name}»`);
    });
  } else if (act === 'revert' && cur) {
    psToggle(false);
    const ok = await psDialog({ title: 'Откатить изменения?', text: `Настройки вернутся к сохранённым в «${cur.name}».`, ok: 'Откатить', fields: false });
    if (ok) await psSwitch(cur.id, true);
  } else if (act === 'new') {
    psToggle(false);
    const v = await psDialog({ title: 'Новый пресет', ok: 'Сохранить' });
    if (!v) return;
    await guard(async () => {
      psApplyState(await window.api.preset.save({ profile: state.profile, name: v.name, description: v.description }));
      toast(`пресет «${v.name}» сохранён`);
    });
  } else if (act === 'rename' && cur) {
    psToggle(false);
    const v = await psDialog({ title: 'Переименовать пресет', ok: 'Готово', name: cur.name, description: cur.description });
    if (!v) return;
    await guard(async () => psApplyState(await window.api.preset.rename({ id: cur.id, name: v.name, description: v.description })));
  } else if (act === 'export' && cur) {
    psToggle(false);
    await guard(async () => {
      const f = await window.api.preset.export(cur.id);
      if (f) toast('сохранил: ' + f);
    });
  } else if (act === 'import') {
    psToggle(false);
    await guard(async () => {
      const r = await window.api.preset.import();
      if (!r) return;
      psApplyState(r.state);
      toast(`добавлен пресет «${r.imported.name}» — выберите его в списке, чтобы включить`);
    });
  } else if (act === 'remove' && cur) {
    psToggle(false);
    const ok = await psDialog({
      title: 'Удалить пресет?', text: `«${cur.name}» пропадёт из списка. Текущие настройки останутся как есть.`,
      ok: 'Удалить', fields: false, danger: true,
    });
    if (!ok) return;
    await guard(async () => psApplyState(await window.api.preset.remove(cur.id)));
  }
}

$('#pset-btn').onclick = (e) => { e.stopPropagation(); psToggle(); };
$('#pset-menu').onclick = (e) => {
  e.stopPropagation();
  const item = e.target.closest('[data-pid]');
  if (item) { psSwitch(item.dataset.pid); return; }
  const act = e.target.closest('[data-act]');
  if (act && !act.disabled) psAction(act.dataset.act);
};
document.addEventListener('click', () => { if (ps.open) psToggle(false); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && ps.open) psToggle(false); });

window.addEventListener('DOMContentLoaded', () => presetRefresh());
