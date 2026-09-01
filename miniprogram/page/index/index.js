// miniprogram/page/index/index.js
const pattern = require('../../utils/pattern.js')
const color = require('../../utils/color.js')
const ai = require('../../utils/ai.js')
const image = require('../../utils/image.js')
const hash = require('../../utils/hash.js')
const session = require('../../utils/session.js')
const progressUtil = require('../../utils/progress.js')
const sec = require('../../utils/sec.js')
const guide = require('../../utils/guide.js')

const MIN_SIZE = 15 // 拼豆盘最小边长
const MAX_SIZE = 208 // 拼豆盘最大边长

Page({
  data: {
    imagePath: '',
    set: '221',
    size: 52,
    colorSets: ['48', '72', '144', '221'],
    boardSizes: [52, 78, 104], // 快捷档位（滑块/输入框支持 15~208）
    mode: 'ai', // 默认创意生成（'photo' 照片还原 | 'ai' 创意生成）
    styles: [
      { key: 'cartoon', name: '卡通', desc: '简化造型、粗黑描边、平涂色块、五官夸张' },
      { key: 'realistic', name: '写实风', desc: '保留原图的光影、结构与真实质感，仅像素化为拼豆图纸，不卡通化、不加描边' }
    ],
    selectedStyle: 'cartoon',
    customStyle: '',
    extraReq: '', // 额外要求（不覆盖风格，如删掉画面中的某些元素）
    aiCutout: true, // 抠出主体（背景变白），默认开启
    generating: false,
    guideShow: false,
    progressShow: false,
    progressPct: 0,
    progressTip: '',
    guideTips: [],
    guideIndex: 0,
    guideAnchor: null,
    guideInteractive: false,
    aiSheetShow: false,
    aiSheetLeaving: false,
    aiSheetScrollInto: '',
    sheetDragY: 0,
    sheetDragging: false,
    aiSummary: ''
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 0 })
    }
    this.syncTabBar()
    const result = getApp().globalData.cropResult
    if (result && result.path) {
      this.setData({ imagePath: result.path })
      delete getApp().globalData.cropResult
    }
    this.syncAiSummary()
    this.startGuide()
  },

  startGuide() {
    if (this.data.guideShow) return
    guide.start(this, 'index', guide.TIPS.index, {
      beforeStep: (i, tip, measure) => {
        if (tip.key === 'i2' || tip.key === 'i3') {
          // 先确保选项弹层已打开，再滚到对应区块并测量
          const scrollAndMeasure = () => {
            this.setData({ aiSheetScrollInto: tip.key === 'i2' ? 'ai-set' : 'ai-size' })
            setTimeout(measure, 350)
          }
          if (!this.data.aiSheetShow) {
            this.openAiSheet()
            setTimeout(scrollAndMeasure, 320)
          } else {
            scrollAndMeasure()
          }
          return
        }
        measure()
      },
      afterNext: (i, tip, after) => {
        if (tip.key === 'i3') {
          this.closeAiSheet()
          setTimeout(after, 320)
          return
        }
        after()
      }
    })
  },

  onGuideNext() {
    const tip = (this.data.guideTips || [])[this.data.guideIndex]
    // 交互步骤：无论点 chip 还是「知道了」，都先打开选项弹层再进入弹层内提示
    if (tip && tip.interactive && !this.data.aiSheetShow) {
      this.onGuideAnchorTap()
      return
    }
    guide.next(this)
  },

  onGuideSkip() {
    guide.skip(this)
  },

  onGuideAnchorTap() {
    // 引导第 2 步：点「创意生成」chip 打开选项弹层，继续弹层内的引导
    if (this.data.mode !== 'ai') this.setData({ mode: 'ai' })
    this.openAiSheet()
    this.syncAiSummary()
    guide.next(this)
  },

  openAiSheet() {
    if (this.data.aiSheetShow || this.data.aiSheetLeaving) return
    this.setData({ aiSheetShow: true, aiSheetScrollInto: '' })
    this.syncTabBar()
  },

  // 弹层打开时隐藏 tabBar，关闭时恢复（自定义 tabBar 层级压不住，只能隐藏）
  syncTabBar() {
    if (typeof this.getTabBar !== 'function') return
    const bar = this.getTabBar()
    if (!bar) return
    const hidden = this.data.aiSheetShow
    if (bar.hide && bar.show) {
      if (hidden) bar.hide()
      else bar.show()
    } else {
      bar.setData({ hidden })
    }
  },

  closeAiSheet() {
    if (!this.data.aiSheetShow || this.data.aiSheetLeaving) return
    this.setData({ aiSheetLeaving: true })
    setTimeout(() => {
      this.setData({ aiSheetShow: false, aiSheetLeaving: false, aiSheetScrollInto: '', sheetDragY: 0, sheetDragging: false })
      this.syncTabBar()
    }, 220)
  },

  // 顶部把手/标题区下拉关闭
  onSheetTouchStart(e) {
    if (this.data.aiSheetLeaving) return
    const t = e.touches && e.touches[0]
    if (!t) return
    this._sheetDrag = { startY: t.clientY, lastY: t.clientY, lastTime: Date.now(), dy: 0 }
    this.setData({ sheetDragging: true })
  },

  onSheetTouchMove(e) {
    if (!this._sheetDrag || this.data.aiSheetLeaving) return
    const t = e.touches && e.touches[0]
    if (!t) return
    const dy = Math.max(0, t.clientY - this._sheetDrag.startY)
    this._sheetDrag.dy = dy
    this._sheetDrag.lastY = t.clientY
    this._sheetDrag.lastTime = Date.now()
    this.setData({ sheetDragY: dy })
  },

  onSheetTouchEnd() {
    const d = this._sheetDrag
    this._sheetDrag = null
    if (!d || this.data.aiSheetLeaving) return
    const dt = Date.now() - d.lastTime || 1
    const velocity = (d.lastY - d.startY) / dt // px/ms
    if (d.dy > 120 || velocity > 0.6) {
      this.closeAiSheetByDrag()
    } else {
      this.setData({ sheetDragging: false, sheetDragY: 0 })
    }
  },

  onSheetTouchCancel() {
    this._sheetDrag = null
    if (this.data.aiSheetShow && !this.data.aiSheetLeaving) {
      this.setData({ sheetDragging: false, sheetDragY: 0 })
    }
  },

  closeAiSheetByDrag() {
    let h = 667
    try {
      h = (wx.getSystemInfoSync() || {}).windowHeight || 667
    } catch (err) {
      h = 667
    }
    this.setData({ sheetDragging: false, sheetDragY: h })
    setTimeout(() => {
      if (!this.data.aiSheetShow) return
      this.setData({ aiSheetShow: false, aiSheetLeaving: false, aiSheetScrollInto: '', sheetDragY: 0, sheetDragging: false })
      this.syncTabBar()
    }, 210)
  },

  syncAiSummary() {
    const s = this.data.styles.find((x) => x.key === this.data.selectedStyle)
    const styleName = this.data.customStyle.trim() ? '自定义' : (s ? s.name : '')
    const parts = [styleName]
    if (this.data.aiCutout) parts.push('抠出主体')
    parts.push(this.data.set + '色', this.data.size + '×' + this.data.size)
    this.setData({ aiSummary: parts.filter(Boolean).join(' · ') })
  },

  noop() {},

  onUnload() {
    if (this._progressTimer) {
      clearInterval(this._progressTimer)
      this._progressTimer = null
    }
  },

  chooseImage() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      fail: (err) => {
        if (err && err.errMsg && err.errMsg.indexOf('cancel') >= 0) return
        wx.showToast({ title: '选择图片失败', icon: 'none' })
      },
      success: (res) => {
        const file = res.tempFiles && res.tempFiles[0]
        if (!file) return
        wx.getImageInfo({
          src: file.tempFilePath,
          success: (info) => {
            getApp().globalData.cropSource = {
              path: file.tempFilePath,
              width: info.width,
              height: info.height
            }
            wx.navigateTo({ url: '/page/crop/index' })
          },
          fail: () => {
            this.setData({ imagePath: file.tempFilePath })
          }
        })
      }
    })
  },

  pickSet(e) {
    this.setData({ set: e.currentTarget.dataset.value })
    this.syncAiSummary()
  },

  pickSize(e) {
    this.setData({ size: Number(e.currentTarget.dataset.value) })
    this.syncAiSummary()
  },

  onSizeChanging(e) {
    this.setData({ size: e.detail.value })
    this.syncAiSummary()
  },

  onSizeInput(e) {
    const v = Math.round(Number(e.detail.value))
    if (!v || isNaN(v)) return // 非法输入保持当前值
    this.setData({ size: Math.max(MIN_SIZE, Math.min(MAX_SIZE, v)) })
    this.syncAiSummary()
  },
  onSizeStep(e) {
    const delta = Number(e.currentTarget.dataset.delta)
    const v = Math.max(MIN_SIZE, Math.min(MAX_SIZE, this.data.size + delta))
    this.setData({ size: v })
    this.syncAiSummary()
  },

  pickMode(e) {
    const v = e.currentTarget.dataset.value
    if (v === this.data.mode) return
    this.setData({ mode: v })
    // 切到创意生成只切模式，选项弹层仅由「额外选项」摘要行打开
    if (v === 'photo' && this.data.aiSheetShow) {
      this.closeAiSheet()
    }
    this.syncAiSummary()
  },

  goScan() {
    wx.navigateTo({ url: '/page/scan/index' })
  },

  pickStyle(e) {
    if (this.data.customStyle.trim()) return
    this.setData({ selectedStyle: e.currentTarget.dataset.value })
    this.syncAiSummary()
  },


  onCutoutChange(e) {
    this.setData({ aiCutout: e.detail.value })
    this.syncAiSummary()
  },

  onCustomStyleInput(e) {
    this.setData({ customStyle: e.detail.value })
    this.syncAiSummary()
  },

  onExtraReqInput(e) {
    this.setData({ extraReq: e.detail.value })
    this.syncAiSummary()
  },

  getStyle() {
    const custom = this.data.customStyle.trim()
    if (custom) return custom
    const s = this.data.styles.find((x) => x.key === this.data.selectedStyle)
    return s.name + '：' + s.desc
  },

  getStyleKey() {
    return this.data.customStyle.trim() ? 'custom' : this.data.selectedStyle
  },

  generate() {
    if (this.data.generating) return
    if (!this.data.imagePath) {
      wx.showToast({ title: '请先导入图片', icon: 'none' })
      return
    }
    if (this.data.mode === 'ai') {
      this.generateByAi()
    } else {
      this.generateByPhoto()
    }
  },

  async generateByPhoto() {
    this.setData({ generating: true })
    wx.showLoading({ title: '生成中…', mask: true })
    try {
      if (await sec.checkImageFile(this.data.imagePath, 2)) {
        wx.hideLoading()
        wx.showToast({ title: '图片包含违规信息，请更换图片', icon: 'none' })
        return
      }
      const grid = await this.buildGrid(this.data.imagePath, this.data.size, this.data.set)
      this.finish(grid, 'photo', '')
    } catch (err) {
      wx.hideLoading()
      wx.showToast({ title: '生成失败，请换一张图', icon: 'none' })
      console.error(err)
    } finally {
      this.setData({ generating: false })
    }
  },

  generateByAi() {
    const style = this.getStyle()
    const app = getApp()
    const curUser = app.globalData.user
    if (!(curUser && (curUser.openid || curUser._openid))) {
      wx.showModal({
        title: '需要登录',
        content: '创意生成需要登录后使用，去「我的」页登录？',
        confirmText: '去登录',
        success: (r) => {
          if (r.confirm) wx.switchTab({ url: '/page/profile/index' })
        }
      })
      return
    }
    wx.showModal({
      title: '创意生成图纸',
      content:
        '将原图按所选风格生成 ' + this.data.size + '×' + this.data.size + ' 拼豆图纸，可能需要 1~2 分钟，请耐心等待，继续吗？',
      confirmText: '开始生成',
      success: (r) => {
        if (!r.confirm) return
        this.runAiGenerate(style)
      }
    })
  },

  async runAiGenerate(style) {
    // 先启动进度浮层，再执行内容安全检测，避免检测期间无任何反馈
    this.setData({ generating: true })
    const prog = progressUtil.createProgress()
    progressUtil.startOverlay(this, prog)
    try {
      prog.bump(2) // 内容安全检测
      try {
        const secText = [style, this.data.extraReq].filter(Boolean).join(' ')
        const risky = (await sec.checkText(secText, 2)) || (await sec.checkImageFile(this.data.imagePath, 2))
        if (risky) {
          progressUtil.stopOverlay(this)
          wx.showToast({ title: '内容包含违规信息，请修改后重试', icon: 'none' })
          return
        }
      } catch (err) {
        console.error('[sec-check]', err)
      }
      const g = getApp().globalData
      prog.bump(5) // 压缩原图
      const imageBase64 = await ai.compressToBase64(this.data.imagePath)
      prog.bump(12) // 提交生成
      const imageHash = hash.fnv1a64(imageBase64)
      // 主页面每次生成都是全新图纸：不继承上次同一张图的版本历史；
      // 只有预览页的"按要求重新生成"才会在同一会话里追加版本
      g.aiSession = session.createSession(imageHash)
      g.aiSession.params = {
        imagePath: this.data.imagePath,
        size: this.data.size,
        set: this.data.set,
        style,
        styleKey: this.getStyleKey(),
        cutout: this.data.aiCutout,
        extra: this.data.extraReq.trim()
      }
      const s = g.aiSession
      prog.climb(12, 88) // 等待出图（真实进度未知，按 2 分钟时间估算）
      const res = await ai.generateGrid({
        imageBase64,
        size: this.data.size,
        set: this.data.set,
        style,
        styleKey: this.getStyleKey(),
        cutout: this.data.aiCutout,
        extra: this.data.extraReq.trim(),
        imageHash,
        sessionId: s.sessionId
      })
      prog.bump(95) // 出图完成，解析映射
      g.aiSession = session.addCandidate(g.aiSession, res.grid, res.bgMask)
      if (g.aiSession.params) g.aiSession.params.prevImage = res.prevImage
      prog.finish()
      progressUtil.stopOverlay(this)
      this.finish(res.grid, 'ai', style, res.bgMask)
    } catch (err) {
      progressUtil.stopOverlay(this)
      wx.showModal({
        title: '生成失败',
        content:
          (err && err.message) ||
          '请确认本地服务已启动（node tools/ai-generate-server.js）或云函数已部署并配置 ARK_API_KEY',
        showCancel: false
      })
      console.error(err)
    } finally {
      this.setData({ generating: false })
    }
  },

  finish(grid, mode, style, bgMask) {
    getApp().globalData.pattern = {
      grid,
      size: this.data.size,
      set: this.data.set,
      imagePath: this.data.imagePath,
      mode,
      style,
      bgMask: bgMask || null
    }
    wx.hideLoading()
    wx.navigateTo({ url: '/page/pattern/index' })
  },

  async buildGrid(imagePath, size, setKey) {
    const size4 = size * 4
    const canvas = wx.createOffscreenCanvas({ type: '2d', width: size4, height: size4 })
    const ctx = canvas.getContext('2d')
    const img = await image.loadImageOnce(canvas, imagePath)
    const scale = Math.min(size4 / img.width, size4 / img.height)
    const dw = img.width * scale
    const dh = img.height * scale
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, size4, size4)
    ctx.drawImage(img, (size4 - dw) / 2, (size4 - dh) / 2, dw, dh)
    const imageData = ctx.getImageData(0, 0, size4, size4)
    // 照片还原：4N 画布 → 4×4 块平均 → CIELAB 最近色 → 后处理（杂色/邻近色合并、去噪）
    const palette = color.buildPalette(setKey)
    const rgbArr = pattern.averageBlocks(imageData.data, size4, size, 4)
    return pattern.postProcessGrid(pattern.mapRgb(rgbArr, size, palette), palette)
  }
})
