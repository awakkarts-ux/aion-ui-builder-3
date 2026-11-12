'use strict';
/**
 * Маленький распаковщик deflate (по мотивам puff.c из zlib).
 *
 * Нужен только для одного — перебора смещения ключа по crysystem.dll. Там
 * миллионы попыток разжать мусор, и `zlib.inflateRawSync` на каждую заводит
 * свой нативный объект: на 8-мегабайтной dll официального клиента память
 * кончалась раньше, чем перебор. Этот разжимает в заранее выделенный буфер
 * и бросает попытку на первой же ошибке, почти ничего не создавая.
 *
 * Для обычного чтения паков по-прежнему используется zlib.
 */

const LBASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEXT = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DBASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DEXT = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

/** Один объект-ошибка на всё: создавать новый на каждую попытку дорого. */
const FAIL = new Error('bad deflate');

function huffman(lengths, n) {
  const count = new Int32Array(16);
  const symbol = new Int32Array(n);
  for (let s = 0; s < n; s++) count[lengths[s]]++;
  if (count[0] === n) return { count, symbol };
  let left = 1;
  for (let len = 1; len < 16; len++) {
    left = (left << 1) - count[len];
    if (left < 0) throw FAIL;
  }
  const offs = new Int32Array(16);
  for (let len = 1; len < 15; len++) offs[len + 1] = offs[len] + count[len];
  for (let s = 0; s < n; s++) if (lengths[s]) symbol[offs[lengths[s]]++] = s;
  return { count, symbol };
}

let fixedCodes = null;
function fixed() {
  if (fixedCodes) return fixedCodes;
  const l = new Int32Array(288);
  l.fill(8, 0, 144); l.fill(9, 144, 256); l.fill(7, 256, 280); l.fill(8, 280, 288);
  fixedCodes = { lc: huffman(l, 288), dc: huffman(new Int32Array(30).fill(5), 30) };
  return fixedCodes;
}

/**
 * Разжимает сырой deflate ровно в `size` байт.
 * @param {Buffer} inp
 * @param {number} size ожидаемый размер результата
 * @returns {Buffer|null} null — если поток битый или размер не тот
 */
function inflateRaw(inp, size) {
  const out = Buffer.allocUnsafe(size);
  let pos = 0, bitbuf = 0, bitcnt = 0, n = 0;

  const bits = (need) => {
    let v = bitbuf;
    while (bitcnt < need) {
      if (pos >= inp.length) throw FAIL;
      v |= inp[pos++] << bitcnt;
      bitcnt += 8;
    }
    bitbuf = v >>> need;
    bitcnt -= need;
    return v & ((1 << need) - 1);
  };
  const decode = (h) => {
    let code = 0, first = 0, index = 0;
    for (let len = 1; len < 16; len++) {
      code |= bits(1);
      const c = h.count[len];
      if (code - c < first) return h.symbol[index + (code - first)];
      index += c; first = (first + c) << 1; code <<= 1;
    }
    throw FAIL;
  };
  const codes = (lc, dc) => {
    for (;;) {
      let sym = decode(lc);
      if (sym < 256) {
        if (n >= size) throw FAIL;
        out[n++] = sym;
        continue;
      }
      if (sym === 256) return;
      sym -= 257;
      if (sym >= 29) throw FAIL;
      const len = LBASE[sym] + bits(LEXT[sym]);
      const ds = decode(dc);
      if (ds >= 30) throw FAIL;
      const dist = DBASE[ds] + bits(DEXT[ds]);
      if (dist > n || n + len > size) throw FAIL;
      for (let i = 0; i < len; i++, n++) out[n] = out[n - dist];
    }
  };

  try {
    let last = 0;
    while (!last) {
      last = bits(1);
      const type = bits(2);
      if (type === 0) {
        bitbuf = 0; bitcnt = 0;
        if (pos + 4 > inp.length) throw FAIL;
        const len = inp[pos] | (inp[pos + 1] << 8);
        const nlen = inp[pos + 2] | (inp[pos + 3] << 8);
        if (len !== (~nlen & 0xffff) || pos + 4 + len > inp.length || n + len > size) throw FAIL;
        inp.copy(out, n, pos + 4, pos + 4 + len);
        pos += 4 + len; n += len;
      } else if (type === 1) {
        const f = fixed();
        codes(f.lc, f.dc);
      } else if (type === 2) {
        const nlen = bits(5) + 257, ndist = bits(5) + 1, ncode = bits(4) + 4;
        if (nlen > 286 || ndist > 30) throw FAIL;
        const cl = new Int32Array(19);
        for (let i = 0; i < ncode; i++) cl[ORDER[i]] = bits(3);
        const lencode = huffman(cl, 19);
        const lengths = new Int32Array(nlen + ndist);
        let idx = 0;
        while (idx < nlen + ndist) {
          const sym = decode(lencode);
          if (sym < 16) { lengths[idx++] = sym; continue; }
          let len = 0, rep;
          if (sym === 16) {
            if (!idx) throw FAIL;
            len = lengths[idx - 1];
            rep = 3 + bits(2);
          } else if (sym === 17) rep = 3 + bits(3);
          else rep = 11 + bits(7);
          if (idx + rep > nlen + ndist) throw FAIL;
          while (rep--) lengths[idx++] = len;
        }
        if (!lengths[256]) throw FAIL;
        codes(huffman(lengths.subarray(0, nlen), nlen), huffman(lengths.subarray(nlen), ndist));
      } else {
        throw FAIL;
      }
    }
  } catch (e) {
    if (e === FAIL) return null;
    throw e;
  }
  return n === size ? out : null;
}

module.exports = { inflateRaw };
