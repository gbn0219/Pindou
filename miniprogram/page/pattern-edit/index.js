// miniprogram/page/pattern-edit/index.js
const pattern = require('../../utils/pattern.js')
const color = require('../../utils/color.js')

const CODE_MIN_SCALE = 0.65 // 格子放大到该倍数以上才显示编号

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

Page({
  data: {
    groups: [],
    selected: '',
    cellInfo: '点选颜色，再点格子涂色',
    scale: 0.3,
    canvasPx: 0,
    viewX: 0,
    viewY: 0,
    initScale: 0.3
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
    this.highlight = null
    this.setData({
      groups: this.buildGroups(),
      selected: this.palette[0].code
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
    this.codeShown = false
    this.createSelectorQuery()
      .select('#canvasArea')
      .boundingClientRect()
      .select('#editCanvas')
      .fields({ node: true, size: true })
      .exec((res) => {
        const area = res && res[0]
        const canvas = res && res[1] && res[1].node
        if (!canvas || !area || !area.width || !area.height) {
          // 布局尚未成型（尺寸为 0）或节点未就绪时重试，避免用无效尺寸把画布放到视野外
          this.retryDraw = (this.retryDraw || 0) + 1
          if (this.retryDraw <= 8) setTimeout(() => this.draw(), 120)
          return
        }
        this.retryDraw = 0
        try {
          const total = p.size * (pattern.CELL + pattern.GAP) - pattern.GAP
          const areaW = area.width
          const areaH = area.height
          const initScale = Math.max(0.14, Math.min(1, Math.min(areaW, areaH) / total))
          this.setData(
            {
              canvasPx: total,
              viewX: (areaW - total) / 2,
              viewY: (areaH - total) / 2,
              initScale: Number(initScale.toFixed(3)),
              scale: Number(initScale.toFixed(3))
            },
            () => {
              canvas.width = total
              canvas.height = total
              const ctx = canvas.getContext('2d')
              pattern.renderGrid(ctx, p.grid, this.palette, {
                cellSize: pattern.CELL,
                gap: pattern.GAP,
                code: this.codeShown,
                highlight: this.highlight
              })
              this.canvas = canvas
              this.ctx = ctx
            }
          )
        } catch (err) {
          console.error('draw error', err)
        }
      })
  },

  onScale(e) {
    const s = e.detail.scale
    this.setData({ scale: s })
    const show = s >= CODE_MIN_SCALE
    if (show !== this.codeShown) {
      this.codeShown = show
      this.redrawCanvas()
    }
  },

  redrawCanvas() {
    if (!this.canvas || !this.ctx) return
    pattern.renderGrid(this.ctx, this.pattern.grid, this.palette, {
      cellSize: pattern.CELL,
      gap: pattern.GAP,
      code: this.codeShown,
      highlight: this.highlight
    })
  },

  onTouchStart(e) {
    const t = e.touches && e.touches[0]
    if (!t) return
    const p = this.pattern
    const cell = pattern.CELL + pattern.GAP
    const col = Math.floor(t.x / this.data.scale / cell)
    const row = Math.floor(t.y / this.data.scale / cell)
    if (row < 0 || col < 0 || row >= p.size || col >= p.size) return

    const prev = this.highlight
    p.grid[row][col] = this.data.selected
    this.highlight = { row, col }
    this.setData({ cellInfo: '第 ' + (row + 1) + ' 行 · 第 ' + (col + 1) + ' 列 · ' + p.grid[row][col] })

    const base = { cellSize: pattern.CELL, gap: pattern.GAP }
    if (prev) pattern.drawCell(this.ctx, p.grid, prev.row, prev.col, this.palette, base)
    pattern.drawCell(this.ctx, p.grid, row, col, this.palette, Object.assign({}, base, { highlight: true }))
  },

  pickColor(e) {
    this.setData({ selected: e.currentTarget.dataset.code })
  },

  finish() {
    wx.navigateBack()
  }
})
