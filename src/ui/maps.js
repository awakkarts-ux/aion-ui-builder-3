'use strict';
/**
 * «Карты»: своя картинка вместо большой карты зоны (окно карты, M).
 * Картинку читает и режет окно (canvas): сетка тайлов зоны, раскладка по
 * столбцам; тайлы уходят в main (core/usermaps.js) DDS-файлами, пути — в
 * profile.maps[«зона/слой»]. Сборка кладёт их в пак зоны.
 */

const mp = {
  zones: null, // [{ zone, name, world, layers: [{ key, prefix, grid, tile, entries }] }]
  key: '', // выбранный слой «зона/префикс»
  native: new Map(), // ключ -> ImageBitmap родной карты (превью)
  own: new Map(), // ключ -> ImageBitmap своей сохранённой (превью) | null
  img: null, // загруженная, ещё не сохранённая картинка { key, bmp, name }
  fit: 'cover', // cover | contain | stretch
  overlay: 0, // родная поверх своей, %
  busy: false,
};
const MP_PREVIEW = 1024;

const mpStore = () => (state.profile.maps = state.profile.maps || {});

function mpLayer(key) {
  for (const z of mp.zones || []) for (const l of z.layers) if (l.key === key) return { zone: z, layer: l };
  return null;
}

async function loadMaps(force) {
  if (!state.ready) { $('#mp-list').innerHTML = '<span class="muted pad">клиент не выбран</span>'; return; }
  if (!mp.zones || force) {
    $('#mp-list').innerHTML = '<span class="muted pad">читаю карты клиента…</span>';
    const list = await guard(() => window.api.maps.zones());
    if (!list) { $('#mp-list').innerHTML = '<span class="muted pad">не удалось прочитать карты</span>'; return; }
    mp.zones = list;
    mp.native.clear();
    mp.own.clear();
  }
  mpRenderList();
  if (mp.key && mpLayer(mp.key)) mpRenderMain();
}

function mpRenderList() {
  const q = $('#mp-search').value.trim().toLowerCase();
  const own = mpStore();
  const row = (z) => {
    const changed = z.layers.some((l) => own[l.key]);
    return `<button class="mp__zone${z.layers.some((l) => l.key === mp.key) ? ' is-active' : ''}" data-zone="${esc(z.zone)}">` +
      `<span class="mp__zt">${esc(z.name)}</span>` +
      `<small>${esc(z.zone)}${z.layers.length > 1 ? ' · этажей ' + z.layers.length : ''}</small>` +
      (changed ? '<i class="mp__dot" title="своя карта"></i>' : '') + '</button>';
  };
  const hit = (z) => !q || z.name.toLowerCase().includes(q) || z.zone.includes(q);
  const world = mp.zones.filter((z) => z.world && hit(z));
  const inst = mp.zones.filter((z) => !z.world && hit(z));
  $('#mp-list').innerHTML =
    (world.length ? '<div class="ed__group">Мир</div>' + world.map(row).join('') : '') +
    (inst.length ? '<div class="ed__group">Подземелья и арены</div>' + inst.map(row).join('') : '') +
    (!world.length && !inst.length ? '<span class="muted pad">ничего не нашлось</span>' : '');
  $$('#mp-list [data-zone]').forEach((b) => {
    b.onclick = () => {
      const z = mp.zones.find((x) => x.zone === b.dataset.zone);
      mp.key = z.layers[0].key;
      mp.img = null;
      mpRenderList();
      mpRenderMain();
    };
  });
}

const mpBitmap = async (img) => (img ? createImageBitmap(new ImageData(new Uint8ClampedArray(img.rgba), img.width, img.height)) : null);

async function mpNative(key) {
  if (!mp.native.has(key)) mp.native.set(key, await mpBitmap(await window.api.maps.preview(key, MP_PREVIEW)));
  return mp.native.get(key);
}

async function mpOwn(key) {
  if (!mpStore()[key]) return null;
  if (!mp.own.has(key)) mp.own.set(key, await mpBitmap(await window.api.maps.previewOwn(key, MP_PREVIEW).catch(() => null)));
  return mp.own.get(key);
}

/** Куда в квадрат S×S ляжет картинка w×h при выбранном вписывании. */
function mpPlace(w, h, S, fit) {
  if (fit === 'stretch') return [0, 0, S, S];
  const k = fit === 'contain' ? Math.min(S / w, S / h) : Math.max(S / w, S / h);
  const dw = w * k, dh = h * k;
  return [(S - dw) / 2, (S - dh) / 2, dw, dh];
}

function mpRenderMain() {
  const hit = mpLayer(mp.key);
  const box = $('#mp-main');
  if (!hit) { box.innerHTML = '<div class="muted pad">Выбери зону слева.</div>'; return; }
  const { zone, layer } = hit;
  const own = mpStore()[layer.key];
  const full = layer.grid * layer.tile;
  const pending = mp.img && mp.img.key === layer.key ? mp.img : null;
  const square = pending ? Math.abs(pending.bmp.width - pending.bmp.height) <= 2 : true;
  box.innerHTML = `
    <div class="mp__head">
      <div><b>${esc(zone.name)}</b><span>${esc(zone.zone)} · сетка ${layer.grid}×${layer.grid} по ${layer.tile} px · карта ${full}×${full}</span></div>
      ${zone.layers.length > 1 ? '<div class="seg" id="mp-layers">' + zone.layers.map((l, i) =>
        `<button data-layer="${esc(l.key)}" class="${l.key === layer.key ? 'is-on' : ''}">этаж ${i + 1}${mpStore()[l.key] ? ' •' : ''}</button>`).join('') + '</div>' : ''}
    </div>
    <div class="mp__work">
      <div class="mp__view"><canvas id="mp-canvas" width="${MP_PREVIEW}" height="${MP_PREVIEW}"></canvas>
        <span class="mp__tag" id="mp-tag"></span></div>
      <div class="mp__panel">
        <div class="lk__opt">
          <span class="lk__label">Своя карта</span>
          <div class="mp__file">${pending ? `<b>${esc(pending.name)}</b><small>${pending.bmp.width}×${pending.bmp.height} — ещё не сохранена</small>`
            : own ? `<b>${esc(own.source || 'своя картинка')}</b><small>сохранена · ${esc(String(own.at || '').slice(0, 10))}</small>`
              : '<small>не загружена — в игре родная</small>'}</div>
          <button class="btn ${pending ? '' : 'btn--primary'}" id="mp-pick">${own || pending ? 'Другая картинка…' : 'Загрузить картинку…'}</button>
          <input type="file" id="mp-file" accept="image/png,image/jpeg,image/webp,image/bmp" hidden />
        </div>
        ${pending ? `
        <div class="lk__opt">
          <span class="lk__label">Как вписать в ${full}×${full}</span>
          <div class="seg seg--full" id="mp-fit">
            <button data-fit="cover" class="${mp.fit === 'cover' ? 'is-on' : ''}">обрезать</button>
            <button data-fit="contain" class="${mp.fit === 'contain' ? 'is-on' : ''}">вписать</button>
            <button data-fit="stretch" class="${mp.fit === 'stretch' ? 'is-on' : ''}">растянуть</button>
          </div>
          <small>${square ? 'картинка квадратная — режим не важен' : 'картинка не квадратная: «обрезать» срежет края, «вписать» оставит поля, «растянуть» исказит'}</small>
        </div>
        <button class="btn btn--primary" id="mp-save">Сохранить карту</button>` : ''}
        <div class="lk__opt">
          <span class="scrub">Родная карта поверх <input type="range" id="mp-overlay" min="0" max="100" step="5" value="${mp.overlay}" ${own || pending ? '' : 'disabled'} /><b id="mp-ov-v">${mp.overlay}%</b></span>
          <small>сверь планировку: метки игрока, НПС и заданий игра ставит по координатам мира — дороги и здания на своей карте должны лечь туда же</small>
        </div>
        ${own && !pending ? '<button class="btn btn--danger" id="mp-clear">Вернуть родную</button>' : ''}
        <div class="state" id="mp-state"></div>
        <div class="hintbox">Меняется большая карта (M). Мини-карта и обзор мира остаются родными. После сохранения — «Собрать и установить», игра должна быть закрыта.</div>
      </div>
    </div>`;

  $$('#mp-layers [data-layer]').forEach((b) => { b.onclick = () => { mp.key = b.dataset.layer; mp.img = null; mpRenderMain(); }; });
  $('#mp-pick').onclick = () => $('#mp-file').click();
  $('#mp-file').onchange = (e) => mpLoadFile(e.target.files[0], layer.key);
  $$('#mp-fit [data-fit]').forEach((b) => { b.onclick = () => { mp.fit = b.dataset.fit; mpRenderMain(); }; });
  $('#mp-overlay').oninput = (e) => { mp.overlay = Number(e.target.value); $('#mp-ov-v').textContent = mp.overlay + '%'; mpPaint(); };
  if ($('#mp-save')) $('#mp-save').onclick = () => mpSave(layer);
  if ($('#mp-clear')) $('#mp-clear').onclick = () => mpClear(layer);
  mpPaint();
}

async function mpPaint() {
  const cv = $('#mp-canvas');
  if (!cv) return;
  const key = mp.key;
  const g = cv.getContext('2d');
  const S = cv.width;
  const pending = mp.img && mp.img.key === key ? mp.img : null;
  const [nat, own] = await Promise.all([mpNative(key).catch(() => null), pending ? null : mpOwn(key)]);
  if (key !== mp.key || !$('#mp-canvas')) return; // успели выбрать другую зону
  g.fillStyle = '#0b0b0c';
  g.fillRect(0, 0, S, S);
  const mine = pending ? pending.bmp : own;
  if (mine) {
    const [x, y, w, h] = pending ? mpPlace(mine.width, mine.height, S, mp.fit) : [0, 0, S, S];
    g.drawImage(mine, x, y, w, h);
    if (nat && mp.overlay) { g.globalAlpha = mp.overlay / 100; g.drawImage(nat, 0, 0, S, S); g.globalAlpha = 1; }
  } else if (nat) {
    g.drawImage(nat, 0, 0, S, S);
  }
  $('#mp-tag').textContent = mine ? (pending ? 'своя — не сохранена' : 'своя') : 'родная';
}

async function mpLoadFile(file, key) {
  if (!file) return;
  try {
    const bmp = await createImageBitmap(file);
    mp.img = { key, bmp, name: file.name };
    mp.overlay = 35; // сразу видно, совпадает ли планировка
    mpRenderMain();
  } catch (e) {
    toast('не удалось открыть картинку: ' + file.name, true);
  }
}

/** Режем на тайлы в полный размер и отдаём в main — тайл за тайлом. */
async function mpSave(layer) {
  const p = mp.img;
  if (!p || mp.busy) return;
  mp.busy = true;
  $('#mp-save').disabled = true;
  const st = $('#mp-state');
  const T = layer.tile;
  const S = layer.grid * T;
  const cv = document.createElement('canvas');
  cv.width = S; cv.height = S;
  const g = cv.getContext('2d', { willReadFrequently: true });
  g.fillStyle = '#000';
  g.fillRect(0, 0, S, S);
  g.imageSmoothingQuality = 'high';
  const [x, y, w, h] = mpPlace(p.bmp.width, p.bmp.height, S, mp.fit);
  g.drawImage(p.bmp, x, y, w, h);
  const tiles = {};
  const ok = await guard(async () => {
    for (let i = 0; i < layer.entries.length; i++) {
      st.className = 'state';
      st.textContent = `режу на тайлы: ${i + 1} из ${layer.entries.length}…`;
      const tx = Math.floor(i / layer.grid) * T; // по столбцам
      const ty = (i % layer.grid) * T;
      const d = g.getImageData(tx, ty, T, T);
      tiles[layer.entries[i]] = await window.api.maps.stageTile({
        key: layer.key, entry: layer.entries[i], width: T, height: T, rgba: d.data,
      });
    }
    return true;
  });
  mp.busy = false;
  if (!ok) { mpRenderMain(); return; }
  mpStore()[layer.key] = { tiles, source: p.name, fit: mp.fit, at: new Date().toISOString() };
  await window.api.profile.save(state.profile);
  saveProfile();
  renderBadges();
  renderSummary();
  // превью своей — из того, что уже в памяти
  const small = document.createElement('canvas');
  small.width = MP_PREVIEW; small.height = MP_PREVIEW;
  small.getContext('2d').drawImage(cv, 0, 0, MP_PREVIEW, MP_PREVIEW);
  mp.own.set(layer.key, await createImageBitmap(small));
  mp.img = null;
  mpRenderList();
  mpRenderMain();
  toast('карта сохранена — нажми «Собрать и установить»');
}

function mpClear(layer) {
  delete mpStore()[layer.key];
  if (!Object.keys(mpStore()).length) delete state.profile.maps;
  mp.own.delete(layer.key);
  saveProfile();
  renderBadges();
  renderSummary();
  mpRenderList();
  mpRenderMain();
  toast('вернётся родная карта — после «Собрать и установить»');
}

$('#mp-search').oninput = debounce(() => { if (mp.zones) mpRenderList(); }, 150);
