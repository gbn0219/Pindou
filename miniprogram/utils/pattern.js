// miniprogram/utils/pattern.js
/**
 * 图纸数据与渲染：RGB 网格 → 色号网格、色号计数、canvas 绘制 + 照片还原采样。
 * averageBlocks / mapRgb / countColors / renderGrid 为纯函数，可在 Node 中测试。
 */
const color = require('./color')

const CELL = 20 // 展示格边长 px
const GAP = 1 // 格线留隙 px
const DISPLAY_MAX_DIM = 2048 // 展示画布最大边长（与导出一致的安全上限），超出时自动降低格边长
const EXPORT_CELL = 16 // 导出格边长 px（104 格 → 1767px，规避部分设备 2048px 上限）
const GRID_LINE_COLOR = '#ff3a5d' // 每 N 格粗网格线颜色（与示例一致）
const GRID_LINE_WIDTH = 2 // 粗网格线宽 px
const EXPORT_MAX_DIM = 2048 // 导出画布最大边长（含底部色号清单），超出时整体等比缩小
const WHITE_RGB_MIN = 230 // 判定为"白色系"的 RGB 下限（H1 纯白、H2 近白、奶油白等）

// 底部色号清单布局（导出图）
const LEGEND_BG = '#f8f5ee' // 图例区米白背景（胶囊卡片风格）
const LEGEND_PAD = 24
const LEGEND_TOP = 20
const LEGEND_HEADER_H = 48
const LEGEND_UNIT_W = 232 // 胶囊卡片宽：预留 3 位色号 + '×' + 5 位数量（208 盘最大 43264 颗）与左右留白，防止数字溢出
const LEGEND_UNIT_H = 64
const LEGEND_GAP = 12
const LEGEND_SWATCH = 40
const LEGEND_BOTTOM = 24

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

function countColors(grid, setCodes, excludeMask) {
  const countMap = {}
  for (let r = 0; r < grid.length; r++) {
    const row = grid[r]
    for (let c = 0; c < row.length; c++) {
      // excludeMask：白色背景等不计入色块数目
      if (excludeMask && excludeMask[r] && excludeMask[r][c]) continue
      const code = row[c]
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

function countColor(grid, code) {
  let n = 0
  for (const row of grid) {
    for (const c of row) {
      if (c === code) n++
    }
  }
  return n
}

/**
 * 批量换色：把 grid 中所有 fromCode 格子改为 toCode，返回被替换的格子数。
 * 原地修改 grid；fromCode 与 toCode 相同时不做任何事。
 */
function replaceColor(grid, fromCode, toCode) {
  if (fromCode === toCode) return 0
  let n = 0
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < grid[r].length; c++) {
      if (grid[r][c] === fromCode) {
        grid[r][c] = toCode
        n++
      }
    }
  }
  return n
}

/**
 * 白色系色号：RGB 三个通道都 >= WHITE_RGB_MIN 的套装颜色（纯白 H1、近白 H2、奶油白等）。
 * 背景不一定是纯白 H1（生成图/照片背景常映射到 H2 或奶油白），需要把整组近白色都视为背景候选。
 */
function findWhiteishCodes(palette) {
  return palette
    .filter((item) => item.rgb[0] >= WHITE_RGB_MIN && item.rgb[1] >= WHITE_RGB_MIN && item.rgb[2] >= WHITE_RGB_MIN)
    .map((item) => item.code)
}

/**
 * 白色背景连通域：从网格四边出发 flood fill，把所有与边缘连通的白色系格子标记为背景。
 * whiteCodes 可以是单个色号字符串或色号数组（近白色集合）。
 * 返回 size×size 的布尔二维数组（true = 背景，不计编号、不计色块数）。
 * 内部被主体包围的白色块（如白色衣服/高光）不是背景，不会被标记。
 */
function findBackgroundMask(grid, whiteCodes) {
  const codes = Array.isArray(whiteCodes) ? whiteCodes : [whiteCodes]
  const h = grid.length
  const w = h ? grid[0].length : 0
  const mask = []
  for (let r = 0; r < h; r++) mask.push(new Array(w).fill(false))
  if (!h || !w) return mask
  const queue = []
  const push = (r, c) => {
    if (r < 0 || c < 0 || r >= h || c >= w) return
    if (mask[r][c] || codes.indexOf(grid[r][c]) < 0) return
    mask[r][c] = true
    queue.push([r, c])
  }
  for (let c = 0; c < w; c++) {
    push(0, c)
    push(h - 1, c)
  }
  for (let r = 0; r < h; r++) {
    push(r, 0)
    push(r, w - 1)
  }
  while (queue.length) {
    const cell = queue.pop()
    const r = cell[0]
    const c = cell[1]
    push(r - 1, c)
    push(r + 1, c)
    push(r, c - 1)
    push(r, c + 1)
  }
  return mask
}

/**
 * 展示画布格边长：优先保持 CELL；画布总边长（size×(cell+GAP)−GAP）超过 DISPLAY_MAX_DIM
 * 时逐级缩小格边，保证 15~208 的大盘面也能正常渲染。触摸换算必须使用返回值。
 */
function displayCell(size) {
  let cell = CELL
  while (cell > 2 && size * (cell + GAP) - GAP > DISPLAY_MAX_DIM) cell--
  return cell
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
  const noCode = opts && opts.noCode // 白色背景格不显示编号
  const highlight = opts && opts.highlight
  const code = grid[r][c]
  const hex = cellItem(palette, code).hex
  const x = c * (cellSize + gap)
  const y = r * (cellSize + gap)
  ctx.fillStyle = hex
  ctx.fillRect(x, y, cellSize, cellSize)
  if (showCode && !noCode) {
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
  const noCodeMask = opts && opts.noCodeMask // 白色背景格不显示编号
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
        noCode: !!(noCodeMask && noCodeMask[r] && noCodeMask[r][c]),
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

function roundRectPath(ctx, x, y, w, h, r) {
  const rr = Math.min(r, h / 2, w / 2)
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}

/**
 * 绘制底部色号清单（胶囊卡片风格）：一行统计（尺寸/色数/总颗数）+ 米白背景上的
 * 圆角胶囊卡片，每张卡片 = 圆形色样 + "色号 × 数量"，自动换行。
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
  const height = legendHeight(items, width)
  // 清单区米白背景
  ctx.fillStyle = LEGEND_BG
  ctx.fillRect(0, y0, width, height)
  // 统计行
  ctx.fillStyle = '#333333'
  ctx.font = '700 28px sans-serif'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText(
    '[' + size + 'x' + size + '/' + items.length + '色/共' + totalBeads + '颗]',
    LEGEND_PAD,
    y0 + LEGEND_TOP + LEGEND_HEADER_H / 2
  )
  let y = y0 + LEGEND_TOP + LEGEND_HEADER_H
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c
      if (idx >= items.length) break
      const item = items[idx]
      const x = LEGEND_PAD + c * (LEGEND_UNIT_W + LEGEND_GAP)
      const midY = y + LEGEND_UNIT_H / 2
      // 胶囊卡片（白底、圆角、轻微投影）
      ctx.save()
      ctx.shadowColor = 'rgba(18, 23, 27, 0.10)'
      ctx.shadowBlur = 10
      ctx.shadowOffsetY = 3
      ctx.fillStyle = '#ffffff'
      roundRectPath(ctx, x, y, LEGEND_UNIT_W, LEGEND_UNIT_H, LEGEND_UNIT_H / 2)
      ctx.fill()
      ctx.restore()
      // 圆形色样（浅色加极淡描边，避免在米白背景上糊成一片）
      ctx.fillStyle = item.hex || '#ffffff'
      ctx.beginPath()
      ctx.arc(x + 12 + LEGEND_SWATCH / 2, midY, LEGEND_SWATCH / 2, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = 'rgba(18, 23, 27, 0.10)'
      ctx.lineWidth = 1
      ctx.stroke()
      // 色号 × 数量
      const textX = x + 12 + LEGEND_SWATCH + 14
      ctx.fillStyle = '#333333'
      ctx.font = '600 22px sans-serif'
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      ctx.fillText(item.code, textX, midY)
      const codeW = ctx.measureText(item.code).width
      ctx.fillText('×', textX + codeW + 10, midY)
      const timesW = ctx.measureText('×').width
      ctx.font = '700 24px sans-serif'
      ctx.fillText(String(item.count), textX + codeW + 10 + timesW + 8, midY)
    }
    y += LEGEND_UNIT_H + LEGEND_GAP
  }
  return height
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
    gridEvery: opts && opts.gridEvery,
    noCodeMask: opts && opts.noCodeMask
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
  countColor,
  replaceColor,
  displayCell,
  findWhiteishCodes,
  findBackgroundMask,
  renderGrid,
  renderLegend,
  renderExport,
  layoutExport,
  drawCell,
  CELL,
  GAP,
  EXPORT_CELL,
  EXPORT_MAX_DIM,
  LEGEND_UNIT_W
}