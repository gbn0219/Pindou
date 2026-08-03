// miniprogram/page/pattern/index.js
const pattern = require('../../utils/pattern.js')
const color = require('../../utils/color.js')

Page({
  data: {
    set: '221',
    size: 52,
    legend: [],
    total: 0
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
    this.setData({ set: p.set, size: p.size })
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
      .select('#patternCanvas')
      .fields({ node: true, size: true })
      .exec((res) => {
        if (!res || !res[0]) return
        const canvas = res[0].node
        const total = p.size * (pattern.CELL + pattern.GAP) - pattern.GAP
        canvas.width = total
        canvas.height = total
        const ctx = canvas.getContext('2d')
        pattern.renderGrid(ctx, p.grid, this.palette, {
          cellSize: pattern.CELL,
          gap: pattern.GAP,
          code: true
        })
        this.canvas = canvas
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
      code: true
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
