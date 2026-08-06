// miniprogram/utils/export.js
/**
 * 图纸资产生成（展示页导出、图库保存、修改页保存共用）：
 * - renderPatternExport：整图导出（图纸 + 底部色号清单），输出分辨率 ×EXPORT_UPSCALE，
 *   画布始终不超过 EXPORT_MAX_DIM，规避部分设备 2048px 画布上限；
 * - renderGridJpeg：方形网格 JPEG（缩略图/预览图，不含色号）；
 * - renderSquareJpeg：原图 contain 缩放到方形 JPEG（白底补齐）。
 * 依赖 wx.createOffscreenCanvas，仅在小程序环境可用。
 */
const pattern = require('./pattern.js')
const image = require('./image.js')

const EXPORT_UPSCALE = 2 // 导出输出放大倍数（画布不变，destWidth/destHeight 放大，纯色块颜色保持精确）

function toTempFile(canvas, opts) {
  return new Promise((resolve, reject) => {
    wx.canvasToTempFilePath(Object.assign({}, opts, {
      canvas,
      success: (r) => resolve(r.tempFilePath),
      fail: reject
    }))
  })
}

/**
 * 整图导出：按 layoutExport 计算布局（≤EXPORT_MAX_DIM），绘制图纸 + 色号清单，
 * 输出 PNG 分辨率 = 画布 ×EXPORT_UPSCALE。opts：{ bgMask, gridEvery }。
 */
function renderPatternExport(grid, palette, opts) {
  const bgMask = opts && opts.bgMask
  const gridEvery = opts && opts.gridEvery
  const codes = palette.map((i) => i.code)
  const counts = pattern.countColors(grid, codes, bgMask)
  const hexByCode = {}
  palette.forEach((i) => { hexByCode[i.code] = i.hex })
  const legendItems = counts.map((i) => ({ code: i.code, count: i.count, hex: hexByCode[i.code] }))
  const layout = pattern.layoutExport(grid, { cellSize: pattern.EXPORT_CELL, gap: 1, legendItems })
  const scale = Math.min(1, pattern.EXPORT_MAX_DIM / Math.max(layout.width, layout.height))
  const width = Math.max(1, Math.round(layout.width * scale))
  const height = Math.max(1, Math.round(layout.height * scale))
  const canvas = wx.createOffscreenCanvas({ type: '2d', width, height })
  const ctx = canvas.getContext('2d')
  ctx.scale(scale, scale)
  pattern.renderExport(ctx, grid, palette, {
    cellSize: pattern.EXPORT_CELL,
    gap: 1,
    code: true,
    gridEvery: gridEvery || 0,
    legendItems,
    noCodeMask: bgMask
  })
  return toTempFile(canvas, {
    fileType: 'png',
    destWidth: width * EXPORT_UPSCALE,
    destHeight: height * EXPORT_UPSCALE
  })
}

/**
 * 方形网格 JPEG：px×px 白底画布，网格 contain 居中，不含色号。opts：{ bgMask }。
 */
function renderGridJpeg(grid, palette, px, opts) {
  const canvas = wx.createOffscreenCanvas({ type: '2d', width: px, height: px })
  const ctx = canvas.getContext('2d')
  const size = grid.length
  const cell = Math.max(2, Math.floor(px / size))
  const total = size * (cell + pattern.GAP) - pattern.GAP
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, px, px)
  ctx.translate(Math.floor((px - total) / 2), Math.floor((px - total) / 2))
  pattern.renderGrid(ctx, grid, palette, {
    cellSize: cell,
    gap: pattern.GAP,
    code: false,
    gridEvery: 0,
    noCodeMask: opts && opts.bgMask
  })
  return toTempFile(canvas, { fileType: 'jpg', quality: 0.8 })
}

/**
 * 原图 contain 缩放为 px×px 方形 JPEG（白底补齐，透明按白）。
 */
function renderSquareJpeg(src, px) {
  const canvas = wx.createOffscreenCanvas({ type: '2d', width: px, height: px })
  const ctx = canvas.getContext('2d')
  return image.loadImageOnce(canvas, src).then((img) => {
    const scale = Math.min(px / img.width, px / img.height)
    const dw = img.width * scale
    const dh = img.height * scale
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, px, px)
    ctx.drawImage(img, (px - dw) / 2, (px - dh) / 2, dw, dh)
    return toTempFile(canvas, { fileType: 'jpg', quality: 0.8 })
  })
}

module.exports = { EXPORT_UPSCALE, renderPatternExport, renderGridJpeg, renderSquareJpeg }
