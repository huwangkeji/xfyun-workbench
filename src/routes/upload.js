'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const imageUtil = require('../imageUtil');
const configService = require('../configService');
const asyncHandler = require('../asyncHandler');
const router = express.Router();

/**
 * 图片上传（零依赖，base64 JSON 上报，落盘 public/uploads）
 *
 * POST /api/upload
 * body: { images: [{ name, dataUrl }] }  （兼容单张：{ name, dataUrl }）
 * 返回: { ok, data: { files: [{ url, name, size, width, height, mime }] } }
 *
 * 约束（与上游星火 MaaS 图片理解对齐，实测 error code=10045 分辨率限制 [50x50, 6000x6000]）：
 *   - 格式：PNG / JPEG / GIF / WebP（魔数校验，不信任声明的 MIME）
 *   - 单张 ≤ 8MB，一次最多 9 张
 *   - 分辨率 50x50 ~ 6000x6000
 */

const UPLOAD_ROOT = process.env.XFYUN_UPLOAD_DIR || path.join(__dirname, '..', '..', 'public', 'uploads');
const MAX_FILE_BYTES = 8 * 1024 * 1024; // 单张 8MB（base64 解码后）
const MAX_FILES = 9;                    // 一次最多 9 张
const MIN_DIM = 50;                     // 上游下限
const MAX_DIM = 6000;                   // 上游上限

/** 当天上传目录名：YYYY-MM-DD */
function todayFolder() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

router.post('/', asyncHandler(async (req, res) => {
  const body = req.body || {};
  let list = Array.isArray(body.images) ? body.images : (body.dataUrl ? [body] : null);
  if (!Array.isArray(list) || list.length === 0) {
    return res.status(400).json({ ok: false, error: '请提供 images 数组（或单张 dataUrl）' });
  }
  if (list.length > MAX_FILES) {
    return res.status(400).json({ ok: false, error: `一次最多上传 ${MAX_FILES} 张图片` });
  }

  const folder = todayFolder();
  const dir = path.join(UPLOAD_ROOT, folder);
  const files = [];
  const errors = [];

  for (let i = 0; i < list.length; i++) {
    const item = list[i] || {};
    const label = `第 ${i + 1} 张图片`;

    const parsed = imageUtil.parseImageDataUrl(item.dataUrl);
    if (parsed.error) {
      errors.push(`${label}: ${parsed.error}`);
      continue;
    }

    const { mime, format, buffer } = parsed;

    if (buffer.length === 0) {
      errors.push(`${label}: 文件内容为空`);
      continue;
    }
    if (buffer.length > MAX_FILE_BYTES) {
      errors.push(`${label}: 大小 ${(buffer.length / 1024 / 1024).toFixed(1)}MB 超过 ${MAX_FILE_BYTES / 1024 / 1024}MB 上限`);
      continue;
    }

    const size = imageUtil.imageSize(buffer, format);
    if (!size || !size.width || !size.height) {
      errors.push(`${label}: 无法解析图片尺寸（文件可能损坏）`);
      continue;
    }
    if (size.width < MIN_DIM || size.height < MIN_DIM || size.width > MAX_DIM || size.height > MAX_DIM) {
      errors.push(`${label}: 分辨率 ${size.width}x${size.height} 超出范围（要求 ${MIN_DIM}x${MIN_DIM} ~ ${MAX_DIM}x${MAX_DIM}）`);
      continue;
    }

    // 落盘：img_<时间戳>_<随机6位>.<ext>
    const ext = imageUtil.MIME_EXT[mime] || format;
    const name = `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, name), buffer);
    } catch (e) {
      errors.push(`${label}: 保存失败（${e.message}）`);
      continue;
    }

    files.push({
      url: `/uploads/${folder}/${name}`,
      name: typeof item.name === 'string' && item.name ? item.name.slice(0, 120) : name,
      size: buffer.length,
      width: size.width,
      height: size.height,
      mime
    });
  }

  // 全部失败才算失败；部分成功时返回成功列表 + 错误明细，前端可重试失败项
  if (files.length === 0) {
    return res.status(400).json({ ok: false, error: errors.join('；') || '上传失败' });
  }
  res.json({ ok: true, data: { files, errors } });
}));

/* ================= 通用附件上传（文档 / 音视频 / 压缩包等） =================
 * POST /api/upload/files
 * body: { name, dataUrl }  （data:<mime>;base64,<data>）
 * 返回: { ok, data: { file: { url, name, size, mime } } }
 *
 * 安全约束（格式与大小上限由后台「文件上传配置」控制，对员工端上传行为生效）：
 *   - 扩展名白名单（默认文档 / 表格 / 音视频 / 压缩 / 图片 / 文本）
 *   - 单个 ≤ 配置大小（默认 20MB）；文件名仅作展示（落盘用随机名），无路径穿越面
 *   - 附件不会发给大模型（图片走独立的 /api/upload 视觉链路），仅存档与展示
 */
// 默认附件格式白名单（当后台未配置时兜底）
const DEFAULT_FILE_EXT_WHITELIST = [
  'txt', 'md', 'markdown', 'csv', 'json', 'log',
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
  'mp3', 'wav', 'ogg', 'm4a', 'flac',
  'mp4', 'mov', 'webm', 'avi', 'mkv',
  'zip', 'rar', '7z',
  'png', 'jpg', 'jpeg', 'gif', 'webp'
];

router.post('/files', asyncHandler(async (req, res) => {
  const body = req.body || {};
  const rawName = typeof body.name === 'string' ? body.name : 'attachment';
  const dataUrl = typeof body.dataUrl === 'string' ? body.dataUrl : '';

  // 读后台「文件上传配置」：对话附件格式白名单 + 大小上限
  const ul = configService.getSettings().uploadLimits || {};
  const attLimit = ul.attachment || {};
  const allowExts = Array.isArray(attLimit.exts) && attLimit.exts.length ? attLimit.exts : DEFAULT_FILE_EXT_WHITELIST;
  const maxBytes = Number.isFinite(Number(attLimit.maxBytes)) && Number(attLimit.maxBytes) > 0 ? Number(attLimit.maxBytes) : 20 * 1024 * 1024;
  const extSet = new Set(allowExts);

  const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(dataUrl);
  if (!m) return res.status(400).json({ ok: false, error: 'dataUrl 格式不正确' });
  const mime = m[1] || 'application/octet-stream';
  let buffer;
  try {
    buffer = Buffer.from(m[3], 'base64');
  } catch (_) {
    return res.status(400).json({ ok: false, error: 'base64 内容解析失败' });
  }
  if (buffer.length === 0) return res.status(400).json({ ok: false, error: '附件内容为空' });
  if (buffer.length > maxBytes) {
    return res.status(400).json({ ok: false, error: `附件 ${(buffer.length / 1024 / 1024).toFixed(1)}MB 超过 ${(maxBytes / 1024 / 1024).toFixed(0)}MB 上限` });
  }

  // 扩展名白名单（取自展示文件名，落盘用随机名）
  const ext = (rawName.match(/\.([A-Za-z0-9]+)$/) || [])[1]?.toLowerCase() || '';
  if (!extSet.has(ext)) {
    return res.status(400).json({ ok: false, error: `不支持的附件类型 .${ext || '(无扩展名)'}；当前允许：${allowExts.join(' / ')}` });
  }

  const folder = todayFolder();
  const dir = path.join(UPLOAD_ROOT, folder);
  const diskName = `file_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, diskName), buffer);
  } catch (e) {
    return res.status(500).json({ ok: false, error: `保存失败（${e.message}）` });
  }

  res.json({
    ok: true,
    data: {
      file: {
        url: `/uploads/${folder}/${diskName}`,
        name: rawName.slice(0, 120),
        size: buffer.length,
        mime
      }
    }
  });
}));

module.exports = router;
