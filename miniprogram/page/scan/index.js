// miniprogram/page/scan/index.js
/**
 * 图纸识别（扫描）：导入已有拼豆图纸（截图/拍照），本地识别为色号网格。
 * 交互：屏幕固定一张正方形网格（格数可调，仅作对齐参考，默认 10），
 * 用户缩放/拖动【图片】让色块对齐网格；可“自动对齐”（投影法网格线检测预对齐）。
 * 对齐后按校准出的“一格大小”扫遍整图识别所有色块，再按“有颜色区域长宽最大值”生成最终正方形图纸。
 */
const scan = require('../../utils/scan.js')
const color = require('../../utils/color.js')
const pattern = require('../../utils/pattern.js')
const image = require('../../utils/image.js')
const gesture = require('../../utils/gesture.js')

const MAX_DIM = 2048 // 工作图最大边长（内存与采样速度折中）
const FIT_PAD = 16 // 网格与画布四边留白（视口 px），避免画到/滑出屏幕边缘
const NUDGE_FRAC = 0.1 // 对齐微调步长 = 网格格边长 × 该比例
const MIN_CELLS = 5 // 网格格数可调范围（仅对齐参考）
const MAX_CELLS = 50
const MIN_SCALE = 0.02
const MAX_SCALE = 8

Page({
  data: {
    stage: 'import', // import | calibrate
    imagePath: '',
    cells: 10, // 屏幕网格格数（对齐参考，最终图纸尺寸按彩色区域自动定）
    set: '221',
    colorSets: ['48', '72', '144', '221'],
    recognizing: false,
    autoAligning: false,
    autoBg: true, // 背景自动识别（无标号白格置空）
    hint: ''
  },

  onLoad() {
    this.view = null
    this.grid = null
    this._autoAligned = false
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
    this.view = null
    this.grid = null
    this._autoAligned = false
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
        hint: '缩放/拖动图片，让色块对齐网格'
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
          dpr = Math.min(3, wx.getSystemInfoSync().pixelRatio || 1)
        } catch (err) {
          dpr = 1
        }
        node.width = Math.round(areaW * dpr)
        node.height = Math.round(areaH * dpr)
        this.canvas = node
        this.ctx = node.getContext('2d')
        this.dpr = dpr
        this.area = { width: areaW, height: areaH }
        this.computeGrid()
        if (!this.view && this.wImg) this.view = this.fitView(this.wImg.width, this.wImg.height)
        this.draw()
        this.tryAutoAlignOnce()
      })
  },

  computeGrid() {
    const n = this.data.cells
    const area = this.area || { width: 300, height: 300 }
    const innerW = area.width - FIT_PAD * 2
    const innerH = area.height - FIT_PAD * 2
    const cell = Math.max(2, Math.min(innerW / n, innerH / n))
    this.grid = {
      cell,
      gx: FIT_PAD + (innerW - n * cell) / 2,
      gy: FIT_PAD + (innerH - n * cell) / 2
    }
  },

  // 初始“对齐图片整体”：把整张图铺进网格矩形（contain）
  fitView(iw, ih) {
    const g = this.grid
    const gw = this.data.cells * g.cell
    const gh = this.data.cells * g.cell
    const scale = Math.min(gw / iw, gh / ih)
    return {
      scale,
      ox: g.gx + (gw - iw * scale) / 2,
      oy: g.gy + (gh - ih * scale) / 2
    }
  },

  tryAutoAlignOnce() {
    if (this._autoAligned || !this.fullCanvas || !this.grid) return
    this._autoAligned = true
    this.doAutoAlign(true)
  },

  async doAutoAlign(silent) {
    if (this.data.autoAligning) return
    this.setData({ autoAligning: true })
    try {
      const ctx = this.fullCanvas.getContext('2d')
      const imageData = ctx.getImageData(0, 0, this.wImg.width, this.wImg.height)
      const det = scan.detectGridLines(imageData)
      if (!det) {
        if (!silent) wx.showToast({ title: '未识别到网格线，请手动对齐', icon: 'none' })
        return
      }
      const cell = this.grid.cell
      const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, cell / det.cellW))
      this.view = {
        scale,
        ox: this.grid.gx - det.originX * scale,
        oy: this.grid.gy - det.originY * scale
      }
      this.draw()
      this.setData({ hint: '已自动对齐，可缩放/拖动微调' })
      if (!silent) wx.showToast({ title: '已自动对齐，可再微调', icon: 'none' })
    } catch (err) {
      console.error(err)
      if (!silent) wx.showToast({ title: '自动对齐失败', icon: 'none' })
    } finally {
      this.setData({ autoAligning: false })
    }
  },

  onAutoAlign() {
    this.doAutoAlign(false)
  },

  resetAlign() {
    if (!this.wImg) return
    this.view = this.fitView(this.wImg.width, this.wImg.height)
    this.setData({ hint: '缩放/拖动图片，让色块对齐网格' })
    this.draw()
  },

  draw() {
    if (!this.ctx || !this.wImg || !this.view || !this.view.scale || !this.grid) return
    const ctx = this.ctx
    const dpr = this.dpr || 1
    const v = this.view
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.fillStyle = '#f3f0e8'
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height)
    // 图片（在图片变换下）
    ctx.setTransform(v.scale * dpr, 0, 0, v.scale * dpr, v.ox * dpr, v.oy * dpr)
    ctx.drawImage(this.fullCanvas, 0, 0, this.wImg.width, this.wImg.height)
    // 固定网格（屏幕空间）
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    this.drawGrid(ctx)
    ctx.setTransform(1, 0, 0, 1, 0, 0)
  },

  drawGrid(ctx) {
    const g = this.grid
    const n = this.data.cells
    const gw = n * g.cell
    const gh = n * g.cell
    // 网格外轻遮罩：强调“网格内才是识别范围”
    ctx.fillStyle = 'rgba(18, 23, 27, 0.14)'
    ctx.fillRect(0, 0, this.area.width, g.gy)
    ctx.fillRect(0, g.gy + gh, this.area.width, this.area.height - g.gy - gh)
    ctx.fillRect(0, g.gy, g.gx, gh)
    ctx.fillRect(g.gx + gw, g.gy, this.area.width - g.gx - gw, gh)
    // 网格线
    ctx.strokeStyle = 'rgba(255, 58, 93, 0.85)'
    ctx.lineWidth = 1
    ctx.beginPath()
    for (let c = 0; c <= n; c++) {
      const x = g.gx + c * g.cell
      ctx.moveTo(x, g.gy)
      ctx.lineTo(x, g.gy + gh)
    }
    for (let r = 0; r <= n; r++) {
      const y = g.gy + r * g.cell
      ctx.moveTo(g.gx, y)
      ctx.lineTo(g.gx + gw, y)
    }
    ctx.stroke()
    ctx.lineWidth = 2
    ctx.strokeRect(g.gx, g.gy, gw, gh)
  },

  // 手势只作用于图片（缩放/平移），网格固定不动
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
    this._mode = 'pan'
    this._lastPt = { x: t.x, y: t.y }
  },

  onTouchMove(e) {
    if (!this.wImg || !this.view) return
    if (this._mode === 'pinch' && e.touches.length >= 2) {
      const t1 = e.touches[0]
      const t2 = e.touches[1]
      const next = gesture.viewportPinchStep(
        this._gesture,
        { scale: this._gesture.scale, ox: this._gesture.ox, oy: this._gesture.oy },
        { x: t1.x, y: t1.y },
        { x: t2.x, y: t2.y }
      )
      next.scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, next.scale))
      this.view = next
      this.draw()
      return
    }
    const t = e.touches[0]
    const p = { x: t.x, y: t.y }
    if (this._mode === 'pan') {
      this.view.ox += p.x - this._lastPt.x
      this.view.oy += p.y - this._lastPt.y
      this._lastPt = p
      this.draw()
    }
  },

  onTouchEnd() {
    this._mode = ''
    this._gesture = null
  },

  onTouchCancel() {
    this._mode = ''
    this._gesture = null
  },

  onNudge(e) {
    if (!this.view || !this.grid) return
    const dir = e.currentTarget.dataset.dir
    const step = this.grid.cell * NUDGE_FRAC
    if (dir === 'left') this.view.ox -= step
    else if (dir === 'right') this.view.ox += step
    else if (dir === 'up') this.view.oy -= step
    else if (dir === 'down') this.view.oy += step
    this.draw()
  },

  onCellsChange(e) {
    this.setData({ cells: this._clampCells(e.detail.value) })
    this.computeGrid()
    this.draw()
  },

  onCellsStep(e) {
    const delta = Number(e.currentTarget.dataset.delta)
    this.setData({ cells: this._clampCells(this.data.cells + delta) })
    this.computeGrid()
    this.draw()
  },

  _clampCells(v) {
    const n = Math.round(Number(v))
    if (!n || isNaN(n)) return MIN_CELLS
    return Math.max(MIN_CELLS, Math.min(MAX_CELLS, n))
  },

  pickSet(e) {
    this.setData({ set: e.currentTarget.dataset.value })
  },

  onAutoBgChange(e) {
    this.setData({ autoBg: e.detail.value })
  },

  async recognize() {
    if (this.data.recognizing) return
    if (!this.grid || !this.view) {
      wx.showToast({ title: '请先对齐网格', icon: 'none' })
      return
    }
    this.setData({ recognizing: true })
    wx.showLoading({ title: '识别中…', mask: true })
    try {
      const ctx = this.fullCanvas.getContext('2d')
      const imageData = ctx.getImageData(0, 0, this.wImg.width, this.wImg.height)
      // 一格大小（图片像素）= 网格格边长 / 当前缩放；原点 = 网格 (0,0) 映射回图片
      const cellPx = this.grid.cell / this.view.scale
      const originX = (this.grid.gx - this.view.ox) / this.view.scale
      const originY = (this.grid.gy - this.view.oy) / this.view.scale
      const { rgbGrid, darkGrid } = scan.scanAtPitch(imageData, cellPx, originX, originY)
      const bgMask = scan.buildBgMask(rgbGrid, darkGrid, { autoBg: this.data.autoBg })
      const res = scan.finalizePattern(rgbGrid, bgMask, this.data.set)
      if (!res) {
        wx.hideLoading()
        wx.showToast({ title: '未识别到图纸内容，请调整对齐', icon: 'none' })
        return
      }
      const palette = color.buildPalette(this.data.set)
      res.grid = pattern.postProcessGrid(res.grid, palette, { bgMask: res.bgMask })
      getApp().globalData.pattern = {
        grid: res.grid,
        size: res.size,
        set: this.data.set,
        imagePath: this.data.imagePath,
        mode: 'scan',
        style: '图纸识别',
        bgMask: res.bgMask
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
