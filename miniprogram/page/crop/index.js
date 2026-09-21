// miniprogram/page/crop/index.js
const MIN_SIZE = 40 // 裁剪框最小边长 px
const HIT = 24 // 命中边/角的阈值 px

const HINT_FREE = '拖动框内部移动，拖动四边或四角调整大小'
const HINT_CORNER = '先拖四角缩小裁剪框，框离开原位后才能拖四边'
const RATIOS = {
  '1:1': [1, 1],
  '4:3': [4, 3],
  '3:4': [3, 4],
  'free': [0, 0]
}

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
    frameY: 0,
    ratio: 'free',
    hint: HINT_FREE,
    edgesReady: true
  },

  onLoad() {
    const src = getApp().globalData.cropSource
    if (!src || !src.path) {
      wx.showToast({ title: '没有待裁剪的图片', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 800)
      return
    }
    this.source = src
    this.cornerFirst = !!src.cornerFirst // 识别图纸：初始只允许拖四角，避免拖边把整框带偏
    const sys = wx.getSystemInfoSync()
    const stageW = sys.windowWidth - 32
    const stageH = sys.windowHeight - 64 - 180
    const scale = Math.min(stageW / src.width, stageH / src.height, 1)
    const imgW = Math.max(40, Math.round(src.width * scale))
    const imgH = Math.max(40, Math.round(src.height * scale))
    this.startFrame = { x: 0, y: 0, w: imgW, h: imgH } // 初始裁剪框 = 整张图
    this.setData({
      sourcePath: src.path,
      imgW,
      imgH,
      frameW: imgW,
      frameH: imgH,
      frameX: 0,
      frameY: 0,
      hint: this.cornerFirst ? HINT_CORNER : HINT_FREE,
      edgesReady: !this.cornerFirst
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

  onRatioTap(e) {
    const ratio = e.currentTarget.dataset.ratio
    if (!RATIOS[ratio] || ratio === this.data.ratio) return
    this.setData({ ratio })
    if (ratio === 'free') return
    const d = this.data
    const [rw, rh] = RATIOS[ratio]
    const unit = Math.floor(Math.min(d.imgW / rw, d.imgH / rh))
    const w = unit * rw
    const h = unit * rh
    this.setData({
      frameW: w,
      frameH: h,
      frameX: Math.round((d.imgW - w) / 2),
      frameY: Math.round((d.imgH - h) / 2)
    })
    this.syncFrameHint()
  },

  // 裁剪框是否还停在初始位置（未动过）
  atStartFrame() {
    const d = this.data
    const s = this.startFrame
    return !!s && d.frameX === s.x && d.frameY === s.y && d.frameW === s.w && d.frameH === s.h
  },

  // 识别图纸：裁剪框离开初始位置后才放开四边（初始只认四角）
  syncFrameHint() {
    if (!this.cornerFirst) return
    const ready = !this.atStartFrame()
    if (ready === this.data.edgesReady) return
    this.setData({ edgesReady: ready, hint: ready ? HINT_FREE : HINT_CORNER })
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
    const corner = (nearLeft || nearRight) && (nearTop || nearBottom)
    const edge = nearLeft || nearRight || nearTop || nearBottom
    // cornerFirst（识别图纸）：框还铺在初始位置时只认四角，拖角缩小离开原位后才认四边
    const canResize = this.cornerFirst ? corner || (edge && !this.atStartFrame()) : edge
    if (canResize) {
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
    const ratioDims = RATIOS[d.ratio]
    if (ratioDims[0]) {
      const [rw, rh] = ratioDims
      const horizontal = drag.left || drag.right
      const vertical = drag.top || drag.bottom
      const wFromX = drag.left ? drag.ow - dx : drag.ow + dx
      const hFromY = drag.top ? drag.oh - dy : drag.oh + dy
      let unit = horizontal && vertical ? Math.min(wFromX / rw, hFromY / rh) : (horizontal ? wFromX / rw : hFromY / rh)
      unit = clamp(Math.round(unit), Math.ceil(MIN_SIZE / Math.max(rw, rh)), Math.floor(Math.min(d.imgW / rw, d.imgH / rh)))
      const w = unit * rw
      const h = unit * rh
      const x = clamp(horizontal ? (drag.right ? drag.ox : drag.ox + drag.ow - w) : drag.ox + drag.ow / 2 - w / 2, 0, d.imgW - w)
      const y = clamp(vertical ? (drag.bottom ? drag.oy : drag.oy + drag.oh - h) : drag.oy + drag.oh / 2 - h / 2, 0, d.imgH - h)
      this.setData({ frameX: x, frameY: y, frameW: w, frameH: h })
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
    this.syncFrameHint()
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