'use strict';
/**
 * «Иконки» → «Предметы»: иконки из data/items/items.pak. Рангов и серых нет —
 * одна иконка, одна запись. Каталог с названиями — core/itemicons.js, правки —
 * profile.packs.items (ключ «пак|запись» -> DDS), пишет их сборка общим
 * проходом наборов. Картинка вписывается в угол родной иконки (skPickImage),
 * отрисовка сетки и кэш картинок — как у умений (paintSmall, contentOf).
 */

const it = { kind: 'skills', cat: null, selected: null, observer: null, pending: new Set(), images: new Map() };

const itStore = () => packStore('items');
const itQualityName = (q) => ((it.cat && it.cat.qualities.find((x) => x[0] === q)) || [q, q])[1];
const itGroupName = (g) => ((it.cat && it.cat.groups.find((x) => x[0] === g)) || [g, g])[1];

/** Переключатель «Умения / Предметы». */
function itKind(kind) {
  it.kind = kind;
  $$('#si-kind [data-kind]').forEach((b) => b.classList.toggle('is-on', b.dataset.kind === kind));
  $$('.view[data-view="skillicons"] [data-kind-only]').forEach((n) => { n.hidden = n.dataset.kindOnly !== kind; });
  try { localStorage.setItem('icons.kind', kind); } catch (e) { /* не важно */ }
  if (kind === 'items') loadItemIcons(); else loadSkillIcons();
}
$$('#si-kind [data-kind]').forEach((b) => { b.onclick = () => itKind(b.dataset.kind); });

/** Раздел открыли — показать ту вкладку, что была. */
function loadIconsSection() {
  let kind = it.kind;
  try { kind = localStorage.getItem('icons.kind') || kind; } catch (e) { /* по умолчанию */ }
  itKind(kind === 'items' ? 'items' : 'skills');
}

async function loadItemIcons(force) {
  if (!state.ready) return;
  if (!it.cat || force) {
    $('#it-grid').innerHTML = '<span class="muted">читаю таблицу предметов…</span>';
    it.cat = await guard(() => window.api.itemicons.catalogue());
    if (!it.cat) { $('#it-grid').innerHTML = '<span class="muted">не удалось прочитать</span>'; return; }
    const keepG = $('#it-group').value;
    const keepQ = $('#it-quality').value;
    $('#it-group').innerHTML = '<option value="">любой тип</option>' +
      it.cat.groups.map(([id, ru]) => `<option value="${id}">${ru}</option>`).join('');
    $('#it-quality').innerHTML = '<option value="">любое качество</option>' +
      it.cat.qualities.map(([id, ru]) => `<option value="${id}">${ru}</option>`).join('');
    $('#it-group').value = keepG || '';
    $('#it-quality').value = keepQ || '';
  }
  renderItemGrid();
  if (it.selected) renderItemCard();
}

function itFiltered() {
  const q = $('#it-search').value.trim().toLowerCase();
  const g = $('#it-group').value;
  const ql = $('#it-quality').value;
  const scope = $('#it-scope').value;
  const changed = $('#it-changed').checked;
  const store = itStore();
  return it.cat.icons.filter((x) => {
    if (scope === 'used' && !x.count) return false;
    if (scope === 'unused' && x.count) return false;
    if (g && x.group !== g) return false;
    if (ql && x.quality !== ql) return false;
    if (changed && !store[x.key]) return false;
    if (q && !x.id.includes(q) && !x.titles.some((t) => t.toLowerCase().includes(q))) return false;
    return true;
  });
}

function renderItemGrid() {
  if (!it.cat) return;
  const list = itFiltered();
  $('#it-count').textContent = `${list.length} из ${it.cat.icons.length}`;
  const grid = $('#it-grid');
  grid.innerHTML = '';
  if (it.observer) it.observer.disconnect();
  it.pending = new Set();
  if (!list.length) { grid.innerHTML = '<span class="muted">ничего не нашлось</span>'; return; }
  const store = itStore();
  const frag = document.createDocumentFragment();
  // тысячи ячеек: первые 1500, дальше — уточни поиск
  for (const x of list.slice(0, 1500)) {
    const cell = document.createElement('div');
    cell.className = 'skcell' + (store[x.key] ? ' is-set' : '') + (it.selected === x.id ? ' is-sel' : '');
    cell.dataset.id = x.id;
    const meta = [x.group ? itGroupName(x.group) : '', x.count > 1 ? `${x.count} предм.` : ''].filter(Boolean).join(' · ');
    cell.innerHTML = '<canvas width="40" height="40"></canvas>' +
      `<b title="${esc(x.title || x.id)}">${esc(x.title || x.id)}</b><small class="q-${esc(x.quality || 'none')}">${esc(meta || 'без предмета')}</small>`;
    cell.onclick = () => selectItemIcon(x.id);
    frag.appendChild(cell);
  }
  grid.appendChild(frag);
  if (list.length > 1500) {
    grid.insertAdjacentHTML('beforeend', `<span class="muted sk__more">показаны первые 1500 из ${list.length} — уточни поиск или фильтр</span>`);
  }
  it.observer = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      it.observer.unobserve(e.target);
      it.pending.add(e.target.dataset.id);
    }
    if (it.pending.size) flushItemCells();
  }, { rootMargin: '300px' });
  grid.querySelectorAll('.skcell').forEach((c) => it.observer.observe(c));
}

/** Картинки по ключам: своя (если есть) или родная; кэш по ключу и файлу. */
async function itImages(keys, original) {
  const store = itStore();
  const tag = (k) => k + '|' + (original ? '' : store[k] || '');
  const staged = keys.filter((k) => !original && store[k] && !it.images.has(tag(k)));
  const orig = keys.filter((k) => (original || !store[k]) && !it.images.has(tag(k)));
  if (staged.length) {
    const got = (await guard(() => window.api.skillicons.staged(staged.map((k) => store[k])))) || [];
    got.forEach((img, i) => { if (!img.error) it.images.set(tag(staged[i]), img); });
  }
  for (let i = 0; i < orig.length; i += 120) {
    const got = (await guard(() => window.api.packs.images('items', orig.slice(i, i + 120)))) || [];
    for (const img of got) if (!img.error) it.images.set(img.name + '|', img);
  }
  return new Map(keys.map((k) => [k, it.images.get(tag(k))]));
}

const flushItemCells = debounce(async () => {
  const ids = [...it.pending].slice(0, 120);
  ids.forEach((id) => it.pending.delete(id));
  const rows = ids.map((id) => it.cat.icons.find((x) => x.id === id)).filter(Boolean);
  const imgs = await itImages(rows.map((x) => x.key));
  for (const x of rows) {
    const cell = $(`#it-grid .skcell[data-id="${CSS.escape(x.id)}"]`);
    if (cell) paintSmall(cell.querySelector('canvas'), imgs.get(x.key));
  }
  if (it.pending.size) flushItemCells();
}, 40);

function selectItemIcon(id) {
  it.selected = id;
  $$('#it-grid .skcell').forEach((c) => c.classList.toggle('is-sel', c.dataset.id === id));
  renderItemCard();
}

async function renderItemCard() {
  const box = $('#it-card');
  const x = it.cat && it.cat.icons.find((r) => r.id === it.selected);
  if (!x) return;
  const set = !!itStore()[x.key];
  const meta = [
    x.count ? `у ${x.count} ${x.count === 1 ? 'предмета' : 'предметов'}` : 'ни один предмет её не использует',
    x.group ? 'тип: ' + itGroupName(x.group) : '',
    x.quality ? 'качество до: ' + itQualityName(x.quality) : '',
  ].filter(Boolean);
  box.innerHTML =
    `<div><h3 class="skc__title">${esc(x.title || x.id)}</h3><div class="skc__id">${esc(x.id)}.dds</div></div>` +
    `<div class="skc__meta">${meta.map(esc).join('<br>')}</div>` +
    (x.count > 1 ? `<div class="skc__warn">Иконка общая для ${x.count} предметов — замена поменяет её у всех.</div>` : '') +
    '<div class="skc__acts">' +
    '<button class="btn btn--primary" id="itc-set">Заменить…</button>' +
    `<button class="btn btn--danger" id="itc-revert" ${set ? '' : 'disabled'}>Вернуть как было</button>` +
    '<button class="btn btn--ghost" id="itc-export">PNG</button></div>' +
    '<div class="it__compare">' +
    '<figure><canvas data-k="orig"></canvas><figcaption>родная</figcaption></figure>' +
    `<figure><canvas data-k="now"></canvas><figcaption>${set ? 'своя' : 'будет в игре'}</figcaption></figure></div>` +
    '<div class="skc__hint">Картинка впишется в квадрат иконки с обрезкой по краям.</div>' +
    (x.titles.length > 1 ? '<h3 class="ed__h">Предметы с этой иконкой</h3><div class="it__names">' +
      x.titles.map((t) => `<span>${esc(t)}</span>`).join('') +
      (x.count > x.titles.length ? `<span class="muted">и ещё ${x.count - x.titles.length}</span>` : '') + '</div>' : '');

  $('#itc-set').onclick = () => itReplace(x);
  $('#itc-revert').onclick = () => itRevert(x);
  $('#itc-export').onclick = () => guard(async () => {
    const res = await window.api.packs.export('items', [x.key]);
    if (res) toast(`выгружено ${res.count} PNG в ${res.dir}`);
  });
  const [orig, now] = await Promise.all([itImages([x.key], true), itImages([x.key])]);
  if (it.selected !== x.id) return;
  paintSmall(box.querySelector('[data-k="orig"]'), orig.get(x.key));
  paintSmall(box.querySelector('[data-k="now"]'), now.get(x.key));
}

function itReplace(x) {
  return guard(async () => {
    const orig = (await itImages([x.key], true)).get(x.key);
    if (!orig) throw new Error('не удалось прочитать родную иконку');
    const px = await skPickImage(orig);
    if (!px) return;
    const file = await window.api.packs.stage({ pack: 'items', name: x.key, width: orig.width, height: orig.height, rgba: px });
    itStore()[x.key] = file;
    it.images.set(x.key + '|' + file, { width: orig.width, height: orig.height, rgba: px });
    renderBadges();
    saveProfile();
    renderItemCard();
    itRepaintCell(x, true);
    toast('готово к сборке');
  });
}

async function itRevert(x) {
  delete itStore()[x.key];
  renderBadges();
  saveProfile();
  renderItemCard();
  itRepaintCell(x, false);
  toast('вернётся родная при следующей сборке');
}

async function itRepaintCell(x, set) {
  const cell = $(`#it-grid .skcell[data-id="${CSS.escape(x.id)}"]`);
  if (!cell) return;
  cell.classList.toggle('is-set', set);
  paintSmall(cell.querySelector('canvas'), (await itImages([x.key])).get(x.key));
}

$('#it-search').oninput = debounce(renderItemGrid, 200);
['#it-group', '#it-quality', '#it-scope', '#it-changed'].forEach((s) => { $(s).onchange = renderItemGrid; });
