# 用户中心与付费解锁（登录 / 个人中心 / 图库 / 邀请码 / 创意生成解锁）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按设计文档 `docs/superpowers/specs/2026-08-05-user-center-login-gallery-design.md` 实现：底部双 tab（首页/我的）、微信登录（云开发 openid）、个人中心（头像昵称/邀请码/图库入口）、图库（页码分页）、创意生成门禁（登录 + 每图最多 3 次免费预览）、付费解锁（mock 支付）与自动入库。

**Architecture:** 云开发账号底座（`openid` 即用户身份）；新增云函数 `account` / `access` / `gallery`；`ai-generate-pattern`（cloud 模式）增加登录 + 配额校验；前端新增 `page/profile`（tab）、`page/gallery`，改造 `page/index` 与 `page/pattern`（锁定预览/解锁/自动入库）。

**Tech Stack:** 微信小程序原生 JS（无 TS、无 npm 依赖）、`wx-server-sdk` 云函数、node 无框架断言单测。

**风格约束（基于现有代码风格）：** 中文注释；纯函数放 `miniprogram/utils/*.js` 并在 `tests/*.test.js` 用 `assert` 测试；页面样式 `@import` `styles/tokens.wxss`；云函数与 `ai-generate-pattern` 同构（`index.js` + `package.json` 声明 `wx-server-sdk ~2.6.3`）；每次改 JS 后 `node --check`。用户可见文案沿用「创意生成」（审查要求，不出现 AI 字样）。

**当前基线（2026-08-06 已确认）：** `config.envId = cloud1-d3g6k7nsb31604d78`；`aiGenerate.backend = 'cloud'`；`utils/ai.js` 有云函数超时自动重试（`CLOUD_RETRY_MAX=2`、`isTimeoutError`、`onRetry`）；`page/index` 生成流程为 `generateByAi -> runAiGenerate -> compressToBase64 -> callAiGenerate -> imageToGrid -> finish`。

---

### Task 1: 哈希 / 会话候选 / 分页窗口纯函数 + 单测

**Files:**
- Create: `miniprogram/utils/hash.js`
- Create: `miniprogram/utils/session.js`
- Create: `miniprogram/utils/pager.js`
- Create: `tests/user.test.js`

- [ ] **Step 1: 写失败测试 `tests/user.test.js`**

```js
// tests/user.test.js
/**
 * 用户中心纯函数测试：图片哈希 / 创意生成会话候选 / 分页页码窗口。
 * 运行：node tests/user.test.js
 */
const assert = require('assert')
const hash = require('../miniprogram/utils/hash.js')
const session = require('../miniprogram/utils/session.js')
const pager = require('../miniprogram/utils/pager.js')

const h1 = hash.fnv1a64('abc')
assert.strictEqual(h1, hash.fnv1a64('abc'), '同输入同输出')
assert.notStrictEqual(h1, hash.fnv1a64('abd'), '不同输入不同输出')
assert.match(h1, /^[0-9a-f]{16}$/, '16 位十六进制')

let s = session.createSession(h1)
assert.strictEqual(s.candidates.length, 0, '初始无候选')
assert.strictEqual(session.canGenerate(s), true, '初始可生成')
s = session.addCandidate(s, [['A1']])
s = session.addCandidate(s, [['A2']])
s = session.addCandidate(s, [['A3']])
assert.strictEqual(session.canGenerate(s), false, '3 次后不可再生成')
assert.deepStrictEqual(session.switchCandidate(s, 1).index, 1, '可切换到已生成候选')
assert.deepStrictEqual(session.switchCandidate(s, 1).candidates[1], [['A2']], '候选内容保留')
assert.throws(() => session.switchCandidate(s, 3), /下标越界/, '越界抛错')
assert.match(s.sessionId, /^\d+_[a-z0-9]{6}$/, 'sessionId 格式')

assert.deepStrictEqual(pager.pageWindow(1, 1), [1], '单页')
assert.deepStrictEqual(pager.pageWindow(3, 2), [1, 2, 3], '3 页无省略')
assert.deepStrictEqual(pager.pageWindow(10, 1), [1, 2, 3, '...', 10], '首页窗口')
assert.deepStrictEqual(pager.pageWindow(10, 10), [1, '...', 8, 9, 10], '末页窗口')
assert.deepStrictEqual(pager.pageWindow(10, 5), [1, '...', 3, 4, 5, 6, 7, '...', 10], '中间页窗口')

console.log('user.test.js 全部通过 \u2713')
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node tests/user.test.js`
Expected: FAIL（module not found / fnv1a64 is not a function）

- [ ] **Step 3: 实现三个纯函数模块**

```js
// miniprogram/utils/hash.js
/**
 * 图片哈希：FNV-1a 双种子，输出 16 位十六进制。
 * 用于按 (openid, imageHash) 统计创意生成次数；非加密哈希，防作弊能力有限（见设计文档 10.4）。
 */
function fnv1a(str, seed) {
  let h = seed >>> 0
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}
function fnv1a64(str) {
  const a = fnv1a(str, 0x811c9dc5)
  const b = fnv1a(str, 0xcbf29ce4)
  return ('00000000' + a.toString(16)).slice(-8) + ('00000000' + b.toString(16)).slice(-8)
}
module.exports = { fnv1a64 }
```

```js
// miniprogram/utils/session.js
/**
 * 创意生成会话：每张原图最多 MAX_CANDIDATES 次候选，候选只存内存（globalData.aiSession）。
 */
const MAX_CANDIDATES = 3
function genId() {
  return Date.now() + '_' + Math.random().toString(36).slice(2, 8)
}
function createSession(imageHash) {
  return { sessionId: genId(), imageHash, candidates: [], index: 0, used: 0 }
}
function addCandidate(s, grid) {
  const candidates = s.candidates.concat([grid])
  return Object.assign({}, s, { candidates, index: candidates.length - 1, used: candidates.length })
}
function switchCandidate(s, i) {
  if (i < 0 || i >= s.candidates.length) throw new Error('候选下标越界')
  return Object.assign({}, s, { index: i })
}
function canGenerate(s) {
  return s.candidates.length < MAX_CANDIDATES
}
module.exports = { MAX_CANDIDATES, createSession, addCandidate, switchCandidate, canGenerate }
```

```js
// miniprogram/utils/pager.js
/**
 * 页码窗口：当前页 ±2 + 固定首尾页，跳过页码用 '...' 占位。
 */
function pageWindow(total, current, span) {
  if (total <= 1) return [1]
  const s = span || 2
  const set = new Set([1, total])
  for (let i = current - s; i <= current + s; i++) {
    if (i >= 1 && i <= total) set.add(i)
  }
  const sorted = Array.from(set).sort((a, b) => a - b)
  const out = []
  let prev = 0
  for (const n of sorted) {
    if (n - prev > 1) out.push('...')
    out.push(n)
    prev = n
  }
  return out
}
module.exports = { pageWindow }
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node tests/user.test.js`
Expected: PASS（`user.test.js 全部通过 ✓`）

- [ ] **Step 5: 语法检查并提交**

Run: `node --check miniprogram/utils/hash.js`（以及 session.js、pager.js）
Expected: 无输出

Run:
```
git add tests/user.test.js miniprogram/utils/hash.js miniprogram/utils/session.js miniprogram/utils/pager.js
git commit -m "feat: 图片哈希/创意生成会话候选/分页窗口纯函数（含单测）"
```

---

### Task 2: 云函数调用封装 `miniprogram/utils/user.js`

**Files:**
- Create: `miniprogram/utils/user.js`

- [ ] **Step 1: 实现封装**

```js
// miniprogram/utils/user.js
/**
 * 用户中心云函数封装：account / access / gallery。
 * 统一返回 { ok:true, ... } 或 { ok:false, code, msg }；错误以 Error 抛出（err.code 可判型）。
 */
function call(name, action, data) {
  return wx.cloud.callFunction({ name, data: Object.assign({ action }, data || {}) }).then((res) => {
    const r = (res && res.result) || {}
    if (!r.ok) {
      const err = new Error(r.msg || '操作失败')
      err.code = r.code || 'ERROR'
      throw err
    }
    return r
  })
}
function login() { return call('account', 'login') }
function saveProfile(payload) { return call('account', 'saveProfile', payload) }
function applyInvite(code) { return call('account', 'applyInvite', { code }) }
function consumeQuota(payload) { return call('access', 'consumeQuota', payload) }
function checkAccess(sessionId) { return call('access', 'checkAccess', { sessionId }) }
function createOrder(sessionId) { return call('access', 'createOrder', { sessionId }) }
function unlock(sessionId) { return call('access', 'unlock', { sessionId }) }
function saveGallery(payload) { return call('gallery', 'save', payload) }
function listGallery(page, pageSize) { return call('gallery', 'list', { page, pageSize }) }
module.exports = { call, login, saveProfile, applyInvite, consumeQuota, checkAccess, createOrder, unlock, saveGallery, listGallery }
```

- [ ] **Step 2: 语法检查并提交**

Run: `node --check miniprogram/utils/user.js`
Expected: 无输出

Run:
```
git add miniprogram/utils/user.js
git commit -m "feat: 用户中心云函数调用封装 utils/user.js"
```

---

### Task 3: tabBar + 页面注册 + app.js 登录态

**Files:**
- Modify: `miniprogram/app.json`
- Modify: `miniprogram/app.js`

- [ ] **Step 1: `app.json` 注册新页面并加 tabBar**

`pages` 改为：
```json
"pages": [
  "page/index/index",
  "page/profile/index",
  "page/gallery/index",
  "page/crop/index",
  "page/pattern/index",
  "page/pattern-edit/index"
],
```

顶层新增：
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

- [ ] **Step 2: `app.js` 增加登录态恢复与 ensureLogin**

`globalData` 增加 `user: null`：
```js
globalData: {
  theme: wx.getSystemInfoSync().theme,
  hasLogin: false,
  openid: null,
  user: null,
  iconTabbar: '/page/weui/example/images/icon_tabbar.png',
},
```

`onLaunch` 内（`wx.cloud.init` 之后）调用 `this.restoreLogin()`；页面方法区新增：
```js
restoreLogin() {
  const user = wx.getStorageSync('user')
  if (user && user.openid) this.globalData.user = user
},
ensureLogin() {
  if (this.globalData.user && this.globalData.user.openid) {
    return Promise.resolve(this.globalData.user)
  }
  const userApi = require('./utils/user.js')
  return userApi.login().then((r) => {
    this.globalData.user = r.user
    wx.setStorageSync('user', r.user)
    return r.user
  })
},
```

- [ ] **Step 3: 校验并提交**

Run:
```
node --check miniprogram/app.js
node -e "JSON.parse(require('fs').readFileSync('miniprogram/app.json','utf8'))"
```
Expected: 无输出

Run:
```
git add miniprogram/app.json miniprogram/app.js
git commit -m "feat: 底部双 tab（首页/我的）与登录态恢复"
```

---
### Task 4: 云函数 `account`（登录 / 资料 / 邀请码）

**Files:**
- Create: `cloudfunctions/account/index.js`
- Create: `cloudfunctions/account/package.json`

- [ ] **Step 1: 实现 `index.js`**

```js
// cloudfunctions/account/index.js
/**
 * 用户中心云函数：login / getProfile / saveProfile / applyInvite。
 * 身份来自 cloud.getWXContext().OPENID（标准微信登录，云开发自动完成）。
 */
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const INVITE_CODE = process.env.INVITE_CODE || 'GBNLY99'

function ok(data) { return Object.assign({ ok: true }, data) }
function fail(code, msg) { return { ok: false, code, msg } }

async function getOrCreateUser(openid) {
  const col = db.collection('users')
  const res = await col.where({ _openid: openid }).limit(1).get()
  if (res.data.length) return res.data[0]
  const doc = {
    _openid: openid,
    nickname: '',
    avatarFileID: '',
    freeVip: false,
    inviteCode: '',
    createdAt: db.serverDate(),
    updatedAt: db.serverDate()
  }
  await col.add({ data: doc })
  return doc
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  if (!OPENID) return fail('NO_LOGIN', '请先登录')
  const action = event.action
  if (action === 'login' || action === 'getProfile') {
    return ok({ user: await getOrCreateUser(OPENID) })
  }
  if (action === 'saveProfile') {
    const data = { updatedAt: db.serverDate() }
    if (typeof event.nickname === 'string') data.nickname = event.nickname.slice(0, 30)
    if (typeof event.avatarFileID === 'string') data.avatarFileID = event.avatarFileID
    await db.collection('users').where({ _openid: OPENID }).update({ data })
    return ok({ user: await getOrCreateUser(OPENID) })
  }
  if (action === 'applyInvite') {
    if (event.code !== INVITE_CODE) return fail('BAD_CODE', '邀请码无效')
    await db.collection('users').where({ _openid: OPENID }).update({
      data: { freeVip: true, inviteCode: String(event.code), updatedAt: db.serverDate() }
    })
    return ok({ user: await getOrCreateUser(OPENID) })
  }
  return fail('BAD_ACTION', '未知操作')
}
```

- [ ] **Step 2: 实现 `package.json`**

```json
{
  "name": "account",
  "version": "1.0.0",
  "description": "用户中心云函数：登录/资料/邀请码",
  "main": "index.js",
  "dependencies": {
    "wx-server-sdk": "~2.6.3"
  }
}
```

- [ ] **Step 3: 校验并提交**

Run:
```
node --check cloudfunctions/account/index.js
node -e "JSON.parse(require('fs').readFileSync('cloudfunctions/account/package.json','utf8'))"
```
Expected: 无输出

Run:
```
git add cloudfunctions/account
git commit -m "feat: 云函数 account（登录/资料/邀请码）"
```

---

### Task 5: 云函数 `access`（配额 / 解锁 / 订单）

**Files:**
- Create: `cloudfunctions/access/index.js`
- Create: `cloudfunctions/access/package.json`

- [ ] **Step 1: 实现 `index.js`**

```js
// cloudfunctions/access/index.js
/**
 * 访问控制云函数：consumeQuota / checkAccess / createOrder / unlock。
 * PAY_MODE=mock（默认）直接模拟支付成功；邀请码用户 freeVip 全部免费。
 */
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const MAX_ATTEMPTS = 3
const PAY_MODE = process.env.PAY_MODE || 'mock'
const UNLOCK_PRICE = Number(process.env.UNLOCK_PRICE || 100)

function ok(data) { return Object.assign({ ok: true }, data) }
function fail(code, msg) { return { ok: false, code, msg } }

async function getUser(openid) {
  const res = await db.collection('users').where({ _openid: openid }).limit(1).get()
  return res.data[0] || { freeVip: false }
}
async function getSession(openid, sessionId) {
  const res = await db.collection('ai_sessions').where({ _openid: openid, sessionId }).limit(1).get()
  return res.data[0] || null
}

async function consumeQuota(openid, event) {
  const col = db.collection('ai_sessions')
  const res = await col.where({ _openid: openid, imageHash: event.imageHash }).limit(1).get()
  const u = await getUser(openid)
  if (u.freeVip) return ok({ attempts: res.data.length ? res.data[0].attempts : 1, remaining: -1 })
  if (!event.imageHash) return fail('NO_HASH', '缺少 imageHash')
  if (res.data.length === 0) {
    await col.add({
      data: {
        _openid: openid, sessionId: event.sessionId || '', imageHash: event.imageHash,
        attempts: 1, unlocked: false, createdAt: db.serverDate(), updatedAt: db.serverDate()
      }
    })
    return ok({ attempts: 1, remaining: MAX_ATTEMPTS - 1 })
  }
  const doc = res.data[0]
  if (doc.unlocked) return ok({ attempts: doc.attempts, remaining: -1 })
  if (doc.attempts >= MAX_ATTEMPTS) return fail('QUOTA_EXCEED', '已达该图片免费生成上限（3 次），请解锁一张或更换图片')
  await col.doc(doc._id).update({ data: { attempts: doc.attempts + 1, updatedAt: db.serverDate() } })
  return ok({ attempts: doc.attempts + 1, remaining: MAX_ATTEMPTS - doc.attempts - 1 })
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  if (!OPENID) return fail('NO_LOGIN', '请先登录')
  const action = event.action
  if (action === 'consumeQuota') return consumeQuota(OPENID, event || {})
  if (action === 'checkAccess') {
    const s = await getSession(OPENID, event.sessionId || '')
    const u = await getUser(OPENID)
    return ok({ unlocked: !!(s && s.unlocked), freeVip: !!u.freeVip })
  }
  if (action === 'createOrder') {
    const s = await getSession(OPENID, event.sessionId || '')
    if (!s) return fail('NO_SESSION', '会话不存在')
    const u = await getUser(OPENID)
    if (u.freeVip) return ok({ paid: true })
    if (PAY_MODE !== 'mock') return fail('PAY_NOT_READY', '支付未开通，请先配置 PAY_MODE')
    const add = await db.collection('orders').add({
      data: {
        _openid: OPENID, sessionId: s.sessionId, amountFen: UNLOCK_PRICE, status: 'paid',
        createdAt: db.serverDate(), paidAt: db.serverDate()
      }
    })
    await db.collection('ai_sessions').doc(s._id).update({ data: { unlocked: true, updatedAt: db.serverDate() } })
    return ok({ paid: true, orderId: add._id })
  }
  if (action === 'unlock') {
    const s = await getSession(OPENID, event.sessionId || '')
    if (!s) return fail('NO_SESSION', '会话不存在')
    const u = await getUser(OPENID)
    if (!u.freeVip) {
      const paid = await db.collection('orders').where({ _openid: OPENID, sessionId: s.sessionId, status: 'paid' }).limit(1).get()
      if (!paid.data.length) return fail('NOT_PAID', '未支付')
    }
    await db.collection('ai_sessions').doc(s._id).update({ data: { unlocked: true, updatedAt: db.serverDate() } })
    return ok({ unlocked: true })
  }
  return fail('BAD_ACTION', '未知操作')
}
```

- [ ] **Step 2: 实现 `package.json`**（name 为 `access`，其余同 account）

- [ ] **Step 3: 校验并提交**

Run:
```
node --check cloudfunctions/access/index.js
node -e "JSON.parse(require('fs').readFileSync('cloudfunctions/access/package.json','utf8'))"
```
Expected: 无输出

Run:
```
git add cloudfunctions/access
git commit -m "feat: 云函数 access（配额/解锁/订单）"
```

---

### Task 6: 云函数 `gallery`（入库 / 页码分页列表）

**Files:**
- Create: `cloudfunctions/gallery/index.js`
- Create: `cloudfunctions/gallery/package.json`

- [ ] **Step 1: 实现 `index.js`**

```js
// cloudfunctions/gallery/index.js
/**
 * 图库云函数：save / list（页码分页，每页 PAGE_SIZE 条）。
 */
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const PAGE_SIZE = 10

function ok(data) { return Object.assign({ ok: true }, data) }
function fail(code, msg) { return { ok: false, code, msg } }

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  if (!OPENID) return fail('NO_LOGIN', '请先登录')
  const action = event.action
  if (action === 'save') {
    if (!event.originalFileID || !event.patternFileID) return fail('MISSING_FILE', '缺少图片文件')
    const data = {
      _openid: OPENID,
      originalFileID: event.originalFileID,
      patternFileID: event.patternFileID,
      mode: event.mode === 'photo' ? 'photo' : 'ai',
      style: String(event.style || ''),
      size: Number(event.size) || 52,
      set: String(event.set || '221'),
      createdAt: db.serverDate()
    }
    if (event.sessionId) data.sessionId = String(event.sessionId)
    await db.collection('gallery').add({ data })
    return ok({ saved: true })
  }
  if (action === 'list') {
    const page = Math.max(1, Math.floor(Number(event.page) || 1))
    const pageSize = Math.min(50, Math.max(1, Math.floor(Number(event.pageSize) || PAGE_SIZE)))
    const where = { _openid: OPENID }
    const col = db.collection('gallery')
    const total = (await col.where(where).count()).total
    const res = await col.where(where).orderBy('createdAt', 'desc').skip((page - 1) * pageSize).limit(pageSize).get()
    return ok({ items: res.data, page, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) })
  }
  return fail('BAD_ACTION', '未知操作')
}
```

- [ ] **Step 2: 实现 `package.json`**（name 为 `gallery`，其余同 account）

- [ ] **Step 3: 校验并提交**

Run:
```
node --check cloudfunctions/gallery/index.js
node -e "JSON.parse(require('fs').readFileSync('cloudfunctions/gallery/package.json','utf8'))"
```
Expected: 无输出

Run:
```
git add cloudfunctions/gallery
git commit -m "feat: 云函数 gallery（入库/页码分页列表）"
```

---

### Task 7: 生成侧改造（云函数配额校验 + 前端登录门禁/会话）

**Files:**
- Modify: `cloudfunctions/ai-generate-pattern/index.js`
- Modify: `miniprogram/utils/ai.js`
- Modify: `miniprogram/page/index/index.js`

- [ ] **Step 1: `ai-generate-pattern/index.js` 增加登录 + 配额校验**

在 `const cloud = require('wx-server-sdk')` 下方增加常量与校验函数：
```js
const MAX_ATTEMPTS = 3
async function checkQuota(openid, event) {
  const db = cloud.database()
  const users = await db.collection('users').where({ _openid: openid }).limit(1).get()
  if (users.data.length && users.data[0].freeVip) return
  if (!event.imageHash) throw new Error('缺少 imageHash')
  const col = db.collection('ai_sessions')
  const res = await col.where({ _openid: openid, imageHash: event.imageHash }).limit(1).get()
  if (!res.data.length) {
    await col.add({
      data: {
        _openid: openid, sessionId: event.sessionId || '', imageHash: event.imageHash,
        attempts: 1, unlocked: false, createdAt: db.serverDate(), updatedAt: db.serverDate()
      }
    })
    return
  }
  const doc = res.data[0]
  if (doc.unlocked) return
  if (doc.attempts >= MAX_ATTEMPTS) throw new Error('已达该图片免费生成上限（3 次），请解锁一张或更换图片')
  await col.doc(doc._id).update({ data: { attempts: doc.attempts + 1, updatedAt: db.serverDate() } })
}
```

`exports.main` 改为：
```js
exports.main = async (event) => {
  const apiKey = process.env.ARK_API_KEY
  if (!apiKey) {
    return { error: '云函数未配置 ARK_API_KEY 环境变量' }
  }
  const { OPENID } = cloud.getWXContext()
  if (!OPENID) return { error: '请先登录' }
  const model = process.env.ARK_MODEL || DEFAULT_MODEL
  try {
    await checkQuota(OPENID, event || {})
    return await generate(apiKey, model, event || {})
  } catch (e) {
    return { error: e.message }
  }
}
```

- [ ] **Step 2: `utils/ai.js` 透传 imageHash/sessionId 并新增 generateGrid**

`callAiGenerate` 的 `data` 增加两个字段：
```js
  const data = {
    imageBase64: params.imageBase64,
    size: params.size,
    set: params.set,
    style: params.style,
    styleKey: params.styleKey,
    extra: params.extra || '',
    cutout: !!params.cutout,
    imageHash: params.imageHash || '',
    sessionId: params.sessionId || ''
  }
```

文件末尾（`imageToGrid` 之前）新增：
```js
/**
 * 生成并映射网格：压缩后 base64 已在 params.imageBase64；返回当前套装的色号网格。
 */
async function generateGrid(params) {
  const resp = await callAiGenerate(params)
  return imageToGrid(resp.image, params.size, params.set)
}
```

`module.exports` 增加 `generateGrid`。

- [ ] **Step 3: `page/index/index.js` 登录门禁 + 会话 + 配额 + 锁定预览**

顶部 require 增加：
```js
const config = require('../../config.js')
const user = require('../../utils/user.js')
const hash = require('../../utils/hash.js')
const session = require('../../utils/session.js')
```

`generateByAi()` 开头（弹窗之前）增加登录校验：
```js
  const app = getApp()
  if (!(app.globalData.user && app.globalData.user.openid)) {
    wx.showModal({
      title: '需要登录',
      content: '创意生成需要登录后使用，去「我的」页登录？',
      confirmText: '去登录',
      success: (r) => {
        if (r.confirm) wx.switchTab({ url: '/page/profile/index' })
      }
    })
    return
  }
```

`runAiGenerate` 改为（会话创建 + 配额 + generateGrid + 锁定）：
```js
  async runAiGenerate(style) {
    this.setData({ generating: true })
    wx.showLoading({ title: '生成中…', mask: true })
    try {
      const g = getApp().globalData
      const imageBase64 = await ai.compressToBase64(this.data.imagePath)
      const imageHash = hash.fnv1a64(imageBase64)
      if (!g.aiSession || g.aiSession.imageHash !== imageHash) {
        g.aiSession = session.createSession(imageHash)
        g.aiSession.params = {
          imagePath: this.data.imagePath,
          size: this.data.size,
          set: this.data.set,
          style,
          styleKey: this.getStyleKey(),
          cutout: this.data.aiCutout,
          extra: this.data.extraReq.trim()
        }
      }
      const s = g.aiSession
      if (config.aiGenerate.backend === 'local') {
        await user.consumeQuota({ sessionId: s.sessionId, imageHash })
      }
      const grid = await ai.generateGrid({
        imageBase64,
        size: this.data.size,
        set: this.data.set,
        style,
        styleKey: this.getStyleKey(),
        cutout: this.data.aiCutout,
        extra: this.data.extraReq.trim(),
        imageHash,
        sessionId: s.sessionId,
        onRetry: (used, total) => wx.showLoading({ title: '超时重试 ' + used + '/' + total, mask: true })
      })
      g.aiSession = session.addCandidate(g.aiSession, grid)
      this.finish(grid, 'ai', style, true)
    } catch (err) {
      wx.hideLoading()
      wx.showModal({
        title: '生成失败',
        content: (err && err.message) || '请重试',
        showCancel: false
      })
      console.error(err)
    } finally {
      this.setData({ generating: false })
    }
  },
```

`finish` 增加第 4 个参数 `locked`：
```js
  finish(grid, mode, style, locked) {
    getApp().globalData.pattern = {
      grid,
      size: this.data.size,
      set: this.data.set,
      imagePath: this.data.imagePath,
      mode,
      style,
      locked: !!locked
    }
    wx.hideLoading()
    wx.navigateTo({ url: '/page/pattern/index' })
  },
```

- [ ] **Step 4: 校验并提交**

Run:
```
node --check cloudfunctions/ai-generate-pattern/index.js
node --check miniprogram/utils/ai.js
node --check miniprogram/page/index/index.js
node tests/ai.test.js
```
Expected: 无语法错误，ai.test.js 通过

Run:
```
git add cloudfunctions/ai-generate-pattern/index.js miniprogram/utils/ai.js miniprogram/page/index/index.js
git commit -m "feat: 创意生成登录门禁 + 每图 3 次配额（云函数校验）+ 会话候选"
```

---
### Task 8: 个人中心页 `page/profile`

**Files:**
- Create: `miniprogram/page/profile/index.js`
- Create: `miniprogram/page/profile/index.wxml`
- Create: `miniprogram/page/profile/index.wxss`
- Create: `miniprogram/page/profile/index.json`

- [ ] **Step 1: 实现 `index.js`**

```js
// miniprogram/page/profile/index.js
const user = require('../../utils/user.js')
Page({
  data: {
    user: null,
    openidTail: '',
    loading: false,
    inviteCode: ''
  },
  onShow() {
    this.refresh()
  },
  async refresh() {
    try {
      const u = await getApp().ensureLogin()
      this.setData({ user: u, openidTail: u.openid ? u.openid.slice(-6) : '' })
    } catch (e) {
      this.setData({ user: null, openidTail: '' })
    }
  },
  async onLogin() {
    this.setData({ loading: true })
    try {
      const u = await getApp().ensureLogin()
      this.setData({ user: u, openidTail: u.openid ? u.openid.slice(-6) : '' })
    } catch (e) {
      wx.showToast({ title: '登录失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },
  async onChooseAvatar(e) {
    const filePath = e.detail.avatarUrl
    if (!filePath || !this.data.user) return
    wx.showLoading({ title: '上传中…', mask: true })
    try {
      const ext = (filePath.match(/\.(\w+)$/) || [ , 'jpg'])[1]
      const up = await wx.cloud.uploadFile({
        cloudPath: 'avatars/' + this.data.user.openid + '/avatar.' + ext,
        filePath
      })
      const u = await user.saveProfile({ avatarFileID: up.fileID })
      this.setData({ user: u })
    } catch (err) {
      wx.showToast({ title: '头像上传失败', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  },
  async onNicknameBlur(e) {
    const nickname = String(e.detail.value || '').trim()
    if (!nickname || !this.data.user) return
    try {
      const u = await user.saveProfile({ nickname })
      this.setData({ user: u })
    } catch (err) {
      wx.showToast({ title: '昵称保存失败', icon: 'none' })
    }
  },
  onInviteInput(e) {
    this.setData({ inviteCode: e.detail.value })
  },
  async onApplyInvite() {
    const code = this.data.inviteCode.trim()
    if (!code) return
    try {
      const r = await user.applyInvite(code)
      this.setData({ user: r.user })
      wx.showToast({ title: '邀请码激活成功', icon: 'success' })
    } catch (err) {
      wx.showToast({ title: (err && err.message) || '邀请码无效', icon: 'none' })
    }
  },
  goGallery() {
    wx.navigateTo({ url: '/page/gallery/index' })
  }
})
```

- [ ] **Step 2: 实现 `index.wxml`**

```xml
<view class="page">
  <block wx:if="{{!user}}">
    <view class="card login-card">
      <view class="login-title">登录后使用创意生成</view>
      <view class="login-sub">登录后可保存图纸到图库，并使用创意生成功能</view>
      <button class="btn btn--primary btn--lg" hover-class="btn--pressed" loading="{{loading}}" bindtap="onLogin">微信一键登录</button>
    </view>
  </block>
  <block wx:else>
    <view class="card profile-card">
      <button class="avatar-btn" open-type="chooseAvatar" bindchooseavatar="onChooseAvatar">
        <image wx:if="{{user.avatarFileID}}" class="avatar" src="{{user.avatarFileID}}" mode="aspectFill" />
        <view wx:else class="avatar avatar--empty">设头像</view>
      </button>
      <view class="profile-info">
        <input class="nickname-input" type="nickname" placeholder="点击设置昵称" value="{{user.nickname}}" bindblur="onNicknameBlur" />
        <view class="profile-tip">ID：{{openidTail}}</view>
      </view>
      <view wx:if="{{user.freeVip}}" class="vip-badge">邀请码用户 · 全部免费</view>
    </view>

    <view class="card section">
      <view class="section-title">邀请码</view>
      <view class="invite-row">
        <input class="invite-input" placeholder="输入邀请码" value="{{inviteCode}}" bindinput="onInviteInput" />
        <button class="btn btn--primary invite-btn" hover-class="btn--pressed" bindtap="onApplyInvite">激活</button>
      </view>
      <view class="section-hint">输入邀请码可免费使用全部功能</view>
    </view>

    <view class="card menu-card" hover-class="menu-card--pressed" bindtap="goGallery">
      <view class="menu-title">我的图库</view>
      <view class="menu-arrow">›</view>
    </view>
  </block>
</view>
```

- [ ] **Step 3: 实现 `index.wxss`（自包含，使用设计令牌）**

```css
/* miniprogram/page/profile/index.wxss */
@import '../../styles/tokens.wxss';

.page {
  padding: var(--space-md);
  padding-bottom: calc(var(--space-xl) + 120rpx);
}

.card {
  background: var(--color-bead-bg);
  border-radius: var(--radius-card);
  padding: var(--space-lg);
  box-shadow: 0 12rpx 24rpx -12rpx var(--color-shadow);
  margin-bottom: var(--space-md);
}

.login-card {
  margin-top: var(--space-xl);
  text-align: center;
}
.login-title {
  font-size: var(--text-lg);
  font-weight: 700;
  margin-bottom: var(--space-xs);
}
.login-sub {
  font-size: var(--text-sm);
  color: var(--color-ink-2);
  margin-bottom: var(--space-lg);
}

.profile-card {
  display: flex;
  align-items: center;
  gap: var(--space-md);
}
.avatar-btn {
  padding: 0;
  background: transparent;
  border: 0;
  line-height: 1;
}
.avatar {
  width: 128rpx;
  height: 128rpx;
  border-radius: 50%;
  background: var(--color-paper-2);
}
.avatar--empty {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--text-sm);
  color: var(--color-ink-2);
  border: 2rpx dashed var(--color-rule);
}
.profile-info {
  flex: 1;
  min-width: 0;
}
.nickname-input {
  font-size: var(--text-md);
  font-weight: 700;
  height: 72rpx;
}
.profile-tip {
  font-size: var(--text-xs);
  color: var(--color-neutral);
  font-family: var(--font-label);
}
.vip-badge {
  align-self: flex-start;
  background: var(--color-accent);
  color: var(--color-accent-ink);
  border-radius: var(--radius-pill);
  font-size: var(--text-xs);
  font-weight: 600;
  padding: 6rpx 20rpx;
  white-space: nowrap;
}

.section-title {
  font-size: var(--text-md);
  font-weight: 700;
  margin-bottom: var(--space-sm);
}
.invite-row {
  display: flex;
  gap: var(--space-sm);
}
.invite-input {
  flex: 1;
  height: 88rpx;
  padding: 0 var(--space-md);
  background: var(--color-paper);
  border-radius: var(--radius-input);
  border: 2rpx solid var(--color-rule);
  font-size: var(--text-base);
}
.invite-btn {
  width: 176rpx;
  height: 88rpx;
  font-size: var(--text-base);
}
.section-hint {
  font-size: var(--text-sm);
  color: var(--color-neutral);
  margin-top: var(--space-sm);
}

.menu-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.menu-title {
  font-size: var(--text-md);
  font-weight: 700;
}
.menu-arrow {
  font-size: var(--text-lg);
  color: var(--color-neutral);
}
.menu-card--pressed {
  background: var(--color-paper-2);
}
```

- [ ] **Step 4: 实现 `index.json`**

```json
{
  "usingComponents": {},
  "navigationBarTitleText": "我的"
}
```

- [ ] **Step 5: 校验并提交**

Run: `node --check miniprogram/page/profile/index.js`
Expected: 无输出

Run:
```
git add miniprogram/page/profile
git commit -m "feat: 个人中心页（登录/头像昵称/邀请码/图库入口）"
```

---

### Task 9: 图库页 `page/gallery`（页码分页）

**Files:**
- Create: `miniprogram/page/gallery/index.js`
- Create: `miniprogram/page/gallery/index.wxml`
- Create: `miniprogram/page/gallery/index.wxss`
- Create: `miniprogram/page/gallery/index.json`

- [ ] **Step 1: 实现 `index.js`**

```js
// miniprogram/page/gallery/index.js
const user = require('../../utils/user.js')
const pager = require('../../utils/pager.js')
const PAGE_SIZE = 10

function formatTime(d) {
  if (!d) return ''
  const date = new Date(d)
  const p = (n) => (n < 10 ? '0' + n : '' + n)
  return (
    date.getFullYear() + '-' + p(date.getMonth() + 1) + '-' + p(date.getDate()) +
    ' ' + p(date.getHours()) + ':' + p(date.getMinutes())
  )
}

Page({
  data: {
    items: [],
    page: 1,
    totalPages: 1,
    pageNos: [1],
    loading: false
  },
  onShow() {
    this.load(1)
  },
  async load(page) {
    if (this.data.loading) return
    this.setData({ loading: true })
    try {
      const r = await user.listGallery(page, PAGE_SIZE)
      const p = r.page || page
      const items = (r.items || []).map((it) =>
        Object.assign({}, it, { timeText: formatTime(it.createdAt) })
      )
      this.setData({
        items,
        page: p,
        totalPages: r.totalPages || 1,
        pageNos: pager.pageWindow(r.totalPages || 1, p)
      })
    } catch (err) {
      wx.showToast({ title: (err && err.message) || '图库加载失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },
  goPage(e) {
    const n = Number(e.currentTarget.dataset.page)
    if (!n || isNaN(n) || n === this.data.page || n < 1 || n > this.data.totalPages) return
    this.load(n)
  },
  onSave(e) {
    const fileID = e.currentTarget.dataset.fileid
    if (!fileID) return
    wx.showModal({
      title: '保存到相册',
      content: '保存这张图片到手机相册？',
      success: (r) => {
        if (!r.confirm) return
        wx.showLoading({ title: '保存中…', mask: true })
        wx.cloud.downloadFile({ fileID })
          .then((res) => new Promise((resolve, reject) => {
            wx.saveImageToPhotosAlbum({ filePath: res.tempFilePath, success: resolve, fail: reject })
          }))
          .then(() => {
            wx.hideLoading()
            wx.showToast({ title: '已保存到相册', icon: 'success' })
          })
          .catch(() => {
            wx.hideLoading()
            wx.showToast({ title: '保存失败', icon: 'none' })
          })
      }
    })
  }
})
```

- [ ] **Step 2: 实现 `index.wxml`**

```xml
<view class="page">
  <view class="gallery-head">我的图库 · 共 {{totalPages}} 页</view>
  <view wx:if="{{items.length}}" class="gallery-grid">
    <view wx:for="{{items}}" wx:key="_id" class="pair-card">
      <view class="pair-thumbs">
        <image class="thumb" src="{{item.originalFileID}}" mode="aspectFill" data-fileid="{{item.originalFileID}}" bindtap="onSave" />
        <image class="thumb" src="{{item.patternFileID}}" mode="aspectFill" data-fileid="{{item.patternFileID}}" bindtap="onSave" />
      </view>
      <view class="pair-meta">
        <text class="pair-style">{{item.mode === 'ai' ? '创意生成 · ' + (item.style || '') : '照片还原'}}</text>
        <text class="pair-sub">{{item.timeText}} · {{item.size}}×{{item.size}} · {{item.set}} 色</text>
      </view>
    </view>
  </view>
  <view wx:else class="empty">还没有图纸，去首页生成一张吧</view>

  <view wx:if="{{totalPages > 1}}" class="pager">
    <view class="pager-btn {{page === 1 ? 'pager-btn--disabled' : ''}}" data-page="{{page - 1}}" bindtap="goPage">上一页</view>
    <view
      wx:for="{{pageNos}}"
      wx:key="*this"
      class="pager-num {{item === page ? 'pager-num--on' : ''}} {{item === '...' ? 'pager-dot' : ''}}"
      data-page="{{item}}"
      bindtap="goPage"
    >{{item}}</view>
    <view class="pager-btn {{page === totalPages ? 'pager-btn--disabled' : ''}}" data-page="{{page + 1}}" bindtap="goPage">下一页</view>
  </view>
</view>
```

- [ ] **Step 3: 实现 `index.wxss`（一屏不滚动：卡片网格 + 底部页码条）**

```css
/* miniprogram/page/gallery/index.wxss */
@import '../../styles/tokens.wxss';

.page {
  height: 100vh;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  padding: var(--space-md);
}

.gallery-head {
  font-size: var(--text-sm);
  color: var(--color-neutral);
  margin-bottom: var(--space-sm);
  flex: none;
}

.gallery-grid {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-sm);
  align-content: start;
}

.pair-card {
  background: var(--color-bead-bg);
  border-radius: var(--radius-card);
  padding: var(--space-xs);
  box-shadow: 0 12rpx 24rpx -12rpx var(--color-shadow);
}
.pair-thumbs {
  display: flex;
  gap: 8rpx;
}
.thumb {
  width: 50%;
  height: 150rpx;
  border-radius: var(--radius-input);
  background: var(--color-paper-2);
}
.pair-meta {
  margin-top: var(--space-2xs);
  font-size: var(--text-xs);
  color: var(--color-ink-2);
  line-height: 1.5;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.pair-style {
  display: block;
  font-weight: 600;
  color: var(--color-ink);
}
.pair-sub {
  display: block;
}

.empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-neutral);
  font-size: var(--text-base);
}

.pager {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8rpx;
  padding: var(--space-sm) 0;
}
.pager-btn,
.pager-num {
  height: 56rpx;
  min-width: 56rpx;
  padding: 0 12rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-pill);
  background: var(--color-bead-bg);
  border: 2rpx solid var(--color-rule);
  font-size: var(--text-sm);
}
.pager-num--on {
  background: var(--color-accent);
  border-color: var(--color-accent);
  font-weight: 700;
}
.pager-btn--disabled {
  opacity: 0.4;
}
.pager-dot {
  border: 0;
  background: transparent;
}
```

- [ ] **Step 4: 实现 `index.json`**

```json
{
  "usingComponents": {},
  "navigationBarTitleText": "我的图库"
}
```

- [ ] **Step 5: 校验并提交**

Run: `node --check miniprogram/page/gallery/index.js`
Expected: 无输出

Run:
```
git add miniprogram/page/gallery
git commit -m "feat: 图库页（页码分页/点击保存到相册）"
```

---
### Task 10: 展示页锁定预览 / 解锁 / 自动入库

**Files:**
- Modify: `miniprogram/page/pattern/index.js`
- Modify: `miniprogram/page/pattern/index.wxml`
- Modify: `miniprogram/page/pattern/index.wxss`

- [ ] **Step 1: `index.js` 增加锁定预览与解锁**

顶部 require 增加：
```js
const config = require('../../config.js')
const ai = require('../../utils/ai.js')
const user = require('../../utils/user.js')
const hash = require('../../utils/hash.js')
const session = require('../../utils/session.js')
```

`data` 增加：
```js
    locked: false,
    lockedIndex: 0,
    lockedTotal: 0
```

`onLoad` 在 `this.setData({ set: p.set, size: p.size, mode: p.mode || 'photo', styleShort })` 之前插入：
```js
    this.aiSession = getApp().globalData.aiSession || null
    const locked = !!(p.locked && this.aiSession)
    this.setData({ locked })
    if (locked) {
      this.setData({
        lockedIndex: this.aiSession.index + 1,
        lockedTotal: this.aiSession.candidates.length
      })
    }
```

触摸三方法开头各加一行（锁定态不响应手势）：
```js
  onTouchStart(e) {
    if (this.data.locked) return
    ...
  onTouchMove(e) {
    if (this.data.locked) return
    ...
  onTouchEnd(e) {
    if (this.data.locked) return
    ...
```

`drawGrid` 中 `pattern.renderGrid` 的 `code` 参数改为：
```js
      code: this.data.locked ? false : this.codeShown,
```

`onShow` / `updateLegend` 保持；新增三个方法与导出改造：

```js
  async onRegenerate() {
    const s = this.aiSession
    if (!s || !s.params || !session.canGenerate(s)) return
    if (!(getApp().globalData.user && getApp().globalData.user.openid)) {
      wx.showToast({ title: '请先登录', icon: 'none' })
      return
    }
    wx.showLoading({ title: '生成中…', mask: true })
    try {
      const p = s.params
      const imageBase64 = await ai.compressToBase64(p.imagePath)
      const imageHash = hash.fnv1a64(imageBase64)
      if (config.aiGenerate.backend === 'local') {
        await user.consumeQuota({ sessionId: s.sessionId, imageHash })
      }
      const grid = await ai.generateGrid({
        imageBase64,
        size: p.size,
        set: p.set,
        style: p.style,
        styleKey: p.styleKey,
        cutout: p.cutout,
        extra: p.extra,
        imageHash,
        sessionId: s.sessionId
      })
      this.aiSession = session.addCandidate(this.aiSession, grid)
      getApp().globalData.aiSession = this.aiSession
      this.pattern.grid = grid
      this.setData({ lockedIndex: this.aiSession.index + 1, lockedTotal: this.aiSession.candidates.length })
      this.updateLegend()
      this.drawPattern()
    } catch (err) {
      wx.showModal({ title: '生成失败', content: (err && err.message) || '请重试', showCancel: false })
    } finally {
      wx.hideLoading()
    }
  },

  onSwitchCandidate() {
    const s = this.aiSession
    if (!s || s.candidates.length < 2) return
    const next = (s.index + 1) % s.candidates.length
    this.aiSession = session.switchCandidate(s, next)
    getApp().globalData.aiSession = this.aiSession
    this.pattern.grid = this.aiSession.candidates[next]
    this.setData({ lockedIndex: next + 1 })
    this.updateLegend()
    this.drawPattern()
  },

  async onUnlock() {
    const s = this.aiSession
    if (!s) return
    wx.showLoading({ title: '解锁中…', mask: true })
    try {
      const order = await user.createOrder(s.sessionId)
      if (!order.paid) throw new Error('支付未完成')
      await user.unlock(s.sessionId)
      this.pattern.locked = false
      this.setData({ locked: false })
      this.updateLegend()
      this.drawPattern()
      wx.hideLoading()
      wx.showToast({ title: '已解锁', icon: 'success' })
      this.saveToGallery()
    } catch (err) {
      wx.hideLoading()
      wx.showToast({ title: (err && err.message) || '解锁失败', icon: 'none' })
    }
  },

  makeExportFile() {
    const canvas = this.canvas
    const p = this.pattern
    return new Promise((resolve, reject) => {
      if (!canvas) return reject(new Error('画布未就绪'))
      const codes = this.palette.map((i) => i.code)
      const counts = pattern.countColors(p.grid, codes, this.bgMask)
      const hexByCode = {}
      this.palette.forEach((i) => { hexByCode[i.code] = i.hex })
      const legendItems = counts.map((i) => ({ code: i.code, count: i.count, hex: hexByCode[i.code] }))
      const layout = pattern.layoutExport(p.grid, { cellSize: pattern.EXPORT_CELL, gap: 1, legendItems })
      const scale = Math.min(1, pattern.EXPORT_MAX_DIM / Math.max(layout.width, layout.height))
      canvas.width = Math.max(1, Math.round(layout.width * scale))
      canvas.height = Math.max(1, Math.round(layout.height * scale))
      const ctx = canvas.getContext('2d')
      ctx.scale(scale, scale)
      pattern.renderExport(ctx, p.grid, this.palette, {
        cellSize: pattern.EXPORT_CELL,
        gap: 1,
        code: true,
        gridEvery: this.data.gridOn ? this.data.gridEvery : 0,
        legendItems,
        noCodeMask: this.bgMask
      })
      wx.canvasToTempFilePath({
        canvas,
        success: (res) => {
          this.restoreDisplay(canvas)
          resolve(res.tempFilePath)
        },
        fail: reject
      })
    })
  },

  async saveToGallery() {
    const app = getApp()
    const u = app.globalData.user
    if (!u || !u.openid) return
    wx.showLoading({ title: '保存到图库…', mask: true })
    try {
      const patternFile = await this.makeExportFile()
      const ts = Date.now()
      const ext = (this.pattern.imagePath.match(/\.(\w+)$/) || [ , 'jpg'])[1]
      const original = await wx.cloud.uploadFile({
        cloudPath: 'gallery/' + u.openid + '/' + ts + '_original.' + ext,
        filePath: this.pattern.imagePath
      })
      const patternImg = await wx.cloud.uploadFile({
        cloudPath: 'gallery/' + u.openid + '/' + ts + '_pattern.png',
        filePath: patternFile
      })
      await user.saveGallery({
        originalFileID: original.fileID,
        patternFileID: patternImg.fileID,
        mode: this.pattern.mode,
        style: this.pattern.style || '',
        size: this.pattern.size,
        set: this.pattern.set,
        sessionId: this.aiSession ? this.aiSession.sessionId : undefined
      })
      wx.hideLoading()
      wx.showToast({ title: '已保存到图库', icon: 'success' })
    } catch (err) {
      wx.hideLoading()
      wx.showToast({ title: '保存到图库失败', icon: 'none' })
    }
  },
```

`exportImage` 改为复用 `makeExportFile`：
```js
  exportImage() {
    this.makeExportFile()
      .then((filePath) => this.saveToAlbum(filePath))
      .catch(() => {
        wx.hideLoading()
        wx.showToast({ title: '导出失败', icon: 'none' })
      })
  },
```

`saveToAlbum` 成功回调末尾追加（照片还原登录用户导出后入库）：
```js
      success: () => {
        wx.hideLoading()
        wx.showToast({ title: '已保存到相册', icon: 'success' })
        if (this.pattern.mode !== 'ai') this.saveToGallery()
      },
```

- [ ] **Step 2: `index.wxml` 锁定态隐藏交互并显示操作条**

`grid-opt` / `legend` / `action-bar` 三个卡片加 `wx:if="{{!locked}}"`；在 `action-bar` 之后新增：
```xml
  <view wx:if="{{locked}}" class="locked-bar card">
    <view class="locked-tip">预览中 · 第 {{lockedIndex}}/{{lockedTotal}} 张（已用 {{lockedTotal}}/3 次）</view>
    <view class="locked-actions">
      <button class="btn btn--soft action-btn" disabled="{{lockedTotal >= 3}}" bindtap="onRegenerate">再生成{{lockedTotal >= 3 ? '（已用尽）' : ''}}</button>
      <button class="btn btn--soft action-btn" bindtap="onSwitchCandidate">换一张</button>
      <button class="btn btn--primary action-btn" bindtap="onUnlock">解锁并交互</button>
    </view>
  </view>
```

- [ ] **Step 3: `index.wxss` 增加锁定条样式**

```css
.locked-bar {
  position: fixed;
  left: var(--space-md);
  right: var(--space-md);
  bottom: calc(var(--space-lg) + env(safe-area-inset-bottom));
  background: var(--color-bead-bg);
  border-radius: var(--radius-card);
  padding: var(--space-md);
  box-shadow: 0 12rpx 24rpx -12rpx var(--color-shadow);
  z-index: var(--z-raised);
}
.locked-tip {
  font-size: var(--text-sm);
  color: var(--color-ink-2);
  text-align: center;
  margin-bottom: var(--space-sm);
}
.locked-actions {
  display: flex;
  gap: var(--space-sm);
}
.locked-actions .action-btn {
  flex: 1;
}
```

- [ ] **Step 4: 校验并提交**

Run:
```
node --check miniprogram/page/pattern/index.js
node tests/pattern.test.js
node tests/ai.test.js
```
Expected: 无语法错误，测试通过

Run:
```
git add miniprogram/page/pattern/index.js miniprogram/page/pattern/index.wxml miniprogram/page/pattern/index.wxss
git commit -m "feat: 展示页锁定预览/再生成/换一张/解锁并自动入库"
```

---

### Task 11: 文档同步 + 全量验证

**Files:**
- Modify: `AGENTS.md`
- Modify: `docs/项目结构与开发说明.md`

- [ ] **Step 1: `AGENTS.md` 同步**

- 页面列表增加 `page/profile/index`（我的）、`page/gallery/index`（图库）；说明底部为双 tab（首页/我的）。
- 云函数列表增加 `account` / `access` / `gallery`；`ai-generate-pattern` 注明登录 + 每图 3 次配额校验。
- 数据约定增加 `users` / `ai_sessions` / `gallery` / `orders` 集合说明与「创意生成」命名。
- 验证命令改为 `node tests/color.test.js && node tests/pattern.test.js && node tests/ai.test.js && node tests/user.test.js`。

- [ ] **Step 2: `docs/项目结构与开发说明.md` 同步**（页面、云函数、生成门禁/解锁/图库流程）

- [ ] **Step 3: 全量验证**

Run:
```
node --check miniprogram/utils/hash.js
node --check miniprogram/utils/session.js
node --check miniprogram/utils/pager.js
node --check miniprogram/utils/user.js
node --check miniprogram/app.js
node --check miniprogram/page/index/index.js
node --check miniprogram/page/pattern/index.js
node --check miniprogram/page/profile/index.js
node --check miniprogram/page/gallery/index.js
node --check cloudfunctions/account/index.js
node --check cloudfunctions/access/index.js
node --check cloudfunctions/gallery/index.js
node --check cloudfunctions/ai-generate-pattern/index.js
node tests/color.test.js
node tests/pattern.test.js
node tests/ai.test.js
node tests/user.test.js
node -e "JSON.parse(require('fs').readFileSync('miniprogram/app.json','utf8'))"
```
Expected: 全部无输出 / 全部通过

Run: `rg -n "AI" miniprogram`
Expected: 0 条（审查要求，新代码不引入 AI 字样）

- [ ] **Step 4: 提交文档同步**

Run:
```
git add AGENTS.md docs/项目结构与开发说明.md
git commit -m "docs: 同步用户中心/图库/解锁流程与验证命令"
```

---

## 自检清单（写完计划后逐项核对）

1. **Spec 覆盖**：设计文档 5.1 tabBar（T3）、5.2 登录（T3/T4）、5.3 个人中心（T8）、5.4 邀请码（T4/T8）、5.5 图库（T6/T9）、5.6 门禁/3 次/解锁（T5/T7/T10）、5.7 照片还原入库（T10）、5.8 支付 mock（T5）、6 数据（T4-T6）、7 云函数（T4-T7）、8 前端（T2-T10）、9 错误处理（T7/T10）、12 验证（T11）。
2. **占位符扫描**：无 TBD/TODO/「类似 Task N」。
3. **命名一致性**：`sessionId` / `imageHash` / `aiSession` / `freeVip` / `unlocked` / `attempts` 全链路一致；`access` 与 `ai-generate-pattern` 的配额逻辑字段一致（`_openid + imageHash` 计数、`freeVip` 跳过、`unlocked` 放行）。
4. **已知取舍**：`utils/ai.js` 文件名、`mode: 'ai'`、`aiCutout`、`aiGenerate` 等标识符按审查范围保持不改（小写 ai，不属大写 AI 文案）；云函数名 `ai-generate-pattern` 保持（重新部署成本高），其错误文案已去 AI 化。
