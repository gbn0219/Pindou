// miniprogram/page/index/index.js
const pattern = require('../../utils/pattern.js')
const color = require('../../utils/color.js')
const ai = require('../../utils/ai.js')
const image = require('../../utils/image.js')

const MIN_SIZE = 15 // 拼豆盘最小边长
const MAX_SIZE = 208 // 拼豆盘最大边长

Page({
  data: {
    imagePath: '',
    set: '221',
    size: 52,
    colorSets: ['48', '72', '144', '221'],
    boardSizes: [52, 78, 104], // 快捷档位（滑块/输入框支持 15~208）
    mode: 'ai', // 默认 AI 生成（'photo' 照片还原 | 'ai' AI 生成）
    styles: [
      { key: 'cartoon', name: '卡通', desc: '简化造型、粗黑描边、平涂色块、五官夸张' },
      { key: 'macaron', name: '马卡龙', desc: '低饱和马卡龙色系、圆润柔和、减少硬边' },
      { key: 'realistic', name: '写实风', desc: '保留原图的光影、结构与真实质感，仅像素化为拼豆图纸，不卡通化、不加描边' }
    ],
    selectedStyle: 'cartoon',
    customStyle: '',
    extraReq: '', // 额外要求（不覆盖风格，如删掉画面中的某些元素）
    aiCutout: true, // 抠出主体（背景变白），默认开启
    generating: false
  },

  onShow() {
    const result = getApp().globalData.cropResult
    if (result && result.path) {
      this.setData({ imagePath: result.path })
      delete getApp().globalData.cropResult
    }
  },

  chooseImage() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
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
  },

  pickSize(e) {
    this.setData({ size: Number(e.currentTarget.dataset.value) })
  },

  onSizeChanging(e) {
    this.setData({ size: e.detail.value })
  },

  onSizeInput(e) {
    const v = Math.round(Number(e.detail.value))
    if (!v || isNaN(v)) return // 非法输入保持当前值
    this.setData({ size: Math.max(MIN_SIZE, Math.min(MAX_SIZE, v)) })
  },

  pickMode(e) {
    this.setData({ mode: e.currentTarget.dataset.value })
  },

  pickStyle(e) {
    if (this.data.customStyle.trim()) return
    this.setData({ selectedStyle: e.currentTarget.dataset.value })
  },


  onCutoutChange(e) {
    this.setData({ aiCutout: e.detail.value })
  },

  onCustomStyleInput(e) {
    this.setData({ customStyle: e.detail.value })
  },

  onExtraReqInput(e) {
    this.setData({ extraReq: e.detail.value })
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
    if (this.data.generating || !this.data.imagePath) return
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
    wx.showModal({
      title: 'AI 生成图纸',
      content:
        '将原图与风格描述发送给 AI 生成 ' + this.data.size + '×' + this.data.size + ' 拼豆图纸，约需 30~60 秒并按次计费，偶发超时会自动重试，继续吗？',
      confirmText: '开始生成',
      success: (r) => {
        if (!r.confirm) return
        this.runAiGenerate(style)
      }
    })
  },

  async runAiGenerate(style) {
    this.setData({ generating: true })
    wx.showLoading({ title: 'AI 生成中…', mask: true })
    try {
      const imageBase64 = await ai.compressToBase64(this.data.imagePath)
      const resp = await ai.callAiGenerate({
        imageBase64,
        size: this.data.size,
        set: this.data.set,
        style,
        styleKey: this.getStyleKey(),
        cutout: this.data.aiCutout,
        extra: this.data.extraReq.trim(),
        onRetry: (used, total) => wx.showLoading({ title: '超时重试 ' + used + '/' + total, mask: true })
      })
      const grid = await ai.imageToGrid(resp.image, this.data.size, this.data.set)
      this.finish(grid, 'ai', style)
    } catch (err) {
      wx.hideLoading()
      wx.showModal({
        title: 'AI 生成失败',
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

  finish(grid, mode, style) {
    getApp().globalData.pattern = {
      grid,
      size: this.data.size,
      set: this.data.set,
      imagePath: this.data.imagePath,
      mode,
      style
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
    // 照片还原：4N 画布 → 4×4 块平均 → CIELAB 最近色，不做任何平滑/合并/去噪
    const palette = color.buildPalette(setKey)
    const rgbArr = pattern.averageBlocks(imageData.data, size4, size, 4)
    return pattern.mapRgb(rgbArr, size, palette)
  }
})
