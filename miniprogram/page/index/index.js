// miniprogram/page/index/index.js
const pattern = require('../../utils/pattern.js')
const color = require('../../utils/color.js')

Page({
  data: {
    imagePath: '',
    set: '221',
    size: 52,
    colorSets: ['48', '72', '144', '221'],
    boardSizes: [52, 78, 104],
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

  generate() {
    if (this.data.generating || !this.data.imagePath) return
    this.setData({ generating: true })
    wx.showLoading({ title: '生成中…', mask: true })
    // —— AI 卡通化预留位 ——
    // 若后续接入 AI 卡通化：在此先调用 cartoonize(imagePath) 得到卡通化后的新路径再 buildGrid；
    // 建议实现：云函数调用第三方模型（需 API Key/成本），本期不做 UI 入口、不接 API。
    this.buildGrid(this.data.imagePath, this.data.size, this.data.set)
      .then((grid) => {
        getApp().globalData.pattern = {
          grid,
          size: this.data.size,
          set: this.data.set,
          imagePath: this.data.imagePath
        }
        wx.hideLoading()
        wx.navigateTo({ url: '/page/pattern/index' })
      })
      .catch((err) => {
        wx.hideLoading()
        wx.showToast({ title: '生成失败，请换一张图', icon: 'none' })
        console.error(err)
      })
      .then(() => {
        this.setData({ generating: false })
      })
  },

  buildGrid(imagePath, size, setKey) {
    return new Promise((resolve, reject) => {
      let settled = false
      const done = (fn, arg) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        fn(arg)
      }
      const timer = setTimeout(() => done(reject, new Error('image load timeout')), 15000)
      try {
        const size4 = size * 4
        const canvas = wx.createOffscreenCanvas({ type: '2d', width: size4, height: size4 })
        const ctx = canvas.getContext('2d')
        const img = canvas.createImage()
        img.onload = () => {
          try {
            const scale = Math.min(size4 / img.width, size4 / img.height)
            const dw = img.width * scale
            const dh = img.height * scale
            ctx.fillStyle = '#ffffff'
            ctx.fillRect(0, 0, size4, size4)
            ctx.drawImage(img, (size4 - dw) / 2, (size4 - dh) / 2, dw, dh)
            const imageData = ctx.getImageData(0, 0, size4, size4)
            // 平滑管线 v3：对比度感知主色采样（保留细线边界）→ CIELAB 映射 → 相似色区域合并 → 孤立点清理
            const rgbArr = pattern.dominantBlocks(imageData.data, size4, size, 4)
            const palette = color.buildPalette(setKey)
            let grid = pattern.mapRgb(rgbArr, size, palette)
            grid = pattern.mergeGrid(grid, palette, 12)
            grid = pattern.denoiseGrid(grid)
            done(resolve, grid)
          } catch (e) {
            done(reject, e)
          }
        }
        img.onerror = () => done(reject, new Error('image load failed'))
        img.src = imagePath
      } catch (e) {
        done(reject, e)
      }
    })
  }
})
