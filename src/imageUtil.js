'use strict';

/**
 * 图片格式探测与尺寸解析（零依赖）
 * 支持 PNG / JPEG / GIF / WebP：仅读取文件头，不解码像素。
 * 用途：上传前校验（魔数 + 尺寸），避免把非图片或超大图传给上游。
 */

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** MIME → 扩展名（上传落盘用） */
const MIME_EXT = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp'
};

/** 扩展名 → MIME（后端内联 base64 时用） */
const EXT_MIME = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp'
};

/**
 * 根据魔数探测图片格式
 * @param {Buffer} buf
 * @returns {'png'|'jpeg'|'gif'|'webp'|null}
 */
function detectFormat(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  if (buf.subarray(0, 8).equals(PNG_SIG)) return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  const head6 = buf.subarray(0, 6).toString('ascii');
  if (head6 === 'GIF87a' || head6 === 'GIF89a') return 'gif';
  if (buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return 'webp';
  return null;
}

/**
 * 解析图片像素尺寸（不加载到内存解码）
 * @param {Buffer} buf
 * @param {string} format detectFormat 的返回值
 * @returns {{width:number, height:number}|null}
 */
function imageSize(buf, format) {
  try {
    if (format === 'png') {
      if (buf.length < 24) return null;
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    }
    if (format === 'gif') {
      if (buf.length < 10) return null;
      return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
    }
    if (format === 'jpeg') {
      // 扫描 JPEG 段标记，找到 SOFn（C0-CF，排除 C4=DHT/C8=JPG/C10..C15 其他非 SOF）读取高宽
      let off = 2;
      while (off + 9 < buf.length) {
        if (buf[off] !== 0xff) { off++; continue; }
        const marker = buf[off + 1];
        // 独立标记（无长度字段）：SOI/EOI/TEM/RSTn
        if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
          off += 2;
          continue;
        }
        if (marker === 0xff) { off++; continue; } // 填充字节
        const segLen = buf.readUInt16BE(off + 2);
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          if (off + 9 > buf.length) return null;
          return { height: buf.readUInt16BE(off + 5), width: buf.readUInt16BE(off + 7) };
        }
        if (segLen < 2) return null;
        off += 2 + segLen;
      }
      return null;
    }
    if (format === 'webp') {
      const chunk = buf.subarray(12, 16).toString('ascii');
      if (chunk === 'VP8X') {
        // 扩展格式：24-bit LE 宽/高（各存 值-1）
        if (buf.length < 30) return null;
        return { width: buf.readUIntLE(24, 3) + 1, height: buf.readUIntLE(27, 3) + 1 };
      }
      if (chunk === 'VP8 ') {
        // 有损：帧标签 3 字节 + 起始码 9D 01 2A 之后是 14-bit 宽/高（LE）
        if (buf.length < 30) return null;
        return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
      }
      if (chunk === 'VP8L') {
        // 无损：0x2F 之后 32-bit LE：14bit 宽-1 | 14bit 高-1 | 1bit alpha | 3bit version
        if (buf.length < 25) return null;
        const bits = buf.readUIntLE(21, 4);
        return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
      }
      return null;
    }
  } catch (_) {
    return null;
  }
  return null;
}

/**
 * 解析 data URL（图片）
 * @param {string} dataUrl
 * @returns {{mime:string, format:string, buffer:Buffer}|{error:string}}
 */
function parseImageDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string' || !dataUrl) return { error: '图片数据为空' };
  const m = /^data:(image\/(?:png|jpeg|jpg|gif|webp));base64,([A-Za-z0-9+/=\s]+)$/i.exec(dataUrl.trim());
  if (!m) return { error: '仅支持 PNG / JPEG / GIF / WebP 格式的 base64 图片' };
  const mime = m[1].toLowerCase();
  let buffer;
  try {
    buffer = Buffer.from(m[2].replace(/\s+/g, ''), 'base64');
  } catch (_) {
    return { error: 'base64 解码失败' };
  }
  // Buffer.from 对非法字符静默截断，用魔数二次确认
  const format = detectFormat(buffer);
  if (!format) return { error: '图片文件头校验失败（可能不是有效图片或已损坏）' };
  return { mime, format, buffer };
}

module.exports = { detectFormat, imageSize, parseImageDataUrl, MIME_EXT, EXT_MIME };
