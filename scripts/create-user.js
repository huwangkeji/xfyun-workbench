#!/usr/bin/env node
'use strict';

/**
 * 员工账号管理 CLI（P0 账号体系的运维入口；P1 起由后台「成员管理」页面取代）
 *
 * 用法（务必先停服，避免运行中进程的内存缓存覆盖写入）：
 *   node scripts/create-user.js create <username> <password> [role] [displayName]
 *   node scripts/create-user.js list
 *   node scripts/create-user.js disable <username>
 *   node scripts/create-user.js enable <username>
 *   node scripts/create-user.js reset-password <username>
 *
 * 角色：owner（唯一超管）/ admin / member / viewer
 * 密码要求：至少 8 位，须同时包含字母和数字
 */

require('../src/env'); // 保证 .env / 环境变量就位（与 server.js 一致）
const userService = require('../src/userService');

const [, , cmd, ...args] = process.argv;

function fail(msg) {
  console.error(`错误：${msg}`);
  process.exit(1);
}

switch (cmd) {
  case 'create': {
    const [username, password, role = 'member', displayName] = args;
    if (!username || !password) fail('用法：create <username> <password> [role] [displayName]');
    const r = userService.create({
      username,
      password,
      role,
      displayName: displayName || username
    });
    if (!r.ok) fail((r.errors || []).join('；'));
    console.log(`已创建账号：${r.data.username}（${r.data.displayName}，角色 ${r.data.role}，状态 ${r.data.status}）`);
    console.log('提示：如需首次登录强制改密，请登录后台后在「成员管理」重置密码（P1），或直接在 db.json 将该用户 mustChangePassword 置 true。');
    break;
  }
  case 'list': {
    const users = userService.list();
    if (!users.length) { console.log('（暂无账号）'); break; }
    console.log('用户名'.padEnd(16) + '昵称'.padEnd(14) + '角色'.padEnd(10) + '状态'.padEnd(10) + '最近登录');
    for (const u of users) {
      console.log(
        u.username.padEnd(16) +
        String(u.displayName).padEnd(14) +
        u.role.padEnd(10) +
        u.status.padEnd(10) +
        (u.lastLoginAt || '-')
      );
    }
    break;
  }
  case 'disable':
  case 'enable': {
    const [username] = args;
    if (!username) fail(`用法：${cmd} <username>`);
    const user = userService.getByUsername(username);
    if (!user) fail(`账号不存在：${username}`);
    const r = userService.setStatus(user.id, cmd === 'disable' ? 'disabled' : 'active');
    if (!r.ok) fail((r.errors || []).join('；'));
    console.log(`账号 ${username} 已${cmd === 'disable' ? '停用' : '启用'}（历史数据完整保留）`);
    break;
  }
  case 'reset-password': {
    const [username] = args;
    if (!username) fail('用法：reset-password <username>');
    const user = userService.getByUsername(username);
    if (!user) fail(`账号不存在：${username}`);
    const r = userService.update(user.id, { resetPassword: true });
    if (!r.ok) fail((r.errors || []).join('；'));
    console.log(`账号 ${username} 的密码已重置为临时密码：${r.tempPassword}`);
    console.log('该账号下次登录将被要求修改密码；此临时密码仅本次显示。');
    break;
  }
  default:
    console.log('用法：');
    console.log('  node scripts/create-user.js create <username> <password> [role] [displayName]');
    console.log('  node scripts/create-user.js list');
    console.log('  node scripts/create-user.js disable <username>');
    console.log('  node scripts/create-user.js enable <username>');
    console.log('  node scripts/create-user.js reset-password <username>');
    if (cmd) process.exit(1);
}
