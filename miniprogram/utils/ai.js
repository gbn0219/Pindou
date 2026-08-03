// miniprogram/utils/ai.js
/**
 * AI 生成前端：原图压缩、调用后端（local/cloud）、grid 校验。
 * parseGridResponse / buildColorTable 为纯函数，可在 Node 中测试。
 */
const config = require('../config')
const color = require('./color')
const image = require('./image')

const MAX_SIZE = 768 // 原图压缩边长 px
const TIMEOUT = 120000

async function compressToBase64(src, maxSize) {
  const px = maxSize || MAX_SIZE
  const canvas = wx.createOffscreenCanvas({ type: '2d', width: px, height: px })
  const ctx = canvas.getContext('2d')
  const img = await image.loadImageOnce(canvas, src)
  const scale = Math.min(px / img.width, px / img.height)
  const dw = img.width * scale
  const dh = img.height * scale
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, px, px)
  ctx.drawImage(img, (px - dw) / 2, (px - dh) / 2, dw, dh)
  const tempFilePath = await new Promise((resolve, reject) => {
    wx.canvasToTempFilePath({
      canvas,
      fileType: 'jpg',
      quality: 0.85,
      success: (res) => resolve(res.tempFilePath),
      fail: reject
    })
  })
  const base64 = await new Promise((resolve, reject) => {
    wx.getFileSystemManager().readFile({
      filePath: tempFilePath,
      encoding: 'base64',
      success: (r) => resolve(r.data),
      fail: reject
    })
  })
  return 'data:image/jpeg;base64,' + base64
}

function callLocal(ai, data) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: ai.localUrl + '/ai-generate',
      method: 'POST',
      data,
      timeout: TIMEOUT,
      success: (r) => {
        if (r.statusCode === 200 && r.data && r.data.grid) {
          resolve(r.data)
        } else {
          reject(new Error((r.data && r.data.error) || '本地 AI 服务响应异常'))
        }
      },
      fail: (err) => {
        const msg = (err && err.errMsg) || '本地 AI 服务请求失败'
        let tip = ''
        if (msg.indexOf('domain') >= 0 || msg.indexOf('url') >= 0) {
          tip = '（请在开发者工具勾选"不校验合法域名"或重新打开项目）'
        } else if (msg.indexOf('refused') >= 0 || msg.indexOf('connect') >= 0) {
          tip = '（请确认已运行 node tools/ai-generate-server.js；真机调试时 config.localUrl 需为电脑局域网 IP）'
        }
        reject(new Error(msg + tip))
      }
    })
  })
}

function callAiGenerate(params) {
  const ai = (config && config.aiGenerate) || {}
  const data = {
    imageBase64: params.imageBase64,
    size: params.size,
    set: params.set,
    style: params.style,
    colors: buildColorTable(params.set)
  }
  if (ai.backend === 'local' && ai.localUrl) return callLocal(ai, data)
  return wx.cloud
    .callFunction({ name: 'ai-generate-pattern', data })
    .then((res) => {
      const result = res && res.result
      if (!result || !result.grid) {
        throw new Error((result && result.error) || '云函数调用失败')
      }
      return result
    })
    .catch((err) => {
      throw new Error((err && err.errMsg) || '云函数调用失败')
    })
}

function buildColorTable(setKey) {
  return color.buildPalette(setKey).map((item) => ({
    code: item.code,
    hex: item.hex,
    rgb: item.rgb
  }))
}

/**
 * 校验 AI 返回的拼豆色号数组（行优先）并转为二维 grid。
 * 数量必须恰好 size×size，色号大小写归一并必须属于当前套装。
 */
function parseGridResponse(rawGrid, size, setCodes) {
  const total = size * size
  const set = {}
  for (const code of setCodes) set[String(code).toLowerCase()] = code
  if (!Array.isArray(rawGrid) || rawGrid.length !== total) {
    throw new Error(
      'AI 返回色号数量不对：应为 ' + total + ' 个，实际 ' + (rawGrid ? rawGrid.length : 0) + ' 个'
    )
  }
  const grid = []
  for (let r = 0; r < size; r++) {
    const row = []
    for (let c = 0; c < size; c++) {
      const raw = rawGrid[r * size + c]
      const key = String(raw).toLowerCase()
      if (!set[key]) {
        throw new Error('AI 返回了非法色号：' + raw)
      }
      row.push(set[key])
    }
    grid.push(row)
  }
  return grid
}

module.exports = { compressToBase64, callAiGenerate, buildColorTable, parseGridResponse }