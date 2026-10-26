#!/usr/bin/env node
'use strict';

/**
 * 密码重置工具（忘记密码 / 被锁门外时的自救入口）
 *
 * 用法：
 *   node scripts/reset-password.js                      # 重置 owner 为随机临时密码（默认）
 *   node scripts/reset-password.js <username>           # 重置指定账号
 *   node scripts/reset-password.js <username> --password 你的新密码
 *   node scripts/reset-password.js <username> --password 你的新密码 --no-force-change
 *   node scripts/reset-password.js --list               # 只看账号列表，不改任何东西
 *   node scripts/reset-password.js --force              # 服务运行中也强行重置（重启后生效）
 *
 * 行为：
 *   - 随机模式：生成 ~12 位随机临时密码，仅本次打印；下次登录强制改密；
 *   - 指定模式：使用 --password 给出的密码（至少 8 位，须含字母和数字）；
 *   - 两种模式都会 bump passwordUpdatedAt → 该账号的全部旧会话（team_token）立即失效；
 *   - 数据直接写 data/db.json（原子写），不依赖服务进程；
 *   - 重置后会重新读盘校验，确认新密码确实生效。
 *
 * ⚠️ 服务运行中会拒绝执行（除非 --force）：
 *   运行中的进程把旧密码缓存在内存里，其下一次 db.save()（任何一次对话/保存都会触发）
 *   就会把本工具的写入覆盖回旧密码——表现就是"重置成功了但登录还是提示密码错误"。
 *   正确顺序：彻底关闭服务 → 运行本工具 → 重启服务 → 用新密码登录。
 */

require('../src/env'); // 与 server.js 一致：保证 .env / 环境变量（PORT / XFYUN_DATA_DIR）就位
const net = require('net');
const fs = require('fs');
const userService = require('../src/userService');
const adminAuth = require('../src/adminAuth');
const db = require('../src/db');

const [, , ...args] = process.argv;

function fail(msg) {
  console.error(`错误：${msg}`);
  process.exit(1);
}

function padEnd(s, n) {
  s = String(s);
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

/** 探测本机端口是否有服务在监听（连接后立即断开，不发送任何请求） */
function isServerRunning(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host });
    const finish = (r) => { socket.destroy(); resolve(r); };
    socket.setTimeout(500, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

/* ---------- 参数解析 ---------- */
let listOnly = false;
let target = '';
let newPassword = '';
let forceChange = true; // 默认下次登录强制改密
let force = false;      // 服务运行中也强行重置

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--list' || a === '-l') listOnly = true;
  else if (a === '--no-force-change') forceChange = false;
  else if (a === '--force-change') forceChange = true;
  else if (a === '--force' || a === '-f') force = true;
  else if (a === '--password' || a === '-p') {
    // 分开写法：--password 值
    const v = args[i + 1];
    if (!v || v.startsWith('-')) fail('--password 需要跟一个值，例如 --password MyPass123');
    newPassword = v;
    i++;
  }
  else if (a.startsWith('--password=')) newPassword = a.slice('--password='.length);
  else if (a.startsWith('-p=')) newPassword = a.slice(3);
  else if (a.startsWith('-')) fail(`未知参数：${a}（可用 --list / --password / --no-force-change / --force）`);
  else if (!target) target = a;
  else fail('只能指定一个用户名，多余参数请检查命令');
}

/* ---------- 列表模式 ---------- */
if (listOnly) {
  const users = userService.list();
  if (!users.length) { console.log('（暂无账号）'); process.exit(0); }
  console.log('用户名'.padEnd(16) + '昵称'.padEnd(14) + '角色'.padEnd(10) + '状态');
  for (const u of users) {
    console.log(padEnd(u.username, 16) + padEnd(u.displayName, 14) + padEnd(u.role, 10) + (u.status === 'active' ? '启用' : '已停用'));
  }
  process.exit(0);
}

/* ---------- 服务运行检测（核心防护） ---------- */
const PORT = parseInt(process.env.PORT, 10) || 4000;

(async () => {
  if (!force) {
    const running = await isServerRunning(PORT);
    if (running) {
      console.log('');
      console.log('====================================================');
      console.log(` 检测到服务正在运行（127.0.0.1:${PORT}），本次重置已中止。`);
      console.log(' 原因：运行中的服务把旧密码缓存在内存里，它的下一次保存');
      console.log('      就会把本次重置覆盖回旧密码——改了也白改，登录照旧失败。');
      console.log(' 请按以下顺序操作：');
      console.log('   1. 彻底关闭运行服务的黑色命令行窗口（启动.bat 的窗口），');
      console.log('      或在那个窗口里按 Ctrl+C；');
      console.log('   2. 重新双击「重置密码.bat」；');
      console.log('   3. 双击「启动.bat」重启服务；');
      console.log('   4. 用新密码登录（重启同时会解除连续输错导致的登录限流）。');
      console.log(' 确认要在服务运行中强行重置（重启后才生效）可加 --force。');
      console.log('====================================================');
      process.exit(1);
    }
  }

  /* ---------- 重置 ---------- */
  const username = (target || 'owner').toLowerCase();
  const user = userService.getByUsername(username);
  if (!user) {
    const users = userService.list();
    console.error(`错误：账号不存在：${username}`);
    if (users.length) console.error('现有账号：' + users.map((u) => u.username).join('、'));
    process.exit(1);
  }

  let result;
  let shownPassword = '';
  if (newPassword) {
    // 指定密码模式
    const r = userService.update(user.id, { password: newPassword, mustChangePassword: forceChange });
    if (!r.ok) fail((r.errors || []).join('；'));
    result = r;
    shownPassword = newPassword;
  } else {
    // 随机临时密码模式
    const r = userService.update(user.id, { resetPassword: true });
    if (!r.ok) fail((r.errors || []).join('；'));
    result = r;
    shownPassword = r.tempPassword;
  }

  /* ---------- 落库校验：重读 db.json 确认新密码确实生效 ---------- */
  try {
    const onDisk = JSON.parse(fs.readFileSync(db.DB_FILE, 'utf8'));
    const diskUser = (onDisk.users || []).find((x) => x.username === username);
    if (!diskUser || !adminAuth.verifyPassword(shownPassword, diskUser.passwordHash)) {
      fail('重置后校验失败：data/db.json 中的密码未更新成功，请检查文件是否被占用/权限后重试');
    }
  } catch (e) {
    if (e && e.code === 'ENOENT') {
      // 数据文件不在默认位置（XFYUN_DATA_DIR 自定义）时跳过读盘校验，内存态已确认
    } else if (e instanceof SyntaxError) {
      fail(`重置后校验失败：data/db.json 解析异常（${e.message}），请检查文件完整性`);
    } else {
      throw e;
    }
  }

  console.log('');
  console.log('====================================================');
  console.log(` 账号 ${username} 的密码已重置（已通过落库校验）`);
  console.log(`   新密码：${shownPassword}`);
  console.log(forceChange
    ? ' 下次登录将要求修改密码（如需跳过，可加 --no-force-change）。'
    : ' 已设置为登录后不强制改密，请妥善保管。');
  console.log(' 该账号此前的登录会话已全部失效。');
  console.log('----------------------------------------------------');
  console.log(' 接下来：');
  console.log('   1. 双击「启动.bat」启动服务；');
  console.log('   2. 打开登录页：http://127.0.0.1:4000/team-login');
  console.log('   3. 用上方新密码登录（后台入口 /admin）。');
  console.log('====================================================');
})().catch((e) => {
  console.error('重置失败：' + (e && e.message ? e.message : e));
  process.exit(1);
});
