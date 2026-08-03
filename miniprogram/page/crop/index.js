// miniprogram/page/crop/index.js
Page({
  data: {
    sourcePath: '',
    imgW: 0,
    imgH: 0,
    frameW: 0,
    frameH: 0,
    frameX: 0,
    frameY: 0,
    wPct: 100,
    hPct: 100
  },

  onLoad() {
    const src = getApp().globalData.cropSource
    if (!src || !src.path) {
      wx.showToast({ title: '没有待裁剪的图片', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 800)
      return
    }
    this.source = src
    const sys = wx.getSystemInfoSync()
    const stageW = sys.windowWidth - 32
    const stageH = sys.windowHeight - 64 - 220
    const scale = Math.min(stageW / src.width, stageH / src.height, 1)
    const imgW = Math.max(40, Math.round(src.width * scale))
    const imgH = Math.max(40, Math.round(src.height * scale))
    this.setData({
      sourcePath: src.path,
      imgW,
      imgH,
      frameW: imgW,
      frameH: imgH,
      frameX: 0,
      frameY: 0
    })
  },

  onWChanging(e) {
    this.setSize('w', e.detail.value)
  },
  onWChange(e) {
    this.setSize('w', e.detail.value)
  },
  onHChanging(e) {
    this.setSize('h', e.detail.value)
  },
  onHChange(e) {
    this.setSize('h', e.detail.value)
  },

  setSize(axis, pct) {
    const d = this.data
    const newW = Math.max(40, Math.round((d.imgW * pct) / 100))
    const newH = Math.max(40, Math.round((d.imgH * pct) / 100))
    const cx = d.frameX + d.frameW / 2
    const cy = d.frameY + d.frameH / 2
    const w = axis === 'w' ? newW : d.frameW
    const h = axis === 'h' ? newH : d.frameH
    const x = Math.max(0, Math.min(d.imgW - w, Math.round(cx - w / 2)))
    const y = Math.max(0, Math.min(d.imgH - h, Math.round(cy - h / 2)))
    this.setData({
      frameW: w,
      frameH: h,
      frameX: x,
      frameY: y,
      wPct: axis === 'w' ? pct : d.wPct,
      hPct: axis === 'h' ? pct : d.hPct
    })
  },

  onFrameChange(e) {
    const d = e.detail
    if (d && typeof d.x === 'number' && typeof d.y === 'number') {
      this.setData({ frameX: d.x, frameY: d.y })
    }
  },

  cancel() {
    wx.navigateBack()
  },

  confirm() {
    const d = this.data
    const src = this.source
    if (d.frameW < 10 || d.frameH < 10) {
      wx.showToast({ title: '裁剪区域太小', icon: 'none' })
      return
    }
    wx.showLoading({ title: '裁剪中…', mask: true })
    const sx = src.width / d.imgW
    const sy = src.height / d.imgH
    const cropX = d.frameX * sx
    const cropY = d.frameY * sy
    const cropW = d.frameW * sx
    const cropH = d.frameH * sy
    const outScale = Math.min(1, 2048 / Math.max(cropW, cropH))
    const outW = Math.round(cropW * outScale)
    const outH = Math.round(cropH * outScale)
    this.createSelectorQuery()
      .select('#cropCanvas')
      .fields({ node: true, size: true })
      .exec((res) => {
        try {
          if (!res || !res[0] || !res[0].node) {
            wx.hideLoading()
            wx.showToast({ title: '裁剪失败', icon: 'none' })
            return
          }
          const canvas = res[0].node
          canvas.width = outW
          canvas.height = outH
          const ctx = canvas.getContext('2d')
          const img = canvas.createImage()
          img.onload = () => {
            try {
              ctx.fillStyle = '#ffffff'
              ctx.fillRect(0, 0, outW, outH)
              ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, outW, outH)
              wx.canvasToTempFilePath({
                canvas,
                success: (r) => {
                  getApp().globalData.cropResult = { path: r.tempFilePath }
                  wx.hideLoading()
                  wx.navigateBack()
                },
                fail: () => {
                  wx.hideLoading()
                  wx.showToast({ title: '裁剪失败', icon: 'none' })
                }
              })
            } catch (e) {
              wx.hideLoading()
              wx.showToast({ title: '裁剪失败', icon: 'none' })
              console.error(e)
            }
          }
          img.onerror = () => {
            wx.hideLoading()
            wx.showToast({ title: '图片加载失败', icon: 'none' })
          }
          img.src = src.path
        } catch (e) {
          wx.hideLoading()
          wx.showToast({ title: '裁剪失败', icon: 'none' })
          console.error(e)
        }
      })
  }
})
