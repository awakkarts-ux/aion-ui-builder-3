'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const call = (channel, ...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('api', {
  update: {
    info: () => call('update:info'),
    check: () => call('update:check'),
    download: () => call('update:download'),
    install: () => call('update:install'),
    onStatus: (fn) => ipcRenderer.on('update:status', (_e, status) => fn(status)),
  },
  window: {
    minimize: () => call('window:minimize'),
    toggle: () => call('window:toggle'),
    close: () => call('window:close'),
    onState: (fn) => ipcRenderer.on('window:state', (_e, max) => fn(max)),
  },
  client: {
    init: () => call('client:init'),
    pick: () => call('client:pick'),
    reveal: (rel) => call('client:reveal', rel),
  },
  catalogue: {
    load: () => call('catalogue:load'),
    xml: (id) => call('catalogue:xml', id),
  },
  profile: {
    get: () => call('profile:get'),
    sync: () => call('profile:sync'),
    save: (p) => call('profile:save', p),
    export: (p) => call('profile:export', p),
    import: () => call('profile:import'),
  },
  build: {
    apply: (p) => call('build:apply', p),
    onProgress: (fn) => ipcRenderer.on('build:progress', (_e, msg) => fn(msg)),
    restore: () => call('build:restore'),
    status: () => call('build:status'),
  },
  reset: {
    plan: () => call('reset:plan'),
    run: () => call('reset:run'),
    undo: () => call('reset:undo'),
  },
  v5: {
    plan: (rules) => call('v5:plan', rules),
  },
  classic: {
    guess: () => call('classic:guess'),
    pick: () => call('classic:pick'),
    info: (root) => call('classic:info', root),
    import: (src) => call('classic:import', src),
    onImportProgress: (fn) => ipcRenderer.on('classic:import-progress', (_e, msg) => fn(msg)),
    plan: (root, rules) => call('classic:plan', root, rules),
    hud: (root, hud) => call('classic:hud', root, hud),
    maps: (root) => call('classic:maps', root),
    preview: (root, texture, rect, pad) => call('classic:preview', { root, texture, rect, pad }),
  },
  buffs: {
    info: () => call('buffs:info'),
  },
  look: {
    plan: (root, rules) => call('look:plan', root, rules),
  },
  itemicons: {
    catalogue: () => call('itemicons:catalogue'),
  },
  skillicons: {
    catalogue: () => call('skillicons:catalogue'),
    make: (id, rgba, rank) => call('skillicons:make', { id, rgba, rank }),
    staged: (files) => call('skillicons:staged', files),
  },
  skins: {
    list: (query, lib) => call('skins:list', { query, lib }),
    preview: (texture, rect, pad) => call('skins:preview', { texture, rect, pad }),
    atlases: () => call('skins:atlases'),
  },
  portrait: {
    presets: () => call('portrait:presets'),
    fromPreset: (id) => call('portrait:fromPreset', id),
  },
  font: {
    pick: () => call('font:pick'),
  },
  maps: {
    zones: () => call('maps:zones'),
    preview: (key, size) => call('maps:preview', { key, size }),
    previewOwn: (key, size) => call('maps:previewOwn', { key, size }),
    stageTile: (payload) => call('maps:stageTile', payload),
  },
  preset: {
    state: (profile) => call('preset:state', profile),
    save: (payload) => call('preset:save', payload),
    rename: (payload) => call('preset:rename', payload),
    apply: (id, profile) => call('preset:apply', { id, profile }),
    remove: (id) => call('preset:remove', id),
    export: (id) => call('preset:export', id),
    import: () => call('preset:import'),
  },
  editor: {
    open: (profile) => call('editor:open', profile),
    window: (id, variant, tabs) => call('editor:window', { id, variant, tabs }),
    atlas: (texture) => call('editor:atlas', texture),
    font: (face) => call('editor:font', face),
    candidates: (id, limit) => call('editor:candidates', { id, limit }),
    stageImage: (payload) => call('editor:stageImage', payload),
    readImage: (file) => call('editor:readImage', file),
  },
  packs: {
    info: () => call('pack:info'),
    list: (pack, query) => call('pack:list', { pack, query }),
    images: (pack, names) => call('pack:images', { pack, names }),
    stage: (payload) => call('pack:stage', payload),
    export: (pack, names) => call('pack:export', { pack, names }),
    pickFile: () => call('image:pick'),
  },
  shots: {
    list: () => call('shot:list'),
    read: (name) => call('shot:read', name),
  },
});
