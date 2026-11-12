'use strict';
/**
 * Бинарный XML клиента Aion (файлы из data/ui/*.pak).
 *
 * Разобранный формат:
 *
 *   byte   0x80                 — метка формата
 *   varint длина таблицы строк в байтах
 *   ...    таблица строк: UTF-16LE, каждая строка заканчивается 0x00 0x00,
 *          первая — пустая. Смещения считаются в СИМВОЛАХ от начала таблицы.
 *   ...    дерево узлов, один корень
 *
 * Узел:
 *   varint смещение имени
 *   varint флаги
 *   varint смещение текста      — только если флаги & 1
 *   varint число атрибутов      — только если флаги & 2, дальше пары
 *          (смещение ключа, смещение значения)
 *   varint число детей          — только если флаги & 4, дальше сами узлы
 *
 * Проверено: все 36 бинарных XML из ui.pak, game.pak, game_hud_s1/s2.pak и
 * preload.pak разбираются без единого лишнего байта.
 */

const MAGIC = 0x80;
const F_TEXT = 0x01;
const F_ATTRS = 0x02;
const F_KIDS = 0x04;

function readVarint(buf, st) {
  let r = 0;
  let s = 0;
  for (;;) {
    const c = buf[st.p++];
    r |= (c & 0x7f) << s;
    if ((c & 0x80) === 0) return r >>> 0;
    s += 7;
  }
}

function writeVarint(out, v) {
  for (;;) {
    const c = v & 0x7f;
    v >>>= 7;
    if (v !== 0) out.push(c | 0x80);
    else {
      out.push(c);
      return;
    }
  }
}

function isBxml(buf) {
  return buf.length > 4 && buf[0] === MAGIC;
}

/** @returns {{root: Node, strings: string[]}} */
function parse(buf) {
  if (!isBxml(buf)) throw new Error('не бинарный XML: нет метки 0x80');
  const st = { p: 1 };
  const tableLen = readVarint(buf, st);
  const tableStart = st.p;
  const tableEnd = tableStart + tableLen;
  if (tableEnd > buf.length) throw new Error('таблица строк выходит за файл');

  // смещение в символах -> строка, плюс порядок для обратной записи
  const byOffset = new Map();
  const strings = [];
  let off = tableStart;
  while (off < tableEnd) {
    const start = off;
    while (off + 1 < tableEnd && !(buf[off] === 0 && buf[off + 1] === 0)) off += 2;
    const s = buf.toString('utf16le', start, off);
    byOffset.set((start - tableStart) / 2, s);
    strings.push(s);
    off += 2;
  }

  st.p = tableEnd;
  const str = (o) => {
    if (!byOffset.has(o)) throw new Error('смещение ' + o + ' не начало строки');
    return byOffset.get(o);
  };

  function node() {
    const name = str(readVarint(buf, st));
    const flags = readVarint(buf, st);
    const n = new Node(name);
    if (flags & F_TEXT) n.text = str(readVarint(buf, st));
    if (flags & F_ATTRS) {
      const cnt = readVarint(buf, st);
      for (let i = 0; i < cnt; i++) {
        const k = str(readVarint(buf, st));
        const v = str(readVarint(buf, st));
        n.attrs.set(k, v);
      }
    }
    if (flags & F_KIDS) {
      const cnt = readVarint(buf, st);
      for (let i = 0; i < cnt; i++) n.kids.push(node());
    }
    return n;
  }

  const root = node();
  if (st.p !== buf.length) {
    throw new Error('после дерева осталось ' + (buf.length - st.p) + ' байт');
  }
  return { root, strings };
}

/**
 * Собирает файл обратно.
 *
 * Исходный порядок строк сохраняем, новые дописываем в конец: так правка
 * одного числа даёт минимальную разницу с оригиналом, а не перетасовку всей
 * таблицы. Неиспользованные строки остаются в таблице — клиенту они не мешают,
 * он ходит по смещениям из дерева.
 */
function serialize(root, baseStrings) {
  const list = [];
  const offsetOf = new Map(); // строка -> смещение в символах
  let chars = 0;

  const intern = (s) => {
    if (offsetOf.has(s)) return offsetOf.get(s);
    offsetOf.set(s, chars);
    list.push(s);
    chars += s.length + 1;
    return offsetOf.get(s);
  };

  intern(''); // первая строка всегда пустая
  if (baseStrings) for (const s of baseStrings) intern(s);

  const body = [];
  (function emit(n) {
    let flags = 0;
    if (n.text) flags |= F_TEXT;
    if (n.attrs.size) flags |= F_ATTRS;
    if (n.kids.length) flags |= F_KIDS;
    writeVarint(body, intern(n.name));
    writeVarint(body, flags);
    if (flags & F_TEXT) writeVarint(body, intern(n.text));
    if (flags & F_ATTRS) {
      writeVarint(body, n.attrs.size);
      for (const [k, v] of n.attrs) {
        writeVarint(body, intern(k));
        writeVarint(body, intern(v));
      }
    }
    if (flags & F_KIDS) {
      writeVarint(body, n.kids.length);
      for (const k of n.kids) emit(k);
    }
  })(root);

  const table = Buffer.alloc(chars * 2);
  let tp = 0;
  for (const s of list) {
    tp += table.write(s, tp, 'utf16le');
    tp += 2; // нулевой символ-разделитель
  }

  const head = [MAGIC];
  writeVarint(head, table.length);
  return Buffer.concat([Buffer.from(head), table, Buffer.from(body)]);
}

class Node {
  constructor(name) {
    this.name = name;
    this.text = '';
    this.attrs = new Map();
    this.kids = [];
  }

  /** Первый потомок с таким name-атрибутом, на любой глубине. */
  find(nameAttr) {
    if (this.attrs.get('name') === nameAttr) return this;
    for (const k of this.kids) {
      const hit = k.find(nameAttr);
      if (hit) return hit;
    }
    return null;
  }

  /** Все узлы поддерева, включая себя. */
  *walk() {
    yield this;
    for (const k of this.kids) yield* k.walk();
  }

  /** frame="x,y,w,h" -> {x,y,w,h} или null. */
  getFrame() {
    const f = this.attrs.get('frame');
    if (!f) return null;
    const p = f.split(',').map((s) => parseInt(s, 10));
    if (p.length !== 4 || p.some(Number.isNaN)) return null;
    return { x: p[0], y: p[1], w: p[2], h: p[3] };
  }

  setFrame(fr) {
    this.attrs.set('frame', [fr.x, fr.y, fr.w, fr.h].join(','));
  }

  /** flag="a;b;c" как массив. */
  getFlags() {
    const f = this.attrs.get('flag');
    return f ? f.split(';').filter(Boolean) : [];
  }

  setFlags(arr) {
    if (arr.length) this.attrs.set('flag', arr.join(';'));
    else this.attrs.delete('flag');
  }

  addFlag(name) {
    const f = this.getFlags();
    if (!f.includes(name)) {
      f.push(name);
      this.setFlags(f);
    }
  }

  removeFlag(name) {
    this.setFlags(this.getFlags().filter((x) => x !== name));
  }

  /** Читаемый XML — для отладки и для показа пользователю. */
  toXml(indent = 0) {
    const pad = '  '.repeat(indent);
    const attrs = [...this.attrs]
      .map(([k, v]) => ` ${k}="${String(v).replace(/"/g, '&quot;')}"`)
      .join('');
    if (!this.kids.length && !this.text) return `${pad}<${this.name}${attrs}/>`;
    const inner = this.kids.map((k) => k.toXml(indent + 1)).join('\n');
    const text = this.text ? pad + '  ' + this.text.trim() : '';
    return (
      `${pad}<${this.name}${attrs}>\n` +
      [text, inner].filter(Boolean).join('\n') +
      `\n${pad}</${this.name}>`
    );
  }
}

module.exports = { parse, serialize, isBxml, Node };
