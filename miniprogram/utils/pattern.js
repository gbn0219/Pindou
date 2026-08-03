// miniprogram/utils/pattern.js
/**
 * 图纸数据与渲染：RGB 网格 → 色号网格、色号计数、canvas 绘制。
 * mapRgbGrid / countColors 为纯函数，可在 Node 中测试。
 */
const color = require('./color')

const CELL = 20 // 展示格边长 px
const GAP = 1 // 格线留缝 px
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


function lum(r, g, b) {
  return 0.299 * r + 0.587 * g + 0.114 * b
}

/**
 * 格子代表色采样：把 size4×size4 源图上每个 block×block 像素块压缩为一个
 * 代表色，返回 size×size 的 RGB 数组。
 * 默认取块平均色（忠实还原原图颜色）；仅当块内亮度对比度 >= 200 且
 * 少数簇占比 >= 40% 时，取少数簇中出现最多的拼豆色号对应的像素色，
 * 保住眼镜框/耳机线等细线。透明像素按白处理。
 */
function dominantBlocks(data, size4, size, block, palette) {
  const rgbArr = []
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const pixels = []
      for (let dy = 0; dy < block; dy++) {
        for (let dx = 0; dx < block; dx++) {
          const i = ((r * block + dy) * size4 + (c * block + dx)) * 4
          if (data[i + 3] >= 128) pixels.push([data[i], data[i + 1], data[i + 2]])
        }
      }
      if (pixels.length === 0) {
        rgbArr.push([255, 255, 255])
        continue
      }
      let minL = 255
      let maxL = 0
      for (const p of pixels) {
        const l = lum(p[0], p[1], p[2])
        if (l < minL) minL = l
        if (l > maxL) maxL = l
      }
      if (maxL - minL >= 200) {
        const mid = (maxL + minL) / 2
        const dark = []
        const bright = []
        for (const p of pixels) {
          if (lum(p[0], p[1], p[2]) < mid) dark.push(p)
          else bright.push(p)
        }
        const minority = dark.length <= bright.length ? dark : bright
        if (minority.length / pixels.length >= 0.4) {
          const cnt = {}
          for (const p of minority) {
            const code = color.nearestColor(p[0], p[1], p[2], palette).code
            cnt[code] = (cnt[code] || 0) + 1
          }
          let bestCode = null
          let bestCount = 0
          for (const k of Object.keys(cnt)) {
            if (cnt[k] > bestCount) {
              bestCount = cnt[k]
              bestCode = k
            }
          }
          const bestPx = minority.find(
            (p) => color.nearestColor(p[0], p[1], p[2], palette).code === bestCode
          )
          if (bestPx) {
            rgbArr.push([bestPx[0], bestPx[1], bestPx[2]])
            continue
          }
        }
      }
      const out = [0, 0, 0]
      for (const p of pixels) {
        out[0] += p[0]
        out[1] += p[1]
        out[2] += p[2]
      }
      rgbArr.push([
        Math.round(out[0] / pixels.length),
        Math.round(out[1] / pixels.length),
        Math.round(out[2] / pixels.length)
      ])
    }
  }
  return rgbArr
}

/**
 * 相似色区域合并（BFS）：色距（RGB 欧氏距离）<= threshold 的相邻格子
 * 归为同一区域，区域统一为区域内出现次数最多的色号；
 * 用于去除量化杂色并统一内部颜色，色差明显的边界不会被合并。
 */
function mergeGrid(grid, palette, threshold) {
  const size = grid.length
  const rgbMap = {}
  for (const item of palette) rgbMap[item.code] = item.rgb
  const dist = (a, b) => {
    const ca = rgbMap[a] || [0, 0, 0]
    const cb = rgbMap[b] || [0, 0, 0]
    const dr = ca[0] - cb[0]
    const dg = ca[1] - cb[1]
    const db = ca[2] - cb[2]
    return Math.sqrt(dr * dr + dg * dg + db * db)
  }
  const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]]
  const visited = grid.map((row) => row.map(() => false))
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (visited[r][c]) continue
      const seed = grid[r][c]
      const region = []
      const queue = [[r, c]]
      visited[r][c] = true
      while (queue.length) {
        const cell = queue.shift()
        region.push(cell)
        for (const d of dirs) {
          const nr = cell[0] + d[0]
          const nc = cell[1] + d[1]
          if (nr < 0 || nr >= size || nc < 0 || nc >= size || visited[nr][nc]) continue
          if (dist(grid[nr][nc], seed) <= threshold) {
            visited[nr][nc] = true
            queue.push([nr, nc])
          }
        }
      }
      if (region.length < 2) continue
      const count = {}
      for (const cell of region) {
        const code = grid[cell[0]][cell[1]]
        count[code] = (count[code] || 0) + 1
      }
      let best = seed
      let bestCount = 0
      for (const k of Object.keys(count)) {
        if (count[k] > bestCount) {
          bestCount = count[k]
          best = k
        }
      }
      for (const cell of region) grid[cell[0]][cell[1]] = best
    }
  }
  return grid
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
  mapRgb,
  dominantBlocks,
  mergeGrid,
  countColors,
  renderGrid,
  drawCell,
  CELL,
  GAP,
  EXPORT_CELL,
  denoiseGrid
}
