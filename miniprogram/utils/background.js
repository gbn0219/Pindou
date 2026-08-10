// miniprogram/utils/background.js
/**
 * 生成图纸背景清洗（纯函数，可在 Node 中测试）。
 * 作用于 RGBA ImageData（由小程序 canvas 解码，格式无关），在分块映射之前调用。
 *
 * 两种背景来源：
 * 1. cleanImageData：从四边 flood fill "近白"（RGB 均 >= whiteMin）→ 背景掩码；
 *    用于非抠图模式，以及抠图模式未检测到标记色时的回退。
 * 2. cleanMarkerBackground：抠图模式下，按提示词把背景统一涂成纯洋红 #FF00FF 标记色，
 *    逐像素通道判据（R>=200 且 B>=200 且 G<=80，色卡中无任何颜色满足）识别背景 → 掩码；
 *    覆盖率不足时返回 null，由调用方回退近白清洗。该方案不依赖"背景从四边连通"，
 *    即使主体轮廓不闭合、背景被切成孤立块也能正确识别。
 *
 * 共同后处理：与背景相邻的柔和浅色并入背景（吸收边缘渐变，两轮）、
 * 背景内孤立噪点并入背景（浅色低饱和的小连通分量）、背景像素置纯白 (255,255,255)。
 */

function buildMask(imageData, opts, isSeed, isFill) {
  const data = imageData.data
  const w = imageData.width
  const h = imageData.height
  if (!w || !h || !data) return null
  const n = w * h
  const bg = new Uint8Array(n) // 1 = 背景
  const queue = []
  let count = 0
  for (let i = 0; i < n; i++) {
    if (isSeed(i)) {
      bg[i] = 1
      count++
      queue.push(i)
    }
  }
  if (!count) return { bg, count }
  // 种子 flood fill（8 邻域）：近白种子模式沿近白像素扩散；标记色种子模式所有标记像素已是种子，扩散为空操作
  while (queue.length) {
    const idx = queue.pop()
    const x = idx % w
    const y = (idx - x) / w
    const tryPush = (nidx) => {
      if (bg[nidx] || !isFill(nidx)) return
      bg[nidx] = 1
      queue.push(nidx)
    }
    if (x > 0) tryPush(idx - 1)
    if (x < w - 1) tryPush(idx + 1)
    if (y > 0) tryPush(idx - w)
    if (y < h - 1) tryPush(idx + w)
    if (x > 0 && y > 0) tryPush(idx - w - 1)
    if (x < w - 1 && y > 0) tryPush(idx - w + 1)
    if (x > 0 && y < h - 1) tryPush(idx + w - 1)
    if (x < w - 1 && y < h - 1) tryPush(idx + w + 1)
  }
  // 背景柔化：与背景 4 邻域相邻的柔和浅色并入背景（两轮）
  const softMin = (opts && opts.softMin) || 215
  const isSoft = (i) => data[i] >= softMin && data[i + 1] >= softMin && data[i + 2] >= softMin
  for (let pass = 0; pass < 2; pass++) {
    const adds = []
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = y * w + x
        if (bg[idx] || !isSoft(idx * 4)) continue
        if (
          (x > 0 && bg[idx - 1]) ||
          (x < w - 1 && bg[idx + 1]) ||
          (y > 0 && bg[idx - w]) ||
          (y < h - 1 && bg[idx + w])
        ) {
          adds.push(idx)
        }
      }
    }
    for (const idx of adds) bg[idx] = 1
  }
  // 背景内孤立噪点：面积 <= noiseMax 的分量 → 并入背景。
  // 默认仅吸收"浅色低饱和"（近白噪声特征）的分量，彩色/深色的小内容（如图标、细节）保留；
  // 标记色模式（noiseAny=true）下背景区域是显式洋红标记，漂浮在其中的孤立彩色碎块一律视为生成噪点，
  // 无论颜色都并入背景，避免人物周围出现不属于主体的孤立像素块。
  const noiseMax = (opts && opts.noiseMax) || 64
  const noiseAny = !!(opts && opts.noiseAny)
  const seen = new Uint8Array(n)
  const subject = new Uint8Array(n) // 大分量（主体）像素
  const lightNoise = (idx) => {
    const i = idx * 4
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]
    const mx = Math.max(r, g, b)
    const mn = Math.min(r, g, b)
    return mx - mn <= 48 && mn >= 170
  }
  // 第一遍：完整遍历所有非背景分量（不再因超过 noiseMax 提前断开而碎片化），
  // 大于 noiseMax 的分量视为主体；小分量记录起点，留待第二遍判断。
  const smallStarts = []
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x
      if (bg[idx] || seen[idx]) continue
      const comp = []
      const q = [idx]
      seen[idx] = 1
      while (q.length) {
        const cur = q.pop()
        comp.push(cur)
        const cx = cur % w
        const cy = (cur - cx) / w
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue
            const nx = cx + dx
            const ny = cy + dy
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
            const nidx = ny * w + nx
            if (bg[nidx] || seen[nidx]) continue
            seen[nidx] = 1
            q.push(nidx)
          }
        }
      }
      if (comp.length > noiseMax) {
        for (const ci of comp) subject[ci] = 1
      } else {
        smallStarts.push(idx)
      }
    }
  }
  // 第二遍：只吸收不挨着主体大块的孤立小分量。
  // 标记色模式（noiseAny）下 AI 人物头顶/边缘常是细碎小分量，无条件吸收会把发丝边缘当噪点清掉（头顶缺一块）；
  // 非标记色模式保持原语义（仅浅色低饱和），且第一遍已整块遍历，大分量不会再被碎片化吸收。
  const touchesSubject = (comp) => {
    for (const ci of comp) {
      const cx = ci % w
      const cy = (ci - cx) / w
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue
          const nx = cx + dx
          const ny = cy + dy
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
          if (subject[ny * w + nx]) return true
        }
      }
    }
    return false
  }
  const seen2 = new Uint8Array(n)
  for (const start of smallStarts) {
    if (seen2[start]) continue
    const comp = []
    const q = [start]
    seen2[start] = 1
    let noise = true
    while (q.length) {
      const cur = q.pop()
      comp.push(cur)
      if (!lightNoise(cur)) noise = false
      const cx = cur % w
      const cy = (cur - cx) / w
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue
          const nx = cx + dx
          const ny = cy + dy
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
          const nidx = ny * w + nx
          if (bg[nidx] || seen2[nidx] || subject[nidx]) continue
          seen2[nidx] = 1
          q.push(nidx)
        }
      }
    }
    if ((noise || noiseAny) && (!noiseAny || !touchesSubject(comp))) {
      for (const ci of comp) bg[ci] = 1
    }
  }
  return { bg, count }
}

function whitenBackground(imageData, bg) {
  const data = imageData.data
  for (let idx = 0; idx < bg.length; idx++) {
    if (bg[idx]) {
      const i = idx * 4
      data[i] = 255
      data[i + 1] = 255
      data[i + 2] = 255
    }
  }
}

/**
 * 原地清洗 imageData.data（RGBA）。imageData: { data, width, height }。
 * 非抠图模式：四边近白 flood fill → 柔化 → 孤立噪点 → 纯白。
 * @param {object} imageData
 * @param {object} [opts] { whiteMin, softMin, noiseMax }
 */
function cleanImageData(imageData, opts) {
  const w = imageData.width
  const h = imageData.height
  const data = imageData.data
  if (!w || !h || !data) return
  const whiteMin = (opts && opts.whiteMin) || 230
  const isNear = (i) => data[i] >= whiteMin && data[i + 1] >= whiteMin && data[i + 2] >= whiteMin
  const isSeed = (idx) => {
    if (!isNear(idx * 4)) return false
    const x = idx % w
    const y = (idx - x) / w
    return x === 0 || y === 0 || x === w - 1 || y === h - 1
  }
  const isNearPx = (idx) => isNear(idx * 4) // buildMask 的 isFill 统一按像素索引
  const r = buildMask(imageData, opts, isSeed, isNearPx)
  whitenBackground(imageData, r.bg)
}

/**
 * 边框主色：取图像四边一圈像素中出现最多的量化颜色桶均值。
 * 抠图模式下边框几乎全是背景，用该颜色识别模型实际画出的背景色（可能是纯洋红，也可能是偏粉/玫红的"洋红"）。
 */
function dominantBorderColor(imageData) {
  const data = imageData.data
  const w = imageData.width
  const h = imageData.height
  if (!w || !h || !data) return null
  const buckets = new Map()
  const visit = (x, y) => {
    const i = (y * w + x) * 4
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
  }
  for (let x = 0; x < w; x++) {
    visit(x, 0)
    visit(x, h - 1)
  }
  for (let y = 1; y < h - 1; y++) {
    visit(0, y)
    visit(w - 1, y)
  }
  let best = null
  for (const b of buckets.values()) {
    if (!best || b.n > best.n) best = b
  }
  if (!best) return null
  return [Math.round(best.r / best.n), Math.round(best.g / best.n), Math.round(best.b / best.n)]
}

/**
 * 洋红色系判定：红偏亮（R>=180）、明显偏品红/粉（R-G>=40）且蓝不小于绿（B>=G+10）。
 * 覆盖纯洋红、玫红、粉红等模型常画的"洋红变体"，排除肤色、白色、灰色、红/蓝等主体常见色。
 */
function isMagentaFamily(c) {
  return c[0] >= 180 && c[0] - c[1] >= 40 && c[2] >= c[1] + 10
}

/**
 * 抠图模式：洋红标记色背景识别（不依赖四边连通）。
 * 逐像素判据 R>=200 且 B>=200 且 G<=80（纯洋红）→ 标记像素即背景；
 * 同时若边框主色属于洋红色系（模型把洋红画成偏粉/玫红时），按该颜色容差匹配，
 * 把实际背景色一并识别为背景，避免映射成色卡上的粉色（如 E6）。
 * 标记像素占比 < minCoverage 时视为模型未按指令涂标记色，返回 null（调用方回退 cleanImageData）。
 * @returns {Uint8Array|null} 像素级背景掩码（1=背景），供分块时把背景格强制映射为白色
 */
function cleanMarkerBackground(imageData, opts) {
  const w = imageData.width
  const h = imageData.height
  const data = imageData.data
  if (!w || !h || !data) return null
  const minCoverage = (opts && opts.minCoverage) || 0.01
  const tolerance = (opts && opts.tolerance) || 55
  const borderColor = dominantBorderColor(imageData)
  const useBorder = borderColor ? isMagentaFamily(borderColor) : false
  const isMarker = (idx) => {
    const i = idx * 4
    return data[i] >= 200 && data[i + 2] >= 200 && data[i + 1] <= 80
  }
  const isBgColor = (idx) => {
    if (!useBorder) return false
    const i = idx * 4
    const dr = data[i] - borderColor[0]
    const dg = data[i + 1] - borderColor[1]
    const db = data[i + 2] - borderColor[2]
    return dr * dr + dg * dg + db * db <= tolerance * tolerance
  }
  // 标记色即背景：漂浮在背景中的孤立小分量（无论颜色）都并入背景；
  // noiseMax 由调用方按盘面格子面积估算（约 2 格），默认 64 兜底
  const isSeed = (idx) => isMarker(idx) || isBgColor(idx)
  const r = buildMask(imageData, Object.assign({}, opts, { noiseAny: true }), isSeed, isSeed)
  if (r.count / (w * h) < minCoverage) return null
  whitenBackground(imageData, r.bg)
  return r.bg
}

module.exports = { cleanImageData, cleanMarkerBackground }
