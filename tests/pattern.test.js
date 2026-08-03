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

// 1) medianFilter：3×3 全 0 中间一个 255 → 滤波后中心变 0（椒盐噪点被去除）
const salt = new Uint8ClampedArray(9 * 4)
for (let i = 0; i < 9; i++) salt[i * 4 + 3] = 255
salt[4 * 4] = 255 // 中心 R=255
const filtered = pattern.medianFilter(salt, 3, 3)
assert.strictEqual(filtered[4 * 4], 0, '中值滤波应去除孤立亮点')

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