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
        Object.assign({}, it, { timeText: formatTime(it.createdAt) })
      )
      this.setData({
        items,
        page: p,
        totalPages: r.totalPages || 1,
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
  onSave(e) {
    const fileID = e.currentTarget.dataset.fileid
    if (!fileID) return
    wx.showModal({
      title: '保存到相册',
      content: '保存这张图片到手机相册？',
      success: (r) => {
        if (!r.confirm) return
        wx.showLoading({ title: '保存中…', mask: true })
        wx.cloud.downloadFile({ fileID })
          .then((res) => new Promise((resolve, reject) => {
            wx.saveImageToPhotosAlbum({ filePath: res.tempFilePath, success: resolve, fail: reject })
          }))
          .then(() => {
            wx.hideLoading()
            wx.showToast({ title: '已保存到相册', icon: 'success' })
          })
          .catch(() => {
            wx.hideLoading()
            wx.showToast({ title: '保存失败', icon: 'none' })
          })
      }
    })
  }
})
