// miniprogram/page/profile/index.js
const user = require('../../utils/user.js')

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('上传超时')), ms))
  ])
}
Page({
  data: {
    user: null,
    openidTail: '',
    loading: false,
    uploading: false,
    avatarBroken: false,
    inviteCode: ''
  },
  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 1 })
    }
    if (!this.data.user) this.refresh()
  },
  async refresh() {
    try {
      const u = await getApp().ensureLogin()
      this.setData({ user: u, openidTail: (u.openid || u._openid || '').slice(-6) })
    } catch (e) {
      console.error('登录状态刷新失败', e)
      this.setData({ user: null, openidTail: '' })
    }
  },
  async onLogin() {
    this.setData({ loading: true })
    try {
      const u = await getApp().ensureLogin()
      this.setData({ user: u, openidTail: (u.openid || u._openid || '').slice(-6) })
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '登录失败', icon: 'none' })
      console.error('登录失败', e)
    } finally {
      this.setData({ loading: false })
    }
  },
  async onChooseAvatar(e) {
    const filePath = e.detail.avatarUrl
    if (!filePath || !this.data.user || this.data.uploading) return
    this.setData({ uploading: true, avatarBroken: false })
    wx.showLoading({ title: '上传中…', mask: true })
    try {
      const ext = (filePath.match(/\.(\w+)$/) || [ , 'jpg'])[1]
      const up = await withTimeout(wx.cloud.uploadFile({
        cloudPath: 'avatars/' + (this.data.user.openid || this.data.user._openid) + '/avatar.' + ext,
        filePath
      }), 15000)
      const u = await user.saveProfile({ avatarFileID: up.fileID })
      this.setData({ user: u })
    } catch (err) {
      wx.showToast({ title: '头像上传失败', icon: 'none' })
    } finally {
      this.setData({ uploading: false })
      wx.hideLoading()
    }
  },
  onAvatarError() {
    this.setData({ avatarBroken: true })
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
      const merged = Object.assign({}, this.data.user, r.user)
      if (!merged.openid && merged._openid) merged.openid = merged._openid
      this.setData({ user: merged, openidTail: (merged.openid || merged._openid || '').slice(-6) })
      wx.showToast({ title: '邀请码激活成功', icon: 'success' })
    } catch (err) {
      wx.showToast({ title: (err && err.message) || '邀请码无效', icon: 'none' })
    }
  },
  goGallery() {
    wx.navigateTo({ url: '/page/gallery/index' })
  }
})
