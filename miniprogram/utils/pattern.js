// miniprogram/utils/pattern.js
/**
 * 图纸数据与渲染：RGB 网格 → 色号网格、色号计数、canvas 绘制 + 照片还原采样。
 * averageBlocks / mapRgb / countColors / renderGrid 为纯函数，可在 Node 中测试。
 */
const color = require('./color')

const CELL = 20 // 展示格边长 px
const GAP = 1 // 格线留隙 px
const EXPORT_CELL = 16 // 导出格边长 px（104 格 → 1767px，规避部分设备 2048px 上限）
const GRID_LINE_COLOR = '#ff3a5d' // 每 N 格粗网格线颜色（与示例一致）
const GRID_LINE_WIDTH = 2 // 粗网格线宽 px
const EXPORT_MAX_DIM = 2048 // 导出画布最大边长（含底部色号清单），超出时整体等比缩小

// 底部色号清单布局（导出图）
const LEGEND_PAD = 12
const LEGEND_TOP = 24
const LEGEND_HEADER_H = 44
const LEGEND_UNIT_W = 126
const LEGEND_UNIT_H = 56
const LEGEND_GAP = 8
const LEGEND_SWATCH = 38
const LEGEND_BOTTOM = 16

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
  const gridEvery = opts && opts.gridEvery
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
  if (gridEvery > 0) {
    ctx.strokeStyle = (opts && opts.gridColor) || GRID_LINE_COLOR
    ctx.lineWidth = (opts && opts.gridLineWidth) || GRID_LINE_WIDTH
    ctx.beginPath()
    for (let c = gridEvery; c < size; c += gridEvery) {
      const x = c * (cellSize + gap) - gap / 2
      ctx.moveTo(x, 0)
      ctx.lineTo(x, total)
    }
    for (let r = gridEvery; r < size; r += gridEvery) {
      const y = r * (cellSize + gap) - gap / 2
      ctx.moveTo(0, y)
      ctx.lineTo(total, y)
    }
    ctx.stroke()
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


function legendColumns(width) {
  return Math.max(1, Math.floor((width - LEGEND_PAD * 2 + LEGEND_GAP) / (LEGEND_UNIT_W + LEGEND_GAP)))
}

function legendHeight(items, width) {
  if (!items || !items.length) return 0
  const cols = legendColumns(width)
  const rows = Math.ceil(items.length / cols)
  return LEGEND_TOP + LEGEND_HEADER_H + rows * LEGEND_UNIT_H + (rows - 1) * LEGEND_GAP + LEGEND_BOTTOM
}

/**
 * 绘制底部色号清单：一行统计（尺寸/色数/总颗数）+ 每色一个色样单元（色块+编号+数量），自动换行。
 * 返回清单区高度（不含上方图纸）。
 */
function renderLegend(ctx, items, opts) {
  if (!items || !items.length) return 0
  const width = opts.width
  const size = opts.size
  const y0 = opts.y || 0
  const totalBeads = items.reduce((s, i) => s + i.count, 0)
  const cols = legendColumns(width)
  const rows = Math.ceil(items.length / cols)
  ctx.fillStyle = '#12171b'
  ctx.font = '700 32px sans-serif'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText('[' + size + 'x' + size + '/' + items.length + '色/共' + totalBeads + '颗]', LEGEND_PAD, y0 + LEGEND_TOP + LEGEND_HEADER_H / 2)
  let y = y0 + LEGEND_TOP + LEGEND_HEADER_H
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c
      if (idx >= items.length) break
      const item = items[idx]
      const x = LEGEND_PAD + c * (LEGEND_UNIT_W + LEGEND_GAP)
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(x, y, LEGEND_UNIT_W, LEGEND_UNIT_H)
      ctx.strokeStyle = '#d5d5d5'
      ctx.lineWidth = 1
      ctx.strokeRect(x + 0.5, y + 0.5, LEGEND_UNIT_W - 1, LEGEND_UNIT_H - 1)
      ctx.fillStyle = item.hex || '#ffffff'
      ctx.fillRect(x + 6, y + 6, LEGEND_SWATCH, LEGEND_SWATCH)
      ctx.strokeStyle = 'rgba(0,0,0,0.14)'
      ctx.strokeRect(x + 6.5, y + 6.5, LEGEND_SWATCH - 1, LEGEND_SWATCH - 1)
      ctx.fillStyle = '#12171b'
      ctx.font = '600 18px sans-serif'
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      ctx.fillText(item.code, x + LEGEND_SWATCH + 12, y + 20)
      ctx.font = '700 26px sans-serif'
      ctx.fillText(String(item.count), x + LEGEND_SWATCH + 12, y + 43)
    }
    y += LEGEND_UNIT_H + LEGEND_GAP
  }
  return legendHeight(items, width)
}

/**
 * 计算导出图整体尺寸（图纸 + 底部色号清单），不绘制，供设置画布与等比缩放。
 */
function layoutExport(grid, opts) {
  const cellSize = (opts && opts.cellSize) || EXPORT_CELL
  const gap = (opts && opts.gap) || 1
  const size = grid.length
  const gridTotal = size * (cellSize + gap) - gap
  const items = (opts && opts.legendItems) || []
  return { width: gridTotal, height: gridTotal + legendHeight(items, gridTotal) }
}

/**
 * 整图导出：上方图纸（可带每 N 格粗网格线）+ 底部色号清单。调用方需先按 layoutExport 设置画布尺寸。
 * 返回布局尺寸 { width, height }。
 */
function renderExport(ctx, grid, palette, opts) {
  const cellSize = (opts && opts.cellSize) || EXPORT_CELL
  const gap = (opts && opts.gap) || 1
  const gridTotal = renderGrid(ctx, grid, palette, {
    cellSize,
    gap,
    code: opts && opts.code !== false,
    gridEvery: opts && opts.gridEvery
  })
  let legendH = 0
  if (opts && opts.legendItems && opts.legendItems.length) {
    legendH = renderLegend(ctx, opts.legendItems, {
      width: gridTotal,
      size: grid.length,
      y: gridTotal
    })
  }
  return { width: gridTotal, height: gridTotal + legendH }
}

module.exports = {
  mapRgbGrid,
  mapRgb,
  averageBlocks,
  countColors,
  renderGrid,
  renderLegend,
  renderExport,
  layoutExport,
  drawCell,
  CELL,
  GAP,
  EXPORT_CELL,
  EXPORT_MAX_DIM
}