'use strict';
/**
 * Несжатые DDS формата A8R8G8B8 — в них лежат и атласы интерфейса, и иконки
 * умений (64x64, 128 байт заголовка + BGRA построчно).
 */

const HEADER = 128;

function readHeader(buf) {
  if (buf.length < HEADER || buf.toString('latin1', 0, 4) !== 'DDS ') {
    throw new Error('это не DDS');
  }
  return {
    height: buf.readUInt32LE(12),
    width: buf.readUInt32LE(16),
    fourCC: buf.toString('latin1', 84, 88),
    bits: buf.readUInt32LE(88),
  };
}

/** Распаковывает 4x4 блок цвета DXT в палитру из четырёх RGB. */
function dxtColors(buf, off, hasAlphaBlock) {
  const c0 = buf.readUInt16LE(off);
  const c1 = buf.readUInt16LE(off + 2);
  const rgb = (c) => [
    ((c >> 11) & 0x1f) * 255 / 31,
    ((c >> 5) & 0x3f) * 255 / 63,
    (c & 0x1f) * 255 / 31,
  ].map(Math.round);
  const a = rgb(c0);
  const b = rgb(c1);
  const mix = (p, q, w) => [0, 1, 2].map((i) => Math.round((p[i] * w + q[i] * (1 - w))));
  // без отдельного альфа-блока c0 <= c1 означает прозрачный четвёртый цвет
  if (hasAlphaBlock || c0 > c1) {
    return [a, b, mix(a, b, 2 / 3), mix(a, b, 1 / 3), 255];
  }
  return [a, b, mix(a, b, 1 / 2), [0, 0, 0], 0];
}

/** DXT1/DXT3/DXT5 -> RGBA. */
function decodeDxt(buf, width, height, fourCC) {
  const rgba = Buffer.alloc(width * height * 4);
  const blockSize = fourCC === 'DXT1' ? 8 : 16;
  const bw = Math.max(1, (width + 3) >> 2);
  const bh = Math.max(1, (height + 3) >> 2);
  let off = HEADER;
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++, off += blockSize) {
      const colorOff = fourCC === 'DXT1' ? off : off + 8;
      const pal = dxtColors(buf, colorOff, fourCC !== 'DXT1');
      const bits = buf.readUInt32LE(colorOff + 4);

      // альфа
      let alphaAt;
      if (fourCC === 'DXT3') {
        alphaAt = (i) => {
          const nib = buf[off + (i >> 1)];
          return ((i & 1 ? nib >> 4 : nib & 0x0f) * 255) / 15;
        };
      } else if (fourCC === 'DXT5') {
        const a0 = buf[off];
        const a1 = buf[off + 1];
        const table = [a0, a1];
        for (let k = 1; k <= (a0 > a1 ? 5 : 3); k++) {
          table.push(a0 > a1
            ? ((6 - k + 1) * a0 + k * a1) / 7
            : ((4 - k + 1) * a0 + k * a1) / 5);
        }
        if (a0 <= a1) { table.push(0, 255); }
        alphaAt = (i) => {
          const bitPos = i * 3;
          const byteAt = off + 2 + (bitPos >> 3);
          const v = (buf[byteAt] | (buf[byteAt + 1] << 8) | (buf[byteAt + 2] << 16)) >> (bitPos & 7);
          return table[v & 7];
        };
      } else {
        alphaAt = () => 255;
      }

      for (let i = 0; i < 16; i++) {
        const x = bx * 4 + (i & 3);
        const y = by * 4 + (i >> 2);
        if (x >= width || y >= height) continue;
        const idx = (bits >> (i * 2)) & 3;
        const c = pal[idx];
        const d = (y * width + x) * 4;
        rgba[d] = c[0];
        rgba[d + 1] = c[1];
        rgba[d + 2] = c[2];
        rgba[d + 3] = fourCC === 'DXT1' ? (idx === 3 ? pal[4] : 255) : Math.round(alphaAt(i));
      }
    }
  }
  return rgba;
}

/** DDS -> {width, height, rgba} с порядком байт, который понимает canvas. */
function toRgba(buf) {
  const h = readHeader(buf);
  const cc = h.fourCC.replace(/\0/g, '');
  if (cc === 'DXT1' || cc === 'DXT3' || cc === 'DXT5') {
    return { width: h.width, height: h.height, rgba: decodeDxt(buf, h.width, h.height, cc) };
  }
  if (h.bits !== 32) throw new Error('не умею такой DDS: ' + (cc || h.bits + ' бит'));
  const n = h.width * h.height;
  const rgba = Buffer.alloc(n * 4);
  for (let i = 0; i < n; i++) {
    const s = HEADER + i * 4;
    rgba[i * 4] = buf[s + 2]; // R
    rgba[i * 4 + 1] = buf[s + 1]; // G
    rgba[i * 4 + 2] = buf[s]; // B
    rgba[i * 4 + 3] = buf[s + 3]; // A
  }
  return { width: h.width, height: h.height, rgba };
}

/** {width, height, rgba} -> DDS A8R8G8B8. */
function fromRgba(width, height, rgba) {
  const buf = Buffer.alloc(HEADER + width * height * 4);
  buf.write('DDS ', 0, 'latin1');
  buf.writeUInt32LE(124, 4); // размер заголовка
  buf.writeUInt32LE(0x1 | 0x2 | 0x4 | 0x1000 | 0x8, 8); // caps|height|width|pixelformat|pitch
  buf.writeUInt32LE(height, 12);
  buf.writeUInt32LE(width, 16);
  buf.writeUInt32LE(width * 4, 20); // шаг строки
  buf.writeUInt32LE(1, 28); // уровней мипмапов
  buf.writeUInt32LE(32, 76); // размер описания пикселя
  buf.writeUInt32LE(0x41, 80); // RGB | ALPHAPIXELS
  buf.writeUInt32LE(32, 88);
  buf.writeUInt32LE(0x00ff0000, 92);
  buf.writeUInt32LE(0x0000ff00, 96);
  buf.writeUInt32LE(0x000000ff, 100);
  buf.writeUInt32LE(0xff000000, 104);
  buf.writeUInt32LE(0x1000, 108); // DDSCAPS_TEXTURE
  for (let i = 0; i < width * height; i++) {
    const d = HEADER + i * 4;
    buf[d] = rgba[i * 4 + 2]; // B
    buf[d + 1] = rgba[i * 4 + 1]; // G
    buf[d + 2] = rgba[i * 4]; // R
    buf[d + 3] = rgba[i * 4 + 3]; // A
  }
  return buf;
}

module.exports = { readHeader, toRgba, fromRgba, HEADER };
