// miniprogram/utils/scan.js
/**
 * 图纸识别（扫描）纯逻辑：
 * - 网格只是屏幕上的对齐参考：用户缩放/拖动图片让色块对齐网格。
 * - 对齐后按“校准格宽”（一格 = 网格格边长 / 当前缩放）从网格原点扫遍整张图，识别所有色块。
 * - 背景判定：白格中心有黑色标（打印的色号）→ 真实白豆；无黑标 → 背景。
 * - 最终图纸：取“有颜色区域”长宽的最大值，生成正方形图纸（最终尺寸不靠用户指定）。
 * - 网格线检测：投影峰值法找图纸网格线的格宽/格高/原点，供“自动对齐”。
 * 纯函数，可在 Node 中测试；不调用任何 AI。
 */
const color = require('./color')

const TOP_BUCKET_RATIO = 0.35 // 主色桶占比下限，低于则退化为区域平均（渐变/纹理兜底）
const DEFAULT_CENTER_FRAC = 0.6 // 黑标检测只看格子中心区域（避开四边网格线）
const DEFAULT_DARK_LUM = 128 // “黑”的亮度阈值（纯黑标号 < 128）
const DEFAULT_SAT_MAX = 64 // 标号像素须低饱和（灰黑，R≈G≈B），彩色填充不算
const DEFAULT_LABEL_MIN_RATIO = 0.01 // 中心黑像素占比 ≥ 1% 视为“有标号”
const DEFAULT_WHITE_MIN = 225 // 白色系判定下限（RGB 三通道）
const DEFAULT_MAX_DIM = 512 // 网格线检测降采样最大边长
const DEFAULT_BAND_FRAC = 0.5 // 网格线检测只取图像中间区域（避开边缘/边距干扰）
const DEFAULT_MIN_LINES = 3 // 至少检测到这么多条网格线才算识别成功
const DEFAULT_LINE_MAX_W = 4 // 网格线在降采样图上的最大宽度（排除深色色块列）

/**
 * 单格采样：返回 { rgb, darkRatio }。
 * rgb = 区域主色（抗网格线/抗锯齿）；darkRatio = 格子中心区域黑像素占比（标号判定）。
 * 透明像素不计入；全透明返回白色。
 */
function sampleCell(imageData, x0, y0, w, h, opts) {
  const centerFrac = (opts && opts.centerFrac) || DEFAULT_CENTER_FRAC
  const darkLum = (opts && opts.darkLum) || DEFAULT_DARK_LUM
  const satMax = (opts && opts.satMax) || DEFAULT_SAT_MAX
  const data = imageData.data
  const iw = imageData.width
  const ih = imageData.height
  const sx = Math.max(0, Math.floor(x0))
  const sy = Math.max(0, Math.floor(y0))
  const x1 = Math.min(iw, Math.floor(x0 + w))
  const y1 = Math.min(ih, Math.floor(y0 + h))
  const cx0 = Math.floor(x0 + (w * (1 - centerFrac)) / 2)
  const cy0 = Math.floor(y0 + (h * (1 - centerFrac)) / 2)
  const cx1 = Math.floor(x0 + (w * (1 + centerFrac)) / 2)
  const cy1 = Math.floor(y0 + (h * (1 + centerFrac)) / 2)
  const buckets = new Map()
  let total = 0
  let centerTotal = 0
  let darkCount = 0
  for (let y = sy; y < y1; y++) {
    for (let x = sx; x < x1; x++) {
      const i = (y * iw + x) * 4
      if (data[i + 3] < 128) continue
      total++
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
      if (x >= cx0 && x < cx1 && y >= cy0 && y < cy1) {
        centerTotal++
        const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
        const mx = Math.max(data[i], data[i + 1], data[i + 2])
        const mn = Math.min(data[i], data[i + 1], data[i + 2])
        if (lum < darkLum && mx - mn <= satMax) darkCount++
      }
    }
  }
  let rgb
  if (total === 0) {
    rgb = [255, 255, 255]
  } else {
    let best = null
    for (const b of buckets.values()) if (!best || b.n > best.n) best = b
    if (best.n / total >= TOP_BUCKET_RATIO) {
      rgb = [Math.round(best.r / best.n), Math.round(best.g / best.n), Math.round(best.b / best.n)]
    } else {
      let sr = 0
      let sg = 0
      let sb = 0
      for (const b of buckets.values()) {
        sr += b.r
        sg += b.g
        sb += b.b
      }
      rgb = [Math.round(sr / total), Math.round(sg / total), Math.round(sb / total)]
    }
  }
  return { rgb, darkRatio: centerTotal ? darkCount / centerTotal : 0 }
}

/**
 * 按校准格宽从原点扫遍整张图：
 * 一格大小 = grid.cell / view.scale（图片像素），原点 = 网格 (0,0) 映射回图片的坐标。
 * 返回 { rgbGrid, darkGrid, rowStart, colStart }（rgbGrid/darkGrid 为 rows×cols）。
 */
function scanAtPitch(imageData, cellPx, originX, originY, opts) {
  const iw = imageData.width
  const ih = imageData.height
  const c0 = Math.floor(-originX / cellPx) || 0
  const c1 = Math.floor((iw - 1 - originX) / cellPx) || 0
  const r0 = Math.floor(-originY / cellPx) || 0
  const r1 = Math.floor((ih - 1 - originY) / cellPx) || 0
  const rows = r1 - r0 + 1
  const cols = c1 - c0 + 1
  const rgbGrid = []
  const darkGrid = []
  for (let r = 0; r < rows; r++) {
    const rowRgb = []
    const rowDark = []
    for (let c = 0; c < cols; c++) {
      const ix = originX + (c0 + c) * cellPx
      const iy = originY + (r0 + r) * cellPx
      const s = sampleCell(imageData, ix, iy, cellPx, cellPx, opts)
      rowRgb.push(s.rgb)
      rowDark.push(s.darkRatio)
    }
    rgbGrid.push(rowRgb)
    darkGrid.push(rowDark)
  }
  return { rgbGrid, darkGrid, rowStart: r0, colStart: c0 }
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

/**
 * 背景掩码：白色格（H1/H2 系）中心无黑色标 → 背景（true=置空）。
 * opts：{ autoBg }。autoBg=false → 全当白豆（全 false）。
 * 兜底：整张图没有任何格子检测到黑标（图不印色号）→ 全当白豆（全 false）。
 */
function buildBgMask(rgbGrid, darkGrid, opts) {
  const autoBg = !opts || opts.autoBg !== false
  const whiteMin = (opts && opts.whiteMin) || DEFAULT_WHITE_MIN
  const labelMinRatio = (opts && opts.labelMinRatio) || DEFAULT_LABEL_MIN_RATIO
  const rows = rgbGrid.length
  const cols = rows ? rgbGrid[0].length : 0
  const mask = []
  for (let r = 0; r < rows; r++) mask.push(new Array(cols).fill(false))
  if (!autoBg) return mask
  let maxDark = 0
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) maxDark = Math.max(maxDark, darkGrid[r][c] || 0)
  }
  if (maxDark < labelMinRatio) return mask
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const rgb = rgbGrid[r][c]
      const isWhite = rgb[0] >= whiteMin && rgb[1] >= whiteMin && rgb[2] >= whiteMin
      if (isWhite && (darkGrid[r][c] || 0) < labelMinRatio) mask[r][c] = true
    }
  }
  return mask
}

/**
 * 最终图纸：取“有颜色区域”（非背景）包围盒长宽的最大值，生成正方形图纸。
 * 彩色内容放在左上角，其余补背景（mask=true）；包围盒内的背景洞保留为空。
 * 全部为背景时返回 null。返回 { grid, bgMask, size }。
 */
function finalizePattern(rgbGrid, bgMask, setKey) {
  const rows = rgbGrid.length
  const cols = rows ? rgbGrid[0].length : 0
  if (!rows || !cols) return null
  let minR = rows
  let minC = cols
  let maxR = -1
  let maxC = -1
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (bgMask[r][c]) continue
      if (r < minR) minR = r
      if (r > maxR) maxR = r
      if (c < minC) minC = c
      if (c > maxC) maxC = c
    }
  }
  if (maxR < 0) return null
  const bh = maxR - minR + 1
  const bw = maxC - minC + 1
  const side = Math.max(bh, bw)
  const palette = color.buildPalette(setKey)
  const blank = color.nearestColor(255, 255, 255, palette).code
  const grid = []
  const mask = []
  for (let r = 0; r < side; r++) {
    grid.push(new Array(side).fill(blank))
    mask.push(new Array(side).fill(true))
  }
  for (let r = 0; r < bh; r++) {
    for (let c = 0; c < bw; c++) {
      const rgb = rgbGrid[minR + r][minC + c]
      grid[r][c] = color.nearestColor(rgb[0], rgb[1], rgb[2], palette).code
      mask[r][c] = bgMask[minR + r][minC + c]
    }
  }
  return { grid, bgMask: mask, size: side }
}

// ---- 网格线检测（投影峰值法，自动对齐用）----

// 降采样暗图：f×f 块内任一像素暗即记暗（max-pooling 保住细网格线）
function downscaleDarkMap(imageData, maxDim, darkLum) {
  const srcW = imageData.width
  const srcH = imageData.height
  const f = Math.max(1, Math.round(Math.max(srcW, srcH) / maxDim))
  const w = Math.max(1, Math.round(srcW / f))
  const h = Math.max(1, Math.round(srcH / f))
  const data = imageData.data
  const dark = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let any = 0
      for (let dy = 0; dy < f && !any; dy++) {
        const sy = y * f + dy
        if (sy >= srcH) continue
        for (let dx = 0; dx < f && !any; dx++) {
          const sx = x * f + dx
          if (sx >= srcW) continue
          const i = (sy * srcW + sx) * 4
          const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
          if (lum < darkLum) any = 1
        }
      }
      dark[y * w + x] = any
    }
  }
  return { dark, w, h, f }
}

function medianDiffs(sorted) {
  const diffs = []
  for (let i = 1; i < sorted.length; i++) diffs.push(sorted[i] - sorted[i - 1])
  if (!diffs.length) return 0
  diffs.sort((a, b) => a - b)
  const mid = Math.floor(diffs.length / 2)
  return diffs.length % 2 ? diffs[mid] : (diffs[mid - 1] + diffs[mid]) / 2
}

// 把候选线位置拟合成均匀晶格：pitch=中位间距，origin=最左侧落在晶格上的线
function fitLattice(centers, minLines) {
  centers = centers.slice().sort((a, b) => a - b)
  const pitch = medianDiffs(centers)
  if (pitch < 2) return null
  const tol = Math.max(1, pitch * 0.08)
  let best = null
  for (const c0 of centers) {
    const off = ((c0 % pitch) + pitch) % pitch
    let cnt = 0
    for (const c of centers) {
      const d = ((c - off) % pitch + pitch) % pitch
      if (Math.min(d, pitch - d) <= tol) cnt++
    }
    if (!best || cnt > best.cnt) best = { off, cnt }
  }
  if (!best || best.cnt < minLines) return null
  let origin = Infinity
  for (const c of centers) {
    const d = ((c - best.off) % pitch + pitch) % pitch
    if (Math.min(d, pitch - d) <= tol) origin = Math.min(origin, c)
  }
  if (origin === Infinity) return null
  return { pitch, origin }
}

function projectBands(dark, w, h, axis, bandFrac, lineMaxW, minLines) {
  const isX = axis === 'x' // 'x': 竖直线 → 列投影；'y': 水平线 → 行投影
  const len = isX ? w : h
  const span = isX ? h : w
  const b0 = Math.floor(span * (0.5 - bandFrac / 2))
  const b1 = Math.floor(span * (0.5 + bandFrac / 2))
  const score = new Array(len).fill(0)
  for (let s = b0; s < b1; s++) {
    for (let t = 0; t < len; t++) {
      score[t] += dark[isX ? s * w + t : t * w + s]
    }
  }
  const thresh = Math.max(1, (b1 - b0) * 0.35)
  const bands = []
  let start = -1
  for (let t = 0; t <= len; t++) {
    const hit = t < len && score[t] >= thresh
    if (hit && start < 0) start = t
    if (!hit && start >= 0) {
      if (t - start <= lineMaxW) bands.push((start + t - 1) / 2)
      start = -1
    }
  }
  if (bands.length < minLines) return null
  return fitLattice(bands, minLines)
}

/**
 * 第一条网格线左侧/上方区域是否“有内容”（非近白）：有 → 前面还藏着一列/一行，原点要再往前退一个格宽。
 * 解决“图纸最左列没有外框线时，检测到的第一条线其实是第 1/2 列的分隔线”导致的整体偏移一格。
 */
function contentRatioBefore(imageData, linePos, pitch, isX, bandFrac, whiteMin) {
  const iw = imageData.width
  const ih = imageData.height
  const data = imageData.data
  const x0 = isX ? Math.max(0, Math.floor(linePos - pitch)) : Math.floor(iw * (0.5 - bandFrac / 2))
  const x1 = isX ? Math.max(0, Math.floor(linePos - 1)) : Math.floor(iw * (0.5 + bandFrac / 2))
  const y0 = isX ? Math.floor(ih * (0.5 - bandFrac / 2)) : Math.max(0, Math.floor(linePos - pitch))
  const y1 = isX ? Math.floor(ih * (0.5 + bandFrac / 2)) : Math.max(0, Math.floor(linePos - 1))
  let total = 0
  let content = 0
  for (let y = Math.max(0, y0); y < y1; y++) {
    for (let x = Math.max(0, x0); x < x1; x++) {
      const i = (y * iw + x) * 4
      if (data[i + 3] < 128) continue
      total++
      if (data[i] < whiteMin || data[i + 1] < whiteMin || data[i + 2] < whiteMin) content++
    }
  }
  return total ? content / total : 0
}

/**
 * 网格线检测：返回 { ok:true, cellW, cellH, originX, originY }（图片像素）或 null。
 * 只分析图像中间区域（bandFrac），避免边缘/边距干扰；要求足够多的网格线。
 */
function detectGridLines(imageData, opts) {
  const maxDim = (opts && opts.maxDim) || DEFAULT_MAX_DIM
  const darkLum = (opts && opts.darkLum) || DEFAULT_DARK_LUM
  const bandFrac = (opts && opts.bandFrac) || DEFAULT_BAND_FRAC
  const minLines = (opts && opts.minLines) || DEFAULT_MIN_LINES
  const lineMaxW = (opts && opts.lineMaxW) || DEFAULT_LINE_MAX_W
  const { dark, w, h, f } = downscaleDarkMap(imageData, maxDim, darkLum)
  const colFit = projectBands(dark, w, h, 'x', bandFrac, lineMaxW, minLines)
  const rowFit = projectBands(dark, w, h, 'y', bandFrac, lineMaxW, minLines)
  if (!colFit || !rowFit) return null
  const Lx = colFit.origin * f
  const Ly = rowFit.origin * f
  const pitchX = colFit.pitch * f
  const pitchY = rowFit.pitch * f
  const whiteMin = (opts && opts.whiteMin) || DEFAULT_WHITE_MIN
  const beforeX = contentRatioBefore(imageData, Lx, pitchX, true, bandFrac, whiteMin) > 0.05
  const beforeY = contentRatioBefore(imageData, Ly, pitchY, false, bandFrac, whiteMin) > 0.05
  return {
    ok: true,
    cellW: pitchX,
    cellH: pitchY,
    originX: beforeX ? Lx - pitchX : Lx,
    originY: beforeY ? Ly - pitchY : Ly
  }
}

module.exports = {
  sampleCell,
  scanAtPitch,
  rgbGridToCodes,
  buildBgMask,
  finalizePattern,
  detectGridLines
}
