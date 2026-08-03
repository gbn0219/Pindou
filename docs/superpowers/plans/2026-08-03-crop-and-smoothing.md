# 图片裁剪 + 像素化平滑优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ① 新增"选图后先裁剪再生成"功能（任意比例裁剪框，最终图纸仍为 52/78/104 方形）；② 按已审批的方案 A 优化像素化流程（保边去噪 + 区域平均 + 孤立点平滑），并预留 AI 卡通化代码级入口（不加 UI、不做抖动）。

**Architecture:** 裁剪：新增独立页面 `page/crop/index`，主页 `chooseMedia` 后跳转，裁剪页用 movable-view 方框拖动 + 两个滑块（宽/高）调整任意比例，完成时用 canvas 按原图坐标裁切导出临时图，经 `globalData.cropResult` 回传主页预览；生成仍走 contain 缩放（宽高比保持、白底），方形网格不变。平滑：主页面 `buildGrid` 改为 4N×4N 中间画布 → 3×3 中值滤波（`medianFilter`）→ 4×4 块平均（`averageBlocks`）→ CIELAB 匹配（`mapRgb`）→ 孤立点平滑（`denoiseGrid`），全部为 utils/pattern.js 纯函数，node 可测。

**Tech Stack:** 微信小程序原生（JS/WXML/WXSS，无新依赖）、Canvas 2D、node 单测。

## 已确认的设计决策（执行时不得偏离）

1. 裁剪框：任意宽高比例；交互为"图片固定、拖动方框 + 滑块调宽/高（40%~100%）"；不加"重新选择"按钮（主页卡片本身可重选）。
2. 最终图纸始终 1:1 方形（52/78/104）；矩形裁剪区按 **contain（保持宽高比、白底补齐）** 映射到方形网格——与现有生成器行为一致，不拉伸变形。
3. 平滑：方案 A 三阶段（中值滤波→块平均→孤立点平滑），不做抖动。
4. AI 卡通化：仅在代码中留出明确调用位（注释 + 空 hook），不加 UI、不接 API。
5. 修改页/展示页渲染层不改。

---

## 文件结构

```
miniprogram/page/crop/index.{js,json,wxml,wxss}   新增：裁剪页
miniprogram/app.json                              注册裁剪页
miniprogram/page/index/index.js                   chooseImage 后跳裁剪页；onShow 接收裁剪结果；buildGrid 平滑管线
miniprogram/utils/pattern.js                      新增 medianFilter / averageBlocks / mapRgb / denoiseGrid
tests/pattern.test.js                             新增上述纯函数用例
AGENTS.md、docs/项目结构与开发说明.md               同步更新
```

---

### Task 1: 裁剪页（page/crop/index）

**Files:**
- Create: `miniprogram/page/crop/index.json`
- Create: `miniprogram/page/crop/index.wxml`
- Create: `miniprogram/page/crop/index.wxss`
- Create: `miniprogram/page/crop/index.js`

- [ ] **Step 1: 页面配置**

```json
{
  "navigationBarTitleText": "裁剪图片",
  "navigationBarBackgroundColor": "#12171b",
  "navigationBarTextStyle": "white"
}
```

- [ ] **Step 2: 页面结构**

```xml
<view class="page">
  <view class="stage" id="stage">
    <movable-area class="crop-area" id="cropArea" style="width: {{imgW}}px; height: {{imgH}}px;">
      <image class="crop-img" src="{{sourcePath}}" style="width: {{imgW}}px; height: {{imgH}}px;" mode="aspectFill" />
      <movable-view
        class="crop-frame"
        direction="all"
        x="{{frameX}}"
        y="{{frameY}}"
        style="width: {{frameW}}px; height: {{frameH}}px;"
        bindchange="onFrameChange"
      >
        <view class="frame-corner frame-corner--tl"></view>
        <view class="frame-corner frame-corner--tr"></view>
        <view class="frame-corner frame-corner--bl"></view>
        <view class="frame-corner frame-corner--br"></view>
      </movable-view>
    </movable-area>
  </view>

  <view class="controls">
    <view class="slider-row">
      <text class="slider-label">宽</text>
      <slider class="slider" min="40" max="100" value="{{wPct}}" bindchanging="onWChanging" bindchange="onWChange" />
    </view>
    <view class="slider-row">
      <text class="slider-label">高</text>
      <slider class="slider" min="40" max="100" value="{{hPct}}" bindchanging="onHChanging" bindchange="onHChange" />
    </view>
    <view class="actions">
      <button class="btn btn--soft" hover-class="btn--pressed" bindtap="cancel">取消</button>
      <button class="btn btn--primary" hover-class="btn--pressed" bindtap="confirm">完成</button>
    </view>
  </view>

  <canvas type="2d" id="cropCanvas" class="crop-canvas" style="width: 0px; height: 0px;" />
</view>
```

- [ ] **Step 3: 页面样式**

```css
@import "../../styles/tokens.wxss";

.page {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--color-ink);
  padding: var(--space-sm) var(--space-md) calc(var(--space-sm) + env(safe-area-inset-bottom));
  box-sizing: border-box;
}

.stage {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}
.crop-area {
  position: relative;
  background: var(--color-paper-3);
}
.crop-img {
  display: block;
}
.crop-frame {
  position: absolute;
  left: 0;
  top: 0;
  box-sizing: border-box;
  border: 2rpx solid var(--color-accent);
  background: rgba(247, 245, 236, 0.08);
}
.frame-corner {
  position: absolute;
  width: 24rpx;
  height: 24rpx;
  border: 4rpx solid var(--color-accent);
}
.frame-corner--tl { left: -6rpx; top: -6rpx; border-right: 0; border-bottom: 0; }
.frame-corner--tr { right: -6rpx; top: -6rpx; border-left: 0; border-bottom: 0; }
.frame-corner--bl { left: -6rpx; bottom: -6rpx; border-right: 0; border-top: 0; }
.frame-corner--br { right: -6rpx; bottom: -6rpx; border-left: 0; border-top: 0; }

.controls {
  padding-top: var(--space-sm);
}
.slider-row {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  margin-bottom: var(--space-2xs);
}
.slider-label {
  width: 48rpx;
  font-size: var(--text-sm);
  color: var(--color-paper);
}
.slider {
  flex: 1;
}
.actions {
  display: flex;
  gap: var(--space-sm);
  margin-top: var(--space-sm);
}
.actions .btn {
  flex: 1;
}

.crop-canvas {
  position: fixed;
  left: -9999px;
  top: 0;
}
```

- [ ] **Step 4: 页面逻辑**

```js
// miniprogram/page/crop/index.js
Page({
  data: {
    sourcePath: '',
    imgW: 0,
    imgH: 0,
    frameW: 0,
    frameH: 0,
    frameX: 0,
    frameY: 0,
    wPct: 100,
    hPct: 100
  },

  onLoad() {
    const src = getApp().globalData.cropSource
    if (!src || !src.path) {
      wx.showToast({ title: '没有待裁剪的图片', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 800)
      return
    }
    this.source = src
    // 布局：宽 = 屏宽 - 边距，高 = 屏高 - 导航 - 控制区，contain 适配
    const sys = wx.getSystemInfoSync()
    const stageW = sys.windowWidth - 32
    const stageH = sys.windowHeight - 64 - 220
    const scale = Math.min(stageW / src.width, stageH / src.height, 1)
    const imgW = Math.max(40, Math.round(src.width * scale))
    const imgH = Math.max(40, Math.round(src.height * scale))
    this.setData({
      sourcePath: src.path,
      imgW,
      imgH,
      frameW: imgW,
      frameH: imgH,
      frameX: 0,
      frameY: 0
    })
  },

  onWChanging(e) {
    this.setSize('w', e.detail.value)
  },
  onWChange(e) {
    this.setSize('w', e.detail.value)
  },
  onHChanging(e) {
    this.setSize('h', e.detail.value)
  },
  onHChange(e) {
    this.setSize('h', e.detail.value)
  },

  setSize(axis, pct) {
    const d = this.data
    const newW = Math.max(40, Math.round((d.imgW * pct) / 100))
    const newH = Math.max(40, Math.round((d.imgH * pct) / 100))
    // 以中心为基准缩放
    const cx = d.frameX + d.frameW / 2
    const cy = d.frameY + d.frameH / 2
    const w = axis === 'w' ? newW : d.frameW
    const h = axis === 'h' ? newH : d.frameH
    const x = Math.max(0, Math.min(d.imgW - w, Math.round(cx - w / 2)))
    const y = Math.max(0, Math.min(d.imgH - h, Math.round(cy - h / 2)))
    this.setData({
      frameW: w,
      frameH: h,
      frameX: x,
      frameY: y,
      wPct: axis === 'w' ? pct : d.wPct,
      hPct: axis === 'h' ? pct : d.hPct
    })
  },

  onFrameChange(e) {
    // movable-view 拖动后同步位置
    const d = e.detail
    if (d && typeof d.x === 'number' && typeof d.y === 'number') {
      this.setData({ frameX: d.x, frameY: d.y })
    }
  },

  cancel() {
    wx.navigateBack()
  },

  confirm() {
    const d = this.data
    const src = this.source
    if (d.frameW < 10 || d.frameH < 10) {
      wx.showToast({ title: '裁剪区域太小', icon: 'none' })
      return
    }
    wx.showLoading({ title: '裁剪中…', mask: true })
    // 换算到原图坐标
    const sx = src.width / d.imgW
    const sy = src.height / d.imgH
    const cropX = d.frameX * sx
    const cropY = d.frameY * sy
    const cropW = d.frameW * sx
    const cropH = d.frameH * sy
    // 输出尺寸上限 2048，避免低端机内存问题
    const outScale = Math.min(1, 2048 / Math.max(cropW, cropH))
    const outW = Math.round(cropW * outScale)
    const outH = Math.round(cropH * outScale)
    this.createSelectorQuery()
      .select('#cropCanvas')
      .fields({ node: true, size: true })
      .exec((res) => {
        try {
          if (!res || !res[0] || !res[0].node) {
            wx.hideLoading()
            wx.showToast({ title: '裁剪失败', icon: 'none' })
            return
          }
          const canvas = res[0].node
          canvas.width = outW
          canvas.height = outH
          const ctx = canvas.getContext('2d')
          const img = canvas.createImage()
          img.onload = () => {
            try {
              ctx.fillStyle = '#ffffff'
              ctx.fillRect(0, 0, outW, outH)
              ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, outW, outH)
              wx.canvasToTempFilePath({
                canvas,
                success: (r) => {
                  getApp().globalData.cropResult = { path: r.tempFilePath }
                  wx.hideLoading()
                  wx.navigateBack()
                },
                fail: () => {
                  wx.hideLoading()
                  wx.showToast({ title: '裁剪失败', icon: 'none' })
                }
              })
            } catch (e) {
              wx.hideLoading()
              wx.showToast({ title: '裁剪失败', icon: 'none' })
              console.error(e)
            }
          }
          img.onerror = () => {
            wx.hideLoading()
            wx.showToast({ title: '图片加载失败', icon: 'none' })
          }
          img.src = src.path
        } catch (e) {
          wx.hideLoading()
          wx.showToast({ title: '裁剪失败', icon: 'none' })
          console.error(e)
        }
      })
  }
})
```

- [ ] **Step 5: 校验**

Run: `node --check miniprogram/page/crop/index.js`
Expected: 无输出，exit 0

- [ ] **Step 6: 提交**

```bash
git add miniprogram/page/crop/index.json miniprogram/page/crop/index.wxml miniprogram/page/crop/index.wxss miniprogram/page/crop/index.js
git commit -m "feat: add image crop page with free-aspect frame"
```

---

### Task 2: 主页接入裁剪 + 注册页面

**Files:**
- Modify: `miniprogram/app.json`（pages 加 `page/crop/index`）
- Modify: `miniprogram/page/index/index.js`（chooseImage 跳裁剪页、onShow 接收结果）

- [ ] **Step 1: app.json 注册**

pages 数组改为：
```json
"pages": [
  "page/index/index",
  "page/crop/index",
  "page/pattern/index",
  "page/pattern-edit/index"
]
```

- [ ] **Step 2: chooseImage 改为"选图 → 获取尺寸 → 跳裁剪页"**

```js
chooseImage() {
  wx.chooseMedia({
    count: 1,
    mediaType: ['image'],
    sourceType: ['album', 'camera'],
    success: (res) => {
      const file = res.tempFiles && res.tempFiles[0]
      if (!file) return
      wx.getImageInfo({
        src: file.tempFilePath,
        success: (info) => {
          getApp().globalData.cropSource = {
            path: file.tempFilePath,
            width: info.width,
            height: info.height
          }
          wx.navigateTo({ url: '/page/crop/index' })
        },
        fail: () => {
          // 个别环境拿不到尺寸时跳过裁剪，直接使用原图
          this.setData({ imagePath: file.tempFilePath })
        }
      })
    }
  })
}
```

- [ ] **Step 3: onShow 接收裁剪结果**

```js
onShow() {
  const result = getApp().globalData.cropResult
  if (result && result.path) {
    this.setData({ imagePath: result.path })
    delete getApp().globalData.cropResult
  }
}
```

- [ ] **Step 4: 校验**

Run: `node --check miniprogram/page/index/index.js && node -e "JSON.parse(require('fs').readFileSync('miniprogram/app.json','utf8')); console.log('json ok')"`
Expected: `json ok`

- [ ] **Step 5: 提交**

```bash
git add miniprogram/app.json miniprogram/page/index/index.js
git commit -m "feat: route image import through crop page"
```

---

### Task 3: 平滑纯函数 + 测试（TDD）

**Files:**
- Modify: `tests/pattern.test.js`（先加失败用例）
- Modify: `miniprogram/utils/pattern.js`（新增 4 个纯函数）

- [ ] **Step 1: 加测试（先失败）**

在 `tests/pattern.test.js` 末尾追加：

```js
// ---- 平滑优化 ----

// 1) medianFilter：3×3 全 0 中间一个 255 → 滤波后中心变 0（椒盐噪点被去除）
const salt = new Uint8ClampedArray(9 * 4)
for (let i = 0; i < 9; i++) salt[i * 4 + 3] = 255
salt[4 * 4] = 255 // 中心 R=255
const filtered = pattern.medianFilter(salt, 3, 3)
assert.strictEqual(filtered[4 * 4], 0, '中值滤波应去除孤立亮点')

// 2) averageBlocks：4×4（block=2）左上块全红、其余全蓝 → 结果 2×2
const blocks = new Uint8ClampedArray(4 * 4 * 4)
for (let i = 0; i < 4 * 4; i++) {
  const r = Math.floor(i / 4)
  const c = i % 4
  blocks[i * 4 + 3] = 255
  if (r < 2 && c < 2) { blocks[i * 4] = 255; blocks[i * 4 + 1] = 0; blocks[i * 4 + 2] = 0 }
  else { blocks[i * 4] = 0; blocks[i * 4 + 1] = 0; blocks[i * 4 + 2] = 255 }
}
const avg = pattern.averageBlocks(blocks, 4, 2)
assert.deepStrictEqual(avg[0], [255, 0, 0], '左上块应为纯红')
assert.deepStrictEqual(avg[3], [0, 0, 255], '右下块应为纯蓝')

// 3) mapRgb：RGB 数组 → 色号网格
const rgbArr = [[247, 236, 92], [255, 255, 255]]
const g3 = pattern.mapRgb(rgbArr, 1, palette)
assert.strictEqual(g3[0][0], 'A4', '精确 RGB 应映射为 A4')

// 4) denoiseGrid：孤立噪点被修正，1 格宽竖线保留
const noisy = [
  ['A1', 'A1', 'A1', 'A1'],
  ['A1', 'A4', 'A1', 'A1'],
  ['A1', 'A1', 'A1', 'A1'],
  ['A1', 'A1', 'A1', 'A1']
]
pattern.denoiseGrid(noisy, palette)
assert.strictEqual(noisy[1][1], 'A1', '孤立噪点应被修正为邻色')

const line = [
  ['A1', 'A4', 'A1'],
  ['A1', 'A4', 'A1'],
  ['A1', 'A4', 'A1']
]
pattern.denoiseGrid(line, palette)
assert.strictEqual(line[1][1], 'A4', '1 格宽竖线应保持不变')
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node tests/pattern.test.js`
Expected: FAIL（`pattern.medianFilter is not a function`）

- [ ] **Step 3: 实现纯函数（追加到 utils/pattern.js）**

```js
function medianFilter(data, w, h) {
  const out = new Uint8ClampedArray(data.length)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      for (let ch = 0; ch < 3; ch++) {
        const vals = []
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx
            const ny = y + dy
            if (nx >= 0 && nx < w && ny >= 0 && ny < h) vals.push(data[(ny * w + nx) * 4 + ch])
          }
        }
        vals.sort((a, b) => a - b)
        out[i + ch] = vals[Math.floor(vals.length / 2)]
      }
      out[i + 3] = data[i + 3]
    }
  }
  return out
}

function averageBlocks(data4, size4, block) {
  const size = size4 / block
  const rgb = []
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      let sr = 0
      let sg = 0
      let sb = 0
      for (let dy = 0; dy < block; dy++) {
        for (let dx = 0; dx < block; dx++) {
          const i = ((r * block + dy) * size4 + (c * block + dx)) * 4
          if (data4[i + 3] < 128) {
            sr += 255
            sg += 255
            sb += 255
          } else {
            sr += data4[i]
            sg += data4[i + 1]
            sb += data4[i + 2]
          }
        }
      }
      const n = block * block
      rgb.push([Math.round(sr / n), Math.round(sg / n), Math.round(sb / n)])
    }
  }
  return rgb
}

function mapRgb(rgbArr, size, palette) {
  const grid = []
  for (let r = 0; r < size; r++) {
    const row = []
    for (let c = 0; c < size; c++) {
      const rgb = rgbArr[r * size + c]
      row.push(color.nearestColor(rgb[0], rgb[1], rgb[2], palette).code)
    }
    grid.push(row)
  }
  return grid
}

function denoiseGrid(grid) {
  const size = grid.length
  const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]]
  for (let round = 0; round < 2; round++) {
    let changed = false
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const code = grid[r][c]
        const nbrs = []
        for (const d of dirs) {
          const nr = r + d[0]
          const nc = c + d[1]
          if (nr >= 0 && nr < size && nc >= 0 && nc < size) nbrs.push(grid[nr][nc])
        }
        if (nbrs.length < 3) continue
        if (nbrs.every((n) => n !== code)) {
          const count = {}
          for (const n of nbrs) count[n] = (count[n] || 0) + 1
          let best = null
          let bestCount = 0
          for (const k of Object.keys(count)) {
            if (count[k] > bestCount) {
              bestCount = count[k]
              best = k
            }
          }
          if (bestCount >= Math.ceil(nbrs.length * 0.75)) {
            grid[r][c] = best
            changed = true
          }
        }
      }
    }
    if (!changed) break
  }
  return grid
}
```

并把这些函数加入 `module.exports`。

- [ ] **Step 4: 运行测试确认通过**

Run: `node tests/pattern.test.js && node tests/color.test.js`
Expected: 两行通过，exit 0

- [ ] **Step 5: 提交**

```bash
git add miniprogram/utils/pattern.js tests/pattern.test.js
git commit -m "feat: add median filter, block averaging, rgb mapping and grid denoise"
```

---

### Task 4: buildGrid 平滑管线 + AI 预留位

**Files:**
- Modify: `miniprogram/page/index/index.js`（buildGrid 用 4N 中间画布 + 新管线；generate 里留 AI hook 注释）

- [ ] **Step 1: buildGrid 改为平滑管线**

在现有 `buildGrid`（含 15s 超时与 settled 守卫）基础上，把画布尺寸从 `size` 改为 `size * 4`，并在 `getImageData` 之后追加：

```js
const filtered = pattern.medianFilter(imageData.data, size4, size4)
const rgbArr = pattern.averageBlocks(filtered, size4, 4)
let grid = pattern.mapRgb(rgbArr, size, color.buildPalette(setKey))
grid = pattern.denoiseGrid(grid)
done(resolve, grid)
```

（即：不再直接 `resolve(pattern.mapRgbGrid(imageData, size, ...))`。）

- [ ] **Step 2: generate() 内留 AI 卡通化调用位**

在 `buildGrid` 调用之前加：

```js
// —— AI 卡通化预留位 ——
// 若后续接入 AI 卡通化：在此调用 cartoonize(imagePath) 得到卡通化后的新路径再 buildGrid；
// 实现建议：云函数调用第三方模型（需 API Key/成本），本段不做 UI 入口、不接 API。
```

- [ ] **Step 3: 校验**

Run: `node --check miniprogram/page/index/index.js`
Expected: 无输出，exit 0

- [ ] **Step 4: 提交**

```bash
git add miniprogram/page/index/index.js
git commit -m "feat: apply smoothing pipeline in pattern generation with AI hook"
```

---

### Task 5: 文档同步（AGENTS.md + 开发说明）

**Files:**
- Modify: `AGENTS.md`（页面列表加裁剪页；像素化流程描述改为平滑管线；说明 AI 卡通化预留位）
- Modify: `docs/项目结构与开发说明.md`（同上）

- [ ] **Step 1: 更新 AGENTS.md**
页面列表增加 `page/crop/index`（裁剪页）；"数据与算法约定"改为：选图 → 裁剪 → 4N 中间画布 contain → 3×3 中值滤波 → 4×4 块平均 → CIELAB 匹配 → 孤立点平滑 → 网格；注明 AI 卡通化仅预留调用位。
- [ ] **Step 2: 更新 docs/项目结构与开发说明.md**
同步页面表、流程、文件职责（crop 页、平滑函数）。
- [ ] **Step 3: 提交**

```bash
git add AGENTS.md docs/项目结构与开发说明.md
git commit -m "docs: sync crop page and smoothing pipeline"
```

---

### Task 6: 全量验证

- [ ] **Step 1: 单测**：`node tests/color.test.js && node tests/pattern.test.js`，全绿
- [ ] **Step 2: 语法**：对新增/修改的 JS 全部 `node --check`
- [ ] **Step 3: JSON**：`app.json` 与各页面 json 可解析
- [ ] **Step 4: 开发者工具编译**：触发重编译，截图 + claude-vision-skill 识图确认：裁剪页拖动/缩放方框可用；生成结果平滑度提升、图纸仍 1:1
- [ ] **Step 5: 提交收尾**（如有额外改动）