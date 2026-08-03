// miniprogram/utils/pattern.js
/**
 * 图纸数据与渲染：RGB 网格 → 色号网格、色号计数、canvas 绘制 + 照片还原采样。
 * averageBlocks / mapRgb / countColors / renderGrid 为纯函数，可在 Node 中测试。
 */
const color = require('./color')

const CELL = 20 // 展示格边长 px
const GAP = 1 // 格线留隙 px
const EXPORT_CELL = 16 // 导出格边长 px（104 格 → 1767px，规避部分设备 2048px 上限）

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

function mapRgbGrid(imageData, size, palette) {
  const data = imageData.data
  const rgbArr = []
  for (let i = 0; i < size * size; i++) {
    const j = i * 4
    rgbArr.push(data[j + 3] < 128 ? [255, 255, 255] : [data[j], data[j + 1], data[j + 2]])
  }
  return mapRgb(rgbArr, size, palette)
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

/**
 * 照片还原采样：把 size4×size4 源图上每个 block×block 像素块压缩为一个
 * 平均色，返回 size×size 的 RGB 数组。不做任何平滑/合并/去噪。
 * 透明像素不计入平均；全透明块按白色处理。
 */
function averageBlocks(data, size4, size, block) {
  const rgbArr = []
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      let sumR = 0
      let sumG = 0
      let sumB = 0
      let count = 0
      for (let dy = 0; dy < block; dy++) {
        for (let dx = 0; dx < block; dx++) {
          const i = ((r * block + dy) * size4 + (c * block + dx)) * 4
          if (data[i + 3] >= 128) {
            sumR += data[i]
            sumG += data[i + 1]
            sumB += data[i + 2]
            count++
          }
        }
      }
      if (count === 0) {
        rgbArr.push([255, 255, 255])
      } else {
        rgbArr.push([
          Math.round(sumR / count),
          Math.round(sumG / count),
          Math.round(sumB / count)
        ])
      }
    }
  }
  return rgbArr
}

module.exports = {
  mapRgbGrid,
  mapRgb,
  averageBlocks,
  countColors,
  renderGrid,
  drawCell,
  CELL,
  GAP,
  EXPORT_CELL
}