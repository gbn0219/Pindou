// miniprogram/utils/scan.js
/**
 * 图纸识别（扫描）纯逻辑：从已有拼豆图纸图片中按 R×C 网格逐格取主色。
 * dominantColor / scanGrid / rgbGridToCodes 为纯函数，可在 Node 中测试。
 * 不调用任何 AI；识别结果直接映射为所选色系的套装色号（复用 color.nearestColor）。
 */
const color = require('./color')

const TOP_BUCKET_RATIO = 0.35 // 主色桶占比下限，低于则退化为区域平均（渐变/纹理兜底）

/**
 * 区域主色：把 [x0,y0,w,h] 区域内像素按 RGB 高位量化分桶，返回占比最高的桶的平均色。
 * 抗细网格线 / 描边 / 抗锯齿 / 拍照光影：只要格子填充色占多数，主色一定是填充色。
 * 透明像素不计入；全透明返回白色。
 */
function dominantColor(imageData, x0, y0, w, h) {
  const data = imageData.data
  const iw = imageData.width
  const ih = imageData.height
  const sx = Math.max(0, Math.floor(x0))
  const sy = Math.max(0, Math.floor(y0))
  const x1 = Math.min(iw, Math.floor(x0 + w))
  const y1 = Math.min(ih, Math.floor(y0 + h))
  const buckets = new Map()
  let total = 0
  for (let y = sy; y < y1; y++) {
    for (let x = sx; x < x1; x++) {
      const i = (y * iw + x) * 4
      if (data[i + 3] < 128) continue
      const key = ((data[i] >> 5) << 10) | ((data[i + 1] >> 5) << 5) | (data[i + 2] >> 5)
      let b = buckets.get(key)
      if (!b) {
        b = { r: 0, g: 0, b: 0, n: 0 }
        buckets.set(key, b)
      }
      b.r += data[i]
      b.g += data[i + 1]
      b.b += data[i + 2]
      b.n++
      total++
    }
  }
  if (total === 0) return [255, 255, 255]
  let best = null
  for (const b of buckets.values()) {
    if (!best || b.n > best.n) best = b
  }
  if (best.n / total >= TOP_BUCKET_RATIO) {
    return [Math.round(best.r / best.n), Math.round(best.g / best.n), Math.round(best.b / best.n)]
  }
  let sr = 0
  let sg = 0
  let sb = 0
  for (const b of buckets.values()) {
    sr += b.r
    sg += b.g
    sb += b.b
  }
  return [Math.round(sr / total), Math.round(sg / total), Math.round(sb / total)]
}

/**
 * 整图扫描：按 box（图纸范围，图片像素坐标）均分为 rows×cols 网格，逐格取主色。
 * 返回 rows×cols 的 RGB 二维数组。box 允许有少量偏移/缩放误差——误差被行/列数平分。
 */
function scanGrid(imageData, rows, cols, box) {
  const w = box.x1 - box.x0
  const h = box.y1 - box.y0
  const cellW = w / cols
  const cellH = h / rows
  const grid = []
  for (let r = 0; r < rows; r++) {
    const row = []
    for (let c = 0; c < cols; c++) {
      row.push(dominantColor(imageData, box.x0 + c * cellW, box.y0 + r * cellH, cellW, cellH))
    }
    grid.push(row)
  }
  return grid
}

/**
 * RGB 网格 → 所选色系色号网格（CIELAB 最近色）。支持任意 rows×cols。
 */
function rgbGridToCodes(rgbGrid, setKey) {
  const palette = color.buildPalette(setKey)
  const rows = rgbGrid.length
  const cols = rows ? rgbGrid[0].length : 0
  const grid = []
  for (let r = 0; r < rows; r++) {
    const row = []
    for (let c = 0; c < cols; c++) {
      const rgb = rgbGrid[r][c]
      row.push(color.nearestColor(rgb[0], rgb[1], rgb[2], palette).code)
    }
    grid.push(row)
  }
  return grid
}

module.exports = { dominantColor, scanGrid, rgbGridToCodes }
