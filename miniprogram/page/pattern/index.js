// miniprogram/page/pattern/index.js
const pattern = require('../../utils/pattern.js')
const color = require('../../utils/color.js')

const CODE_MIN_SCALE = 0.65 // 格子放大到该倍数以上才显示编号（默认铺满视图隐藏编号，避免乱码感）


Page({
  data: {
    set: '221',
    size: 52,
    mode: 'photo',
    style: '',
    legend: [],
    total: 0,
    canvasPx: 0,
    viewX: 0,
    viewY: 0,
    initScale: 0.3
  },

  onLoad() {
    const p = getApp().globalData.pattern
    if (!p || !p.grid) {
      wx.showToast({ title: '没有可预览的图纸', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 800)
      return
    }
    this.pattern = p
    this.palette = color.buildPalette(p.set)
    this.codeShown = false
    this.setData({ set: p.set, size: p.size, mode: p.mode || 'photo', style: p.style || '' })
  },

  onShow() {
    if (!this.pattern) return
    this.updateLegend()
    if (this.canvas) this.drawPattern()
  },

  onReady() {
    this.drawPattern()
  },

  updateLegend() {
    const p = this.pattern
    const counts = pattern.countColors(p.grid, this.palette.map((i) => i.code))
    const hexByCode = {}
    this.palette.forEach((i) => {
      hexByCode[i.code] = i.hex
    })
    const total = p.size * p.size
    this.setData({
      legend: counts.map((i) => ({ code: i.code, count: i.count, hex: hexByCode[i.code] })),
      total
    })
  },

  drawPattern() {
    const p = this.pattern
    this.createSelectorQuery()
      .select('#canvasArea')
      .boundingClientRect()
      .select('#patternCanvas')
      .fields({ node: true, size: true })
      .exec((res) => {
        if (!res || !res[1]) return
        const area = res[0]
        const canvas = res[1].node
        const total = p.size * (pattern.CELL + pattern.GAP) - pattern.GAP
        const areaW = (area && area.width) || 300
        const areaH = (area && area.height) || 300
        const initScale = Math.max(0.14, Math.min(1, Math.min(areaW, areaH) / total))
        this.setData({
          canvasPx: total,
          viewX: (areaW - total) / 2,
          viewY: (areaH - total) / 2,
          initScale: Number(initScale.toFixed(3))
        })
        canvas.width = total
        canvas.height = total
        const ctx = canvas.getContext('2d')
        pattern.renderGrid(ctx, p.grid, this.palette, {
          cellSize: pattern.CELL,
          gap: pattern.GAP,
          code: this.codeShown
        })
        this.canvas = canvas
      })
  },

  onScale(e) {
    const show = e.detail.scale >= CODE_MIN_SCALE
    if (show !== this.codeShown) {
      this.codeShown = show
      this.redraw()
    }
  },

  redraw() {
    const canvas = this.canvas
    if (!canvas) return
    const p = this.pattern
    const ctx = canvas.getContext('2d')
    pattern.renderGrid(ctx, p.grid, this.palette, {
      cellSize: pattern.CELL,
      gap: pattern.GAP,
      code: this.codeShown
    })
  },

  goEdit() {
    wx.navigateTo({ url: '/page/pattern-edit/index' })
  },

  exportImage() {
    const canvas = this.canvas
    const p = this.pattern
    if (!canvas) return
    wx.showLoading({ title: '导出中…', mask: true })
    const total = p.size * (pattern.EXPORT_CELL + 1) - 1
    canvas.width = total
    canvas.height = total
    const ctx = canvas.getContext('2d')
    pattern.renderGrid(ctx, p.grid, this.palette, {
      cellSize: pattern.EXPORT_CELL,
      gap: 1,
      code: true
    })
    wx.canvasToTempFilePath({
      canvas,
      success: (res) => {
        this.restoreDisplay(canvas)
        this.saveToAlbum(res.tempFilePath)
      },
      fail: () => {
        this.restoreDisplay(canvas)
        wx.hideLoading()
        wx.showToast({ title: '导出失败', icon: 'none' })
      }
    })
  },

  restoreDisplay(canvas) {
    const p = this.pattern
    const total = p.size * (pattern.CELL + pattern.GAP) - pattern.GAP
    canvas.width = total
    canvas.height = total
    const ctx = canvas.getContext('2d')
    pattern.renderGrid(ctx, p.grid, this.palette, {
      cellSize: pattern.CELL,
      gap: pattern.GAP,
      code: this.codeShown
    })
  },

  saveToAlbum(filePath) {
    wx.saveImageToPhotosAlbum({
      filePath,
      success: () => {
        wx.hideLoading()
        wx.showToast({ title: '已保存到相册', icon: 'success' })
      },
      fail: (err) => {
        wx.hideLoading()
        if (err.errMsg && err.errMsg.indexOf('auth deny') >= 0) {
          wx.showModal({
            title: '需要相册权限',
            content: '请在设置中开启"保存到相册"权限。',
            confirmText: '去设置',
            success: (r) => {
              if (r.confirm) wx.openSetting()
            }
          })
        } else {
          wx.showToast({ title: '保存失败', icon: 'none' })
        }
      }
    })
  }
})
