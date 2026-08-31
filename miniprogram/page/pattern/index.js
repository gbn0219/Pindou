// miniprogram/page/pattern/index.js
const pattern = require('../../utils/pattern.js')
const beading = require('../../utils/beading.js')
const color = require('../../utils/color.js')
const gesture = require('../../utils/gesture.js')
const ai = require('../../utils/ai.js')
const exportUtil = require('../../utils/export.js')
const user = require('../../utils/user.js')
const session = require('../../utils/session.js')
const progressUtil = require('../../utils/progress.js')
const sec = require('../../utils/sec.js')

const OFFSCREEN_MAX_SCALE = 0.4 // 低倍率（<=0.4）用离屏层贴图，超过后逐格直绘可见格子

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
    candIndex: 0,
    candTotal: 0,
    extraReq: '',
    progressShow: false,
    progressPct: 0,
    progressTip: '',
    fullscreen: false,
    guideMode: 'spot',
    fuseLegend: [],
    fuseSort: 'count',
    fuseSelected: '',
    buildCurrent: '',
    buildDoneCount: 0,
    doneMap: {}
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
    this.refreshBgMask()
    this.codeShown = false
    const styleShort = (p.style || '').split(/[：:]/)[0].trim()
    this.aiSession = getApp().globalData.aiSession || null
    this.setData({
      set: p.set,
      size: p.size,
      mode: p.mode || 'photo',
      styleShort,
      candIndex: this.aiSession ? this.aiSession.index + 1 : 0,
      candTotal: this.aiSession ? this.aiSession.candidates.length : 0
    })
  },

  onShow() {
    if (!this.pattern) return
    this.updateLegend()
    this.offscreenDirty = true // 修改页可能改过共享 grid，返回时重建离屏层
    if (this.canvas) this.drawPattern()
  },

  onReady() {
    this.drawPattern()
  },

  onUnload() {
    if (this._progressTimer) {
      clearInterval(this._progressTimer)
      this._progressTimer = null
    }
  },

  updateLegend() {
    const p = this.pattern
    this.refreshBgMask()
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

  // 背景掩码：优先使用图纸携带的掩码（AI 抠图生成 / 修改页编辑后回写），
  // 无掩码（照片还原）时回退白色连通域判定
  refreshBgMask() {
    if (this.pattern.bgMask) this.bgMask = this.pattern.bgMask
    else this.bgMask = pattern.findBackgroundMask(this.pattern.grid, this.whiteCodes)
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
        try {
          const info = wx.getSystemInfoSync()
          this.dpr = Math.min(3, info.pixelRatio || 1)
        } catch (err) {
          this.dpr = 1
        }
        const canvas = res[1].node
        const cell = pattern.displayCell(p.size) // 大盘面自动降低格边长，避免画布超限
        this.displayCell = cell
        const total = p.size * (cell + pattern.GAP) - pattern.GAP
        const areaW = (area && area.width) || 300
        const areaH = (area && area.height) || 300
        this.areaSize = { width: areaW, height: areaH }
        // 首次进入铺满视图并居中；切后台再回来保留缩放倍数与位置
        if (!this.view) {
          // 内容区 = 画布减去四周坐标条；网格只在内区铺放，坐标条不遮挡格子
          const ruler = 0
          const innerW = areaW - ruler * 2
          const innerH = areaH - ruler * 2
          const scale = Math.max(0.05, Math.min(1, Math.min(innerW, innerH) / total))
          this.view = {
            scale,
            ox: ruler + (innerW - total * scale) / 2,
            oy: ruler + (innerH - total * scale) / 2
          }
        }
        const dpr = this.dpr || 1
        canvas.width = Math.round(areaW * dpr)
        canvas.height = Math.round(areaH * dpr)
        this.canvas = canvas
        this.ctx = canvas.getContext('2d')
        this.drawGrid()
      })
  },

  ensureOffscreen() {
    if (this.offscreen && !this.offscreenDirty) return this.offscreen
    const cell = this.displayCell || pattern.CELL
    const total = this.pattern.size * (cell + pattern.GAP) - pattern.GAP
    const off = wx.createOffscreenCanvas({ type: '2d', width: total, height: total })
    pattern.renderGrid(off.getContext('2d'), this.pattern.grid, this.palette, {
      cellSize: cell,
      gap: pattern.GAP,
      code: false,
      gridEvery: this.data.gridOn ? this.data.gridEvery : 0,
      emphasis: beading.emphasisOpts(this.data, this.buildDone),
      noCodeMask: this.bgMask
    })
    this.offscreen = off
    this.offscreenDirty = false
    return off
  },

  applyView() {
    const v = this.view
    if (!this.ctx || !v) return
    const dpr = this.dpr || 1
    this.ctx.setTransform(v.scale * dpr, 0, 0, v.scale * dpr, v.ox * dpr, v.oy * dpr)
  },

  cssAreaSize() {
    const dpr = this.dpr || 1
    if (this.areaSize) return this.areaSize
    return { width: this.canvas.width / dpr, height: this.canvas.height / dpr }
  },

  clampView() {
    const p = this.pattern
    const cell = this.displayCell || pattern.CELL
    const total = p.size * (cell + pattern.GAP) - pattern.GAP
    const area = this.cssAreaSize()
    this.view = gesture.clampView(this.view, total, area.width, area.height, 0)
  },

  drawGrid() {
    if (!this.canvas || !this.ctx) return
    const area = this.cssAreaSize()
    // 先以单位变换清空整块画布，否则缩放/拖动后旧图残留在原位（残影）
    this.ctx.setTransform(1, 0, 0, 1, 0, 0)
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
    this.applyView()
    if (this.view.scale <= OFFSCREEN_MAX_SCALE) {
      // 低倍率：贴离屏静态层，避免每帧重绘全部格子
      this.ctx.drawImage(this.ensureOffscreen(), 0, 0)
    } else {
      // 高倍率：只重绘屏幕上可见的格子，任意放大不糊
      pattern.renderGridView(this.ctx, this.pattern.grid, this.palette, {
        cellSize: this.displayCell || pattern.CELL,
        gap: pattern.GAP,
        code: this.codeShown,
        gridEvery: this.data.gridOn ? this.data.gridEvery : 0,
        emphasis: beading.emphasisOpts(this.data, this.buildDone),
        noCodeMask: this.bgMask,
        view: this.view,
        areaW: area.width,
        areaH: area.height,
        dpr: this.dpr || 1
      })
    }
    // 坐标轴固定在画布四周（屏幕空间），不随内容缩放/移动；密度按可见格数自适应
    // 坐标条已收起，让图纸铺满画布
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
    const touches = e.touches
    if (this.data.fullscreen) {
      if (touches.length >= 2) {
        this.pan = null
        this.startPinch(this.normTouch(touches[0]), this.normTouch(touches[1]))
      } else if (touches.length === 1) {
        this.pinchActive = false
        this.pinch = null
        this.startPan(this.normTouch(touches[0]))
      }
      return
    }
    if (touches.length >= 2) {
      this.startPinch(this.normTouch(touches[0]), this.normTouch(touches[1]))
    } else if (touches.length === 1) {
      this.pinchActive = false
      this.pinch = null
      this.startPan(this.normTouch(touches[0]))
    }
  },

  onTouchMove(e) {
    const touches = e.touches
    if (this.data.fullscreen) {
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
      if (touches.length === 1) this.handlePan(this.normTouch(touches[0]))
      return
    }
    // 非全屏（卡片图纸视图）：同样支持双指缩放 + 单指拖动
    if (this.pinchActive || touches.length >= 2) {
      if (touches.length >= 2) {
        if (!this.pinchActive) this.startPinch(this.normTouch(touches[0]), this.normTouch(touches[1]))
        else this.handlePinch(this.normTouch(touches[0]), this.normTouch(touches[1]))
      }
      return
    }
    if (touches.length === 1) this.handlePan(this.normTouch(touches[0]))
  },

  onTouchEnd(e) {
    if (e.touches && e.touches.length > 0) return
    this.pan = null
    this.pinchActive = false
    this.pinch = null
  },

  onTouchCancel() {
    this.pan = null
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
    this.clampView()
    const area = this.cssAreaSize()
    const range = pattern.visibleRange(this.view, this.pattern.grid.length, this.displayCell || pattern.CELL, pattern.GAP, area.width, area.height)
    const show = range.c1 - range.c0 + 1 <= 30 && range.r1 - range.r0 + 1 <= 30
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
    this.offscreenDirty = true
    this.setData({ gridOn: e.detail.value }, () => this.redraw())
  },

  onGridEvery(e) {
    const v = Number(e.currentTarget.dataset.value)
    if (v === this.data.gridEvery) return
    this.offscreenDirty = true
    this.setData({ gridEvery: v }, () => this.redraw())
  },

  enterFullscreen() {
    const p = this.pattern
    if (!p.beadingKey) p.beadingKey = beading.storageKey(p)
    this.refreshBgMask()
    this.buildDone = beading.loadDone(p)
    const doneMap = {}
    this.buildDone.forEach((code) => { doneMap[code] = true })
    this.setData({
      fullscreen: true,
      guideMode: 'spot',
      fuseLegend: beading.buildLegend(p.grid, this.palette, this.bgMask, this.data.fuseSort),
      fuseSelected: '',
      buildCurrent: '',
      doneMap,
      buildDoneCount: this.buildDone.length
    }, () => {
      this.pinchActive = false
      this.pinch = null
      this.pan = null
      this.codeShown = false
      this.view = null
      this.offscreenDirty = true
      this.drawPattern()
    })
  },

  exitFullscreen() {
    this.setData({
      fullscreen: false,
      guideMode: 'spot',
      fuseSelected: '',
      buildCurrent: ''
    }, () => {
      this.pinchActive = false
      this.pinch = null
      this.pan = null
      this.codeShown = false
      this.view = null
      this.offscreenDirty = true
      this.drawPattern()
    })
  },

  pickGuideMode(e) {
    const mode = e.currentTarget.dataset.mode
    const patch = { guideMode: mode }
    if (mode === 'spot') patch.buildCurrent = ''
    if (mode === 'build') patch.fuseSelected = ''
    this.offscreenDirty = true
    this.setData(patch, () => this.drawGrid())
  },

  pickFuseSort(e) {
    const sort = e.currentTarget.dataset.sort
    if (!sort || sort === this.data.fuseSort) return
    const p = this.pattern
    this.setData({
      fuseSort: sort,
      fuseLegend: beading.buildLegend(p.grid, this.palette, this.bgMask, sort)
    })
  },

  updateDoneState(extra, callback) {
    const doneMap = {}
    this.buildDone.forEach((code) => { doneMap[code] = true })
    this.setData(Object.assign({ doneMap, buildDoneCount: this.buildDone.length }, extra || {}), callback)
  },

  onFuseChip(e) {
    const code = e.currentTarget.dataset.code
    if (!code) return
    const mode = this.data.guideMode
    if (mode === 'spot') {
      this.offscreenDirty = true
      this.setData({ fuseSelected: this.data.fuseSelected === code ? '' : code }, () => this.drawGrid())
      return
    }
    this.offscreenDirty = true
    // build 模式：已拼完的颜色不再直接撤回——点它只是设为“当前色”，按钮变为“撤回”；再点当前色则取消选中
    const next = this.data.buildCurrent === code ? '' : code
    this.setData({ guideMode: 'build', buildCurrent: next }, () => this.drawGrid())
  },

  finishColor() {
    const code = this.data.buildCurrent
    if (!code) return
    if (this.data.doneMap[code]) {
      // 撤回：只有点“撤回”按钮才真正取消一颗已拼完的颜色
      this.buildDone = this.buildDone.filter((item) => item !== code)
      beading.saveDone(this.pattern, this.buildDone)
      this.offscreenDirty = true
      this.updateDoneState({ buildCurrent: '' }, () => this.drawGrid())
      wx.showToast({ title: '已撤回', icon: 'none' })
      return
    }
    this.buildDone.push(code)
    beading.saveDone(this.pattern, this.buildDone)
    this.offscreenDirty = true
    const all = this.buildDone.length >= this.data.fuseLegend.length
    this.updateDoneState({ buildCurrent: '' }, () => this.drawGrid())
    wx.showToast({ title: all ? '全部拼完！' : '已点亮 ' + code, icon: all ? 'success' : 'none' })
  },

  startPan(t) {
    if (!this.view) return
    this.pan = { x: t.x, y: t.y, ox: this.view.ox, oy: this.view.oy }
  },

  handlePan(t) {
    if (!this.pan || !this.view) return
    this.view.ox = this.pan.ox + (t.x - this.pan.x)
    this.view.oy = this.pan.oy + (t.y - this.pan.y)
    this.clampView()
    this.scheduleRedraw()
  },

  goEdit() {
    wx.navigateTo({ url: '/page/pattern-edit/index' })
  },

  onExtraReqInput(e) {
    this.setData({ extraReq: e.detail.value })
  },

  switchToCandidate(i) {
    const s = this.aiSession
    if (!s || !s.candidates.length) return
    const next = session.switchCandidate(s, i)
    this.aiSession = next
    getApp().globalData.aiSession = next
    const cand = next.candidates[next.index]
    this.pattern.grid = cand.grid
    this.pattern.bgMask = cand.bgMask || null
    this.refreshBgMask()
    this.offscreenDirty = true
    this.setData({ candIndex: next.index + 1, candTotal: next.candidates.length })
    this.updateLegend()
    this.drawPattern()
  },

  onPrevCandidate() {
    const s = this.aiSession
    if (s && s.index > 0) this.switchToCandidate(s.index - 1)
  },

  onNextCandidate() {
    const s = this.aiSession
    if (s && s.index < s.candidates.length - 1) this.switchToCandidate(s.index + 1)
  },

  async onRegenerate() {
    const s = this.aiSession
    if (!s || !s.params) return
    // 先启动进度浮层，再执行内容安全检测，避免检测期间无任何反馈
    const prog = progressUtil.createProgress()
    progressUtil.startOverlay(this, prog)
    try {
      const req = this.data.extraReq.trim()
      prog.bump(2) // 内容安全检测
      try {
        if (await sec.checkText(req, 2)) {
          progressUtil.stopOverlay(this)
          wx.showToast({ title: '修改要求包含违规信息，请重新填写', icon: 'none' })
          return
        }
      } catch (err) {
        console.error('[sec-check]', err)
      }
      const p = s.params
      const extra = [p.extra, req].filter(Boolean).join('；')
      prog.bump(5) // 压缩原图
      const imageBase64 = await ai.compressToBase64(p.imagePath)
      prog.bump(10)
      let refImageBase64 = ''
      if (p.prevImage) {
        prog.bump(14) // 压缩上一版参考图
        refImageBase64 = await ai.compressToBase64(p.prevImage)
      }
      prog.climb(15, 88) // 等待出图（真实进度未知，按 2 分钟时间估算）
      const res = await ai.generateGrid({
        imageBase64,
        size: p.size,
        set: p.set,
        style: p.style,
        styleKey: p.styleKey,
        cutout: p.cutout,
        extra,
        refImageBase64,
        regenerate: !!refImageBase64,
        imageHash: s.imageHash,
        sessionId: s.sessionId
      })
      prog.bump(95) // 出图完成，解析映射
      p.extra = extra
      p.prevImage = res.prevImage
      this.aiSession = session.addCandidate(this.aiSession, res.grid, res.bgMask)
      getApp().globalData.aiSession = this.aiSession
      this.pattern.grid = res.grid
      this.pattern.bgMask = res.bgMask || null
      this.refreshBgMask()
      this.offscreenDirty = true
      this.setData({
        candIndex: this.aiSession.index + 1,
        candTotal: this.aiSession.candidates.length,
        extraReq: ''
      })
      prog.finish()
      progressUtil.stopOverlay(this)
      this.updateLegend()
      this.drawPattern()
    } catch (err) {
      progressUtil.stopOverlay(this)
      wx.showModal({ title: '生成失败', content: (err && err.message) || '请重试', showCancel: false })
    }
  },

  makeExportFile() {
    return exportUtil.renderPatternExport(this.pattern.grid, this.palette, {
      bgMask: this.bgMask,
      gridEvery: this.data.gridOn ? this.data.gridEvery : 0
    })
  },

  makeSquareJpeg(src, px) {
    return exportUtil.renderSquareJpeg(src, px)
  },
  makeGridJpeg(px) {
    return exportUtil.renderPatternJpeg(this.pattern.grid, this.palette, px, {
      bgMask: this.bgMask,
      gridEvery: this.data.gridOn ? this.data.gridEvery : 0
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
      const base = 'gallery/' + u.openid + '/' + ts
      const upload = (cloudPath, filePath) => wx.cloud.uploadFile({ cloudPath, filePath })
      // 压缩小图（不裁剪）：原图 ≤1280px、缩略图 360px / 预览图 1080px，JPEG
      const originalJpg = await this.makeSquareJpeg(this.pattern.imagePath, 1280)
      const originalThumb = await this.makeSquareJpeg(this.pattern.imagePath, 360)
      const patternThumb = await this.makeGridJpeg(360)
      const originalPreview = await this.makeSquareJpeg(this.pattern.imagePath, 1080)
      const patternPreview = await this.makeGridJpeg(1080)
      const original = await upload(base + '_original.jpg', originalJpg)
      const patternImg = await upload(base + '_pattern.png', patternFile)
      const originalThumbUp = await upload(base + '_original_thumb.jpg', originalThumb)
      const patternThumbUp = await upload(base + '_pattern_thumb.jpg', patternThumb)
      const originalPreviewUp = await upload(base + '_original_preview.jpg', originalPreview)
      const patternPreviewUp = await upload(base + '_pattern_preview.jpg', patternPreview)
      await user.saveGallery({
        originalFileID: original.fileID,
        patternFileID: patternImg.fileID,
        originalThumbFileID: originalThumbUp.fileID,
        patternThumbFileID: patternThumbUp.fileID,
        originalPreviewFileID: originalPreviewUp.fileID,
        patternPreviewFileID: patternPreviewUp.fileID,
        grid: pattern.serializeGrid(this.pattern.grid),
        bgMask: this.pattern.bgMask ? pattern.serializeBgMask(this.bgMask) : undefined,
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

  saveToAlbum(filePath) {
    wx.saveImageToPhotosAlbum({
      filePath,
      success: () => {
        wx.hideLoading()
        wx.showToast({ title: '已保存到相册', icon: 'success' })
        if (!this.pattern.galleryId) this.saveToGallery()
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
