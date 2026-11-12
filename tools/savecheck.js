'use strict';

/*
 * Проверка сохранения профиля в настоящем окне программы, но на копии данных:
 *   node_modules\electron\dist\electron.exe tools/savecheck.js [папка-с-profile.json]
 * Копирует profile.json и config.json во временную папку, запускает программу
 * с этой папкой вместо %APPDATA%, щёлкает галочку «Вид официального Classic»
 * и смотрит, дошло ли изменение до файла. Настоящий профиль не трогает.
 */

const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const src = process.argv.find((a, i) => i > 1 && !a.startsWith('-') && fs.existsSync(a) &&
  fs.statSync(a).isDirectory()) || path.join(app.getPath('appData'), 'aion-ui-builder');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aionui-save-'));
for (const f of ['profile.json', 'config.json']) {
  if (fs.existsSync(path.join(src, f))) fs.copyFileSync(path.join(src, f), path.join(tmp, f));
}
app.setPath('userData', tmp);
app.disableHardwareAcceleration();

const profileFile = path.join(tmp, 'profile.json');
const read = () => {
  try { return JSON.parse(fs.readFileSync(profileFile, 'utf8')); } catch (e) { return null; }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failed = false;
const say = (m) => process.stdout.write(m + '\n');

app.on('browser-window-created', (_e, w) => {
  w.webContents.on('console-message', (e, _level, message) => {
    say('[окно] ' + (e.message !== undefined ? e.message : message));
  });
  w.webContents.once('did-finish-load', async () => {
    try {
      await sleep(4000); // boot: профиль, клиент, опись
      // как у пользователя: сначала открыть раздел — он читает клиента-донора
      await w.webContents.executeJavaScript(
        "document.querySelector('.nav[data-view=\"classic\"]').click()");
      for (let i = 0; i < 90; i++) {
        await sleep(1000);
        const ready = await w.webContents.executeJavaScript(
          "!!document.querySelector('#cl-hud-set')");
        if (ready) break;
      }
      await sleep(1500);
      for (const box of ['#cl-on', '#cl-hud-on']) {
        const before = read();
        const pick = (p) => !!(p && p.classic &&
          (box === '#cl-on' ? p.classic.enabled : p.classic.hud && p.classic.hud.enabled));
        const was = pick(before);
        await w.webContents.executeJavaScript(`document.querySelector('${box}').click()`);
        await sleep(1500); // saveProfile — debounce 400 мс
        const now = pick(read());
        say(`${box}: было ${was}, стало ${now}`);
        if (now === was) { failed = true; say('ПРОФИЛЬ НЕ СОХРАНИЛСЯ'); }
      }
      if (!failed) say('профиль сохраняется');
      const log = path.join(tmp, 'profile-save.log');
      if (fs.existsSync(log)) say('журнал ошибок:\n' + fs.readFileSync(log, 'utf8'));
    } catch (e) {
      failed = true;
      say('сбой проверки: ' + (e && e.stack));
    }
    say('папка проверки: ' + tmp);
    app.exit(failed ? 1 : 0);
  });
});

require('../src/main.js');
