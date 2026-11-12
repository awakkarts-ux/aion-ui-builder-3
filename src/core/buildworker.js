'use strict';
/**
 * Сборка в отдельном потоке: она читает и пишет сотни мегабайт, и пока шла в
 * главном процессе, окно программы замирало — ни индикатора, ни перерисовки.
 *
 * Поток живёт между сборками: внутри кэши (план перекрашенных карт
 * официального клиента считается минуту-другую, открытые паки донора), и
 * пересчитывать их на каждую сборку незачем. Главный процесс гасит поток,
 * когда кэши устаревают (новый импорт официального клиента).
 *
 * Сообщения: { id, clientRoot, backupDir, profile } ->
 *   { id, progress: строка журнала } … { id, done: { report } } | { id, error }
 */

const { parentPort } = require('worker_threads');
const build = require('./build');
const { Client } = require('./client');

let client = null;

parentPort.on('message', (m) => {
  try {
    if (!client || client.root !== m.clientRoot || client.backupDir !== m.backupDir) {
      client = new Client(m.clientRoot, m.backupDir);
    }
    const report = build.apply(client, m.profile, (msg) => parentPort.postMessage({ id: m.id, progress: String(msg) }));
    parentPort.postMessage({ id: m.id, done: { report } });
  } catch (e) {
    parentPort.postMessage({ id: m.id, error: e && e.message ? e.message : String(e) });
  }
});
