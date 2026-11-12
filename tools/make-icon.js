'use strict';
/**
 * Рисует иконку приложения: тёмный квадрат, золотая рамка и три полосы —
 * намёк на панели интерфейса, которые программа и двигает.
 *
 * Пишет icon.png и icon.ico (внутрь .ico кладётся тот же PNG — Windows так
 * умеет с Vista). Внешних библиотек не нужно: PNG собирается вручную.
 *
 *   node tools/make-icon.js
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const S = 256;
const px = Buffer.alloc(S * S * 4); // RGBA

const hex = (h) => [
  parseInt(h.slice(1, 3), 16),
  parseInt(h.slice(3, 5), 16),
  parseInt(h.slice(5, 7), 16),
];

const BG = hex('#1e1f22');
const GOLD = hex('#c9a227');
const BLUE = hex('#5865f2');
const DIM = hex('#3a3d44');

function set(x, y, c, a) {
  if (x < 0 || y < 0 || x >= S || y >= S) return;
  const i = (y * S + x) * 4;
  const al = a === undefined ? 255 : a;
  // простое смешивание с тем, что уже лежит
  const src = al / 255;
  px[i] = Math.round(c[0] * src + px[i] * (1 - src));
  px[i + 1] = Math.round(c[1] * src + px[i + 1] * (1 - src));
  px[i + 2] = Math.round(c[2] * src + px[i + 2] * (1 - src));
  px[i + 3] = Math.max(px[i + 3], al);
}

/** Прямоугольник со скруглением и мягким краем. */
function roundRect(x0, y0, w, h, r, c, stroke) {
  const x1 = x0 + w;
  const y1 = y0 + h;
  for (let y = Math.floor(y0) - 2; y < y1 + 2; y++) {
    for (let x = Math.floor(x0) - 2; x < x1 + 2; x++) {
      // расстояние до скруглённого прямоугольника
      const dx = Math.max(x0 + r - x, 0, x - (x1 - r));
      const dy = Math.max(y0 + r - y, 0, y - (y1 - r));
      const d = Math.hypot(dx, dy) - r;
      let a;
      if (stroke) {
        a = 255 * Math.max(0, Math.min(1, 1 - Math.abs(d + stroke / 2) / (stroke / 2)));
      } else {
        a = 255 * Math.max(0, Math.min(1, 0.5 - d));
      }
      if (a > 0) set(x, y, c, a);
    }
  }
}

roundRect(0, 0, S, S, 48, BG);
roundRect(26, 26, S - 52, S - 52, 28, GOLD, 5);

// три «панели интерфейса» внутри
roundRect(58, 72, 140, 26, 8, BLUE);
roundRect(58, 118, 96, 26, 8, DIM);
roundRect(58, 164, 96, 26, 8, DIM);
// уголок выделенной панели — как в редакторе
roundRect(168, 146, 46, 50, 10, GOLD, 4);

function png(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // без фильтра
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const chunk = (type, data) => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, 'latin1');
    data.copy(out, 8);
    out.writeUInt32BE(crc(Buffer.concat([Buffer.from(type, 'latin1'), data])), 8 + data.length);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // бит на канал
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

let table = null;
function crc(buf) {
  if (!table) {
    table = new Int32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[i] = c;
    }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

const image = png(S, S, px);
const dir = Buffer.alloc(6 + 16);
dir.writeUInt16LE(0, 0);
dir.writeUInt16LE(1, 2); // тип: иконка
dir.writeUInt16LE(1, 4); // одна картинка
dir[6] = 0; // 0 значит 256
dir[7] = 0;
dir[8] = 0; // палитры нет
dir.writeUInt16LE(1, 10); // плоскостей
dir.writeUInt16LE(32, 12); // бит на пиксель
dir.writeUInt32LE(image.length, 14);
dir.writeUInt32LE(22, 18);

const root = path.join(__dirname, '..');
fs.writeFileSync(path.join(root, 'icon.png'), image);
fs.writeFileSync(path.join(root, 'icon.ico'), Buffer.concat([dir, image]));
console.log('icon.png и icon.ico готовы');
