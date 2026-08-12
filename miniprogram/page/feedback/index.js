// miniprogram/page/feedback/index.js
const user = require('../../utils/user.js')

Page({
  data: {
    content: '',
    submitting: false
  },
  onContentInput(e) {
    this.setData({ content: e.detail.value })
  },
  async submit() {
    if (this.data.submitting) return
    const content = this.data.content.trim()
    if (!content) {
      wx.showToast({ title: '请填写反馈内容', icon: 'none' })
      return
    }
    this.setData({ submitting: true })
    try {
      const sys = wx.getSystemInfoSync()
      const device = [sys.platform, sys.system, '基础库 ' + (sys.SDKVersion || '')].filter(Boolean).join(' / ')
      await user.submitFeedback({ content, device })
      wx.showToast({ title: '感谢反馈', icon: 'success' })
      setTimeout(() => wx.navigateBack(), 800)
    } catch (err) {
      wx.showToast({ title: '提交失败，请重试', icon: 'none' })
    } finally {
      this.setData({ submitting: false })
    }
  }
})
