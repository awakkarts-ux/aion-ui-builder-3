/* ======================= клиент ======================= */

function setClient(info) {
  if (!info) return;
  state.languages = info.languages || [];
  $('#client-path').value = info.root || '';
  $('#tb-path').textContent = info.root || 'клиент не выбран';
  const chipName = $('#cl-name');
  const chipDot = $('#cl-dot');
  const chipLang = $('#cl-lang');
  if (chipName) chipName.textContent = info.root ? String(info.root).split(/[\\/]/).filter(Boolean).slice(-2, -1)[0] || 'клиент' : 'клиент не выбран';
  if (chipDot) chipDot.className = 'tb-chip__dot' + (info.ok ? ' is-ok' : info.root ? ' is-bad' : '');
  if (chipLang) chipLang.textContent = (state.languages[0] || 'rus').toUpperCase();
  const st = $('#client-state');
  if (info.ok) {
    st.className = 'state ok';
    st.textContent = 'клиент найден, языки: ' + (state.languages.join(', ') || 'нет');
  } else {
    st.className = 'state bad';
    st.textContent = info.root
      ? 'не хватает: ' + (info.missing || []).join(', ')
      : 'папка не выбрана';
  }
  state.ready = !!info.ok;
  renderClientLangs();
  renderFontLangs();
  if (info.ok) {
    loadCatalogue();
    loadShots();
    refreshStatus();
    renderResetPlan();
    // разделы, открытые до того, как нашёлся клиент, перерисуются сами
    if ($('.view[data-view="skins"]').classList.contains('is-active')) loadSkins(true);
    if ($('.view[data-view="icons"]').classList.contains('is-active')) loadIcons(true);
    sk.cat = null;
    sk.images.clear();
    hn.rows = null; // у другого клиента свои родные цифры
    hn.sizes.clear();
    hn.orig.clear();
    if ($('.view[data-view="hitnum"]').classList.contains('is-active')) loadHitnum();
    bf.info = null; // у другого клиента свои окна бафов
    if ($('.view[data-view="buffs"]').classList.contains('is-active')) loadBuffs();
    lk.plan = null;
    if ($('.view[data-view="look"]').classList.contains('is-active')) loadLook(true);
    mp.zones = null; // у другого клиента свои карты
    if ($('.view[data-view="maps"]').classList.contains('is-active')) loadMaps();
    it.cat = null; // у другого клиента свои предметы
    it.images.clear();
    if ($('.view[data-view="skillicons"]').classList.contains('is-active')) {
      if (it.kind === 'items') loadItemIcons(true); else loadSkillIcons(true);
    }
    if ($('.view[data-view="v5"]').classList.contains('is-active')) loadV5();
    if ($('.view[data-view="classic"]').classList.contains('is-active')) loadClassic(true);
  }
}

$('#client-pick').onclick = () => guard(async () => setClient(await window.api.client.pick()));

function renderClientLangs() {
  const sel = $('#client-lang');
  const langs = state.languages.length ? state.languages : ['rus'];
  if (!state.profile.lang || !langs.includes(state.profile.lang)) {
    state.profile.lang = langs.includes('rus') ? 'rus' : langs[0];
  }
  sel.innerHTML = langs.map((l) => `<option value="${l}">${l}</option>`).join('');
  sel.value = state.profile.lang;
  sel.onchange = () => {
    state.profile.lang = sel.value;
    saveProfile();
    sk.cat = null; // названия умений — из пака этого языка
  };
}

async function refreshStatus() {
  const rows = await window.api.build.status();
  const box = $('#status-box');
  if (!rows.length) {
    box.innerHTML = '<div class="muted">пока ничего</div>';
    return;
  }
  box.innerHTML = rows
    .map(
      (r) =>
        `<div class="status-line"><span class="dot ${r.patched ? 'on' : ''}"></span>` +
        `<code>${r.rel}</code><span class="muted">${r.patched ? 'подменён' : 'штатный'}</span></div>`
    )
    .join('');
}

/* ======================= сброс к штатному ======================= */

async function renderResetPlan() {
  const box = $('#reset-plan');
  if (!state.ready) { box.textContent = 'сначала укажи папку клиента'; return; }
  const p = await guard(() => window.api.reset.plan());
  if (!p) return;
  const parts = [];
  if (p.restore.length) {
    parts.push('<b>вернуть из резерва:</b><br>' +
      p.restore.map((r) => '&nbsp;&nbsp;' + r.rel).join('<br>'));
  }
  if (p.extra.length) {
    parts.push('<b>убрать в карантин:</b><br>' + p.extra.map((e) =>
      `&nbsp;&nbsp;${e.rel} — ${(e.size / 1024).toFixed(0)} КБ, ${e.why}`).join('<br>'));
  }
  if (!parts.length) parts.push('клиент уже штатный, сбрасывать нечего');
  if (p.inQuarantine) parts.push(`в карантине лежит файлов: ${p.inQuarantine}`);
  box.innerHTML = parts.join('<br><br>');
  $('#reset-undo').disabled = !p.inQuarantine;
  $('#reset-run').disabled = !(p.restore.length || p.extra.length);
}

$('#reset-refresh').onclick = renderResetPlan;

$('#reset-run').onclick = () =>
  guard(async () => {
    const done = await window.api.reset.run();
    toast(`вернул ${done.restored.length}, убрал ${done.removed.length}. Перезапусти игру.`);
    $('#apply-log').textContent =
      ['вернул из резерва:', ...done.restored, '', 'убрал в карантин:', ...done.removed].join('\n');
    await renderResetPlan();
    await refreshStatus();
  });

$('#reset-undo').onclick = () =>
  guard(async () => {
    const back = await window.api.reset.undo();
    toast(back.length ? `вернул ${back.length} файл(ов)` : 'карантин пуст');
    await renderResetPlan();
    await refreshStatus();
  });
