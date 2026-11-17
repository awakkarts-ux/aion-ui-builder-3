/* ======================= сборка ======================= */

/**
 * Что реально соберётся — по тому же правилу, что и сборка (core/look.js
 * resolve): есть микшер «Вида интерфейса» — по его группам, нет — по старым
 * галочкам. Раньше сводка смотрела только на галочки и после «Применить»
 * на Главной писала «не меняем», хотя сборка Classic ставила (17.11).
 */
const LK_SWITCHES = ['hudwin', 'winfix', 'maptiles'];
function lookMix(p) {
  const cl = p.classic || {};
  const g = p.look && p.look.groups;
  if (!g) {
    return { v5: !!(p.v5 && p.v5.enabled), classic: !!cl.enabled, hud: !!(cl.hud && cl.hud.enabled), maps: !!cl.maps };
  }
  const any = (want) => Object.entries(g).some(([id, v]) => !LK_SWITCHES.includes(id) && v === want);
  return { v5: any('v5'), classic: any('classic'), hud: g.hudwin === 'classic', maps: g.maptiles === 'classic' };
}

function classicSummary(cl, on) {
  if (!cl || !on) return 'не меняем';
  if (!cl.root) return 'включён, но не выбран официальный клиент';
  const off = Object.keys(cl.off || {}).length;
  if (clPlan) return `включён, деталей ${clPicked()} из ${clPlan.total}`;
  return off ? `включён, выключено групп: ${off}` : 'включён';
}

function renderSummary() {
  const p = state.profile;
  const mix = lookMix(p);
  const layout = Object.keys(p.layout).length;
  const count = (id) => Object.keys((p.packs && p.packs[id]) || {}).length;
  const pt = p.portrait;
  $('#apply-summary').innerHTML = [
    ['Язык клиента', p.lang || 'rus'],
    ['Диалогов изменено', layout],
    ['Портрет', pt && pt.enabled ? `${pt.size}×${pt.size}, камера ${pt.maleDist}` : 'не меняем'],
    ['Шрифт', p.font.enabled && p.font.builtin ? `готовый: ${p.font.builtin}`
      : p.font.enabled && p.font.file ? p.font.file.split(/[\\/]/).pop()
        : p.theme === 'nightcity' ? 'Fira Sans Condensed (тестовый вариант)' : 'не меняем'],
    ['Иконок умений', skFamilyCount(p.packs && p.packs.skills)],
    ['Иконок предметов', Object.keys((p.packs && p.packs.items) || {}).length],
    ['Стиль интерфейса', p.look
      ? `микшер: не свой вид у групп — ${Object.values(p.look.groups || {}).filter((s) => s !== 'own').length}`
      : 'по галочкам тонкой настройки'],
    ['Мини-карта', p.radar && p.radar.square ? 'квадратная' : 'круглая'],
    ['Свои карты', Object.keys(p.maps || {}).length || 'нет'],
    ['Окна HUD двигаются мышью', Object.keys(p.hudFree || {}).join(', ') || 'нет'],
    ['Раскладка «Стиля Aion»', p.arrange && p.arrange.mapTopRight ? 'карта справа вверху' : 'как в игре'],
    ['Окон бафов изменено', Object.keys(p.buffs || {}).length],
    ['Цифр урона', p.hitnum && p.hitnum.enabled
      ? `конструктор (${p.hitnum.staged === hnSig(hnState()) ? 'подготовлено' : 'подготовлю при сборке'})`
      : count('hitnum')],
    ['Картинок интерфейса', count('uiatlas')],
    ['Тестовый вариант', p.theme === 'nightcity'
      ? `Night City (${{ mix: 'смешанный', red: 'красный', cyan: 'бирюза' }[p.themeVariant || 'mix'] || 'смешанный'}) — перерисованные атласы и шрифт`
      : 'нет'],
    ['Вид Aion 5.x', mix.v5 ? 'включён' : 'не меняем'],
    ['Вид официального Classic', classicSummary(p.classic, mix.classic)],
    ['Окна HUD официального Classic', mix.hud && p.classic && p.classic.root
      ? `переносим (набор ${{ s1: '«Стиль Aion»', s2: '«Обычный»' }[(p.classic.hud && p.classic.hud.set)] || '«Стиль Aion»'})` : 'не меняем'],
    ['Перекрашенные карты', mix.maps && p.classic && p.classic.root ? 'заменяем' : 'не меняем'],
    ['Скинов изменено вручную', Object.keys(p.skins || {}).length],
  ]
    .map(([k, v]) => `<b>${k}</b><span>${v}</span>`)
    .join('');
}

/*
 * Окно сборки: сборка идёт в фоновом потоке (main → core/buildworker.js),
 * сюда приходят строки журнала — последняя показывается шагом. По концу —
 * «Успешно» с итогом или ошибка своими словами.
 */
const bld = { started: 0, timer: 0, steps: 0 };

function bldShow(mode, o) {
  const box = $('#bld');
  box.hidden = false;
  $('#bld-icon').dataset.state = mode;
  $('#bld-foot').hidden = mode === 'run';
  if (o.title) $('#bld-title').textContent = o.title;
  if (o.text != null) $('#bld-text').textContent = o.text;
  if (o.step != null) $('#bld-step').textContent = o.step;
  $('#bld-ok').textContent = mode === 'bad' ? 'Закрыть' : 'Готово';
  if (mode !== 'run') setTimeout(() => $('#bld-ok').focus(), 0);
}

const bldElapsed = () => Math.max(1, Math.round((Date.now() - bld.started) / 1000));
const bldClose = () => { if (!$('#bld-foot').hidden) $('#bld').hidden = true; };

window.api.build.onProgress((msg) => {
  bld.steps++;
  // строка журнала — техническая, показываем коротко: без путей к пакам
  const short = String(msg).replace(/\s—\s[^—]*(\.pak|\.xml)[^—]*$/i, '').slice(0, 140);
  $('#bld-step').textContent = short;
});

$('#do-apply').onclick = () =>
  guard(async () => {
    if (!state.ready) throw new Error('сначала укажи папку клиента');
    $('#do-apply').disabled = true;
    bld.started = Date.now();
    bld.steps = 0;
    bldShow('run', { title: 'Собираю интерфейс…', text: 'Не закрывай программу и не запускай игру, пока идёт сборка.', step: 'готовлю цифры урона…' });
    clearInterval(bld.timer);
    bld.timer = setInterval(() => { $('#bld-title').textContent = `Собираю интерфейс… ${bldElapsed()} с`; }, 1000);
    try {
      // цифры урона из конструктора: настройки менялись — дорисовать до сборки
      await hnEnsureStaged();
      $('#bld-step').textContent = 'читаю паки клиента…';
      const res = await window.api.build.apply(state.profile);
      clearInterval(bld.timer);
      $('#apply-log').textContent = res.log.join('\n') || 'изменений не было';
      const warn = res.log.filter((l) => /ВНИМАНИЕ|нет файла|не нашлось|пропущено/i.test(l)).length;
      const freed = (res.log.find((l) => /^окна двигаются мышью/.test(l)) || '').replace(/^[^:]+:\s*/, '');
      bldShow('ok', {
        title: 'Успешно',
        text: 'Интерфейс установлен. Перезапусти игру, чтобы увидеть изменения.',
        step: `диалогов ${res.report.dialogs} · файлов ${res.report.files} · за ${bldElapsed()} с` +
          (warn ? ` · предупреждений ${warn} — смотри журнал` : '') +
          (freed ? ` · двигаются мышью: ${freed}` : ''),
      });
      await refreshStatus();
      renderSummary();
    } catch (e) {
      clearInterval(bld.timer);
      const msg = String(e && e.message ? e.message : e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
      bldShow('bad', {
        title: 'Не получилось',
        text: /запущен|занят|EBUSY|EPERM|being used/i.test(msg)
          ? 'Похоже, игра запущена или файл занят. Закрой игру и нажми «Собрать и установить» ещё раз.'
          : 'Сборка остановилась с ошибкой. Файлы игры, которые не успели записаться, остались прежними.',
        step: msg,
      });
    } finally {
      $('#do-apply').disabled = false;
    }
  });

$('#bld-ok').onclick = bldClose;
$('#bld-log').onclick = () => { bldClose(); $('.nav[data-view="apply"]').click(); };
$('#bld').onkeydown = (e) => { if (e.key === 'Escape') bldClose(); };

$('#do-restore').onclick = () =>
  guard(async () => {
    const ok = confirm('Сбросить все настройки?\n\n' +
      '— файлы игры вернутся к штатным (из резерва);\n' +
      '— все настройки программы станут по умолчанию: тема, Classic, 5.x, шрифт, иконки, цифры, бафы, портрет, карты.\n\n' +
      'Останутся: папка клиента, язык, импорт официального Classic и сохранённые пресеты. ' +
      'Старые настройки сохранятся копией в файл.');
    if (!ok) return;
    const r = await window.api.profile.resetAll();
    try { localStorage.setItem('resetAll.done', JSON.stringify({ n: r.restored.length, backup: r.backup })); } catch (e) { /* без localStorage — просто без сообщения */ }
    // все разделы читают профиль при запуске — проще и надёжнее перезагрузить окно
    location.reload();
  });

// сообщение после перезагрузки окна сбросом
try {
  const d = JSON.parse(localStorage.getItem('resetAll.done') || 'null');
  if (d) {
    localStorage.removeItem('resetAll.done');
    setTimeout(() => toast(`Настройки сброшены, файлов игры возвращено: ${d.n}. Старые настройки: ${d.backup || 'не было'}`), 600);
  }
} catch (e) { /* ничего */ }
