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

// ---- averageBlocks（照片还原采样） ----

function fakeBlock(px) {
  const data = []
  for (const p of px) data.push(p[0], p[1], p[2], p[3])
  return new Uint8ClampedArray(data)
}

// 均匀块 → 取该色
{
  const blockPx = []
  for (let i = 0; i < 16; i++) blockPx.push([0, 0, 255, 255])
  assert.deepStrictEqual(pattern.averageBlocks(fakeBlock(blockPx), 4, 1, 4)[0], [0, 0, 255], '均匀块应取该色')
}

// 混合块 → 取算术平均（四舍五入）
{
  const blockPx = []
  for (let i = 0; i < 8; i++) blockPx.push([255, 255, 255, 255])
  for (let i = 0; i < 8; i++) blockPx.push([0, 0, 0, 255])
  assert.deepStrictEqual(pattern.averageBlocks(fakeBlock(blockPx), 4, 1, 4)[0], [128, 128, 128], '混合块应取平均色')
}

// 透明像素不计入平均
{
  const blockPx = []
  for (let i = 0; i < 12; i++) blockPx.push([255, 255, 255, 255])
  for (let i = 0; i < 4; i++) blockPx.push([0, 0, 0, 0])
  assert.deepStrictEqual(pattern.averageBlocks(fakeBlock(blockPx), 4, 1, 4)[0], [255, 255, 255], '透明像素不应拉低平均色')
}

// 全透明块 → 白色
{
  const blockPx = []
  for (let i = 0; i < 16; i++) blockPx.push([0, 0, 0, 0])
  assert.deepStrictEqual(pattern.averageBlocks(fakeBlock(blockPx), 4, 1, 4)[0], [255, 255, 255], '全透明块应按白色处理')
}

// 2×2 网格：8×8 数据按 4×4 块平均
{
  const px = []
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const val = r < 4 && c < 4 ? 0 : 255
      px.push([val, val, val, 255])
    }
  }
  const out = pattern.averageBlocks(fakeBlock(px), 8, 2, 4)
  assert.deepStrictEqual(out[0], [0, 0, 0], '左上块应为黑')
  assert.deepStrictEqual(out[1], [255, 255, 255], '右上块应为白')
  assert.deepStrictEqual(out[2], [255, 255, 255], '左下块应为白')
  assert.deepStrictEqual(out[3], [255, 255, 255], '右下块应为白')
}

// ---- mapRgb ----
const g3 = pattern.mapRgb([[247, 236, 92]], 1, palette)
assert.strictEqual(g3[0][0], 'A4', 'mapRgb 应命中 A4')

console.log('pattern.test.js 全部通过 ✓')