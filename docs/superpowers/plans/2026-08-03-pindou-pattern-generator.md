# 拼豆图纸生成小程序 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在微信小程序官方模板上实现拼豆图纸生成三页流程：导入图片 → 像素化并映射到 MARD 标准色 → 展示（每格色号 + 颜色数量清单）→ 导出 PNG → 逐格改色。

**Architecture:** 纯前端方案。色卡数据来自 `docs/拼豆标准色彩RGB与拼豆盘尺寸.md`（脚本解析生成 `colors.json`）；主界面用 offscreen canvas 把图片按 contain 方式缩放到 52/78/104 网格并取像素，经 CIELAB 最近色匹配生成色号二维数组，存入 `globalData.pattern`；展示/修改页共用同一 canvas 渲染函数（每格色块+色号+格线），修改页底部为按色系分区的"小盒子陈列"取色面板。前端风格遵循 hallmark 技能：genre=playful、theme=Hum、macrostructure=Workbench。

**Tech Stack:** 微信小程序原生（JS + WXML + WXSS，无 TS、无新增 npm 依赖）、Canvas 2D（offscreen + 同层 canvas）、Node（仅用于生成数据与单测）。

---

## 设计决策摘要（执行时不得偏离）

- **Hallmark pre-flight**：项目为微信小程序（WXML/WXSS），无设计令牌、无字体系统、无动效库、无 spacing scale。`miniprogram/app.wxss` 为既有全局样式 → 不修改，令牌独立放 `miniprogram/styles/tokens.wxss` 由各页 `@import`。
- **设计上下文（用户已授权自行选择风格）**：audience = 拼豆/手工爱好者；use case = 把一张图片变成可照着拼的图纸（生成 → 查看 → 导出 → 修改）；tone = playful（温暖、多彩、亲切，不幼稚）。
- **genre** = playful；**theme** = Hum（奶油纸、梨黄主强调、天青次强调、珊瑚点缀、圆角、柔和阴影、按压反馈）；**macrostructure** = Workbench（图纸画布是页面核心内容）。
- **平台适配（写明原因）**：① WXSS 编译器对 `oklch()` 支持不确定 → Hum 色值已由 OKLCH 精确换算为 hex，存为命名令牌，仍保持"所有颜色走令牌"纪律；② 小程序无法加载 Web 字体 → 显示/正文用系统圆体栈 `PingFang SC`，等宽标签用系统等宽栈，全部令牌化；③ 小程序无站点级导航/页脚 → 不选用 N#/Ft# 原型，页面操作用底部操作条；④ `prefers-reduced-motion` 在 WXSS 中尽量保留（不支持的客户端会忽略），动画本身克制（≤3 个原语）。
- **导航**：`app.json` 的 `pages` 最前面加 `page/index/index`、`page/pattern/index`、`page/pattern-edit/index`，其余页面、分包、tabBar、darkmode 一律不动。
- **数据流**：`getApp().globalData.pattern = { grid, size, set, imagePath }`；grid 为 `grid[row][col] = 色号` 二维数组。
- **算法**：contain 缩放（白底补齐，透明像素按白）→ 双线性采样（天然区域平均）→ CIELAB 最近色匹配，只输出当前套装内色号。不做抖动。
- **展示/修改 canvas**：cellSize=20px、gap=1px（104 格 → 2183px 画布），`movable-area + movable-view(scale)` 支持拖动与双指缩放；导出时临时改 cellSize=16（104 格 → 1767px，规避部分安卓 2048px 画布上限），导出后恢复。
- **测试**：node 无框架单测（断言失败即非 0 退出）；`node --check` 校验所有 JS 语法；JSON 用 node `JSON.parse` 校验。

---

## 文件结构

```
scripts/build-colors.js                    生成 colors.json（保留，便于后续校正色卡）
miniprogram/data/colors.json               色卡数据（生成产物，不手写）
miniprogram/utils/color.js                 sRGB→CIELAB、最近色匹配、套装调色板
miniprogram/utils/pattern.js               网格映射/计数/绘制（纯函数部分可 node 测试）
miniprogram/styles/tokens.wxss             Hum 设计令牌（各页 @import）
tests/color.test.js                        色卡完整性 + 最近色匹配测试
tests/pattern.test.js                      网格映射 + 计数测试
miniprogram/page/index/index.{js,json,wxml,wxss}     主界面
miniprogram/page/pattern/index.{js,json,wxml,wxss}   展示页
miniprogram/page/pattern-edit/index.{js,json,wxml,wxss} 修改页
.hallmark/log.json                         hallmark 项目记忆（Task 4 创建）
```

修改既有文件：仅 `miniprogram/app.json`（pages 数组前插 3 项）。

---

### Task 1: 色卡数据生成脚本与 colors.json

**Files:**
- Create: `scripts/build-colors.js`
- Generated: `miniprogram/data/colors.json`（脚本输出，提交入库）
- Read: `docs/拼豆标准色彩RGB与拼豆盘尺寸.md`

- [ ] **Step 1: 写生成脚本**

```js
// scripts/build-colors.js
/**
 * 从 docs/拼豆标准色彩RGB与拼豆盘尺寸.md 生成 miniprogram/data/colors.json
 * 用法: node scripts/build-colors.js
 * RGB 以 docs 第 3 节主表为准；第 4 节套装表只提供色号成员关系。
 */
const fs = require('fs')
const path = require('path')

const DOC = path.join(__dirname, '..', 'docs', '拼豆标准色彩RGB与拼豆盘尺寸.md')
const OUT = path.join(__dirname, '..', 'miniprogram', 'data', 'colors.json')

const MAIN_ROW = /^\|\s*([A-HM]\d{1,2})\s*\|\s*(#[0-9A-Fa-f]{6})\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|$/
const SET_ROW = /^\|\s*([A-HM]\d{1,2})\s*\|\s*(#[0-9A-Fa-f]{6})\s*\|$/
const SET_HEAD = /^###\s*4\.(\d)\s*MARD\s*(\d+)\s*色/

const md = fs.readFileSync(DOC, 'utf8')
const lines = md.split(/\r?\n/)

const colors = {}
const sets = {}
let currentSet = null

for (const line of lines) {
  const head = line.match(SET_HEAD)
  if (head) {
    currentSet = head[2]
    sets[currentSet] = []
    continue
  }
  const main = line.match(MAIN_ROW)
  if (main) {
    colors[main[1]] = {
      code: main[1],
      hex: main[2].toUpperCase(),
      rgb: [Number(main[3]), Number(main[4]), Number(main[5])]
    }
    continue
  }
  const setRow = line.match(SET_ROW)
  if (setRow && currentSet && !sets[currentSet].includes(setRow[1])) {
    sets[currentSet].push(setRow[1])
  }
}

const assert = (cond, msg) => {
  if (!cond) throw new Error('色卡校验失败: ' + msg)
}

assert(Object.keys(colors).length === 221, '主表应有 221 色，实际 ' + Object.keys(colors).length)
assert(sets['48'] && sets['48'].length === 48, '48 套装应有 48 色')
assert(sets['72'] && sets['72'].length === 72, '72 套装应有 72 色')
assert(sets['144'] && sets['144'].length === 144, '144 套装应有 144 色')
assert(sets['221'] && sets['221'].length === 221, '221 套装应有 221 色')

for (const key of Object.keys(sets)) {
  for (const code of sets[key]) {
    assert(colors[code], '套装 ' + key + ' 含主表没有的色号 ' + code)
  }
}
assert(Object.keys(colors).every((c) => sets['221'].includes(c)), '第 4.4 节清单与主表色号应一致')

const subset = (a, b) => a.every((c) => b.includes(c))
assert(subset(sets['48'], sets['72']), '48 应 ⊆ 72')
assert(subset(sets['72'], sets['144']), '72 应 ⊆ 144')
assert(subset(sets['144'], sets['221']), '144 应 ⊆ 221')

const data = { sets, colors }
fs.writeFileSync(OUT, JSON.stringify(data, null, 2) + '\n', 'utf8')
console.log(
  'colors.json 已生成: ' +
    Object.keys(colors).length +
    ' 色, 套装 48/72/144/221 = ' +
    [sets['48'].length, sets['72'].length, sets['144'].length, sets['221'].length].join('/')
)
```

- [ ] **Step 2: 运行脚本并验证输出**

Run: `node scripts/build-colors.js`
Expected: `colors.json 已生成: 221 色, 套装 48/72/144/221 = 48/72/144/221`（若文档数据与断言不符，脚本会抛错，此时停下检查 docs 数据，不要绕过断言）

- [ ] **Step 3: 校验 JSON 可解析且计数正确**

Run: `node -e "const d=require('./miniprogram/data/colors.json'); if(Object.keys(d.colors).length!==221||d.sets['48'].length!==48||d.sets['72'].length!==72||d.sets['144'].length!==144||d.sets['221'].length!==221)process.exit(1); console.log('json ok')"`
Expected: `json ok`

- [ ] **Step 4: 提交**

```bash
git add scripts/build-colors.js miniprogram/data/colors.json
git commit -m "feat: add MARD color card data and build script"
```

---

### Task 2: utils/color.js（CIELAB 最近色匹配）+ 测试

**Files:**
- Create: `tests/color.test.js`
- Create: `miniprogram/utils/color.js`

- [ ] **Step 1: 写失败测试**

```js
// tests/color.test.js
/**
 * 色卡与最近色匹配测试。运行: node tests/color.test.js
 */
const assert = require('assert')
const data = require('../miniprogram/data/colors.json')
const color = require('../miniprogram/utils/color.js')

const SIZES = { 48: 48, 72: 72, 144: 144, 221: 221 }

assert.strictEqual(Object.keys(data.colors).length, 221, '主表应有 221 色')
for (const key of Object.keys(SIZES)) {
  assert.strictEqual(data.sets[key].length, SIZES[key], '套装 ' + key + ' 应有 ' + SIZES[key] + ' 色')
  assert.ok(data.sets[key].every((c) => data.colors[c]), '套装 ' + key + ' 存在未知色号')
}
const has = (arr, item) => arr.indexOf(item) >= 0
assert.ok(data.sets['48'].every((c) => has(data.sets['72'], c)), '48 应 ⊆ 72')
assert.ok(data.sets['72'].every((c) => has(data.sets['144'], c)), '72 应 ⊆ 144')
assert.ok(data.sets['144'].every((c) => has(data.sets['221'], c)), '144 应 ⊆ 221')

const a4 = data.colors['A4']
assert.strictEqual(color.nearestColor(a4.rgb[0], a4.rgb[1], a4.rgb[2], color.buildPalette('221')).code, 'A4', '精确 RGB 应命中 A4')

const red = color.nearestColor(255, 0, 0, color.buildPalette('221'))
assert.ok(red.code.charAt(0) === 'F', '纯红应命中 F 系，实际 ' + red.code)

for (let i = 0; i < 200; i++) {
  const r = Math.floor(Math.random() * 256)
  const g = Math.floor(Math.random() * 256)
  const b = Math.floor(Math.random() * 256)
  const hit = color.nearestColor(r, g, b, color.buildPalette('48'))
  assert.ok(data.sets['48'].indexOf(hit.code) >= 0, '48 套装匹配越界: ' + hit.code)
}

console.log('color.test.js 全部通过 ✓')
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node tests/color.test.js`
Expected: FAIL（`Cannot find module '../miniprogram/utils/color.js'`）

- [ ] **Step 3: 写最小实现**

```js
// miniprogram/utils/color.js
/**
 * 颜色工具：sRGB → CIELAB、最近色匹配、按套装构建调色板。
 * 纯函数，可在 Node 中测试；小程序与测试共用。
 */
const colorsData = require('../data/colors.json')

const CACHE = {}

function srgbToLinear(c) {
  c /= 255
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

function rgbToLab(r, g, b) {
  const rl = srgbToLinear(r)
  const gl = srgbToLinear(g)
  const bl = srgbToLinear(b)
  const x = (rl * 0.4124564 + gl * 0.3575761 + bl * 0.1804375) * 100
  const y = (rl * 0.2126729 + gl * 0.7151522 + bl * 0.072175) * 100
  const z = (rl * 0.0193339 + gl * 0.119192 + bl * 0.9503041) * 100
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
  const fx = f(x / 95.047)
  const fy = f(y / 100)
  const fz = f(z / 108.883)
  return {
    L: 116 * fy - 16,
    a: 500 * (fx - fy),
    b: 200 * (fy - fz)
  }
}

function labDistance(a, b) {
  const dL = a.L - b.L
  const da = a.a - b.a
  const db = a.b - b.b
  return Math.sqrt(dL * dL + da * da + db * db)
}

function buildPalette(setKey) {
  const key = String(setKey)
  if (CACHE[key]) return CACHE[key]
  const codes = colorsData.sets[key] || []
  const palette = codes.map((code) => {
    const c = colorsData.colors[code]
    return {
      code,
      hex: c.hex,
      rgb: c.rgb,
      lab: rgbToLab(c.rgb[0], c.rgb[1], c.rgb[2])
    }
  })
  CACHE[key] = palette
  return palette
}

function nearestColor(r, g, b, palette) {
  const lab = rgbToLab(r, g, b)
  let best = null
  let bestDist = Infinity
  for (const item of palette) {
    const d = labDistance(lab, item.lab)
    if (d < bestDist) {
      bestDist = d
      best = item
    }
  }
  return best
}

module.exports = { rgbToLab, labDistance, buildPalette, nearestColor }
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node tests/color.test.js`
Expected: `color.test.js 全部通过 ✓`，exit 0

- [ ] **Step 5: 语法检查**

Run: `node --check miniprogram/utils/color.js && node --check tests/color.test.js`
Expected: 无输出，exit 0

- [ ] **Step 6: 提交**

```bash
git add miniprogram/utils/color.js tests/color.test.js
git commit -m "feat: add CIELAB nearest-color matching with tests"
```

---

### Task 3: utils/pattern.js（网格映射/计数/绘制）+ 测试

**Files:**
- Create: `tests/pattern.test.js`
- Create: `miniprogram/utils/pattern.js`

- [ ] **Step 1: 写失败测试**

```js
// tests/pattern.test.js
/**
 * 图纸映射与统计测试。运行: node tests/pattern.test.js
 */
const assert = require('assert')
const color = require('../miniprogram/utils/color.js')
const pattern = require('../miniprogram/utils/pattern.js')

const palette = color.buildPalette('221')
const white = color.nearestColor(255, 255, 255, palette)
const red = color.nearestColor(255, 0, 0, palette)

function fakeImageData(pixels) {
  const data = []
  for (const px of pixels) data.push(px[0], px[1], px[2], px[3])
  return { data: new Uint8ClampedArray(data) }
}

const img = fakeImageData([
  [247, 236, 92, 255], [255, 255, 255, 255],
  [255, 0, 0, 255], [10, 10, 10, 0]
])
const grid = pattern.mapRgbGrid(img, 2, palette)
assert.strictEqual(grid[0][0], 'A4', '精确色应命中 A4')
assert.strictEqual(grid[0][1], white.code, '白色像素应命中白色')
assert.strictEqual(grid[1][0], red.code, '红色应命中其最近色')
assert.strictEqual(grid[1][1], white.code, '透明像素应按白色处理')
assert.strictEqual(grid.length, 2, '网格行数应为 2')

const g2 = [
  ['A1', 'A1', 'A4'],
  ['A4', 'A1', 'A4']
]
const counts = pattern.countColors(g2, ['A1', 'A4'])
assert.deepStrictEqual(counts, [
  { code: 'A1', count: 3 },
  { code: 'A4', count: 3 }
], '计数应按套装顺序排序')
assert.strictEqual(counts.reduce((s, x) => s + x.count, 0), 6, '总数应为 6')

console.log('pattern.test.js 全部通过 ✓')
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node tests/pattern.test.js`
Expected: FAIL（`Cannot find module '../miniprogram/utils/pattern.js'`）

- [ ] **Step 3: 写最小实现**

```js
// miniprogram/utils/pattern.js
/**
 * 图纸数据与渲染：RGB 网格 → 色号网格、色号计数、canvas 绘制。
 * mapRgbGrid / countColors 为纯函数，可在 Node 中测试。
 */
const color = require('./color')

const CELL = 20 // 展示格边长 px
const GAP = 1 // 格线留缝 px
const EXPORT_CELL = 16 // 导出格边长 px（104 格 → 1767px，规避部分设备 2048px 上限）

function mapRgbGrid(imageData, size, palette) {
  const grid = []
  const data = imageData.data
  for (let r = 0; r < size; r++) {
    const row = []
    for (let c = 0; c < size; c++) {
      const i = (r * size + c) * 4
      let rgb = [data[i], data[i + 1], data[i + 2]]
      if (data[i + 3] < 128) rgb = [255, 255, 255]
      row.push(color.nearestColor(rgb[0], rgb[1], rgb[2], palette).code)
    }
    grid.push(row)
  }
  return grid
}

function countColors(grid, setCodes) {
  const countMap = {}
  for (const row of grid) {
    for (const code of row) {
      countMap[code] = (countMap[code] || 0) + 1
    }
  }
  const order = {}
  setCodes.forEach((code, i) => {
    order[code] = i
  })
  return Object.keys(countMap)
    .map((code) => ({ code, count: countMap[code] }))
    .sort((a, b) => (order[a.code] || 0) - (order[b.code] || 0))
}

function cellItem(palette, code) {
  for (const item of palette) {
    if (item.code === code) return item
  }
  return { hex: '#ffffff' }
}

function luminance(hex) {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return 0.299 * r + 0.587 * g + 0.114 * b
}

function drawCell(ctx, grid, r, c, palette, opts) {
  const cellSize = (opts && opts.cellSize) || CELL
  const gap = (opts && opts.gap) || GAP
  const showCode = opts && opts.code !== false
  const highlight = opts && opts.highlight
  const code = grid[r][c]
  const hex = cellItem(palette, code).hex
  const x = c * (cellSize + gap)
  const y = r * (cellSize + gap)
  ctx.fillStyle = hex
  ctx.fillRect(x, y, cellSize, cellSize)
  if (showCode) {
    ctx.fillStyle = luminance(hex) > 150 ? '#12171b' : '#ffffff'
    ctx.font = '600 ' + Math.max(7, Math.round(cellSize * 0.45)) + 'px sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(code, x + cellSize / 2, y + cellSize / 2 + 0.5)
  }
  if (highlight) {
    ctx.strokeStyle = '#ff3a5d'
    ctx.lineWidth = Math.max(2, Math.round(cellSize / 6))
    ctx.strokeRect(x + 1, y + 1, cellSize - 2, cellSize - 2)
  }
}

function renderGrid(ctx, grid, palette, opts) {
  const cellSize = (opts && opts.cellSize) || CELL
  const gap = (opts && opts.gap) || GAP
  const showCode = opts && opts.code !== false
  const highlight = opts && opts.highlight
  const size = grid.length
  const total = size * (cellSize + gap) - gap
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, total, total)
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      drawCell(ctx, grid, r, c, palette, {
        cellSize,
        gap,
        code: showCode,
        highlight: !!(highlight && highlight.row === r && highlight.col === c)
      })
    }
  }
  return total
}

module.exports = {
  mapRgbGrid,
  countColors,
  renderGrid,
  drawCell,
  CELL,
  GAP,
  EXPORT_CELL
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node tests/pattern.test.js`
Expected: `pattern.test.js 全部通过 ✓`，exit 0

- [ ] **Step 5: 语法检查**

Run: `node --check miniprogram/utils/pattern.js && node --check tests/pattern.test.js`
Expected: 无输出，exit 0

- [ ] **Step 6: 提交**

```bash
git add miniprogram/utils/pattern.js tests/pattern.test.js
git commit -m "feat: add pattern grid mapping, counting and canvas renderer with tests"
```

---
### Task 4: 设计令牌 tokens.wxss + app.json 注册页面 + hallmark 项目记忆

**Files:**
- Create: `miniprogram/styles/tokens.wxss`
- Create: `.hallmark/log.json`
- Modify: `miniprogram/app.json`（pages 数组最前面插入 3 项）

- [ ] **Step 1: 写 tokens.wxss（Hum 主题令牌，hex 为 OKLCH 精确换算）**

```css
/* Hallmark · genre: playful · macrostructure: Workbench · theme: Hum · enrichment: none
 * nav: N/A（微信小程序无站点导航） · footer: N/A（微信小程序无站点页脚）
 * 适配说明：WXSS 对 oklch() 支持不确定 → 已换算为 hex；小程序无法加载 Web 字体 → 系统圆体栈
 */
page {
  --color-paper: #f7f5ec;
  --color-paper-2: #eeebdf;
  --color-paper-3: #e5e1d3;
  --color-ink: #12171b;
  --color-ink-2: #4d5660;
  --color-neutral: #7a8189;
  --color-rule: #d1cec3;
  --color-accent: #f6ce00;
  --color-accent-deep: #e6b900;
  --color-accent-2: #009fef;
  --color-accent-2-deep: #0086d4;
  --color-accent-3: #ff3a5d;
  --color-mint: #66da85;
  --color-lavender: #c28efb;
  --color-focus: #007cca;
  --color-accent-ink: #12171b;
  --color-bead-bg: #ffffff;
  --color-shadow: rgba(18, 23, 27, 0.12);
  --color-cast: rgba(230, 185, 0, 0.45);
  --font-display: "PingFang SC", "Microsoft YaHei", sans-serif;
  --font-body: "PingFang SC", "Microsoft YaHei", sans-serif;
  --font-label: "SF Mono", Consolas, monospace;
  --space-3xs: 4rpx;
  --space-2xs: 8rpx;
  --space-xs: 16rpx;
  --space-sm: 24rpx;
  --space-md: 32rpx;
  --space-lg: 48rpx;
  --space-xl: 80rpx;
  --space-2xl: 128rpx;
  --text-xs: 20rpx;
  --text-sm: 26rpx;
  --text-base: 32rpx;
  --text-md: 40rpx;
  --text-lg: 50rpx;
  --text-xl: 62rpx;
  --radius-card: 40rpx;
  --radius-input: 24rpx;
  --radius-pill: 999rpx;
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --ease-in: cubic-bezier(0.7, 0, 0.84, 0);
  --ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);
  --dur-micro: 120ms;
  --dur-short: 220ms;
  --dur-long: 420ms;
  --z-raised: 10;
  --z-sticky: 200;
  --z-modal: 400;
  background: var(--color-paper);
  color: var(--color-ink);
  font-family: var(--font-body);
  font-size: var(--text-base);
  line-height: 1.6;
}

.btn {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 96rpx;
  border-radius: var(--radius-pill);
  font-size: var(--text-md);
  font-weight: 600;
  font-family: var(--font-body);
  border: 0;
  line-height: 1;
}
.btn::after {
  border: 0;
}
.btn--primary {
  background: var(--color-accent);
  color: var(--color-accent-ink);
  box-shadow: 0 8rpx 0 0 var(--color-accent-deep), 0 12rpx 24rpx -6rpx var(--color-cast);
  transition: transform var(--dur-micro) var(--ease-out), box-shadow var(--dur-micro) var(--ease-out);
}
.btn--primary.btn--pressed {
  transform: translateY(6rpx);
  box-shadow: 0 2rpx 0 0 var(--color-accent-deep), 0 4rpx 8rpx -4rpx var(--color-cast);
}
.btn--primary[disabled] {
  opacity: 0.5;
  box-shadow: 0 8rpx 0 0 var(--color-accent-deep);
}
.btn--soft {
  background: var(--color-paper-2);
  color: var(--color-ink);
  border: 2rpx solid var(--color-rule);
  transition: background-color var(--dur-short) var(--ease-out), transform var(--dur-micro) var(--ease-out);
}
.btn--soft.btn--pressed {
  background: var(--color-paper-3);
  transform: translateY(2rpx);
}
.btn--sm {
  height: 72rpx;
  padding: 0 var(--space-md);
  font-size: var(--text-sm);
}
.btn--lg {
  width: 100%;
}
```

- [ ] **Step 2: 修改 app.json（pages 数组最前面插入 3 项）**

将：
```json
  "pages": [
    "page/component/index",
```
改为：
```json
  "pages": [
    "page/index/index",
    "page/pattern/index",
    "page/pattern-edit/index",
    "page/component/index",
```
其余内容一律不动。

- [ ] **Step 3: 创建 .hallmark/log.json**

```json
[
  {
    "date": "2026-08-03",
    "macrostructure": "Workbench",
    "theme": "Hum",
    "enrichment": "none",
    "brief": "拼豆图纸小程序 · 三页工具流（生成/展示/修改）"
  }
]
```

- [ ] **Step 4: 校验 JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('miniprogram/app.json','utf8')); JSON.parse(require('fs').readFileSync('.hallmark/log.json','utf8')); console.log('json ok')"`
Expected: `json ok`

- [ ] **Step 5: 提交**

```bash
git add miniprogram/styles/tokens.wxss miniprogram/app.json .hallmark/log.json
git commit -m "feat: add Hum design tokens and register pages"
```

---

### Task 5: 主界面（page/index/index）

**Files:**
- Create: `miniprogram/page/index/index.json`
- Create: `miniprogram/page/index/index.wxml`
- Create: `miniprogram/page/index/index.wxss`
- Create: `miniprogram/page/index/index.js`

- [ ] **Step 1: 写页面配置**

```json
{
  "navigationBarTitleText": "拼豆图纸",
  "navigationBarBackgroundColor": "#f7f5ec",
  "navigationBarTextStyle": "black"
}
```

- [ ] **Step 2: 写页面结构**

```xml
<view class="page">
  <view class="hero">
    <view class="hero-title">拼豆图纸</view>
    <view class="hero-sub">一张图，变成一盒豆。</view>
  </view>

  <view class="card import-card {{imagePath ? 'has-image' : ''}}" hover-class="import-card--pressed" bindtap="chooseImage">
    <block wx:if="{{!imagePath}}">
      <view class="bead"></view>
      <view class="import-title">点击导入图片</view>
      <view class="import-sub">从相册选择，或拍一张</view>
    </block>
    <block wx:else>
      <image class="import-img" src="{{imagePath}}" mode="aspectFill" />
      <view class="import-again">重新选择</view>
    </block>
  </view>

  <view class="card section">
    <view class="section-title">色系</view>
    <view class="chip-row">
      <view
        wx:for="{{colorSets}}"
        wx:key="*this"
        class="chip {{set === item ? 'chip--on' : ''}}"
        hover-class="chip--pressed"
        data-value="{{item}}"
        bindtap="pickSet"
      >{{item}} 色</view>
    </view>
  </view>

  <view class="card section">
    <view class="section-title">拼豆盘</view>
    <view class="chip-row">
      <view
        wx:for="{{boardSizes}}"
        wx:key="*this"
        class="chip {{size === item ? 'chip--on' : ''}}"
        hover-class="chip--pressed"
        data-value="{{item}}"
        bindtap="pickSize"
      >{{item}}×{{item}}</view>
    </view>
  </view>

  <button
    class="btn btn--primary btn--lg generate"
    hover-class="btn--pressed"
    disabled="{{!imagePath || generating}}"
    bindtap="generate"
  >{{generating ? '生成中…' : '生成图纸'}}</button>
</view>
```

- [ ] **Step 3: 写页面样式**

```css
@import "../../styles/tokens.wxss";

.page {
  padding: var(--space-xl) var(--space-md) calc(var(--space-xl) + 48rpx);
}

.hero {
  padding: var(--space-xs) 0 var(--space-lg);
}
.hero-title {
  font-family: var(--font-display);
  font-size: var(--text-xl);
  font-weight: 600;
  letter-spacing: -0.025em;
  color: var(--color-ink);
}
.hero-sub {
  margin-top: var(--space-2xs);
  font-size: var(--text-sm);
  color: var(--color-ink-2);
}

.card {
  background: var(--color-paper);
  border-radius: var(--radius-card);
  box-shadow: 0 12rpx 32rpx -16rpx var(--color-shadow);
  margin-bottom: var(--space-md);
  padding: var(--space-md);
  transition: transform var(--dur-micro) var(--ease-out);
}

.import-card {
  min-height: 320rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  border: 3rpx dashed var(--color-rule);
  border-radius: var(--radius-card);
  background: var(--color-paper-2);
  box-shadow: none;
  overflow: hidden;
}
.import-card--pressed {
  transform: translateY(3rpx);
}
.import-card.has-image {
  border-style: solid;
  background: var(--color-paper);
  box-shadow: 0 12rpx 32rpx -16rpx var(--color-shadow);
}
.bead {
  width: 88rpx;
  height: 88rpx;
  border-radius: 50%;
  background: radial-gradient(circle at 32% 28%, #fff7c2 0 18%, var(--color-accent) 58%, var(--color-accent-deep) 100%);
  box-shadow: inset 0 -10rpx 14rpx rgba(230, 185, 0, 0.55);
  animation: bead-breathe 4s ease-in-out infinite;
}
@keyframes bead-breathe {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.06); }
}
.import-title {
  margin-top: var(--space-md);
  font-size: var(--text-md);
  font-weight: 600;
  color: var(--color-ink);
}
.import-sub {
  margin-top: var(--space-2xs);
  font-size: var(--text-sm);
  color: var(--color-ink-2);
}
.import-img {
  width: 100%;
  height: 420rpx;
  border-radius: var(--radius-input);
}
.import-again {
  margin-top: var(--space-sm);
  font-size: var(--text-sm);
  color: var(--color-accent-2-deep);
}

.section-title {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--color-ink-2);
  margin-bottom: var(--space-sm);
}

.chip-row {
  display: flex;
  gap: var(--space-xs);
}
.chip {
  flex: 1;
  text-align: center;
  padding: 20rpx 0;
  border-radius: var(--radius-pill);
  background: var(--color-paper);
  border: 2rpx solid var(--color-rule);
  font-size: var(--text-sm);
  color: var(--color-ink-2);
  transition: background-color var(--dur-short) var(--ease-out), color var(--dur-short) var(--ease-out), border-color var(--dur-short) var(--ease-out), transform var(--dur-micro) var(--ease-out);
}
.chip--on {
  background: var(--color-accent);
  border-color: var(--color-accent-deep);
  color: var(--color-accent-ink);
  font-weight: 600;
}
.chip--pressed {
  transform: translateY(2rpx);
}

.generate {
  margin-top: var(--space-lg);
}
```

- [ ] **Step 4: 写页面逻辑**

```js
// miniprogram/page/index/index.js
const pattern = require('../../utils/pattern.js')
const color = require('../../utils/color.js')

Page({
  data: {
    imagePath: '',
    set: '221',
    size: 52,
    colorSets: ['48', '72', '144', '221'],
    boardSizes: [52, 78, 104],
    generating: false
  },

  chooseImage() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const file = res.tempFiles && res.tempFiles[0]
        if (!file) return
        this.setData({ imagePath: file.tempFilePath })
      }
    })
  },

  pickSet(e) {
    this.setData({ set: e.currentTarget.dataset.value })
  },

  pickSize(e) {
    this.setData({ size: Number(e.currentTarget.dataset.value) })
  },

  generate() {
    if (this.data.generating || !this.data.imagePath) return
    this.setData({ generating: true })
    wx.showLoading({ title: '生成中…', mask: true })
    this.buildGrid(this.data.imagePath, this.data.size, this.data.set)
      .then((grid) => {
        getApp().globalData.pattern = {
          grid,
          size: this.data.size,
          set: this.data.set,
          imagePath: this.data.imagePath
        }
        wx.hideLoading()
        wx.navigateTo({ url: '/page/pattern/index' })
      })
      .catch((err) => {
        wx.hideLoading()
        wx.showToast({ title: '生成失败，请换一张图', icon: 'none' })
        console.error(err)
      })
      .then(() => {
        this.setData({ generating: false })
      })
  },

  buildGrid(imagePath, size, setKey) {
    return new Promise((resolve, reject) => {
      const canvas = wx.createOffscreenCanvas({ type: '2d', width: size, height: size })
      const ctx = canvas.getContext('2d')
      const img = canvas.createImage()
      img.onload = () => {
        try {
          const scale = Math.min(size / img.width, size / img.height)
          const dw = img.width * scale
          const dh = img.height * scale
          ctx.fillStyle = '#ffffff'
          ctx.fillRect(0, 0, size, size)
          ctx.drawImage(img, (size - dw) / 2, (size - dh) / 2, dw, dh)
          const imageData = ctx.getImageData(0, 0, size, size)
          resolve(pattern.mapRgbGrid(imageData, size, color.buildPalette(setKey)))
        } catch (e) {
          reject(e)
        }
      }
      img.onerror = () => reject(new Error('image load failed'))
      img.src = imagePath
    })
  }
})
```

- [ ] **Step 5: 校验**

Run: `node --check miniprogram/page/index/index.js`
Expected: 无输出，exit 0

Run: `node -e "JSON.parse(require('fs').readFileSync('miniprogram/page/index/index.json','utf8')); console.log('json ok')"`
Expected: `json ok`

- [ ] **Step 6: 提交**

```bash
git add miniprogram/page/index/index.json miniprogram/page/index/index.wxml miniprogram/page/index/index.wxss miniprogram/page/index/index.js
git commit -m "feat: add home page with image import, palette and board options"
```

---

### Task 6: 图纸展示页（page/pattern/index）

**Files:**
- Create: `miniprogram/page/pattern/index.json`
- Create: `miniprogram/page/pattern/index.wxml`
- Create: `miniprogram/page/pattern/index.wxss`
- Create: `miniprogram/page/pattern/index.js`

- [ ] **Step 1: 写页面配置**

```json
{
  "navigationBarTitleText": "图纸预览",
  "navigationBarBackgroundColor": "#f7f5ec",
  "navigationBarTextStyle": "black"
}
```

- [ ] **Step 2: 写页面结构**

```xml
<view class="page">
  <view class="meta card">
    <view class="meta-item">
      <text class="meta-label">色系</text>
      <text class="meta-value">{{set}} 色</text>
    </view>
    <view class="meta-item">
      <text class="meta-label">拼豆盘</text>
      <text class="meta-value">{{size}}×{{size}}</text>
    </view>
  </view>

  <view class="canvas-shell card">
    <movable-area class="canvas-area" scale-area>
      <movable-view class="canvas-view" direction="all" scale scale-min="0.3" scale-max="4">
        <canvas type="2d" id="patternCanvas" class="pattern-canvas" />
      </movable-view>
    </movable-area>
    <view class="canvas-hint">双指缩放 · 拖动查看</view>
  </view>

  <view class="legend card">
    <view class="legend-head">
      <view class="section-title">用到的颜色</view>
      <view class="legend-total">共 {{total}} 格</view>
    </view>
    <view class="legend-list">
      <view wx:for="{{legend}}" wx:key="code" class="legend-item">
        <view class="legend-swatch" style="background: {{item.hex}}"></view>
        <text class="legend-code">{{item.code}}</text>
        <text class="legend-count">× {{item.count}}</text>
      </view>
    </view>
  </view>

  <view class="action-bar">
    <button class="btn btn--soft action-btn" hover-class="btn--pressed" bindtap="goEdit">进入修改</button>
    <button class="btn btn--primary action-btn" hover-class="btn--pressed" bindtap="exportImage">导出图片</button>
  </view>
</view>
```

- [ ] **Step 3: 写页面样式**

```css
@import "../../styles/tokens.wxss";

.page {
  padding: var(--space-md) var(--space-md) calc(180rpx + 48rpx);
}

.meta {
  display: flex;
  gap: var(--space-lg);
  padding: var(--space-sm) var(--space-md);
}
.meta-item {
  display: flex;
  align-items: baseline;
  gap: var(--space-2xs);
}
.meta-label {
  font-size: var(--text-xs);
  color: var(--color-neutral);
}
.meta-value {
  font-family: var(--font-label);
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--color-ink);
}

.canvas-shell {
  padding: var(--space-sm);
}
.canvas-area {
  width: 100%;
  height: 620rpx;
  border-radius: var(--radius-input);
  background: var(--color-paper-2);
  overflow: hidden;
}
.canvas-view {
  width: 1px;
  height: 1px;
}
.pattern-canvas {
  display: block;
}
.canvas-hint {
  margin-top: var(--space-sm);
  text-align: center;
  font-size: var(--text-xs);
  color: var(--color-neutral);
}

.legend-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: var(--space-sm);
}
.legend-total {
  font-family: var(--font-label);
  font-size: var(--text-xs);
  color: var(--color-neutral);
}
.legend-list {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2xs);
}
.legend-item {
  display: flex;
  align-items: center;
  gap: var(--space-2xs);
  padding: var(--space-2xs) var(--space-xs);
  border-radius: var(--radius-pill);
  background: var(--color-paper-2);
}
.legend-swatch {
  width: 32rpx;
  height: 32rpx;
  border-radius: 50%;
  border: 2rpx solid var(--color-rule);
}
.legend-code {
  font-family: var(--font-label);
  font-size: var(--text-xs);
  color: var(--color-ink);
  font-weight: 600;
}
.legend-count {
  font-family: var(--font-label);
  font-size: var(--text-xs);
  color: var(--color-ink-2);
}

.action-bar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  gap: var(--space-sm);
  padding: var(--space-sm) var(--space-md) calc(var(--space-sm) + env(safe-area-inset-bottom));
  background: var(--color-paper);
  box-shadow: 0 -8rpx 24rpx -16rpx var(--color-shadow);
  z-index: var(--z-sticky);
}
.action-btn {
  flex: 1;
}
```

- [ ] **Step 4: 写页面逻辑**

```js
// miniprogram/page/pattern/index.js
const pattern = require('../../utils/pattern.js')
const color = require('../../utils/color.js')

Page({
  data: {
    set: '221',
    size: 52,
    legend: [],
    total: 0
  },

  onLoad() {
    const p = getApp().globalData.pattern
    if (!p || !p.grid) {
      wx.showToast({ title: '没有可预览的图纸', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 800)
      return
    }
    this.pattern = p
    this.palette = color.buildPalette(p.set)
    this.setData({ set: p.set, size: p.size })
  },

  onShow() {
    if (!this.pattern) return
    this.updateLegend()
    if (this.canvas) this.drawPattern()
  },

  onReady() {
    this.drawPattern()
  },

  updateLegend() {
    const p = this.pattern
    const counts = pattern.countColors(p.grid, this.palette.map((i) => i.code))
    const hexByCode = {}
    this.palette.forEach((i) => {
      hexByCode[i.code] = i.hex
    })
    const total = p.size * p.size
    this.setData({
      legend: counts.map((i) => ({ code: i.code, count: i.count, hex: hexByCode[i.code] })),
      total
    })
  },

  drawPattern() {
    const p = this.pattern
    this.createSelectorQuery()
      .select('#patternCanvas')
      .fields({ node: true, size: true })
      .exec((res) => {
        if (!res || !res[0]) return
        const canvas = res[0].node
        const total = p.size * (pattern.CELL + pattern.GAP) - pattern.GAP
        canvas.width = total
        canvas.height = total
        const ctx = canvas.getContext('2d')
        pattern.renderGrid(ctx, p.grid, this.palette, {
          cellSize: pattern.CELL,
          gap: pattern.GAP,
          code: true
        })
        this.canvas = canvas
      })
  },

  goEdit() {
    wx.navigateTo({ url: '/page/pattern-edit/index' })
  },

  exportImage() {
    const canvas = this.canvas
    const p = this.pattern
    if (!canvas) return
    wx.showLoading({ title: '导出中…', mask: true })
    const total = p.size * (pattern.EXPORT_CELL + 1) - 1
    canvas.width = total
    canvas.height = total
    const ctx = canvas.getContext('2d')
    pattern.renderGrid(ctx, p.grid, this.palette, {
      cellSize: pattern.EXPORT_CELL,
      gap: 1,
      code: true
    })
    wx.canvasToTempFilePath({
      canvas,
      success: (res) => {
        this.restoreDisplay(canvas)
        this.saveToAlbum(res.tempFilePath)
      },
      fail: () => {
        this.restoreDisplay(canvas)
        wx.hideLoading()
        wx.showToast({ title: '导出失败', icon: 'none' })
      }
    })
  },

  restoreDisplay(canvas) {
    const p = this.pattern
    const total = p.size * (pattern.CELL + pattern.GAP) - pattern.GAP
    canvas.width = total
    canvas.height = total
    const ctx = canvas.getContext('2d')
    pattern.renderGrid(ctx, p.grid, this.palette, {
      cellSize: pattern.CELL,
      gap: pattern.GAP,
      code: true
    })
  },

  saveToAlbum(filePath) {
    wx.saveImageToPhotosAlbum({
      filePath,
      success: () => {
        wx.hideLoading()
        wx.showToast({ title: '已保存到相册', icon: 'success' })
      },
      fail: (err) => {
        wx.hideLoading()
        if (err.errMsg && err.errMsg.indexOf('auth deny') >= 0) {
          wx.showModal({
            title: '需要相册权限',
            content: '请在设置中开启"保存到相册"权限。',
            confirmText: '去设置',
            success: (r) => {
              if (r.confirm) wx.openSetting()
            }
          })
        } else {
          wx.showToast({ title: '保存失败', icon: 'none' })
        }
      }
    })
  }
})
```

- [ ] **Step 5: 校验**

Run: `node --check miniprogram/page/pattern/index.js`
Expected: 无输出，exit 0

Run: `node -e "JSON.parse(require('fs').readFileSync('miniprogram/page/pattern/index.json','utf8')); console.log('json ok')"`
Expected: `json ok`

- [ ] **Step 6: 提交**

```bash
git add miniprogram/page/pattern/index.json miniprogram/page/pattern/index.wxml miniprogram/page/pattern/index.wxss miniprogram/page/pattern/index.js
git commit -m "feat: add pattern preview page with legend and export"
```

---
### Task 7: 图纸修改页（page/pattern-edit/index）

**Files:**
- Create: `miniprogram/page/pattern-edit/index.json`
- Create: `miniprogram/page/pattern-edit/index.wxml`
- Create: `miniprogram/page/pattern-edit/index.wxss`
- Create: `miniprogram/page/pattern-edit/index.js`

- [ ] **Step 1: 写页面配置**

```json
{
  "navigationBarTitleText": "修改图纸",
  "navigationBarBackgroundColor": "#f7f5ec",
  "navigationBarTextStyle": "black"
}
```

- [ ] **Step 2: 写页面结构**

```xml
<view class="page">
  <view class="top-bar">
    <button class="btn btn--soft btn--sm" hover-class="btn--pressed" bindtap="finish">完成</button>
    <view class="cell-info">{{cellInfo}}</view>
  </view>

  <view class="canvas-shell card">
    <movable-area class="canvas-area" scale-area>
      <movable-view class="canvas-view" direction="all" scale scale-min="0.3" scale-max="4" bindscale="onScale">
        <canvas type="2d" id="editCanvas" class="pattern-canvas" bindtouchstart="onTouchStart" />
      </movable-view>
    </movable-area>
    <view class="canvas-hint">点选颜色后，点格子涂色</view>
  </view>

  <view class="palette">
    <scroll-view scroll-y class="palette-scroll">
      <view wx:for="{{groups}}" wx:for-item="group" wx:key="family" class="palette-group">
        <view class="palette-family">{{group.family}} · {{group.label}}</view>
        <view class="palette-boxes">
          <view
            wx:for="{{group.items}}"
            wx:for-item="item"
            wx:key="code"
            class="palette-box {{selected === item.code ? 'palette-box--on' : ''}}"
            hover-class="palette-box--pressed"
            data-code="{{item.code}}"
            bindtap="pickColor"
          >
            <view class="palette-swatch" style="background: {{item.hex}}"></view>
            <text class="palette-code">{{item.code}}</text>
          </view>
        </view>
      </view>
    </scroll-view>
  </view>
</view>
```

- [ ] **Step 3: 写页面样式**

```css
@import "../../styles/tokens.wxss";

.page {
  height: 100vh;
  display: flex;
  flex-direction: column;
  padding: var(--space-sm) var(--space-md) 0;
  box-sizing: border-box;
}

.top-bar {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  padding: var(--space-2xs) 0 var(--space-sm);
}
.cell-info {
  flex: 1;
  text-align: right;
  font-family: var(--font-label);
  font-size: var(--text-xs);
  color: var(--color-ink-2);
}

.canvas-shell {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: var(--space-sm);
}
.canvas-area {
  flex: 1;
  min-height: 0;
  border-radius: var(--radius-input);
  background: var(--color-paper-2);
  overflow: hidden;
}
.canvas-view {
  width: 1px;
  height: 1px;
}
.pattern-canvas {
  display: block;
}
.canvas-hint {
  margin-top: var(--space-2xs);
  text-align: center;
  font-size: var(--text-xs);
  color: var(--color-neutral);
}

.palette {
  height: 44vh;
  margin: var(--space-sm) calc(-1 * var(--space-md)) 0;
  padding: var(--space-sm) var(--space-md) calc(var(--space-sm) + env(safe-area-inset-bottom));
  background: var(--color-paper);
  border-radius: var(--radius-card) var(--radius-card) 0 0;
  box-shadow: 0 -8rpx 24rpx -16rpx var(--color-shadow);
}
.palette-scroll {
  height: 100%;
}
.palette-group {
  margin-bottom: var(--space-md);
}
.palette-family {
  font-family: var(--font-label);
  font-size: var(--text-xs);
  letter-spacing: 0.08em;
  color: var(--color-neutral);
  margin-bottom: var(--space-xs);
}
.palette-boxes {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2xs);
}
.palette-box {
  width: 104rpx;
  padding: var(--space-2xs) 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4rpx;
  border-radius: var(--radius-input);
  background: var(--color-paper-2);
  border: 3rpx solid transparent;
  transition: transform var(--dur-micro) var(--ease-out), border-color var(--dur-short) var(--ease-out), background-color var(--dur-short) var(--ease-out);
}
.palette-box--on {
  border-color: var(--color-accent-3);
  background: var(--color-paper);
  box-shadow: 0 6rpx 16rpx -8rpx var(--color-shadow);
}
.palette-box--pressed {
  transform: translateY(2rpx);
}
.palette-swatch {
  width: 64rpx;
  height: 64rpx;
  border-radius: 50%;
  border: 2rpx solid var(--color-rule);
  box-shadow: inset 0 -6rpx 8rpx rgba(18, 23, 27, 0.08);
}
.palette-code {
  font-family: var(--font-label);
  font-size: 18rpx;
  color: var(--color-ink);
}
```

- [ ] **Step 4: 写页面逻辑**

```js
// miniprogram/page/pattern-edit/index.js
const pattern = require('../../utils/pattern.js')
const color = require('../../utils/color.js')

const FAMILY_LABELS = {
  A: '黄橙',
  B: '绿',
  C: '蓝青',
  D: '紫',
  E: '粉',
  F: '红',
  G: '棕肤',
  H: '黑白灰',
  M: '中性'
}

Page({
  data: {
    groups: [],
    selected: '',
    cellInfo: '点选颜色，再点格子涂色',
    scale: 1
  },

  onLoad() {
    const p = getApp().globalData.pattern
    if (!p || !p.grid) {
      wx.showToast({ title: '没有可修改的图纸', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 800)
      return
    }
    this.pattern = p
    this.palette = color.buildPalette(p.set)
    this.highlight = null
    this.setData({
      groups: this.buildGroups(),
      selected: this.palette[0].code
    })
  },

  buildGroups() {
    const groups = []
    let current = null
    for (const item of this.palette) {
      const family = item.code.charAt(0)
      if (!current || current.family !== family) {
        current = {
          family,
          label: FAMILY_LABELS[family] || family,
          items: []
        }
        groups.push(current)
      }
      current.items.push({ code: item.code, hex: item.hex })
    }
    return groups
  },

  onReady() {
    this.draw()
  },

  draw() {
    const p = this.pattern
    this.createSelectorQuery()
      .select('#editCanvas')
      .fields({ node: true, size: true })
      .exec((res) => {
        if (!res || !res[0]) return
        const canvas = res[0].node
        const total = p.size * (pattern.CELL + pattern.GAP) - pattern.GAP
        canvas.width = total
        canvas.height = total
        const ctx = canvas.getContext('2d')
        pattern.renderGrid(ctx, p.grid, this.palette, {
          cellSize: pattern.CELL,
          gap: pattern.GAP,
          code: true,
          highlight: this.highlight
        })
        this.canvas = canvas
        this.ctx = ctx
      })
  },

  onScale(e) {
    this.setData({ scale: e.detail.scale })
  },

  onTouchStart(e) {
    const t = e.touches && e.touches[0]
    if (!t) return
    const p = this.pattern
    const cell = pattern.CELL + pattern.GAP
    const col = Math.floor(t.x / this.data.scale / cell)
    const row = Math.floor(t.y / this.data.scale / cell)
    if (row < 0 || col < 0 || row >= p.size || col >= p.size) return

    const prev = this.highlight
    p.grid[row][col] = this.data.selected
    this.highlight = { row, col }
    this.setData({ cellInfo: '第 ' + (row + 1) + ' 行 · 第 ' + (col + 1) + ' 列 · ' + p.grid[row][col] })

    const base = { cellSize: pattern.CELL, gap: pattern.GAP }
    if (prev) pattern.drawCell(this.ctx, p.grid, prev.row, prev.col, this.palette, base)
    pattern.drawCell(this.ctx, p.grid, row, col, this.palette, Object.assign({}, base, { highlight: true }))
  },

  pickColor(e) {
    this.setData({ selected: e.currentTarget.dataset.code })
  },

  finish() {
    wx.navigateBack()
  }
})
```

- [ ] **Step 5: 校验**

Run: `node --check miniprogram/page/pattern-edit/index.js`
Expected: 无输出，exit 0

Run: `node -e "JSON.parse(require('fs').readFileSync('miniprogram/page/pattern-edit/index.json','utf8')); console.log('json ok')"`
Expected: `json ok`

- [ ] **Step 6: 提交**

```bash
git add miniprogram/page/pattern-edit/index.json miniprogram/page/pattern-edit/index.wxml miniprogram/page/pattern-edit/index.wxss miniprogram/page/pattern-edit/index.js
git commit -m "feat: add pattern edit page with bead-box palette"
```

---

### Task 8: 全量验证与收尾

**Files:** 无新增（只运行验证）

- [ ] **Step 1: 全量单测**

Run: `node tests/color.test.js && node tests/pattern.test.js`
Expected: 两行通过输出，exit 0

- [ ] **Step 2: 全量语法检查（新增 JS 文件）**

Run:
```
node --check miniprogram/utils/color.js
node --check miniprogram/utils/pattern.js
node --check miniprogram/page/index/index.js
node --check miniprogram/page/pattern/index.js
node --check miniprogram/page/pattern-edit/index.js
node --check scripts/build-colors.js
```
Expected: 每行无输出，最终 exit 0

- [ ] **Step 3: 全量 JSON 校验**

Run: `node -e "const fs=require('fs'); ['miniprogram/app.json','miniprogram/data/colors.json','miniprogram/page/index/index.json','miniprogram/page/pattern/index.json','miniprogram/page/pattern-edit/index.json','.hallmark/log.json'].forEach(f=>JSON.parse(fs.readFileSync(f,'utf8'))); console.log('all json ok')"`
Expected: `all json ok`

- [ ] **Step 4: 确认 app.json 页面注册顺序**

Run: `node -e "const j=require('./miniprogram/app.json'); console.log(j.pages.slice(0,3).join(','))"`
Expected: `page/index/index,page/pattern/index,page/pattern-edit/index`

- [ ] **Step 5: Hallmark slop test（实现期加载 slop-test.md，按 58 门禁核对新增 WXSS/WXML）**

重点核对：无渐变文字、无纯黑/纯白（色卡画布白底除外——画布是图纸内容而非页面表面）、无 3 等分图标卡、无描边贴条卡、按钮文字单行不折行、无 `transition-all`、无悬浮毛玻璃、tab/胶囊选择不滚动跳位、触摸目标 ≥ 44px（chip 高约 74px、色盒 104rpx ≈ 52px、按钮 96rpx ≈ 48px，均达标）。

- [ ] **Step 6: 尝试用微信开发者工具 CLI 打开项目（如本机已安装）**

Run: `& "$env:LOCALAPPDATA\微信开发者工具\cli.bat" open --project "D:\Code\Weixin\Pindou"`（路径不存在则跳过并在交付说明中说明，请用户在开发者工具中打开并编译确认）

- [ ] **Step 7: 提交收尾**

```bash
git status --short
git add -A
git commit -m "chore: final verification for pindou pattern generator"
```

---

## Self-Review（已执行）

1. **Spec coverage**：设计文档 6.1/6.2/6.3（三页）、第 4 节色卡、第 5 节算法、第 7 节导出、第 8 节错误处理、第 9 节测试、第 10 节假设（contain、导出含色号、双指缩放、不持久化）→ 均有对应 Task。用户补充需求（每格色号、色号数量清单）→ Task 6/7 与 pattern.js `countColors`/`renderGrid(code:true)` 覆盖。
2. **Placeholder scan**：无 TBD/TODO；所有步骤含完整代码。
3. **Type consistency**：`mapRgbGrid(imageData, size, palette)`、`countColors(grid, setCodes)`、`renderGrid(ctx, grid, palette, opts)`、`drawCell(ctx, grid, r, c, palette, opts)`、常量 `CELL/GAP/EXPORT_CELL` 在 Task 3–7 中签名一致；`buildPalette(setKey)`、`nearestColor(r,g,b,palette)` 在 Task 2–7 中一致。
4. **风险与待运行时确认**：① movable-view 内 canvas 触摸坐标是否已含 scale（onTouchStart 用 `t.x / scale`，若真机坐标已归一化需去掉除数，以开发者工具实测为准）；② offscreen canvas 与 canvasToTempFilePath 在低端机的内存表现（已用 EXPORT_CELL=16 规避 2048px 上限）；③ 微信开发者工具编译与交互需用户在真机/模拟器最终确认。