'use strict';
/**
 * Движение в окне программы — перенос из концепта Комплекс-Техно-Тепла (13.10, референсы unlumen-ui):
 *  - перетекающая подсветка: одна плашка под группой пунктов едет к пункту под курсором
 *    (пружина 1250 / 40 / 0,5, как у них) — левое меню, меню пресета, сегменты;
 *  - панель меню пресета раскрывается из кнопки и меняет высоту на пружине (350 / 32, «Motion Navigation Menu»);
 *  - мерцающий скелет: картинка из игры готовится дольше 0,3 с — место под ней мерцает, потом проявляется.
 * При «уменьшить движение» в Windows — без пружин и мерцания.
 */

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

/** Пружина по нескольким числам. Шаг интегрирования 2 мс — без рывков на любой частоте экрана. */
function spring(k, c, m, paint) {
  let cur = null, tgt = null, vel = [], last = 0, raf = 0;
  const step = (t) => {
    const dt = Math.min(0.05, (t - last) / 1000 || 0.016);
    last = t;
    for (let i = 0, n = Math.ceil(dt / 0.002), h = dt / n; i < n; i++) {
      for (let j = 0; j < cur.length; j++) {
        vel[j] += (-k * (cur[j] - tgt[j]) - c * vel[j]) / m * h;
        cur[j] += vel[j] * h;
      }
    }
    let done = true;
    for (let j = 0; j < cur.length; j++) {
      if (Math.abs(cur[j] - tgt[j]) > 0.05 || Math.abs(vel[j]) > 0.5) done = false;
    }
    if (done) { cur = tgt.slice(); vel = cur.map(() => 0); }
    raf = done ? 0 : requestAnimationFrame(step);
    paint(cur, done);
  };
  return {
    jump(v) {
      cancelAnimationFrame(raf); raf = 0;
      cur = v.slice(); tgt = v.slice(); vel = v.map(() => 0);
      paint(cur, true);
    },
    to(v) {
      if (!cur || reduceMotion.matches) { this.jump(v); return; }
      tgt = v.slice();
      if (!raf) { last = performance.now(); raf = requestAnimationFrame(step); }
    },
    stop() { cancelAnimationFrame(raf); raf = 0; },
    get running() { return !!raf; },
  };
}

/* ---------- перетекающая подсветка ---------- */

// группы подключаются при первом наведении — так ловятся и те, что дорисованы позже (меню пресета, сегменты)
const HL_GROUPS = [
  { box: '.rail', items: '.nav' },
  { box: '.pset__menu', items: '.pset__item, .pset__act:not([disabled])' },
  { box: '.seg', items: 'button:not([disabled])' },
];
const finePointer = matchMedia('(hover: hover) and (pointer: fine)');

function hlAttach(box, items) {
  box._hl = true;
  box.classList.add('hl-wrap');
  if (getComputedStyle(box).position === 'static') box.style.position = 'relative';
  const pl = document.createElement('span');
  pl.className = 'hl';
  pl.setAttribute('aria-hidden', 'true');
  let shown = false, hideT = 0;
  const sp = spring(1250, 40, 0.5, (v) => {
    pl.style.transform = `translate3d(${v[0].toFixed(2)}px,${v[1].toFixed(2)}px,0)`;
    pl.style.width = v[2].toFixed(2) + 'px';
    pl.style.height = v[3].toFixed(2) + 'px';
  });
  const over = (e) => {
    const it = e.target.closest(items);
    if (!it || !box.contains(it)) return;
    clearTimeout(hideT);
    // меню пресета перерисовывается целиком — плашку возвращаем на место
    if (!pl.isConnected) { box.prepend(pl); shown = false; }
    // делим на масштаб: меню пресета при раскрытии ещё немного уменьшено
    const b = box.getBoundingClientRect(), r = it.getBoundingClientRect();
    const sx = b.width / box.offsetWidth || 1, sy = b.height / box.offsetHeight || 1;
    const v = [(r.left - b.left) / sx - box.clientLeft + box.scrollLeft, (r.top - b.top) / sy - box.clientTop + box.scrollTop, r.width / sx, r.height / sy];
    pl.style.borderRadius = getComputedStyle(it).borderRadius;
    // первое появление — на месте, проявлением; дальше — едет
    if (!shown) { sp.jump(v); shown = true; pl.classList.add('is-on'); } else sp.to(v);
  };
  box.prepend(pl);
  box.addEventListener('pointerover', over);
  box.addEventListener('pointerleave', () => {
    hideT = setTimeout(() => { pl.classList.remove('is-on'); shown = false; }, 200);
  });
  return over;
}

document.addEventListener('pointerover', (e) => {
  if (!finePointer.matches || !(e.target instanceof Element)) return;
  for (const g of HL_GROUPS) {
    const box = e.target.closest(g.box);
    if (box && !box._hl) hlAttach(box, g.items)(e);
  }
});

/* ---------- панель меню пресета ---------- */

const panels = new WeakMap();

/** Высота панели без заданной вручную — с её max-height. */
function naturalHeight(el) {
  const h = el.style.height;
  el.style.height = '';
  const n = el.offsetHeight;
  el.style.height = h;
  return n;
}

function panelOf(el) {
  let p = panels.get(el);
  if (p) return p;
  p = { open: false, t: 0 };
  p.sp = spring(350, 32, 1, (v, done) => {
    el.style.height = v[0].toFixed(1) + 'px';
    if (done && p.open) { el.style.height = ''; el.style.overflow = ''; }
  });
  panels.set(el, p);
  return p;
}

/** Открыть / закрыть панель: вырастает из высоты кнопки, закрывается проявлением наоборот. */
function motionPanel(el, open) {
  const p = panelOf(el);
  clearTimeout(p.t);
  p.open = open;
  if (open) {
    el.hidden = false;
    el.classList.remove('is-closing');
    if (reduceMotion.matches) return;
    const h = naturalHeight(el);
    el.style.overflow = 'hidden';
    p.sp.jump([Math.min(h, 48)]);
    el.classList.add('is-opening');
    void el.offsetWidth;
    el.classList.remove('is-opening');
    p.sp.to([h]);
  } else {
    if (el.hidden || reduceMotion.matches) { el.hidden = true; return; }
    el.classList.add('is-closing');
    p.t = setTimeout(() => {
      p.sp.stop();
      el.hidden = true;
      el.classList.remove('is-closing');
      el.style.height = '';
      el.style.overflow = '';
    }, 150);
  }
}

/** Содержимое открытой панели поменялось — высота доезжает до новой. */
function motionFit(el) {
  const p = panels.get(el);
  if (!p || !p.open || el.hidden || reduceMotion.matches) return;
  const from = el.offsetHeight, h = naturalHeight(el);
  if (Math.abs(from - h) < 1) return;
  el.style.overflow = 'hidden';
  if (!p.sp.running) p.sp.jump([from]);
  p.sp.to([h]);
}

/* ---------- мерцающий скелет ---------- */

/**
 * Пока promise не готов дольше delay — элементы мерцают; после — плавно проявляются.
 * Быстрые — без мигания. Возвращает тот же promise.
 */
function skWait(els, promise, delay = 300) {
  const list = (Array.isArray(els) ? els : [els]).filter(Boolean);
  let on = false;
  const t = setTimeout(() => { on = true; list.forEach((el) => el.classList.add('sk')); }, delay);
  const done = () => {
    clearTimeout(t);
    if (!on) return;
    list.forEach((el) => {
      el.classList.remove('sk');
      el.classList.add('sk-in');
      setTimeout(() => el.classList.remove('sk-in'), 400);
    });
  };
  Promise.resolve(promise).then(done, done);
  return promise;
}
