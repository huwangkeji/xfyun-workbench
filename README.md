# 同聪星火 V2 · xfyun-workbench

> 基于 **讯飞星辰 MaaS 平台模型服务 API** 的团队大模型对话工作台
> 由 **沧州虎王科技** 开发并开源

[![Node](https://img.shields.io/badge/Node-%3E%3D18-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Express](https://img.shields.io/badge/Express-4.x-000000?logo=express&logoColor=white)](https://expressjs.com/)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Deps](https://img.shields.io/badge/dependencies-1%20(express)-brightgreen.svg)](./package.json)
[![Version](https://img.shields.io/badge/version-2.0-2563eb.svg)](./package.json)

一个开箱即用的**团队版星火大模型对话工作台**：前端零构建（原生 HTML/CSS/JS），后端仅依赖 Express，数据存本地 JSON 文件，**无需数据库、无需复杂部署**。V2 起内置**员工账号体系**（注册登录、四级角色权限、数据按人隔离、操作留痕）与**门户首页/员工中心/手机端适配**，从个人工具升级为可直接给团队使用的私有工作台。

---

## 目录

- [特性一览](#特性一览)
- [快速开始](#快速开始)
- [目录结构](#目录结构)
- [配置说明](#配置说明)
- [界面说明](#界面说明)
- [API 一览](#api-一览)
- [星辰 MaaS 对接要点](#星辰-maas-对接要点)
- [图片与联网功能](#图片与联网功能)
- [安全说明](#安全说明)
- [常见问题](#常见问题)
- [路线图](#路线图)
- [版本历史](#版本历史)
- [开源协议](#开源协议)
- [关于](#关于)

---

## 特性一览

### 工作台（前台 `/app`）

| 功能 | 说明 |
| --- | --- |
| 多会话管理 | 新建 / 切换 / 删除 / 清空，会话自动以首条提问命名 |
| 多模型配置 | 顶部下拉随时切换不同 API 配置（不同 Key、不同模型、不同参数） |
| 文本对话 | Enter 发送、Shift+Enter 换行；自动滚动；输入框 64px 起步、最长 220px 自适应 |
| **Markdown 渲染** | 助手回复按 Markdown 富文本展示（标题/列表/表格/代码块/引用），可一键切换「原文」视图 |
| **消息评价** | 每条消息可点赞 / 差评（互斥、再点取消），持久化到会话记录 |
| **对话分享** | 一键生成只读快照链接（7/30/90 天或永久），可随时撤销；分享页 `/s/:token` 匿名可看 |
| **图片粘贴上传** | 支持 **Ctrl+V 粘贴**、**右键菜单粘贴**、**拖拽放入**、**文件选择** 四种方式 |
| 图片状态可见 | 缩略图预览 + 上传进度条；失败可点击重试、可单独移除；未完成的图片会阻止发送 |
| **联网搜索开关** | 一键开关，状态本地记忆，按次请求控制是否允许模型调用 `web_search` |
| **界面细节** | 思考强度为分段式选择器（high / max，免原生下拉）、顶栏按钮胶囊化、参数条触控优化 |
| 响应明细 | 气泡下方展示耗时、输入/输出/总 token、缓存命中、推理 token、结束原因、工具调用 |
| 思考过程兜底 | 模型只返回 `reasoning_content` 或 `tool_calls` 时也能完整展示，不会白屏 |
| 可选访客密码 | 后台可开启「工作台访问控制」，访客需输密码才能使用（开关式） |
| **手机端适配** | ≤720px 自动切换 App 壳布局：侧栏改抽屉、输入区吸底、适配 iPhone 安全区 |

### 后台管理（`/admin`，需 owner/admin 员工账号登录）

| 功能 | 说明 |
| --- | --- |
| **成员管理** | 员工列表、新增/编辑、启用/停用（停用即禁登录、数据保留）、重置临时密码；仅 owner 可管理 admin 级账号 |
| **员工账号体系** | 用户名/密码登录（scrypt 哈希），首次登录强制改密，改密只失效本人会话；`scripts/create-user.js` 可命令行建号/启停/重置密码 |
| **API 配置** | 多配置增删改查、启用/禁用、设为默认、优先级排序、连通性一键测试 |
| 完整参数面板 | 系统提示、`temperature`、`top_p`、`max_completion_tokens`、双惩罚项、`enable_thinking`、`reasoning_effort`、联网搜索、`user`、`stream` |
| **运行日志** | 每次请求的模型、耗时、token、请求/响应、错误原因全记录；状态/关键字/模型/日期筛选与排序 |
| **数据概览** | 今日请求数、成功率、token 消耗、平均耗时、活跃成员、失败数 |
| **云中心延时** | 网络探测，直观看到各 API 端点的连通性与响应耗时 |
| **记忆管理** | 会话记录列表 + 关键字搜索 + **按成员筛选** + 管理员备注 + 统计概览 + 导出（JSON / Markdown）+ 删除 |
| **审计日志** | 登录成败、账号变更、配置变更、数据删除等关键操作留痕（最近 2000 条） |
| **工作台访问控制** | 设置/修改访客密码，开关密码保护（与员工账号并存：员工免输访客密码） |
| 修改登录密码 | 自助改密（至少 8 位含字母+数字），仅当前设备需重新登录 |
| 我的登录记录 | 顶栏查看本人的登录/退出/改密记录 |
| 图片生成设置 | 文生图（TTI）模型与参数配置（接口已就绪，生成界面开发中） |

### 门户首页与员工端（系统首页 `/` + 工作台 `/app` + 员工中心 `/me`）

| 功能 | 说明 |
| --- | --- |
| 门户首页 `/` | 系统默认入口：功能特性、团队角色、安全能力、FAQ；**员工登录 / 注册账号**入口（已登录员工自动切换为「进入工作台 / 员工中心」） |
| 员工身份 | 登录后工作台顶栏显示「昵称 · 角色」；member/viewer 不显示「后台管理」入口 |
| 员工中心 `/me` | 基本信息、我的数据（近 7 天请求/成功率/token/平均耗时）、我的登录记录、自助改密 |
| 个人数据隔离 | 会话与日志按人隔离：member 只看自己的；viewer 为只读角色（界面禁用发送，后端 403） |
| 访客模式 | 未登录时按访客使用（仅见访客桶会话），可随时登录升级为员工身份 |

### 工程特性

- **零构建**：前端纯原生，改完刷新即生效，没有 webpack / vite / npm run build
- **零依赖负担**：后端运行依赖只有 `express` 一个包（`.env` 解析、密码哈希、图片解析全部自己实现）
- **单文件数据**：所有配置、会话、日志存在 `data/db.json`，备份就是拷一个文件
- **密钥不落代码**：API Key 走环境变量 / `.env` 或后台填写，源码里没有硬编码密钥
- **多配置自动切换**：某个配置失败时按优先级自动切下一个，并进入冷却期
- **进程兜底**：`asyncHandler` + 进程级异常捕获，单个请求出错不会把服务打挂

---

## 快速开始

### 1. 准备环境

- Node.js **≥ 18**（需内置 `fetch`，推荐 20 LTS）
- 一个讯飞星辰 MaaS 的 API Key（[控制台 → API 调用 / APIKEY 管理](https://maas.xfyun.cn/)）

### 2. 安装与启动

```bash
git clone https://github.com/<你的组织>/xfyun-workbench.git
cd xfyun-workbench
npm install          # 只装 express
cp .env.example .env # 复制配置模板
```

编辑 `.env`，最少填两项：

```ini
XFYUN_API_KEY=ak-xxxxxxxxxxxxxxxxxxxxxxxx
XFYUN_MODEL=spark-x2.6
```

然后启动：

```bash
npm start
# Windows 用户也可双击 启动.bat
```

打开：

- 门户首页（系统默认入口）：<http://127.0.0.1:4000/>
- 工作台：<http://127.0.0.1:4000/app>
- 员工登录：<http://127.0.0.1:4000/team-login>（员工中心 `/me`，后台 `/admin`）

> 首次启动时控制台会**打印一次随机初始密码**，并自动迁移为 `owner` 员工账号，请留意保存。想自己指定：在 `.env` 里设 `ADMIN_PASSWORD=你的密码`（仅首次启动/重置生效）。登录入口：**员工登录 `/team-login`**（原 `/admin/login` 自动跳转至此）。

### 3. 也可以不填 .env

直接用后台「API 配置」添加配置同样可用。**优先级**：后台 `data/db.json` 已填的值 > `.env` > 内置默认值。

---

## 目录结构

```
xfyun-workbench/
├── server.js                 # 服务入口：中间件、路由挂载、页面守卫、进程兜底
├── package.json              # 唯一运行依赖：express
├── 启动.bat                  # Windows 一键启动
├── .env.example              # 环境变量模板
├── public/                   # 前端（零构建，纯原生）
│   ├── home.html             # 系统首页 / 门户（功能介绍 + 员工登录/注册入口）
│   ├── index.html            # 工作台（/app）
│   ├── login.html            # 工作台访客登录页
│   ├── team-login.html       # 员工登录页（含首次登录强制改密、开放注册入口）
│   ├── me.html               # 员工中心（基本信息 / 我的数据 / 登录记录 / 改密）
│   ├── share.html            # 对话分享只读页（/s/:token）
│   ├── admin.html            # 后台管理
│   ├── uploads/              # 粘贴上传的图片（按日期分目录，已在 .gitignore 中）
│   └── assets/
│       ├── app.js            # 工作台逻辑（对话 / 图片 / 联网 / Markdown / 评价 / 分享）
│       ├── home.js           # 门户首页逻辑（登录态自适应 / 注册开关 / 移动导航）
│       ├── admin.js          # 后台逻辑（配置 / 日志 / 记忆 / 成员 / 审计 / 概览）
│       ├── markdown.js       # 零依赖 Markdown 渲染器（浏览器/Node 双端）
│       ├── me.js             # 员工中心页面逻辑
│       ├── share.js          # 分享页逻辑
│       └── style.css         # 全部样式（含响应式与门户页）
├── scripts/
│   └── create-user.js        # 员工账号 CLI（建号/列表/启停/重置密码，需停服执行）
├── test/
│   └── core.test.js          # 账号/会话/审计/加密核心用例（node:test，npm test）
└── src/
    ├── xfyun.js              # 星辰 MaaS API 封装（非流式 / 流式 SSE / 文生图）
    ├── configService.js      # API 配置与全局设置的增删改查、参数校验、Key 加密
    ├── scheduler.js          # 多配置调度：优先级排序、失败切换、冷却
    ├── adminAuth.js          # 认证核心：scrypt 哈希、v2 员工令牌、v1 访客/旧版兼容、角色守卫、限流
    ├── userService.js        # 员工账号：CRUD、登录校验、改密、旧版迁移
    ├── auditService.js       # 操作留痕（审计日志，环形缓冲 2000 条）
    ├── shareService.js       # 对话分享：快照 + token + 过期校验
    ├── conversationService.js# 会话持久化、归属打标、记忆检索、消息评价
    ├── logService.js         # 运行日志（多维筛选/排序/角色范围/概览）
    ├── imageUtil.js          # 图片魔数探测与尺寸解析（零依赖）
    ├── env.js                # .env 解析（零依赖）
    ├── asyncHandler.js       # async 路由异常兜底
    ├── db.js                 # data/db.json 读写（原子写）
    └── routes/
        ├── chat.js           # 对话代理（含图片内联、联网透传）
        ├── upload.js         # 图片上传
        ├── config.js         # API 配置
        ├── conversations.js  # 会话 / 消息评价 / 分享管理
        ├── auth.js           # 员工认证：登录/退出/改密/注册/我的登录记录
        ├── admin.js          # 后台：记忆管理 / 数据概览
        ├── admin-users.js    # 成员管理（owner/admin）
        ├── audit.js          # 审计日志（owner/admin）
        ├── workbench.js      # 工作台访客登录
        ├── share.js          # 分享公开读（token 即凭证）
        ├── logs.js           # 运行日志
        ├── network.js        # 网络探测
        └── image.js          # 文生图（TTI）
```

---

## 配置说明

### 环境变量（`.env`）

| 变量 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `XFYUN_API_KEY` | 是* | — | 讯飞 MaaS API Key，形如 `ak-xxxx` |
| `XFYUN_MODEL` | 是* | — | 模型 ID，如 `spark-x2.6` |
| `SPARK_API_PASSWORD` | 否 | — | 与上面等价的兼容别名，二选一 |
| `XFYUN_BASE_URL` | 否 | `https://maas-api.cn-huabei-1.xf-yun.com` | 接口地址 |
| `XFYUN_CONFIG_NAME` | 否 | `环境变量配置（.env）` | 该配置在列表中的显示名 |
| `XFYUN_TIMEOUT_MS` | 否 | `120000` | 单次请求超时（毫秒） |
| `XFYUN_MAX_RETRIES` | 否 | `1` | 网络错误 / 上游 5xx 重试次数（最大 3；4xx 不重试） |
| `PORT` | 否 | `4000` | 服务端口 |
| `ADMIN_PASSWORD` | 否 | 随机生成 | 后台初始密码（仅首次启动生效） |
| `ADMIN_PASSWORD_RESET` | 否 | `0` | 设为 `1` 时重启强制重置密码 |
| `ADMIN_SESSION_TTL_HOURS` | 否 | `12` | 员工会话有效期（小时；改密后仅本人会话失效） |
| `DB_ENCRYPT_KEY` | 否 | 空 | 设置后 API Key 以 AES-256-GCM 加密落库；密钥不落库，切勿丢失 |
| `XFYUN_DATA_DIR` | 否 | `./data` | 数据目录（测试隔离 / 自定义部署位置） |

\* 不填的话可在后台「API 配置」里手动添加。

### 常用模型参数（后台可调）

| 参数 | 范围 | 默认 | 说明 |
| --- | --- | --- | --- |
| `temperature` | 0 ~ 1 | 0.7 | 采样温度 |
| `top_p` | 0 ~ 1 | — | 核采样 |
| `max_completion_tokens` | 1 ~ 262144 | — | 最大生成长度（`max_tokens` 官方已废弃） |
| `presence_penalty` / `frequency_penalty` | -2 ~ 2 | 0 | 重复惩罚 |
| `enable_thinking` | 开/关 | 关 | 是否开启思考模式 |
| `reasoning_effort` | `high` / `max` | — | 思考强度（`low`/`medium` 映射为 `high`，`xhigh` 映射为 `max`） |
| `web_search` | 开/关 | 关 | 联网搜索工具 |
| `priority` | 0 ~ 999 | 100 | 调度优先级，数字越小越优先 |

---

## 界面说明

**工作台** — 桌面端：左侧配置与会话列表，右侧对话区；对话头部为 ☰ 抽屉开关（移动端）、当前配置名与分享按钮；输入区上方是参数工具栏（深度思考、强度分段选择、联网搜索、系统提示），输入框 64 ~ 220px 自适应高度。
**工作台（手机端 ≤720px）** — 自动切换为 App 壳布局：顶栏压缩为两行（隐藏长标题、按钮 chip 化），侧边栏改为**抽屉**（点对话区左上角 ☰ 唤出，选中会话/切换配置后自动收起，支持遮罩点击与 Esc 关闭），消息区内部滚动、输入区吸底（适配 iPhone 安全区），参数工具栏自动换行；≤400px 进一步压缩。

**后台管理** — 六个标签页：

| 标签页 | 用途 |
| --- | --- |
| API 配置 | 多配置维护、参数面板、连通性测试、设为默认 |
| 运行日志 | 请求全记录：模型、耗时、token、请求体、响应、错误；多维筛选与排序 |
| 云中心延时 | 各端点连通性与响应耗时探测 |
| 记忆管理 | 会话记录搜索、按成员筛选、备注、统计、导出、删除 |
| 成员管理 | 员工账号增改、启停、重置临时密码 |
| 审计日志 | 登录成败、账号/配置变更、数据删除等操作留痕 |

---

## API 一览

| 方法 | 路径 | 说明 | 鉴权 |
| --- | --- | --- | --- |
| POST | `/api/chat` | 对话代理（支持 `configId` / `messages` / `stream` / `webSearch`） | 访客（可选） |
| POST | `/api/upload` | 图片上传（base64 JSON，落盘 `public/uploads`） | 访客（可选） |
| GET/POST/PUT/DELETE | `/api/configs` | API 配置管理（GET 开放，写操作需员工登录） | 员工 |
| POST | `/api/configs/:id/test` | 单配置连通性测试 | 员工 |
| GET | `/api/conversations` | 会话列表 | 访客（可选） |
| POST | `/api/conversations` | 新建会话 | 访客（可选） |
| GET | `/api/conversations/:id` | 会话详情 | 访客（可选） |
| POST | `/api/conversations/:id/messages` | 追加消息 | 访客（可选） |
| DELETE | `/api/conversations/:id/messages` | 清空消息 | 访客（可选） |
| POST | `/api/image/tti` | 文生图 | 访客（可选） |
| GET | `/api/logs` | 运行日志 | 员工 |
| GET/POST | `/api/network/ping`、`/ping-all` | 网络探测 | 员工 |
| POST | `/api/auth/login` | 员工登录（`{username, password}` → `team_token` cookie） | 公开 |
| POST | `/api/auth/logout` | 员工退出 | 公开 |
| GET | `/api/auth/setup-status` | 登录页状态（是否有账号、owner 是否初始密码） | 公开 |
| GET | `/api/auth/me` | 当前员工身份 | 员工 |
| PUT | `/api/auth/password` | 自助改密（≥8 位含字母+数字，只失效本人会话） | 员工 |
| GET | `/api/auth/my-logins` | 我的登录记录 | 员工 |
| GET | `/api/auth/my-overview` | 我的数据概览（按角色收敛） | 员工 |
| POST | `/api/auth/register` | 开放注册（默认关，后台「API 配置」页可开；角色固定 member） | 公开 |
| GET | `/api/admin/me` | 后台会话信息 | 员工 |
| GET | `/api/admin/overview` | 数据概览指标 | owner/admin |
| GET | `/api/admin/memory` | 记忆管理（列表 / 搜索 / 按成员筛选 / 统计） | owner/admin |
| PUT | `/api/admin/memory/:id/note` | 保存管理员备注 | owner/admin |
| GET | `/api/admin/memory/:id/export` | 导出会话（`?format=json|md`） | owner/admin |
| GET/POST/PUT/DELETE | `/api/admin/users` | 成员管理（软删=停用） | owner/admin |
| GET | `/api/admin/audit-logs` | 审计日志（`?action=&actorId=me&keyword=`） | owner/admin |
| PUT | `/api/conversations/:id/messages/:mid/feedback` | 消息点赞/差评 | 访客/员工 |
| POST/GET/DELETE | `/api/conversations/:id/share`、`/shares`、`/shares/:token` | 对话分享管理 | 访客/员工 |
| GET | `/api/share/:token` | 分享快照公开读（token 即凭证） | 公开 |
| GET | `/api/workbench/status` | 访客密码状态（永免登录） | 公开 |
| POST | `/api/workbench/login` / `logout` | 访客登录 / 退出 | 公开 |
| GET | `/api/health` | 健康检查 | 公开 |

---

## 星辰 MaaS 对接要点

实现严格对齐官方文档，以下为已验证的关键约定：

- **端点**：`POST {baseUrl}/v2/chat/completions`
- **鉴权**：请求头 `Authorization: Bearer <APIKEY>` + `Content-Type: application/json`
- **业务码**：响应 `code !== 0` 视为业务失败（如 `10004` 参数校验、`10024` 生成失败）
- **流式**：`stream: true` 时为 SSE，每个 chunk 形如 `data: {json}\n\n`，以 `data: [DONE]` 结束；本工作台转发时会校验上游 `Content-Type` 确为 `text/event-stream`，避免把错误页当流透传
- **重试策略**：仅对网络错误 / 上游 5xx 退避重试；4xx（鉴权、参数错误）直接返回，不做无意义重试
- **字段兼容**：`max_tokens` 已废弃，统一用 `max_completion_tokens`；`reasoning_effort` 只取 `high` / `max`

> 多配置调度：`scheduler.js` 按「默认配置优先 → 启用且未冷却 → 优先级升序」尝试，失败自动冷却并切换下一个。注意 **failover 与 SSE 语义互斥**，调度路径恒为非流式。

---

## 图片与联网功能

### 图片上传链路

```
粘贴/拖拽/选择 → FileReader 读为 dataUrl
   → 前端预检（类型/大小/张数）
   → POST /api/upload（base64 JSON）
   → 后端魔数校验 + 尺寸解析 → 落盘 public/uploads/YYYY-MM-DD/
   → 返回 /uploads/... 相对 URL
   → 消息体存 URL（db 不膨胀），发请求时后端读文件内联为 base64 data URI
```

**为什么要内联**：上游无法访问你本机的 `localhost`，实测直接传外部 http URL 会被拒（`code=10005`），因此历史消息存 URL、发送前按需转成 base64。

**限制**：PNG / JPEG / GIF / WebP；单张 ≤ 8MB；一次最多 9 张；分辨率 50×50 ~ 6000×6000（上游限制）。格式与尺寸以**文件头魔数**为准，不信任前端声明的 MIME。

> ⚠️ **关于“看图”能力**：本项目已按标准多模态格式（`content: [{type:'text'},{type:'image_url',image_url:{url}}]`）实现，但能否真正识别图片取决于你使用的**模型**。纯文本模型（如 `spark-x2.6`）会照常接受图片但无法解析内容。需要视觉理解能力请在讯飞 MaaS 控制台申请**多模态模型**（如星火 X2-VL），然后在后台配置里改模型 ID 即可，**无需改动代码**。

### 联网搜索

头部「🌐 联网搜索」开关 → 每次请求携带 `webSearch: true/false` → 后端注入 `tools: [{ type: 'web_search', web_search: { enable: true } }]`。开关状态存 localStorage，刷新后保持。未显式指定时回退后台配置里的默认值。

---

## 安全说明

- **密钥**：API Key 只从环境变量 / `.env` / 后台配置读取，源码与仓库中不含任何密钥；`data/db.json`、`.env`、`public/uploads/` 均已在 `.gitignore` 中。可选设置 `DB_ENCRYPT_KEY` 将库内 Key 加密为 `enc:v1:` 密文（AES-256-GCM）
- **员工密码**：scrypt 加盐哈希存储（`scrypt$1$<salt>$<hash>`），比对用 `timingSafeEqual`；同 IP 连续 5 次错误锁定 60 秒，同账号连续 5 次错误锁定 5 分钟；登录失败不提示“用户名是否存在”
- **员工会话**：HMAC 签名 Cookie（`team_token = v2.<userId>.<过期时间>.<签名>`，签名绑定 `passwordUpdatedAt`），`HttpOnly` + `SameSite=Lax`；**改密只失效本人会话**；停用账号即时失效（校验时查实时用户状态）
- **角色权限**：owner / admin / member / viewer 四级；写操作、成员管理、审计日志、网络探测仅 owner/admin；member 的会话与日志按人隔离
- **访客密码**：与员工账号体系独立，员工登录态可放行工作台；开启后 `/uploads/` 图片同样受保护，未登录无法直链
- **旧版兼容**：升级首次启动时，旧后台密码自动迁移为 `owner` 员工账号，旧会话令牌 7 天只读兼容后自然失效
- **数据写入**：db.json 采用原子写（临时文件 + rename），进程中断不会写坏数据文件
- **上传校验**：魔数白名单 + 尺寸上限 + 目录穿越防护，不执行任何上传文件

> 部署建议：本项目定位为**本地 / 内网工具**。若要放到公网，请务必开启工作台密码、为每个员工使用强密码，并置于 HTTPS 反向代理之后。

---

## 常见问题

**Q：启动后提示“未启用任何可用 API 配置”？**
A：去后台「API 配置」添加一个配置，或在 `.env` 里填好 `XFYUN_API_KEY` 与 `XFYUN_MODEL` 后重启。

**Q：员工密码忘了？**
A：管理员执行 `node scripts/create-user.js reset-password <username>`（需停服），会用随机临时密码重置，该账号下次登录强制改密。`owner` 密码还可用 `.env` 设 `ADMIN_PASSWORD=新密码` + `ADMIN_PASSWORD_RESET=1` 重启重置（会同步重置 owner 账号）。

**Q：怎么新增/停用员工账号？**
A：两条路——① 管理员登录后台「成员管理」页面直接创建/停用/重置密码（推荐）；② 命令行 `node scripts/create-user.js create <username> <password> [role]`（角色 owner/admin/member/viewer，需停服执行）。停用后该账号立即无法登录，历史数据完整保留。

**Q：模型只输出很少的字 / 回复为空？**
A：检查后台 `max_completion_tokens` 是否被误设（留空即不限制）。历史版本曾有空值被钳到 1 的问题，已修复。

**Q：控制台提示 API Key 无效？**
A：确认 Key 形如 `ak-xxxx` 且已在 MaaS 控制台开通对应模型；后台「API 配置」里测试按钮可直接验证连通性。

**Q：粘贴图片没反应？**
A：确认粘贴的是**图片文件**（截图、复制的图片）而非图片地址文本；支持 Ctrl+V、右键粘贴、拖拽、📎 选择四种方式。图片需 ≥ 50×50 且 ≤ 8MB。

**Q：改了 `data/db.json` 不生效？**
A：本应用为单进程，运行时 db 在内存中缓存。修改 db.json 请**先停服再改**，否则会被运行中的进程覆盖回去。

**Q：数据怎么备份 / 迁移？**
A：拷走 `data/db.json` 一个文件即可（含配置、会话、日志、设置）。

---

## 路线图

**V2.0 已交付**：员工账号体系、成员管理、四级角色权限、审计日志、数据按人隔离、数据概览、门户首页（系统首页）、员工中心、对话 Markdown/评价/分享、手机端适配、强度分段选择器与顶栏胶囊化、品牌更名「同聪星火」、API Key 加密选项、db 原子写、自动化测试。

**后续规划**：

- [ ] 文生图工作台界面（接口与后台设置已就绪）
- [ ] 流式输出的逐字渲染（SSE 接口已打通）
- [ ] 对话导出 / 导入、Markdown 代码高亮
- [ ] Docker 镜像与一键部署脚本
- [ ] 分享访问统计、会话共享给指定成员
- [ ] SSO / OAuth 登录（面向已有统一身份体系的企业）

---

## 版本历史

### V2.0（2026-10-25）— 团队/企业版

从个人工具升级为团队可用的私有工作台，核心变更为**账号体系 + 权限 + 数据隔离 + 审计**：

| 模块 | 内容 |
| --- | --- |
| 员工账号体系 | 用户名/密码登录（scrypt 哈希、≥8 位复杂度）、首次登录强制改密、v2 签名会话令牌（改密只失效本人）、IP+账号双维度登录限流、旧版单密码自动迁移为 owner 账号（7 天令牌兼容） |
| 成员管理 | 后台「成员管理」页 + `/api/admin/users`：创建/编辑/启停/重置临时密码；停用即禁登录且数据保留；不能停用自己/自改角色；仅 owner 可管 admin 级账号 |
| 角色权限 | owner / admin / member / viewer 四级，`requireRole` 守卫；member 只看自己的会话与日志，viewer 只读禁对话 |
| 数据归属与概览 | 会话/日志打 `ownerId`/`actorId`；后台数据概览（请求/成功率/token/耗时/活跃成员）；记忆管理按成员筛选 |
| 操作留痕 | 审计日志 20 类动作、环形缓冲 2000 条、多维筛选 |
| 门户首页 `/` | 系统默认入口（原 `/home` 301 跳转至此）：功能介绍 + 登录/注册入口，登录态自适应 |
| 员工中心 `/me` | 基本信息、我的数据、我的登录记录、自助改密 |
| 对话增强 | Markdown 渲染（零依赖自研）+ 原文切换、消息点赞/差评、对话快照分享（`/s/:token`） |
| 手机端适配 | ≤720px App 壳布局：侧栏抽屉、输入区吸底、安全区适配 |
| 界面打磨 | 强度分段选择器、顶栏按钮胶囊化、输入框加高（64 ~ 220px 自适应）、品牌标识精简（去装饰性 logo 方块） |
| 工程 | db.json 原子写、`XFYUN_DATA_DIR` 数据目录可配置、API Key 可选 AES-256-GCM 加密（`DB_ENCRYPT_KEY`）、`npm test` 9 项核心用例 |

### V1.0 — 个人工作台

多会话/多配置/参数面板、运行日志与网络探测、记忆管理、后台+访客双密码、图片粘贴上传与多模态消息、联网搜索开关、多配置自动调度。

---

## 开源协议

本项目采用 [MIT License](./LICENSE)。

- 允许商用、修改、分发、私有化部署
- 需保留版权声明
- 软件按“原样”提供，不含任何明示或暗示的担保

> 使用本项目即表示你已阅读并同意讯飞星辰 MaaS 平台的服务条款；API Key 及调用产生的费用由使用者自行承担。

---

## 关于

- **开发方**：沧州虎王科技
- **当前版本**：V2.0（团队/企业版，2026-10-25）
- **技术栈**：Node.js（Express）+ 原生 HTML/CSS/JS，运行依赖仅 `express`
- **数据来源**：[讯飞星辰 MaaS 平台](https://maas.xfyun.cn/) 模型服务 API
- **文档参考**：[讯飞 MaaS 官方 API 文档](https://maas.xfyun.cn/doc-viewer)

欢迎 Issue 反馈与 PR 贡献。如果这个项目对你有帮助，点个 ⭐ 就是最大的支持。
