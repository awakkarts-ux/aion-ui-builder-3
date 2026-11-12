'use strict';
/*
 * «Главная» и «Инструкция» (22.10).
 *
 * Главная — три баннера: как пользоваться (→ инструкция) и две основы вида.
 * Нажатие на баннер основы применяет её так же, как карточка во «Внешнем
 * виде» (stApply из style.js): меняется только вид, остальные разделы и
 * пресет не трогаются. Выбранную можно донастроить — переход во «Внешний вид»
 * или сразу в «Интерфейс».
 */

const HOME_ARROW = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 11 11 5M6 5h5v5"/></svg>';
const HOME_NEXT = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8h9.5M9 4.5 12.5 8 9 11.5"/></svg>';

const HOME_STEPS = [
  'Выберите основу вида — Classic или Aion 5.x.',
  'Донастройте нужные разделы: портрет, бафы, шрифт, цифры урона.',
  'Закройте игру и нажмите «Собрать и установить».',
];

/** Баннеры основ вида: id как в ST_CARDS, крупный знак и класс градиента. */
const HOME_LOOKS = [
  { id: 'classic', big: 'Classic', cls: 'hb--classic' },
  { id: 'v5', big: '5.x', cls: 'hb--v5' },
];
const HOME_LOOK_TEXT = {
  classic: ['Официальный Classic', 'Плоский вид 4Game', 'Основа интерфейса с официальными деталями Classic.'],
  v5: ['Aion 5.x', 'Вид поздних версий игры', 'Поздние детали интерфейса поверх текущего клиента.'],
};

function homeGo(view) {
  const target = view === 'style' ? 'look' : view;
  const b = document.querySelector(`.nav[data-view="${target}"]`);
  if (b) b.click();
}

function renderHome() {
  const cur = '';
  const looks = HOME_LOOKS.map((l) => {
    const card = HOME_LOOK_TEXT[l.id];
    const on = cur === l.id;
    return `<div class="hb flow ${l.cls}${on ? ' is-on' : ''}" role="button" tabindex="0" data-look="${l.id}" aria-pressed="${on}">` +
      '<span class="hb__glow"></span><span class="hb__spot"></span><span class="hb__grain"></span>' +
      `<div class="hb__top"><div><b>${esc(card[1])}</b><small>Основа вида</small></div>` +
      `<span class="hb__round" aria-hidden="true">${on ? '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3.5 8.5 3 3 6-7"/></svg>' : HOME_ARROW}</span></div>` +
      `<div class="hb__mid"><span class="hb__dots"></span><span class="hb__big">${esc(l.big)}</span></div>` +
      `<div class="hb__foot"><p>${esc(card[2])}</p><div class="hb__acts">` +
      (on
        ? '<span class="hb__on">Выбран</span>' +
          `<button class="pill" data-go="style">Настроить ${HOME_NEXT}</button>`
        : '<button class="pill" data-apply>Применить</button>') +
      '</div></div></div>';
  }).join('');

  $('#home-grid').innerHTML =
    '<div class="hb flow hb--guide" role="button" tabindex="0" data-go="guide">' +
    '<span class="hb__glow"></span><span class="hb__spot"></span><span class="hb__grain"></span>' +
    `<div class="hb__top"><div><b>Как пользоваться</b><small>Три шага до своего интерфейса</small></div>` +
    `<span class="hb__round" aria-hidden="true">${HOME_ARROW}</span></div>` +
    `<div class="hb__mid"><ol class="hb__steps">${HOME_STEPS.map((s) => `<li>${esc(s)}</li>`).join('')}</ol></div>` +
    '<div class="hb__foot"><p>Что делает каждый раздел и как вернуть всё как было.</p>' +
    `<div class="hb__acts"><button class="pill" data-go="guide">Изучить инструкцию ${HOME_NEXT}</button></div></div>` +
    '</div>' + looks;

  $('#home-note').innerHTML = cur
    ? 'Нужна точечная правка? <button data-go="editor">Тонкая настройка интерфейса</button> · ' +
      '<button data-none>Вернуть вид клиента</button>'
    : 'Сейчас — вид самого клиента. Отдельные детали можно поменять в <button data-go="editor">тонкой настройке</button>.';

  $$('#home-grid .hb').forEach((el) => {
    const act = (e) => {
      const go = e.target.closest('[data-go]');
      if (go) { homeGo(go.dataset.go); return; }
      const look = el.dataset.look;
      if (!look) return;
      homeGo('look');
    };
    el.onclick = act;
    el.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); act(e); } };
    // световое пятно за курсором
    el.onpointermove = (e) => {
      const r = el.getBoundingClientRect();
      el.style.setProperty('--mx', `${e.clientX - r.left}px`);
      el.style.setProperty('--my', `${e.clientY - r.top}px`);
    };
  });
  $$('#home-note [data-go]').forEach((b) => { b.onclick = () => homeGo(b.dataset.go); });
}

/* ======================= инструкция ======================= */

const GUIDE_STEPS = [
  ['Основа вида', 'На «Главной» или во «Внешнем виде» выберите официальный Classic или Aion 5.x. Это рамки, кнопки, полосы и окна всего интерфейса.'],
  ['Разделы', 'Остальное настраивается по отдельности и от основы не зависит: портрет, бафы, шрифт, иконки, цифры урона, карты.'],
  ['Сборка', 'Закройте игру и нажмите «Собрать и установить» вверху. Изменения появятся при следующем запуске клиента.'],
];

/** [раздел, название, что делает] — по разделам меню. */
const GUIDE_ITEMS = [
  ['style', 'Внешний вид', 'Основа вида всего интерфейса: официальный Classic или Aion 5.x. Для Classic здесь же стиль в игре, размер и форма мини-карты, место карты и значков почты.'],
  ['portrait', 'Крупный портрет', 'Большой портрет персонажа: готовые варианты окна и камеры. Работает в «Стиле Aion».'],
  ['buffs', 'Бафы', 'Размер значков, раскладка в ряд и сдвиг влево. Окно бафов можно двигать мышью прямо в игре и выбрать ему фон.'],
  ['font', 'Шрифт', 'Свой шрифт вместо шрифтов интерфейса игры.'],
  ['skillicons', 'Иконки', 'Свои картинки вместо иконок умений и предметов.'],
  ['hitnum', 'Цифры урона', 'Размер цифр урона до 250%, их цвет и вид — для каждого набора отдельно или для всех сразу.'],
  ['editor', 'Интерфейс', 'Экран предпросмотра: выберите элемент и замените его деталью другого вида или своей картинкой.'],
  ['maps', 'Карты', 'Своя картинка вместо большой карты зоны.'],
  ['apply', 'Сборка', 'Сводка того, что попадёт в игру, журнал последней сборки и разметка окон HUD.'],
  ['icons', 'Картинки интерфейса', 'Тонкая настройка: любая картинка из атласов интерфейса по отдельности.'],
];

const GUIDE_RULES = [
  ['Игра должна быть закрыта', 'Пока клиент запущен, он держит файлы, и сборка не начнётся.'],
  ['Оригиналы сохраняются', 'Перед первой правкой программа копирует штатные файлы в резерв. «Вернуть как было» вверху возвращает их.'],
  ['Пресеты', 'Пресет — сохранённый набор всех настроек. Переключается и сохраняется в верхней строке.'],
  ['После обновления сервера', 'Если патч заменил файлы игры, программа сама обновит резерв. Просто соберите заново.'],
];

function renderGuide() {
  // номер шага — разметкой: ::before у .card занят кромкой (live.css)
  $('#gd-steps').innerHTML = GUIDE_STEPS.map(([t, p], i) =>
    `<li class="card"><i>0${i + 1}</i><b>${esc(t)}</b><p>${esc(p)}</p></li>`).join('');
  $('#gd-grid').innerHTML = GUIDE_ITEMS.map(([view, t, p]) => {
    const ic = NAV_ICONS[view] || '';
    return `<div class="card gd__item"><header><span class="nav__ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
      `stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ic}</svg></span><b>${esc(t)}</b></header>` +
      `<p>${esc(p)}</p><button class="gd__go" data-go="${view}">Открыть раздел ${HOME_NEXT}</button></div>`;
  }).join('');
  $('#gd-rules').innerHTML = GUIDE_RULES.map(([t, p]) => `<div class="card"><b>${esc(t)}</b><p>${esc(p)}</p></div>`).join('');
  $$('#gd-grid [data-go]').forEach((b) => {
    b.onclick = () => {
      const target = b.dataset.go === 'style' ? 'look' : b.dataset.go;
      const nav = document.querySelector(`.nav[data-view="${target}"]`);
      if (nav) nav.click();
    };
  });
}

window.addEventListener('DOMContentLoaded', () => {
  renderHome();
  renderGuide();
  const home = document.querySelector('.nav[data-view="home"]');
  if (home) home.click();
});
