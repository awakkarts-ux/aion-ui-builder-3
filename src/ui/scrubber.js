'use strict';
/**
 * Ползунки и поля цвета — «скраббер» (референс пользователя 15.10, панель настроек unlumen-ui):
 * подпись и значение внутри дорожки, засечки через 10 %, бегунок — тонкая черта; у цвета — образец
 * и поле hex. Механика — родные input range / color, здесь только заливка (--p) и синхронизация hex.
 *
 * Разметка:
 *   <span class="scrub">Подпись <input type="range" …><b>значение</b></span>
 *   <label class="scrub scrub--color"><span>Подпись</span><span class="scrub__cc">
 *     <input type="color" …><input type="text" class="scrub__hex" maxlength="7" …></span></label>
 */

const valueDesc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
const SCRUB_SEL = '.scrub input[type="range"], .scrub input[type="color"]';

function scrubSync(inp) {
  const v = valueDesc.get.call(inp);
  if (inp.type === 'range') {
    const min = inp.min === '' ? 0 : Number(inp.min), max = inp.max === '' ? 100 : Number(inp.max);
    const p = max > min ? (Number(v) - min) / (max - min) : 0;
    inp.parentElement.style.setProperty('--p', Math.min(1, Math.max(0, p)).toFixed(4));
  } else {
    const hex = inp.parentElement.querySelector('.scrub__hex');
    if (hex && document.activeElement !== hex) hex.value = v;
  }
}

function scrubWire(inp) {
  if (inp._scrub) return;
  inp._scrub = true;
  // значение ставят и из кода (inp.value = …) — заливка и hex должны успевать за ним
  Object.defineProperty(inp, 'value', {
    configurable: true,
    get() { return valueDesc.get.call(this); },
    set(v) { valueDesc.set.call(this, v); scrubSync(this); },
  });
  inp.addEventListener('input', () => scrubSync(inp));
  scrubSync(inp);
}

document.querySelectorAll(SCRUB_SEL).forEach(scrubWire);
// карточки бафов, карты, цвета цифр дорисовываются позже
new MutationObserver((list) => {
  for (const m of list) {
    for (const n of m.addedNodes) {
      if (n.nodeType !== 1) continue;
      if (n.matches(SCRUB_SEL)) scrubWire(n);
      else if (n.matches('.scrub') || n.querySelector('.scrub')) n.querySelectorAll(SCRUB_SEL).forEach(scrubWire);
    }
  }
}).observe(document.body, { childList: true, subtree: true });

/* hex: верный цвет — сразу в образец (и в обработчики раздела), неверный — откат при уходе из поля */
const scrubHexColor = (hex) => hex.closest('.scrub__cc').querySelector('input[type="color"]');
document.addEventListener('input', (e) => {
  const hex = e.target.closest && e.target.closest('.scrub__hex');
  if (!hex) return;
  let v = hex.value.trim().toLowerCase();
  if (v && v[0] !== '#') v = '#' + v;
  const c = scrubHexColor(hex);
  if (!/^#[0-9a-f]{6}$/.test(v) || c.value.toLowerCase() === v) return;
  c.value = v;
  c.dispatchEvent(new Event('input', { bubbles: true }));
  c.dispatchEvent(new Event('change', { bubbles: true }));
});
document.addEventListener('focusout', (e) => {
  const hex = e.target.closest && e.target.closest('.scrub__hex');
  if (hex) setTimeout(() => scrubSync(scrubHexColor(hex)));
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.closest && e.target.closest('.scrub__hex')) e.target.blur();
});
