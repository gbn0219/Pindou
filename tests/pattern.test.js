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

// ---- 平滑优化 ----


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

// ---- 平滑优化 v4 ----

function fakeBlock(px) {
  const data = []
  for (const p of px) data.push(p[0], p[1], p[2], p[3])
  return new Uint8ClampedArray(data)
}
const db = pattern.dominantBlocks

// dominantBlocks：均匀块取该颜色；全透明块按白色处理
let blockPx = []
for (let i = 0; i < 16; i++) blockPx.push([0, 0, 255, 255])
assert.deepStrictEqual(db(fakeBlock(blockPx), 4, 1, 4, palette)[0], [0, 0, 255], '均匀块应取该颜色')
blockPx = []
for (let i = 0; i < 16; i++) blockPx.push([0, 0, 0, 0])
assert.deepStrictEqual(db(fakeBlock(blockPx), 4, 1, 4, palette)[0], [255, 255, 255], '全透明块应按白色处理')

// dominantBlocks：75% 白 + 25% 深色（少数簇不足 40%）→ 取块平均色，不偏离原图
blockPx = []
for (let i = 0; i < 12; i++) blockPx.push([255, 255, 255, 255])
for (let i = 0; i < 4; i++) blockPx.push([40, 40, 40, 255])
const avgMixed = db(fakeBlock(blockPx), 4, 1, 4, palette)[0]
assert.strictEqual(avgMixed[0] > 180, true, '少数簇不足时应取块平均色')
assert.strictEqual(avgMixed[1] > 180, true, '少数簇不足时应取块平均色')

// dominantBlocks：50% 白 + 50% 深色（高对比度且少数簇 >= 40%）→ 保留深色细节（眼镜框场景）
blockPx = []
for (let i = 0; i < 8; i++) blockPx.push([255, 255, 255, 255])
for (let i = 0; i < 8; i++) blockPx.push([40, 40, 40, 255])
assert.deepStrictEqual(db(fakeBlock(blockPx), 4, 1, 4, palette)[0], [40, 40, 40], '高对比少数簇应保留细线细节')

// dominantBlocks：多数白 + 少数相近浅灰（低对比度）→ 取多数簇，不产生杂色
blockPx = []
for (let i = 0; i < 10; i++) blockPx.push([255, 255, 255, 255])
for (let i = 0; i < 6; i++) blockPx.push([225, 225, 225, 255])
const lowContrast = db(fakeBlock(blockPx), 4, 1, 4)[0]
assert.strictEqual(lowContrast[0] > 230, true, '低对比块应取多数簇（接近白）')

// mapRgb：RGB 数组 → 色号网格
const g3 = pattern.mapRgb([[247, 236, 92]], 1, palette)
assert.strictEqual(g3[0][0], 'A4', 'mapRgb 应命中 A4')

// mergeGrid：相近色（色距 <= 12）合并为区域内多数色；明显不同的边界保留
let nearA = null
let nearB = null
let farA = null
let farB = null
outer:
for (let i = 0; i < palette.length; i++) {
  for (let j = i + 1; j < palette.length; j++) {
    const a = palette[i].rgb
    const b = palette[j].rgb
    const d = Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2)
    if (!nearA && d <= 12) { nearA = palette[i].code; nearB = palette[j].code }
    if (!farA && d > 120) { farA = palette[i].code; farB = palette[j].code }
    if (nearA && farA) break outer
  }
}
const nearGrid = [
  [nearA, nearA, nearA],
  [nearA, nearB, nearA],
  [nearA, nearA, nearA]
]
pattern.mergeGrid(nearGrid, palette, 12)
assert.strictEqual(nearGrid[1][1], nearA, '相近色应合并为区域多数色')
const farGrid = [
  [farA, farB],
  [farB, farA]
]
pattern.mergeGrid(farGrid, palette, 12)
assert.strictEqual(farGrid[0][1], farB, '明显不同的边界颜色不应被合并')
assert.strictEqual(farGrid[1][0], farB, '明显不同的边界颜色不应被合并')

console.log('pattern.test.js 平滑优化 v4 用例通过 ✓')
