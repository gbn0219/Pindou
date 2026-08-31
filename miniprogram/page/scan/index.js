// miniprogram/page/scan/index.js
/**
 * 图纸识别（扫描）：导入已有拼豆图纸（截图/拍照），本地识别为色号网格。
 * 不调用 AI。方形 MVP（宽==高）；识别结果写入 globalData.pattern(mode:'scan') 后进入展示页。
 */
const scan = require('../../utils/scan.js')
const color = require('../../utils/color.js')
const pattern = require('../../utils/pattern.js')
const image = require('../../utils/image.js')
const gesture = require('../../utils/gesture.js')

const MAX_DIM = 2048 // 工作图最大边长（内存与采样速度折中）
const HANDLE = 20 // 角点拖拽命中半径（视口 px）
const FIT_PAD = 16 // 图纸与画布四边留白（视口 px），避免画到/滑出屏幕边缘
const NUDGE_FRAC = 0.2 // 原点微调步长 = 格宽/格高 × 该比例
const SIZE_STEP = 0.01 // 格宽/格高微调比例
const MIN_BOX = 8 // 选框最小边长（图片 px）

Page({
  data: {
    stage: 'import', // import | calibrate
    imagePath: '',
    rows: 20,
    cols: 20,
    set: '221',
    colorSets: ['48', '72', '144', '221'],
    recognizing: false,
    hasBox: false,
    hint: ''
  },

  onLoad() {
    this.box = null
    this.view = null
    this._mode = ''
    this._hasBoxShown = false
  },

  onReady() {
    this.initCanvas()
  },

  onUnload() {
    this.fullCanvas = null
  },

  chooseImage() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      fail: (err) => {
        if (err && err.errMsg && err.errMsg.indexOf('cancel') >= 0) return
        wx.showToast({ title: '选择图片失败', icon: 'none' })
      },
      success: (res) => {
        const file = res.tempFiles && res.tempFiles[0]
        if (!file) return
        wx.getImageInfo({
          src: file.tempFilePath,
          success: (info) => this.setupImage(file.tempFilePath, info.width, info.height),
          fail: () => this.setupImage(file.tempFilePath, 0, 0)
        })
      }
    })
  },

  async setupImage(path, w, h) {
    this.fullCanvas = null
    this.box = null
    this.view = null
    this._hasBoxShown = false
    try {
      // 工作图：等比缩放到 ≤MAX_DIM，控制内存与采样开销（识别精度不受影响）
      const scale = w && h ? Math.min(1, MAX_DIM / Math.max(w, h)) : 1
      const iw = Math.max(1, Math.round(w * scale))
      const ih = Math.max(1, Math.round(h * scale))
      const canvas = wx.createOffscreenCanvas({ type: '2d', width: iw, height: ih })
      const ctx = canvas.getContext('2d')
      const img = await image.loadImageOnce(canvas, path)
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, iw, ih)
      ctx.drawImage(img, 0, 0, iw, ih)
      this.fullCanvas = canvas
      this.wImg = { width: iw, height: ih }
      this.setData({
        imagePath: path,
        stage: 'calibrate',
        hasBox: false,
        hint: '在图上拖动框出整个图纸范围，双指缩放查看'
      })
      this.initCanvas()
    } catch (err) {
      console.error(err)
      wx.showToast({ title: '图片加载失败', icon: 'none' })
    }
  },

  initCanvas(retry) {
    if (this.data.stage !== 'calibrate') return
    this.createSelectorQuery()
      .select('#scanCanvas')
      .fields({ node: true, size: true })
      .exec((res) => {
        if (!res || !res[0]) {
          if ((retry || 0) < 8) setTimeout(() => this.initCanvas((retry || 0) + 1), 120)
          return
        }
        const node = res[0].node
        const areaW = res[0].width || 300
        const areaH = res[0].height || 300
        let dpr = 1
        try {
          dpr = Math.min(3, (wx.getSystemInfoSync().pixelRatio) || 1)
        } catch (err) {
          dpr = 1
        }
        node.width = Math.round(areaW * dpr)
        node.height = Math.round(areaH * dpr)
        this.canvas = node
        this.ctx = node.getContext('2d')
        this.dpr = dpr
        this.area = { width: areaW, height: areaH }
        if (!this.view && this.wImg) {
          this.view = this.fitView(this.wImg.width, this.wImg.height)
        }
        this.draw()
      })
  },

  fitView(iw, ih) {
    const area = this.area || { width: 300, height: 300 }
    const pad = FIT_PAD
    const innerW = area.width - pad * 2
    const innerH = area.height - pad * 2
    const scale = Math.min(innerW / iw, innerH / ih)
    return {
      scale,
      ox: pad + (innerW - iw * scale) / 2,
      oy: pad + (innerH - ih * scale) / 2
    }
  },

  clampView(view) {
    const iw = this.wImg.width
    const ih = this.wImg.height
    const area = this.area
    const pad = FIT_PAD
    const innerW = area.width - pad * 2
    const innerH = area.height - pad * 2
    const w = iw * view.scale
    const h = ih * view.scale
    let ox = view.ox
    let oy = view.oy
    if (w <= innerW) ox = pad + (innerW - w) / 2
    else ox = Math.max(pad + innerW - w, Math.min(pad, ox))
    if (h <= innerH) oy = pad + (innerH - h) / 2
    else oy = Math.max(pad + innerH - h, Math.min(pad, oy))
    return { scale: view.scale, ox, oy }
  },

  draw() {
    if (!this.ctx || !this.wImg || !this.view || !this.view.scale) return
    const ctx = this.ctx
    const dpr = this.dpr || 1
    const v = this.view
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.fillStyle = '#f3f0e8'
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height)
    ctx.setTransform(v.scale * dpr, 0, 0, v.scale * dpr, v.ox * dpr, v.oy * dpr)
    ctx.drawImage(this.fullCanvas, 0, 0, this.wImg.width, this.wImg.height)
    this.drawBox(ctx, v)
    ctx.setTransform(1, 0, 0, 1, 0, 0)
  },

  drawBox(ctx, v) {
    const b = this.box
    if (!b) return
    const iw = this.wImg.width
    const ih = this.wImg.height
    const lw = Math.max(1.2 / v.scale, 0.8)
    // 框外遮罩：提示识别范围
    ctx.fillStyle = 'rgba(18, 23, 27, 0.22)'
    ctx.fillRect(0, 0, iw, b.y0)
    ctx.fillRect(0, b.y1, iw, ih - b.y1)
    ctx.fillRect(0, b.y0, b.x0, b.y1 - b.y0)
    ctx.fillRect(b.x1, b.y0, iw - b.x1, b.y1 - b.y0)
    // 网格线实时预览（rows×cols）
    const rows = this.data.rows
    const cols = this.data.cols
    const w = b.x1 - b.x0
    const h = b.y1 - b.y0
    ctx.strokeStyle = '#ff3a5d'
    ctx.lineWidth = lw
    ctx.beginPath()
    for (let c = 1; c < cols; c++) {
      const x = b.x0 + (w * c) / cols
      ctx.moveTo(x, b.y0)
      ctx.lineTo(x, b.y1)
    }
    for (let r = 1; r < rows; r++) {
      const y = b.y0 + (h * r) / rows
      ctx.moveTo(b.x0, y)
      ctx.lineTo(b.x1, y)
    }
    ctx.stroke()
    // 外框 + 四角手柄
    ctx.strokeStyle = '#ff3a5d'
    ctx.lineWidth = lw * 1.6
    ctx.strokeRect(b.x0, b.y0, w, h)
    const hs = 5 / v.scale
    ctx.fillStyle = '#ffffff'
    const corners = [
      [b.x0, b.y0],
      [b.x1, b.y0],
      [b.x0, b.y1],
      [b.x1, b.y1]
    ]
    for (const c of corners) {
      ctx.fillRect(c[0] - hs, c[1] - hs, hs * 2, hs * 2)
      ctx.strokeRect(c[0] - hs, c[1] - hs, hs * 2, hs * 2)
    }
  },

  _toImg(p) {
    const v = this.view
    return { x: (p.x - v.ox) / v.scale, y: (p.y - v.oy) / v.scale }
  },

  _hitCorner(p) {
    const b = this.box
    const v = this.view
    const corners = [
      ['x0y0', b.x0, b.y0],
      ['x1y0', b.x1, b.y0],
      ['x0y1', b.x0, b.y1],
      ['x1y1', b.x1, b.y1]
    ]
    let best = null
    for (const c of corners) {
      const sx = v.ox + c[1] * v.scale
      const sy = v.oy + c[2] * v.scale
      const d = Math.max(Math.abs(sx - p.x), Math.abs(sy - p.y))
      if (d <= HANDLE && (!best || d < best.d)) best = { key: c[0], d }
    }
    return best ? best.key : ''
  },

  _inBox(p) {
    const v = this.view
    const b = this.box
    return (
      p.x >= v.ox + b.x0 * v.scale &&
      p.x <= v.ox + b.x1 * v.scale &&
      p.y >= v.oy + b.y0 * v.scale &&
      p.y <= v.oy + b.y1 * v.scale
    )
  },

  onTouchStart(e) {
    if (!this.wImg || !this.view) return
    if (e.touches.length >= 2) {
      const t1 = e.touches[0]
      const t2 = e.touches[1]
      this._mode = 'pinch'
      this._gesture = {
        dist: Math.sqrt((t1.x - t2.x) * (t1.x - t2.x) + (t1.y - t2.y) * (t1.y - t2.y)),
        midX: (t1.x + t2.x) / 2,
        midY: (t1.y + t2.y) / 2,
        scale: this.view.scale,
        ox: this.view.ox,
        oy: this.view.oy
      }
      return
    }
    const t = e.touches[0]
    const p = { x: t.x, y: t.y }
    const ip = this._toImg(p)
    const corner = this.box ? this._hitCorner(p) : ''
    if (corner) {
      this._mode = 'resize'
      this._resizeCorner = corner
      this._boxStart = Object.assign({}, this.box)
      return
    }
    if (this.box && this._inBox(p)) {
      this._mode = 'move'
      this._boxStart = Object.assign({}, this.box)
      this._lastPt = p
      return
    }
    if (!this.box) {
      this._mode = 'draw'
      this._boxStart = { x0: ip.x, y0: ip.y, x1: ip.x, y1: ip.y }
      this.box = { x0: ip.x, y0: ip.y, x1: ip.x, y1: ip.y }
      this.draw()
      return
    }
    this._mode = 'pan'
    this._viewStart = Object.assign({}, this.view)
    this._lastPt = p
  },

  onTouchMove(e) {
    if (!this.wImg || !this.view) return
    const t = e.touches[0]
    const p = { x: t.x, y: t.y }
    if (this._mode === 'pinch' && e.touches.length >= 2) {
      const t1 = e.touches[0]
      const t2 = e.touches[1]
      const next = gesture.viewportPinchStep(
        this._gesture,
        { scale: this._gesture.scale, ox: this._gesture.ox, oy: this._gesture.oy },
        { x: t1.x, y: t1.y },
        { x: t2.x, y: t2.y }
      )
      this.view = this.clampView(next)
      this.draw()
      return
    }
    if (this._mode === 'pan') {
      const dx = p.x - this._lastPt.x
      const dy = p.y - this._lastPt.y
      this._lastPt = p
      this.view = this.clampView({ scale: this.view.scale, ox: this.view.ox + dx, oy: this.view.oy + dy })
      this.draw()
      return
    }
    if (this._mode === 'move' && this.box) {
      const ip = this._toImg(p)
      const last = this._toImg(this._lastPt)
      this._lastPt = p
      this._applyBox({
        x0: this._clampX(this.box.x0 + (ip.x - last.x)),
        y0: this._clampY(this.box.y0 + (ip.y - last.y)),
        x1: this._clampX(this.box.x1 + (ip.x - last.x)),
        y1: this._clampY(this.box.y1 + (ip.y - last.y))
      })
      this.draw()
      return
    }
    if (this._mode === 'resize' && this.box) {
      const ip = this._toImg(p)
      const bs = this._boxStart
      const b = Object.assign({}, bs)
      // 角名如 x1y0（右上）：控制右 x1 与上 y0 两边；y 判断必须看第 3 位，不能 indexOf
      const xIsLeft = this._resizeCorner.charAt(1) === '0'
      const yIsTop = this._resizeCorner.charAt(3) === '0'
      if (xIsLeft) b.x0 = Math.min(ip.x, bs.x1 - MIN_BOX)
      else b.x1 = Math.max(ip.x, bs.x0 + MIN_BOX)
      if (yIsTop) b.y0 = Math.min(ip.y, bs.y1 - MIN_BOX)
      else b.y1 = Math.max(ip.y, bs.y0 + MIN_BOX)
      this._applyBox(b)
      this.draw()
      return
    }
    if (this._mode === 'draw') {
      const ip = this._toImg(p)
      const bs = this._boxStart
      this._applyBox({
        x0: this._clampX(Math.min(bs.x0, ip.x)),
        y0: this._clampY(Math.min(bs.y0, ip.y)),
        x1: this._clampX(Math.max(bs.x0, ip.x)),
        y1: this._clampY(Math.max(bs.y0, ip.y))
      })
      this.draw()
    }
  },

  onTouchEnd(e) {
    if (this._mode === 'draw' && this.box) {
      const w = this.box.x1 - this.box.x0
      const h = this.box.y1 - this.box.y0
      if (w < 4 || h < 4) {
        this.box = null
        this._hasBoxShown = false
        this.setData({ hasBox: false })
      }
    }
    this._mode = ''
    this._gesture = null
    this.draw()
  },

  onTouchCancel() {
    this._mode = ''
    this._gesture = null
  },

  _clampX(x) {
    return Math.max(0, Math.min(this.wImg.width, x))
  },

  _clampY(y) {
    return Math.max(0, Math.min(this.wImg.height, y))
  },

  _applyBox(b) {
    this.box = b
    if (b.x1 - b.x0 >= 4 && b.y1 - b.y0 >= 4 && !this._hasBoxShown) {
      this._hasBoxShown = true
      this.setData({ hasBox: true })
    }
  },

  onNudge(e) {
    if (!this.box) return
    const dir = e.currentTarget.dataset.dir
    const b = this.box
    const stepW = ((b.x1 - b.x0) / this.data.cols) * NUDGE_FRAC
    const stepH = ((b.y1 - b.y0) / this.data.rows) * NUDGE_FRAC
    const next = Object.assign({}, b)
    if (dir === 'left') {
      next.x0 = this._clampX(b.x0 - stepW)
      next.x1 = this._clampX(b.x1 - stepW)
    } else if (dir === 'right') {
      next.x0 = this._clampX(b.x0 + stepW)
      next.x1 = this._clampX(b.x1 + stepW)
    } else if (dir === 'up') {
      next.y0 = this._clampY(b.y0 - stepH)
      next.y1 = this._clampY(b.y1 - stepH)
    } else if (dir === 'down') {
      next.y0 = this._clampY(b.y0 + stepH)
      next.y1 = this._clampY(b.y1 + stepH)
    }
    this._applyBox(next)
    this.draw()
  },

  onGrow(e) {
    if (!this.box) return
    const axis = e.currentTarget.dataset.axis
    const dir = Number(e.currentTarget.dataset.dir)
    const b = this.box
    const next = Object.assign({}, b)
    if (axis === 'w') {
      const dw = (b.x1 - b.x0) * SIZE_STEP * dir
      next.x0 = this._clampX(b.x0 - dw / 2)
      next.x1 = this._clampX(b.x1 + dw / 2)
    } else {
      const dh = (b.y1 - b.y0) * SIZE_STEP * dir
      next.y0 = this._clampY(b.y0 - dh / 2)
      next.y1 = this._clampY(b.y1 + dh / 2)
    }
    this._applyBox(next)
    this.draw()
  },

  onReset() {
    this.box = null
    this._hasBoxShown = false
    this.view = this.wImg ? this.fitView(this.wImg.width, this.wImg.height) : this.view
    this.setData({ hasBox: false })
    this.draw()
  },

  onRowsInput(e) {
    this.setData({ rows: this._norm(e.detail.value) })
  },

  onColsInput(e) {
    this.setData({ cols: this._norm(e.detail.value) })
  },

  _norm(v) {
    const n = Math.round(Number(v))
    if (!n || isNaN(n)) return 1
    return Math.max(1, Math.min(208, n))
  },

  pickSet(e) {
    this.setData({ set: e.currentTarget.dataset.value })
  },

  async recognize() {
    if (this.data.recognizing) return
    const rows = this.data.rows
    const cols = this.data.cols
    if (rows !== cols) {
      wx.showToast({ title: '当前版本仅支持正方形图纸（宽=高）', icon: 'none' })
      return
    }
    if (!this.box) {
      wx.showToast({ title: '请先在图上框出整个图纸范围', icon: 'none' })
      return
    }
    this.setData({ recognizing: true })
    wx.showLoading({ title: '识别中…', mask: true })
    try {
      const ctx = this.fullCanvas.getContext('2d')
      const imageData = ctx.getImageData(0, 0, this.wImg.width, this.wImg.height)
      const rgbGrid = scan.scanGrid(imageData, rows, cols, this.box)
      const palette = color.buildPalette(this.data.set)
      let grid = scan.rgbGridToCodes(rgbGrid, this.data.set)
      grid = pattern.postProcessGrid(grid, palette)
      // 方形 MVP：每格都是真实豆色，背景掩码全 false（不做白色背景去除）
      const bgMask = []
      for (let r = 0; r < rows; r++) bgMask.push(new Array(cols).fill(false))
      getApp().globalData.pattern = {
        grid,
        size: rows,
        set: this.data.set,
        imagePath: this.data.imagePath,
        mode: 'scan',
        style: '图纸识别',
        bgMask
      }
      wx.hideLoading()
      wx.navigateTo({ url: '/page/pattern/index' })
    } catch (err) {
      wx.hideLoading()
      console.error(err)
      wx.showToast({ title: '识别失败，请重试', icon: 'none' })
    } finally {
      this.setData({ recognizing: false })
    }
  }
})
