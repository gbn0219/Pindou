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

  chooseImage() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const file = res.tempFiles && res.tempFiles[0]
        if (!file) return
        this.setData({ imagePath: file.tempFilePath })
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
      const canvas = wx.createOffscreenCanvas({ type: '2d', width: size, height: size })
      const ctx = canvas.getContext('2d')
      const img = canvas.createImage()
      img.onload = () => {
        try {
          const scale = Math.min(size / img.width, size / img.height)
          const dw = img.width * scale
          const dh = img.height * scale
          ctx.fillStyle = '#ffffff'
          ctx.fillRect(0, 0, size, size)
          ctx.drawImage(img, (size - dw) / 2, (size - dh) / 2, dw, dh)
          const imageData = ctx.getImageData(0, 0, size, size)
          resolve(pattern.mapRgbGrid(imageData, size, color.buildPalette(setKey)))
        } catch (e) {
          reject(e)
        }
      }
      img.onerror = () => reject(new Error('image load failed'))
      img.src = imagePath
    })
  }
})
