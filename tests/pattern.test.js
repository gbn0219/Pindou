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


// ---- renderGrid 每 N 格粗网格线 ----
function fakeCtx() {
  const calls = []
  return {
    calls,
    fillStyle: '', strokeStyle: '', lineWidth: 0, font: '', textAlign: '', textBaseline: '',
    fillRect() { calls.push(['fillRect', ...arguments]) },
    strokeRect() { calls.push(['strokeRect', ...arguments]) },
    fillText() { calls.push(['fillText', ...arguments]) },
    beginPath() {},
    moveTo() { calls.push(['moveTo', ...arguments]) },
    lineTo() { calls.push(['lineTo', ...arguments]) },
    stroke() { calls.push(['stroke']) }
  }
}

const grid10 = []
for (let i = 0; i < 10; i++) grid10.push(new Array(10).fill('A1'))
{
  const ctx = fakeCtx()
  pattern.renderGrid(ctx, grid10, palette, { cellSize: 16, gap: 1, code: false, gridEvery: 5 })
  const lineTos = ctx.calls.filter((c) => c[0] === 'lineTo')
  assert.strictEqual(lineTos.length, 2, '每 5 格应在 10 格网格中画 1 横 1 纵两条粗线')
  assert.ok(ctx.calls.some((c) => c[0] === 'stroke'), '粗网格线应执行 stroke')
}
{
  const ctx = fakeCtx()
  pattern.renderGrid(ctx, grid10, palette, { cellSize: 16, gap: 1, code: false })
  assert.strictEqual(ctx.calls.filter((c) => c[0] === 'lineTo').length, 0, '不传 gridEvery 时不画粗线')
}

// ---- renderExport / renderLegend / layoutExport ----
const one = [['A1']]
const legendItems = [
  { code: 'A1', count: 1, hex: '#ffd500' },
  { code: 'A4', count: 2, hex: '#e60012' }
]
const layout = pattern.layoutExport(one, { cellSize: 16, gap: 1, legendItems })
assert.strictEqual(layout.width, 16, '导出宽度应等于图纸宽度')
assert.ok(layout.height > 16, '含色号清单时高度应大于图纸高度')
assert.strictEqual(pattern.layoutExport(one, { cellSize: 16, gap: 1 }).height, 16, '无色号清单时高度应等于图纸高度')

{
  const ctx = fakeCtx()
  const out = pattern.renderExport(ctx, one, palette, { cellSize: 16, gap: 1, code: true, legendItems })
  assert.deepStrictEqual(out, layout, 'renderExport 应返回与 layoutExport 一致的尺寸')
  const texts = ctx.calls.filter((c) => c[0] === 'fillText').map((c) => c[1])
  assert.ok(texts.indexOf('[1x1/2色/共3颗]') >= 0, '应绘制统计行')
  assert.ok(texts.indexOf('A1') >= 0 && texts.indexOf('A4') >= 0, '应绘制每个色号')
  assert.ok(texts.indexOf('1') >= 0 && texts.indexOf('2') >= 0, '应绘制每个数量')
}

// 清单自动换行：更宽图纸能放下更多列，清单区高度应更矮
{
  const gridWide = []
  for (let i = 0; i < 50; i++) gridWide.push(new Array(50).fill('A1'))
  const many = []
  for (let i = 0; i < 20; i++) many.push({ code: 'A1', count: 1, hex: '#ffffff' })
  const legendNarrow = pattern.layoutExport(one, { cellSize: 16, gap: 1, legendItems: many }).height - 16
  const legendWide = pattern.layoutExport(gridWide, { cellSize: 16, gap: 1, legendItems: many }).height - pattern.layoutExport(gridWide, { cellSize: 16, gap: 1 }).height
  assert.ok(legendWide < legendNarrow, '宽度更大时清单行数应更少')
}

assert.ok(pattern.EXPORT_MAX_DIM > 0, '应暴露导出最大边长常量')

console.log('pattern.test.js 全部通过 ✓')