'use strict';

/*
 * «Вид интерфейса»: микшер групп (своё / официальный Classic / Aion 5.x),
 * мини-карта, и мастер первого запуска. Как это выглядит — экран
 * предпросмотра в «Интерфейсе» (editor.js), он пересобирается по профилю.
 * Правка — profile.look.groups (см. core/look.js);
 * пока её нет, показываем то, что собирают старые галочки разделов
 * «Официальный Classic» и «Aion 5.x», и берём это за основу при первом выборе.
 */

const lk = { plan: null, planFor: '' };
const LK_SRC = [['own', 'свой'], ['classic', 'Classic'], ['v5', '5.x']];
/** Окна, которые можно освободить (ключи — core/hud.js FREE_WINDOWS). */
const LK_FREE = [['buffs', 'бафы'], ['debuffs', 'дебафы'], ['radar', 'мини-карта'], ['quickbar', 'панель умений'],
  ['extra', 'боковая панель умений'], ['ctrl', 'ряд умений Ctrl'], ['alt', 'ряд умений Alt'], ['start', 'кнопка меню']];

/** Открыть «Вид интерфейса». */
function openStyle() {
  $('.nav[data-view="look"]').click();
}

/** Стиль поменялся — экран предпросмотра собрать заново (если он открыт). */
const lkPreviewSoon = debounce(() => {
  if ($('.view[data-view="editor"]').classList.contains('is-active')) loadEditor();
}, 500);

/** Источники групп: из микшера или из старых галочек. */
function lookGroups() {
  const p = state.profile;
  if (p.look && p.look.groups) return p.look.groups;
  const cl = p.classic || {};
  const base = cl.enabled ? 'classic' : p.v5 && p.v5.enabled ? 'v5' : 'own';
  const out = {};
  for (const g of (lk.plan && lk.plan.groups) || []) {
    if (g.kind === 'switch') {
      out[g.id] = { hudwin: cl.hud && cl.hud.enabled, winfix: cl.enabled, maptiles: cl.maps }[g.id] ? 'classic' : 'own';
    } else {
      out[g.id] = base;
    }
  }
  return out;
}

function lkSet(changes) {
  const groups = Object.assign({}, lookGroups(), changes);
  state.profile.look = { groups };
  saveProfile();
  renderBadges();
  renderSummary();
  renderLook();
  lkNotes();
  lkPreviewSoon();
}

/**
 * Верхняя карточка: стиль HUD в игре и форма мини-карты — то, что игрок
 * ищет первым; видна сразу, без чтения клиентов.
 */
function renderLookTop() {
  const hud = clState().hud;
  const set = hud.set || 's1';
  const square = !!(state.profile.radar && state.profile.radar.square);
  const ar = state.profile.arrange || {};
  const seg = (attr, items, cur) => '<div class="seg">' + items.map(([v, ru]) =>
    `<button data-${attr}="${v}" class="${cur === v ? 'is-on' : ''}">${ru}</button>`).join('') + '</div>';
  const box = $('#lk-top');
  const row = (title, control, hint) =>
    `<div class="lk__opt"><span class="lk__label">${title}</span>${control}<small>${hint}</small></div>`;
  box.innerHTML =
    row('Новый HUD ставить в', seg('set', [['s2', 'Обычный'], ['s1', 'Стиль Aion']], set),
      'окна HUD официального Classic встают только в этот стиль — в игре включи тот же: Настройки → Стиль интерфейса') +
    row('Мини-карта', seg('radar', [['round', 'круглая'], ['square', 'квадратная']], square ? 'square' : 'round'),
      'квадратная — как в Aion 2: карта обрезается квадратом, вместо кольца тонкая рамка') +
    row('Место карты', seg('amap', [['0', 'внизу'], ['1', 'справа вверху']], ar.mapTopRight ? '1' : '0'),
      set === 's1' ? 'боковые панели умений справа игра ставит над окном карты — с картой вверху панель III уходит за экран'
        : 'только в «Стиле Aion»');
  // окна HUD, которые таскаются мышью в игре
  const free = state.profile.hudFree || {};
  delete state.profile.hudFreeShow; // прежний режим подложек — убран
  box.insertAdjacentHTML('beforeend',
    '<div class="lk__opt lk__free"><span class="lk__label">Двигать мышью в игре</span>' +
    '<div class="lk__checks">' + LK_FREE.map(([k, ru]) =>
      `<label class="check"><input type="checkbox" data-free="${k}" ${free[k] ? 'checked' : ''} /> ${ru}</label>`).join('') + '</div>' +
    '<small>Отмеченные окна в игре перетаскиваются мышью — за пустое место окна или полосу у его правого края. ' +
    '<b class="lk__warn">Место живёт до выхода из игры:</b> игра его не запоминает, а координаты из файла для этих окон ' +
    'не берёт — после перезахода окна снова на обычных местах (проверено). Ряды Ctrl/Alt встают стопкой над панелью умений. ' +
    'Цель и портрет с HP/MP игра держит кодом — их не сдвинуть.</small>' +
    '</div>');
  box.querySelectorAll('[data-free]').forEach((c) => {
    c.onchange = () => {
      const f = Object.assign({}, state.profile.hudFree, { [c.dataset.free]: c.checked });
      if (!c.checked) delete f[c.dataset.free];
      if (Object.keys(f).length) state.profile.hudFree = f; else delete state.profile.hudFree;
      saveProfile(); renderSummary(); renderLookTop(); lkPreviewSoon();
    };
  });
  const changed = () => { saveProfile(); renderSummary(); renderLookTop(); lkPreviewSoon(); };
  box.querySelectorAll('[data-amap]').forEach((b) => {
    b.onclick = () => {
      // hpOverBar — прошлая проверка (полосы за границей окна игра обрезает), снимаем
      state.profile.arrange = Object.assign({}, state.profile.arrange, { mapTopRight: b.dataset.amap === '1' });
      delete state.profile.arrange.hpOverBar;
      changed();
    };
  });
  box.querySelectorAll('[data-set]').forEach((b) => {
    b.onclick = () => { clState().hud.set = b.dataset.set; changed(); };
  });
  box.querySelectorAll('[data-radar]').forEach((b) => {
    b.onclick = () => {
      state.profile.radar = Object.assign({}, state.profile.radar, { square: b.dataset.radar === 'square' });
      changed();
    };
  });
}

async function loadLook(force) {
  renderLookTop();
  lkNotes();
  if (!state.ready) return;
  const cl = clState();
  if (!cl.root) {
    // свой импорт или клиент на обычном месте — как в разделе «Официальный Classic»
    const guess = await guard(() => window.api.classic.guess());
    if (guess) { cl.root = guess; saveProfile(); }
  }
  const key = (cl.root || '') + '|' + (state.profile.lang || 'rus');
  if (!lk.plan || lk.planFor !== key || force) {
    $('#lk-grid').innerHTML = '<span class="muted">сравниваю свой вид с официальным и 5.x…</span>';
    const p = await guard(() => window.api.look.plan(cl.root || '', cl.rules));
    if (!p) { $('#lk-grid').innerHTML = '<span class="muted">не удалось прочитать</span>'; return; }
    lk.plan = p;
    lk.planFor = key;
  }
  renderLook();
}

const lkAvail = (g, src) => {
  if (src === 'own') return true;
  if (src === 'classic') return lk.plan.classicOk && (g.kind === 'switch' || g.classic > 0);
  return g.kind !== 'switch' && lk.plan.v5ok && g.v5 > 0;
};

/** Кусочек атласа: своего или официального. */
function lkPaint(box, spec, src) {
  const root = clState().root;
  const get = src === 'classic' ? (t, r, pad) => window.api.classic.preview(root, t, r, pad) : undefined;
  paintSkinInto(box, spec, get);
}

function lkSample(x, src) {
  if (src === 'classic' && x.classic) return [x.classic, 'classic'];
  if (src === 'v5' && x.v5) return [x.v5, 'v5'];
  return [x.own, 'own'];
}

function renderLook() {
  if (!lk.plan) return;
  const groups = lookGroups();
  const grid = $('#lk-grid');
  grid.innerHTML = '';
  const changed = Object.values(groups).filter((s) => s !== 'own').length;
  $('#lk-state').textContent = state.profile.look
    ? `не свой вид у групп: ${changed}`
    : 'сейчас — по галочкам разделов тонкой настройки';
  if (!lk.plan.classicOk) {
    const note = document.createElement('div');
    note.className = 'card lk__card';
    note.innerHTML = '<div class="lk__head"><b>Официального Classic пока нет</b>' +
      '<small>Импортируй его один раз — и он станет источником для любой группы.</small></div>' +
      '<div class="row"><button class="btn btn--primary">Импортировать…</button></div>';
    note.querySelector('button').onclick = () => $('.nav[data-view="classic"]').click();
    grid.appendChild(note);
  }
  for (const g of lk.plan.groups) {
    const any = g.kind === 'switch' ? lk.plan.classicOk : g.classic + g.v5 > 0;
    if (!any) continue;
    const cur = groups[g.id] || 'own';
    const card = document.createElement('div');
    card.className = 'card lk__card' + (lkAvail(g, cur) ? '' : ' is-off');
    const srcs = g.kind === 'switch' ? LK_SRC.slice(0, 2) : LK_SRC;
    card.innerHTML =
      `<div class="lk__head"><b>${esc(g.title)}</b>${g.hint ? `<small>${esc(g.hint)}</small>` : ''}</div>` +
      '<div class="seg">' + srcs.map(([id, ru]) => {
        const n = g.kind === 'switch' || id === 'own' ? '' : `<i>${g[id]}</i>`;
        return `<button data-src="${id}" class="${cur === id ? 'is-on' : ''}" ${lkAvail(g, id) ? '' : 'disabled'}>${ru}${n}</button>`;
      }).join('') + '</div>' +
      (g.kind === 'switch' ? '' : '<div class="lk__samples"></div>') +
      (lkAvail(g, cur) ? '' : '<small class="muted">выбранного источника сейчас нет — соберётся свой</small>');
    card.querySelectorAll('[data-src]').forEach((b) => {
      b.onclick = () => lkSet({ [g.id]: b.dataset.src });
    });
    grid.appendChild(card);
    const box = card.querySelector('.lk__samples');
    if (box) {
      for (const x of g.samples) {
        const cell = document.createElement('div');
        cell.className = 'skinprev';
        cell.title = x.name;
        box.appendChild(cell);
        const [spec, from] = lkSample(x, cur);
        lkPaint(cell, spec, from);
      }
    }
  }
  renderLookBoard();
}

/** Большое превью: по детали из каждой группы в выбранном виде. */
function renderLookBoard() {
  const board = $('#lk-board');
  if (!board) return; // доски больше нет — вид показывает экран «Интерфейса»
  board.innerHTML = '';
  const groups = lookGroups();
  for (const g of lk.plan.groups) {
    if (g.kind === 'switch' || !g.samples.length) continue;
    const cur = groups[g.id] || 'own';
    const [spec, from] = lkSample(g.samples[0], lkAvail(g, cur) ? cur : 'own');
    const piece = document.createElement('div');
    piece.className = 'lk__piece';
    piece.innerHTML = `<div class="skinprev"></div><small>${esc(g.title)}</small>`;
    board.appendChild(piece);
    lkPaint(piece.querySelector('.skinprev'), spec, from);
  }
}

/** В старых разделах предупредить: вид собирает микшер, их галочки не действуют. */
function lkNotes() {
  for (const view of ['classic', 'v5']) {
    const sec = $(`.view[data-view="${view}"]`);
    let n = sec.querySelector('.lk-note');
    if (!state.profile.look) { if (n) n.remove(); continue; }
    if (!n) {
      n = document.createElement('div');
      n.className = 'card lk-note';
      n.innerHTML = '<div class="row"><span class="state warn">Вид собирается в разделе «Вид интерфейса» — ' +
        'галочка «применять» здесь не действует, остальные настройки раздела — действуют.</span></div>' +
        '<div class="row"><button class="btn btn--ghost" data-go>Открыть «Вид интерфейса»</button>' +
        '<button class="btn btn--ghost" data-old>Вернуться к галочкам разделов</button></div>';
      n.querySelector('[data-go]').onclick = () => openStyle();
      n.querySelector('[data-old]').onclick = () => {
        delete state.profile.look;
        saveProfile();
        renderBadges();
        renderSummary();
        lkNotes();
        if (lk.plan) renderLook();
      };
      sec.insertBefore(n, sec.querySelector('.lede').nextSibling);
    }
  }
}

$$('[data-all]').forEach((b) => {
  b.onclick = () => {
    if (!lk.plan) return;
    const src = b.dataset.all;
    const ch = {};
    for (const g of lk.plan.groups) {
      // «всё из 5.x» переключатели официального не включает; недоступное — своё
      const want = g.kind === 'switch' ? (src === 'classic' ? 'classic' : 'own') : src;
      ch[g.id] = lkAvail(g, want) ? want : 'own';
    }
    lkSet(ch);
  };
});

/* ======================= мастер первого запуска ======================= */

const wz = { step: 0, choice: '', hud: true, set: 's2', progress: '' };
const WZ_STEPS = ['Клиент игры', 'Официальный Classic', 'Вид', 'Готово'];

/** Профиль пустой — значит, программу открыли впервые. */
function wzNeeded() {
  const p = state.profile;
  if (p.wizard) return false;
  const busy = p.look || (p.classic && (p.classic.enabled || (p.classic.hud && p.classic.hud.enabled))) ||
    (p.v5 && p.v5.enabled) || (p.portrait && p.portrait.enabled) || (p.font && p.font.enabled) ||
    (p.hitnum && p.hitnum.enabled) || Object.keys(p.layout || {}).length || Object.keys(p.skins || {}).length ||
    Object.values(p.packs || {}).some((x) => Object.keys(x || {}).length);
  return !busy;
}

function wzOpen() {
  wz.step = 0;
  wz.choice = '';
  $('#wz').hidden = false;
  wzRender();
}

function wzClose(done) {
  $('#wz').hidden = true;
  state.profile.wizard = done ? 1 : 'skipped';
  saveProfile();
}

async function wzRender() {
  $('#wz-steps').innerHTML = WZ_STEPS.map((t, i) =>
    `<span class="${i < wz.step ? 'is-done' : i === wz.step ? 'is-now' : ''}">${i + 1}. ${t}</span>`).join('');
  const body = $('#wz-body');
  const next = $('#wz-next');
  $('#wz-back').disabled = wz.step === 0;
  next.textContent = wz.step === WZ_STEPS.length - 1 ? 'Готово' : 'Дальше';
  next.disabled = false;

  if (wz.step === 0) {
    body.innerHTML = '<h2>Где установлена игра</h2>' +
      '<p>Нужна папка клиента AionEmpire — та, где лежат <code>bin64</code> и <code>data</code>.</p>' +
      `<div class="row"><input type="text" readonly value="${esc($('#client-path').value || '')}" placeholder="не найдена" />` +
      '<button class="btn" id="wz-pick">Выбрать…</button></div>' +
      `<div class="state ${state.ready ? 'ok' : 'bad'}">${esc($('#client-state').textContent)}</div>`;
    $('#wz-pick').onclick = () => guard(async () => { setClient(await window.api.client.pick()); wzRender(); });
    next.disabled = !state.ready;
    return;
  }

  if (wz.step === 1) {
    const cl = clState();
    const info = cl.root ? await guard(() => window.api.classic.info(cl.root)) : null;
    const guess = info && info.imported ? '' : await guard(() => window.api.classic.guess());
    const found = info && info.imported ? '' : (cl.root || guess || '');
    body.innerHTML = '<h2>Официальный Aion Classic</h2>' +
      '<p>Если у тебя стоит официальный клиент 4Game, программа один раз заберёт из него внешность ' +
      'интерфейса к себе (около 140 МБ) — и дальше он не понадобится. Этот шаг можно пропустить.</p>' +
      (info && info.imported
        ? `<div class="state ok">Уже импортирован: ${esc(info.source)}</div>`
        : `<div class="row"><input type="text" readonly value="${esc(found)}" placeholder="не найден" />` +
          `<button class="btn btn--primary" id="wz-import" ${found ? '' : 'disabled'}>Импортировать</button>` +
          '<button class="btn" id="wz-cpick">Другая папка…</button></div>') +
      `<div class="state" id="wz-progress">${esc(wz.progress)}</div>`;
    const run = (src) => guard(async () => {
      $('#wz-next').disabled = true;
      await runImport(src);
      wz.progress = '';
      wzRender();
    });
    if ($('#wz-import')) $('#wz-import').onclick = () => run(found);
    if ($('#wz-cpick')) {
      $('#wz-cpick').onclick = () => guard(async () => {
        const r = await window.api.classic.pick();
        if (r && r.ok) run(r.root);
        else if (r) toast('это не клиент Aion: не хватает ' + r.missing.join(', '), true);
      });
    }
    return;
  }

  if (wz.step === 2) {
    const cl = clState();
    const info = cl.root ? await guard(() => window.api.classic.info(cl.root)) : null;
    const hasClassic = !!(info && (info.imported || cl.root));
    const choice = (id, title, text, ok) =>
      `<button class="wz__choice${wz.choice === id ? ' is-on' : ''}" data-c="${id}" ${ok ? '' : 'disabled'}>` +
      `<b>${title}</b><small>${text}</small></button>`;
    body.innerHTML = '<h2>С чего начать</h2>' +
      '<p>Основа вида. Потом в разделе «Вид интерфейса» любую группу можно взять из другого источника.</p>' +
      '<div class="wz__choices">' +
      choice('own', 'Как сейчас', 'интерфейс клиента без изменений', true) +
      choice('classic', 'Официальный Classic', hasClassic ? 'новый плоский вид 4Game' : 'нужен импорт — шаг назад', hasClassic) +
      choice('v5', 'Aion 5.x', 'вид поздних версий игры', true) +
      '</div>' +
      (wz.choice === 'classic'
        ? '<label class="check"><input type="checkbox" id="wz-hud" ' + (wz.hud ? 'checked' : '') +
          ' /> и окна HUD официального (панель умений, полосы, цель)</label>' +
          '<div class="row"><label>Стиль в игре</label><select id="wz-set" class="sel">' +
          '<option value="s2">«Обычный стиль»</option><option value="s1">«Стиль Aion»</option></select></div>'
        : '');
    body.querySelectorAll('[data-c]').forEach((b) => { b.onclick = () => { wz.choice = b.dataset.c; wzRender(); }; });
    if ($('#wz-hud')) $('#wz-hud').onchange = (e) => { wz.hud = e.target.checked; };
    if ($('#wz-set')) { $('#wz-set').value = wz.set; $('#wz-set').onchange = (e) => { wz.set = e.target.value; }; }
    next.disabled = !wz.choice;
    return;
  }

  body.innerHTML = '<h2>Готово</h2>' +
    '<p>Основа выбрана. Дальше — «Собрать и установить» (игру перед этим закрой), а тонкая настройка ' +
    'по группам — в «Виде интерфейса», замена отдельных деталей — в «Интерфейсе». Иконки умений, цифры урона, бафы и шрифт — ' +
    'в своих разделах. Удачный набор сохрани пресетом (внизу слева) — к нему можно вернуться в пару кликов.</p>' +
    '<div class="row"><button class="btn btn--primary" id="wz-build">Собрать и установить</button></div>';
  $('#wz-build').onclick = () => $('#do-apply').click();
}

/** Выбор мастера — в микшер: все группы из основы. */
async function wzApplyChoice() {
  await loadLook(true);
  if (!lk.plan) return;
  const ch = {};
  for (const g of lk.plan.groups) {
    if (g.kind === 'switch') {
      const on = wz.choice === 'classic' && (g.id !== 'hudwin' || wz.hud);
      ch[g.id] = on && lkAvail(g, 'classic') ? 'classic' : 'own';
    } else {
      ch[g.id] = lkAvail(g, wz.choice) ? wz.choice : 'own';
    }
  }
  if (wz.choice === 'classic') clState().hud.set = wz.set;
  lkSet(ch);
}

$('#wz-back').onclick = () => { wz.step = Math.max(0, wz.step - 1); wzRender(); };
$('#wz-next').onclick = () => guard(async () => {
  if (wz.step === 2) await wzApplyChoice();
  if (wz.step === WZ_STEPS.length - 1) {
    wzClose(true);
    openStyle();
    return;
  }
  wz.step++;
  wzRender();
});
$('#wz-skip').onclick = () => wzClose(false);
$('#wz-open').onclick = () => wzOpen();
window.api.classic.onImportProgress((msg) => {
  wz.progress = 'импорт: ' + msg;
  const el = $('#wz-progress');
  if (el) el.textContent = wz.progress;
});
