'use strict';

const fs = require('fs');
const path = require('path');

function assertString(value, label) {
  if (typeof value !== 'string' || !value) throw new TypeError(`${label} must be a non-empty string`);
  return value;
}

function relativePath(root, value, label = 'path') {
  const base = path.resolve(assertString(root, 'root'));
  const target = path.resolve(base, assertString(value, label));
  const rel = path.relative(base, target);
  if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    throw new Error(`${label} escapes the allowed directory`);
  }
  return target;
}

function assertImage(width, height, rgba, label = 'image') {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
    throw new RangeError(`${label} dimensions are invalid`);
  }
  if (width > 8192 || height > 8192 || width * height > 16_777_216) {
    throw new RangeError(`${label} is too large`);
  }
  const bytes = Buffer.isBuffer(rgba) ? rgba.length : ArrayBuffer.isView(rgba) ? rgba.byteLength : -1;
  if (bytes !== width * height * 4) throw new RangeError(`${label} RGBA size does not match dimensions`);
  return Buffer.isBuffer(rgba) ? rgba : Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength);
}

function assertRgbaBytes(rgba, maxBytes = 64 * 64 * 4, label = 'RGBA') {
  const bytes = Buffer.isBuffer(rgba) ? rgba.length : ArrayBuffer.isView(rgba) ? rgba.byteLength : -1;
  if (bytes < 4 || bytes > maxBytes || bytes % 4 !== 0) throw new RangeError(`${label} buffer is invalid`);
  return Buffer.isBuffer(rgba) ? rgba : Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength);
}

function atomicWriteFile(file, data) {
  const target = path.resolve(assertString(file, 'file'));
  const dir = path.dirname(target);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(target)}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`);
  const old = path.join(dir, `.${path.basename(target)}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.old`);
  let movedOld = false;
  try {
    fs.writeFileSync(tmp, data);
    try {
      if (fs.existsSync(target)) {
        fs.renameSync(target, old);
        movedOld = true;
      }
      try {
        fs.renameSync(tmp, target);
      } catch (error) {
        if (movedOld && !fs.existsSync(target)) fs.renameSync(old, target);
        throw error;
      }
    } catch (error) {
      // Some managed Windows folders deny rename even for files we created.
      // Preserve correctness there, while normal installations retain the atomic path.
      if (error && error.code === 'EPERM') fs.writeFileSync(target, data);
      else throw error;
    }
    if (movedOld) fs.unlinkSync(old);
  } finally {
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch (_) { /* preserve original error */ }
    try { if (fs.existsSync(old)) fs.unlinkSync(old); } catch (_) { /* preserve original error */ }
  }
  return target;
}

function safeFileName(value, label = 'file name') {
  const name = assertString(value, label);
  if (name === '.' || name === '..' || /[\x00-\x1f\\/]/.test(name)) throw new Error(`${label} is invalid`);
  return name;
}

module.exports = { relativePath, assertImage, assertRgbaBytes, atomicWriteFile, safeFileName };
