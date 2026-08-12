// miniprogram/utils/sec.js
/**
 * 内容安全检测封装：文本 msgSecCheck / 图片 imgSecCheck（云函数 sec-check）。
 * 图片先压缩到 720px（imgSecCheck 限制 750×1334 且 ≤1M）再检测。
 * 命中违规返回 true；云函数不可用等基础设施错误放行（仅记录日志），避免误伤正常用户。
 */
const image = require('./image')

const CHECK_MAX_SIZE = 720
const CALL_TIMEOUT = 10000 // 云函数检测最长等待；超时按基础设施错误放行

function callSec(data) {
  const call = wx.cloud.callFunction({ name: 'sec-check', data })
  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('内容安全检测超时')), CALL_TIMEOUT))
  return Promise.race([call, timeout]).then((res) => {
    const r = (res && res.result) || {}
    if (!r.ok) throw new Error(r.msg || '内容安全检测失败')
    return !!r.risky
  })
}

function checkText(content, scene) {
  const text = String(content || '').trim()
  if (!text) return Promise.resolve(false)
  return callSec({ action: 'msg', content: text, scene }).catch((err) => {
    console.error('[sec-check] 文本检测不可用，放行:', err)
    return false
  })
}

function checkImageBase64(base64, scene) {
  return callSec({ action: 'img', base64, scene }).catch((err) => {
    console.error('[sec-check] 图片检测不可用，放行:', err)
    return false
  })
}

function compressImage(src, maxSize) {
  const px = maxSize || CHECK_MAX_SIZE
  const canvas = wx.createOffscreenCanvas({ type: '2d', width: px, height: px })
  const ctx = canvas.getContext('2d')
  return image.loadImageOnce(canvas, src).then((img) => {
    const scale = Math.min(px / img.width, px / img.height)
    const dw = img.width * scale
    const dh = img.height * scale
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, px, px)
    ctx.drawImage(img, (px - dw) / 2, (px - dh) / 2, dw, dh)
    return new Promise((resolve, reject) => {
      wx.canvasToTempFilePath({
        canvas,
        fileType: 'jpg',
        quality: 0.8,
        success: (r) => resolve(r.tempFilePath),
        fail: reject
      })
    })
  })
}

function readBase64(filePath) {
  return new Promise((resolve, reject) => {
    wx.getFileSystemManager().readFile({
      filePath,
      encoding: 'base64',
      success: (r) => resolve(r.data),
      fail: reject
    })
  })
}

function checkImageFile(filePath, scene, maxSize) {
  return compressImage(filePath, maxSize)
    .then(readBase64)
    .then((base64) => callSec({ action: 'img', base64, scene }))
    .catch((err) => {
      console.error('[sec-check] 图片检测不可用，放行:', err)
      return false
    })
}

module.exports = { checkText, checkImageFile, checkImageBase64, compressImage, readBase64 }
