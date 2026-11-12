'use strict';
/**
 * Запущена ли игра.
 *
 * Пока клиент открыт, Windows держит паки занятыми, и запись падает с EBUSY.
 * Беда в том, что падает она на середине: часть паков уже переписана, часть
 * нет — клиент остаётся в смешанном состоянии. Поэтому проверяем до начала
 * работы, а не по факту ошибки.
 */

const fs = require('fs');
const { execFileSync } = require('child_process');

const NAMES = ['aion.bin', 'aion.exe'];

/** @returns {string[]} имена найденных процессов игры */
function gameProcesses() {
  if (process.platform !== 'win32') return [];
  const found = [];
  for (const name of NAMES) {
    try {
      const out = execFileSync('tasklist', ['/FI', `IMAGENAME eq ${name}`, '/NH'], {
        encoding: 'latin1',
        windowsHide: true,
      });
      if (out.toLowerCase().includes(name)) found.push(name);
    } catch (e) {
      // tasklist недоступен — молча считаем, что игра закрыта
    }
  }
  return found;
}

/** Можно ли сейчас переписать файл: открываем на дозапись и сразу закрываем. */
function writable(file) {
  if (!fs.existsSync(file)) return true;
  try {
    fs.closeSync(fs.openSync(file, 'r+'));
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Бросает понятную ошибку, если писать нельзя.
 * @param {string[]} files полные пути, которые собираемся переписать
 */
function assertWritable(files, clientRoot) {
  const game = gameProcesses();
  const isRealClient = clientRoot && fs.existsSync(`${clientRoot}/bin64/aion.bin`);
  if (game.length && isRealClient) {
    throw new Error('Игра запущена — закрой клиент и повтори. Найдены процессы: ' + game.join(', '));
  }
  const busy = files.filter((f) => !writable(f));
  if (!busy.length) return;
  throw new Error(
    'Файлы заняты другой программой. ' +
    'Занято: ' + busy.map((f) => f.replace(/^.*[\\/](?=[^\\/]+[\\/][^\\/]+$)/, '')).join(', ')
  );
}

module.exports = { gameProcesses, writable, assertWritable };
