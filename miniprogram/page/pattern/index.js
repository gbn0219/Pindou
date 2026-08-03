// miniprogram/page/pattern/index.js
const pattern = require('../../utils/pattern.js')
const color = require('../../utils/color.js')

const CODE_MIN_SCALE = 0.65 // 格子放大到该倍数以上才显示编号（默认铺满视图隐藏编号，避免乱码感）

Page({
  data: {
    set: '221',
    size: 52,
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

  aiOptimize() {
    if (this.aiBusy) return
    wx.showModal({
      title: 'AI 优化图纸',
      content: '将当前图纸发送给云端 AI 优化（保留边界、平滑内部颜色），约需 20 秒并按次计费，继续吗？',
      confirmText: '开始优化',
      success: (r) => {
        if (!r.confirm) return
        this.aiBusy = true
        wx.showLoading({ title: 'AI 优化中…', mask: true })
        this.renderGridToBase64(this.pattern.grid)
          .then((imageBase64) =>
            wx.cloud.callFunction({ name: 'ai-optimize-pattern', data: { imageBase64 } })
          )
          .then((res) => {
            const out = res && res.result
            if (!out || !out.fileID) {
              throw new Error((out && out.error) || 'AI 优化失败')
            }
            return wx.cloud.downloadFile({ fileID: out.fileID })
          })
          .then((dl) => this.reprocess(dl.tempFilePath))
          .then((grid) => {
            this.pattern.grid = grid
            this.updateLegend()
            this.codeShown = false
            this.redraw()
            wx.hideLoading()
            wx.showToast({ title: 'AI 优化完成', icon: 'success' })
          })
          .catch((e) => {
            wx.hideLoading()
            console.error('aiOptimize error', e)
            wx.showModal({
              title: 'AI 优化失败',
              content:
                (e && e.message) || '请确认云函数 ai-optimize-pattern 已部署且配置了 DASHSCOPE_API_KEY',
              showCancel: false
            })
          })
          .then(() => {
            this.aiBusy = false
          })
      }
    })
  },

  renderGridToBase64(grid) {
    return new Promise((resolve, reject) => {
      try {
        const size = grid.length
        const cell = 10
        const px = size * cell
        const canvas = wx.createOffscreenCanvas({ type: '2d', width: px, height: px })
        const ctx = canvas.getContext('2d')
        pattern.renderGrid(ctx, grid, this.palette, { cellSize: cell, gap: 0, code: false })
        wx.canvasToTempFilePath({
          canvas,
          fileType: 'png',
          success: (res) => {
            const fs = wx.getFileSystemManager()
            fs.readFile({
              filePath: res.tempFilePath,
              encoding: 'base64',
              success: (r) => resolve('data:image/png;base64,' + r.data),
              fail: reject
            })
          },
          fail: reject
        })
      } catch (e) {
        reject(e)
      }
    })
  },

  reprocess(src) {
    return new Promise((resolve, reject) => {
      const p = this.pattern
      const size = p.size
      const size4 = size * 4
      try {
        const canvas = wx.createOffscreenCanvas({ type: '2d', width: size4, height: size4 })
        const ctx = canvas.getContext('2d')
        const img = canvas.createImage()
        img.onload = () => {
          try {
            const scale = Math.min(size4 / img.width, size4 / img.height)
            const dw = img.width * scale
            const dh = img.height * scale
            ctx.fillStyle = '#ffffff'
            ctx.fillRect(0, 0, size4, size4)
            ctx.drawImage(img, (size4 - dw) / 2, (size4 - dh) / 2, dw, dh)
            const imageData = ctx.getImageData(0, 0, size4, size4)
            const rgbArr = pattern.dominantBlocks(imageData.data, size4, size, 4, this.palette)
            let grid = pattern.mapRgb(rgbArr, size, this.palette)
            grid = pattern.mergeGrid(grid, this.palette, 12)
            grid = pattern.denoiseGrid(grid)
            resolve(grid)
          } catch (e) {
            reject(e)
          }
        }
        img.onerror = () => reject(new Error('结果图片加载失败'))
        img.src = src
      } catch (e) {
        reject(e)
      }
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
