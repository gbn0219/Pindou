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
const EXPORT_COORD = 16 // 导出图四周坐标边距 px（与导出格同宽，坐标格像网格的延伸）
const COORD_COLOR = '#8a919c' // 排号/列号颜色（细字，避免挤压）
const BG_GRID_COLOR = '#e2e4e8' // 背景格浅灰格线（无色号格仍显示格子）
const RULER_SIZE = 34 // 坐标轴条宽高 px（屏幕空间，固定画布四周，缩放/拖动不跳动）
const RULER_MAX_LABELS = 12 // 坐标轴每轴最多标签数（显示密度基准）
const RULER_STEPS = [1, 2, 5, 10, 20, 50, 100, 200] // 显示密度档位（每 N 格一个标签）
const RULER_BG = '#e8e9ec' // 坐标条灰色背景
const RULER_LINE = '#aab0b8' // 坐标条分隔线/边框色（清晰可见）
const RULER_TEXT = '#3f4750' // 坐标条文字色
const RULER_BG_VIEW = '#f3f0e8' // 交互页坐标条背景（暖米色，与纸张观感一致）
const RULER_LINE_VIEW = '#cfc9bc' // 交互页坐标条边框（暖灰细线）
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

function countColors(grid, setCodes, excludeMask, sortBy) {
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
  const list = Object.keys(countMap).map((code) => ({ code, count: countMap[code] }))
  if (sortBy === 'count') {
    // 数量降序；同数量保持套装顺序（用色栏"按数量"排序）
    return list.sort((a, b) => b.count - a.count || (order[a.code] || 0) - (order[b.code] || 0))
  }
  return list.sort((a, b) => (order[a.code] || 0) - (order[b.code] || 0))
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
 * 序列化网格：按行优先用逗号连接为字符串（如 "A1,B1,C1,..."），用于图库云端存储。
 * 方形网格维度由 size 字段决定，无需在字符串中携带行分隔。
 */
/**
 * 序列化背景网格掩码：按行优先用 '1'/'0' 拼接（104 盘约 10.8KB，52 盘约 2.7KB），
 * 用于图库云存储，使展示/编辑/导出能还原生成时的洋红背景判定。
 */
function serializeBgMask(mask) {
  if (!mask || !mask.length) return ''
  return mask.map((row) => row.map((v) => (v ? '1' : '0')).join('')).join('')
}

/**
 * 解析背景网格掩码；长度不符或缺失时返回 null（旧数据回退白色连通域判定）。
 */
function parseBgMask(str, size) {
  const n = Number(size) || 0
  if (!n || typeof str !== 'string' || str.length !== n * n) return null
  const mask = []
  for (let r = 0; r < n; r++) {
    const row = []
    for (let c = 0; c < n; c++) row.push(str.charAt(r * n + c) === '1')
    mask.push(row)
  }
  return mask
}

function serializeGrid(grid) {
  if (!grid || !grid.length) return ''
  return grid.map((row) => row.join(',')).join(',')
}

/**
 * 解析序列化网格：按 size×size 重塑二维数组。size 非法或串长度不符时抛错。
 */
function parseGrid(str, size) {
  const codes = str ? String(str).split(',') : []
  const n = Number(size) || 0
  if (!n || codes.length !== n * n) throw new Error('图纸数据不完整')
  const grid = []
  for (let r = 0; r < n; r++) {
    grid.push(codes.slice(r * n, (r + 1) * n))
  }
  return grid
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
 * 合并背景掩码与用户编辑掩码：用户编辑过的格子一律视为前景（即使涂回白色 H1），
 * 让"往背景涂白色"也能正常显示色号；未编辑的格子沿用原背景判定。
 */
function applyEditedMask(baseMask, editedMask) {
  return baseMask.map((row, r) => row.map((v, c) => v && !(editedMask && editedMask[r] && editedMask[r][c])))
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

/**
 * 颜色减淡：把 hex 向白色按 ratio（0~1）混合，用于"智能拼豆"模式弱化非选中色。
 */
function mixWhite(hex, ratio) {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  const f = (c) => Math.round(c + (255 - c) * ratio)
  const to = (c) => ('0' + Math.max(0, Math.min(255, c)).toString(16)).slice(-2).toUpperCase()
  return '#' + to(f(r)) + to(f(g)) + to(f(b))
}

/**
 * 单格强调决策（纯函数，可在 Node 中测试）：
 * - spot（智能拼豆）：选中色描边+强制色号，其余色减淡隐号；背景格随减淡（白色不变）
 * - build（一键跟拼）：已点亮色按普通规则，当前色描边+强制色号，未点亮格画成白色空格
 * 返回 null 表示按普通规则绘制。
 */
function cellEmphasis(code, em, isBg) {
  if (!em) return null
  if (em.mode === 'spot') {
    if (!em.code) return null
    if (isBg) return { dim: true }
    return code === em.code ? { outline: true } : { dim: true }
  }
  if (em.mode === 'build') {
    if (isBg) return null
    if (em.doneSet && em.doneSet.has(code)) return null
    if (code === em.code) return { outline: true }
    return { empty: true }
  }
  return null
}

/**
 * 渲染入口统一规范化 emphasis：build 模式把 doneCodes 数组转成 Set（避免每格重建）。
 */
function normalizeEmphasis(emphasis) {
  if (!emphasis || emphasis.mode !== 'build' || emphasis.doneSet) return emphasis || null
  return Object.assign({}, emphasis, { doneSet: new Set(emphasis.doneCodes || []) })
}

function drawCell(ctx, grid, r, c, palette, opts) {
  const cellSize = (opts && opts.cellSize) || CELL
  const gap = (opts && opts.gap) || GAP
  const showCodeOpt = opts && opts.code !== false
  const noCode = opts && opts.noCode // 白色背景格不显示编号
  const highlight = opts && opts.highlight
  const code = grid[r][c]
  const em = cellEmphasis(code, opts && opts.emphasis, noCode)
  // 背景格（noCode）统一填纯白：近白灰格若用自身色号会既无编号又非白色；
  // 非背景格仍用色号对应的颜色
  let hex = noCode ? '#ffffff' : cellItem(palette, code).hex
  let showCode = showCodeOpt && !noCode
  let outline = false
  let emptySlot = false
  if (em) {
    if (em.outline) {
      showCode = true
      outline = true
    } else if (em.dim) {
      hex = mixWhite(hex, 0.8)
      showCode = false
    } else if (em.empty) {
      hex = '#ffffff'
      showCode = false
      emptySlot = true
    }
  }
  const x = c * (cellSize + gap)
  const y = r * (cellSize + gap)
  ctx.fillStyle = hex
  ctx.fillRect(x, y, cellSize, cellSize)
  if (noCode) {
    // 背景格：不显示编号，但画浅灰格子线，保证白色区域能看到格子
    ctx.strokeStyle = BG_GRID_COLOR
    ctx.lineWidth = 1
    ctx.strokeRect(x + 0.5, y + 0.5, cellSize - 1, cellSize - 1)
  } else if (emptySlot) {
    // 一键跟拼：未点亮格画浅灰空格线，呈现"空板待拼"观感
    ctx.strokeStyle = BG_GRID_COLOR
    ctx.lineWidth = 1
    ctx.strokeRect(x + 0.5, y + 0.5, cellSize - 1, cellSize - 1)
  } else if (showCode) {
    ctx.fillStyle = luminance(hex) > 150 ? '#12171b' : '#ffffff'
    ctx.font = '600 ' + Math.max(4, Math.round(cellSize * 0.45)) + 'px sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(code, x + cellSize / 2, y + cellSize / 2 + 0.5)
  }
  if (highlight || outline) {
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
  const emphasis = normalizeEmphasis(opts && opts.emphasis)
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
        highlight: !!(highlight && highlight.row === r && highlight.col === c),
        emphasis
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
 * 可视格子范围：根据当前 view 变换与画布尺寸，返回屏幕上可见的格子行列区间（闭区间）。
 * 视口完全在图纸外时 c1 < c0 或 r1 < r0，表示没有可见格子。
 */
function visibleRange(view, size, cellPx, gap, areaW, areaH) {
  if (!view || !view.scale || !size || !cellPx) return { c0: 0, c1: -1, r0: 0, r1: -1 }
  const cell = cellPx + gap
  const c0 = Math.max(0, Math.floor((0 - view.ox) / view.scale / cell))
  const c1 = Math.min(size - 1, Math.floor((areaW - view.ox) / view.scale / cell))
  const r0 = Math.max(0, Math.floor((0 - view.oy) / view.scale / cell))
  const r1 = Math.min(size - 1, Math.floor((areaH - view.oy) / view.scale / cell))
  return { c0, c1, r0, r1 }
}

/**
 * 交互页可视区直绘：只画屏幕上可见的格子（放大时可见格数远小于整盘），
 * 仍是矢量逐格绘制，任意缩放不糊。白底与粗网格线同样只画可见部分。
 * 与 renderGrid 共用 drawCell，视觉一致；需在调用方已设置好 view 变换后调用。
 */
function renderGridView(ctx, grid, palette, opts) {
  const cellSize = (opts && opts.cellSize) || CELL
  const gap = (opts && opts.gap) || GAP
  const showCode = opts && opts.code !== false
  const highlight = opts && opts.highlight
  const gridEvery = opts && opts.gridEvery
  const noCodeMask = opts && opts.noCodeMask
  const emphasis = normalizeEmphasis(opts && opts.emphasis)
  const v = opts && opts.view
  const areaW = (opts && opts.areaW) || 0
  const areaH = (opts && opts.areaH) || 0
  const dpr = (opts && opts.dpr) || 1
  const size = grid.length
  if (!v || !v.scale || !size || !areaW || !areaH) return 0
  const total = size * (cellSize + gap) - gap
  const range = visibleRange(v, size, cellSize, gap, areaW, areaH)
  // 屏幕空间白底：只覆盖可视区域与网格世界的交集，避免 canvas 透明底色透出
  ctx.save()
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  const sx0 = Math.max(0, v.ox)
  const sy0 = Math.max(0, v.oy)
  const sx1 = Math.min(areaW, v.ox + total * v.scale)
  const sy1 = Math.min(areaH, v.oy + total * v.scale)
  if (sx1 > sx0 && sy1 > sy0) {
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(sx0, sy0, sx1 - sx0, sy1 - sy0)
  }
  ctx.restore()
  // 逐格绘制（矢量，放大不糊）
  for (let r = range.r0; r <= range.r1; r++) {
    for (let c = range.c0; c <= range.c1; c++) {
      drawCell(ctx, grid, r, c, palette, {
        cellSize,
        gap,
        code: showCode,
        noCode: !!(noCodeMask && noCodeMask[r] && noCodeMask[r][c]),
        highlight: !!(highlight && highlight.row === r && highlight.col === c),
        emphasis
      })
    }
  }
  // 粗网格线：只画可见范围内的分段
  if (gridEvery > 0 && range.r0 <= range.r1 && range.c0 <= range.c1) {
    const y0w = Math.max(0, (sy0 - v.oy) / v.scale)
    const y1w = Math.min(total, (sy1 - v.oy) / v.scale)
    const x0w = Math.max(0, (sx0 - v.ox) / v.scale)
    const x1w = Math.min(total, (sx1 - v.ox) / v.scale)
    ctx.strokeStyle = (opts && opts.gridColor) || GRID_LINE_COLOR
    ctx.lineWidth = (opts && opts.gridLineWidth) || GRID_LINE_WIDTH
    ctx.beginPath()
    for (let c = Math.max(gridEvery, Math.ceil(range.c0 / gridEvery) * gridEvery); c <= range.c1; c += gridEvery) {
      const x = c * (cellSize + gap) - gap / 2
      ctx.moveTo(x, y0w)
      ctx.lineTo(x, y1w)
    }
    for (let r = Math.max(gridEvery, Math.ceil(range.r0 / gridEvery) * gridEvery); r <= range.r1; r += gridEvery) {
      const y = r * (cellSize + gap) - gap / 2
      ctx.moveTo(x0w, y)
      ctx.lineTo(x1w, y)
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


/**
 * 绘制四周排号/列号（导出图）：上/下为列号 1..size，左/右为行号 1..size。
 * 灰色坐标格与主网格同尺寸、逐格带边框，像图纸的一部分（参考拼豆图纸样式）。
 */
function renderCoordinates(ctx, size, cellSize, gap, coord, opts) {
  const color = (opts && opts.color) || RULER_TEXT
  const line = (opts && opts.line) || RULER_LINE
  const bg = (opts && opts.bg) || RULER_BG
  const weight = (opts && opts.weight) || '400'
  const font = (opts && opts.font) || Math.max(8, Math.min(14, Math.round(cellSize * 0.55)))
  const step = cellSize + gap
  const gridTotal = size * step - gap
  const totalW = gridTotal + coord * 2
  // 四周灰色坐标条
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, totalW, coord)
  ctx.fillRect(0, coord + gridTotal, totalW, coord)
  ctx.fillRect(0, 0, coord, gridTotal + coord * 2)
  ctx.fillRect(coord + gridTotal, 0, coord, gridTotal + coord * 2)
  // 每个编号格与主网格对齐的边框
  ctx.strokeStyle = line
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let c = 0; c <= size; c++) {
    const x = coord + c * step + 0.5
    ctx.moveTo(x, 0)
    ctx.lineTo(x, coord)
    ctx.moveTo(x, coord + gridTotal)
    ctx.lineTo(x, coord + gridTotal + coord)
  }
  for (let r = 0; r <= size; r++) {
    const y = coord + r * step + 0.5
    ctx.moveTo(0, y)
    ctx.lineTo(coord, y)
    ctx.moveTo(coord + gridTotal, y)
    ctx.lineTo(coord + gridTotal + coord, y)
  }
  ctx.stroke()
  // 编号
  ctx.fillStyle = color
  ctx.font = weight + ' ' + font + 'px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  for (let c = 0; c < size; c++) {
    const x = coord + c * step + cellSize / 2
    ctx.fillText(String(c + 1), x, coord / 2)
    ctx.fillText(String(c + 1), x, coord + gridTotal + coord / 2)
  }
  for (let r = 0; r < size; r++) {
    const y = coord + r * step + cellSize / 2
    ctx.fillText(String(r + 1), coord / 2, y)
    ctx.fillText(String(r + 1), coord + gridTotal + coord / 2, y)
  }
}

/**
 * 坐标轴显示密度：可见格数越多间隔越大，保证每轴标签不超过 RULER_MAX_LABELS。
 */
function rulerStep(visibleCount) {
  const raw = Math.ceil((visibleCount || 1) / RULER_MAX_LABELS)
  for (const s of RULER_STEPS) if (s >= raw) return s
  return 500
}

/**
 * 在画布四周绘制固定坐标轴（屏幕空间，不随内容缩放/移动）。
 * 固定厚度的暖米色坐标条 + 1px 细边框，只标编号（密度自适应），无格框，缩放/拖动时视觉稳定。
 */
function renderRulers(ctx, view, size, cellPx, gap, areaW, areaH, dpr) {
  if (!view || !view.scale || !size || !cellPx) return
  const q = dpr || 1
  const cell = cellPx + gap
  const band = RULER_SIZE
  const c0 = Math.max(0, Math.floor((0 - view.ox) / view.scale / cell))
  const c1 = Math.min(size - 1, Math.floor((areaW - view.ox) / view.scale / cell))
  const r0 = Math.max(0, Math.floor((0 - view.oy) / view.scale / cell))
  const r1 = Math.min(size - 1, Math.floor((areaH - view.oy) / view.scale / cell))
  const cStep = rulerStep(c1 - c0 + 1)
  const rStep = rulerStep(r1 - r0 + 1)
  const show = (i, step) => i === 0 || (i + 1) % step === 0
  ctx.save()
  ctx.setTransform(q, 0, 0, q, 0, 0)
  // 四周暖米色坐标条（固定厚度）
  ctx.fillStyle = RULER_BG_VIEW
  ctx.fillRect(0, 0, areaW, band)
  ctx.fillRect(0, areaH - band, areaW, band)
  ctx.fillRect(0, 0, band, areaH)
  ctx.fillRect(areaW - band, 0, band, areaH)
  // 内容区边框：1px 暖灰细线，分隔坐标条与格子
  ctx.strokeStyle = RULER_LINE_VIEW
  ctx.lineWidth = 1
  ctx.strokeRect(band + 0.5, band + 0.5, areaW - band * 2 - 1, areaH - band * 2 - 1)
  // 编号（密度自适应，居中于对应格子；不做格框，缩放时更干净）
  ctx.fillStyle = RULER_TEXT
  ctx.font = '600 13px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  for (let c = c0; c <= c1; c++) {
    if (!show(c, cStep)) continue
    const x = view.ox + c * cell * view.scale + (cellPx * view.scale) / 2
    if (x < band || x > areaW - band) continue
    ctx.fillText(String(c + 1), x, band / 2)
    ctx.fillText(String(c + 1), x, areaH - band / 2)
  }
  for (let r = r0; r <= r1; r++) {
    if (!show(r, rStep)) continue
    const y = view.oy + r * cell * view.scale + (cellPx * view.scale) / 2
    if (y < band || y > areaH - band) continue
    ctx.fillText(String(r + 1), band / 2, y)
    ctx.fillText(String(r + 1), areaW - band / 2, y)
  }
  ctx.restore()
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
  const width = gridTotal + EXPORT_COORD * 2 // 四周坐标边距
  const items = (opts && opts.legendItems) || []
  return { width, height: gridTotal + EXPORT_COORD * 2 + legendHeight(items, width) }
}

/**
 * 整图导出：上方图纸（可带每 N 格粗网格线）+ 底部色号清单。调用方需先按 layoutExport 设置画布尺寸。
 * 返回布局尺寸 { width, height }。
 */
function renderExport(ctx, grid, palette, opts) {
  const cellSize = (opts && opts.cellSize) || EXPORT_CELL
  const gap = (opts && opts.gap) || 1
  const size = grid.length
  const gridTotal = size * (cellSize + gap) - gap
  const width = gridTotal + EXPORT_COORD * 2
  const baseH = gridTotal + EXPORT_COORD * 2
  // 边距区域铺白底（坐标区域不能透明）
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, baseH)
  ctx.save()
  ctx.translate(EXPORT_COORD, EXPORT_COORD)
  renderGrid(ctx, grid, palette, {
    cellSize,
    gap,
    code: opts && opts.code !== false,
    gridEvery: opts && opts.gridEvery,
    noCodeMask: opts && opts.noCodeMask
  })
  ctx.restore()
  renderCoordinates(ctx, size, cellSize, gap, EXPORT_COORD)
  let legendH = 0
  if (opts && opts.legendItems && opts.legendItems.length) {
    legendH = renderLegend(ctx, opts.legendItems, {
      width,
      size,
      y: baseH
    })
  }
  return { width, height: baseH + legendH }
}


// 去噪：把被 8 邻域完全相同的颜色包围的孤立单色格并入该颜色（消除 AI 分块/网格线/抖动产生的零星杂点）。
// 只处理完全孤立的单格，不破坏大块结构与五官主体；边缘格（邻域越界）不处理。
function despeckle(grid) {
  const n = grid.length
  if (!n) return grid
  const out = grid.map((row) => row.slice())
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const cur = out[r][c]
      let same = null
      let ok = true
      for (let dr = -1; dr <= 1 && ok; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (!dr && !dc) continue
          const rr = r + dr
          const cc = c + dc
          if (rr < 0 || cc < 0 || rr >= n || cc >= n) {
            ok = false
            break
          }
          const v = out[rr][cc]
          if (same === null) same = v
          else if (v !== same) {
            ok = false
            break
          }
        }
      }
      if (ok && same !== null && same !== cur) out[r][c] = same
    }
  }
  return out
}

/**
 * 统计前景格各色使用次数（跳过背景格）。
 * bgMask：true=背景格（不计、不改）。缺省为 null（全部视为前景）。
 */
function countForeground(grid, bgMask) {
  const map = {}
  const h = grid.length
  const w = h ? grid[0].length : 0
  let total = 0
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      if (bgMask && bgMask[r] && bgMask[r][c]) continue
      const code = grid[r][c]
      map[code] = (map[code] || 0) + 1
      total++
    }
  }
  return { map, total }
}

/**
 * 颜色精简（杂色合并）：把使用次数极少的颜色并入"已使用且达标"的最近色（CIELAB）。
 * 解决"大图某色只用了一两颗"导致颜色过多、穿插杂乱的问题，同时让杂点归入邻近主体色，
 * 形成更大的同色块，便于观察配色、滑豆快速完工。
 * opts：{ bgMask, minCount, minRatio }
 *  - minCount：绝对下限（默认 4），使用次数 <= 该值视为杂色
 *  - minRatio：相对下限（默认 0.0006），total * minRatio 向上取整后与 minCount 取大者
 * 原地修改 grid，返回 { removed, mapping }（removed=被并入格数，mapping=from→to 色号映射）。
 * 背景格不参与计数、不改动。
 */
function mergeRareColors(grid, palette, opts) {
  const h = grid.length
  const w = h ? grid[0].length : 0
  if (!h || !w || !palette || !palette.length) return { removed: 0, mapping: {} }
  const bgMask = (opts && opts.bgMask) || null
  const { map, total } = countForeground(grid, bgMask)
  const minCount = (opts && opts.minCount) || 4
  const minRatio = opts && opts.minRatio ? opts.minRatio : 0.0006
  const threshold = Math.max(minCount, Math.round(total * minRatio))
  const labByCode = {}
  for (const item of palette) labByCode[item.code] = item.lab
  const ordered = Object.keys(map)
    .map((code) => ({ code, count: map[code] }))
    .sort((a, b) => b.count - a.count)
  let anchors = ordered.filter((i) => i.count >= threshold).map((i) => i.code)
  if (!anchors.length) anchors = ordered.length ? [ordered[0].code] : []
  const mapping = {}
  for (const item of ordered) {
    if (anchors.indexOf(item.code) >= 0) continue
    const lab = labByCode[item.code]
    if (!lab) continue
    let bestCode = null
    let bestDist = Infinity
    for (const a of anchors) {
      const alab = labByCode[a]
      if (!alab) continue
      const d = color.labDistance(lab, alab)
      if (d < bestDist) {
        bestDist = d
        bestCode = a
      }
    }
    if (bestCode) mapping[item.code] = bestCode
  }
  let removed = 0
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      if (bgMask && bgMask[r] && bgMask[r][c]) continue
      const to = mapping[grid[r][c]]
      if (to) {
        grid[r][c] = to
        removed++
      }
    }
  }
  return { removed, mapping }
}

/**
 * 邻近色合并：把感知上非常接近（CIELAB 距离 < nearDeltaE）的颜色并入数量更多的一个，
 * 减少"同一区域被几种相近颜色反复穿插"、造成大面积铺色难以辨认的问题。
 * 仅合并可视为同一种豆的近色，不跨越明显色相/明度差异，避免破坏主体轮廓与五官关键细节。
 * opts：{ bgMask, nearDeltaE, maxColors }
 *  - nearDeltaE：CIELAB 距离阈值（默认 8）
 *  - maxColors：可选，最多保留色数；超出时逐步放宽阈值强制合并至达标
 * 原地修改 grid，返回 { changed }。
 */
function mergeNearColors(grid, palette, opts) {
  const h = grid.length
  const w = h ? grid[0].length : 0
  if (!h || !w || !palette || !palette.length) return { changed: false }
  const bgMask = (opts && opts.bgMask) || null
  const maxColors = (opts && opts.maxColors) || 0
  const baseDelta = (opts && opts.nearDeltaE) || 8
  const labByCode = {}
  for (const item of palette) labByCode[item.code] = item.lab
  let delta = baseDelta
  let changed = false
  // 单次最多合并 colorCount 种，避免极端情况下死循环
  for (let pass = 0; pass < 64; pass++) {
    const { map } = countForeground(grid, bgMask)
    const codes = Object.keys(map)
    if (codes.length <= 1) break
    if (maxColors && codes.length <= maxColors) break
    // 在当前距离上限内找最接近的一对（较少 → 较多）
    let best = null
    for (let i = 0; i < codes.length; i++) {
      for (let j = i + 1; j < codes.length; j++) {
        const a = codes[i]
        const b = codes[j]
        const la = labByCode[a]
        const lb = labByCode[b]
        if (!la || !lb) continue
        const d = color.labDistance(la, lb)
        if (d > delta) continue
        if (!best || d < best.d) best = { a, b }
      }
    }
    if (!best) {
      // 设置了 maxColors 且仍未达标：逐步放宽距离上限，强制合并近色
      if (maxColors && codes.length > maxColors && delta < 90) {
        delta += 8
        continue
      }
      break
    }
    const a = best.a
    const b = best.b
    const keeper = map[a] >= map[b] ? a : b
    const loser = keeper === a ? b : a
    if (replaceColor(grid, loser, keeper) > 0) changed = true
  }
  return { changed }
}

/**
 * 图纸后处理（生成后调用）：先把杂色并入邻近主体色，再把感知上接近的相邻颜色合并，
 * 最后做一次孤立杂点去噪。目标是"颜色总数更少、同色块更大"，同时保留主体轮廓与五官等关键细节。
 * 原地修改并返回 grid。opts 同 mergeRareColors / mergeNearColors（含 bgMask）。
 */
function postProcessGrid(grid, palette, opts) {
  const o = opts || {}
  mergeRareColors(grid, palette, o)
  mergeNearColors(grid, palette, o)
  return despeckle(grid)
}

module.exports = {
  mapRgbGrid,
  mapRgb,
  despeckle,
  countForeground,
  mergeRareColors,
  mergeNearColors,
  postProcessGrid,
  averageBlocks,
  countColors,
  countColor,
  replaceColor,
  serializeGrid,
  parseGrid,
  serializeBgMask,
  parseBgMask,
  displayCell,
  findWhiteishCodes,
  findBackgroundMask,
  applyEditedMask,
  renderGrid,
  renderGridView,
  visibleRange,
  renderLegend,
  renderExport,
  renderCoordinates,
  renderRulers,
  rulerStep,
  layoutExport,
  mixWhite,
  cellEmphasis,
  drawCell,
  EXPORT_COORD,
  CELL,
  GAP,
  EXPORT_CELL,
  EXPORT_MAX_DIM,
  RULER_SIZE,
  LEGEND_UNIT_W
}