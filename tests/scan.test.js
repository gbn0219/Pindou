// tests/scan.test.js —— 图纸识别（扫描）纯函数单测
const assert = require('assert')
const scan = require('../miniprogram/utils/scan.js')
const colorsData = require('../miniprogram/data/colors.js')

function makeImageData(width, height, fill) {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const px = fill(x, y)
      const i = (y * width + x) * 4
      data[i] = px[0]
      data[i + 1] = px[1]
      data[i + 2] = px[2]
      data[i + 3] = px[3] === undefined ? 255 : px[3]
    }
  }
  return { data, width, height }
}

// 合成 R×C 拼豆图：每格 cell 像素填充色 + 四周 thin 像素深色格线 + outer 白色边距
function buildGridImage(rows, cols, colors, cell, thin, outer) {
  const pitch = cell + thin
  const W = outer * 2 + cols * pitch - thin
  const H = outer * 2 + rows * pitch - thin
  return makeImageData(W, H, (x, y) => {
    const gx = x - outer
    const gy = y - outer
    if (gx < 0 || gy < 0 || gx >= cols * pitch || gy >= rows * pitch) return [255, 255, 255, 255]
    const c = Math.floor(gx / pitch)
    const r = Math.floor(gy / pitch)
    if (gx - c * pitch < cell && gy - r * pitch < cell) return colors[r * cols + c]
    return [20, 20, 20, 255] // 深色格线
  })
}

// 在某个格子中心画一个黑色“标号”
function paintLabel(img, rows, cols, cell, thin, outer, r, c, size) {
  const pitch = cell + thin
  const x0 = Math.floor(outer + c * pitch + (cell - size) / 2)
  const y0 = Math.floor(outer + r * pitch + (cell - size) / 2)
  for (let y = y0; y < y0 + size; y++) {
    for (let x = x0; x < x0 + size; x++) {
      const i = (y * img.width + x) * 4
      img.data[i] = 0
      img.data[i + 1] = 0
      img.data[i + 2] = 0
      img.data[i + 3] = 255
    }
  }
  return img
}

// sampleCell：主色 + 黑标占比
{
  const img = makeImageData(20, 20, (x, y) => (x < 10 ? [255, 255, 255, 255] : [0, 0, 0, 255]))
  const s = scan.sampleCell(img, 0, 0, 20, 20)
  assert.deepStrictEqual(s.rgb, [255, 255, 255])
  assert.ok(s.darkRatio >= 0.3, 'darkRatio ' + s.darkRatio)
}

// 固定网格扫描 + 黑标背景判定（一张带标号/不带标号的白格 + 彩色格）
{
  const cell = 18
  const thin = 2
  const outer = 2
  const colors = [
    [255, 255, 255, 255], // (0,0) 白豆：中心有黑标
    [255, 255, 255, 255], // (0,1) 空白背景：无标号
    [220, 40, 40, 255], //   (1,0) 彩色
    [245, 245, 245, 255] //  (1,1) 近白背景：无标号
  ]
  const img = buildGridImage(2, 2, colors, cell, thin, outer)
  paintLabel(img, 2, 2, cell, thin, outer, 0, 0, 6)
  const grid = { cell: cell + thin, gx: outer, gy: outer }
  const view = { scale: 1, ox: 0, oy: 0 }
  const { rgbGrid, darkGrid } = scan.scanScreenGrid(img, 2, 2, grid, view)
  // 主色：白/白/红/近白
  assert.deepStrictEqual(rgbGrid[0][0], [255, 255, 255])
  assert.deepStrictEqual(rgbGrid[0][1], [255, 255, 255])
  assert.deepStrictEqual(rgbGrid[1][0], [220, 40, 40])
  assert.deepStrictEqual(rgbGrid[1][1], [245, 245, 245])
  // 黑标：只有 (0,0) 有标号
  assert.ok(darkGrid[0][0] >= 0.05, 'label cell darkRatio ' + darkGrid[0][0])
  assert.ok(darkGrid[0][1] < 0.01)
  assert.ok(darkGrid[1][0] < 0.01)
  assert.ok(darkGrid[1][1] < 0.01)
  // 背景：白且无标号 → 置空；(0,0) 白但有标号 → 白豆
  const mask = scan.buildBgMask(rgbGrid, darkGrid, { autoBg: true })
  assert.deepStrictEqual(mask[0][0], false)
  assert.deepStrictEqual(mask[0][1], true)
  assert.deepStrictEqual(mask[1][0], false)
  assert.deepStrictEqual(mask[1][1], true)
}

// buildBgMask：autoBg=false → 全当白豆
{
  const rgbGrid = [
    [[255, 255, 255], [255, 255, 255]]
  ]
  const darkGrid = [[0, 0]]
  const mask = scan.buildBgMask(rgbGrid, darkGrid, { autoBg: false })
  assert.deepStrictEqual(mask[0], [false, false])
}

// buildBgMask：整张图一个黑标都没有（图不印色号）→ 全当白豆
{
  const rgbGrid = [
    [[255, 255, 255], [255, 255, 255]]
  ]
  const darkGrid = [[0, 0]]
  const mask = scan.buildBgMask(rgbGrid, darkGrid, { autoBg: true })
  assert.deepStrictEqual(mask[0], [false, false])
}

// rgbGridToCodes：套装真实色号映射回同一色号
{
  const set = '221'
  const firstCode = colorsData.sets[set][0]
  const rgb = colorsData.colors[firstCode].rgb
  const img = makeImageData(10, 10, () => [rgb[0], rgb[1], rgb[2], 255])
  const { rgbGrid } = scan.scanScreenGrid(img, 1, 1, { cell: 10, gx: 0, gy: 0 }, { scale: 1, ox: 0, oy: 0 })
  const codes = scan.rgbGridToCodes(rgbGrid, set)
  assert.strictEqual(codes[0][0], firstCode)
}

// detectGridLines：合成网格图（含黑标）检测格宽/格高/原点
{
  const cell = 18
  const thin = 2
  const outer = 3
  const bright = [
    [240, 180, 120],
    [180, 240, 140],
    [160, 200, 240],
    [250, 240, 150],
    [230, 160, 220],
    [200, 210, 200]
  ]
  const colors = []
  for (let i = 0; i < 5 * 6; i++) colors.push([bright[i % bright.length][0], bright[i % bright.length][1], bright[i % bright.length][2], 255])
  const img = buildGridImage(5, 6, colors, cell, thin, outer)
  paintLabel(img, 5, 6, cell, thin, outer, 0, 0, 6)
  paintLabel(img, 5, 6, cell, thin, outer, 2, 3, 6)
  paintLabel(img, 5, 6, cell, thin, outer, 4, 1, 6)
  const det = scan.detectGridLines(img)
  assert.ok(det, 'grid lines should be detected')
  assert.ok(Math.abs(det.cellW - (cell + thin)) <= 2, 'cellW ' + det.cellW)
  assert.ok(Math.abs(det.cellH - (cell + thin)) <= 2, 'cellH ' + det.cellH)
  assert.ok(Math.abs(det.originX - outer) <= 2, 'originX ' + det.originX)
  assert.ok(Math.abs(det.originY - outer) <= 2, 'originY ' + det.originY)
}

// 在最外层画 2px 深色边框（图纸带外框线）
function paintFrame(img, outer) {
  const W = img.width
  const H = img.height
  for (let y = 0; y < H; y++) {
    for (const x of [outer, outer + 1, W - outer - 2, W - outer - 1]) {
      if (x < 0 || x >= W) continue
      const i = (y * W + x) * 4
      img.data[i] = 0
      img.data[i + 1] = 0
      img.data[i + 2] = 0
      img.data[i + 3] = 255
    }
  }
  for (let x = 0; x < W; x++) {
    for (const y of [outer, outer + 1, H - outer - 2, H - outer - 1]) {
      if (y < 0 || y >= H) continue
      const i = (y * W + x) * 4
      img.data[i] = 0
      img.data[i + 1] = 0
      img.data[i + 2] = 0
      img.data[i + 3] = 255
    }
  }
  return img
}

// detectGridLines：带外框线的图纸，原点 = 外框线位置（不需要回退一格）
{
  const cell = 18
  const thin = 2
  const outer = 3
  const bright = [[240, 180, 120], [180, 240, 140], [160, 200, 240], [250, 240, 150]]
  const colors = []
  for (let i = 0; i < 5 * 6; i++) colors.push([bright[i % bright.length][0], bright[i % bright.length][1], bright[i % bright.length][2], 255])
  const img = buildGridImage(5, 6, colors, cell, thin, outer)
  paintFrame(img, outer)
  const det = scan.detectGridLines(img)
  assert.ok(det, 'grid lines with frame should be detected')
  assert.ok(Math.abs(det.originX - outer) <= 2, 'frame originX ' + det.originX)
  assert.ok(Math.abs(det.originY - outer) <= 2, 'frame originY ' + det.originY)
}

// detectGridLines：纯色无网格图返回 null
{
  const img = makeImageData(60, 60, () => [180, 200, 220, 255])
  assert.strictEqual(scan.detectGridLines(img), null)
}

console.log('scan.test.js: all assertions passed')
