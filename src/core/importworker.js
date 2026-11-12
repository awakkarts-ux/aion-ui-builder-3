'use strict';
/**
 * Импорт официального клиента в отдельном потоке: он читает сотни
 * мегабайт, и окно программы на это время не должно замирать.
 * workerData: { src, dest, clientRoot, backupDir }.
 */

const { parentPort, workerData } = require('worker_threads');
const donorimport = require('./donorimport');
const { Client } = require('./client');

try {
  const w = workerData;
  const client = w.clientRoot ? new Client(w.clientRoot, w.backupDir) : null;
  const info = donorimport.run({
    src: w.src,
    dest: w.dest,
    client: client && client.check().ok ? client : null,
    progress: (msg) => parentPort.postMessage({ progress: msg }),
  });
  parentPort.postMessage({ done: info });
} catch (e) {
  parentPort.postMessage({ error: e && e.message ? e.message : String(e) });
}
