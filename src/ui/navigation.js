/* ======================= окно и разделы ======================= */

$('#w-min').onclick = () => window.api.window.minimize();
$('#w-max').onclick = () => window.api.window.toggle();
$('#w-close').onclick = () => window.api.window.close();

/** Значки разделов — линейные, в плашке перед названием (редизайн 01.10.2026). */
const NAV_ICONS = {
  home: '<path d="M4 10.5 12 4l8 6.5V19a1.5 1.5 0 0 1-1.5 1.5H15v-6h-6v6H5.5A1.5 1.5 0 0 1 4 19z"/>',
  guide: '<path d="M5 4.5h9.5L19 9v10.5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-14a1 1 0 0 1 1-1z"/><path d="M14 4.5V9h5M8 13h8M8 16.5h5"/>',
  client: '<path d="M3 7.5A1.5 1.5 0 0 1 4.5 6H9l2 2h8.5A1.5 1.5 0 0 1 21 9.5v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z"/>',
  editor: '<path d="M5 4l6.5 16 2.3-6.7L20.5 11z"/>',
  look: '<path d="M12 3 3 8l9 5 9-5z"/><path d="m3 13 9 5 9-5"/>',
  maps: '<path d="M9 4.5 3.5 6.8v12.7L9 17.2l6 2.3 5.5-2.3V4.5L15 6.8z"/><path d="M9 4.5v12.7M15 6.8v12.7"/>',
  portrait: '<circle cx="12" cy="8" r="4"/><path d="M4.5 20.5c0-3.8 3.4-5.8 7.5-5.8s7.5 2 7.5 5.8"/>',
  buffs: '<path d="M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.9z"/><path d="M18.5 16v4M16.5 18h4"/>',
  font: '<path d="M5 6.5h14M12 6.5V19M9 19h6"/>',
  skillicons: '<rect x="4" y="4" width="7" height="7" rx="1.8"/><rect x="13" y="4" width="7" height="7" rx="1.8"/><rect x="4" y="13" width="7" height="7" rx="1.8"/><rect x="13" y="13" width="7" height="7" rx="1.8"/>',
  hitnum: '<circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="2.5"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>',
  apply: '<path d="M12 3.5v11M7.5 10l4.5 4.5 4.5-4.5"/><path d="M4.5 16.5v2a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-2"/>',
  classic: '<path d="M4.5 18h15l-1.4-9.5-4.3 3.6L12 6l-1.8 6.1-4.3-3.6z"/>',
  v5: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5"/>',
  skins: '<path d="M12 3.5a8.5 8.5 0 1 0 0 17c1 0 1.5-.7 1.5-1.4 0-1.1-1-1.4-1-2.4s.9-1.7 2-1.7h2.2a3.8 3.8 0 0 0 3.8-3.8c0-4.2-3.8-7.7-8.5-7.7z"/><circle cx="7.8" cy="11.2" r="1"/><circle cx="10.2" cy="7.6" r="1"/><circle cx="14.6" cy="7.8" r="1"/>',
  icons: '<rect x="3.5" y="5" width="17" height="14" rx="2.2"/><circle cx="9" cy="10" r="1.6"/><path d="m20.5 15.5-4.8-4.8-8.2 8.3"/>',
  layout: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.2"/><path d="M9.5 4.5v15M9.5 11.5h11"/>',
};
$$('.nav').forEach((b) => {
  const d = NAV_ICONS[b.dataset.view];
  if (d && !b.querySelector('.nav__ic')) {
    b.insertAdjacentHTML('afterbegin', `<span class="nav__ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
      `stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${d}</svg></span>`);
  }
});

/** Открыть раздел. Работает и для разделов без пункта в меню («Вид интерфейса»
 *  открывается с карточки на Главной): тогда в меню ничего не подсвечено. */
function showView(view) {
  $$('.nav').forEach((x) => x.classList.toggle('is-active', x.dataset.view === view));
  $$('.view').forEach((v) => v.classList.toggle('is-active', v.dataset.view === view));
  if (view === 'icons') loadIcons();
  if (view === 'skillicons') loadIconsSection(); // умения или предметы — что было открыто
  if (view === 'hitnum') loadHitnum();
  if (view === 'buffs') loadBuffs();
  if (view === 'editor') loadEditor();
  if (view === 'look') loadLook();
  if (view === 'maps') loadMaps();
  if (view === 'portrait') renderPortrait();
  if (view === 'skins') loadSkins();
  if (view === 'v5') loadV5();
  if (view === 'classic') loadClassic();
  if (view === 'apply') renderSummary();
}

$$('.nav').forEach((b) => { b.onclick = () => showView(b.dataset.view); });
