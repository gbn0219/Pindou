// miniprogram/utils/image.js
/**
 * 图片加载工具：绕过 iOS OffscreenCanvas.createImage 对同一路径只触发一次
 * onload 的缓存 bug——加载前先把图片复制到每次唯一的临时路径。
 */
let lastTemp = ''

function copyToUniquePath(src) {
  return new Promise((resolve, reject) => {
    const fs = wx.getFileSystemManager()
    const m = /\.([a-zA-Z0-9]+)$/.exec(src)
    const ext = m ? m[1].toLowerCase() : 'jpg'
    const dest =
      wx.env.USER_DATA_PATH +
      '/pindou_' +
      Date.now() +
      '_' +
      Math.floor(Math.random() * 1000000) +
      '.' +
      ext
    if (lastTemp) {
      try {
        fs.unlinkSync(lastTemp)
      } catch (e) {
        /* 旧临时文件不存在时忽略 */
      }
    }
    fs.copyFile({
      srcPath: src,
      destPath: dest,
      success: () => {
        lastTemp = dest
        resolve(dest)
      },
      fail: (err) => reject(new Error('图片临时文件复制失败: ' + ((err && err.errMsg) || '')))
    })
  })
}

function loadImage(canvas, src, timeoutMs) {
  return new Promise((resolve, reject) => {
    const img = canvas.createImage()
    let settled = false
    const done = (fn, arg) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      fn(arg)
    }
    const timer = setTimeout(() => done(reject, new Error('图片加载超时')), timeoutMs || 15000)
    img.onload = () => done(resolve, img)
    img.onerror = () => done(reject, new Error('图片加载失败'))
    img.src = src
  })
}

async function loadImageOnce(canvas, src, timeoutMs) {
  const first = await copyToUniquePath(src)
  try {
    return await loadImage(canvas, first, timeoutMs)
  } catch (err) {
    const second = await copyToUniquePath(src)
    return loadImage(canvas, second, timeoutMs)
  }
}

module.exports = { copyToUniquePath, loadImage, loadImageOnce }
