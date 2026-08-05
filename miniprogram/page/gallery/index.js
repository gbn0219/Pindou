// miniprogram/page/gallery/index.js
const user = require('../../utils/user.js')
const pager = require('../../utils/pager.js')
const PAGE_SIZE = 10

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
    // 优先用列表已带回来的临时 URL，避免二次请求
    const byId = {}
    if (pair.originalURL) byId[pair.originalFileID] = pair.originalURL
    if (pair.patternURL) byId[pair.patternFileID] = pair.patternURL
    const show = (urls) => wx.previewImage({ urls, current: byId[fileID] || urls[0] })
    if (byId[pair.originalFileID] && byId[pair.patternFileID]) {
      show([byId[pair.originalFileID], byId[pair.patternFileID]])
      return
    }
    wx.showLoading({ title: '加载中…', mask: true })
    wx.cloud.getTempFileURL({ fileList: [pair.originalFileID, pair.patternFileID] })
      .then((res) => {
        const list = res.fileList || []
        list.forEach((f) => { if (f.tempFileURL) byId[f.fileID] = f.tempFileURL })
        const urls = [pair.originalFileID, pair.patternFileID].map((id) => byId[id]).filter(Boolean)
        if (!urls.length) throw new Error('empty')
        wx.hideLoading()
        show(urls)
      })
      .catch(() => {
        wx.hideLoading()
        wx.showToast({ title: '图片加载失败', icon: 'none' })
      })
  },
  async onPullDownRefresh() {
    await this.load(this.data.page)
    wx.stopPullDownRefresh()
  }
})
