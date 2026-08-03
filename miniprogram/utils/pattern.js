// miniprogram/utils/pattern.js
/**
 * 图纸数据与渲染：RGB 网格 → 色号网格、色号计数、canvas 绘制。
 * mapRgbGrid / countColors 为纯函数，可在 Node 中测试。
 */
const color = require('./color')

const CELL = 20 // 展示格边长 px
const GAP = 1 // 格线留缝 px
const EXPORT_CELL = 16 // 导出格边长 px（104 格 → 1767px，规避部分设备 2048px 上限）

function mapRgbGrid(imageData, size, palette) {
  const grid = []
  const data = imageData.data
  for (let r = 0; r < size; r++) {
    const row = []
    for (let c = 0; c < size; c++) {
      const i = (r * size + c) * 4
      let rgb = [data[i], data[i + 1], data[i + 2]]
      if (data[i + 3] < 128) rgb = [255, 255, 255]
      row.push(color.nearestColor(rgb[0], rgb[1], rgb[2], palette).code)
    }
    grid.push(row)
  }
  return grid
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


function medianFilter(data, w, h) {
  const out = new Uint8ClampedArray(data.length)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      for (let ch = 0; ch < 3; ch++) {
        const vals = []
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx
            const ny = y + dy
            if (nx >= 0 && nx < w && ny >= 0 && ny < h) vals.push(data[(ny * w + nx) * 4 + ch])
          }
        }
        vals.sort((a, b) => a - b)
        out[i + ch] = vals[Math.floor(vals.length / 2)]
      }
      out[i + 3] = data[i + 3]
    }
  }
  return out
}

function denoiseGrid(grid) {
  const size = grid.length
  const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]]
  for (let round = 0; round < 2; round++) {
    let changed = false
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const code = grid[r][c]
        const nbrs = []
        for (const d of dirs) {
          const nr = r + d[0]
          const nc = c + d[1]
          if (nr >= 0 && nr < size && nc >= 0 && nc < size) nbrs.push(grid[nr][nc])
        }
        if (nbrs.length < 3) continue
        if (nbrs.every((n) => n !== code)) {
          const count = {}
          for (const n of nbrs) count[n] = (count[n] || 0) + 1
          let best = null
          let bestCount = 0
          for (const k of Object.keys(count)) {
            if (count[k] > bestCount) {
              bestCount = count[k]
              best = k
            }
          }
          if (bestCount >= Math.ceil(nbrs.length * 0.75)) {
            grid[r][c] = best
            changed = true
          }
        }
      }
    }
    if (!changed) break
  }
  return grid
}

module.exports = {
  mapRgbGrid,
  countColors,
  renderGrid,
  drawCell,
  CELL,
  GAP,
  EXPORT_CELL,
  medianFilter,
  denoiseGrid
}
