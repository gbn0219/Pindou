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

// ---- countColor / replaceColor（批量换色） ----
assert.strictEqual(pattern.countColor(g2, 'A1'), 3, 'countColor 应统计指定色号数量')
assert.strictEqual(pattern.countColor(g2, 'A4'), 3, 'countColor 应统计指定色号数量')
assert.strictEqual(pattern.countColor(g2, 'A9'), 0, '不存在的色号应为 0')
{
  const g4 = [
    ['A1', 'A4', 'A1'],
    ['A4', 'A1', 'A4']
  ]
  const n = pattern.replaceColor(g4, 'A1', 'A4')
  assert.strictEqual(n, 3, 'replaceColor 应返回被替换的格子数')
  assert.deepStrictEqual(
    g4,
    [
      ['A4', 'A4', 'A4'],
      ['A4', 'A4', 'A4']
    ],
    '所有源色格子应替换为目标色'
  )
}
{
  const g5 = [['A1', 'A1']]
  assert.strictEqual(pattern.replaceColor(g5, 'A1', 'A1'), 0, '源色与目标色相同时不应替换')
  assert.deepStrictEqual(g5, [['A1', 'A1']], '源色与目标色相同时网格不变')
}

// ---- findBackgroundMask（白色背景连通域） ----
// 与画布四边连通的白色才是背景；被主体包围的白色（画面中的白色元素）不是背景
{
  const g = [
    ['A1', 'W', 'W', 'A1'],
    ['W', 'A4', 'W', 'W'],
    ['W', 'W', 'A4', 'W'],
    ['A1', 'W', 'W', 'A1']
  ]
  const mask = pattern.findBackgroundMask(g, 'W')
  assert.deepStrictEqual(
    mask,
    [
      [false, true, true, false],
      [true, false, true, true],
      [true, true, false, true],
      [false, true, true, false]
    ],
    '连通到边界的白色才是背景，内部白色不是背景'
  )
}
{
  const g = [['W', 'W'], ['W', 'W']]
  assert.deepStrictEqual(
    pattern.findBackgroundMask(g, 'W'),
    [[true, true], [true, true]],
    '全白网格应全部视为背景'
  )
}
{
  const g = [['A4', 'A4'], ['A4', 'A4']]
  assert.deepStrictEqual(
    pattern.findBackgroundMask(g, 'W'),
    [[false, false], [false, false]],
    '无白色时不应有背景'
  )
}

// 白色系色号：纯白/近白都算背景候选，肤色/浅色图案色不算
{
  const pal = color.buildPalette('221')
  const whiteish = pattern.findWhiteishCodes(pal)
  assert.ok(whiteish.indexOf('H1') >= 0 && whiteish.indexOf('H2') >= 0, '纯白与近白应属于白色系')
  assert.ok(whiteish.indexOf('G1') < 0, '肤色不应属于白色系')
  assert.ok(whiteish.indexOf('D16') < 0, '浅灰蓝不应属于白色系')
}

// 白色系集合连通域：紧贴边缘的近白也算背景；被主体完全包围的内部白色仍算画面元素
{
  const g = [
    ['C', 'C', 'C', 'C', 'C'],
    ['C', 'A4', 'A4', 'A4', 'C'],
    ['C', 'A4', 'W', 'A4', 'C'],
    ['C', 'A4', 'A4', 'A4', 'C'],
    ['C', 'C', 'C', 'C', 'C']
  ]
  const mask = pattern.findBackgroundMask(g, ['W', 'C'])
  assert.deepStrictEqual(mask[0][0], true, '紧贴边缘的近白应算背景')
  assert.deepStrictEqual(mask[2][2], false, '被主体完全包围的内部白色不是背景')
  const counts = pattern.countColors(g, ['A4', 'W', 'C'], mask)
  const byCode = {}
  counts.forEach((i) => {
    byCode[i.code] = i.count
  })
  assert.strictEqual(byCode['A4'], 8, '主体色计入')
  assert.strictEqual(byCode['W'], 1, '内部白色应计入')
  assert.strictEqual(byCode['C'], undefined, '边缘近白全部为背景，不计入')
}

// ---- countColors 排除背景 ----
{
  const g = [
    ['A1', 'W', 'W'],
    ['W', 'A4', 'W'],
    ['W', 'W', 'A1']
  ]
  const mask = pattern.findBackgroundMask(g, 'W')
  const counts = pattern.countColors(g, ['A1', 'A4', 'W'], mask)
  assert.deepStrictEqual(
    counts,
    [
      { code: 'A1', count: 2 },
      { code: 'A4', count: 1 }
    ],
    '背景白色不计入色块数，画面内部白色（如有）应计入'
  )
}
{
  // 画面内部的白色元素（被主体包围，不连通边缘）应计入
  const g = [
    ['A4', 'A4', 'A4', 'A4'],
    ['A4', 'W', 'W', 'A4'],
    ['A4', 'W', 'A4', 'A4'],
    ['A4', 'A4', 'A4', 'A4']
  ]
  const mask = pattern.findBackgroundMask(g, 'W')
  assert.deepStrictEqual(mask[1][1], false, '内部白色不是背景')
  const counts = pattern.countColors(g, ['A4', 'W'], mask)
  assert.deepStrictEqual(counts, [{ code: 'A4', count: 13 }, { code: 'W', count: 3 }], '内部白色应计入色块数')
}

// ---- applyEditedMask（用户编辑过的格子一律视为前景，即使涂回白色） ----
{
  const base = [
    [true, true, true],
    [true, true, true],
    [true, true, true]
  ]
  const edited = [
    [false, false, false],
    [false, true, false],
    [false, false, false]
  ]
  const mask = pattern.applyEditedMask(base, edited)
  assert.deepStrictEqual(mask[1][1], false, '用户涂过色的背景格应变为前景（可显示色号）')
  assert.deepStrictEqual(mask[0][0], true, '未编辑的背景格仍是背景')
}
{
  const base = [[true, false], [false, true]]
  assert.deepStrictEqual(pattern.applyEditedMask(base, null), base, '无编辑掩码时返回原背景判定')
}

// ---- 用户修改：往任意位置（含背景）填充白色，写入图纸并显示色号 ----
{
  const pal = color.buildPalette('48')
  const whiteCodes = pattern.findWhiteishCodes(pal)
  // 背景为近白 H2（连通到四边），主体为 A4；用户把背景格 (1,1) 涂成纯白 H1
  const g = [
    ['H2', 'H2', 'H2', 'H2', 'H2'],
    ['H2', 'H2', 'A4', 'A4', 'H2'],
    ['H2', 'A4', 'A4', 'A4', 'H2'],
    ['H2', 'A4', 'A4', 'A4', 'H2'],
    ['H2', 'H2', 'H2', 'H2', 'H2']
  ]
  const base = pattern.findBackgroundMask(g, whiteCodes)
  assert.strictEqual(base[1][1], true, '(1,1) 背景格应被判定为背景')
  const edited = g.map((row) => row.map(() => false))
  edited[1][1] = true // 用户涂白该背景格
  g[1][1] = 'H1' // 白色写入网格
  const mask = pattern.applyEditedMask(base, edited)
  assert.strictEqual(mask[1][1], false, '涂白的背景格应变为前景（显示色号）')
  assert.strictEqual(g[1][1], 'H1', '纯白已写入网格')
  const counts = pattern.countColors(g, ['H1', 'H2', 'A4'], mask)
  const by = {}
  counts.forEach((i) => { by[i.code] = i.count })
  assert.strictEqual(by['H1'], 1, '涂白的纯白格计入色块数')
  assert.strictEqual(by['H2'], undefined, '未涂的背景近白不计入色块数')
  assert.strictEqual(by['A4'], 8, '主体色正常计入')
}
{
  const pal = color.buildPalette('48')
  const whiteCodes = pattern.findWhiteishCodes(pal)
  // 全白网格：整片被判定为背景；用户在任意位置（含角落与中心）涂白
  const g = [
    ['H1', 'H1', 'H1', 'H1', 'H1'],
    ['H1', 'H1', 'H1', 'H1', 'H1'],
    ['H1', 'H1', 'H1', 'H1', 'H1'],
    ['H1', 'H1', 'H1', 'H1', 'H1'],
    ['H1', 'H1', 'H1', 'H1', 'H1']
  ]
  const base = pattern.findBackgroundMask(g, whiteCodes)
  assert.strictEqual(base[2][2], true, '全白网格整片是背景')
  const edited = g.map((row) => row.map(() => false))
  const painted = [[0, 0], [2, 2], [4, 4]]
  for (const pos of painted) edited[pos[0]][pos[1]] = true
  const mask = pattern.applyEditedMask(base, edited)
  for (const pos of painted) {
    assert.strictEqual(mask[pos[0]][pos[1]], false, '涂白的 (' + pos[0] + ',' + pos[1] + ') 应变为前景')
    assert.strictEqual(g[pos[0]][pos[1]], 'H1', '涂白已写入网格 (' + pos[0] + ',' + pos[1] + ')')
  }
  assert.strictEqual(mask[1][1], true, '未涂的背景格仍是背景')
  const counts = pattern.countColors(g, ['H1'], mask)
  assert.strictEqual(counts[0].count, 3, '涂白的 3 格计入色块数（包括背景处的白色）')
}
{
  // 前景白色（主体内白色衣服）保持前景并计入
  const pal = color.buildPalette('48')
  const whiteCodes = pattern.findWhiteishCodes(pal)
  const g = [
    ['A4', 'A4', 'A4'],
    ['A4', 'H1', 'A4'],
    ['A4', 'A4', 'A4']
  ]
  const base = pattern.findBackgroundMask(g, whiteCodes)
  assert.strictEqual(base[1][1], false, '被主体包围的白色不是背景')
  const edited = g.map((row) => row.map(() => false))
  edited[1][1] = true
  const mask = pattern.applyEditedMask(base, edited)
  assert.strictEqual(mask[1][1], false, '前景白色格保持前景')
  const counts = pattern.countColors(g, ['A4', 'H1'], mask)
  const h1 = counts.find((i) => i.code === 'H1')
  assert.strictEqual(h1.count, 1, '白色主体格计入色块数')
}
// renderGrid：白色背景格不显示编号
{
  const ctx = fakeCtx()
  const g = [
    ['A1', 'W'],
    ['W', 'A4']
  ]
  const mask = pattern.findBackgroundMask(g, 'W')
  pattern.renderGrid(ctx, g, palette, { cellSize: 16, gap: 1, code: true, noCodeMask: mask })
  const texts = ctx.calls.filter((c) => c[0] === 'fillText').map((c) => c[1])
  assert.ok(texts.indexOf('A1') >= 0 && texts.indexOf('A4') >= 0, '非背景格应显示编号')
  assert.ok(texts.indexOf('W') < 0, '白色背景格不应显示编号')
}

// ---- displayCell（大盘面自适应格边长，画布不超设备上限） ----
{
  // 15~208 全部尺寸的画布总边长都不超过 2048（与导出一致的安全上限）
  for (let size = 15; size <= 208; size++) {
    const cell = pattern.displayCell(size)
    const total = size * (cell + pattern.GAP) - pattern.GAP
    assert.ok(total <= 2048, '尺寸 ' + size + ' 的画布边长 ' + total + ' 不应超过 2048')
    assert.ok(cell >= 2, '尺寸 ' + size + ' 的格边长不应小于 2')
  }
}
{
  assert.strictEqual(pattern.displayCell(52), 20, '52 盘应保持 20px 格')
  assert.strictEqual(pattern.displayCell(78), 20, '78 盘应保持 20px 格')
  const total208 = 208 * (pattern.displayCell(208) + pattern.GAP) - pattern.GAP
  assert.ok(total208 <= 2048, '208 盘画布边长应不超过 2048（实际 ' + total208 + '）')
}

// 展示/修改页布局：任意 15~208 盘面都能在区域内完整显示（初始缩放 ≥0.05 且 total×scale ≤ 区域）
{
  const areaW = 350
  const areaH = 310
  for (const size of [15, 52, 78, 104, 150, 180, 208]) {
    const cell = pattern.displayCell(size)
    const total = size * (cell + pattern.GAP) - pattern.GAP
    const initScale = Math.max(0.05, Math.min(1, Math.min(areaW, areaH) / total))
    assert.ok(initScale >= 0.05, '尺寸 ' + size + ' 初始缩放不应低于下限')
    assert.ok(total * initScale <= Math.min(areaW, areaH) + 1, '尺寸 ' + size + ' 应能完整放进区域')
  }
}

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
    shadowColor: '', shadowBlur: 0, shadowOffsetY: 0,
    fillRect() { calls.push(['fillRect', ...arguments]) },
    strokeRect() { calls.push(['strokeRect', ...arguments]) },
    fillText() { calls.push(['fillText', ...arguments]) },
    beginPath() {},
    moveTo() { calls.push(['moveTo', ...arguments]) },
    lineTo() { calls.push(['lineTo', ...arguments]) },
    arcTo() { calls.push(['arcTo', ...arguments]) },
    closePath() {},
    arc() { calls.push(['arc', ...arguments]) },
    stroke() { calls.push(['stroke']) },
    fill() { calls.push(['fill']) },
    save() {},
    restore() {},
    translate() {},
    setTransform() {},
    measureText(text) { return { width: String(text).length * 10 } }
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

// ---- visibleRange / renderGridView（可视区裁剪直绘）----
{
  const view = { scale: 1, ox: -100, oy: -100 }
  const r = pattern.visibleRange(view, 10, 16, 1, 350, 310)
  assert.deepStrictEqual(r, { c0: 5, c1: 9, r0: 5, r1: 9 }, '视口偏移时应只返回可见行列')
}
{
  const view = { scale: 1, ox: 5000, oy: 0 }
  const r = pattern.visibleRange(view, 10, 16, 1, 350, 310)
  assert.ok(r.c1 < r.c0, '视口完全在图纸右侧外时无可见列')
}
{
  const ctx = fakeCtx()
  pattern.renderGridView(ctx, grid10, palette, {
    cellSize: 16, gap: 1, code: false, gridEvery: 5,
    view: { scale: 0.5, ox: 0, oy: 0 }, areaW: 350, areaH: 310
  })
  const fills = ctx.calls.filter((c) => c[0] === 'fillRect')
  assert.strictEqual(fills.length, 101, '全网格可见时白底 1 次 + 10x10 格子 100 次')
  const lineTos = ctx.calls.filter((c) => c[0] === 'lineTo')
  assert.strictEqual(lineTos.length, 2, '每 5 格粗线仍只画可见的 1 横 1 纵')
}
{
  const ctx = fakeCtx()
  pattern.renderGridView(ctx, grid10, palette, {
    cellSize: 16, gap: 1, code: true,
    view: { scale: 1, ox: -17, oy: -17 }, areaW: 68, areaH: 68
  })
  const fills = ctx.calls.filter((c) => c[0] === 'fillRect')
  assert.strictEqual(fills.length, 26, '放大后只画可见 5x5 格子 + 白底 1 次')
  const texts = ctx.calls.filter((c) => c[0] === 'fillText')
  assert.strictEqual(texts.length, 25, '放大后只对可见格子画编号')
}

// ---- renderExport / renderLegend / layoutExport ----
const one = [['A1']]
const legendItems = [
  { code: 'A1', count: 1, hex: '#ffd500' },
  { code: 'A4', count: 2, hex: '#e60012' }
]
const layout = pattern.layoutExport(one, { cellSize: 16, gap: 1, legendItems })
assert.strictEqual(layout.width, 16 + pattern.EXPORT_COORD * 2, '导出宽度应等于图纸宽度 + 四周坐标边距')
assert.ok(layout.height > 16, '含色号清单时高度应大于图纸高度')
assert.strictEqual(pattern.layoutExport(one, { cellSize: 16, gap: 1 }).height, 16 + pattern.EXPORT_COORD * 2, '无色号清单时高度应等于图纸高度 + 四周坐标边距')

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
  const legendNarrow = pattern.layoutExport(one, { cellSize: 16, gap: 1, legendItems: many }).height - (16 + pattern.EXPORT_COORD * 2)
  const legendWide = pattern.layoutExport(gridWide, { cellSize: 16, gap: 1, legendItems: many }).height - pattern.layoutExport(gridWide, { cellSize: 16, gap: 1 }).height
  assert.ok(legendWide < legendNarrow, '宽度更大时清单行数应更少')
}

// 图例卡片预留：3 位色号 + '×' + 5 位数量（208 盘最大 43264 颗）必须放得下
{
  const OFFSET = 12 + 40 + 14 // 卡片内文字起点：左距 12 + 色样 40 + 间距 14
  const codeW = 22 * 0.62 * 3 // 22px 半粗，按 0.62 字宽/字符保守估算
  const timesW = 22 * 0.5 // '×' 符号宽
  const countW = 24 * 0.68 * 5 // 24px 粗体 5 位数字
  const need = OFFSET + codeW + 10 + timesW + 8 + countW
  assert.ok(pattern.LEGEND_UNIT_W >= need, '图例卡片宽应容纳 3 位色号 + × + 5 位数量（预留五位数）')
}

assert.ok(pattern.EXPORT_MAX_DIM > 0, '应暴露导出最大边长常量')

// ---- renderRulers 显示密度 ----
{
  assert.strictEqual(pattern.rulerStep(12), 1, '少量可见格每格都标')
  assert.strictEqual(pattern.rulerStep(52), 5, '52 盘可见时每 5 格标一个')
  assert.strictEqual(pattern.rulerStep(104), 10, '104 盘每 10 格标一个')
  assert.strictEqual(pattern.rulerStep(208), 20, '208 盘每 20 格标一个')
}

// ---- serializeGrid / parseGrid（图库 grid 存储） ----
{
  const g = [
    ['A1', 'B2'],
    ['C3', 'A1']
  ]
  const str = pattern.serializeGrid(g)
  assert.strictEqual(str, 'A1,B2,C3,A1', '序列化应按行优先逗号连接')
  assert.deepStrictEqual(pattern.parseGrid(str, 2), g, '解析应还原二维网格')
}
{
  assert.strictEqual(pattern.serializeGrid([]), '', '空网格序列化应为空串')
  assert.throws(() => pattern.parseGrid('A1', 2), /图纸数据不完整/, '长度不符应抛错')
  assert.throws(() => pattern.parseGrid('', 0), /图纸数据不完整/, '非法尺寸应抛错')
}
{
  // 104 盘往返
  const g = []
  for (let r = 0; r < 104; r++) {
    const row = []
    for (let c = 0; c < 104; c++) row.push('A' + (c % 22 + 1))
    g.push(row)
  }
  assert.deepStrictEqual(pattern.parseGrid(pattern.serializeGrid(g), 104), g, '104 盘往返应一致')
}

// ---- serializeBgMask / parseBgMask（图库背景掩码存储）----
{
  const m = [[true, false], [false, true]]
  const str = pattern.serializeBgMask(m)
  assert.strictEqual(str, '1001', '序列化应按行优先 1/0 拼接')
  assert.deepStrictEqual(pattern.parseBgMask(str, 2), m, '解析应还原二维掩码')
  assert.strictEqual(pattern.parseBgMask('10', 2), null, '长度不符应返回 null')
  assert.strictEqual(pattern.parseBgMask('', 2), null, '空串应返回 null')
  assert.strictEqual(pattern.parseBgMask(undefined, 2), null, '缺省应返回 null')
}


// ---- despeckle（孤立杂点合并） ----
{
  const g = [
    ['A1', 'A1', 'A1'],
    ['A1', 'A4', 'A1'],
    ['A1', 'A1', 'A1']
  ]
  assert.deepStrictEqual(pattern.despeckle(g), [
    ['A1', 'A1', 'A1'],
    ['A1', 'A1', 'A1'],
    ['A1', 'A1', 'A1']
  ], '被 8 邻域同色包围的孤立单格应并入周围色')
}
{
  const g = [
    ['A1', 'A2'],
    ['A1', 'A2']
  ]
  assert.deepStrictEqual(pattern.despeckle(g), g, '非孤立的相邻色块不应被改')
}
{
  const g = [['A1']]
  assert.deepStrictEqual(pattern.despeckle(g), g, '1x1 边界格不应被改（邻域越界）')
}

// ---- mergeRareColors（颜色精简：把只出现一两次的杂色并入附近主体色） ----
{
  const pal = color.buildPalette('48')
  const g = [
    ['A4', 'A4', 'A4', 'A4'],
    ['A4', 'A10', 'A4', 'A4'],
    ['A4', 'A4', 'A4', 'A4'],
    ['A4', 'A4', 'A4', 'A4']
  ]
  const r = pattern.mergeRareColors(g, pal)
  assert.strictEqual(r.removed, 1, '只出现一次的杂色应被并入')
  assert.strictEqual(r.mapping['A10'], 'A4', '唯一锚点应为最近的主体色')
  assert.deepStrictEqual(g, [
    ['A4', 'A4', 'A4', 'A4'],
    ['A4', 'A4', 'A4', 'A4'],
    ['A4', 'A4', 'A4', 'A4'],
    ['A4', 'A4', 'A4', 'A4']
  ], '杂色格应改为主体色')
}
{
  // 背景格（bgMask=true）不参与计数、不被改动
  const pal = color.buildPalette('48')
  const g = [
    ['H1', 'H1', 'H1'],
    ['H1', 'A4', 'A10'],
    ['H1', 'A4', 'A4']
  ]
  const mask = [
    [true, true, true],
    [true, false, false],
    [true, false, false]
  ]
  const r = pattern.mergeRareColors(g, pal, { bgMask: mask })
  assert.strictEqual(r.removed, 1, '前景杂色 A10 应被并入')
  assert.strictEqual(g[1][2], 'A4', '前景杂色格应改为主体色')
  assert.strictEqual(g[0][0], 'H1', '背景格不应被改动')
}

// ---- mergeNearColors（邻近色合并：穿插的近色并入数量更多的一方） ----
{
  const pal = color.buildPalette('48')
  const g = [
    ['A4', 'A4', 'A4'],
    ['A4', 'A10', 'A4'],
    ['A4', 'A4', 'A4']
  ]
  const r = pattern.mergeNearColors(g, pal, { nearDeltaE: 1e9 })
  assert.strictEqual(r.changed, true, '邻近色应发生合并')
  assert.deepStrictEqual(g, [
    ['A4', 'A4', 'A4'],
    ['A4', 'A4', 'A4'],
    ['A4', 'A4', 'A4']
  ], '数量少的邻近色应并入数量多的')
}
{
  // maxColors 强制：3 色压到不超过 2 色
  const pal = color.buildPalette('48')
  const g = [
    ['A4', 'A4', 'A4', 'A4', 'A4'],
    ['A4', 'A10', 'A6', 'A4', 'A4'],
    ['A4', 'A4', 'A4', 'A4', 'A4']
  ]
  pattern.mergeNearColors(g, pal, { maxColors: 2 })
  const distinct = new Set(g.reduce((a, row) => a.concat(row), []))
  assert.ok(distinct.size <= 2, 'maxColors 后应不超过 2 种颜色')
}

// ---- postProcessGrid（生成后处理：杂色 + 邻近色合并 + 去噪） ----
{
  const pal = color.buildPalette('48')
  const g = [
    ['A4', 'A4', 'A4', 'A4', 'A4'],
    ['A4', 'A4', 'A10', 'A4', 'A4'],
    ['A4', 'A6', 'A6', 'A4', 'A4'],
    ['A4', 'A4', 'A4', 'A4', 'A4'],
    ['A4', 'A4', 'A4', 'A4', 'A4']
  ]
  const out = pattern.postProcessGrid(g, pal)
  assert.deepStrictEqual(out, g, '后处理应原地返回网格')
  const flat = out.reduce((a, row) => a.concat(row), [])
  assert.ok(flat.indexOf('A10') < 0, '只出现一次的杂色应被并掉')
  assert.ok(flat.indexOf('A6') < 0, '低频且被包围的色应被并掉')
}

// ---- mixWhite / cellEmphasis（智能拼豆 / 一键跟拼 渲染决策） ----
{
  assert.strictEqual(pattern.mixWhite('#B5836B', 0.8), '#F0E6E1', '减淡应向白混合 80%')
  assert.strictEqual(pattern.mixWhite('#000000', 1), '#FFFFFF', 'ratio=1 应为纯白')
  assert.strictEqual(pattern.mixWhite('#FFFFFF', 0.5), '#FFFFFF', '白色减淡仍为白')
  assert.strictEqual(pattern.mixWhite('#FF0000', 0.5), '#FF8080', '红色减淡一半')
}
{
  // 智能拼豆：选中色描边并强制显示色号，其余色减淡；未选色不强调
  const em = { mode: 'spot', code: 'A1' }
  assert.deepStrictEqual(pattern.cellEmphasis('A1', em, false), { outline: true }, '选中色应描边')
  assert.deepStrictEqual(pattern.cellEmphasis('B2', em, false), { dim: true }, '非选中色应减淡')
  assert.deepStrictEqual(pattern.cellEmphasis('B2', em, true), { dim: true }, '背景格减淡后仍为白')
  assert.strictEqual(pattern.cellEmphasis('A1', { mode: 'spot', code: '' }, false), null, '未选色不应有强调')
  assert.strictEqual(pattern.cellEmphasis('A1', null, false), null, '无强调配置应返回 null')
}
{
  // 一键跟拼：当前色描边、已点亮色按普通规则、未点亮格为空格、背景格不受影响
  const em = { mode: 'build', code: 'A1', doneSet: new Set(['B1']) }
  assert.deepStrictEqual(pattern.cellEmphasis('A1', em, false), { outline: true }, '当前色应描边')
  assert.strictEqual(pattern.cellEmphasis('B1', em, false), null, '已点亮色应按普通规则绘制')
  assert.deepStrictEqual(pattern.cellEmphasis('C1', em, false), { empty: true }, '未点亮格应为空格')
  assert.strictEqual(pattern.cellEmphasis('A1', em, true), null, '背景格不应受强调影响')
  assert.deepStrictEqual(
    pattern.cellEmphasis('C1', { mode: 'build', code: '', doneSet: new Set() }, false),
    { empty: true },
    '未选当前色时其余前景格应为空格'
  )
}
{
  // countColors sortBy='count'：数量降序、同数量保持套装顺序、默认行为不变
  const g3 = [
    ['A1', 'A1', 'A4'],
    ['A4', 'A1', 'B1'],
    ['B1', 'B1', 'B1']
  ]
  assert.deepStrictEqual(pattern.countColors(g3, ['A1', 'A4', 'B1'], null, 'count'), [
    { code: 'B1', count: 4 },
    { code: 'A1', count: 3 },
    { code: 'A4', count: 2 }
  ], 'sortBy=count 应按数量降序')
  assert.deepStrictEqual(pattern.countColors(g3, ['A1', 'A4', 'B1']).map((i) => i.code), ['A1', 'A4', 'B1'], '默认仍按套装顺序')
  const g4 = [['A1', 'A4'], ['B1', 'B1']]
  assert.deepStrictEqual(
    pattern.countColors(g4, ['B1', 'A4', 'A1'], null, 'count').map((i) => i.code),
    ['B1', 'A4', 'A1'],
    '同数量并列应保持套装顺序'
  )
}

console.log('pattern.test.js 全部通过 ✓')