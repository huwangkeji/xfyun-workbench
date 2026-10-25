# 星火工作台 · xfyun-workbench

> 基于 **讯飞星辰 MaaS 平台模型服务 API** 开发的轻量级大模型对话工作台
> 由 **沧州虎王科技** 开发并开源

[![Node](https://img.shields.io/badge/Node-%3E%3D18-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Express](https://img.shields.io/badge/Express-4.x-000000?logo=express&logoColor=white)](https://expressjs.com/)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Deps](https://img.shields.io/badge/dependencies-1%20(express)-brightgreen.svg)](./package.json)

一个开箱即用的**星火大模型对话工作台**：前端零构建（原生 HTML/CSS/JS），后端仅依赖 Express，数据存本地 JSON 文件，**无需数据库、无需复杂部署**。适合个人开发者、小团队快速搭一个能对话、能管配置、能看日志、能留记录的私有工作台。

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
- [开源协议](#开源协议)
- [关于](#关于)

---

## 特性一览

### 工作台（前台 `/`）

| 功能 | 说明 |
| --- | --- |
| 多会话管理 | 新建 / 切换 / 删除 / 清空，会话自动以首条提问命名 |
| 多模型配置 | 顶部下拉随时切换不同 API 配置（不同 Key、不同模型、不同参数） |
| 文本对话 | Enter 发送、Shift+Enter 换行；自动滚动、输入区自适应高度 |
| **图片粘贴上传** | 支持 **Ctrl+V 粘贴**、**右键菜单粘贴**、**拖拽放入**、**文件选择** 四种方式 |
| 图片状态可见 | 缩略图预览 + 上传进度条；失败可点击重试、可单独移除；未完成的图片会阻止发送 |
| **联网搜索开关** | 一键开关，状态本地记忆，按次请求控制是否允许模型调用 `web_search` |
| 响应明细 | 气泡下方展示耗时、输入/输出/总 token、缓存命中、推理 token、结束原因、工具调用 |
| 思考过程兜底 | 模型只返回 `reasoning_content` 或 `tool_calls` 时也能完整展示，不会白屏 |
| 可选访客密码 | 后台可开启「工作台访问控制」，访客需输密码才能使用（开关式） |

### 后台管理（`/admin`，需密码登录）

| 功能 | 说明 |
| --- | --- |
| **API 配置** | 多配置增删改查、启用/禁用、设为默认、优先级排序、连通性一键测试 |
| 完整参数面板 | 系统提示、`temperature`、`top_p`、`max_completion_tokens`、双惩罚项、`enable_thinking`、`reasoning_effort`、联网搜索、`user`、`stream` |
| **运行日志** | 每次请求的模型、耗时、token、请求/响应、错误原因全记录，支持状态筛选 |
| **云中心延时** | 网络探测，直观看到各 API 端点的连通性与响应耗时 |
| **记忆管理** | 会话记录列表 + 关键字搜索 + 管理员备注 + 统计概览 + 导出（JSON / Markdown）+ 删除 |
| **工作台访问控制** | 设置/修改访客密码，开关密码保护 |
| 修改登录密码 | 修改后所有会话失效，需重新登录 |
| 图片生成设置 | 文生图（TTI）模型与参数配置（接口已就绪，生成界面开发中） |

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

- 工作台：<http://127.0.0.1:4000/>
- 后台管理：<http://127.0.0.1:4000/admin>

> 首次启动时控制台会**打印一次随机后台密码**，请留意保存。想自己指定：在 `.env` 里设 `ADMIN_PASSWORD=你的密码`（仅首次启动生效）。

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
│   ├── index.html            # 工作台
│   ├── login.html            # 工作台访客登录页
│   ├── admin.html            # 后台管理
│   ├── admin-login.html      # 后台登录页
│   ├── uploads/              # 粘贴上传的图片（按日期分目录，已在 .gitignore 中）
│   └── assets/
│       ├── app.js            # 工作台逻辑（对话 / 图片 / 联网）
│       ├── admin.js          # 后台逻辑（配置 / 日志 / 记忆管理）
│       └── style.css         # 全部样式
└── src/
    ├── xfyun.js              # 星辰 MaaS API 封装（非流式 / 流式 SSE / 文生图）
    ├── configService.js      # API 配置与全局设置的增删改查、参数校验
    ├── scheduler.js          # 多配置调度：优先级排序、失败切换、冷却
    ├── adminAuth.js          # 双密码体系（后台 + 访客）、scrypt 哈希、HMAC 会话
    ├── conversationService.js# 会话持久化、记忆检索
    ├── logService.js         # 运行日志
    ├── imageUtil.js          # 图片魔数探测与尺寸解析（零依赖）
    ├── env.js                # .env 解析（零依赖）
    ├── asyncHandler.js       # async 路由异常兜底
    ├── db.js                 # data/db.json 读写
    └── routes/
        ├── chat.js           # 对话代理（含图片内联、联网透传）
        ├── upload.js         # 图片上传
        ├── config.js         # API 配置
        ├── conversations.js  # 会话
        ├── admin.js          # 后台：登录 / 设置 / 记忆管理
        ├── workbench.js      # 工作台访客登录
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
| `ADMIN_SESSION_TTL_HOURS` | 否 | `12` | 后台会话有效期（小时） |

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

**工作台** — 左侧配置与会话列表，右侧对话区。输入区下方是图片预览条与提示语，头部右侧是联网搜索开关与状态行。

**后台管理** — 四个标签页：

| 标签页 | 用途 |
| --- | --- |
| API 配置 | 多配置维护、参数面板、连通性测试、设为默认 |
| 运行日志 | 请求全记录：模型、耗时、token、请求体、响应、错误 |
| 云中心延时 | 各端点连通性与响应耗时探测 |
| 记忆管理 | 会话记录搜索、备注、统计、导出、删除 |

---

## API 一览

| 方法 | 路径 | 说明 | 鉴权 |
| --- | --- | --- | --- |
| POST | `/api/chat` | 对话代理（支持 `configId` / `messages` / `stream` / `webSearch`） | 访客（可选） |
| POST | `/api/upload` | 图片上传（base64 JSON，落盘 `public/uploads`） | 访客（可选） |
| GET/POST/PUT/DELETE | `/api/configs` | API 配置管理（GET 开放，写操作需后台登录） | 后台 |
| POST | `/api/configs/:id/test` | 单配置连通性测试 | 后台 |
| GET | `/api/conversations` | 会话列表 | 访客（可选） |
| POST | `/api/conversations` | 新建会话 | 访客（可选） |
| GET | `/api/conversations/:id` | 会话详情 | 访客（可选） |
| POST | `/api/conversations/:id/messages` | 追加消息 | 访客（可选） |
| DELETE | `/api/conversations/:id/messages` | 清空消息 | 访客（可选） |
| POST | `/api/image/tti` | 文生图 | 访客（可选） |
| GET | `/api/logs` | 运行日志 | 后台 |
| GET/POST | `/api/network/ping`、`/ping-all` | 网络探测 | 后台 |
| GET | `/api/admin/memory` | 记忆管理（列表 / 搜索 / 统计） | 后台 |
| PUT | `/api/admin/memory/:id/note` | 保存管理员备注 | 后台 |
| GET | `/api/admin/memory/:id/export` | 导出会话（`?format=json|md`） | 后台 |
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

- **密钥**：API Key 只从环境变量 / `.env` / 后台配置读取，源码与仓库中不含任何密钥；`data/db.json`、`.env`、`public/uploads/` 均已在 `.gitignore` 中
- **后台密码**：scrypt 加盐哈希存储（`scrypt$1$<salt>$<hash>`），比对用 `timingSafeEqual`；同 IP 连续 5 次错误锁定 60 秒
- **会话**：HMAC 签名 Cookie（`v1.<过期时间>.<签名>`），`HttpOnly` + `SameSite=Lax`；修改密码后所有会话立即失效
- **访客密码**：与后台密码体系独立，后台登录态可放行工作台；开启后 `/uploads/` 图片同样受保护，未登录无法直链
- **上传校验**：魔数白名单 + 尺寸上限 + 目录穿越防护，不执行任何上传文件

> 部署建议：本项目定位为**本地 / 内网工具**。若要放到公网，请务必开启工作台密码、设置强后台密码，并置于 HTTPS 反向代理之后。

---

## 常见问题

**Q：启动后提示“未启用任何可用 API 配置”？**
A：去后台「API 配置」添加一个配置，或在 `.env` 里填好 `XFYUN_API_KEY` 与 `XFYUN_MODEL` 后重启。

**Q：后台密码忘了？**
A：在 `.env` 设 `ADMIN_PASSWORD=新密码` 和 `ADMIN_PASSWORD_RESET=1`，重启后生效（记得用完把 RESET 改回 0）。

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

- [x] 多会话 / 多配置 / 参数面板
- [x] 运行日志与网络探测
- [x] 记忆管理（搜索 / 备注 / 导出）
- [x] 后台与工作台双密码体系
- [x] 图片粘贴上传与多模态消息
- [x] 联网搜索开关
- [ ] 文生图工作台界面（接口与后台设置已就绪）
- [ ] 流式输出的逐字渲染（SSE 接口已打通）
- [ ] 对话导出 / 导入、Markdown 代码高亮
- [ ] Docker 镜像与一键部署脚本

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
- **技术栈**：Node.js（Express）+ 原生 HTML/CSS/JS，运行依赖仅 `express`
- **数据来源**：[讯飞星辰 MaaS 平台](https://maas.xfyun.cn/) 模型服务 API
- **文档参考**：[讯飞 MaaS 官方 API 文档](https://maas.xfyun.cn/doc-viewer)

欢迎 Issue 反馈与 PR 贡献。如果这个项目对你有帮助，点个 ⭐ 就是最大的支持。
