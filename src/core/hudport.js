'use strict';
/**
 * Окна HUD официального Classic.
 *
 * Новый HUD у официального клиента — не перекраска: в наборе s2 у него другие
 * раскладки окон (панель умений 541×140, полоса опыта во всю ширину, новые
 * полосы HP/MP), и зовут они скины с новыми именами (`v3_hud_char` вместо
 * нашего `v4_hud_char_s2`). Поэтому переносится само окно, а нужные ему скины
 * и пресеты дописываются в нашу библиотеку.
 *
 * Окно подкладывается не как есть. Код игры находит виджеты по имени, и у
 * нашего клиента он старее официального:
 *
 *   — виджет, который наш код знает (имя есть в нашем окне), остаётся — у него
 *     меняется только вид и место;
 *   — оформление без поведения (фон, рамка, линия) остаётся;
 *   — всё остальное выкидывается. У официального в карточке группы поверх
 *     полосы MP лежат полосы sp/ep/death, которые его код прячет и
 *     показывает. Наш код их не знает — они висели бы мёртвыми полными
 *     полосами поверх нужных;
 *   — наши виджеты, которых у официального нет, досаживаются обратно: иначе
 *     наш код их не найдёт (герб в окне HP/MP, полёт у участников группы).
 *     Если есть очевидное место — на место его аналога.
 *
 * Радар и меню не переносятся: у официального из них вынесены значки почты,
 * магазина, боевого пропуска и полоска полёта — в окна, которых наш клиент
 * не знает.
 */

const fs = require('fs');
const bxml = require('./bxml');
const pak = require('./pak');
const donorlib = require('./donor');

/** Что можно переносить. key/entry — как в PAKS нашего клиента. */
const DIALOGS = [
  { key: 'hud_s2', entry: 'quickbar_dialog.xml', title: 'Панель умений', shared: false },
  { key: 'hud_s2', entry: 'exp_bar_dialog.xml', title: 'Полоса опыта', shared: false },
  { key: 'hud_s2', entry: 'basic_status_dialog.xml', title: 'Портрет и полосы HP/MP', shared: false },
  { key: 'hud_s2', entry: 'pet_dialog.xml', title: 'Питомец', shared: false },
  { key: 'hud_s2', entry: 'pet_command_dialog.xml', title: 'Команды питомца', shared: false },
  { key: 'hud_s2', entry: 'radar_dialog.xml', title: 'Мини-карта (рамка)', shared: false },
  { key: 'hud_s2', entry: 'start_dialog.xml', title: 'Меню (правый нижний угол)', shared: false },
  // Место цели в s2 не зависит от окна: игра пристёгивает её к полосам HP/MP
  // (они в s2 вверху слева). С нашим и с официальным окном — одно и то же.
  { key: 'game', entry: 'target_dialog.xml', title: 'Цель', shared: true },
  // «цель цели» — окно target_assist; без него оставалось старым рядом с новой целью
  { key: 'game', entry: 'target_assist_dialog.xml', title: 'Цель цели', shared: true },
  { key: 'game', entry: 'party_dialog.xml', title: 'Группа', shared: true },
  // Ряды над панелью умений и боковая панель — отдельные окна. Без них ряды
  // оставались нашими (ячейка 44, шаг 43 — ряд 517 против 502 у основного)
  // и налезали на стрелки листания.
  { key: 'game', entry: 'quickbar_dialog_ctrl.xml', title: 'Панель умений: ряд 2', shared: true },
  { key: 'game', entry: 'quickbar_dialog_alt.xml', title: 'Панель умений: ряд 3', shared: true },
  { key: 'game', entry: 'quickbar_dialog_extra.xml', title: 'Боковая панель умений (III)', shared: true },
  // Отдельные панели I, II… (перетаскиваемые, 12/6×2/2×6/1×12)
  { key: 'game', entry: 'quickbar_dialog_sep.xml', title: 'Отдельные панели умений (I, II…)', shared: true },
];

/*
 * КАК ИГРА РАССТАВЛЯЕТ ОКНА HUD (набор s2) — снято с экрана, XML тут почти
 * ни при чём:
 *   — координаты x/y окон HUD код не слушает; ширину и высоту — слушает;
 *   — панель умений и меню код ставит внизу одной группой, по центру экрана;
 *   — полоса опыта начинается с (середина экрана − половина ширины панели);
 *   — цель пристёгнута к правому краю окна HP/MP;
 *   — мини-карта — в правом верхнем углу.
 * Поэтому окна двигаются только своими размерами. Панель умений делается
 * шириной в экран (ряд ячеек внутри — по центру), меню — наполовину за
 * правым краем (кнопки в видимой половине), полоса опыта — тоже в экран.
 * Числа зависят от экрана: размер берётся из system.cfg, масштабы сняты со
 * скриншота 1920×1009 (интерфейс 0,95): вверху ~0,96, внизу ~1,0.
 */
// Сверено по скриншоту после сборки: карта 242 единицы — ~250 px, значки
// встали там, где ждали при масштабе 1,0; с 0,96 они ушли под полосу опыта.
const SCALE_TOP = 1.0;
const SCALE_BOTTOM = 1.0;
/** Во сколько раз полоса опыта шире экрана — запас на масштаб. */
const EXP_OVERSHOOT = 1.05;
/** Сколько снизу занимает полоса опыта с зазором: значки и меню — выше. */
const BOTTOM_RESERVE = 24;
/** Ширина окна меню: видна левая половина, правая — за краем экрана. */
const START_W = 400;
/** Куда значки, если пользователь не выбрал: 'corner' | 'under' | 'off'. */
const ICONS_DEFAULT = 'under';
/** Размер значка у официального и зазор между значками. */
const ICON = 47;
const ICON_GAP = 4;

/** Экран игры из system.cfg клиента; нет файла — 1920×1080. */
function screenOf(client) {
  let w = 1920;
  let h = 1080;
  try {
    const cfg = fs.readFileSync(client.abs('system.cfg'), 'latin1');
    const mw = cfg.match(/r_Width\s*=\s*"(\d+)"/);
    const mh = cfg.match(/r_Height\s*=\s*"(\d+)"/);
    if (mw) w = +mw[1];
    if (mh) h = +mh[1];
  } catch (e) { /* по умолчанию */ }
  return { w, h, top: SCALE_TOP, bottom: SCALE_BOTTOM };
}

/**
 * Официальный вид для НАШИХ виджетов: имя остаётся (его знает наш код —
 * проверено по game.dll), пресет и размер — официальные.
 */
const RESKIN = {
  mail_notice: { preset: 'v3_mail', size: ICON },
  mail_full_notice: { preset: 'v3_null_mail', size: ICON },
  cash_mail_notice: { preset: 'v3_shugo_mail', size: ICON },
  express_mail_notice: { preset: 'v3_express_mail', size: ICON },
  btn_radar_map: { preset: 'v3_map', size: ICON },
  btn_quna_shop: { preset: 'v3_quna', size: ICON },
  btn_battlepass: { preset: 'v3_devapass', size: ICON },
  // Меню и влияние — гибридные пресеты (HYBRID): у официальных три
  // состояния, у наших шесть — «меню открыто» (main_state 1) рисовать было нечем.
  start_button: { preset: 'cl_gamemenu', size: ICON },
  prophet_button: { preset: 'cl_wars', size: ICON },
  // Полёт — гибридный пресет: с официальным v3_fly_btn значок пропал совсем —
  // в нём нет кольца времени и подложки, их официальный код рисует
  // отдельными виджетами, а наш — в этом же.
  fly_gauge: { preset: 'cl_fly_gauge', size: 46 },
};

/**
 * Свои пресеты: состояния НАШЕГО пресета (их ждёт наш код), картинка — у
 * официального того же состояния. Состояния, которого у официального нет:
 *   keep    — остаётся наша картинка (у полёта это подложка и кольцо времени);
 *   pressed — берётся его «нажатая» (кнопка меню, пока меню открыто).
 * Полёт сверяется по `state`, кнопки — по main_state/sub_state.
 */
const HYBRID = [
  { name: 'cl_fly_gauge', ours: 'v4_fly_gauge', theirs: 'v3_fly_btn', key: 'state', missing: 'keep' },
  { name: 'cl_gamemenu', ours: 'v4_start_button', theirs: 'v3_gamemenu', key: 'button', missing: 'pressed' },
  { name: 'cl_wars', ours: 'v4_propet_button', theirs: 'v3_wars', key: 'button', missing: 'pressed' },
];

function hybridPreset(spec, ourLib, theirLib) {
  const base = ourLib.presets.get(spec.ours);
  const donorP = theirLib.presets.get(spec.theirs);
  if (!base || !donorP) return null;
  const keyOf = spec.key === 'state'
    ? (r) => r.attrs.get('state')
    : (r) => (r.attrs.get('main_state') || '0') + '|' + r.attrs.get('sub_state');
  const refs = donorP.kids.filter((r) => r.name === 'SkinRef');
  const byState = new Map(refs.map((r) => [keyOf(r), r.attrs.get('name')]));
  const down = (refs.find((r) => r.attrs.get('sub_state') === 'down') || { attrs: new Map() }).attrs.get('name');
  const p = clone(base);
  p.attrs.set('name', spec.name);
  for (const r of p.kids) {
    if (r.name !== 'SkinRef') continue;
    const t = byState.get(keyOf(r)) || (spec.missing === 'pressed' ? down : null);
    if (t) r.attrs.set('name', t);
  }
  return p;
}
/** Круглые подложки старых значков: у официального значки плоские. */
const BLANK = ['item_shop_bg', 'quna_shop_bg']; // код их знает — оставляем пустыми
const DROP = ['battlepass_bg']; // код не знает — убираем

/** Значки в правом нижнем углу, справа налево; в одной ячейке — варианты одного значка. */
const CORNER = [
  ['mail_notice', 'mail_full_notice', 'express_mail_notice', 'cash_mail_notice'],
  ['btn_radar_map'],
  ['btn_quna_shop', 'quna_shop_bg'],
  ['btn_battlepass', 'battlepass_notice'],
  ['item_shop', 'item_shop_bg'],
];
/** Кнопки меню, справа налево. Полёт — в окне карты (RESTYLE.adopt). */
const START_ROW = ['start_button', 'prophet_button'];
/** Что убрать из меню, если оно переехало в окно карты. */
const START_MOVED = ['fly_gauge'];

/**
 * Окна, которые берутся НАШИМИ, а у официального — только оформление.
 *
 * Мини-карту целиком не подложить: у официального круг карты — полоса
 * (`gauge`) внутри контейнера, у нас — картинка, и код рисует карту именно в
 * неё. Поэтому окно остаётся нашим со всеми виджетами и типами, а от
 * официального берётся рамка; круг растягивается до официального, кнопки,
 * у которых место у официального есть, встают на него, остальные
 * раскладываются вокруг большего круга так же, как стояли.
 */
const RESTYLE = {
  'radar_dialog.xml': {
    frame: 'radar', // официальный контейнер — по нему окно и режется
    decor: ['radar_bg'], // что взять у официального как фон
    circle: 'radar_wnd', // по нему считаются центр и масштаб
    // time_slot — в гнездо официальной кнопки масштаба (у нас её нет): иначе
    // по кругу он ложился ровно под лупу «+» и пропадал из виду.
    // fly_gauge — в гнездо с крыльями, где у официального кнопка полёта:
    // окно карты того же типа в наборе s1 держит полоску полёта у себя, так
    // что наш код её там обслуживает (в s1 её нет в меню, как и тут теперь).
    place: {
      radar_sight: 'radarcontainer', radar_wnd: 'radar_wnd', btn_zoom: 'btn_zoom',
      vendor_notice: 'vendor_notice', time_slot: 'btn_scale', fly_gauge: 'fly_btn',
    },
    // что перенести в окно карты из меню того же набора
    adopt: { from: 'start_dialog.xml', names: ['fly_gauge'] },
  },
};

/**
 * Порядок окон набора: кто позже в списке — тот поверх. Окно карты
 * растянуто до низа ради значков и оказалось поверх кнопок меню — те
 * перестали нажиматься. Меню ставим последним.
 */
const SCREEN = { entry: 'ui_gamehud_s2.xml', l10n: 'UI/ui_gamehud_s2.xml', last: ['start_dialog'] };

function reorderScreen(buf) {
  const { root, strings } = bxml.parse(buf);
  const moved = [];
  for (const name of SCREEN.last) {
    const i = root.kids.findIndex((k) => k.name === 'Dialog' && lc(k.attrs.get('name')) === name);
    if (i < 0 || i === root.kids.length - 1) continue;
    moved.push(...root.kids.splice(i, 1));
  }
  if (!moved.length) return null;
  root.kids.push(...moved);
  return bxml.serialize(root, strings);
}

/**
 * Где ставить перенесённое окно. Основа — keepPlacement (как стояло наше,
 * с тем же замком: это важно для s1, где окна ставятся по XML). Для s2
 * работают только размеры (см. «КАК ИГРА РАССТАВЛЯЕТ»):
 *   bottomBar — панель умений шириной в экран, ряд ячеек — по центру экрана;
 *   fullWidth — полоса опыта шириной в экран;
 *   widen     — окно шире на ctx[widen] вправо: к его краю пристёгнута цель.
 */
const PLACE = {
  'quickbar_dialog.xml': { bottomBar: true },
  'exp_bar_dialog.xml': { fullWidth: true },
  // Место цели в s2 не задаётся ни её координатами (508, 459, сдвиг
  // содержимого — на экране одно и то же), ни шириной окна HP/MP (расширили
  // до 824 — цель не сдвинулась). Его держит код или запомненная игрой
  // раскладка. Как у официального — окно подвижное: ставишь мышью, игра
  // запоминает.
  'target_dialog.xml': { movable: true },
  // Ряды и боковая панель: вид и шаг ячеек официальные, флаги — наши
  // (у официального вместо not_active — not_focusable).
  'quickbar_dialog_ctrl.xml': { ownFlags: true },
  'quickbar_dialog_alt.xml': { ownFlags: true },
  'quickbar_dialog_extra.xml': { ownFlags: true },
  'quickbar_dialog_sep.xml': { ownFlags: true },
};

/** Раньше окно HP/MP расширялось, чтобы сдвинуть цель, — не помогло. */
const TARGET_PAD = 0;

/** Наш виджет -> официальный, на чьё место его поставить. */
const ANCHORS = {
  'basic_status_dialog.xml': { emblem: 'portrait' },
  'party_dialog.xml': { fly_gauge: 'fly_gauge01' },
};

/** Оформление без поведения: по имени и по типу. */
const DECOR_NAME = /(^|_)(bg|back|frame|line|deco|border|base|shadow)(_|\d|$)/i;
const DECOR_TYPE = /^(image|container|containerex)$/i;

const lc = (s) => String(s || '').toLowerCase();
const L10N_PREFIX = { hud_s1: 'UI/game_hud_s1/', hud_s2: 'UI/game_hud_s2/', game: 'UI/game/' };

function clone(n) {
  const c = new bxml.Node(n.name);
  c.text = n.text;
  for (const [k, v] of n.attrs) c.attrs.set(k, v);
  c.kids = n.kids.map(clone);
  return c;
}

const isWidget = (n) => n.name === 'Widget';

/**
 * Все виджеты окна с именем родителя-виджета (или '' у корня) и путём до
 * родителя: у отдельных панелей четыре одноимённых `inner_container`, и по
 * одному имени родителя их не различить.
 */
function widgetsOf(root) {
  const out = [];
  (function walk(n, parent, at) {
    for (const k of n.kids) {
      if (!isWidget(k)) continue;
      const name = lc(k.attrs.get('name'));
      out.push({ node: k, name, parent, path: at });
      walk(k, name, at + '/' + name);
    }
  })(root, '', '');
  return out;
}

/** Ставит наш виджет в центр чужого: размер наш, место его. */
function placeAt(ours, anchor) {
  const w = clone(ours);
  const a = anchor.getFrame();
  const o = ours.getFrame();
  if (a && o) {
    w.setFrame({
      x: Math.round(a.x + (a.w - o.w) / 2),
      y: Math.round(a.y + (a.h - o.h) / 2),
      w: o.w,
      h: o.h,
    });
  }
  return w;
}

/**
 * Собирает окно: берёт официальное и приводит его к тому, что умеет наш код.
 * @param {bxml.Node} ourRoot наше окно (только читается)
 * @param {bxml.Node} theirRoot официальное (меняется на месте)
 * @param {string} entry имя файла — по нему берутся якоря
 */
function adapt(ourRoot, theirRoot, entry) {
  const ours = widgetsOf(ourRoot);
  const ourNames = new Set(ours.map((w) => w.name));
  const anchors = ANCHORS[entry] || {};
  const byAnchor = new Map(Object.entries(anchors).map(([o, t]) => [lc(t), lc(o)]));
  const findOur = (name, parent) =>
    (ours.find((w) => w.name === name && w.parent === parent) || ours.find((w) => w.name === name) || {}).node;

  const dropped = new Set();
  const grafted = new Set();

  (function filter(n, parent) {
    const out = [];
    for (const k of n.kids) {
      if (!isWidget(k)) { out.push(k); continue; }
      const nm = lc(k.attrs.get('name'));
      const ourName = byAnchor.get(nm);
      // якорь — только если наш виджет есть: в s1 герба нет, там на месте
      // официального портрета остаётся сам портрет (3dview, код его знает)
      const anchored = ourName && findOur(ourName, parent);
      if (anchored) {
        out.push(placeAt(anchored, k));
        grafted.add(ourName + ' → место ' + nm);
        dropped.add(nm);
        continue;
      }
      // тот же виджет другого типа (в отдельной панели у нас ячейка-заготовка
      // container, у официального itemview) — берём наш, на официальное место:
      // код обращается к виджету как к своему типу
      const mine = nm && ourNames.has(nm) && findOur(nm, parent); // безымянные не сопоставить
      if (mine && lc(mine.attrs.get('type')) !== lc(k.attrs.get('type'))) {
        const w = clone(mine);
        if (k.getFrame()) w.setFrame(k.getFrame());
        out.push(w);
        grafted.add(nm + ' (свой тип)');
        continue;
      }
      filter(k, nm);
      const keptKids = k.kids.some(isWidget);
      const known = ourNames.has(nm);
      const decor = DECOR_NAME.test(nm) && DECOR_TYPE.test(k.attrs.get('type') || '');
      if (known || decor || keptKids) out.push(k);
      else dropped.add(nm);
    }
    n.kids = out;
  })(theirRoot, '');

  // наши виджеты, которых так и не оказалось, — досаживаем на их прежнее место
  // ключ — полный путь: parent одинаков у четырёх inner_container отдельных панелей
  const theirs = widgetsOf(theirRoot);
  const have = new Set(theirs.map((w) => w.path + '/' + w.name));
  const containers = new Map(theirs.map((w) => [w.path + '/' + w.name, w.node]));
  for (const w of ours) {
    const key = w.path + '/' + w.name;
    // безымянный виджет код найти не может — возвращать его незачем
    if (!w.name || have.has(key)) continue;
    // родителя тоже нет — значит, он досаживается целиком вместе с детьми
    if (w.path && !containers.has(w.path)) continue;
    const host = w.path ? containers.get(w.path) : theirRoot;
    host.kids.push(clone(w.node));
    have.add(key);
    for (const x of widgetsOf(w.node)) have.add(key + x.path + '/' + x.name);
    grafted.add(w.name + (w.parent ? ' в ' + w.parent : ''));
  }

  return { dropped: [...dropped], grafted: [...grafted] };
}

/**
 * Общее окно (цель, группа) есть в обоих наборах, и стоять оно должно там же,
 * где стояло наше, с тем же замком. У официального цель шире и не закреплена;
 * с нашим x она уезжала влево и наползала на полосы HP/MP. Держим ту же точку
 * привязки: у окна по центру — центр, у окна справа — правый край.
 */
function keepPlacement(ours, root) {
  const o = ours.getFrame();
  const t = root.getFrame();
  if (!o || !t) return;
  const h = lc(ours.attrs.get('h_pos_align'));
  const v = lc(ours.attrs.get('v_pos_align'));
  let x = o.x;
  let y = o.y;
  if (h === 'center') x = Math.round(o.x + (o.w - t.w) / 2);
  else if (h === 'right') x = o.x + o.w - t.w;
  if (v === 'center' || v === 'middle') y = Math.round(o.y + (o.h - t.h) / 2);
  else if (v === 'bottom') y = o.y + o.h - t.h;
  root.setFrame({ x, y, w: t.w, h: t.h });
  for (const k of ['h_pos_align', 'v_pos_align']) {
    if (ours.attrs.has(k)) root.attrs.set(k, ours.attrs.get(k));
  }
  const locked = ours.getFlags().includes('not_movable');
  root.removeFlag(locked ? 'movable' : 'not_movable');
  root.addFlag(locked ? 'not_movable' : 'movable');
}

/** Сдвигает все виджеты верхнего уровня. */
function shiftKids(root, dx, dy) {
  for (const k of root.kids) {
    if (!isWidget(k)) continue;
    const g = k.getFrame();
    if (g) k.setFrame({ x: g.x + dx, y: g.y + (dy || 0), w: g.w, h: g.h });
  }
}

const setSize = (root, w, h) => {
  const f = root.getFrame();
  root.setFrame({ x: f.x, y: f.y, w: w == null ? f.w : w, h: h == null ? f.h : h });
};

/**
 * Ставит окно (keepPlacement) и применяет правила PLACE.
 * @param {{screen: object, startW: number, quickbarWide: boolean, targetPad?: number}} ctx
 */
function place(ours, root, rule, ctx) {
  keepPlacement(ours, root);
  if (!rule) return;
  const S = ctx.screen;
  if (rule.bottomBar) {
    // Группа «панель + меню» центрируется кодом. Панель шириной в экран:
    // её левый край уходит влево на половину меню, и середина экрана внутри
    // панели — в точке (Wq + Ws) / 2. Туда и ставится середина ряда ячеек.
    const wq = Math.round(S.w / S.bottom);
    const ctn = root.kids.find((k) => isWidget(k) && lc(k.attrs.get('name')) === 'ctn_shortcut');
    const c = ctn && ctn.getFrame();
    if (c) shiftKids(root, Math.round((wq + ctx.startW) / 2 - c.w / 2) - c.x);
    setSize(root, wq);
    root.addFlag('transparent'); // пустое место панели не должно ловить клики
  }
  if (rule.fullWidth) {
    // Левый край полосы — середина экрана минус половина панели умений. Если
    // панель шириной в экран, это ровно левый край экрана.
    const t = root.getFrame();
    const wq = ctx.quickbarWide ? Math.round(S.w / S.bottom) : null;
    // запас: игра рисует низ чуть мельче расчёта, и полоса обрывалась на
    // 1878 из 1920 (27.09); лишнее уходит за правый край экрана
    const w = wq ? Math.round(wq * EXP_OVERSHOOT) : ours.getFrame().w;
    for (const x of widgetsOf(root)) {
      const f = x.node.getFrame();
      if (f && f.w === t.w) x.node.setFrame({ x: f.x, y: f.y, w, h: f.h });
    }
    setSize(root, w);
  }
  if (rule.movable) {
    root.removeFlag('not_movable');
    root.addFlag('movable');
  }
  if (rule.ownFlags) {
    if (ours.attrs.has('flag')) root.attrs.set('flag', ours.attrs.get('flag'));
    else root.attrs.delete('flag');
  }
  const widen = rule.widen ? Math.round(Number(ctx[rule.widen]) || 0) : 0;
  if (widen) {
    // Фон окна растягивается на всё окно — рамка полос вытянулась бы до
    // середины экрана. Переносим его в картинку прежнего размера (так у
    // официального устроен радар: фон — на картинке radar_bg).
    const f = root.getFrame();
    const bg = root.attrs.get('preset');
    if (bg) {
      const img = new bxml.Node('Widget');
      img.attrs.set('frame', `0,0,${f.w},${f.h}`);
      img.attrs.set('name', 'status_bg');
      img.attrs.set('preset', bg);
      img.attrs.set('type', 'image');
      root.attrs.delete('preset');
      root.kids.unshift(img);
    }
    setSize(root, f.w + widen);
    root.addFlag('transparent');
  }
}

/** Рамка виджета в координатах предка `top` (сумма смещений по пути). */
function absFrame(root, name, top) {
  let hit = null;
  // started — уже внутри top (или top не задан): отсюда координаты и считаются
  (function walk(n, dx, dy, started) {
    for (const k of n.kids) {
      if (hit || !isWidget(k)) continue;
      const f = k.getFrame() || { x: 0, y: 0, w: 0, h: 0 };
      const nm = lc(k.attrs.get('name'));
      const x = dx + f.x;
      const y = dy + f.y;
      if (started && nm === lc(name)) { hit = { x, y, w: f.w, h: f.h }; return; }
      if (!started && top && nm === lc(top)) walk(k, 0, 0, true);
      else walk(k, x, y, started);
    }
  })(root, 0, 0, !top);
  return hit;
}

/** Наши виджеты — в официальном виде (RESKIN), старые подложки — прочь. */
function reskin(root) {
  root.kids = root.kids.filter((k) => !(isWidget(k) && DROP.includes(lc(k.attrs.get('name')))));
  for (const k of root.kids) {
    if (!isWidget(k)) continue;
    const name = lc(k.attrs.get('name'));
    const r = RESKIN[name];
    if (r) {
      k.attrs.set('preset', r.preset);
      k.kids = k.kids.filter((x) => x.name !== 'Skin');
      // новый размер — вокруг того же центра: значок остаётся в своём гнезде
      const f = k.getFrame();
      if (f) {
        k.setFrame({
          x: Math.round(f.x + (f.w - r.size) / 2), y: Math.round(f.y + (f.h - r.size) / 2), w: r.size, h: r.size,
        });
      }
    }
    // подложку код включает вместе со значком — оставляем, но пустой
    if (BLANK.includes(name)) {
      k.attrs.delete('preset');
      k.kids = k.kids.filter((x) => x.name !== 'Skin');
    }
  }
}

/**
 * Ряд значков справа налево от `right`; в одной ячейке — варианты одного
 * значка (почта обычная/полная/срочная), каждый по центру ячейки.
 */
function iconRow(root, slots, right, top, cell) {
  let x = right;
  for (const slot of slots) {
    const nodes = slot
      .map((n) => root.kids.find((w) => isWidget(w) && lc(w.attrs.get('name')) === lc(n)))
      .filter(Boolean);
    if (!nodes.length) continue;
    for (const w of nodes) {
      const f = w.getFrame();
      w.setFrame({ x: Math.round(x - cell + (cell - f.w) / 2), y: Math.round(top + (cell - f.h) / 2), w: f.w, h: f.h });
    }
    x -= cell + ICON_GAP;
  }
}

/**
 * Меню: окно наше (кнопку меню, влияние и полёт знает наш код), вид —
 * официальный, без старой витой рамки. Окно шириной START_W: код ставит его
 * справа от панели умений, и правая половина уходит за край экрана — кнопки
 * в видимой половине оказываются в правом нижнем углу.
 */
function restyleStart(ourRoot, startW, moved) {
  const root = clone(ourRoot);
  root.attrs.delete('preset');
  if (moved) root.kids = root.kids.filter((k) => !(isWidget(k) && START_MOVED.includes(lc(k.attrs.get('name')))));
  reskin(root);
  // Низ окна код прижимает к низу экрана, а там полоса опыта: кнопки —
  // выше неё, на одной линии со значками (у тех тот же запас снизу).
  const h = ICON + 9 + BOTTOM_RESERVE;
  const nodes = START_ROW.map((n) => root.kids.find((w) => isWidget(w) && lc(w.attrs.get('name')) === n)).filter(Boolean);
  let x = Math.round(startW / 2) - 8;
  for (const w of nodes) {
    const f = w.getFrame();
    w.setFrame({ x: x - f.w, y: h - BOTTOM_RESERVE - Math.round((ICON + f.h) / 2), w: f.w, h: f.h });
    x -= f.w + ICON_GAP;
  }
  setSize(root, startW, h);
  root.addFlag('transparent');
  return root;
}

/**
 * Перекраска: наше окно + фон официального. @returns {bxml.Node|null}
 * null — у официального не нашлось того, на что опирается перекраска.
 */
/**
 * @param {{size?: 'ours'|'official', icons?: 'corner'|'under'|'off', screen?: object, startW?: number}} [opts]
 *   size — «ours»: круг карты как был у нас, рамка уменьшается под него;
 *   icons — значки в правый нижний угол экрана / под картой / не трогать
 */
function restyle(ourRoot, theirRoot, rule, opts) {
  const o_ = opts || {};
  const box0 = absFrame(theirRoot, rule.frame, null);
  const circle0 = absFrame(theirRoot, rule.circle, rule.frame);
  const ourCircleNode = ourRoot.find(rule.circle);
  const ourCircle = ourCircleNode && ourCircleNode.getFrame();
  if (!box0 || !circle0 || !ourCircle) return null;

  // всё официальное — в одном масштабе: либо его родной, либо под наш круг
  const k = o_.size === 'official' ? 1 : ourCircle.w / circle0.w;
  const sc = (f) => ({ x: Math.round(f.x * k), y: Math.round(f.y * k), w: Math.round(f.w * k), h: Math.round(f.h * k) });
  const box = { x: 0, y: 0, w: Math.round(box0.w * k), h: Math.round(box0.h * k) };
  const theirCircle = sc(circle0);
  const at = (name) => { const f = absFrame(theirRoot, name, rule.frame); return f && sc(f); };

  const root = clone(ourRoot);
  // старый фон окна рисовался бы растянутым поверх новой рамки
  root.attrs.delete('preset');

  const s = theirCircle.w / ourCircle.w;
  const cx = ourCircle.x + ourCircle.w / 2;
  const cy = ourCircle.y + ourCircle.h / 2;
  const nx = theirCircle.x + theirCircle.w / 2;
  const ny = theirCircle.y + theirCircle.h / 2;
  const moved = [];
  for (const w of root.kids) {
    if (!isWidget(w)) continue;
    const f = w.getFrame();
    if (!f) continue;
    const target = rule.place[lc(w.attrs.get('name'))];
    const there = target && at(target);
    if (there) {
      w.setFrame(there);
      // тот же тип виджета — берём и то, чем он нарисован; другой тип (у нас
      // картинка, у официального полоса) — оставляем наш: код рассчитан на него
      const theirs = theirRoot.find(target);
      if (theirs && lc(theirs.attrs.get('type')) === lc(w.attrs.get('type'))) {
        const skinsOf = (n) => n.kids.filter((k) => k.name === 'Skin');
        if (theirs.attrs.get('preset')) w.attrs.set('preset', theirs.attrs.get('preset'));
        if (skinsOf(theirs).length) {
          w.kids = w.kids.filter((k) => k.name !== 'Skin').concat(skinsOf(theirs).map(clone));
        }
      }
    } else {
      // вокруг большего круга так же, как стояли вокруг нашего; размер свой
      const mx = f.x + f.w / 2;
      const my = f.y + f.h / 2;
      w.setFrame({
        x: Math.round(nx + (mx - cx) * s - f.w / 2),
        y: Math.round(ny + (my - cy) * s - f.h / 2),
        w: f.w,
        h: f.h,
      });
    }
    moved.push(lc(w.attrs.get('name')));
  }

  reskin(root);

  // значки: в правый нижний угол экрана или рядом под картой
  let height = box.h;
  let decorShift = 0;
  if (o_.icons === 'corner' && o_.screen) {
    // Окно карты стоит в правом верхнем углу; чтобы значки оказались внизу
    // экрана, оно растягивается до низа (и пропускает клики сквозь пустоту).
    // Ряд — левее кнопок меню, над полосой опыта.
    const S = o_.screen;
    height = Math.round(S.h / S.top);
    const top = Math.round((S.h - BOTTOM_RESERVE - ICON * S.top) / S.top);
    const right = Math.round(box.w - ((o_.startW / 2) * S.bottom + 8) / S.top);
    iconRow(root, CORNER, right, top, ICON);
    root.addFlag('transparent');
  } else if (o_.icons !== 'off') {
    const top = box.h + ICON_GAP;
    iconRow(root, CORNER, box.w - 6, top, ICON);
    height = top + ICON + ICON_GAP;
  }

  // Значки левее окна — расширяем окно влево и сдвигаем всё внутри: окно
  // прижато к правому краю экрана, карта останется на месте, а значки
  // окажутся внутри окна (виджет вне окна может не ловить нажатия).
  let width = box.w;
  let minX = 0;
  for (const k of root.kids) {
    const f = isWidget(k) && k.getFrame();
    if (f && f.x < minX) minX = f.x;
  }
  if (minX < 0) {
    const grow = -minX + 4;
    shiftKids(root, grow);
    width += grow;
    decorShift = grow;
  }

  const o = ourRoot.getFrame();
  const alignRight = lc(ourRoot.attrs.get('h_pos_align')) === 'right';
  root.setFrame({ x: alignRight ? o.x + o.w - width : o.x, y: o.y, w: width, h: height });

  // фон — первым, чтобы рисовался под всем остальным
  const decor = [];
  for (const name of rule.decor) {
    const node = theirRoot.find(name);
    const f = at(name);
    if (!node || !f) continue;
    const copy = clone(node);
    copy.kids = copy.kids.filter((x) => !isWidget(x));
    copy.setFrame({ x: f.x + decorShift, y: f.y, w: f.w, h: f.h });
    decor.push(copy);
  }
  root.kids.unshift(...decor);
  return { root, decor: rule.decor, moved };
}

/** Какие пресеты и скины зовёт окно. */
function refsOf(root) {
  const presets = new Set();
  const skins = new Set();
  for (const n of root.walk()) {
    const p = n.attrs.get('preset');
    if (p) presets.add(p);
    if (n.name === 'Skin' && n.attrs.get('name')) skins.add(n.attrs.get('name'));
  }
  return { presets, skins };
}

/** Все скины и пресеты набора библиотек: имя -> узел (первый). */
function libIndex(files) {
  const skins = new Map();
  const presets = new Map();
  for (const [k, buf] of files) {
    if (!/\.xml$/i.test(k)) continue;
    let root;
    try { root = bxml.parse(buf).root; } catch (e) { continue; }
    if (root.name !== 'Preload') continue;
    for (const n of root.walk()) {
      const nm = n.attrs.get('name');
      if (!nm) continue;
      if (n.name === 'Skin' && !skins.has(nm)) skins.set(nm, n);
      if (n.name === 'Preset' && !presets.has(nm)) presets.set(nm, n);
    }
  }
  return { skins, presets };
}

/** Окно донора из его локализованного пака (имена там бывают в любом регистре). */
function donorDialog(donor, lang, name) {
  const langs = donor.languages();
  const l = langs.find((x) => lc(x) === lc(lang)) || langs[0];
  const file = donorlib.findCI(donor.root, 'l10n/' + l + '/data/data.pak');
  if (!donor._l10nNames) donor._l10nNames = new Map();
  if (!donor._l10nNames.has(file)) {
    donor._l10nNames.set(file, new Map(pak.listPak(file).entries.map((e) => [lc(e.name), e.name])));
  }
  const real = donor._l10nNames.get(file).get(lc(name));
  return real ? pak.readSome(file, donor.dll, [real]).get(real) : null;
}

/**
 * Переносится ли окно: `off[id] === true` — выключено, `false` — включено
 * явно (для окон с defaultOff), нет записи — по умолчанию окна.
 */
function dialogOn(d, off, id) {
  const key = id || d.key + '/' + d.entry;
  return key in off ? !off[key] : !d.defaultOff;
}

/**
 * Куда ставятся официальные окна HUD (у официального они всегда из s2):
 *   s2 — «Обычный стиль»: полосы вверху слева, игра пристёгивает к ним цель;
 *   s1 — «Стиль Aion»: полосы с 3D-портретом, панель умений, меню и карта
 *        внизу одной группой, цель — вверху по центру.
 */
const SETS = { s1: 'hud_s1', s2: 'hud_s2' };
/** С 27.09 пользователь играет в «Стиле Aion»: в s2 цель не сдвинуть с полос HP/MP. */
const SET_DEFAULT = 's1';
const ourKeyOf = (d, set) => (d.key === 'hud_s2' ? SETS[set] : d.key);

/** Меню для s1: окно наше и на своём месте, значки официальные, без старой рамки. */
function restyleStartInPlace(ourRoot) {
  const root = clone(ourRoot);
  root.attrs.delete('preset');
  reskin(root);
  return root;
}

/**
 * Готовит перенос выбранных окон. Файлы не меняются.
 * @param {import('./client').Client} client
 * @param {donorlib.Donor} donor
 * @param {string} lang
 * @param {{off?: object, targetPad?: number, radarSize?: string, icons?: string}} [opts]
 *   off — выключенные окна `key/entry`; targetPad — на сколько расширить
 *   окно HP/MP, чтобы цель встала по центру (по умолчанию TARGET_PAD);
 *   radarSize — 'ours' | 'official'; icons — 'under' (по умолчанию,
 *   ICONS_DEFAULT) | 'corner' | 'off'
 */
function plan(client, donor, lang, opts) {
  const o = opts || {};
  const off = o.off || {};
  const set = SETS[o.set] ? o.set : SET_DEFAULT;
  const idOf = (d) => ourKeyOf(d, set) + '/' + d.entry;
  const on = (entry) => { const d = DIALOGS.find((x) => x.entry === entry); return dialogOn(d, off, idOf(d)); };
  const ctx = {
    screen: screenOf(client),
    targetPad: o.targetPad == null ? TARGET_PAD : o.targetPad,
    quickbarWide: on('quickbar_dialog.xml'),
    startW: null, // ниже: START_W, если меню переносим, иначе ширина нашего
  };
  // По умолчанию значки под картой: «в угол» растягивает окно карты до низа
  // экрана, и игра выталкивает за экран боковую панель умений (III), которую
  // ставит в правую колонку под картой.
  let icons = o.icons || (o.iconsRow === false ? 'off' : ICONS_DEFAULT);
  // в s1 карта внизу, в группе с меню: «в угол» там не бывает
  if (set === 's1' && icons === 'corner') icons = 'under';
  const ourLib = libIndex(client.original('preload'));
  const theirLib = libIndex(donor.preload());
  const oursFind = donorlib.ourFinder(client, lang);
  const theirsFind = donor.finder(lang);

  const dialogs = [];
  const wantPresets = new Set();
  const wantSkins = new Set();
  const l10nNames = DIALOGS.map((d) => L10N_PREFIX[ourKeyOf(d, set)] + d.entry);
  const ourL10n = client.hasL10n(lang) ? client.l10nRead(lang, l10nNames) : new Map();
  // ширина меню нужна панели умений заранее: код центрирует их вместе
  if (on('start_dialog.xml')) ctx.startW = START_W;
  else {
    const buf = ourL10n.get(L10N_PREFIX.hud_s2 + 'start_dialog.xml');
    ctx.startW = buf ? bxml.parse(buf).root.getFrame().w : 313;
  }

  for (const d of DIALOGS) {
    const key = ourKeyOf(d, set);
    const id = key + '/' + d.entry;
    const l10nName = L10N_PREFIX[key] + d.entry;
    const row = Object.assign({}, d, { id, key, l10nName, on: dialogOn(d, off, id) });
    dialogs.push(row);
    // Полоса опыта официального — шириной 1920 под расстановку s2. В s1 игра
    // ставит её левый край по своему правилу, и полоса уезжала вправо (27.09,
    // скрин пользователя). Своя полоса s1 стояла верно — её и оставляем,
    // новый вид она получает скинами.
    if (set === 's1' && d.entry === 'exp_bar_dialog.xml') {
      row.error = 'в «Стиле Aion» остаётся своя — официальная уезжает';
      continue;
    }
    // наше окно — то, что читает игра (l10n), а нет его — из data/ui;
    // официальное — всегда из его s2
    const ourBuf = ourL10n.get(l10nName) || (client.has(key) && client.original(key).get(d.entry));
    const theirBuf = donorDialog(donor, lang, L10N_PREFIX[d.key] + d.entry);
    if (!ourBuf || !theirBuf) { row.error = !ourBuf ? 'у тебя нет такого окна' : 'у официального нет такого окна'; continue; }
    const ourParsed = bxml.parse(ourBuf);
    const ours = ourParsed.root;
    const { root, strings } = bxml.parse(theirBuf);
    if (lc(root.attrs.get('type')) !== lc(ours.attrs.get('type'))) {
      row.error = `другой тип окна: ${root.attrs.get('type')} против ${ours.attrs.get('type')}`;
      continue;
    }
    let result = root;
    if (d.entry === 'start_dialog.xml') {
      // s2: полёт уезжает в окно карты, только если карту тоже переносим;
      // s1: полёт и так в окне карты, меню остаётся в группе внизу
      result = set === 's1' ? restyleStartInPlace(ours) : restyleStart(ours, ctx.startW, on('radar_dialog.xml'));
      row.restyle = true;
      row.dropped = [];
      row.grafted = ['окно твоё, значки официальные, без старой рамки'];
      row.data = bxml.serialize(result, ourParsed.strings);
    } else if (RESTYLE[d.entry]) {
      // забираем виджеты из соседнего окна (полёт из меню) — до перекраски,
      // чтобы они встали на свои места вместе со всеми
      const adopt = set === 's2' && RESTYLE[d.entry].adopt;
      if (adopt && on(adopt.from)) {
        const buf = ourL10n.get(L10N_PREFIX[d.key] + adopt.from);
        const from = buf && bxml.parse(buf).root;
        for (const name of adopt.names) {
          const w = from && from.kids.find((k) => isWidget(k) && lc(k.attrs.get('name')) === name);
          if (w && !ours.find(name)) ours.kids.push(clone(w));
        }
      }
      const rs = restyle(ours, root, RESTYLE[d.entry],
        { size: o.radarSize, icons: on('start_dialog.xml') ? icons : (icons === 'corner' ? 'under' : icons),
          screen: ctx.screen, startW: ctx.startW });
      if (!rs) { row.error = 'у официального не нашлось рамки для перекраски'; continue; }
      result = rs.root;
      row.restyle = true;
      row.dropped = [];
      row.grafted = ['окно твоё, от официального — ' + rs.decor.join(', ')];
      row.data = bxml.serialize(result, ourParsed.strings);
    } else {
      const a = adapt(ours, root, d.entry);
      // растяжки панели умений и опыта — под расстановку s2, в s1 не нужны
      const rule = PLACE[d.entry];
      place(ours, root, set === 's1' && rule && (rule.bottomBar || rule.fullWidth) ? null : rule, ctx);
      row.dropped = a.dropped;
      row.grafted = a.grafted;
      // The donor's string table belongs to the official client and can miss
      // localised labels used by our client (Battle Pass and other screens).
      // Keep the original table as the base; node text is already decoded by
      // bxml.parse and will be interned into the resulting table.
      row.data = bxml.serialize(root, ourParsed.strings);
    }
    row.frame = [ours.getFrame(), result.getFrame()];
    if (!row.on) continue;
    const r = refsOf(result);
    r.presets.forEach((p) => wantPresets.add(p));
    r.skins.forEach((s) => wantSkins.add(s));
  }

  // пресеты и скины, которых у нас нет, — из библиотек донора
  const presets = [];
  const missing = [];
  for (const p of wantPresets) {
    if (ourLib.presets.has(p)) continue;
    const spec = HYBRID.find((h) => h.name === p);
    const node = spec ? hybridPreset(spec, ourLib, theirLib) : theirLib.presets.get(p);
    if (!node) { missing.push('пресет ' + p); continue; }
    presets.push(clone(node));
    for (const ref of node.kids) if (ref.name === 'SkinRef' && ref.attrs.get('name')) wantSkins.add(ref.attrs.get('name'));
  }
  const skins = [];
  const ships = new Map();
  for (const s of wantSkins) {
    if (ourLib.skins.has(s)) continue;
    const node = theirLib.skins.get(s);
    if (!node) { missing.push('скин ' + s); continue; }
    const copy = clone(node);
    const tex = node.attrs.get('texture');
    if (tex) {
      const theirLoc = theirsFind.resolve(tex);
      if (!theirLoc) { missing.push('атлас ' + tex); continue; }
      const ourLoc = oursFind.resolve(tex);
      const same = ourLoc && ourLoc.crc === theirLoc.crc && ourLoc.size === theirLoc.size;
      if (!same) {
        const ship = donorlib.shipName(tex);
        ships.set(ship, theirLoc);
        copy.attrs.set('texture', 'textures/ui/' + ship);
      }
    }
    skins.push(copy);
  }

  // Окно карты тянется до низа (значки в углу) — меню должно быть поверх
  // него в списке окон набора, иначе его кнопки не нажимаются.
  const screens = { ui: new Map(), l10n: new Map() };
  const radarTall = on('radar_dialog.xml') && on('start_dialog.xml') && icons === 'corner';
  if (radarTall) {
    const own = client.has('ui') && client.original('ui').get(SCREEN.entry);
    const fixed = own && reorderScreen(own);
    if (fixed) screens.ui.set(SCREEN.entry, fixed);
    const loc = client.hasL10n(lang) && client.l10nRead(lang, [SCREEN.l10n]).get(SCREEN.l10n);
    const fixedLoc = loc && reorderScreen(loc);
    if (fixedLoc) screens.l10n.set(SCREEN.l10n, fixedLoc);
  }

  return { set, dialogs, presets, skins, ships, missing, screens };
}

/**
 * Дописывает недостающие скины и пресеты в нашу библиотеку отдельной
 * категорией — чтобы их было видно и легко убрать.
 * @returns {number} сколько узлов добавлено
 */
function addToLibrary(root, p) {
  if (!p.skins.length && !p.presets.length) return 0;
  const cat = new bxml.Node('Category');
  cat.attrs.set('name', 'classic_hud');
  cat.kids.push(...p.skins, ...p.presets);
  root.kids.push(cat);
  return p.skins.length + p.presets.length;
}

module.exports = {
  DIALOGS, ANCHORS, RESTYLE, PLACE, TARGET_PAD, START_W, RESKIN, CORNER, ICONS_DEFAULT, HYBRID, SET_DEFAULT,
  plan, adapt, restyle, restyleStart, keepPlacement, place, addToLibrary, screenOf, L10N_PREFIX,
};
