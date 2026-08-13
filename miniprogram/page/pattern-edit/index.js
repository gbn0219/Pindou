// miniprogram/page/pattern-edit/index.js
const pattern = require('../../utils/pattern.js')
const color = require('../../utils/color.js')
const gesture = require('../../utils/gesture.js')
const exportUtil = require('../../utils/export.js')
const user = require('../../utils/user.js')

const MAX_HISTORY = 30 // 撤销/重做最大步数（单格修改、批量替换各算一步）

const FAMILY_LABELS = {
  A: '黄橙',
  B: '绿',
  C: '蓝青',
  D: '紫',
  E: '粉',
  F: '红',
  G: '棕肤',
  H: '黑白灰',
  M: '中性'
}

const MODE_HINTS = {
  paint: '点选颜色后，点格子涂色（单指拖动连续涂色，双指缩放/移动）',
  replace: '先在图纸上点选源色，再到调色盘点目标色',
  pick: '点图纸上的格子，吸取该格颜色'
}

const OFFSCREEN_MAX_SCALE = 0.4 // 低倍率（<=0.4）用离屏层贴图，超过后逐格直绘可见格子

Page({
  data: {
    groups: [],
    selected: '',
    selectedHex: '',
    mode: 'paint', // 'paint' 涂色 | 'replace' 批量换色 | 'pick' 吸取颜色
    replaceSource: '',
    canUndo: false,
    canRedo: false,
    fromGallery: false,
    saving: false,
    cellInfo: MODE_HINTS.paint
  },

  onLoad() {
    const p = getApp().globalData.pattern
    if (!p || !p.grid) {
      wx.showToast({ title: '没有可修改的图纸', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 800)
      return
    }
    this.pattern = p
    this.palette = color.buildPalette(p.set)
    this.whiteCodes = pattern.findWhiteishCodes(this.palette) // 套装中的白色系（纯白/近白/奶油白）
    // 背景掩码：优先用生成时识别的洋红背景掩码，照片模式回退白色连通域；
    // 用户编辑过的格子（含涂回白色 H1）一律视为前景
    this.baseBgMask = p.bgMask || null
    this.editedMask = p.grid.map((row) => row.map(() => false))
    this.refreshBgMask()
    this.highlight = null
    this.history = [] // 撤销栈：每次修改前的网格快照，最多 MAX_HISTORY 步
    this.redoStack = [] // 重做栈
    const first = this.palette[0]
    this.setData({
      groups: this.buildGroups(),
      selected: first.code,
      selectedHex: first.hex,
      fromGallery: !!(p.galleryId)
    })
  },

  buildGroups() {
    const groups = []
    let current = null
    for (const item of this.palette) {
      const family = item.code.charAt(0)
      if (!current || current.family !== family) {
        current = {
          family,
          label: FAMILY_LABELS[family] || family,
          items: []
        }
        groups.push(current)
      }
      current.items.push({ code: item.code, hex: item.hex })
    }
    return groups
  },

  onShow() {
    if (this.pattern && this.canvas) this.draw()
  },

  onReady() {
    this.draw()
  },

  draw() {
    const p = this.pattern
    if (!p) return
    this.createSelectorQuery()
      .select('#canvasArea')
      .boundingClientRect()
      .select('#editCanvas')
      .fields({ node: true, size: true })
      .exec((res) => {
        const area = res && res[0]
        const canvas = res && res[1] && res[1].node
        if (!canvas || !area || !area.width || !area.height) {
          // 布局尚未成型（尺寸为 0）或节点未就绪时重试
          this.retryDraw = (this.retryDraw || 0) + 1
          if (this.retryDraw <= 8) setTimeout(() => this.draw(), 120)
          return
        }
        this.retryDraw = 0
        try {
          this.areaRect = { left: area.left || 0, top: area.top || 0 } // 触摸用视口坐标换算
          const cell = pattern.displayCell(p.size) // 大盘面自动降低格边长，避免画布超限
          this.cellPx = cell
          const total = p.size * (cell + pattern.GAP) - pattern.GAP
          const areaW = area.width
          const areaH = area.height
          // 首次进入铺满视图并隐藏编号；切后台再回来保留缩放倍数/位置/编号显示状态
          if (!this.view) {
            this.codeShown = false
            // 内容区 = 画布减去四周坐标条；网格只在内区铺放，坐标条不遮挡格子
            const ruler = pattern.RULER_SIZE
            const innerW = areaW - ruler * 2
            const innerH = areaH - ruler * 2
            const scale = Math.max(0.05, Math.min(1, Math.min(innerW, innerH) / total))
            this.view = {
              scale,
              ox: ruler + (innerW - total * scale) / 2,
              oy: ruler + (innerH - total * scale) / 2
            }
          }
          canvas.width = areaW
          canvas.height = areaH
          this.canvas = canvas
          this.ctx = canvas.getContext('2d')
          this.drawGrid()
        } catch (err) {
          console.error('draw error', err)
        }
      })
  },

  ensureOffscreen() {
    if (this.offscreen && !this.offscreenDirty) return this.offscreen
    const cell = this.cellPx || pattern.CELL
    const total = this.pattern.size * (cell + pattern.GAP) - pattern.GAP
    const off = wx.createOffscreenCanvas({ type: '2d', width: total, height: total })
    pattern.renderGrid(off.getContext('2d'), this.pattern.grid, this.palette, {
      cellSize: cell,
      gap: pattern.GAP,
      code: false,
      noCodeMask: this.bgMask
    })
    this.offscreen = off
    this.offscreenDirty = false
    return off
  },

  drawHighlightOverlay() {
    const h = this.highlight
    if (!h || !this.view) return
    const cellPx = this.cellPx || pattern.CELL
    const x = h.col * (cellPx + pattern.GAP) + 1
    const y = h.row * (cellPx + pattern.GAP) + 1
    this.ctx.strokeStyle = '#ff3a5d'
    this.ctx.lineWidth = Math.max(2, Math.round(cellPx / 6))
    this.ctx.strokeRect(x, y, cellPx - 2, cellPx - 2)
  },

  applyView() {
    const v = this.view
    if (!this.ctx || !v) return
    this.ctx.setTransform(v.scale, 0, 0, v.scale, v.ox, v.oy)
  },

  clampView() {
    const p = this.pattern
    const cell = this.cellPx || pattern.CELL
    const total = p.size * (cell + pattern.GAP) - pattern.GAP
    this.view = gesture.clampView(this.view, total, this.canvas.width, this.canvas.height, pattern.RULER_SIZE)
  },

  drawGrid() {
    if (!this.canvas || !this.ctx) return
    // 先以单位变换清空整块画布，否则缩放/拖动后旧图残留在原位（残影）
    this.ctx.setTransform(1, 0, 0, 1, 0, 0)
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
    this.applyView()
    if (this.view.scale <= OFFSCREEN_MAX_SCALE) {
      // 低倍率：贴离屏静态层，避免每帧重绘全部格子
      this.ctx.drawImage(this.ensureOffscreen(), 0, 0)
      this.drawHighlightOverlay()
    } else {
      // 高倍率：只重绘屏幕上可见的格子，任意放大不糊
      pattern.renderGridView(this.ctx, this.pattern.grid, this.palette, {
        cellSize: this.cellPx || pattern.CELL,
        gap: pattern.GAP,
        code: this.codeShown,
        highlight: this.highlight,
        noCodeMask: this.bgMask,
        view: this.view,
        areaW: this.canvas.width,
        areaH: this.canvas.height
      })
    }
    // 坐标轴固定在画布四周（屏幕空间），不随内容缩放/移动；密度按可见格数自适应
    pattern.renderRulers(this.ctx, this.view, this.pattern.grid.length, this.cellPx || pattern.CELL, pattern.GAP, this.canvas.width, this.canvas.height)
  },

  redrawCanvas() {
    if (!this.canvas || !this.ctx) return
    this.refreshBgMask()
    this.offscreenDirty = true
    this.drawGrid()
  },

  // 背景掩码：AI 抠图用生成时的洋红掩码，照片模式回退白色连通域；
  // 用户编辑过的格子一律视为前景（即使涂回白色 H1），编辑后把掩码回写 pattern
  refreshBgMask() {
    const p = this.pattern
    const base = this.baseBgMask || pattern.findBackgroundMask(p.grid, this.whiteCodes)
    this.bgMask = pattern.applyEditedMask(base, this.editedMask)
    if (p && (p.bgMask || this.hasEdits())) p.bgMask = this.bgMask
  },

  hasEdits() {
    return this.editedMask.some((row) => row.some(Boolean))
  },

  // 触摸坐标统一换算为画布/可视区域坐标（视口坐标 - 区域左上角），避免 canvas 触摸的已知问题
  normTouch(t) {
    const r = this.areaRect || { left: 0, top: 0 }
    return { x: t.clientX - r.left, y: t.clientY - r.top }
  },

  onTouchStart(e) {
    const touches = e.touches
    if (touches.length >= 2) {
      // 双指：开始缩放 + 拖动（连续手势）
      this.startPinch(this.normTouch(touches[0]), this.normTouch(touches[1]))
      return
    }
    const t = touches && touches[0]
    if (!t) return
    this.pinchActive = false
    this.pinch = null
    this.paintStroke = false
    this.strokePushed = false
    const p = this.normTouch(t)
    // 先只记录起点：涂色模式拖动超过阈值后连续涂色
    this.tapStart = { x: p.x, y: p.y, time: Date.now(), moved: false }
    this.tapCell = this.cellAt(p.x, p.y)
  },

  onTouchMove(e) {
    const touches = e.touches
    // 双指手势期间（即使只剩一指）不涂色、不跳变，等全部抬起再响应单指
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
    const t = touches && touches[0]
    if (!t || !this.tapStart) return
    const p = this.normTouch(t)
    if (Math.abs(p.x - this.tapStart.x) > 16 || Math.abs(p.y - this.tapStart.y) > 16) {
      this.tapStart.moved = true
    }
    // 涂色模式：单指拖动连续涂色（整段拖动只算一步撤销）
    if (this.data.mode === 'paint' && this.tapStart.moved && this.tapCell) {
      const pos = this.cellAt(p.x, p.y)
      if (!pos) return
      if (!this.paintStroke) {
        this.paintStroke = true
        this.lastPaint = { row: this.tapCell.row, col: this.tapCell.col }
        this.paintCell(this.lastPaint.row, this.lastPaint.col, true)
      }
      this.paintPath(this.lastPaint, pos)
      this.lastPaint = pos
    }
  },

  onTouchEnd(e) {
    // 仍有手指按着（双指变一指）：保持手势状态，等全部抬起再清理
    if (e.touches && e.touches.length > 0) return
    const wasStroke = this.paintStroke
    this.paintStroke = false
    this.strokePushed = false
    this.pinchActive = false
    this.pinch = null
    if (wasStroke) {
      this.tapStart = null
      this.setData({ cellInfo: '已涂色，可撤销' })
      return
    }
    const start = this.tapStart
    this.tapStart = null
    if (!start || start.moved) return
    const t = e.changedTouches && e.changedTouches[0]
    if (!t) return
    const p = this.normTouch(t)
    // 位移小于 16px 且 400ms 内抬起才算轻点，才触发当前工具
    if (Math.abs(p.x - start.x) > 16 || Math.abs(p.y - start.y) > 16 || Date.now() - start.time > 400) return
    const pos = this.cellAt(p.x, p.y)
    if (!pos) return
    this.onCellTap(pos.row, pos.col)
  },

  onTouchCancel() {
    this.tapStart = null
    this.pinch = null
    this.pinchActive = false
    this.paintStroke = false
    this.strokePushed = false
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
    this.tapStart = null
    this.paintStroke = false
    this.strokePushed = false
  },

  handlePinch(t1, t2) {
    if (!this.pinch || !this.view) return
    this.view = gesture.viewportPinchStep(this.pinch, this.view, t1, t2)
    this.clampView()
    const range = pattern.visibleRange(this.view, this.pattern.grid.length, this.cellPx || pattern.CELL, pattern.GAP, this.canvas.width, this.canvas.height)
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

  paintPath(from, to) {
    const dr = to.row - from.row
    const dc = to.col - from.col
    const steps = Math.max(Math.abs(dr), Math.abs(dc))
    if (steps <= 0) {
      this.paintCell(to.row, to.col, true)
      return
    }
    for (let i = 1; i <= steps; i++) {
      const r = Math.round(from.row + (dr * i) / steps)
      const c = Math.round(from.col + (dc * i) / steps)
      this.paintCell(r, c, true)
    }
  },

  cellAt(x, y) {
    const p = this.pattern
    const v = this.view
    if (!v || !v.scale) return null
    const cell = (this.cellPx || pattern.CELL) + pattern.GAP
    const lx = (x - v.ox) / v.scale
    const ly = (y - v.oy) / v.scale
    const col = Math.floor(lx / cell)
    const row = Math.floor(ly / cell)
    if (row < 0 || col < 0 || row >= p.size || col >= p.size) return null
    return { row, col }
  },

  onCellTap(row, col) {
    const mode = this.data.mode
    if (mode === 'replace') {
      this.pickReplaceSource(row, col)
    } else if (mode === 'pick') {
      this.pickCell(row, col)
    } else {
      this.paintCell(row, col)
    }
  },

  paintCell(row, col, isStroke) {
    const p = this.pattern
    const code = this.data.selected
    const gridChanged = p.grid[row][col] !== code
    const maskChanged = !this.editedMask[row][col]
    if (gridChanged || maskChanged) {
      if (isStroke) {
        // 拖动涂色：整段拖动只记一步撤销
        if (!this.strokePushed) {
          this.pushHistory()
          this.strokePushed = true
        }
      } else {
        this.pushHistory()
      }
      if (gridChanged) p.grid[row][col] = code
      this.editedMask[row][col] = true
      this.refreshBgMask()
      this.offscreenDirty = true
    }
    const prev = this.highlight
    this.highlight = { row, col }
    if (!isStroke) {
      this.setData({ cellInfo: '第 ' + (row + 1) + ' 行 · 第 ' + (col + 1) + ' 列 · ' + p.grid[row][col] })
    }
    const base = { cellSize: this.cellPx || pattern.CELL, gap: pattern.GAP }
    this.applyView()
    if (prev) pattern.drawCell(this.ctx, p.grid, prev.row, prev.col, this.palette, base)
    pattern.drawCell(this.ctx, p.grid, row, col, this.palette, Object.assign({}, base, { highlight: true }))
  },

  // 换色模式：点图纸上的格子取源色
  pickReplaceSource(row, col) {
    const p = this.pattern
    const code = p.grid[row][col]
    this.replaceSource = code
    this.highlight = { row, col }
    this.setData({
      replaceSource: code,
      cellInfo: '已选源色 ' + code + '（' + pattern.countColor(p.grid, code) + ' 格），再点调色盘选目标色'
    })
    this.redrawCanvas()
  },

  // 换色模式：点调色盘颜色作为目标色，确认后全图替换
  pickReplaceTarget(code) {
    const p = this.pattern
    if (!this.replaceSource) {
      wx.showToast({ title: '先在图纸上点选源色', icon: 'none' })
      return
    }
    if (code === this.replaceSource) {
      wx.showToast({ title: '目标色与源色相同', icon: 'none' })
      return
    }
    const source = this.replaceSource
    const count = pattern.countColor(p.grid, source)
    wx.showModal({
      title: '批量换色',
      content: '将图纸中所有 ' + source + '（共 ' + count + ' 格）替换为 ' + code + '？',
      confirmText: '替换',
      success: (r) => {
        if (!r.confirm) return
        this.pushHistory()
        const before = this.history[this.history.length - 1].grid
        const replaced = pattern.replaceColor(p.grid, source, code)
        for (let r = 0; r < p.grid.length; r++) {
          for (let c = 0; c < p.grid[r].length; c++) {
            if (before[r][c] !== p.grid[r][c]) this.editedMask[r][c] = true
          }
        }
        this.highlight = null
        this.replaceSource = ''
        this.setData({
          replaceSource: '',
          selected: code,
          selectedHex: this.hexOf(code),
          cellInfo: '已将 ' + replaced + ' 格 ' + source + ' 替换为 ' + code
        })
        this.redrawCanvas()
      }
    })
  },

  // 吸色模式：点格子吸取该格颜色，自动回到涂色模式直接使用
  pickCell(row, col) {
    const p = this.pattern
    const code = p.grid[row][col]
    const hex = this.hexOf(code)
    this.highlight = { row, col }
    this.setData({
      selected: code,
      selectedHex: hex,
      mode: 'paint',
      cellInfo: '已吸取 ' + code + '（' + hex + '），可直接涂色或换色'
    })
    this.redrawCanvas()
  },

  pickColor(e) {
    const code = e.currentTarget.dataset.code
    if (this.data.mode === 'replace') {
      this.pickReplaceTarget(code)
      return
    }
    this.setData({ selected: code, selectedHex: this.hexOf(code) })
  },

  pickEditMode(e) {
    const mode = e.currentTarget.dataset.mode
    this.replaceSource = ''
    this.setData({
      mode,
      replaceSource: '',
      cellInfo: MODE_HINTS[mode] || MODE_HINTS.paint
    })
  },

  hexOf(code) {
    const item = this.palette.find((i) => i.code === code)
    return item ? item.hex : ''
  },

  snapshot() {
    return {
      grid: this.pattern.grid.map((row) => row.slice()),
      edited: this.editedMask.map((row) => row.slice())
    }
  },

  pushHistory() {
    this.history.push(this.snapshot())
    if (this.history.length > MAX_HISTORY) this.history.shift()
    this.redoStack = []
    this.updateHistoryButtons()
  },

  undo() {
    if (!this.history.length) return
    this.redoStack.push(this.snapshot())
    if (this.redoStack.length > MAX_HISTORY) this.redoStack.shift()
    const snap = this.history.pop()
    this.pattern.grid = snap.grid
    this.editedMask = snap.edited
    this.highlight = null
    this.updateHistoryButtons()
    this.redrawCanvas()
    this.setData({ cellInfo: '已撤销（剩余 ' + this.history.length + ' 步可撤销）' })
  },

  redo() {
    if (!this.redoStack.length) return
    this.history.push(this.snapshot())
    if (this.history.length > MAX_HISTORY) this.history.shift()
    const snap = this.redoStack.pop()
    this.pattern.grid = snap.grid
    this.editedMask = snap.edited
    this.highlight = null
    this.updateHistoryButtons()
    this.redrawCanvas()
    this.setData({ cellInfo: '已重做' })
  },

  updateHistoryButtons() {
    this.setData({ canUndo: this.history.length > 0, canRedo: this.redoStack.length > 0 })
  },

  async save() {
    if (this.data.saving) return
    const p = this.pattern
    if (!p || !p.galleryId) {
      wx.navigateBack()
      return
    }
    this.setData({ saving: true })
    wx.showLoading({ title: '保存中…', mask: true })
    try {
      this.refreshBgMask()
      const patternFile = await exportUtil.renderPatternExport(p.grid, this.palette, { bgMask: this.bgMask, gridEvery: 5 })
      const thumb = await exportUtil.renderPatternJpeg(p.grid, this.palette, 360, { bgMask: this.bgMask, gridEvery: 5 })
      const preview = await exportUtil.renderPatternJpeg(p.grid, this.palette, 1080, { bgMask: this.bgMask, gridEvery: 5 })
      const u = getApp().globalData.user
      if (!u || !u.openid) throw new Error('请先登录')
      const ts = Date.now()
      const base = 'gallery/' + u.openid + '/' + ts
      const upload = (cloudPath, filePath) => wx.cloud.uploadFile({ cloudPath, filePath })
      const patternUp = await upload(base + '_pattern_edited.png', patternFile)
      const thumbUp = await upload(base + '_pattern_thumb.jpg', thumb)
      const previewUp = await upload(base + '_pattern_preview.jpg', preview)
      await user.updateGallery({
        id: p.galleryId,
        patternFileID: patternUp.fileID,
        patternThumbFileID: thumbUp.fileID,
        patternPreviewFileID: previewUp.fileID,
        grid: pattern.serializeGrid(p.grid),
        bgMask: p.bgMask ? pattern.serializeBgMask(this.bgMask) : undefined
      })
      wx.hideLoading()
      wx.showToast({ title: '已保存到图库', icon: 'success' })
      setTimeout(() => wx.navigateBack(), 600)
    } catch (err) {
      wx.hideLoading()
      wx.showToast({ title: (err && err.message) || '保存失败', icon: 'none' })
    } finally {
      this.setData({ saving: false })
    }
  },

  finish() {
    wx.navigateBack()
  }
})
