'use strict';
/**
 * Заглушка вместо preload: окно открывается в обычном браузере на выдуманных
 * данных. Нужна, чтобы смотреть и править внешний вид, не запуская Electron и
 * не имея под рукой клиента игры.
 *
 * Подключается только когда window.api ещё не создан настоящим preload.
 */

if (!window.api) {
  const progressFns = [];
  const buildFns = []; // шаги сборки
  const DIALOGS = [
    ['hud_s1/radar_dialog.xml', 'radar_dialog', 'Мини-карта', 'HUD', 1043, 736, 237, 224, false],
    ['hud_s1/basic_status_dialog.xml', 'basic_status_dialog', 'Портрет и полосы', 'HUD', 0, 809, 353, 151, false],
    ['hud_s1/quickbar_dialog.xml', 'quickbar_dialog', 'Панель умений', 'HUD', 353, 866, 586, 94, false],
    ['hud_s1/exp_bar_dialog.xml', 'exp_bar_dialog', 'Полоса опыта', 'HUD', 152, 951, 978, 9, false],
    ['hud_s1/start_dialog.xml', 'start_dialog', 'Кнопка меню', 'HUD', 939, 889, 104, 71, false],
    ['hud_s1/subzone_name_dialog.xml', 'subzone_name_dialog', 'Название зоны', 'HUD', 1043, 0, 180, 38, false],
    ['game/buff_status_dialog.xml', 'buff_status_dialog', 'Бафы', 'HUD', 98, 2, 262, 101, false],
    ['game/debuff_status_dialog.xml', 'debuff_status_dialog', 'Дебафы', 'HUD', 872, 2, 262, 102, false],
    ['game/target_dialog.xml', 'target_dialog', 'Цель', 'HUD', 508, 2, 274, 84, false],
    ['game/party_dialog.xml', 'party_dialog', 'Группа', 'HUD', 0, 262, 200, 353, true],
    ['game/chat_dialog.xml', 'chat_dialog', 'Чат', 'HUD', 0, 645, 394, 154, true],
    ['game/quest_indicator_dialog.xml', 'quest_indicator_dialog', 'Список заданий', 'HUD', 1085, 2, 195, 514, true],
    ['game/quickbar_dialog_extra.xml', 'quickbar_dialog_extra', 'Боковая панель умений', 'HUD', 1234, 200, 44, 517, false],
    ['game/inventory_dialog.xml', 'inventory_dialog', 'Инвентарь', 'Окна', 849, 140, 406, 874, true],
    ['game/skill_dialog.xml', 'skill_dialog', 'Умения', 'Окна', 839, 150, 406, 512, true],
    ['game/new_map_dialog.xml', 'new_map_dialog', 'Карта мира', 'Окна', 176, 138, 932, 735, true],
  ].map(([id, dialog, title, group, x, y, w, h, movable]) => ({
    id, dialog, title, group,
    pak: id.split('/')[0],
    entry: id.split('/')[1],
    type: 'dlg_' + dialog,
    frame: { x, y, w, h },
    flags: movable ? ['visible'] : ['not_movable', 'visible'],
    movable,
    visible: true,
    hAlign: 'center',
    vAlign: 'bottom',
    widgets: [
      { name: 'radar_sight', type: 'image', frame: { x: 56, y: 21, w: 177, h: 177 }, visible: true },
      { name: 'radar_wnd', type: 'image', frame: { x: 56, y: 21, w: 177, h: 177 }, visible: true },
      { name: 'btn_zoom', type: 'button', frame: { x: 162, y: 191, w: 30, h: 30 }, visible: true },
      { name: 'item_shop_bg', type: 'image', frame: { x: 61, y: 2, w: 45, h: 47 }, visible: true },
    ],
  }));

  const NAMES = [
    'cbt_ra_spiralarrow_g1', 'cbt_ra_trueshot_g1', 'cbt_ra_entangleshot_g2',
    'cbt_ra_light_spiketrap_g1', 'live_ra_basicshot_g1', 'cbt_ra_heavyshot_g3',
    'cbt_ra_arrowstorm_g2', 'cbt_ra_phoenixarrow_g1', 'live_ra_aimshot_g1',
    'cbt_ra_hawkeye_g1', 'cbt_ra_freeshot_g2', 'cbt_ra_silentarrow_g4',
  ].map((n) => n + '.dds');

  const HITNUM = [].concat(
    ...'0123456789'.split('').map((d) =>
      ['white', 'yellow', 'red', 'orange', 'green', 'blue', 'violet', 'gray'].map((c) => `${d}_${c}.dds`)
    ),
    ...['white', 'yellow', 'red', 'orange', 'green', 'blue', 'violet'].map((c) => [`plus_${c}.dds`, `minus_${c}.dds`]),
    ...['critical', 'block', 'dodge', 'parry', 'resist'].map((p) => [`${p}_r.dds`, `${p}_w.dds`])
  );

  let saved = {
    layout: {},
    font: { enabled: false, file: '', langs: [] },
    packs: { skills: {}, hitnum: {} },
    lang: 'rus',
  };

  const fakeIcon = (name) => {
    const n = 64;
    const rgba = new Uint8Array(n * n * 4);
    let seed = 0;
    for (const c of name) seed = (seed * 31 + c.charCodeAt(0)) & 0xffff;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const i = (y * n + x) * 4;
        const edge = x < 3 || y < 3 || x > n - 4 || y > n - 4;
        const d = Math.hypot(x - 32, y - 32);
        rgba[i] = edge ? 90 : (seed * 7 + d * 4) % 200;
        rgba[i + 1] = edge ? 78 : (seed * 13 + x * 3) % 180;
        rgba[i + 2] = edge ? 52 : (seed * 3 + y * 3) % 220;
        rgba[i + 3] = 255;
      }
    }
    return { width: n, height: n, rgba: Array.from(rgba) };
  };

  // пресеты в памяти: сравнение — по JSON профиля
  const mockPresets = { list: [], active: null, snaps: new Map() };
  const presetState = (profile) => ({
    list: mockPresets.list.slice(),
    active: mockPresets.active,
    changed: mockPresets.active ? JSON.stringify(profile || saved) !== mockPresets.snaps.get(mockPresets.active) : null,
  });

  // карты: две выдуманные зоны, превью — шум с «водой» и «сушей»
  const fakeMap = (size, seed) => {
    const rgba = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const v = Math.sin(x / 37 + seed) + Math.cos(y / 29 - seed) + Math.sin((x + y) / 61);
      const i = (y * size + x) * 4;
      const water = v < -0.4;
      rgba[i] = water ? 40 : 52 + v * 12; rgba[i + 1] = water ? 70 : 66 + v * 14; rgba[i + 2] = water ? 92 : 44; rgba[i + 3] = 255;
    }
    return { width: size, height: size, rgba };
  };
  const ZONES = [
    { zone: 'lc1', name: 'Элизиум', world: true, rel: 'textures/ui/newmap/lc1/lc1.pak',
      layers: [{ key: 'lc1/lc1', prefix: 'lc1', grid: 3, tile: 1024, entries: [...Array(9)].map((_, i) => `lc1_00${i}.dds`) }] },
    { zone: 'dc1', name: 'Пандемониум', world: true, rel: 'textures/ui/newmap/dc1/dc1.pak',
      layers: [{ key: 'dc1/dc1', prefix: 'dc1', grid: 3, tile: 1024, entries: [...Array(9)].map((_, i) => `dc1_00${i}.dds`) }] },
    { zone: 'ab1', name: 'Арэшурат', world: true, rel: 'textures/ui/newmap/ab1/ab1.pak',
      layers: [1, 2, 3].map((n) => ({ key: 'ab1/ab1_' + n, prefix: 'ab1_' + n, grid: 3, tile: 1024, entries: [...Array(9)].map((_, i) => `ab1_${n}_00${i}.dds`) })) },
    { zone: 'idcromede', name: 'Кошмар', world: false, rel: 'textures/ui/newmap/idcromede/idcromede.pak',
      layers: [{ key: 'idcromede/idcromede', prefix: 'idcromede', grid: 3, tile: 1024, entries: [...Array(9)].map((_, i) => `idcromede_00${i}.dds`) }] },
  ];

  // иконки предметов: несколько выдуманных
  const IT_NAMES = [['Меч стража', 'weapon', 'rare', 12], ['Кольцо ярости', 'jewel', 'legend', 3], ['Крылья феникса', 'wing', 'epic', 6],
    ['Шлем легионера', 'armor', 'unique', 8], ['Зелье исцеления', 'other', 'common', 14], ['Посох бури', 'weapon', 'legend', 4],
    ['Сок лишери', 'other', 'rare', 2], ['Наплечники дракона', 'armor', 'epic', 5], ['', '', '', 0]];
  const IT_ICONS = [];
  for (let i = 0; i < 60; i++) {
    const [t, g, q, n] = IT_NAMES[i % IT_NAMES.length];
    IT_ICONS.push({ id: `icon_item_demo_${i}`, key: `data/items/items.pak|icon_item_demo_${i}.dds`, title: t ? t + (i > 8 ? ' ' + i : '') : '',
      titles: t ? [t, t + ' (улучш.)'] : [], count: n, group: g, quality: q });
  }

  window.api = {
    itemicons: {
      catalogue: async () => ({
        icons: IT_ICONS, items: 62187, named: 107767,
        groups: [['weapon', 'оружие и щиты'], ['armor', 'броня'], ['jewel', 'бижутерия'], ['wing', 'крылья'], ['other', 'прочее']],
        qualities: [['common', 'обычное'], ['rare', 'редкое'], ['legend', 'легендарное'], ['unique', 'уникальное'], ['epic', 'эпическое']],
      }),
    },
    maps: {
      zones: async () => ZONES,
      preview: async (key, size) => fakeMap(Math.min(size, 512), key.length),
      previewOwn: async () => null,
      stageTile: async ({ key, entry }) => 'C:\\fake\\staged\\maps\\' + key + '\\' + entry,
    },
    preset: {
      state: async (profile) => presetState(profile),
      save: async ({ profile, id, name, description }) => {
        const now = new Date().toISOString();
        let rec = id && mockPresets.list.find((p) => p.id === id);
        if (!rec) { rec = { id: 'p' + Date.now().toString(36), created: now }; mockPresets.list.push(rec); }
        Object.assign(rec, { name: name || rec.name, description: description != null ? description : rec.description || '', updated: now });
        mockPresets.snaps.set(rec.id, JSON.stringify(profile));
        mockPresets.active = rec.id;
        return presetState(profile);
      },
      rename: async ({ id, name, description }) => {
        Object.assign(mockPresets.list.find((p) => p.id === id), { name, description });
        return presetState();
      },
      apply: async (id) => {
        mockPresets.active = id;
        saved = JSON.parse(mockPresets.snaps.get(id));
        return { profile: saved, state: presetState(saved) };
      },
      remove: async (id) => {
        mockPresets.list = mockPresets.list.filter((p) => p.id !== id);
        if (mockPresets.active === id) mockPresets.active = null;
        return presetState();
      },
      export: async () => 'C:\\Users\\me\\Desktop\\preset.aionpreset',
      import: async () => null,
    },
    window: { minimize() {}, toggle() {}, close() {}, onState() {} },
    client: {
      init: async () => ({
        root: 'G:\\Aion Empire\\classic', ok: true, missing: [], languages: ['rus', 'eng'],
      }),
      pick: async () => ({
        root: 'G:\\Aion Empire\\classic', ok: true, missing: [], languages: ['rus', 'eng'],
      }),
      reveal() {},
    },
    // редактору нужны настоящие окна и атласы клиента — в браузере его нет
    editor: {
      open: async () => { throw new Error('редактор интерфейса работает только в программе'); },
      window: async () => null,
      atlas: async () => null,
      font: async () => null,
      candidates: async () => [],
      stageImage: async () => '',
      readImage: async () => null,
    },
    catalogue: {
      load: async () => DIALOGS,
      xml: async (id) => `<Dialog name="${id.split('/')[1]}" frame="…" flag="not_movable;visible">\n  <Widget … />\n</Dialog>`,
    },
    profile: {
      get: async () => saved,
      save: async (p) => { saved = p; return true; },
      export: async () => 'C:\\demo\\profile.json',
      import: async () => null,
    },
    build: {
      // как настоящая: несколько секунд, шаги журнала событиями
      apply: async () => {
        const steps = ['hud_s1: переписано диалогов — 2', 'иконки умений: готово к записи 12 из 12',
          'карты: заменено тайлов 0 — нечего', 'картинки: подменено 14 в паках — data/skills/skills.pak'];
        for (const s of steps) { await new Promise((r) => setTimeout(r, 700)); buildFns.forEach((f) => f(s)); }
        return { report: { paks: ['hud_s1'], files: 3, dialogs: 2 }, log: steps };
      },
      onProgress: (fn) => buildFns.push(fn),
      restore: async () => ['data/ui/game_hud_s1/game_hud_s1.pak'],
      status: async () => [
        { key: 'hud_s1', rel: 'data/ui/game_hud_s1/game_hud_s1.pak', patched: true },
        { key: 'game', rel: 'data/ui/game/game.pak', patched: false },
      ],
    },
    skins: {
      atlases: async () => ['textures/ui/v4_common', 'textures/ui/v4_popup1', 'textures/ui/v5_common'],
      list: async () => ({
        total: 1068, found: 3, shown: 3, libs: ['version4.xml', 'version5.xml'],
        rows: [
          { key: 'version4.xml|dialog|v4_button_up', name: 'v4_button_up', category: 'dialog',
            lib: 'version4.xml', texture: 'textures/ui/v4_common', atlas: 'v4_common',
            nine: true, rect: { x: 0, y: 261, w: 52, h: 26 }, fields: ['src_middle_middle'] },
          { key: 'version4.xml|hud|v4_hud_radar_wnd', name: 'v4_hud_radar_wnd', category: 'hud',
            lib: 'version4.xml', texture: 'textures/ui/v4_common', atlas: 'v4_common',
            nine: false, rect: { x: 665, y: 346, w: 177, h: 177 }, fields: ['src_image'] },
          { key: 'version5.xml|hud|v7_hud_honor_up', name: 'v7_hud_honor_up', category: 'hud',
            lib: 'version5.xml', texture: 'Textures/UI/v5_hud_s1', atlas: 'v5_hud_s1',
            nine: false, rect: { x: 765, y: 4, w: 32, h: 32 }, fields: ['src_image'] },
        ],
      }),
      preview: async (_t, rect) => Object.assign(fakeIcon('skin'), { from: 'textures/ui/ui.pak' }),
    },
    classic: {
      guess: async () => 'E:\\Aion Classic',
      pick: async () => ({ root: 'E:\\Aion Classic', ok: true, missing: [] }),
      info: async (root) => (/official-classic$/.test(root)
        ? {
          imported: true, source: 'E:\\Aion Classic', importedAt: new Date().toISOString(),
          bytes: 137148685, maps: { tiles: 11, zones: ['tiamat_down', 'lf4'] }, stale: false,
        }
        : { imported: false }),
      import: async (src) => {
        for (const m of ['библиотеки скинов', 'атласы', 'карты: тайлов 11']) {
          progressFns.forEach((fn) => fn(m));
          await new Promise((r) => setTimeout(r, 400));
        }
        return { root: 'C:\\demo\\official-classic', source: src, bytes: 137148685 };
      },
      onImportProgress: (fn) => progressFns.push(fn),
      plan: async () => ({
        ok: true,
        languages: ['RUS'],
        total: 420,
        bySource: { v3: 155, same: 278, v3odd: 55 },
        sources: [
          { id: 'v3', title: 'новый вид Classic', hint: 'v4_quickbar_slot_bg → v3_quickbar_slot_bg', safe: true, on: true },
          { id: 'same', title: 'перерисованное у официального', hint: 'та же деталь, другая картинка', safe: true, on: true },
          { id: 'v3odd', title: 'новый вид — детали другой формы', hint: 'растянутся или обрежутся', safe: false, on: false },
        ],
        atlases: 29,
        atlasMb: 106.6,
        noAtlas: ['textures/ui/v3_map_mask'],
        perLib: [
          { lib: 'version4.xml', total: 1068, moved: 301, same: 751, only: 16, v3: 210, redrawn: 104 },
          { lib: 'Shop.xml', total: 108, moved: 26, same: 71, only: 11, v3: 0, redrawn: 26 },
          { lib: 'hud_s2.xml', total: 15, moved: 0, same: 3, only: 12, v3: 0, redrawn: 0 },
          { lib: 'login.xml', total: 81, moved: 0, same: 81, only: 0, v3: 0, redrawn: 0 },
        ],
        cats: [
          { key: 'Shop.xml|', lib: 'Shop.xml', cat: '', v3: false, count: 26 },
          { key: 'version4.xml|', lib: 'version4.xml', cat: '', v3: true, count: 88 },
          { key: 'version4.xml|hud', lib: 'version4.xml', cat: 'hud', v3: true, count: 21 },
          { key: 'version4.xml|number', lib: 'version4.xml', cat: 'number', v3: false, count: 27 },
          { key: 'version4.xml|skill', lib: 'version4.xml', cat: 'skill', v3: false, count: 0 },
        ],
        samples: [
          { name: 'v4_quickbar_slot_bg', to: 'v3_quickbar_slot_bg', lib: 'version4.xml', cat: 'hud', src: 'v3',
            from: { texture: 'textures/ui/v4_common', rect: '0,261,52,26' },
            after: { texture: 'textures/ui/v3_common_01', rect: '0,261,52,26' } },
          { name: 'v4_item_num_1', to: 'v4_item_num_1', lib: 'version4.xml', cat: 'number', src: 'same',
            from: { texture: 'textures/ui/v4_common', rect: '0,0,40,40' },
            after: { texture: 'textures/ui/v4_common', rect: '0,0,40,40' } },
        ],
      }),
      preview: async () => fakeIcon('classic'),
      maps: async () => ({
        tiles: 11,
        zones: [
          { zone: 'tiamat_down', sub: 'большая карта', take: 9, same: 0, other: 0, replace: true },
          { zone: 'lf4', sub: 'большая карта', take: 2, same: 7, other: 0, replace: true },
          { zone: 'lc1', sub: 'мини-карта', take: 4, same: 0, other: 580, replace: false },
        ],
      }),
      hud: async () => ({
        dialogs: [
          { id: 'hud_s2/quickbar_dialog.xml', title: 'Панель умений', shared: false, on: true, error: '',
            frame: [{ w: 967, h: 93 }, { w: 541, h: 140 }], dropped: [], grafted: [] },
          { id: 'hud_s2/basic_status_dialog.xml', title: 'Портрет и полосы HP/MP', shared: false, on: true, error: '',
            frame: [{ w: 344, h: 78 }, { w: 384, h: 102 }], dropped: ['portrait', 'sp_gauge', 'ep_gauge'],
            grafted: ['emblem → место portrait'] },
          { id: 'hud_s2/radar_dialog.xml', title: 'Мини-карта (рамка)', shared: false, on: true, error: '',
            frame: [{ w: 233, h: 198 }, { w: 326, h: 331 }], dropped: [],
            grafted: ['окно твоё, от официального — radar_bg'] },
          { id: 'hud_s2/start_dialog.xml', title: 'Меню (правый нижний угол)', shared: false, on: true, error: '',
            frame: [{ w: 313, h: 93 }, { w: 400, h: 60 }], dropped: [],
            grafted: ['окно твоё, значки официальные, без старой рамки'] },
          { id: 'game/party_dialog.xml', title: 'Группа', shared: true, on: true, error: '',
            frame: [{ w: 200, h: 353 }, { w: 226, h: 406 }], dropped: ['sp', 'ep', 'death'],
            grafted: ['fly_gauge → место fly_gauge01'] },
        ],
        skins: 79, presets: 28, atlases: 4, missing: [], targetPadDefault: 440,
      }),
    },
    portrait: {
      presets: async () => ({
        presets: [
          { id: 1, title: '01 — штатный' },
          { id: 6, title: '06 — очень крупный' },
        ],
        stock: { x: 0, y: 15, size: 128, maleDist: 1.38, maleHeight: 0.71, femaleDist: 1.3, femaleHeight: 0.55 },
        defaults: { enabled: false, preset: 1, x: 0, y: 15, size: 128, maleDist: 1.38, maleHeight: 0.71, femaleDist: 1.3, femaleHeight: 0.55 },
      }),
      fromPreset: async (id) =>
        id === 6
          ? { preset: 6, x: -75, y: -105, size: 280, maleDist: 3.6, maleHeight: 0.4, femaleDist: 3.38, femaleHeight: 0.31 }
          : { preset: 1, x: 0, y: 15, size: 128, maleDist: 1.38, maleHeight: 0.71, femaleDist: 1.3, femaleHeight: 0.55 },
    },
    reset: {
      plan: async () => ({
        restore: [{ rel: 'data/ui/game/game.pak', size: 242594 }],
        extra: [
          { rel: 'l10n/rus/data/Fonts/fonts.pak', size: 69446, why: 'подменённый шрифт' },
          { rel: 'textures/ui/zz_aion2.pak', size: 4129000, why: 'сторонний пак поверх интерфейса' },
        ],
        inQuarantine: 0,
      }),
      run: async () => ({ restored: ['data/ui/game/game.pak'], removed: ['textures/ui/zz_aion2.pak'] }),
      undo: async () => [],
    },
    font: { pick: async () => 'C:\\demo\\AccidentalPresidency-Ru.ttf' },
    packs: {
      info: async () => [
        { id: 'skills', title: 'Иконки умений', rel: 'data/skills/skills.pak', size: 64, present: true },
        { id: 'hitnum', title: 'Цифры урона', rel: 'textures/ui/hit_number/hit_number.pak', size: 0, present: true },
        { id: 'uiatlas', title: 'Картинки интерфейса', rel: 'textures/ui/ui.pak', size: 0, present: true },
      ],
      list: async (pack, q) => {
        const src = pack === 'skills' ? 'data/skills/skills.pak'
          : pack === 'hitnum' ? 'textures/ui/hit_number/hit_number.pak'
            : 'textures/ui/ui.pak';
        const all = (pack === 'skills' ? NAMES : HITNUM)
          .map((n) => ({ key: src + '|' + n, short: n, pak: src, twin: false }));
        const rows = all.filter((r) => !q || r.short.includes(q));
        return { total: all.length, shown: rows.length, rows };
      },
      images: async (pack, names) => names.map((n) => Object.assign({ name: n }, fakeIcon(n))),
      stage: async ({ name }) => 'C:\\demo\\staged\\' + name,
      export: async () => ({ dir: 'C:\\demo\\png', count: 12 }),
      pickFile: async () => null,
    },
    shots: { list: async () => [], read: async () => null },
    look: {
      plan: async (root) => {
        const s = (n) => ({ name: n, own: { texture: 't/own', rect: '0,0,40,20' },
          classic: { texture: 't/cl', rect: '0,0,40,20' }, v5: { texture: 't/v5', rect: '0,0,40,20' } });
        const g = (id, title, classic, v5, hint, kind) => ({ id, title, hint, kind, classic, v5,
          samples: kind ? [] : [s(id + '_a'), s(id + '_b'), s(id + '_c')] });
        return {
          v5ok: true,
          classicOk: !!root,
          groups: [
            g('frames', 'Рамки окон', 29, 87, 'окна, всплывающие меню, подсказки'),
            g('buttons', 'Кнопки', 52, 81, 'кнопки, закрыть, плюс/минус, стрелки'),
            g('tabs', 'Вкладки и заголовки', 7, 8),
            g('scroll', 'Прокрутка и ползунки', 12, 39),
            g('slots', 'Ячейки', 11, 30),
            g('gauges', 'Полосы', 3, 58, 'HP/MP, опыт, шкалы'),
            g('hud', 'Элементы HUD', 19, 189),
            g('worldmap', 'Карта мира (элементы окна)', 48, 0),
            g('pets', 'Питомцы', 0, 15),
            g('hudwin', 'Окна HUD', 0, 0, 'панель умений, полосы, цель — окна официального', 'switch'),
            g('winfix', 'Списки и вкладки в окнах', 0, 0, 'зазор строк и вкладки во всю ширину', 'switch'),
            g('maptiles', 'Перекрашенные карты', 0, 0, 'зоны с той же местностью', 'switch'),
          ],
        };
      },
    },
    buffs: {
      info: async () => [
        { id: 'game/buff_status_dialog.xml', title: 'Бафы', found: true, count: 24, size: 32, perRow: 8, auto: false },
        { id: 'game/debuff_status_dialog.xml', title: 'Дебафы', found: true, count: 24, size: 32, perRow: 8, auto: false },
        { id: 'game/target_buff_status_dialog.xml', title: 'Эффекты на цели', found: true, count: 40, size: 22, perRow: 0, auto: true },
        { id: 'game/pet_buff_status_dialog.xml', title: 'Эффекты на питомце', found: true, count: 40, size: 22, perRow: 0, auto: true },
      ],
    },
    skillicons: {
      catalogue: async () => ({
        classes: [['FIGHTER', 'Гладиатор'], ['KNIGHT', 'Страж'], ['RANGER', 'Стрелок'], ['ASSASSIN', 'Убийца'],
          ['WIZARD', 'Волшебник'], ['ELEMENTALLIST', 'Заклинатель'], ['PRIEST', 'Целитель'], ['CHANTER', 'Чародей']],
        skills: 4408, named: 19855,
        families: SK_FAMS,
      }),
      make: async (id, rgba, rank) => {
        const f = SK_FAMS.find((x) => x.id === id);
        return f.ranks.filter((r) => rank == null || r.rank === rank).flatMap((r) => [
          { key: r.key, file: 'C:\\demo\\staged\\' + r.key, width: 64, height: 64, rgba: Uint8Array.from(rgba) },
          { key: r.grayKey, file: 'C:\\demo\\staged\\' + r.grayKey, width: 64, height: 64, rgba: grayOf(rgba) },
        ]);
      },
      staged: async (files) => files.map((file) => Object.assign({ file }, skIcon(file))),
    },
  };
  // иконка умения: картинка 40×40 в углу холста 64×64, как у родных
  function skIcon(name) {
    const src = Uint8Array.from(fakeIcon(name).rgba);
    const rgba = new Uint8Array(64 * 64 * 4);
    for (let y = 0; y < 40; y++) rgba.set(src.subarray(y * 64 * 4, y * 64 * 4 + 40 * 4), y * 64 * 4);
    return { width: 64, height: 64, rgba };
  }
  function grayOf(rgba) {
    const out = Uint8Array.from(rgba);
    for (let i = 0; i < out.length; i += 4) {
      const v = (Math.max(out[i], out[i + 1], out[i + 2]) + Math.min(out[i], out[i + 1], out[i + 2])) >> 1;
      out[i] = out[i + 1] = out[i + 2] = v;
    }
    return out;
  }
  const P = 'data/skills/skills.pak|';
  const fam = (id, title, n, classes, extra) => Object.assign({
    id, title, titles: [title].filter(Boolean), classes, starter: false, all: false, level: 10,
    act: ['active'], sub: ['attack'], type: ['physical'], skills: n, used: classes.length > 0, prefix: 'cbt',
    ranks: Array.from({ length: n }, (_, i) => ({
      rank: i + 1, key: `${P}${id}_g${i + 1}.dds`, grayKey: `${P}${id}_g${i + 1}_gray.dds` })),
  }, extra);
  const SK_FAMS = [
    fam('cbt_ra_arrowstrike', 'Меткая стрела', 5, ['RANGER'], { level: 16 }),
    fam('cbt_ra_breathofnature', 'Дыхание природы', 4, ['RANGER'], { sub: ['heal'], type: ['magical'] }),
    fam('cbt_sc_swiftedge', 'Стремительный удар', 6, ['RANGER', 'ASSASSIN'], { level: 1 }),
    fam('cbt_p_equip_leather', 'Кожаные доспехи: практика', 1, ['RANGER', 'ASSASSIN', 'CHANTER'],
      { act: ['passive'], sub: ['other'] }),
    fam('cbt_wi_flamebolt', 'Огненная стрела', 6, ['WIZARD']),
    fam('cbt_kn_massiveprovoke', 'Массовая провокация', 3, ['KNIGHT'], { sub: ['debuff'] }),
    fam('live_all_gathering', '', 1, [], { used: false, act: [], sub: [], prefix: 'live' }),
  ];
  const origImages = window.api.packs.images;
  // цифры урона — родного размера: цифры 32×32, надписи 248×76
  const hitImage = (n) => {
    const plate = /_(r|w)\.dds$/i.test(n);
    const w = plate ? 248 : 32;
    const h = plate ? 76 : 32;
    const rgba = new Uint8Array(w * h * 4);
    const col = { white: [240, 236, 200], yellow: [240, 220, 20], orange: [230, 120, 40], red: [230, 30, 30],
      violet: [220, 60, 230], blue: [40, 130, 230], green: [60, 210, 80], gray: [150, 150, 150] }[(n.match(/_([a-z]+)\.dds$/) || [])[1]] || [220, 40, 40];
    for (let y = 4; y < h - 4; y++) {
      for (let x = Math.floor(w * 0.3); x < w - 4; x++) {
        const i = (y * w + x) * 4;
        rgba.set([...col, (x + y) % 3 ? 255 : 0], i);
      }
    }
    return { width: w, height: h, rgba };
  };
  window.api.packs.images = async (pack, names) => (pack === 'skills'
    ? names.map((n) => Object.assign({ name: n }, skIcon(n)))
    : pack === 'hitnum' ? names.map((n) => Object.assign({ name: n }, hitImage(n)))
      : origImages(pack, names));
  // выбор картинки в браузере: рисуем градиент — чтобы пройти замену целиком
  window.api.packs.pickFile = async () => {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 128;
    const g = cv.getContext('2d');
    const gr = g.createLinearGradient(0, 0, 128, 128);
    gr.addColorStop(0, '#2bd4c0');
    gr.addColorStop(1, '#6b2bd4');
    g.fillStyle = gr;
    g.fillRect(0, 0, 128, 128);
    return { path: 'C:\\demo\\new.png', data: cv.toDataURL('image/png').split(',')[1] };
  };
}
