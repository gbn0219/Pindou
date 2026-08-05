// miniprogram/page/pattern/index.js
const pattern = require('../../utils/pattern.js')
const color = require('../../utils/color.js')
const gesture = require('../../utils/gesture.js')
const config = require('../../config.js')
const ai = require('../../utils/ai.js')
const user = require('../../utils/user.js')
const hash = require('../../utils/hash.js')
const session = require('../../utils/session.js')

const CODE_MIN_SCALE = 0.65 // 格子放大到该倍数以上才显示编号（默认铺满视图隐藏编号，避免乱码感）

Page({
  data: {
    set: '221',
    size: 52,
    mode: 'photo',
    styleShort: '', // 生成方式显示用：只保留风格名（去掉冒号后的描述）
    legend: [],
    total: 0,
    gridOn: true,
    gridEvery: 5,
    locked: false,
    lockedIndex: 0,
    lockedTotal: 0
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
    this.whiteCodes = pattern.findWhiteishCodes(this.palette) // 套装中的白色系（纯白/近白/奶油白）
    this.bgMask = pattern.findBackgroundMask(p.grid, this.whiteCodes) // 白色背景连通域（不显示编号、不计色块数）
    this.codeShown = false
    const styleShort = (p.style || '').split(/[：:]/)[0].trim()
    this.aiSession = getApp().globalData.aiSession || null
    const locked = !!(p.locked && this.aiSession)
    this.setData({ set: p.set, size: p.size, mode: p.mode || 'photo', styleShort, locked })
    if (locked) {
      this.setData({
        lockedIndex: this.aiSession.index + 1,
        lockedTotal: this.aiSession.candidates.length
      })
    }
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
    this.bgMask = pattern.findBackgroundMask(p.grid, this.whiteCodes)
    const counts = pattern.countColors(p.grid, this.palette.map((i) => i.code), this.bgMask)
    const hexByCode = {}
    this.palette.forEach((i) => {
      hexByCode[i.code] = i.hex
    })
    const total = counts.reduce((s, i) => s + i.count, 0)
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
        this.areaRect = { left: (area && area.left) || 0, top: (area && area.top) || 0 } // 触摸用视口坐标换算
        const canvas = res[1].node
        const cell = pattern.displayCell(p.size) // 大盘面自动降低格边长，避免画布超限
        this.displayCell = cell
        const total = p.size * (cell + pattern.GAP) - pattern.GAP
        const areaW = (area && area.width) || 300
        const areaH = (area && area.height) || 300
        // 画布 = 可视区域，内容用 ctx 变换呈现，触摸坐标无缩放歧义
        const scale = Math.max(0.05, Math.min(1, Math.min(areaW, areaH) / total))
        this.view = {
          scale,
          ox: (areaW - total * scale) / 2,
          oy: (areaH - total * scale) / 2
        }
        this.canvasW = areaW
        this.canvasH = areaH
        canvas.width = areaW
        canvas.height = areaH
        this.canvas = canvas
        this.ctx = canvas.getContext('2d')
        this.drawGrid()
      })
  },

  applyView() {
    const v = this.view
    if (!this.ctx || !v) return
    this.ctx.setTransform(v.scale, 0, 0, v.scale, v.ox, v.oy)
  },

  drawGrid() {
    if (!this.canvas || !this.ctx) return
    // 先以单位变换清空整块画布，否则缩放/拖动后旧图残留在原位（残影）
    this.ctx.setTransform(1, 0, 0, 1, 0, 0)
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
    this.applyView()
    pattern.renderGrid(this.ctx, this.pattern.grid, this.palette, {
      cellSize: this.displayCell || pattern.CELL,
      gap: pattern.GAP,
      code: this.data.locked ? false : this.codeShown,
      gridEvery: this.data.gridOn ? this.data.gridEvery : 0,
      noCodeMask: this.bgMask
    })
  },

  redraw() {
    this.drawGrid()
  },

  // 触摸坐标统一换算为可视区域坐标（视口坐标 - 区域左上角），避免 canvas 触摸的已知问题
  normTouch(t) {
    const r = this.areaRect || { left: 0, top: 0 }
    return { x: t.clientX - r.left, y: t.clientY - r.top }
  },

  // 双指：缩放 + 拖动（连续手势），手势结束前不响应其他逻辑
  onTouchStart(e) {
    if (this.data.locked) return
    const touches = e.touches
    if (touches.length >= 2) {
      this.startPinch(this.normTouch(touches[0]), this.normTouch(touches[1]))
    }
  },

  onTouchMove(e) {
    if (this.data.locked) return
    const touches = e.touches
    // 双指手势期间（即使只剩一指）保持手势，等全部抬起再清理
    if (this.pinchActive || touches.length >= 2) {
      if (touches.length >= 2) {
        if (!this.pinchActive) {
          this.startPinch(this.normTouch(touches[0]), this.normTouch(touches[1]))
        } else {
          this.handlePinch(this.normTouch(touches[0]), this.normTouch(touches[1]))
        }
      }
      return
    }
  },

  onTouchEnd(e) {
    if (this.data.locked) return
    // 仍有手指按着（双指变一指）：保持手势状态，等全部抬起再清理
    if (e.touches && e.touches.length > 0) return
    this.pinchActive = false
    this.pinch = null
  },

  onTouchCancel() {
    if (this.data.locked) return
    this.pinchActive = false
    this.pinch = null
  },

  startPinch(t1, t2) {
    const dx = t1.x - t2.x
    const dy = t1.y - t2.y
    const v = this.view
    this.pinch = {
      dist: Math.sqrt(dx * dx + dy * dy),
      midX: (t1.x + t2.x) / 2,
      midY: (t1.y + t2.y) / 2,
      scale: v.scale,
      ox: v.ox,
      oy: v.oy
    }
    this.pinchActive = true
  },

  handlePinch(t1, t2) {
    if (!this.pinch || !this.view) return
    this.view = gesture.viewportPinchStep(this.pinch, this.view, t1, t2)
    const show = this.view.scale >= CODE_MIN_SCALE
    if (show !== this.codeShown) {
      this.codeShown = show
    }
    this.scheduleRedraw()
  },

  // 捏合期间用 rAF 合并重绘，避免每帧全量重绘把主线程占满（否则按钮会显得失灵）
  scheduleRedraw() {
    if (this._redrawPending) return
    this._redrawPending = true
    const canvas = this.canvas
    const raf = canvas && canvas.requestAnimationFrame
    const done = () => {
      this._redrawPending = false
      try {
        this.drawGrid()
      } catch (err) {
        console.error('redraw error', err)
      }
    }
    if (typeof raf === 'function') raf.call(canvas, done)
    else setTimeout(done, 16)
  },

  onGridToggle(e) {
    this.setData({ gridOn: e.detail.value }, () => this.redraw())
  },

  onGridEvery(e) {
    const v = Number(e.currentTarget.dataset.value)
    if (v === this.data.gridEvery) return
    this.setData({ gridEvery: v }, () => this.redraw())
  },

  goEdit() {
    wx.navigateTo({ url: '/page/pattern-edit/index' })
  },

  async onRegenerate() {
    const s = this.aiSession
    if (!s || !s.params || !session.canGenerate(s)) return
    if (!(getApp().globalData.user && getApp().globalData.user.openid)) {
      wx.showToast({ title: '请先登录', icon: 'none' })
      return
    }
    wx.showLoading({ title: '生成中…', mask: true })
    try {
      const p = s.params
      const imageBase64 = await ai.compressToBase64(p.imagePath)
      const imageHash = hash.fnv1a64(imageBase64)
      if (config.aiGenerate.backend === 'local') {
        await user.consumeQuota({ sessionId: s.sessionId, imageHash })
      }
      const grid = await ai.generateGrid({
        imageBase64,
        size: p.size,
        set: p.set,
        style: p.style,
        styleKey: p.styleKey,
        cutout: p.cutout,
        extra: p.extra,
        imageHash,
        sessionId: s.sessionId
      })
      this.aiSession = session.addCandidate(this.aiSession, grid)
      getApp().globalData.aiSession = this.aiSession
      this.pattern.grid = grid
      this.setData({ lockedIndex: this.aiSession.index + 1, lockedTotal: this.aiSession.candidates.length })
      this.updateLegend()
      this.drawPattern()
    } catch (err) {
      wx.showModal({ title: '生成失败', content: (err && err.message) || '请重试', showCancel: false })
    } finally {
      wx.hideLoading()
    }
  },

  onSwitchCandidate() {
    const s = this.aiSession
    if (!s || s.candidates.length < 2) return
    const next = (s.index + 1) % s.candidates.length
    this.aiSession = session.switchCandidate(s, next)
    getApp().globalData.aiSession = this.aiSession
    this.pattern.grid = this.aiSession.candidates[next]
    this.setData({ lockedIndex: next + 1 })
    this.updateLegend()
    this.drawPattern()
  },

  async onUnlock() {
    const s = this.aiSession
    if (!s) return
    wx.showLoading({ title: '解锁中…', mask: true })
    try {
      const order = await user.createOrder(s.sessionId)
      if (!order.paid) throw new Error('支付未完成')
      await user.unlock(s.sessionId)
      this.pattern.locked = false
      this.setData({ locked: false })
      this.updateLegend()
      this.drawPattern()
      wx.hideLoading()
      wx.showToast({ title: '已解锁', icon: 'success' })
      this.saveToGallery()
    } catch (err) {
      wx.hideLoading()
      wx.showToast({ title: (err && err.message) || '解锁失败', icon: 'none' })
    }
  },

  makeExportFile() {
    const canvas = this.canvas
    const p = this.pattern
    return new Promise((resolve, reject) => {
      if (!canvas) return reject(new Error('画布未就绪'))
      const codes = this.palette.map((i) => i.code)
      const counts = pattern.countColors(p.grid, codes, this.bgMask)
      const hexByCode = {}
      this.palette.forEach((i) => { hexByCode[i.code] = i.hex })
      const legendItems = counts.map((i) => ({ code: i.code, count: i.count, hex: hexByCode[i.code] }))
      const layout = pattern.layoutExport(p.grid, { cellSize: pattern.EXPORT_CELL, gap: 1, legendItems })
      const scale = Math.min(1, pattern.EXPORT_MAX_DIM / Math.max(layout.width, layout.height))
      canvas.width = Math.max(1, Math.round(layout.width * scale))
      canvas.height = Math.max(1, Math.round(layout.height * scale))
      const ctx = canvas.getContext('2d')
      ctx.scale(scale, scale)
      pattern.renderExport(ctx, p.grid, this.palette, {
        cellSize: pattern.EXPORT_CELL,
        gap: 1,
        code: true,
        gridEvery: this.data.gridOn ? this.data.gridEvery : 0,
        legendItems,
        noCodeMask: this.bgMask
      })
      wx.canvasToTempFilePath({
        canvas,
        success: (res) => {
          this.restoreDisplay(canvas)
          resolve(res.tempFilePath)
        },
        fail: reject
      })
    })
  },

  async saveToGallery() {
    const app = getApp()
    const u = app.globalData.user
    if (!u || !u.openid) return
    wx.showLoading({ title: '保存到图库…', mask: true })
    try {
      const patternFile = await this.makeExportFile()
      const ts = Date.now()
      const ext = (this.pattern.imagePath.match(/\.(\w+)$/) || [ , 'jpg'])[1]
      const original = await wx.cloud.uploadFile({
        cloudPath: 'gallery/' + u.openid + '/' + ts + '_original.' + ext,
        filePath: this.pattern.imagePath
      })
      const patternImg = await wx.cloud.uploadFile({
        cloudPath: 'gallery/' + u.openid + '/' + ts + '_pattern.png',
        filePath: patternFile
      })
      await user.saveGallery({
        originalFileID: original.fileID,
        patternFileID: patternImg.fileID,
        mode: this.pattern.mode,
        style: this.pattern.style || '',
        size: this.pattern.size,
        set: this.pattern.set,
        sessionId: this.aiSession ? this.aiSession.sessionId : undefined
      })
      wx.hideLoading()
      wx.showToast({ title: '已保存到图库', icon: 'success' })
    } catch (err) {
      wx.hideLoading()
      wx.showToast({ title: '保存到图库失败', icon: 'none' })
    }
  },

  exportImage() {
    this.makeExportFile()
      .then((filePath) => this.saveToAlbum(filePath))
      .catch(() => {
        wx.hideLoading()
        wx.showToast({ title: '导出失败', icon: 'none' })
      })
  },

  restoreDisplay(canvas) {
    canvas.width = this.canvasW
    canvas.height = this.canvasH
    this.ctx = canvas.getContext('2d')
    this.drawGrid()
  },

  saveToAlbum(filePath) {
    wx.saveImageToPhotosAlbum({
      filePath,
      success: () => {
        wx.hideLoading()
        wx.showToast({ title: '已保存到相册', icon: 'success' })
        if (this.pattern.mode !== 'ai') this.saveToGallery()
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
