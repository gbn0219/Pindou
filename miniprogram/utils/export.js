// miniprogram/utils/export.js
/**
 * 图纸资产生成（展示页导出、图库保存、修改页保存共用）：
 * - renderPatternExport：整图导出（图纸 + 四周坐标 + 底部色号清单），输出分辨率 ×EXPORT_UPSCALE，
 *   画布优先按 4096 上限渲染（高清），个别设备失败自动回退 2048；
 * - renderPatternJpeg：图纸 JPEG（与导出图同一布局：含色号与图例，按宽度缩放，作图库缩略图/预览图）；
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

const EXPORT_MAX_DIM_HIGH = 4096 // 高清导出画布上限（iOS 真机超 4096 会静默失败，失败自动回退 2048）

/**
 * 整图导出：按 layoutExport 计算布局（≤maxDim），绘制图纸 + 四周坐标 + 色号清单，
 * 输出 PNG 分辨率 = 画布 ×EXPORT_UPSCALE。opts：{ bgMask, gridEvery }。
 */
async function renderPatternExportAt(grid, palette, opts, maxDim) {
  const bgMask = opts && opts.bgMask
  const gridEvery = opts && opts.gridEvery
  const codes = palette.map((i) => i.code)
  const counts = pattern.countColors(grid, codes, bgMask)
  const hexByCode = {}
  palette.forEach((i) => { hexByCode[i.code] = i.hex })
  const legendItems = counts.map((i) => ({ code: i.code, count: i.count, hex: hexByCode[i.code] }))
  const layout = pattern.layoutExport(grid, { cellSize: pattern.EXPORT_CELL, gap: 1, legendItems })
  const scale = Math.min(1, maxDim / Math.max(layout.width, layout.height))
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

function renderPatternExport(grid, palette, opts) {
  // 先按 4096 高清画布尝试；个别设备画布上限较低时自动回退 2048（原行为）
  return renderPatternExportAt(grid, palette, opts, EXPORT_MAX_DIM_HIGH)
    .catch(() => renderPatternExportAt(grid, palette, opts, pattern.EXPORT_MAX_DIM))
}

/**
 * 图纸缩略图/预览图：与导出图同一布局（含色号与底部色号清单），按 layoutExport 缩放至 px 宽，
 * 供图库列表与预览使用（图库第二张图应显示"图纸"而非纯色预览效果图）。opts：{ bgMask, gridEvery }。
 */
function renderPatternJpeg(grid, palette, px, opts) {
  const bgMask = opts && opts.bgMask
  const gridEvery = opts && opts.gridEvery
  const codes = palette.map((i) => i.code)
  const counts = pattern.countColors(grid, codes, bgMask)
  const hexByCode = {}
  palette.forEach((i) => { hexByCode[i.code] = i.hex })
  const legendItems = counts.map((i) => ({ code: i.code, count: i.count, hex: hexByCode[i.code] }))
  const layout = pattern.layoutExport(grid, { cellSize: pattern.EXPORT_CELL, gap: 1, legendItems })
  const scale = px / layout.width
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

module.exports = { EXPORT_UPSCALE, renderPatternExport, renderPatternJpeg, renderSquareJpeg }
