// miniprogram/page/crop/index.js
const MIN_SIZE = 40 // 裁剪框最小边长 px
const HIT = 24 // 命中边/角的阈值 px

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v))
}

Page({
  data: {
    sourcePath: '',
    imgW: 0,
    imgH: 0,
    frameW: 0,
    frameH: 0,
    frameX: 0,
    frameY: 0
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
    const stageH = sys.windowHeight - 64 - 180
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

  onReady() {
    this.createSelectorQuery()
      .select('#cropArea')
      .boundingClientRect()
      .exec((res) => {
        this.areaRect = (res && res[0]) || null
      })
  },

  onFrameTouchStart(e) {
    const t = e.touches && e.touches[0]
    if (!t) return
    const d = this.data
    const rect = this.areaRect || { left: 0, top: 0 }
    const lx = t.clientX - rect.left - d.frameX
    const ly = t.clientY - rect.top - d.frameY
    const nearLeft = lx <= HIT
    const nearRight = lx >= d.frameW - HIT
    const nearTop = ly <= HIT
    const nearBottom = ly >= d.frameH - HIT
    if (nearLeft || nearRight || nearTop || nearBottom) {
      this._drag = {
        mode: 'resize',
        startX: t.clientX,
        startY: t.clientY,
        ox: d.frameX,
        oy: d.frameY,
        ow: d.frameW,
        oh: d.frameH,
        left: nearLeft,
        right: nearRight,
        top: nearTop,
        bottom: nearBottom
      }
    } else {
      this._drag = {
        mode: 'move',
        startX: t.clientX,
        startY: t.clientY,
        ox: d.frameX,
        oy: d.frameY
      }
    }
  },

  onFrameTouchMove(e) {
    const drag = this._drag
    const t = e.touches && e.touches[0]
    if (!drag || !t) return
    const d = this.data
    const dx = t.clientX - drag.startX
    const dy = t.clientY - drag.startY
    if (drag.mode === 'move') {
      const x = clamp(drag.ox + dx, 0, d.imgW - d.frameW)
      const y = clamp(drag.oy + dy, 0, d.imgH - d.frameH)
      this.setData({ frameX: Math.round(x), frameY: Math.round(y) })
      return
    }
    let x = drag.ox
    let y = drag.oy
    let w = drag.ow
    let h = drag.oh
    if (drag.left) {
      w = drag.ow - dx
      x = drag.ox + dx
      if (w < MIN_SIZE) {
        w = MIN_SIZE
        x = drag.ox + drag.ow - MIN_SIZE
      }
    } else if (drag.right) {
      w = Math.min(drag.ow + dx, d.imgW - x)
      if (w < MIN_SIZE) w = MIN_SIZE
    }
    if (drag.top) {
      h = drag.oh - dy
      y = drag.oy + dy
      if (h < MIN_SIZE) {
        h = MIN_SIZE
        y = drag.oy + drag.oh - MIN_SIZE
      }
    } else if (drag.bottom) {
      h = Math.min(drag.oh + dy, d.imgH - y)
      if (h < MIN_SIZE) h = MIN_SIZE
    }
    x = clamp(x, 0, d.imgW - w)
    y = clamp(y, 0, d.imgH - h)
    this.setData({
      frameX: Math.round(x),
      frameY: Math.round(y),
      frameW: Math.round(w),
      frameH: Math.round(h)
    })
  },

  onFrameTouchEnd() {
    this._drag = null
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
            } catch (err) {
              wx.hideLoading()
              wx.showToast({ title: '裁剪失败', icon: 'none' })
              console.error(err)
            }
          }
          img.onerror = () => {
            wx.hideLoading()
            wx.showToast({ title: '图片加载失败', icon: 'none' })
          }
          img.src = src.path
        } catch (err) {
          wx.hideLoading()
          wx.showToast({ title: '裁剪失败', icon: 'none' })
          console.error(err)
        }
      })
  }
})