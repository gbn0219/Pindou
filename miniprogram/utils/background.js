// miniprogram/utils/background.js
/**
 * AI 图纸背景近白噪声清洗（纯函数，可在 Node 中测试）。
 * 作用于 RGBA ImageData（由小程序 canvas 解码，格式无关），在分块映射之前调用。
 *
 * 目标：把背景中的"接近白色但不是白色"（轻微渐变、浅灰噪点、AI 残留辅助线等）
 * 处理成纯白，同时不影响正常内容（主体及其内部细节）。
 *
 * 算法：
 * 1. 从四边 flood fill（8 邻域）"近白"像素（RGB 均 >= whiteMin）→ 背景掩码；
 * 2. 背景柔化：与背景相邻的"柔和浅色"（RGB 均 >= softMin）并入背景（吸收边缘渐变，两轮）；
 * 3. 背景内噪声：非背景像素的 8 邻域连通分量，若面积 <= noiseMax（即没有连到主体），
 *    视为背景内孤立噪点，并入背景（主体是大型连通分量，天然不受影响）；
 * 4. 背景像素置为纯白 (255,255,255)。
 */

/**
 * 原地清洗 imageData.data（RGBA）。imageData: { data, width, height }。
 * @param {object} imageData
 * @param {object} [opts] { whiteMin, softMin, noiseMax }
 */
function cleanImageData(imageData, opts) {
  const data = imageData.data
  const w = imageData.width
  const h = imageData.height
  if (!w || !h || !data) return
  const whiteMin = (opts && opts.whiteMin) || 230
  const softMin = (opts && opts.softMin) || 215
  const noiseMax = (opts && opts.noiseMax) || 64
  const n = w * h
  const bg = new Uint8Array(n) // 1 = 背景

  const isNear = (i) => data[i] >= whiteMin && data[i + 1] >= whiteMin && data[i + 2] >= whiteMin
  const isSoft = (i) => data[i] >= softMin && data[i + 1] >= softMin && data[i + 2] >= softMin

  // 1) 四边 flood fill
  const queue = []
  const visit = (idx) => {
    if (bg[idx]) return
    if (!isNear(idx * 4)) return
    bg[idx] = 1
    queue.push(idx)
  }
  for (let x = 0; x < w; x++) {
    visit(x)
    visit((h - 1) * w + x)
  }
  for (let y = 0; y < h; y++) {
    visit(y * w)
    visit(y * w + w - 1)
  }
  while (queue.length) {
    const idx = queue.pop()
    const x = idx % w
    const y = (idx - x) / w
    if (x > 0) visit(idx - 1)
    if (x < w - 1) visit(idx + 1)
    if (y > 0) visit(idx - w)
    if (y < h - 1) visit(idx + w)
    if (x > 0 && y > 0) visit(idx - w - 1)
    if (x < w - 1 && y > 0) visit(idx - w + 1)
    if (x > 0 && y < h - 1) visit(idx + w - 1)
    if (x < w - 1 && y < h - 1) visit(idx + w + 1)
  }

  // 2) 背景柔化：与背景 4 邻域相邻的柔和浅色并入背景（两轮）
  for (let pass = 0; pass < 2; pass++) {
    const adds = []
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = y * w + x
        if (bg[idx]) continue
        if (!isSoft(idx * 4)) continue
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

  // 3) 背景内孤立噪点：面积 <= noiseMax 且为"浅色低饱和"（近白噪声特征）的分量 → 并入背景。
  //    彩色/深色的小内容（如图标、细节）保留，避免误删正常内容。
  const seen = new Uint8Array(n)
  const lightNoise = (idx) => {
    const i = idx * 4
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]
    const mx = Math.max(r, g, b)
    const mn = Math.min(r, g, b)
    return mx - mn <= 48 && mn >= 170
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x
      if (bg[idx] || seen[idx]) continue
      const comp = []
      const q = [idx]
      seen[idx] = 1
      let small = true
      let noise = true
      while (q.length) {
        const cur = q.pop()
        comp.push(cur)
        if (comp.length > noiseMax) {
          small = false
          break
        }
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
            if (bg[nidx] || seen[nidx]) continue
            seen[nidx] = 1
            q.push(nidx)
          }
        }
      }
      if (small && noise) {
        for (const ci of comp) bg[ci] = 1
      }
    }
  }

  // 4) 背景置为纯白
  for (let idx = 0; idx < n; idx++) {
    if (bg[idx]) {
      const i = idx * 4
      data[i] = 255
      data[i + 1] = 255
      data[i + 2] = 255
    }
  }
}

module.exports = { cleanImageData }
