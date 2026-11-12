'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { relativePath, assertImage, atomicWriteFile, safeFileName } = require('../src/core/safe');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aion-safe-'));
try {
  assert.strictEqual(relativePath(root, 'nested/file'), path.join(root, 'nested', 'file'));
  assert.throws(() => relativePath(root, '../outside'), /escapes/);
  assert.throws(() => safeFileName('../outside'), /invalid/);
  const rgba = Buffer.alloc(2 * 2 * 4);
  assert.strictEqual(assertImage(2, 2, rgba).length, rgba.length);
  assert.throws(() => assertImage(2, 2, Buffer.alloc(3)), /size/);
  const file = path.join(root, 'nested', 'state.json');
  atomicWriteFile(file, 'ok');
  assert.strictEqual(fs.readFileSync(file, 'utf8'), 'ok');
  atomicWriteFile(file, 'updated');
  assert.strictEqual(fs.readFileSync(file, 'utf8'), 'updated');
  console.log('security selftest passed');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
