'use strict';

/*
 * Раздел «Бафы»: размер значков эффектов и сколько их в ряду. Правка —
 * profile.buffs[id окна] = { size, perRow }; сборка превращает её в правку
 * окна (hud.applyGrid). Место окон бафов в «Обычном стиле» игра выбирает сама
 * (проверено 27.09.2026), поэтому координат здесь нет.
 */

const bf = { info: null };

const bfStore = () => {
  if (!state.profile.buffs) state.profile.buffs = {};
  return state.profile.buffs;
};

async function loadBuffs(force) {
  if (!state.ready) return;
  if (!bf.info || force) {
    $('#bf-list').innerHTML = '<span class="muted">читаю окна бафов…</span>';
    bf.info = await guard(() => window.api.buffs.info());
    if (!bf.info) { $('#bf-list').innerHTML = '<span class="muted">не удалось прочитать</span>'; return; }
  }
  renderBuffs();
}

/** Окно бафов таскается мышью («Двигать мышью в игре»)? Ключи — как в core/hud.js FREE_WINDOWS. */
const BF_FREE_KEY = { 'game/buff_status_dialog.xml': 'buffs', 'game/debuff_status_dialog.xml': 'debuffs' };
const bfFree = (id) => !!(state.profile.hudFree && state.profile.hudFree[BF_FREE_KEY[id]]);

function renderBuffs() {
  const store = bfStore();
  const box = $('#bf-list');
  box.innerHTML = '';
  for (const w of bf.info) {
    const card = document.createElement('div');
    card.className = 'card';
    if (!w.found) {
      card.innerHTML = `<div class="bf__head"><b>${esc(w.title)}</b></div><div class="muted">в клиенте нет такого окна</div>`;
      box.appendChild(card);
      continue;
    }
    card.innerHTML =
      `<div class="bf__head"><b>${esc(w.title)}</b>` +
      `<small>родное: ${w.count} значков по ${w.size} px${w.auto ? '' : `, ${w.perRow} в ряд`}</small></div>` +
      '<div class="row">' +
      '<span class="scrub">Значок <input type="range" data-k="size" min="18" max="64" step="1" /><b data-v="size"></b></span>' +
      (w.auto ? '' :
        `<span class="scrub">В ряд <input type="range" data-k="perRow" min="1" max="${w.count}" step="1" /><b data-v="perRow"></b></span>`) +
      '<button class="btn btn--ghost" data-reset>как было</button>' +
      '</div>' +
      (w.auto ? '' : bfFree(w.id)
        // окно освобождено в «Виде интерфейса» — таскается мышью, сдвиг шириной не нужен
        ? '<div class="bf__note">Окно таскается мышью в игре («Вид интерфейса» → «Двигать мышью в игре») — ' +
          'сдвиг влево не применяется. Хватать за полосу у правого края окна. Место живёт до выхода из игры.</div>'
        : '<div class="row"><span class="hn__range">сдвинуть влево на <input type="number" data-d="left" min="0" max="1200" step="10" placeholder="0" /> px</span></div>' +
          '<div class="bf__note">Игра держит окно бафов за правый край: шире окно — значки левее. ' +
          'Вверх-вниз так не сдвинуть. Это место держится и после перезахода, в отличие от перетаскивания мышью ' +
          '(«Вид интерфейса» → «Двигать мышью в игре»), которое живёт до выхода из игры.</div>') +
      (w.auto
        ? '<div class="bf__note">Значки этого окна раскладывает сама игра — меняется только их размер.</div>'
        : '<div class="bf__note" data-note></div><div class="bf__prev"><canvas></canvas></div>');
    box.appendChild(card);

    // карточка обновляет только себя: перерисовка раздела оборвала бы перетаскивание ползунка
    const update = () => {
      const cur = bfStore()[w.id] || {};
      const size = cur.size || w.size;
      const perRow = w.auto ? 0 : cur.perRow || w.perRow;
      card.querySelector('[data-k="size"]').value = size;
      card.querySelector('[data-v="size"]').textContent = size + ' px';
      card.querySelector('[data-reset]').disabled = !bfStore()[w.id];
      if (w.auto) return;
      const rows = Math.ceil(w.count / perRow);
      card.querySelector('[data-k="perRow"]').value = perRow;
      card.querySelector('[data-v="perRow"]').textContent = perRow;
      const left = bfFree(w.id) ? 16 : cur.left || 0; // перетаскиваемому — полоса захвата вместо сдвига (hud.FREE_GRIP)
      card.querySelector('[data-note]').textContent =
        `Окно станет ${perRow * size + 6 + left}×${rows * size + 6} (${perRow} × ${rows}` +
        `${left ? `, значки левее на ${left}` : ''}).`;
      bfPaint(card.querySelector('canvas'), w.count, size, perRow);
    };
    const changed = () => { saveProfile(); renderBadges(); renderSummary(); update(); };

    card.querySelectorAll('input[type="range"]').forEach((inp) => {
      inp.oninput = () => {
        const s = bfStore();
        const e = Object.assign({}, s[w.id]);
        e[inp.dataset.k] = Number(inp.value);
        // совпало с родным — этой правки нет (место окна остаётся)
        if (e.size === w.size) delete e.size;
        if (w.auto || e.perRow === w.perRow) delete e.perRow;
        // место и сдвиг из прошлых версий раздела — игра их не слушает
        delete e.x; delete e.y; delete e.dx; delete e.dy;
        if (Object.keys(e).length) s[w.id] = e; else delete s[w.id];
        changed();
      };
    });
    card.querySelectorAll('input[data-d]').forEach((inp) => {
      const cur = (bfStore()[w.id] || {})[inp.dataset.d];
      inp.value = cur || '';
      inp.onchange = () => {
        const s = bfStore();
        const e = Object.assign({}, s[w.id]);
        const v = Math.max(0, Math.round(Number(inp.value) || 0));
        if (v) e[inp.dataset.d] = v; else delete e[inp.dataset.d];
        if (Object.keys(e).length) s[w.id] = e; else delete s[w.id];
        changed();
      };
    });
    card.querySelector('[data-reset]').onclick = () => {
      delete bfStore()[w.id];
      card.querySelectorAll('input[data-d]').forEach((i) => { i.value = ''; });
      changed();
    };
    update();
  }
}

/* ---------- разметка окон HUD (раздел «Сборка») ---------- */

/** Цвета — как в core/calib.js WINDOWS. */
const CALIB_LEGEND = [
  ['230,40,40', 'портрет и полосы HP/MP'], ['40,200,230', 'мини-карта'], ['240,200,30', 'панель умений'],
  ['255,255,255', 'полоса опыта'], ['240,120,20', 'меню'], ['220,50,230', 'цель'], ['255,140,200', 'цель цели'],
  ['60,220,80', 'бафы'], ['40,90,240', 'дебафы'], ['160,255,60', 'боковая панель III'],
];
$('#calib-legend').innerHTML = CALIB_LEGEND.map(([c, t]) => `<span><i style="border-color:rgb(${c})"></i>${t}</span>`).join('');
$('#calib-on').onchange = (e) => {
  state.profile.calib = { on: e.target.checked };
  saveProfile();
  renderSummary();
};
function calibSync() { $('#calib-on').checked = !!(state.profile.calib && state.profile.calib.on); }

/** Схема окна: значки в натуральную величину, первые — «занятые». */
function bfPaint(cv, count, size, perRow) {
  const rows = Math.ceil(count / perRow);
  cv.width = perRow * size + 6;
  cv.height = rows * size + 6;
  const g = cv.getContext('2d');
  g.strokeStyle = 'rgba(255,255,255,.25)';
  g.strokeRect(0.5, 0.5, cv.width - 1, cv.height - 1);
  for (let i = 0; i < count; i++) {
    const x = 3 + (i % perRow) * size;
    const y = 3 + Math.floor(i / perRow) * size;
    const hue = (i * 47) % 360;
    g.fillStyle = i < Math.min(count, 10) ? `hsl(${hue} 55% 42%)` : 'rgba(255,255,255,.06)';
    g.fillRect(x + 1, y + 1, size - 2, size - 2);
    g.strokeStyle = 'rgba(0,0,0,.6)';
    g.strokeRect(x + 1.5, y + 1.5, size - 3, size - 3);
  }
}
