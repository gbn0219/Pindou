# 用户中心与付费解锁（登录 / 个人中心 / 图库 / 邀请码 / AI 解锁）设计文档

> 日期：2026-08-05（Asia/Shanghai）
> 状态：**待评审**（本文件为设计稿；评审通过后才进入实施计划与编码）
> 关联：`docs/superpowers/specs/2026-08-03-two-mode-generation-design.md`（AI/照片生成管线前身，本文不改变生成算法）

## 1. 背景与问题

现状：小程序共四页、无 tabBar、无账号体系；AI 生成已接入（本地代理 / 云函数 `ai-generate-pattern`），但主页弹窗虽宣称"按次计费"，实际没有任何登录、计费或门禁；生成的图纸只在内存 `globalData.pattern` 中流转，无保存、无用户维度数据。

本次要新增的能力：

1. 底部菜单栏：左侧为现有主页面，右侧为"我的"个人中心。
2. 微信登录（标准微信登录，云开发 openid 即用户身份）。
3. 个人中心：头像昵称、邀请码输入、图库入口。
4. 图库：保存"原始图片 – 生成图纸"对，展示生成时间、风格等，点击图片可保存到相册。
5. AI 生成门禁：仅登录用户可用；生成后可免费预览但**不可交互**（不可查看色号、放大、修改、导出）；每张原图最多生成 3 次，从中挑一张付费解锁后进入完整交互。
6. 邀请码 `GBNLY99`：输入后免费使用全部功能。

## 2. 目标

1. 普通用户（未登录）：照片还原全功能免费可用，行为与现状一致；AI 生成需登录。
2. 登录用户：AI 生成可用，每张原图免费预览上限 3 次；未解锁只能看纯色图，不能查看色号/缩放/修改/导出。
3. 付费（或邀请码）用户：选定图纸永久解锁，完整交互（色号、缩放、修改、导出）可用，导出/解锁结果自动进入图库。
4. 图库可随时回看并重新保存原图/图纸到相册。
5. 邀请码 `GBNLY99` 用户在服务端校验，成功后永久免费使用全部功能。

## 3. 关键决策（评审重点）

| # | 决策 | 默认值 | 说明 |
| --- | --- | --- | --- |
| 1 | 账号底座 | 微信云开发（现有 envId `release-b86096`），`openid` 即用户身份 | 与现有 `wx.cloud.init`、云函数体系一致，不引入独立后端；云函数内 `cloud.getWXContext().OPENID` 即"标准微信登录" |
| 2 | 底部菜单栏 | 原生 tabBar，两项：`首页`（`page/index/index`）、`我的`（`page/profile/index`），纯文字无图标 | 官方 tabBar 允许无 iconPath；crop / pattern / pattern-edit 仍为子页面，`navigateTo` 跳转不受影响 |
| 3 | 头像昵称 | 官方"头像昵称填写能力"：`<button open-type="chooseAvatar">` + `<input type="nickname">` | `wx.getUserProfile` 已废弃（2022 年后返回匿名数据），不再使用 |
| 4 | AI 生成次数 | 每用户每张原图（`imageHash`）最多 3 次免费生成；邀请码用户不限制 | `imageHash` 由客户端对压缩后原图计算 FNV-1a 64 位哈希，服务端以 `(openid, imageHash)` 计次 |
| 5 | 解锁单位 | 一次解锁 = 一张 AI 图纸永久交互权限（`ai_sessions.unlocked`） | 与新图再次生成互不影响；新图仍需走"3 次预览 → 付费解锁" |
| 6 | 图库入库时机 | AI 模式：**解锁成功时自动入库**（原图 + 带色号图纸图）；照片还原：**导出成功时入库**（仅登录用户） | 理由见 5.5；备选方案 B（全部导出时入库）见决策表下说明 |
| 7 | 付费实现 | 支付模块抽象 `PAY_MODE=mock \| wechatpay`（云函数环境变量）；默认 `mock`（模拟支付即解锁，用于联调/试运行） | 真实微信支付需要主体认证、类目与商户号资质（见 10.2），接入点已预留 |
| 8 | 价格 | `UNLOCK_PRICE` 环境变量，默认 `100`（分，即 ¥1.00/张） | 改环境变量即可调整 |
| 9 | 本地 AI 服务 | 仅开发用：local 模式下客户端先经云函数消费配额，再调本地服务；本地服务不校验 | 生产路径（cloud 模式）在云函数内校验配额，见 7 |

备选方案 B（图库入库时机）：所有模式统一在"导出成功时"入库。缺点：AI 用户解锁后若未导出即退出小程序，`globalData` 清空导致图纸丢失（与现状一致），图库无法保证"所有生成过的都保存"。故默认采用方案 A。

## 4. 总体架构

```
小程序（原生 JS）
  ├─ 首页（tab）       照片还原（离线免费）/ AI 生成（登录 + 配额 + 解锁）
  ├─ 我的（tab）       登录、头像昵称、邀请码、图库入口
  ├─ 裁剪 / 图纸展示 / 图纸修改（子页面）
  └─ utils/user.js     wx.cloud.callFunction 封装
          │
          ▼
云函数
  ├─ account   login / getProfile / saveProfile / applyInvite
  ├─ access    consumeQuota / checkAccess / createOrder / unlock
  ├─ gallery   save / list
  └─ ai-generate-pattern（改造）  登录校验 + 配额校验（cloud 模式）
          │
          ▼
云数据库：users / ai_sessions / gallery / orders（预留）
云存储：gallery/<openid>/…、avatars/<openid>/…

AI 生成后端（保留现有双后端）：
  local  → tools/ai-generate-server.js（开发用，不校验）
  cloud  → 云函数 ai-generate-pattern（生产路径，服务端校验）
```

## 5. 功能设计

### 5.1 底部菜单栏

`app.json` 新增：

```json
"tabBar": {
  "color": "#8a8f98",
  "selectedColor": "#2f6fed",
  "backgroundColor": "#ffffff",
  "borderStyle": "black",
  "list": [
    { "pagePath": "page/index/index", "text": "首页" },
    { "pagePath": "page/profile/index", "text": "我的" }
  ]
}
```

- 纯文字 tabBar（官方允许无图标），不引入图标资源。
- `page/profile/index` 新页面注册进 `pages`，并作为 tab 页。
- 注意：tab 页之间用 `wx.switchTab`，不能 `navigateTo`；crop / pattern / pattern-edit 保持普通子页面，`navigateTo` / `navigateBack` 不受影响。
- 新增 tabBar 后，开发者工具重新编译即可在首页看到底部栏；模拟器里需检查首页内容不被 tabBar 遮挡（首页外层 `page` 底部留安全间距）。

### 5.2 微信登录与头像昵称

**登录（标准微信登录）**

- 本项目使用云开发：客户端调 `wx.cloud.callFunction({ name: 'account', data: { action: 'login' } })`，云函数内 `cloud.getWXContext().OPENID` 直接获得当前用户身份（等价于 `wx.login → code2session` 的 openid 环节，云开发自动完成）。
- 云函数首次见到该 openid 时写入 `users` 记录，之后返回用户资料；客户端把结果存 `getApp().globalData.user` 并缓存 `wx.setStorageSync('user')`，`app.js onLaunch` 恢复登录态。
- 若未来脱离云开发，可改为 `wx.login()` 拿 code → 自有后端调 `code2session`；本文不采用。

**头像昵称（官方填写能力，2026 现行做法）**

- 头像：`<button open-type="chooseAvatar" bindchooseavatar="onChooseAvatar">`，回调拿到临时路径 → 上传云存储 `avatars/<openid>/avatar.<ext>` → `account.saveProfile` 保存 `avatarFileID`。
- 昵称：`<input type="nickname" bindblur="onNicknameBlur">`，失焦保存到 `users.nickname`。
- 不再调用 `wx.getUserProfile` / `wx.getUserInfo`。

### 5.3 个人中心页（`page/profile/index`）

- **未登录态**：居中展示"微信一键登录"按钮。点击 → `account.login`（云开发自动获得 openid，无需弹授权）→ 成功后刷新为已登录态。
- **已登录态**：
  - 头像 + 昵称（点击头像可更换，点击昵称可编辑，即 5.2 的两个组件）。
  - 邀请码区块：输入框 + "激活"按钮；已激活用户显示"邀请码用户 · 全部功能免费"徽标。
  - 图库入口卡片：`navigateTo /page/gallery/index`，右上角显示图库数量（`gallery.count` 可选，首版可省略）。
  - 账号信息：openid 后 6 位（用于反馈/排查）。
- 样式沿用 `styles/tokens.wxss`（Hum 设计令牌）。

### 5.4 邀请码

- 客户端把输入框内容传给 `account.applyInvite { code }`。
- 服务端常量 `INVITE_CODE = 'GBNLY99'`（可改环境变量），命中后置 `users.freeVip = true`（幂等），返回成功；否则返回"邀请码无效"。
- `freeVip` 生效范围：AI 生成不限次数、解锁图纸免付费、全功能免费。该状态只存服务端，客户端仅展示。

### 5.5 图库（`page/gallery/index`）

**入库内容与时机**

- AI 模式：**解锁成功时自动入库**。解锁后客户端立即渲染一张带色号的图纸图（复用 `pattern.renderExport` 逻辑，与导出图一致），连同原始图一起上传云存储，再调 `gallery.save` 写记录。这样"所有生成过并确定的图纸"都能保存，且用户重启小程序也不丢失。
- 照片还原：**导出成功时入库**（登录用户）。导出成功 → 上传原图 + 导出图 → `gallery.save`。未登录用户照常导出，仅提示"登录后可保存到图库"，不入库。
- 一条图库记录 = 一个"原始图 – 图纸图"对（两张文件）。

**图库记录字段**

`gallery` 集合：`_openid`、`originalFileID`、`patternFileID`、`mode`（`photo | ai`）、`style`（风格名/自定义文本）、`size`（盘面）、`set`（色系）、`sessionId`（AI 专属，可空）、`createdAt`。

**列表页**

- 每项卡片：左侧原始图缩略、右侧图纸图缩略；下方显示生成方式 + 风格、盘面/色系、生成时间（格式化 `YYYY-MM-DD HH:mm`）。
- 数据：`gallery.list` 云函数按 `_openid` 倒序、按页返回（每页 PAGE_SIZE 条，默认 10，两列网格设计为一屏内不滚动放下），返回 `{ items, total }`，`items` 直接带 `fileID`；前端 `<image src="cloud://…">` 直接渲染缩略图，无需临时 URL。
- 分页控件：图库页整体（列表 + 分页条）不滚动、一屏放下；底部固定"上一页 + 页码条 + 下一页"，页码窗口为当前页 ±2 并固定首尾页，跳过的页码用 … 省略；点击页码 / 上一页 / 下一页跳转（首页禁用"上一页"，末页禁用"下一页"）。
- 点击"原图"或"图纸"缩略图 → `wx.showModal` 确认"保存到相册？" → `wx.cloud.downloadFile({ fileID })` 拿到本地临时文件 → `wx.saveImageToPhotosAlbum`（含权限拒绝处理，复用展示页现有逻辑）。
- 空态：提示"还没有图纸，去首页生成一张吧"。

### 5.6 AI 生成门禁与预览 / 解锁流程

**状态机（每张原图一次会话）**

```
未登录：点"生成图纸" → 弹窗"AI 生成需先登录" → switchTab 到"我的"
已登录（新会话）：consumeQuota（attempts 1/3）→ 生成 → 锁定预览
锁定预览：仅纯色图（无编号、无色号清单、无网格选项、无缩放/拖动/修改/导出）
  ├─ 再生成（attempts < 3）→ 生成下一张候选
  ├─ 换一张 → 在已生成候选中切换
  └─ 解锁并交互 → createOrder → 支付（mock / 微信支付）→ unlock → 完整交互 + 自动入库
已解锁：色号、缩放、修改、导出全部可用
attempts = 3 且未解锁：禁用再生成，提示"已用尽 3 次，请解锁一张或更换图片"
```

**会话与候选**

- 首次 AI 生成时客户端创建会话：`sessionId = openid + '_' + Date.now() + '_' + random`，`imageHash` = 压缩后原图 base64 的 FNV-1a 64 位哈希（`utils/hash.js` 纯函数）。
- 候选结果只存内存：`getApp().globalData.aiSession = { sessionId, imageHash, candidates: [{ grid, style, size, set }], used }`（3 张 104×104 grid 约 100KB，可接受；不持久化）。
- 每次生成成功后写入候选数组并进入锁定预览；"换一张"在候选中切换并重绘。
- 服务端 `ai_sessions` 记录：`{ _openid, sessionId, imageHash, attempts, unlocked, createdAt, updatedAt }`，用于配额与解锁状态持久化。

**锁定预览页（改造展示页 `page/pattern/index`）**

- `globalData.pattern` 增加 `locked: true` 字段；pattern 页 `onLoad` 读取：
  - `locked=true` 时：canvas 只画纯色图纸（`renderGrid` 传 `code:false` 且不显示编号），不绑定双指手势（不触发缩放/拖动），隐藏网格选项、色号清单（legend）、"进入修改/导出图纸"按钮；显示"预览中 · 第 n/3 张"。
  - 操作栏三按钮：`再生成（剩 x 次）`、`换一张`、`解锁并交互`。
- "再生成"：调用 `access.consumeQuota { sessionId, imageHash }` 校验并计数（cloud 模式由 `ai-generate-pattern` 统一校验；local 模式客户端先行调用）→ 成功后复用现有 `runAiGenerate` 流程生成新候选。
- "解锁并交互"：`access.createOrder { sessionId }` → 按 `PAY_MODE` 走支付（见 5.8）→ `access.unlock { sessionId }` → 本地把 `locked` 置 false → 重绘为完整交互模式，并立即自动入库（5.5）。
- 重启小程序后 `aiSession` 丢失：若该会话已解锁，服务端 `unlocked=true`，但 grid 在客户端已丢失（与现状 `globalData.pattern` 行为一致）；已入库的图库记录不受影响。文档在 9 注明该边界。

**主页（`page/index/index`）AI 入口改动**

- 点"生成图纸"且 `mode='ai'`：先 `ensureLogin()`，未登录弹窗跳"我的"；已登录弹确认框，文案改为"AI 生成 · 每张图片免费预览最多 3 次，解锁后完整交互（按次收费）"，确认后走生成。
- 生成调用携带 `sessionId / imageHash / attempts` 上下文。

### 5.7 照片还原模式

- 不要求登录、不限制次数、不收任何费用，行为与现状完全一致。
- 唯一新增：登录用户导出成功后自动入库（5.5），未登录用户导出成功时 toast 提示"登录后可保存到图库"。

### 5.8 付费设计

**订单与解锁**

- `access.createOrder { sessionId }` → 写 `orders` 记录 `{ _openid, sessionId, amountFen: UNLOCK_PRICE, status: 'pending', createdAt }`。
- `PAY_MODE=mock`（默认，开发/试运行）：`createOrder` 直接返回 `{ paid: true }` 并标记订单 `paid`，前端提示"支付成功（模拟）"；适合无商户号阶段跑通全流程。
- `PAY_MODE=wechatpay`：云函数用 `cloud.cloudPay.unifiedOrder`（JSAPI 下单，需配置商户号 `subMchId` 等）→ 返回支付参数 → 前端 `wx.requestPayment` → 云开发支付回调云函数确认订单 → 调 `access.unlock` 置 `unlocked=true`。
- 邀请码用户：`createOrder` 检测 `freeVip=true` 直接返回成功，不产生真实扣款。

**金额**

- `UNLOCK_PRICE` 环境变量（分），默认 `100`（¥1.00/张）。改环境变量即可调价，无需改代码。

## 6. 数据设计

**云数据库集合**

| 集合 | 字段 | 说明 |
| --- | --- | --- |
| `users` | `_openid, nickname, avatarFileID, freeVip, inviteCode, createdAt, updatedAt` | 用户资料；`freeVip` 仅服务端修改 |
| `ai_sessions` | `_openid, sessionId, imageHash, attempts, unlocked, createdAt, updatedAt` | 每张原图一次会话；`attempts` 1~3 |
| `gallery` | `_openid, originalFileID, patternFileID, mode, style, size, set, sessionId(可空), createdAt` | 图库一对记录 |
| `orders` | `_openid, sessionId, amountFen, status(pending/paid), payNo(可空), createdAt, paidAt` | 支付订单（预留真实支付） |

**云存储路径**

```
gallery/<openid>/<ts>_original.<jpg|png>
gallery/<openid>/<ts>_pattern.png
avatars/<openid>/avatar.<jpg|png>
```

上传走客户端 `wx.cloud.uploadFile`（原图/图纸/头像均为客户端本地文件），文件 ID 回填云函数写记录。

**数据库选型与容量估算（按每用户 100 张）**

- 数据库选型：微信云开发文档型数据库（MongoDB 兼容 NoSQL，`wx.cloud.database` / wx-server-sdk），`gallery` 集合一条记录对应一张图纸；不引入自建后端或关系型数据库。
- 索引：`gallery` 建 `_openid + createdAt` 复合索引（云开发控制台创建），列表查询按该索引倒序；`ai_sessions` 建 `_openid + imageHash` 索引，配额查询命中索引。
- 分页：`gallery.list` 用 `limit(PAGE_SIZE)` + `skip((page - 1) * PAGE_SIZE)` 按页查询，并 `count` 总数计算 `totalPages`；每用户 100 张 / 每页 10 条 = 10 页，单页查询毫秒级。新增数据导致的翻页漂移在该量级可忽略（不做游标）。
- 文档量估算（每用户 100 张）：`gallery` ≤ 100、`ai_sessions` ≤ 300（每图最多 3 次生成）、`orders` ≤ 100，单用户合计 ≤ 500 条；万级用户也只有百万条量级，靠索引完全够用——数据库文档数不是瓶颈。
- 存储容量才是关键：数据库只存 `fileID`，图片二进制放云存储。原图上传前压缩到 ≤1280px JPEG（复用现有 canvas 压缩思路，估算 200~500KB/张）；图纸 PNG 为纯色块、压缩率高（估算 200~800KB/张）。每对 ≈ 0.5~1.3MB，每用户 100 张 ≈ 50~130MB。云开发存储按套餐计费、免费额度有限，正式运营按「用户数 × 100 × 单张均值」核算存储用量并升配；文档数不受影响。

**安全规则**

- 云数据库各集合使用默认"仅创建者可读写"（`_openid` 自动限定本人数据）。
- 云存储在控制台配置"仅登录用户可读写"级别规则；具体表达式以控制台当前支持的规则语法为准，部署时配置并验证。

## 7. 后端设计

**新增云函数**

| 云函数 | action | 请求 | 响应 | 说明 |
| --- | --- | --- | --- | --- |
| `account` | `login` | `{}` | `{ user }` | 从上下文拿 OPENID，upsert `users` |
| `account` | `getProfile` | `{}` | `{ user }` | 读当前用户 |
| `account` | `saveProfile` | `{ nickname?, avatarFileID? }` | `{ user }` | 更新资料 |
| `account` | `applyInvite` | `{ code }` | `{ user }` | 校验 `GBNLY99` → `freeVip=true` |
| `access` | `consumeQuota` | `{ sessionId, imageHash }` | `{ ok, attempts, remaining }` | 计数；`freeVip` 跳过；attempts > 3 拒绝 |
| `access` | `checkAccess` | `{ sessionId }` | `{ unlocked, freeVip }` | 解锁状态查询 |
| `access` | `createOrder` | `{ sessionId }` | `{ paid, orderId?, payParams? }` | mock 直接成功；wechatpay 返回支付参数 |
| `access` | `unlock` | `{ sessionId }` | `{ ok }` | 校验订单已支付或 `freeVip` → `unlocked=true` |
| `gallery` | `save` | `{ originalFileID, patternFileID, mode, style, size, set, sessionId? }` | `{ ok }` | 写图库记录 |
| `gallery` | `list` | `{ page, pageSize? }` | `{ items, total, totalPages }` | 本人倒序按页查询；`items` 含 `fileID`，前端直接渲染/下载 |

**改造 `ai-generate-pattern`（cloud 模式）**

- 入口用 `cloud.getWXContext().OPENID` 校验登录（未登录返回 `{ error: '请先登录' }`）。
- 校验配额：`freeVip` 直接放行；否则按 `(openid, imageHash)` 检查/累加 `ai_sessions.attempts`，超过 3 次拒绝（返回明确错误文案）。
- 其余生成逻辑不变。

**改造 `tools/ai-generate-server.js`（local 模式，开发用）**

- `POST /ai-generate` 请求体增加 `openid / sessionId / imageHash` 字段，仅记入日志；不做配额校验（文档明确标注为开发期安全风险，生产必须 cloud 模式）。
- 客户端在 local 模式下先生成/消费配额（`access.consumeQuota`），再请求本地服务。

**环境变量**

- `account` / `access` / `gallery`：`PAY_MODE`（默认 mock）、`UNLOCK_PRICE`（默认 100）、`INVITE_CODE`（默认 GBNLY99）。
- `ai-generate-pattern`：沿用 `ARK_API_KEY`、`ARK_MODEL`。
- `wechatpay` 模式追加：`SUB_MCH_ID` 等商户号参数（接入时按云开发 cloudPay 文档配置）。

## 8. 前端改动

| 文件 | 动作 | 说明 |
| --- | --- | --- |
| `miniprogram/app.json` | 改 | 注册 `page/profile/index`、`page/gallery/index`；新增 tabBar |
| `miniprogram/app.js` | 改 | `globalData.user`、`restoreLogin()`、`ensureLogin()` |
| `miniprogram/utils/user.js` | 新建 | 云函数调用封装（account/access/gallery） |
| `miniprogram/utils/hash.js` | 新建 | FNV-1a 64 哈希（纯函数，node 可测） |
| `miniprogram/utils/session.js` | 新建 | AI 会话候选管理：addCandidate/switchCandidate/usedCount（纯函数，node 可测） |
| `miniprogram/page/index/index.js/.wxml/.wxss` | 改 | AI 入口登录校验 + 会话参数 + 计费文案 |
| `miniprogram/page/pattern/index.js/.wxml/.wxss` | 改 | `locked` 模式（纯色预览、禁手势、隐藏交互、三按钮）；解锁后完整模式；导出成功后入库 |
| `miniprogram/page/profile/index.*` | 新建 | 登录、头像昵称、邀请码、图库入口 |
| `miniprogram/page/gallery/index.*` | 新建 | 图库列表（分页控件：上一页/页码/下一页）、点击保存 |
| `miniprogram/page/pattern-edit/index.*` | 不改（入口已在展示页控制） | — |
| `miniprogram/config.js` | 不改（后端仍由 `aiGenerate.backend` 决定） | — |

## 9. 错误处理与边界

- 未登录点 AI 生成：弹窗提示并 `wx.switchTab` 到"我的"。
- 配额用尽：`consumeQuota` 返回明确错误"已达该图片免费生成上限（3 次），请解锁一张或更换图片"，前端禁用"再生成"。
- AI 生成失败：沿用现有重试与错误提示逻辑（本地服务未启动/域名校验/超时等文案不变）。
- 支付取消/失败（wechatpay 模式）：订单保持 `pending`，前端提示"支付未完成，可稍后重试"；mock 模式不出现。
- 上传失败/图库写入失败：解锁与导出流程不阻断（图纸仍可交互），toast 提示"图纸已解锁，但保存到图库失败，可在下次导出时重试"；照片还原导出照常成功。
- 重启小程序：`aiSession`（候选）与 `globalData.pattern` 不持久化，与现状一致；已解锁并入库的图库记录不受影响；未入库的已解锁图纸会丢失（提示用户解锁后及时导出/已自动入库）。
- 云函数统一返回 `{ ok: true, ... }` 或 `{ ok: false, code, msg }`，前端按 `ok` 分支处理，避免抛错风暴。

## 10. 风险与说明

### 10.1 本地 AI 服务的安全边界

local 模式不校验 openid/配额，仅开发联调用；任何上线环境必须用 cloud 模式（云函数内校验）。文档与代码注释需醒目标注。

### 10.2 付费合规（重要，需评审确认）

- 小程序内对"AI 解锁"收费属于虚拟服务收费：正式接入微信支付前必须确认——小程序已完成主体认证（非个人主体）、当前类目符合虚拟支付开放范围、已开通微信支付商户号并完成绑定。
- 若上述资质未就绪，默认以 `PAY_MODE=mock` + 邀请码模式运行（不真实扣款），等资质就绪再切 `wechatpay`；本设计已把支付收敛到 `access` 云函数内，切换成本低。
- iOS 端虚拟支付限制严格，wechatpay 上线前需单独核验 iOS 策略。

### 10.3 客户端可绕过性

图纸 grid 在客户端渲染，纯前端无法做到防破解；服务端负责登录/配额/解锁/订单的正确记账，前端锁定为普通用户的付费门槛。商业级防盗版不在本次范围。

### 10.4 图片哈希防作弊

`imageHash` 由客户端计算（FNV-1a，非加密哈希），刻意绕过可换哈希换次数；对普通用户有效。如需更强约束，后续可改为服务端哈希或限制每日生成总数，本次不做。

## 11. 文件改动清单

| 文件 | 动作 |
| --- | --- |
| `miniprogram/app.json` | 改：页面注册 + tabBar |
| `miniprogram/app.js` | 改：登录态 |
| `miniprogram/utils/user.js` | 新建 |
| `miniprogram/utils/hash.js` | 新建 |
| `miniprogram/utils/session.js` | 新建 |
| `miniprogram/page/index/index.js / .wxml / .wxss` | 改 |
| `miniprogram/page/pattern/index.js / .wxml / .wxss` | 改：锁定预览 + 入库 |
| `miniprogram/page/profile/index.js / .wxml / .wxss / .json` | 新建 |
| `miniprogram/page/gallery/index.js / .wxml / .wxss / .json` | 新建 |
| `cloudfunctions/account/` | 新建 |
| `cloudfunctions/access/` | 新建 |
| `cloudfunctions/gallery/` | 新建 |
| `cloudfunctions/ai-generate-pattern/index.js` | 改：登录 + 配额校验 |
| `tools/ai-generate-server.js` | 改：接收并记录 openid/sessionId/imageHash |
| `tests/user.test.js` | 新建：hash / session 候选 / 配额纯函数 |
| `tests/ai.test.js` | 改：若 `imageHash` 相关纯函数变更 |
| `AGENTS.md`、`docs/项目结构与开发说明.md` | 改：同步新页面与云函数 |
| `docs/superpowers/specs/2026-08-05-user-center-login-gallery-design.md` | 新建（本文件） |

## 12. 验证方案

1. 单测：`node tests/color.test.js && node tests/pattern.test.js && node tests/ai.test.js && node tests/user.test.js` 全通过；新增/修改 JS 全部 `node --check`。
2. 云函数：本地部署/云端部署后，`account.login` 返回 openid；`applyInvite` 正确/错误码各测一次；`consumeQuota` 第 4 次拒绝。
3. 开发者工具编译通过；模拟器验证：
   - tabBar 两页切换正常；crop/pattern/pattern-edit 子页面跳转返回正常。
   - 未登录点 AI 生成 → 跳"我的"；登录后返回可生成。
   - AI 生成 3 次：第 1~3 次为锁定预览（纯色、无编号、无图例、禁手势、无导出）；第 3 次后"再生成"禁用。
   - 邀请码 `GBNLY99` 激活后：生成不限次、解锁免费、图库可入。
   - mock 支付解锁 → 完整交互（色号/缩放/修改/导出）恢复；图库出现该"原图-图纸"对，点击可保存到相册。
   - 图库分页：100 条数据每页 10 条共 10 页；上一页/下一页/页码跳转正确，首页禁用"上一页"、末页禁用"下一页"，缩略图用 `fileID` 直接渲染。
   - 照片还原：未登录导出正常但提示登录入库；登录后导出自动入库。
4. 真机验证：mock 模式全流程；wechatpay 模式需商户号就绪后另行验证 `wx.requestPayment`。
