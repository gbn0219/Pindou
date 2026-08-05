// miniprogram/page/profile/index.js
const user = require('../../utils/user.js')
Page({
  data: {
    user: null,
    openidTail: '',
    loading: false,
    inviteCode: ''
  },
  onShow() {
    this.refresh()
  },
  async refresh() {
    try {
      const u = await getApp().ensureLogin()
      this.setData({ user: u, openidTail: u.openid ? u.openid.slice(-6) : '' })
    } catch (e) {
      console.error('登录状态刷新失败', e)
      this.setData({ user: null, openidTail: '' })
    }
  },
  async onLogin() {
    this.setData({ loading: true })
    try {
      const u = await getApp().ensureLogin()
      this.setData({ user: u, openidTail: u.openid ? u.openid.slice(-6) : '' })
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '登录失败', icon: 'none' })
      console.error('登录失败', e)
    } finally {
      this.setData({ loading: false })
    }
  },
  async onChooseAvatar(e) {
    const filePath = e.detail.avatarUrl
    if (!filePath || !this.data.user) return
    wx.showLoading({ title: '上传中…', mask: true })
    try {
      const ext = (filePath.match(/\.(\w+)$/) || [ , 'jpg'])[1]
      const up = await wx.cloud.uploadFile({
        cloudPath: 'avatars/' + this.data.user.openid + '/avatar.' + ext,
        filePath
      })
      const u = await user.saveProfile({ avatarFileID: up.fileID })
      this.setData({ user: u })
    } catch (err) {
      wx.showToast({ title: '头像上传失败', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  },
  async onNicknameBlur(e) {
    const nickname = String(e.detail.value || '').trim()
    if (!nickname || !this.data.user) return
    try {
      const u = await user.saveProfile({ nickname })
      this.setData({ user: u })
    } catch (err) {
      wx.showToast({ title: '昵称保存失败', icon: 'none' })
    }
  },
  onInviteInput(e) {
    this.setData({ inviteCode: e.detail.value })
  },
  async onApplyInvite() {
    const code = this.data.inviteCode.trim()
    if (!code) return
    try {
      const r = await user.applyInvite(code)
      this.setData({ user: r.user })
      wx.showToast({ title: '邀请码激活成功', icon: 'success' })
    } catch (err) {
      wx.showToast({ title: (err && err.message) || '邀请码无效', icon: 'none' })
    }
  },
  goGallery() {
    wx.navigateTo({ url: '/page/gallery/index' })
  }
})
