// miniprogram/page/gallery/index.js
const user = require('../../utils/user.js')
const pager = require('../../utils/pager.js')
const pattern = require('../../utils/pattern.js')
const color = require('../../utils/color.js')
const exportUtil = require('../../utils/export.js')
const PAGE_SIZE = 10

function downloadFile(fileID, ms) {
  return Promise.race([
    wx.cloud.downloadFile({ fileID }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('下载超时')), ms || 60000))
  ]).then((res) => res.tempFilePath)
}

function formatTime(d) {
  if (!d) return ''
  const date = new Date(d)
  const p = (n) => (n < 10 ? '0' + n : '' + n)
  return (
    date.getFullYear() + '-' + p(date.getMonth() + 1) + '-' + p(date.getDate()) +
    ' ' + p(date.getHours()) + ':' + p(date.getMinutes())
  )
}

Page({
  data: {
    items: [],
    page: 1,
    totalPages: 1,
    total: 0,
    pageNos: [1],
    loading: false
  },
  onShow() {
    this.load(1)
  },
  async load(page) {
    if (this.data.loading) return
    this.setData({ loading: true })
    try {
      const r = await user.listGallery(page, PAGE_SIZE)
      const p = r.page || page
      const items = (r.items || []).map((it) =>
        Object.assign({}, it, {
          timeText: formatTime(it.createdAt),
          styleShort: (it.style || '').split(/[：:]/)[0].trim()
        })
      )
      this.setData({
        items,
        page: p,
        totalPages: r.totalPages || 1,
        total: r.total || 0,
        pageNos: pager.pageWindow(r.totalPages || 1, p)
      })
      this.backfillThumbs(items)
    } catch (err) {
      wx.showToast({ title: (err && err.message) || '图库加载失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },
  goPage(e) {
    const n = Number(e.currentTarget.dataset.page)
    if (!n || isNaN(n) || n === this.data.page || n < 1 || n > this.data.totalPages) return
    this.load(n)
  },
  onPreview(e) {
    const fileID = e.currentTarget.dataset.fileid
    const pair = this.data.items.find((it) => it.originalFileID === fileID || it.patternFileID === fileID)
    if (!fileID || !pair) return
    // 预览直接传 cloud:// 云文件 ID（基础库 2.2.3+ 支持），优先压缩预览图，老数据回退缩略图/原图
    const isOriginal = fileID === pair.originalFileID
    const pick = (it) => it.originalPreviewFileID || it.originalThumbFileID || it.originalFileID
    const ppick = (it) => it.patternPreviewFileID || it.patternThumbFileID || it.patternFileID
    const urls = isOriginal ? [pick(pair), ppick(pair)] : [ppick(pair), pick(pair)]
    wx.previewImage({ urls, current: urls[0] })
  },

  async onEdit(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    wx.showLoading({ title: '加载图纸…', mask: true })
    try {
      const r = await user.getGalleryItem(id)
      const item = r.item
      if (!item.grid) throw new Error('该图纸暂无像素数据，无法编辑')
      const grid = pattern.parseGrid(item.grid, item.size)
      const bgMask = item.bgMask ? pattern.parseBgMask(item.bgMask, item.size) : undefined
      getApp().globalData.pattern = {
        grid,
        size: item.size,
        set: item.set,
        mode: item.mode || 'photo',
        style: item.style || '',
        bgMask: bgMask || null,
        galleryId: id,
        imagePath: ''
      }
      wx.hideLoading()
      wx.navigateTo({ url: '/page/pattern-edit/index' })
    } catch (err) {
      wx.hideLoading()
      wx.showToast({ title: (err && err.message) || '图纸加载失败', icon: 'none' })
    }
  },

  // 导出图纸：与生成后的导出同一逻辑（取回 grid → 生成带编号与数目的图纸 → 保存相册）
  async onExport(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    wx.showLoading({ title: '生成图纸…', mask: true })
    try {
      const r = await user.getGalleryItem(id)
      const item = r.item
      if (!item.grid) throw new Error('该图纸暂无像素数据，无法导出')
      const grid = pattern.parseGrid(item.grid, item.size)
      const palette = color.buildPalette(item.set)
      const bgMask = pattern.parseBgMask(item.bgMask, item.size) || pattern.findBackgroundMask(grid, pattern.findWhiteishCodes(palette))
      const filePath = await exportUtil.renderPatternExport(grid, palette, { bgMask, gridEvery: 5 })
      wx.hideLoading()
      this.saveToAlbum(filePath)
    } catch (err) {
      wx.hideLoading()
      wx.showToast({ title: (err && err.message) || '导出失败', icon: 'none' })
    }
  },

  saveToAlbum(filePath) {
    wx.saveImageToPhotosAlbum({
      filePath,
      success: () => {
        wx.showToast({ title: '已保存到相册', icon: 'success' })
      },
      fail: (err) => {
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
  },

  // 老数据回填：缺缩略图/预览图时后台下载全图 → 压缩 → 上传 → 更新记录（一次性，失败静默）
  async backfillThumbs(items) {
    if (this._backfilling) return
    this._backfilling = true
    try {
      const u = getApp().globalData.user
      if (!u || !u.openid) return
      for (const it of items) {
        const need = []
        if (it.originalFileID && !it.originalThumbFileID) need.push(['originalThumbFileID', it.originalFileID, 360])
        if (it.originalFileID && !it.originalPreviewFileID) need.push(['originalPreviewFileID', it.originalFileID, 1080])
        if (it.patternFileID && !it.patternThumbFileID) need.push(['patternThumbFileID', it.patternFileID, 360])
        if (it.patternFileID && !it.patternPreviewFileID) need.push(['patternPreviewFileID', it.patternFileID, 1080])
        if (!need.length) continue
        const ts = Date.now()
        const base = 'gallery/' + u.openid + '/' + ts + '_backfill'
        const updates = {}
        for (let i = 0; i < need.length; i++) {
          const field = need[i][0]
          const fileID = need[i][1]
          const px = need[i][2]
          const tmp = await downloadFile(fileID, 60000)
          const small = await exportUtil.renderSquareJpeg(tmp, px)
          const up = await wx.cloud.uploadFile({ cloudPath: base + '_' + field + '.jpg', filePath: small })
          updates[field] = up.fileID
        }
        await user.updateGallery(Object.assign({ id: it._id }, updates))
        const idx = this.data.items.findIndex((x) => x._id === it._id)
        if (idx >= 0) {
          const items2 = this.data.items.slice()
          items2[idx] = Object.assign({}, items2[idx], updates)
          this.setData({ items: items2 })
        }
      }
    } catch (err) {
      // 回填失败不影响列表展示
    } finally {
      this._backfilling = false
    }
  },

  onDelete(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    wx.showModal({
      title: '删除图库条目',
      content: '删除后不可恢复，原图与图纸将从图库移除，确定删除？',
      confirmText: '删除',
      confirmColor: '#ff3a5d',
      success: async (r) => {
        if (!r.confirm) return
        wx.showLoading({ title: '删除中…', mask: true })
        try {
          await user.deleteGallery(id)
          wx.hideLoading()
          wx.showToast({ title: '已删除', icon: 'success' })
          // 当前页只剩 1 条且非首页时回退一页，否则刷新当前页
          if (this.data.items.length <= 1 && this.data.page > 1) {
            this.load(this.data.page - 1)
          } else {
            this.load(this.data.page)
          }
        } catch (err) {
          wx.hideLoading()
          wx.showToast({ title: (err && err.message) || '删除失败', icon: 'none' })
        }
      }
    })
  },

  async onPullDownRefresh() {
    await this.load(this.data.page)
    wx.stopPullDownRefresh()
  }
})
