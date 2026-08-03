// miniprogram/page/pattern-edit/index.js
const pattern = require('../../utils/pattern.js')
const color = require('../../utils/color.js')

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
    scale: 1
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

  onReady() {
    this.draw()
  },

  draw() {
    const p = this.pattern
    this.createSelectorQuery()
      .select('#editCanvas')
      .fields({ node: true, size: true })
      .exec((res) => {
        if (!res || !res[0]) return
        const canvas = res[0].node
        const total = p.size * (pattern.CELL + pattern.GAP) - pattern.GAP
        canvas.width = total
        canvas.height = total
        const ctx = canvas.getContext('2d')
        pattern.renderGrid(ctx, p.grid, this.palette, {
          cellSize: pattern.CELL,
          gap: pattern.GAP,
          code: true,
          highlight: this.highlight
        })
        this.canvas = canvas
        this.ctx = ctx
      })
  },

  onScale(e) {
    this.setData({ scale: e.detail.scale })
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
