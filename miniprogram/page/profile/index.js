// miniprogram/page/profile/index.js
const user = require('../../utils/user.js')
const sec = require('../../utils/sec.js')
const guide = require('../../utils/guide.js')

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
    avatarPreview: '',
    faqShow: false,
    aboutShow: false,
    guideModalShow: false,
    guideShow: false,
    guideTips: [],
    guideIndex: 0,
    guideAnchor: null,
    guideInteractive: false,
    version: '1.0.0',
    faqList: [
      { q: '怎么生成一张图纸？', a: '首页导入图片 → 选生成方式（照片还原 / 创意生成）→ 选色系与盘面大小 → 生成。' },
      { q: '色号怎么用？', a: '每个格子对应一个色号，展示页有色号数量清单，按清单选择对应颜色的拼豆即可。' },
      { q: '图纸存在哪里？', a: '生成的图纸会自动保存到“我的图库”，也可以在展示页导出图片存到相册。' },
      { q: '生成失败怎么办？', a: '请稍后再试，或更换图片重新生成。' }
    ]
  },
  onLoad() {
    // 首帧渲染前同步用缓存填充用户，已登录用户进入时不闪登录页
    this.seedCachedUser()
  },
  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 1 })
    }
    if (!this.data.user) {
      this.refresh()
    } else {
      setTimeout(() => this.maybeStartGuide(), 500)
    }
  },
  // 先同步用本地缓存的登录资料填充页面，避免刷新期间闪回登录页
  seedCachedUser() {
    try {
      const app = getApp()
      const loggedOut = app.globalData.loggedOut || wx.getStorageSync('loggedOut')
      const u = loggedOut ? null : (app.globalData.user || wx.getStorageSync('user') || null)
      if (u && (u.openid || u._openid)) {
        if (!u.openid && u._openid) u.openid = u._openid
        this.setData({ user: u, openidTail: (u.openid || u._openid || '').slice(-6) })
      }
    } catch (e) {
      // 缓存读取失败不影响登录流程
    }
  },
  async refresh() {
    try {
      const u = await getApp().ensureLogin()
      this.setData({ user: u, openidTail: (u.openid || u._openid || '').slice(-6) })
    } catch (e) {
      console.error('登录状态刷新失败', e)
      // 刷新失败时保留缓存资料，已登录用户不会闪回登录页
      const cached = getApp().globalData.user || (wx.getStorageSync('user') || null)
      if (!cached) this.setData({ user: null, openidTail: '' })
    }
    setTimeout(() => this.maybeStartGuide(), 500)
  },
  async onLogin() {
    this.setData({ loading: true })
    try {
      const app = getApp()
      app.globalData.loggedOut = false
      wx.removeStorageSync('loggedOut')
      const u = await app.ensureLogin()
      this.setData({ user: u, openidTail: (u.openid || u._openid || '').slice(-6) })
      setTimeout(() => this.maybeStartGuide(), 500)
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
    // 先展示选中的头像，让界面立即有反馈，再在后台压缩/检测/上传
    this.setData({ uploading: true, avatarBroken: false, avatarPreview: filePath })
    wx.showLoading({ title: '上传中…' })
    try {
      // 只压缩一次：压缩小图同时用于检测与上传，避免真机重复解码大图
      console.time('avatar-compress')
      const compressed = await withTimeout(sec.compressImage(filePath, 360), 8000)
      console.timeEnd('avatar-compress')
      console.time('avatar-sec-check')
      const base64 = await withTimeout(sec.readBase64(compressed), 5000)
      const risky = await withTimeout(sec.checkImageBase64(base64, 1), 8000)
      console.timeEnd('avatar-sec-check')
      if (risky) {
        wx.hideLoading()
        this.setData({ avatarPreview: '' })
        wx.showToast({ title: '头像包含违规信息，请更换头像', icon: 'none' })
        return
      }
      console.time('avatar-upload')
      const up = await withTimeout(wx.cloud.uploadFile({
        cloudPath: 'avatars/' + (this.data.user.openid || this.data.user._openid) + '/avatar.jpg',
        filePath: compressed
      }), 10000)
      console.timeEnd('avatar-upload')
      const u = await withTimeout(user.saveProfile({ avatarFileID: up.fileID }), 10000)
      // 保留本地预览继续显示，避免切到 cloud:// 后重新下载图片造成的“先消失再出现”
      this.setData({ user: u })
      wx.showToast({ title: '头像已更新', icon: 'success' })
    } catch (err) {
      this.setData({ avatarPreview: '' })
      wx.showToast({ title: '头像上传失败，请重试', icon: 'none', duration: 3000 })
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
    if (!this.data.user) return
    if (!nickname) return
    try {
      if (await sec.checkText(nickname, 1)) {
        wx.showToast({ title: '昵称包含违规信息，请重新填写', icon: 'none' })
        return
      }
      const u = await user.saveProfile({ nickname })
      this.setData({ user: u })
      wx.showToast({ title: '昵称已保存', icon: 'success' })
    } catch (err) {
      wx.showToast({ title: '昵称保存失败', icon: 'none' })
    }
  },
  goFeedback() {
    wx.navigateTo({ url: '/page/feedback/index' })
  },
  onLogout() {
    wx.showModal({
      title: '退出登录',
      content: '退出后需重新登录才能使用创意生成与我的图库，确定退出吗？',
      confirmText: '退出',
      confirmColor: '#d33',
      success: (r) => {
        if (!r.confirm) return
        const app = getApp()
        app.globalData.loggedOut = true
        app.globalData.user = null
        wx.removeStorageSync('user')
        wx.setStorageSync('loggedOut', true)
        this.setData({ user: null, openidTail: '', avatarBroken: false, uploading: false, avatarPreview: '' })
        wx.showToast({ title: '已退出登录', icon: 'none' })
      }
    })
  },
  goHome() {
    wx.switchTab({ url: '/page/index/index' })
  },
  goGallery() {
    wx.navigateTo({ url: '/page/gallery/index' })
  },
  showFaq() {
    this.setData({ faqShow: true })
  },
  hideFaq() {
    this.setData({ faqShow: false })
  },
  showAbout() {
    this.setData({ aboutShow: true })
  },
  hideAbout() {
    this.setData({ aboutShow: false })
  },
  showGuide() {
    this.setData({ guideModalShow: true })
  },
  hideGuide() {
    this.setData({ guideModalShow: false })
  },
  maybeStartGuide() {
    const u = this.data.user
    guide.start(this, u ? 'profile' : 'profileGuest', u ? guide.TIPS.profile : guide.TIPS.profileGuest)
  },
  onGuideNext() {
    guide.next(this)
  },
  onGuideSkip() {
    guide.skip(this)
  },
  onGuideStart() {
    this.setData({ guideModalShow: false })
    wx.switchTab({ url: '/page/index/index' })
  },
  noop() {}
})
