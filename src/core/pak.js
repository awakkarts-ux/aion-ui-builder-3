'use strict';
/**
 * Чтение и запись игровых архивов .pak.
 *
 * .pak — это ZIP, у которого четырёхбайтовые сигнатуры побитово инвертированы,
 * а у каждой записи зашифрованы ТОЛЬКО первые 32 байта. Шифр — XOR с
 * 32-байтовым куском статической таблицы, вшитой в bin64/crysystem.dll.
 *
 * Смещение куска не случайное:
 *
 *     keyOffset = tableBase + (compressedSize mod 1024)
 *
 * Проверено на 29 600 записях из ui.pak, game.pak, game_hud_s1/s2.pak,
 * preload.pak, skills.pak и l10n/rus/data.pak — расходится ноль. Поэтому
 * перебор нужен ровно один раз, чтобы найти tableBase в конкретной сборке
 * клиента; дальше всё расшифровывается напрямую.
 *
 * Запись умеет оба вида. Обычный ZIP клиент тоже читает (на этом держится
 * проверенная в игре подмена шрифта), но когда мы заменяем штатный пак на его
 * месте, пишем настоящий формат — так файл неотличим от оригинального.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { inflateRaw } = require('./inflate');
const { atomicWriteFile } = require('./safe');

const SIG_EOCD = Buffer.from([0xaf, 0xb4, 0xfa, 0xf9]); // ~0x06054b50
const SIG_CEN = Buffer.from([0xaf, 0xb4, 0xfe, 0xfd]); //  ~0x02014b50
const SIG_LOC = 0xfbfcb4af >>> 0; //                        ~0x04034b50
const SIG_EOCD_PLAIN = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
const SIG_CEN_PLAIN = Buffer.from([0x50, 0x4b, 0x01, 0x02]);

const KEY_PERIOD = 1024;
const KEY_LEN = 32;
/**
 * Где таблица в известных сборках. Если ни одна не подошла — ищем по всему
 * файлу (на 8 МБ это около полуминуты, один раз на dll).
 *   0x21ccd0 — AionEmpire, classic 15.x
 *   0x200430 — официальный Aion Classic 4Game (СНГ)
 */
const TABLE_BASE_HINTS = [0x21ccd0, 0x200430];

let crcTable = null;
function crc32(buf) {
  if (!crcTable) {
    crcTable = new Int32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[i] = c;
    }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

const dllCache = new Map();
function loadDll(dllPath) {
  if (!dllCache.has(dllPath)) dllCache.set(dllPath, fs.readFileSync(dllPath));
  return dllCache.get(dllPath);
}

const MAGICS = ['DDS ', 'OggS'].map((s) => Buffer.from(s))
  .concat([[0x3c], [0xef, 0xbb], [0xff, 0xfe], [0x80], [0x89, 0x50]].map((a) => Buffer.from(a)));

function looksLikeFile(buf) {
  return MAGICS.some((m) => buf.length >= m.length && buf.subarray(0, m.length).equals(m));
}

function xorHead(blob, dll, off) {
  const t = Buffer.from(blob);
  const n = Math.min(KEY_LEN, t.length);
  for (let i = 0; i < n; i++) t[i] ^= dll[off + i];
  return t;
}

function decode(blob, method, uncSize, dll, off) {
  const t = xorHead(blob, dll, off);
  if (method === 0) return t.length >= uncSize ? t.subarray(0, uncSize) : null;
  try {
    const out = zlib.inflateRawSync(t);
    return out.length === uncSize ? out : null;
  } catch (e) {
    return null;
  }
}

/**
 * Список записей архива без расшифровки содержимого.
 * Понимает и игровой .pak, и обычный ZIP — второй нужен, чтобы перечитать пак,
 * собранный нами же.
 */
const TAIL = 70000;

/** Конец центрального каталога в хвосте файла. `tail` — последние байты. */
function findEnd(tail) {
  for (let i = tail.length - 22; i >= 0; i--) {
    for (const [eocd, cen, plain] of [
      [SIG_EOCD, SIG_CEN, false],
      [SIG_EOCD_PLAIN, SIG_CEN_PLAIN, true],
    ]) {
      if (tail[i] === eocd[0] && tail[i + 1] === eocd[1] &&
          tail[i + 2] === eocd[2] && tail[i + 3] === eocd[3]) {
        return { cdSize: tail.readUInt32LE(i + 12), cdOff: tail.readUInt32LE(i + 16), cen, plain };
      }
    }
  }
  throw new Error('не нашёл конец центрального каталога — это не .pak');
}

/** Записи каталога. `cd` начинается со смещения `base` в файле. */
function parseCentral(cd, base, cen) {
  const entries = [];
  let p = 0;
  while (p + 46 <= cd.length) {
    if (!(cd[p] === cen[0] && cd[p + 1] === cen[1] &&
          cd[p + 2] === cen[2] && cd[p + 3] === cen[3])) break;
    const nameLen = cd.readUInt16LE(p + 28);
    const total = 46 + nameLen + cd.readUInt16LE(p + 30) + cd.readUInt16LE(p + 32);
    entries.push({
      name: cd.toString('latin1', p + 46, p + 46 + nameLen),
      method: cd.readUInt16LE(p + 10),
      crc: cd.readUInt32LE(p + 16),
      compSize: cd.readUInt32LE(p + 20),
      uncSize: cd.readUInt32LE(p + 24),
      lhOff: cd.readUInt32LE(p + 42),
      cdOff: base + p,
      cdLen: total,
    });
    p += total;
  }
  return entries;
}

function readDirectory(buf) {
  const end = findEnd(buf.subarray(Math.max(0, buf.length - TAIL)));
  const cd = buf.subarray(end.cdOff, end.cdOff + end.cdSize);
  return { entries: parseCentral(cd, end.cdOff, end.cen), plain: end.plain };
}

/**
 * То же, но читает с диска только хвост и сам каталог. Локализованный
 * textures.pak официального клиента весит 230 МБ — грузить его целиком,
 * чтобы узнать имена и CRC, незачем.
 */
function listPak(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const tail = Buffer.alloc(Math.min(size, TAIL));
    fs.readSync(fd, tail, 0, tail.length, size - tail.length);
    const end = findEnd(tail);
    const cd = Buffer.alloc(end.cdSize);
    fs.readSync(fd, cd, 0, end.cdSize, end.cdOff);
    return { entries: parseCentral(cd, end.cdOff, end.cen), plain: end.plain };
  } finally {
    fs.closeSync(fd);
  }
}

function rawPayload(buf, e) {
  const start = e.lhOff + 30 + buf.readUInt16LE(e.lhOff + 26) + buf.readUInt16LE(e.lhOff + 28);
  return buf.subarray(start, start + e.compSize);
}

/**
 * Подходит ли смещение ключа к записи. Проверяем по CRC из центрального
 * каталога, а не только по размеру: на крошечной записи мусор иногда
 * разжимается в нужную длину, и раньше это давало ложную базу — дальше весь
 * пак расшифровывался чужим ключом.
 */
function fits(blob, e, dll, off, work) {
  const n = Math.min(KEY_LEN, blob.length);
  for (let i = 0; i < n; i++) work[i] = blob[i] ^ dll[off + i];
  let data;
  if (e.method === 0) data = work.length >= e.uncSize ? work.subarray(0, e.uncSize) : null;
  else data = inflateRaw(work, e.uncSize);
  return !!data && crc32(data) === e.crc;
}

/**
 * Одноразовый поиск начала таблицы. Пробы — несколько мелких записей с разным
 * (compSize mod 1024), чтобы задеть разные куски таблицы; база принимается,
 * только если сошлись все.
 */
const baseCache = new Map();
/**
 * @param {Buffer|function} src весь файл пака или функция «запись -> её сырые
 *   байты» (когда пак читается с диска кусками)
 */
function findTableBase(src, entries, dll, dllPath) {
  if (baseCache.has(dllPath)) return baseCache.get(dllPath);
  const rawOf = typeof src === 'function' ? src : (e) => rawPayload(src, e);
  const seen = new Set();
  const probes = [];
  for (const e of entries.filter((x) => x.compSize >= 16).sort((a, b) => a.compSize - b.compSize)) {
    if (seen.has(e.compSize % KEY_PERIOD)) continue;
    seen.add(e.compSize % KEY_PERIOD);
    const blob = rawOf(e);
    probes.push({ e, blob, work: Buffer.from(blob), shift: e.compSize % KEY_PERIOD });
    if (probes.length >= 3) break;
  }
  if (!probes.length) throw new Error('в архиве нет ни одной непустой записи');

  const ok = (base) => probes.every((p) => fits(p.blob, p.e, dll, base + p.shift, p.work));
  const last = dll.length - KEY_PERIOD - KEY_LEN;
  const found = (base) => { baseCache.set(dllPath, base); return base; };

  for (const hint of TABLE_BASE_HINTS) if (hint <= last && ok(hint)) return found(hint);
  // сначала первая проба (дёшево), остальные — только на её кандидатах
  const [first] = probes;
  for (let base = 0; base <= last; base++) {
    if (fits(first.blob, first.e, dll, base + first.shift, first.work) && ok(base)) return found(base);
  }
  throw new Error('не нашёл таблицу ключей в ' + path.basename(dllPath));
}

/**
 * Распаковывает архив целиком.
 * @returns {Map<string, Buffer>} имя записи -> содержимое
 */
function readPak(pakPath, dllPath) {
  const buf = fs.readFileSync(pakPath);
  const { entries, plain } = readDirectory(buf);
  const out = new Map();

  if (plain) {
    for (const e of entries) {
      const raw = rawPayload(buf, e);
      out.set(e.name, e.method === 0 ? Buffer.from(raw) : zlib.inflateRawSync(raw));
    }
    return out;
  }

  const dll = loadDll(dllPath);
  const base = findTableBase(buf, entries, dll, dllPath);
  for (const e of entries) {
    if (e.compSize === 0) { out.set(e.name, Buffer.alloc(0)); continue; }
    const off = base + (e.compSize % KEY_PERIOD);
    const data = decode(rawPayload(buf, e), e.method, e.uncSize, dll, off);
    if (!data) throw new Error('не расшифровал ' + e.name + ' в ' + path.basename(pakPath));
    out.set(e.name, data);
  }
  return out;
}

/**
 * Достаёт из архива только названные записи.
 * Для `data.pak` на 22 тысячи файлов это полторы секунды разницы и сотня
 * мегабайт памяти, которые незачем тратить ради пяти диалогов.
 * @param {string[]} names
 * @returns {Map<string, Buffer>}
 */
function readSome(pakPath, dllPath, names) {
  const want = new Set(names);
  // С диска — только каталог и нужные записи: паки бывают по 100–230 МБ.
  const { entries, plain } = listPak(pakPath);
  const out = new Map();
  const fd = fs.openSync(pakPath, 'r');
  try {
    const payload = (e) => {
      const head = Buffer.alloc(30);
      fs.readSync(fd, head, 0, 30, e.lhOff);
      const start = e.lhOff + 30 + head.readUInt16LE(26) + head.readUInt16LE(28);
      const raw = Buffer.alloc(e.compSize);
      fs.readSync(fd, raw, 0, e.compSize, start);
      return raw;
    };
    let dll = null;
    let base = 0;
    if (!plain) {
      dll = loadDll(dllPath);
      base = findTableBase(payload, entries, dll, dllPath);
    }
    for (const e of entries) {
      if (!want.has(e.name) || e.compSize === 0) continue;
      const raw = payload(e);
      const data = plain
        ? (e.method === 0 ? raw : zlib.inflateRawSync(raw))
        : decode(raw, e.method, e.uncSize, dll, base + (e.compSize % KEY_PERIOD));
      if (!data) throw new Error('не расшифровал ' + e.name);
      out.set(e.name, data);
    }
  } finally {
    fs.closeSync(fd);
  }
  return out;
}

/**
 * Записи как они лежат в архиве — сжатые, но уже без шифрования головы.
 * Нужно, чтобы переложить их в обычный ZIP, не разжимая: у официального
 * клиента это сотни мегабайт атласов, пережимать их заново — минуты.
 * @param {string[]} names
 * @returns {Map<string, {method: number, crc: number, uncSize: number, payload: Buffer}>}
 */
function readRaw(pakPath, dllPath, names) {
  const want = new Set(names);
  const { entries, plain } = listPak(pakPath);
  const out = new Map();
  const fd = fs.openSync(pakPath, 'r');
  try {
    const payload = (e) => {
      const head = Buffer.alloc(30);
      fs.readSync(fd, head, 0, 30, e.lhOff);
      const start = e.lhOff + 30 + head.readUInt16LE(26) + head.readUInt16LE(28);
      const raw = Buffer.alloc(e.compSize);
      fs.readSync(fd, raw, 0, e.compSize, start);
      return raw;
    };
    let dll = null;
    let base = 0;
    if (!plain) {
      dll = loadDll(dllPath);
      base = findTableBase(payload, entries, dll, dllPath);
    }
    for (const e of entries) {
      if (!want.has(e.name)) continue;
      let raw = e.compSize ? payload(e) : Buffer.alloc(0);
      if (!plain && raw.length) raw = xorHead(raw, dll, base + (e.compSize % KEY_PERIOD));
      out.set(e.name, { method: e.method, crc: e.crc, uncSize: e.uncSize, payload: raw });
    }
  } finally {
    fs.closeSync(fd);
  }
  return out;
}

/**
 * Собирает архив.
 * @param {Map<string, Buffer|{method: number, crc: number, uncSize: number, payload: Buffer}>} files
 *   значение — содержимое или уже сжатая запись из readRaw (кладётся как есть)
 * @param {{encrypt?: boolean, dllPath?: string}} opts
 *   encrypt — писать в родном формате клиента (инвертированные сигнатуры и
 *   зашифрованные первые 32 байта). Нужен dllPath.
 */
function writePak(pakPath, files, opts) {
  const o = opts || {};
  const encrypt = !!o.encrypt;
  let dll = null;
  let base = 0;
  if (encrypt) {
    if (!o.dllPath) throw new Error('для шифрования нужен путь к crysystem.dll');
    dll = loadDll(o.dllPath);
    // Базу не угадываем: у разных сборок она разная, а чужой ключ молча
    // испортил бы пак. Она известна после любого чтения пака с этой dll.
    if (!baseCache.has(o.dllPath)) {
      throw new Error('база ключа ещё не найдена — сначала прочитай любой пак этого клиента');
    }
    base = baseCache.get(o.dllPath);
  }

  const inv = (v) => (~v) >>> 0;
  const sigLoc = encrypt ? SIG_LOC : 0x04034b50;
  const sigCen = encrypt ? inv(0x02014b50) : 0x02014b50;
  const sigEnd = encrypt ? inv(0x06054b50) : 0x06054b50;

  const locals = [];
  const central = [];
  let offset = 0;

  for (const [name, data] of files) {
    const nameBuf = Buffer.from(name.replace(/\\/g, '/'), 'latin1');
    let payload, method, crc, uncSize;
    if (Buffer.isBuffer(data)) {
      const deflated = zlib.deflateRawSync(data, { level: 9 });
      const store = deflated.length >= data.length;
      payload = store ? Buffer.from(data) : deflated;
      method = store ? 0 : 8;
      crc = crc32(data);
      uncSize = data.length;
    } else {
      ({ payload, method, crc, uncSize } = data);
    }
    if (encrypt && payload.length) payload = xorHead(payload, dll, base + (payload.length % KEY_PERIOD));

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(sigLoc, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0, 6);
    lh.writeUInt16LE(method, 8);
    lh.writeUInt16LE(0, 10);
    lh.writeUInt16LE(0x21, 12); // дата 1980-01-01, как в штатных паках
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(payload.length, 18);
    lh.writeUInt32LE(uncSize, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    lh.writeUInt16LE(0, 28);
    locals.push(lh, nameBuf, payload);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(sigCen, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0, 8);
    ch.writeUInt16LE(method, 10);
    ch.writeUInt16LE(0, 12);
    ch.writeUInt16LE(0x21, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(payload.length, 20);
    ch.writeUInt32LE(uncSize, 24);
    ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt32LE(offset, 42);
    central.push(ch, nameBuf);

    offset += 30 + nameBuf.length + payload.length;
  }

  const cd = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(sigEnd, 0);
  eocd.writeUInt16LE(files.size, 8);
  eocd.writeUInt16LE(files.size, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);

  atomicWriteFile(pakPath, Buffer.concat([...locals, cd, eocd]));
}

/**
 * Переписывает в архиве только названные записи, остальные копирует байтами.
 *
 * Для `l10n\<язык>\data\data.pak` это принципиально: там 22 тысячи записей и
 * 119 МБ, пересобирать всё ради трёх диалогов — и долго, и незачем трогать то,
 * что трогать не просили. Нетронутые записи переезжают как есть, вместе с их
 * шифрованием, так что и ключ для них не нужен.
 *
 * @param {string} srcPath   откуда берём (обычно резервная копия)
 * @param {string} outPath   куда пишем
 * @param {Map<string, Buffer>} changes имя записи -> новое содержимое
 * @param {string} dllPath   нужен, чтобы зашифровать голову новых записей
 * @returns {number} сколько записей заменили
 */
function patchPak(srcPath, outPath, changes, dllPath) {
  const buf = fs.readFileSync(srcPath);
  const { entries, plain } = readDirectory(buf);
  if (!entries.length) throw new Error('пустой архив: ' + path.basename(srcPath));

  let dll = null;
  let base = 0;
  if (!plain) {
    dll = loadDll(dllPath);
    base = findTableBase(buf, entries, dll, dllPath);
  }

  const order = entries.slice().sort((a, b) => a.lhOff - b.lhOff);
  const parts = [];
  const moved = new Map(); // имя -> новое смещение локальной записи
  const rebuilt = new Map(); // имя -> {method, compSize, uncSize, crc}
  let offset = 0;
  let hits = 0;

  for (const e of order) {
    const nameLen = buf.readUInt16LE(e.lhOff + 26);
    const extraLen = buf.readUInt16LE(e.lhOff + 28);
    const headLen = 30 + nameLen + extraLen;
    moved.set(e.name, offset);

    if (!changes.has(e.name)) {
      const block = buf.subarray(e.lhOff, e.lhOff + headLen + e.compSize);
      parts.push(block);
      offset += block.length;
      continue;
    }

    hits++;
    const data = changes.get(e.name);
    const deflated = zlib.deflateRawSync(data, { level: 9 });
    const store = deflated.length >= data.length;
    let payload = store ? Buffer.from(data) : deflated;
    const method = store ? 0 : 8;
    const crc = crc32(data);
    if (!plain) payload = xorHead(payload, dll, base + (payload.length % KEY_PERIOD));

    const lh = Buffer.from(buf.subarray(e.lhOff, e.lhOff + headLen)); // имя и extra как были
    lh.writeUInt16LE(method, 8);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(payload.length, 18);
    lh.writeUInt32LE(data.length, 22);
    parts.push(lh, payload);
    offset += lh.length + payload.length;
    rebuilt.set(e.name, { method, compSize: payload.length, uncSize: data.length, crc });
  }

  // центральный каталог: переносим исходные записи, правя смещения и размеры
  const cd = [];
  for (const e of entries) {
    const rec = Buffer.from(buf.subarray(e.cdOff, e.cdOff + e.cdLen));
    rec.writeUInt32LE(moved.get(e.name), 42);
    const r = rebuilt.get(e.name);
    if (r) {
      rec.writeUInt16LE(r.method, 10);
      rec.writeUInt32LE(r.crc, 16);
      rec.writeUInt32LE(r.compSize, 20);
      rec.writeUInt32LE(r.uncSize, 24);
    }
    cd.push(rec);
  }
  const cdBuf = Buffer.concat(cd);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(plain ? 0x06054b50 : ((~0x06054b50) >>> 0), 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);

  atomicWriteFile(outPath, Buffer.concat([...parts, cdBuf, eocd]));
  return hits;
}

module.exports = { readPak, readSome, readRaw, writePak, patchPak, readDirectory, listPak, crc32,
                   findTableBase, loadDll };
