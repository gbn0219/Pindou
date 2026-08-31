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

// 合成一张 R×C 拼豆图：每格 cell 像素填充色 + 四周 thin 像素深色格线 + outer 白色边距
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

// dominantColor：均匀色块返回该色
{
  const img = makeImageData(8, 8, () => [200, 30, 40, 255])
  assert.deepStrictEqual(scan.dominantColor(img, 0, 0, 8, 8), [200, 30, 40])
}

// dominantColor：区域内混入细格线仍返回主色（填充占多数）
{
  // 16x16：左 14px 红 + 右 2px 黑
  const img = makeImageData(16, 16, (x) => (x < 14 ? [220, 40, 40, 255] : [0, 0, 0, 255]))
  assert.deepStrictEqual(scan.dominantColor(img, 0, 0, 16, 16), [220, 40, 40])
}

// dominantColor：全透明区域返回白色
{
  const img = makeImageData(6, 6, () => [0, 0, 0, 0])
  assert.deepStrictEqual(scan.dominantColor(img, 0, 0, 6, 6), [255, 255, 255])
}

// scanGrid：精确选框，2×2 四色 + 格线，全部取到填充色
{
  const colors = [
    [220, 40, 40, 255],
    [40, 200, 40, 255],
    [40, 40, 220, 255],
    [240, 220, 40, 255]
  ]
  const img = buildGridImage(2, 2, colors, 18, 2, 2)
  const box = { x0: 2, y0: 2, x1: 2 + 2 * 20 - 2, y1: 2 + 2 * 20 - 2 }
  const grid = scan.scanGrid(img, 2, 2, box)
  assert.deepStrictEqual(grid[0][0], [220, 40, 40])
  assert.deepStrictEqual(grid[0][1], [40, 200, 40])
  assert.deepStrictEqual(grid[1][0], [40, 40, 220])
  assert.deepStrictEqual(grid[1][1], [240, 220, 40])
}

// scanGrid：选框偏移 1px（圈得没那么准）仍然全部取到正确主色
{
  const colors = [
    [220, 40, 40, 255],
    [40, 200, 40, 255],
    [40, 40, 220, 255],
    [240, 220, 40, 255]
  ]
  const img = buildGridImage(2, 2, colors, 18, 2, 2)
  // 相对上一个用例整体偏移 (1,1)，且右/下略小
  const box = { x0: 3, y0: 3, x1: 2 + 2 * 20 - 2 - 1, y1: 2 + 2 * 20 - 2 - 1 }
  const grid = scan.scanGrid(img, 2, 2, box)
  assert.deepStrictEqual(grid[0][0], [220, 40, 40])
  assert.deepStrictEqual(grid[0][1], [40, 200, 40])
  assert.deepStrictEqual(grid[1][0], [40, 40, 220])
  assert.deepStrictEqual(grid[1][1], [240, 220, 40])
}

// rgbGridToCodes：用套装真实色号映射回同一色号
{
  const set = '221'
  const firstCode = colorsData.sets[set][0]
  const rgb = colorsData.colors[firstCode].rgb
  const img = makeImageData(10, 10, () => [rgb[0], rgb[1], rgb[2], 255])
  const grid = scan.scanGrid(img, 1, 1, { x0: 0, y0: 0, x1: 10, y1: 10 })
  const codes = scan.rgbGridToCodes(grid, set)
  assert.strictEqual(codes[0][0], firstCode)
}

// rgbGridToCodes：非色卡颜色映射到套装内合法色号
{
  const img = makeImageData(10, 10, () => [12, 34, 56, 255])
  const grid = scan.scanGrid(img, 1, 1, { x0: 0, y0: 0, x1: 10, y1: 10 })
  const codes = scan.rgbGridToCodes(grid, '221')
  assert.ok(colorsData.sets['221'].indexOf(codes[0][0]) >= 0)
}

console.log('scan.test.js: all assertions passed')
