'use strict';

const express = require('express');
const configService = require('../configService');
const asyncHandler = require('../asyncHandler');
const router = express.Router();

/**
 * 公开只读接口（/api/notice）：
 *  - notice：后台「通知公告」发布的公告（工作台侧栏顶部展示）
 *  - branding：站点名称 / 底部版权（后台「系统设置」维护，全站动态生效）
 * 内容均无敏感信息，未登录可读。
 */
router.get('/', asyncHandler(async (req, res) => {
  const s = configService.getSettings();
  const a = s.announcement || { enabled: false, text: '', updatedAt: '' };
  res.json({
    ok: true,
    data: {
      notice: {
        enabled: !!(a.enabled && a.text),
        text: a.text,
        updatedAt: a.updatedAt
      },
      branding: {
        siteName: s.siteName,
        footerText: s.footerText,
        // 门户首页文案（空 = 前端保留内置默认）
        heroBadge: s.heroBadge || '',
        heroTitle: s.heroTitle || '',
        heroTitleHl: s.heroTitleHl || '',
        heroDesc: s.heroDesc || '',
        contactEmail: s.contactEmail || '',
        icpBeian: s.icpBeian || '',
        policeBeian: s.policeBeian || '',
        defaultTheme: s.defaultTheme || 'light'
      },
      // 页面管理（登录页标语 / 服务协议 / 隐私政策；空 = 前端保留内置默认）
      pages: {
        loginTagline: s.loginTagline || '',
        serviceAgreement: s.serviceAgreement || '',
        privacyPolicy: s.privacyPolicy || ''
      }
    }
  });
}));

module.exports = router;
