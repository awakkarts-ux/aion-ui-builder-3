'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const fs = require('fs');
const path = require('path');
const { Worker } = require('worker_threads');

const pak = require('./core/pak');
const bxml = require('./core/bxml');
const dds = require('./core/dds');
const png = require('./core/png');
const hudlib = require('./core/hud');
const portrait = require('./core/portrait');
const skins = require('./core/skins');
const reset = require('./core/reset');
const v5lib = require('./core/v5');
const donorlib = require('./core/donor');
const donorimport = require('./core/donorimport');
const skillicons = require('./core/skillicons');
const looklib = require('./core/look');
const hudport = require('./core/hudport');
const mapslib = require('./core/maps');
const build = require('./core/build');
const elementslib = require('./core/elements');
const scenelib = require('./core/scene');
const presetlib = require('./core/presets');
const usermaps = require('./core/usermaps');
const itemicons = require('./core/itemicons');
const { relativePath, assertImage, assertRgbaBytes, safeFileName } = require('./core/safe');
const { Client, PAKS, PACKS } = require('./core/client');

const DEFAULT_ROOTS = [
  'G:\\Aion Empire\\classic',
  'C:\\Aion Empire\\classic',
  'D:\\Aion Empire\\classic',
];

let win = null;
let client = null;

function setupAutoUpdates() {
  if (!app.isPackaged) return;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = null;
  autoUpdater.on('checking-for-update', () => win?.webContents.send('update:status', { state: 'checking' }));
  autoUpdater.on('update-available', (info) => win?.webContents.send('update:status', { state: 'available', version: info.version }));
  autoUpdater.on('update-not-available', (info) => win?.webContents.send('update:status', { state: 'current', version: info.version }));
  autoUpdater.on('download-progress', (p) => win?.webContents.send('update:status', { state: 'downloading', percent: p.percent }));
  autoUpdater.on('update-downloaded', (info) => win?.webContents.send('update:status', { state: 'ready', version: info.version }));
  autoUpdater.on('error', (error) => win?.webContents.send('update:status', { state: 'error', message: error.message }));
  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  setTimeout(check, 2500);
  setInterval(check, 3 * 60 * 60 * 1000);
}

ipcMain.handle('update:info', () => ({ version: app.getVersion(), packaged: app.isPackaged }));
ipcMain.handle('update:check', () => app.isPackaged ? autoUpdater.checkForUpdates() : { updateInfo: null });
ipcMain.handle('update:download', () => autoUpdater.downloadUpdate());
// Тихая установка поверх (папку берёт прежнюю) и сразу запуск новой версии.
ipcMain.handle('update:install', () => setImmediate(() => autoUpdater.quitAndInstall(true, true)));

const userDir = () => app.getPath('userData');
const configPath = () => path.join(userDir(), 'config.json');
const profilePath = () => path.join(userDir(), 'profile.json');
const pendingProfilePath = () => path.join(userDir(), 'pending-profile.json');
const backupDir = () => path.join(userDir(), 'backup');

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}-${Date.now()}`;
  try {
    fs.writeFileSync(temp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(temp, file);
  } finally {
    if (fs.existsSync(temp)) fs.rmSync(temp, { force: true });
  }
}

function emptyProfile() {
  return {
    layout: {},
    font: { enabled: false, file: '', langs: [] },
    packs: { skills: {}, hitnum: {}, uiatlas: {}, items: {} },
    skins: {},
    v5: { enabled: false },
    classic: { enabled: false, root: '', off: {}, rules: {}, hud: { enabled: false, off: {} } },
    lang: 'rus',
  };
}

/** Профили ранних версий держали иконки в `icons` — переносим в `packs.skills`. */
function migrate(p) {
  const out = Object.assign(emptyProfile(), p);
  out.packs = Object.assign({ skills: {}, hitnum: {}, uiatlas: {}, items: {} }, out.packs);
  out.classic = Object.assign({ enabled: false, root: '', off: {}, rules: {} }, out.classic);
  out.classic.hud = Object.assign({ enabled: false, off: {} }, out.classic.hud);
  if (p && p.icons && Object.keys(p.icons).length) {
    out.packs.skills = Object.assign({}, p.icons, out.packs.skills);
  }
  delete out.icons;
  return out;
}

function useClient(root) {
  client = new Client(root, backupDir());
  nameCache.clear();
  skinCache = null;
  elementCache = null;
  return client.check();
}

function createWindow() {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1040,
    minHeight: 640,
    show: false,
    frame: false,
    backgroundColor: '#1e1f22',
    icon: path.join(__dirname, '..', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, 'ui', 'index.html'));
  win.once('ready-to-show', () => win.show());

  // Снимок окна для проверки внешнего вида: electron . --shot=out.png [--view=layout]
  const shot = process.argv.find((a) => a.startsWith('--shot='));
  if (shot) {
    const view = (process.argv.find((a) => a.startsWith('--view=')) || '').split('=')[1];
    const packArg = (process.argv.find((a) => a.startsWith('--pack=')) || '').split('=')[1];
    win.webContents.once('did-finish-load', async () => {
      if (view) {
        const sel = packArg
          ? `.nav[data-view="${view}"][data-pack="${packArg}"]`
          : `.nav[data-view="${view}"]`;
        await win.webContents.executeJavaScript(`document.querySelector('${sel}').click()`);
      }
      const find = (process.argv.find((a) => a.startsWith('--search=')) || '').split('=')[1];
      if (find) {
        const box = view === 'skins' ? '#skin-search' : '#icon-search';
        await win.webContents.executeJavaScript(
          `(() => { const i = document.querySelector('${box}');` +
          ` i.value = ${JSON.stringify(find)}; i.dispatchEvent(new Event('input')); })()`
        );
        if (view === 'skins') {
          await new Promise((r) => setTimeout(r, 900));
          await win.webContents.executeJavaScript(
            "(() => { const n = document.querySelector('#skin-list .skin'); if (n) n.click(); })()"
          );
        }
      }
      // --wait=мс — для разделов, которые долго считают (вид официального Classic)
      const wait = Number((process.argv.find((a) => a.startsWith('--wait=')) || '').split('=')[1]) || 2500;
      await new Promise((r) => setTimeout(r, wait));
      // --scroll=#id — прокрутить к элементу, чтобы снять низ длинного раздела
      const scroll = (process.argv.find((a) => a.startsWith('--scroll=')) || '').split('=')[1];
      if (scroll) {
        await win.webContents.executeJavaScript(
          `(() => { const n = document.querySelector(${JSON.stringify(scroll)}); if (n) n.scrollIntoView(); })()`
        );
        await new Promise((r) => setTimeout(r, 1500));
      }
      const img = await win.webContents.capturePage();
      fs.writeFileSync(shot.slice(7), img.toPNG());
      app.quit();
    });
  }
  const tell = () => win.webContents.send('window:state', win.isMaximized());
  win.on('maximize', tell);
  win.on('unmaximize', tell);
}

app.whenReady().then(() => {
  createWindow();
  setupAutoUpdates();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => app.quit());

// ---- окно ----------------------------------------------------------------

ipcMain.handle('window:minimize', () => win && win.minimize());
ipcMain.handle('window:toggle', () => {
  if (!win) return false;
  if (win.isMaximized()) win.unmaximize();
  else win.maximize();
  return win.isMaximized();
});
ipcMain.handle('window:close', () => win && win.close());

// ---- клиент --------------------------------------------------------------

ipcMain.handle('client:init', () => {
  const cfg = readJson(configPath(), {});
  let root = cfg.clientRoot;
  if (!root || !fs.existsSync(root)) {
    root = DEFAULT_ROOTS.find((p) => fs.existsSync(path.join(p, 'bin64', 'crysystem.dll'))) || '';
  }
  if (!root) return { root: '', ok: false, missing: [] };
  const check = useClient(root);
  if (check.ok) writeJson(configPath(), Object.assign(cfg, { clientRoot: root }));
  return Object.assign({ root, languages: client.languages() }, check);
});

ipcMain.handle('client:pick', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Папка клиента (та, где лежат bin64 и data)',
    properties: ['openDirectory'],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  let root = r.filePaths[0];
  // Пользователь мог выбрать папку игры, а не classic внутри неё.
  if (!fs.existsSync(path.join(root, 'bin64')) &&
      fs.existsSync(path.join(root, 'classic', 'bin64'))) {
    root = path.join(root, 'classic');
  }
  const check = useClient(root);
  if (check.ok) {
    const cfg = readJson(configPath(), {});
    writeJson(configPath(), Object.assign(cfg, { clientRoot: root }));
  }
  return Object.assign({ root, languages: client.languages() }, check);
});

ipcMain.handle('client:reveal', (_e, rel) => {
  if (!client) return;
  shell.showItemInFolder(rel ? client.abs(rel) : client.root);
});

// ---- опись диалогов ------------------------------------------------------

ipcMain.handle('catalogue:load', () => {
  if (!client) throw new Error('клиент не выбран');
  const paks = {};
  for (const key of Object.keys(PAKS)) {
    if (key === 'ui') continue; // там не диалоги, а экраны и тексты
    try {
      paks[key] = client.original(key);
    } catch (e) {
      // один битый пак не должен ронять всю опись
    }
  }
  return hudlib.catalogue(paks);
});

ipcMain.handle('catalogue:xml', (_e, id) => {
  const cut = id.indexOf('/');
  const files = client.original(id.slice(0, cut));
  const data = files.get(id.slice(cut + 1));
  if (!data) throw new Error('нет записи ' + id);
  return bxml.parse(data).root.toXml();
});

// ---- профиль -------------------------------------------------------------

ipcMain.handle('profile:get', () => migrate(readJson(profilePath(), null)));
ipcMain.handle('profile:sync', () => readJson(pendingProfilePath(), null));
/** Запуск ради снимка окна (--shot) — профиль пользователя не трогаем. */
const SHOT_MODE = process.argv.some((a) => a.startsWith('--shot='));

ipcMain.handle('profile:save', (_e, profile) => {
  if (SHOT_MODE) return true;
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) throw new TypeError('profile must be an object');
  if (JSON.stringify(profile).length > 5_000_000) throw new RangeError('profile is too large');
  writeJson(profilePath(), profile);
  return true;
});
// ---- свои карты -------------------------------------------------------------

let mapZones = null; // { root, lang, list }
function userMapZones() {
  if (!client) throw new Error('клиент не выбран');
  const lang = activeLang();
  if (!mapZones || mapZones.root !== client.root || mapZones.lang !== lang) {
    mapZones = { root: client.root, lang, list: usermaps.zones(client, lang) };
  }
  return mapZones.list;
}
ipcMain.handle('maps:zones', () => userMapZones());
ipcMain.handle('maps:preview', (_e, { key, size }) => {
  const hit = usermaps.findLayer(userMapZones(), key);
  if (!hit) throw new Error('нет такой карты: ' + key);
  return usermaps.preview(client, hit.zone, hit.layer, size);
});
ipcMain.handle('maps:previewOwn', (_e, { key, size }) => {
  const hit = usermaps.findLayer(userMapZones(), key);
  const own = (readJson(profilePath(), {}).maps || {})[key];
  if (!hit || !own) return null;
  return usermaps.previewOwn(hit.layer, own.tiles, size);
});
ipcMain.handle('maps:stageTile', (_e, { key, entry, width, height, rgba }) => {
  const hit = usermaps.findLayer(userMapZones(), key);
  if (!hit || !hit.layer.entries.includes(entry)) throw new Error('нет такого тайла: ' + key + ' ' + entry);
  return usermaps.stageTile(path.join(userDir(), 'staged', 'maps'), key, entry, width, height, rgba);
});

// ---- пресеты --------------------------------------------------------------

let presetStore = null;
const presets = () => presetStore || (presetStore = new presetlib.Presets(userDir()));
/** Какой пресет включён последним — в config.json (к пресету не относится). */
const activePreset = () => readJson(configPath(), {}).preset || null;
const setActivePreset = (id) => writeJson(configPath(), Object.assign(readJson(configPath(), {}), { preset: id || null }));

/** Список + какой включён и изменён ли он относительно сохранённого. */
function presetState(profile) {
  const list = presets().list();
  let active = activePreset();
  if (active && !list.some((p) => p.id === active)) { active = null; setActivePreset(null); }
  return { list, active, changed: active ? presets().changed(active, profile || readJson(profilePath(), {})) : null };
}

ipcMain.handle('preset:state', (_e, profile) => presetState(profile));
ipcMain.handle('preset:save', (_e, { profile, id, name, description }) => {
  const rec = presets().save(profile, { id, name, description });
  setActivePreset(rec.id);
  return presetState(profile);
});
ipcMain.handle('preset:rename', (_e, { id, name, description }) => {
  presets().rename(id, { name, description });
  return presetState();
});
ipcMain.handle('preset:apply', (_e, { id, profile }) => {
  const next = migrate(presets().apply(id, profile));
  if (!SHOT_MODE) writeJson(profilePath(), next);
  setActivePreset(id);
  elementCache = null;
  return { profile: next, state: presetState(next) };
});
ipcMain.handle('preset:remove', (_e, id) => {
  presets().remove(id);
  if (activePreset() === id) setActivePreset(null);
  return presetState();
});
ipcMain.handle('preset:export', async (_e, id) => {
  const rec = presets().list().find((p) => p.id === id);
  if (!rec) throw new Error('нет такого пресета');
  const r = await dialog.showSaveDialog(win, {
    title: 'Экспорт пресета',
    defaultPath: rec.name.replace(/[\\/:*?"<>|]+/g, '_') + presetlib.EXT,
    filters: [{ name: 'Пресет сборщика', extensions: [presetlib.EXT.slice(1)] }],
  });
  if (r.canceled || !r.filePath) return null;
  return presets().exportTo(id, r.filePath);
});
ipcMain.handle('preset:import', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Импорт пресета',
    filters: [{ name: 'Пресет сборщика', extensions: [presetlib.EXT.slice(1)] }],
    properties: ['openFile'],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  const rec = presets().importFrom(r.filePaths[0]);
  return { imported: rec, state: presetState() };
});

ipcMain.handle('profile:export', async (_e, profile) => {
  const r = await dialog.showSaveDialog(win, {
    title: 'Сохранить профиль',
    defaultPath: 'aion-ui-profile.json',
    filters: [{ name: 'Профиль', extensions: ['json'] }],
  });
  if (r.canceled || !r.filePath) return null;
  writeJson(r.filePath, profile);
  return r.filePath;
});
ipcMain.handle('profile:import', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Открыть профиль',
    filters: [{ name: 'Профиль', extensions: ['json'] }],
    properties: ['openFile'],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  return migrate(readJson(r.filePaths[0], null));
});

// ---- сборка --------------------------------------------------------------

/**
 * Сборка — в фоновом потоке (core/buildworker.js), шаги журнала — в окно
 * событием build:progress. Поток один и живёт между сборками ради кэшей;
 * одновременно — одна сборка.
 */
let buildWorker = null;
let building = null;
let buildSeq = 0;
function stopBuildWorker() {
  if (buildWorker) buildWorker.terminate();
  buildWorker = null;
}
function runBuild(profile, log) {
  if (!buildWorker) {
    buildWorker = new Worker(path.join(__dirname, 'core', 'buildworker.js'));
    buildWorker.on('exit', () => { buildWorker = null; });
  }
  const w = buildWorker;
  const id = ++buildSeq;
  return new Promise((resolve, reject) => {
    const onMsg = (m) => {
      if (m.id !== id) return;
      if (m.progress) {
        log.push(m.progress);
        if (win) win.webContents.send('build:progress', m.progress);
      }
      if (m.done || m.error) {
        w.off('message', onMsg);
        w.off('error', onErr);
        if (m.done) resolve(m.done.report); else reject(new Error(m.error));
      }
    };
    const onErr = (e) => { w.off('message', onMsg); stopBuildWorker(); reject(e); };
    w.on('message', onMsg);
    w.on('error', onErr);
    w.postMessage({ id, clientRoot: client.root, backupDir: backupDir(), profile });
  });
}

ipcMain.handle('build:apply', async (_e, profile) => {
  if (!client) throw new Error('клиент не выбран');
  if (building) throw new Error('сборка уже идёт');
  const log = [];
  let report;
  building = runBuild(profile, log);
  try {
    report = await building;
  } catch (error) {
    try {
      writeJson(pendingProfilePath(), {
        status: 'build-failed',
        createdAt: new Date().toISOString(),
        error: error.message,
        profile,
      });
    } catch (markerError) {
      log.push('ВНИМАНИЕ: не удалось сохранить pending-профиль: ' + markerError.message);
    }
    throw error;
  } finally { building = null; }
  // Паки уже записаны — ошибка записи профиля не должна выглядеть как сбой
  // сборки, но и молча пропасть не должна: иначе после перезапуска программы
  // галочки сбросятся, и следующая сборка откатит всё назад.
  try {
    writeJson(profilePath(), profile);
    if (fs.existsSync(pendingProfilePath())) fs.rmSync(pendingProfilePath(), { force: true });
    log.push('профиль сохранён: ' + profilePath());
  } catch (e) {
    try {
      writeJson(pendingProfilePath(), {
        status: 'profile-save-failed',
        createdAt: new Date().toISOString(),
        error: e.message,
        profile,
      });
    } catch (markerError) {
      log.push('ВНИМАНИЕ: pending-профиль НЕ сохранён (' + markerError.message + ')');
    }
    log.push('ВНИМАНИЕ: профиль НЕ сохранён (' + profilePath() + '): ' + e.message);
  }
  return { report, log };
});

ipcMain.handle('build:restore', () => {
  if (!client) throw new Error('клиент не выбран');
  if (building) throw new Error('дождись конца сборки');
  return client.restoreAll();
});

ipcMain.handle('build:status', () => (client ? client.status() : []));

// ---- полный сброс --------------------------------------------------------

const quarantineDir = () => path.join(userDir(), 'removed');

ipcMain.handle('reset:plan', () => {
  if (!client) throw new Error('клиент не выбран');
  return reset.plan(client, quarantineDir());
});

ipcMain.handle('reset:run', () => {
  if (!client) throw new Error('клиент не выбран');
  if (building) throw new Error('дождись конца сборки');
  const done = reset.run(client, quarantineDir());
  nameCache.clear();
  skinCache = null;
  elementCache = null;
  client.cache.clear();
  stopBuildWorker(); // у потока сборки свой кэш паков
  return done;
});

ipcMain.handle('reset:undo', () => {
  if (!client) throw new Error('клиент не выбран');
  if (building) throw new Error('дождись конца сборки');
  const back = reset.undo(client, quarantineDir());
  nameCache.clear();
  skinCache = null;
  elementCache = null;
  client.cache.clear();
  stopBuildWorker();
  return back;
});

// ---- скины ---------------------------------------------------------------

const SKIN_LIBS = ['version4.xml', 'version5.xml'];
let skinCache = null;

function skinRows() {
  if (skinCache) return skinCache;
  if (!client) throw new Error('клиент не выбран');
  const files = client.original('preload');
  const rows = [];
  for (const lib of SKIN_LIBS) {
    const data = files.get(lib);
    if (data) rows.push(...skins.list(data, lib));
  }
  skinCache = rows;
  return rows;
}

/** Атлас по имени из скина (`textures/ui/v4_common`) — ищем в наборе картинок. */
function atlasImage(texture) {
  const want = skins.atlasKey(texture);
  for (const row of client.packIndex('uiatlas', activeLang()).values()) {
    if (row.short.toLowerCase().replace(/\.dds$/, '') !== want) continue;
    const raw = client.packRead('uiatlas', activeLang(), [row.key]).get(row.key);
    if (raw) return { img: dds.toRgba(raw), from: row.rel };
  }
  return null;
}

ipcMain.handle('skins:list', (_e, { query, lib }) => {
  const all = skinRows();
  const q = (query || '').trim().toLowerCase();
  const rows = all.filter((r) =>
    (!lib || r.lib === lib) &&
    (!q || r.name.toLowerCase().includes(q) || r.category.toLowerCase().includes(q)));
  return {
    total: all.length,
    libs: SKIN_LIBS.filter((l) => all.some((r) => r.lib === l)),
    rows: rows.slice(0, 600).map((r) => ({
      key: r.key, name: r.name, category: r.category, lib: r.lib,
      texture: r.texture, atlas: r.atlas, nine: r.nine,
      rect: r.rects.src_image || r.rects.src_middle_middle,
      fields: Object.keys(r.rects),
    })),
    shown: Math.min(rows.length, 600),
    found: rows.length,
  };
});

// ---- редактор интерфейса: сцена и каталог элементов ------------------------
// Всё считается по сборке в памяти (build.apply с dry): предпросмотр и каталог
// видят ровно то, что уйдёт в игру, — вид официального Classic, окна HUD и т. д.

let elementCache = null; // { sig, scene, catalog }

/** Ручные названия элементов — часть программы, лежат рядом с кодом. */
function elementNames() {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'element-names.json'), 'utf8'));
  } catch (e) {
    return {};
  }
}

/** Правки редактора ложатся поверх сцены в окне — на основу сцены они не влияют. */
function sceneBase(profile) {
  return Object.assign({}, profile, { elements: {} });
}

function editorScene(profile) {
  if (!client) throw new Error('клиент не выбран');
  const base = sceneBase(profile || {});
  const sig = JSON.stringify(base);
  if (elementCache && elementCache.sig === sig) return elementCache;
  const dry = build.apply(client, base, null, { dry: true }).dry;
  // Редактор показывает экран «Стиля Aion» (частые окна — hud_s1). hud.set —
  // куда ставится новый HUD официального Classic, к раскладке экрана не относится.
  const set = 's1';
  const scene = new scenelib.Scene(client, activeLang(), dry, hudport.screenOf(client), set);
  const catalog = elementslib.build({
    libs: scene.libs(), dialogs: scene.allDialogs(), strings: scene.strings, names: elementNames(),
  });
  elementCache = { sig, scene, catalog };
  return elementCache;
}

const needScene = () => {
  if (!elementCache) throw new Error('редактор не открыт');
  return elementCache;
};

ipcMain.handle('editor:open', (_e, profile) => {
  const { scene, catalog } = editorScene(profile);
  const skinDraws = {};
  for (const [name, row] of catalog.skinByName) {
    skinDraws[name] = { texture: row.texture, atlas: row.atlas, nine: row.nine, rects: row.rects };
  }
  return {
    elements: catalog.elements, windows: catalog.windows, kinds: elementslib.KINDS,
    skins: skinDraws, screen: scene.screen, set: scene.set,  };
});

ipcMain.handle('editor:window', (_e, { id, variant, tabs }) => needScene().scene.window(id, variant, tabs));

ipcMain.handle('editor:atlas', (_e, texture) => {
  const img = needScene().scene.atlas(texture);
  return img ? { width: img.width, height: img.height, rgba: img.rgba } : null;
});

// шрифт текста на экране: свой из раздела «Шрифт» (игра подменяет им три
// гарнитуры), иначе родной из пака локали
ipcMain.handle('editor:font', (_e, face) => {
  const font = readJson(profilePath(), {}).font || {};
  const own = font.enabled && font.file && fs.existsSync(font.file) &&
    build.FONT_NAMES.some((n) => n.replace(/\.[^.]+$/, '').toLowerCase() === String(face).toLowerCase());
  return own ? fs.readFileSync(font.file) : needScene().scene.fontFile(face);
});

// варианты без атласа в клиенте (картинки, которых нет) — пустые квадраты, не предлагаем
ipcMain.handle('editor:candidates', (_e, { id, limit }) => {
  const { scene, catalog } = needScene();
  const byId = new Map(catalog.elements.map((e) => [e.id, e]));
  return elementslib.candidates(catalog, id, 1000).filter((c) => {
    const e = byId.get(c.id);
    return e && e.states.every((s) => {
      const row = catalog.skinByName.get(s.skin);
      return !row || scene.hasAtlas(row.texture);
    });
  }).slice(0, limit || 120);
});

/** Своя картинка элемента: пиксели из окна -> DDS в userData, путь — в профиль. */
ipcMain.handle('editor:stageImage', (_e, { id, state, width, height, rgba }) => {
  const outDir = path.join(userDir(), 'staged', 'elements');
  fs.mkdirSync(outDir, { recursive: true });
  const safe = (id + '__' + (state || 'image')).replace(/[^\w.-]+/g, '_');
  const file = path.join(outDir, safe + '.dds');
  fs.writeFileSync(file, dds.fromRgba(width, height, Buffer.from(rgba)));
  return file;
});

ipcMain.handle('editor:readImage', (_e, file) => {
  const safe = relativePath(path.join(userDir(), 'staged'), file, 'staged image');
  const img = dds.toRgba(fs.readFileSync(safe));
  return { width: img.width, height: img.height, rgba: img.rgba };
});

/** Вырезает кусок атласа, чтобы показать, как скин выглядит. */
ipcMain.handle('skins:preview', (_e, { texture, rect, pad }) => {
  if (!client) return null;
  const a = atlasImage(texture);
  if (!a || !rect) return null;
  return Object.assign(cropForPreview(a.img, rect, pad), { from: a.from });
});

/** Кусок атласа с полями вокруг — для превью скина. */
function cropForPreview(img, rect, pad) {
  const m = Math.max(0, pad || 0);
  const x0 = Math.max(0, rect.x - m);
  const y0 = Math.max(0, rect.y - m);
  const x1 = Math.min(img.width, rect.x + rect.w + m);
  const y1 = Math.min(img.height, rect.y + rect.h + m);
  const w = Math.max(1, x1 - x0);
  const h = Math.max(1, y1 - y0);
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    img.rgba.copy(out, y * w * 4, ((y0 + y) * img.width + x0) * 4,
      ((y0 + y) * img.width + x0) * 4 + w * 4);
  }
  return {
    width: w, height: h, rgba: out,
    atlas: [img.width, img.height],
    offset: [rect.x - x0, rect.y - y0],
  };
}

ipcMain.handle('v5:plan', (_e, rules) => {
  if (!client) throw new Error('клиент не выбран');
  const files = client.original('preload');
  const a = files.get(v5lib.V4_LIB);
  const b = files.get(v5lib.V5_LIB);
  if (!a || !b) throw new Error('в preload.pak нет обеих библиотек скинов');
  const have = new Set();
  for (const row of client.packIndex('uiatlas', activeLang()).values()) {
    have.add(row.short.toLowerCase().replace(/\.dds$/, ''));
  }
  const p = v5lib.plan(a, b, have, rules);
  // Счётчик у выключенного правила иначе показывал бы ноль. Считаем его на
  // раскладе со всеми включёнными правилами — тогда видно, сколько оно даст.
  const full = v5lib.plan(a, b, have, {});
  const fullCount = new Map(full.rules.map((r) => [r.id, r.count]));
  return {
    total: p.total,
    matched: p.matched,
    unmatched: p.unmatched.length,
    noAtlas: p.noAtlas.map((x) => x.texture).filter((v, i, s) => s.indexOf(v) === i),
    byCategory: p.byCategory.slice(0, 14),
    restByCategory: p.restByCategory,
    rules: p.rules.map((r) => Object.assign({}, r, { count: fullCount.get(r.id) || 0 })),
    // чем именно правила дополнили точное совпадение — чтобы это можно было увидеть
    extra: full.pairs.filter((x) => x.rule !== 'exact')
      .map((x) => ({ name: x.name, to: x.to, rule: x.rule })),
    // образцы для показа «до и после»: самые заметные детали интерфейса
    samples: ['v4_button_up', 'v4_slot_bg', 'v4_dialog', 'v4_hud_radar_wnd',
      'v4_editbox_bg', 'v4_tab_button_up', 'v4_scroll_slider_up', 'v4_container_bg',
      'v4_close_up', 'v4_header_up']
      .map((n) => p.pairs.find((x) => x.name === n))
      .filter(Boolean),
  };
});

// ---- вид официального Classic (клиент-донор) -----------------------------

let donorCache = null; // { root, donor, plans: Map<ключ, план> }

function getDonor(root) {
  if (!root) throw new Error('не выбрана папка официального клиента');
  if (!donorCache || donorCache.root !== root) {
    donorCache = { root, donor: new donorlib.Donor(root), plans: new Map() };
  }
  return donorCache.donor;
}

/** Самые заметные детали — показываем их первыми в «до и после». */
const CLASSIC_SAMPLES = ['v4_button_up', 'v4_dialog', 'v4_slot_bg', 'v4_hud_radar_wnd',
  'v4_tab_button_up', 'v4_editbox_bg', 'v4_scroll_slider_up', 'v4_close_up',
  'v4_header_up', 'v4_container_bg', 'v4_popup_frame', 'v4_gauge_hp'];

/** Где обычно лежит официальный клиент — чтобы не выбирать руками в первый раз. */
const DEFAULT_DONORS = ['E:\\Aion Classic', 'D:\\Aion Classic', 'C:\\Aion Classic',
  'G:\\Aion Classic', 'C:\\Games\\Aion Classic', 'D:\\Games\\Aion Classic'];

/** Импорт официального клиента — в папке программы, один на всех. */
const importDir = () => path.join(userDir(), 'official-classic');

/** Свой импорт важнее клиента на диске: с ним программа не зависит от лаунчера 4Game. */
ipcMain.handle('classic:guess', () => {
  if (donorlib.importInfo(importDir())) return importDir();
  return DEFAULT_DONORS.find((p) => fs.existsSync(p) && new donorlib.Donor(p).check().ok) || '';
});

/** Что лежит по папке донора: импорт (с паспортом) или клиент. */
ipcMain.handle('classic:info', (_e, root) => {
  const info = root ? donorlib.importInfo(root) : null;
  if (!info) return { imported: false, importDir: importDir() };
  return Object.assign({ imported: true, importDir: importDir(), stale: donorimport.stale(info) }, info);
});

/** Одновременно — один импорт: второй перезаписал бы ту же папку. */
let importing = null;
ipcMain.handle('classic:import', (_e, src) => {
  if (importing) throw new Error('импорт уже идёт');
  if (!src) throw new Error('не выбрана папка официального клиента');
  if (path.resolve(src).toLowerCase() === path.resolve(importDir()).toLowerCase()) {
    throw new Error('это и есть импорт — нужна папка самого клиента');
  }
  if (building) throw new Error('дождись конца сборки');
  // прочитанные планы и открытые паки старого импорта больше не годятся
  donorCache = null;
  mapslib.clearCache();
  stopBuildWorker(); // у потока сборки те же кэши — поднимется заново
  importing = new Promise((resolve, reject) => {
    const w = new Worker(path.join(__dirname, 'core', 'importworker.js'), {
      workerData: {
        src,
        dest: importDir(),
        clientRoot: client ? client.root : '',
        backupDir: backupDir(),
      },
    });
    w.on('message', (m) => {
      if (m.progress && win) win.webContents.send('classic:import-progress', m.progress);
      if (m.done) resolve(m.done);
      if (m.error) reject(new Error(m.error));
    });
    w.on('error', reject);
    w.on('exit', (code) => { if (code) reject(new Error('импорт прервался, код ' + code)); });
  }).finally(() => { importing = null; });
  return importing.then((info) => Object.assign({ root: importDir() }, info));
});

ipcMain.handle('classic:pick', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Папка официального Aion Classic (та, где bin64 и data)',
    properties: ['openDirectory'],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  const root = r.filePaths[0];
  if (client && path.resolve(root).toLowerCase() === path.resolve(client.root).toLowerCase()) {
    throw new Error('это папка твоего же клиента — нужен другой, официальный');
  }
  return Object.assign({ root }, getDonor(root).check());
});

ipcMain.handle('classic:plan', (_e, root, rules) => {
  if (!client) throw new Error('клиент не выбран');
  const d = getDonor(root);
  const chk = d.check();
  if (!chk.ok) return { ok: false, missing: chk.missing };
  const key = client.root + '|' + activeLang();
  if (!donorCache.plans.has(key)) donorCache.plans.set(key, donorlib.plan(client, d, activeLang()));
  const p = donorCache.plans.get(key);

  // Что достанется каждой детали при текущих галочках источников. Группы
  // показываем все, где хоть что-то есть, а считаем по выбранному — у одной
  // детали бывает два варианта, считать её дважды нельзя.
  const best = donorlib.pick(p, { rules });
  const cats = new Map();
  for (const c of p.changes) {
    const k = c.lib + '|' + c.cat;
    if (!cats.has(k)) cats.set(k, { key: k, lib: c.lib, cat: c.cat, count: 0, v3: false });
  }
  for (const c of best.values()) {
    const g = cats.get(c.lib + '|' + c.cat);
    g.count++;
    if (c.src !== 'same') g.v3 = true;
  }
  // атласы — только нужные выбранному
  const ships = new Map();
  for (const c of best.values()) if (c.ship) ships.set(c.ship, p.atlases.get(c.ship));
  let atlasBytes = 0;
  // свой атлас (значки меню) у донора не лежит — размер берём у готового DDS
  for (const [s, l] of ships) atlasBytes += l ? l.size : (p.generated && p.generated.get(s) || []).length;

  const picked = [];
  const seen = new Set();
  for (const n of CLASSIC_SAMPLES) {
    const c = [...best.values()].find((x) => x.name === n);
    if (c) { picked.push(c); seen.add(c.lib + '|' + c.cat); }
  }
  // потом — новый вид по одной детали на группу, потом остальное
  const rank = (s) => ({ v3: 0, v3odd: 1, same: 2 }[s]);
  const rest = [...best.values()].filter((x) => x.after.rect)
    .sort((a, b) => rank(a.src) - rank(b.src));
  for (const c of rest) {
    if (picked.length >= 18) break;
    const k = c.lib + '|' + c.cat + '|' + c.src;
    if (seen.has(k) || seen.has(c.lib + '|' + c.cat)) continue;
    picked.push(c);
    seen.add(k);
    seen.add(c.lib + '|' + c.cat);
  }

  return {
    ok: true,
    languages: d.languages(),
    total: best.size,
    // сколько деталей даёт источник сам по себе — видно и у выключенного
    bySource: Object.fromEntries(donorlib.SOURCES.map((s) =>
      [s.id, p.changes.filter((c) => c.src === s.id).length])),
    sources: donorlib.SOURCES.map((s) => Object.assign({}, s, { on: donorlib.ruleOn(rules, s.id) })),
    atlases: ships.size,
    atlasMb: +(atlasBytes / 1e6).toFixed(1),
    noAtlas: p.noAtlas,
    perLib: p.perLib,
    cats: [...cats.values()].sort((a, b) => a.lib.localeCompare(b.lib) || b.count - a.count),
    samples: picked.map((c) => ({
      name: c.name, to: c.to, lib: c.lib, cat: c.cat, src: c.src, from: c.from, after: c.after,
    })),
  };
});

/**
 * Микшер вида: что каждая группа получит от официального Classic и от
 * Aion 5.x, с образцами «свой / Classic / 5.x» для карточек.
 */
ipcMain.handle('look:plan', (_e, root, rules) => {
  if (!client) throw new Error('клиент не выбран');
  const lang = activeLang();
  const byGroup = new Map(looklib.GROUPS.map((g) => [g.id, { classic: 0, v5: 0, samples: new Map() }]));
  const sample = (g, name, key, spec) => {
    const s = byGroup.get(g).samples;
    if (!s.has(name)) s.set(name, { name, own: null, classic: null, v5: null });
    const x = s.get(name);
    if (!x.own && spec.from && spec.from.rect) x.own = spec.from;
    if (spec.after && spec.after.rect) x[key] = spec.after;
  };

  // Aion 5.x — из своего же клиента
  let v5ok = false;
  const files = client.original('preload');
  if (files.get(v5lib.V4_LIB) && files.get(v5lib.V5_LIB)) {
    const have = new Set();
    for (const row of client.packIndex('uiatlas', lang).values()) have.add(row.short.toLowerCase().replace(/\.dds$/, ''));
    const p = v5lib.plan(files.get(v5lib.V4_LIB), files.get(v5lib.V5_LIB), have, {});
    for (const x of p.pairs) {
      // у одиночного скина plan пишет категорией его имя — для групп это «без категории»
      const g = looklib.groupOf(v5lib.V4_LIB, x.category === x.name ? '' : x.category, x.name);
      byGroup.get(g).v5++;
      sample(g, x.name, 'v5', x);
    }
    v5ok = true;
  }

  // официальный Classic — если есть клиент или импорт
  let classicOk = false;
  if (root) {
    const d = getDonor(root);
    if (d.check().ok) {
      const key = client.root + '|' + lang;
      if (!donorCache.plans.has(key)) donorCache.plans.set(key, donorlib.plan(client, d, lang));
      const best = donorlib.pick(donorCache.plans.get(key), { rules });
      for (const c of best.values()) {
        const g = looklib.groupOf(c.lib, c.cat, c.name);
        byGroup.get(g).classic++;
        sample(g, c.name, 'classic', c);
      }
      classicOk = true;
    }
  }

  return {
    v5ok,
    classicOk,
    groups: looklib.GROUPS.map((g) => {
      const b = byGroup.get(g.id);
      // образцы: узнаваемые детали группы, потом те, что есть у обоих, потом остальные
      const show = looklib.SHOWCASE[g.id] || [];
      const rank = (x) => (show.includes(x.name) ? show.indexOf(x.name) : 100 + (x.classic && x.v5 ? 0 : 1));
      const all = [...b.samples.values()].filter((x) => x.own).sort((a, c) => rank(a) - rank(c));
      return Object.assign({}, g, { classic: b.classic, v5: b.v5, samples: all.slice(0, 4) });
    }),
  };
});

/** Окна HUD официального Classic: что подложится и что в них поменяется. */
ipcMain.handle('classic:hud', (_e, root, hud) => {
  if (!client) throw new Error('клиент не выбран');
  const d = getDonor(root);
  if (!d.check().ok) return null;
  const p = hudport.plan(client, d, activeLang(), hud || {});
  return {
    targetPadDefault: hudport.TARGET_PAD,
    iconsDefault: hudport.ICONS_DEFAULT,
    setDefault: hudport.SET_DEFAULT,
    dialogs: p.dialogs.map((x) => ({
      id: x.id, title: x.title, shared: x.shared, on: x.on, error: x.error || '',
      frame: x.frame, dropped: x.dropped || [], grafted: x.grafted || [],
    })),
    skins: p.skins.length,
    presets: p.presets.length,
    atlases: p.ships.size,
    missing: p.missing,
  };
});

/** Перекрашенные карты: какие зоны меняются, какие нет и почему. */
ipcMain.handle('classic:maps', (_e, root) => {
  if (!client) throw new Error('клиент не выбран');
  const d = getDonor(root);
  if (!d.check().ok) return null;
  const p = mapslib.plan(client, d);
  return { zones: p.zones, tiles: p.tiles.length };
});

/** Кусок атласа ДОНОРА — сторона «станет» в «до и после». */
ipcMain.handle('classic:preview', (_e, { root, texture, rect, pad }) => {
  const img = getDonor(root).atlasImage(texture, activeLang());
  if (!img || !rect) return null;
  return cropForPreview(img, rect, pad);
});

ipcMain.handle('skins:atlases', () => {
  if (!client) return [];
  const seen = new Map();
  for (const row of client.packIndex('uiatlas', activeLang()).values()) {
    const base = row.short.replace(/\.dds$/i, '');
    if (!seen.has(base.toLowerCase())) seen.set(base.toLowerCase(), 'textures/ui/' + base);
  }
  return [...seen.values()].sort();
});

// ---- портрет -------------------------------------------------------------

ipcMain.handle('portrait:presets', () => ({
  presets: portrait.PRESETS,
  stock: portrait.STOCK,
  defaults: portrait.defaults(),
}));
ipcMain.handle('portrait:fromPreset', (_e, id) => portrait.fromPreset(id));

// ---- шрифт ---------------------------------------------------------------

ipcMain.handle('font:pick', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Файл шрифта',
    filters: [{ name: 'Шрифты', extensions: ['ttf', 'otf'] }],
    properties: ['openFile'],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  return r.filePaths[0];
});

// ---- наборы картинок (иконки умений, цифры урона) ------------------------

const nameCache = new Map(); // id набора -> все имена записей

const activeLang = () => readJson(profilePath(), {}).lang || 'rus';

ipcMain.handle('pack:info', () =>
  Object.entries(PACKS).map(([id, p]) => ({
    id,
    title: p.title,
    size: p.size,
    rel: p.sources
      .map((s) => (s.rel ? s.rel.replace('{lang}', activeLang()) : s.dir + '/*.pak'))
      .join(' + '),
    present: client ? client.hasPack(id, activeLang()) : false,
  }))
);

/**
 * Список целиком, без обрезки: окно рисует ячейки сразу, а картинки подтягивает
 * по мере прокрутки — иначе семь тысяч иконок не посмотреть.
 */
ipcMain.handle('pack:list', (_e, { pack, query }) => {
  if (!client) throw new Error('клиент не выбран');
  const key = pack + '|' + activeLang();
  if (!nameCache.has(key)) nameCache.set(key, client.packRows(pack, activeLang()));
  const all = nameCache.get(key);
  const q = (query || '').trim().toLowerCase();
  const rows = q ? all.filter((r) => r.short.toLowerCase().includes(q)) : all;
  return { total: all.length, shown: rows.length, rows };
});

/** Пачкой: по одному вызову на иконку семь тысяч раз — слишком дорого. */
ipcMain.handle('pack:images', (_e, { pack, names }) => {
  if (!client) throw new Error('клиент не выбран');
  const data = client.packRead(pack, activeLang(), names);
  const out = [];
  for (const name of names) {
    const raw = data.get(name);
    if (!raw) continue;
    try {
      const img = dds.toRgba(raw);
      // большие атласы ужимаем: в сетке они всё равно 96 px, а гнать
      // четыре мегабайта на каждую ячейку через IPC незачем
      const step = Math.max(1, Math.ceil(Math.max(img.width, img.height) / 256));
      if (step === 1) {
        out.push({ name, width: img.width, height: img.height, rgba: img.rgba });
      } else {
        const w = Math.floor(img.width / step);
        const h = Math.floor(img.height / step);
        const small = Buffer.alloc(w * h * 4);
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            img.rgba.copy(small, (y * w + x) * 4,
              ((y * step) * img.width + x * step) * 4,
              ((y * step) * img.width + x * step) * 4 + 4);
          }
        }
        out.push({ name, width: w, height: h, rgba: small, full: [img.width, img.height] });
      }
    } catch (e) {
      out.push({ name, error: e.message });
    }
  }
  return out;
});

/** Окно присылает уже разобранный PNG пикселями — здесь только пакуем в DDS. */
ipcMain.handle('pack:stage', (_e, { pack, name, width, height, rgba }) => {
  const pixels = assertImage(width, height, rgba, 'icon');
  if (!/^(skills|items|hitnum|uiatlas)$/.test(String(pack))) throw new Error('invalid pack');
  const outDir = path.join(userDir(), 'staged', pack);
  fs.mkdirSync(outDir, { recursive: true });
  const file = relativePath(outDir, safeFileName(String(name).replace(/[\\/|]/g, '_')), 'staged icon');
  fs.writeFileSync(file, build.iconFromRgba(width, height, pixels));
  return file;
});

/** Выгружает оригинал в PNG, чтобы править его в обычном редакторе. */
ipcMain.handle('pack:export', async (_e, { pack, names }) => {
  if (!client) throw new Error('клиент не выбран');
  const r = await dialog.showOpenDialog(win, {
    title: 'Куда сохранить PNG',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  const dir = r.filePaths[0];
  const data = client.packRead(pack, activeLang(), names);
  const index = client.packIndex(pack, activeLang());
  let n = 0;
  for (const [key, raw] of data) {
    try {
      const img = dds.toRgba(raw);
      const row = index.get(key);
      // в имя файла кладём и пак: одноимённые копии не должны затирать друг друга
      const tag = path.basename(path.dirname(row.rel));
      const base = row.short.replace(/[\\/]/g, '_').replace(/\.dds$/i, '');
      fs.writeFileSync(
        path.join(dir, `${base}__${tag}.png`),
        png.encode(img.width, img.height, img.rgba)
      );
      n++;
    } catch (e) {
      // сжатие, которое мы ещё не умеем разбирать — просто пропускаем
    }
  }
  return { dir, count: n };
});

// ---- окна бафов: сетка значков -------------------------------------------

/** Как сейчас устроены окна бафов (из нетронутого клиента). */
ipcMain.handle('buffs:info', () => {
  if (!client) throw new Error('клиент не выбран');
  const lang = activeLang();
  const names = hudlib.BUFF_WINDOWS.map(([id]) => client.l10nName(id.split('/')[0], id.split('/')[1]));
  const data = client.l10nRead(lang, names);
  return hudlib.BUFF_WINDOWS.map(([id, title], i) => {
    const raw = data.get(names[i]);
    const info = raw ? hudlib.gridInfo(bxml.parse(raw).root) : null;
    return Object.assign({ id, title, found: !!info }, info || {});
  });
});

// ---- иконки умений: семейства рангов --------------------------------------

ipcMain.handle('skillicons:catalogue', () => {
  if (!client) throw new Error('клиент не выбран');
  return skillicons.catalogue(client, activeLang());
});

/**
 * Новая картинка на всё семейство (ранги и серые собираются сами) или на
 * один ранг. Картинка приходит уже в холсте родной иконки.
 */
ipcMain.handle('skillicons:make', (_e, { id, rank, rgba }) => {
  if (!client) throw new Error('клиент не выбран');
  const family = skillicons.catalogue(client, activeLang()).families.find((f) => f.id === id);
  if (!family) throw new Error('нет такой иконки: ' + id);
  const made = skillicons.make(client, activeLang(), { family, rank, rgba: assertRgbaBytes(rgba, 64 * 64 * 4, 'skill icon') });
  const outDir = path.join(userDir(), 'staged', 'skills');
  fs.mkdirSync(outDir, { recursive: true });
  return made.map((m) => {
    const file = path.join(outDir, m.key.replace(/[\\/|]/g, '_'));
    fs.writeFileSync(file, dds.fromRgba(m.width, m.height, m.rgba));
    return { key: m.key, file, width: m.width, height: m.height, rgba: m.rgba };
  });
});

// ---- иконки предметов -------------------------------------------------------

ipcMain.handle('itemicons:catalogue', () => {
  if (!client) throw new Error('клиент не выбран');
  return itemicons.catalogue(client, activeLang());
});

/** Подготовленные картинки — чтобы карточка показала их после перезапуска. */
ipcMain.handle('skillicons:staged', (_e, files) => {
  if (!Array.isArray(files) || files.length > 256) throw new TypeError('invalid staged file list');
  return files.map((file) => {
  try {
    const safe = relativePath(path.join(userDir(), 'staged'), file, 'staged file');
    const img = dds.toRgba(fs.readFileSync(safe));
    return { file, width: img.width, height: img.height, rgba: img.rgba };
  } catch (e) {
    return { file, error: e.message };
  }
  });
});

ipcMain.handle('image:pick', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Картинка для подмены',
    filters: [{ name: 'Картинки', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
    properties: ['openFile'],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  return { path: r.filePaths[0], data: fs.readFileSync(r.filePaths[0]).toString('base64') };
});

// ---- подложка для редактора ---------------------------------------------

ipcMain.handle('shot:list', () => {
  if (!client) return [];
  const dir = client.abs('Screenshot');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => /\.(jpg|jpeg|png)$/i.test(f))
    .slice(-40)
    .reverse();
});

ipcMain.handle('shot:read', (_e, name) => {
  if (!client || typeof name !== 'string' || !/^[^\\/]+\.(?:jpg|jpeg|png)$/i.test(name)) return null;
  const file = relativePath(client.abs('Screenshot'), name, 'screenshot');
  if (!fs.existsSync(file)) return null;
  const ext = path.extname(name).slice(1).toLowerCase();
  return `data:image/${ext === 'jpg' ? 'jpeg' : ext};base64,` +
    fs.readFileSync(file).toString('base64');
});
