// miniprogram/utils/ai.js
/**
 * 创意生成前端：原图压缩、提交任务并轮询后端（local/cloud）、读取生成图纸图片像素映射为拼豆色号。
 * imageToGrid 依赖 wx 环境；imageDataToGrid 为纯函数，可在 Node 中测试。
 *
 * 图像方案：后端调用豆包 Seedream（doubao-seedream-5-0-260128，火山方舟 images/generations）
 * 生成 2K（约 2048×2048）像素风格图纸，前端把图片写入临时文件 → offscreen canvas 读整幅像素 →
 * dominantBlockRgb 按盘面 floor 分块取主色 → CIELAB 最近色映射到套装色号。
 * 不输出文字色号，无输出 token 上限问题。
 */
const config = require('../config')
const background = require('./background') // 生成图纸背景近白噪声清洗
const color = require('./color')
const image = require('./image')
const pattern = require('./pattern')

const MAX_SIZE = 768 // 原图压缩边长 px
const REQUEST_TIMEOUT = 20000 // 单次 wx.request 超时
const POLL_INTERVAL = 3000 // 轮询间隔
const POLL_MAX_MS = 300000 // 总等待上限 5 分钟
const CLOUD_RETRY_MAX = 2 // 云函数 60s 超时上限：超时后最多自动重试次数（总尝试 3 次）
const CLOUD_RETRY_DELAY = 1500 // 自动重试间隔 ms

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

function request(url, method, data) {
  return new Promise((resolve, reject) => {
    wx.request({
      url,
      method,
      data,
      timeout: REQUEST_TIMEOUT,
      success: resolve,
      fail: (err) => reject(new Error((err && err.errMsg) || '本地生成服务请求失败'))
    })
  })
}

function pollTask(ai, taskId, resolve, reject, start) {
  request(ai.localUrl + '/ai-generate/status?taskId=' + encodeURIComponent(taskId), 'GET')
    .then((r) => {
      const d = r.data || {}
      if (r.statusCode === 200 && d.status === 'done' && d.image) {
        resolve({ image: d.image })
        return
      }
      if (r.statusCode === 200 && d.status === 'error') {
        reject(new Error(d.error || '本地生成服务生成失败'))
        return
      }
      if (Date.now() - start > POLL_MAX_MS) {
        reject(new Error('生成超时（超过 ' + Math.round(POLL_MAX_MS / 1000) + ' 秒），请重试'))
        return
      }
      setTimeout(() => pollTask(ai, taskId, resolve, reject, start), POLL_INTERVAL)
    })
    .catch(() => {
      // 轮询网络抖动时继续重试，直到总等待上限
      if (Date.now() - start > POLL_MAX_MS) {
        reject(new Error('生成超时（超过 ' + Math.round(POLL_MAX_MS / 1000) + ' 秒），请重试'))
        return
      }
      setTimeout(() => pollTask(ai, taskId, resolve, reject, start), POLL_INTERVAL)
    })
}
function callLocal(ai, data) {
  return new Promise((resolve, reject) => {
    request(ai.localUrl + '/ai-generate', 'POST', data)
      .then((r) => {
        if (r.statusCode === 200 && r.data && r.data.taskId) {
          pollTask(ai, r.data.taskId, resolve, reject, Date.now())
        } else {
          reject(new Error((r.data && r.data.error) || '本地生成服务响应异常'))
        }
      })
      .catch((err) => {
        const msg = err.message || '本地生成服务请求失败'
        const lower = msg.toLowerCase()
        let tip = ''
        if (lower.indexOf('domain') >= 0 || lower.indexOf('url') >= 0) {
          tip = '（请在开发者工具勾选"不校验合法域名"或重新打开项目）'
        } else if (
          lower.indexOf('refused') >= 0 ||
          lower.indexOf('connect') >= 0 ||
          lower.indexOf('unreachable') >= 0
        ) {
          tip = '（请确认已运行 node tools/ai-generate-server.js；真机需与电脑同一 Wi-Fi 或连电脑热点，config.localUrl 填电脑当前 IP）'
        }
        reject(new Error(msg + tip))
      })
  })
}

// 云函数超时判定：仅对超时类错误自动重试；缺 Key、模型权限、限流等业务错误直接失败
function isTimeoutError(err) {
  const msg = String((err && (err.errMsg || err.message || err.errCode)) || '')
  return /time\s*out|timed\s*out|time\s*limit|timelimit|超时|FUNCTION_EXCEED|504002|exceeded/i.test(msg)
}

function callAiGenerate(params) {
  const ai = (config && config.aiGenerate) || {}
  const data = {
    imageBase64: params.imageBase64,
    size: params.size,
    set: params.set,
    style: params.style,
    styleKey: params.styleKey,
    extra: params.extra || '',
    cutout: !!params.cutout,
    imageHash: params.imageHash || '',
    sessionId: params.sessionId || ''
  }
  if (ai.backend === 'local' && ai.localUrl) return callLocal(ai, data)
  // 云函数 60s 超时上限，生成偶发超时：自动重试（最多 CLOUD_RETRY_MAX 次），避免用户手动重按
  const onRetry = params.onRetry
  const attempt = (left) =>
    wx.cloud
      .callFunction({ name: 'ai-generate-pattern', data })
      .then((res) => {
        const result = res && res.result
        if (!result || (!result.image && !result.imageFileID)) {
          throw new Error((result && result.error) || '云函数调用失败')
        }
        return result
      })
      .catch((err) => {
        if (left > 0 && isTimeoutError(err)) {
          const used = CLOUD_RETRY_MAX - left + 1
          if (onRetry) onRetry(used, CLOUD_RETRY_MAX)
          return new Promise((resolve) => setTimeout(resolve, CLOUD_RETRY_DELAY)).then(() => attempt(left - 1))
        }
        throw new Error((err && err.errMsg) || '云函数调用失败')
      })
  return attempt(CLOUD_RETRY_MAX)
}

/**
 * 生成并映射网格：base64 已在 params.imageBase64，返回当前套装色号网格。
 */
async function generateGrid(params) {
  const resp = await callAiGenerate(params)
  if (!resp.imageFileID) return imageToGrid(resp.image, params.size, params.set)
  try {
    const tempPath = await downloadFileID(resp.imageFileID)
    return await fileToGrid(tempPath, params.size, params.set)
  } finally {
    // 图纸已读取完成，尽力删除云端临时文件；失败则留给云函数下次同会话生成时清理
    wx.cloud.deleteFile({ fileList: [resp.imageFileID] }).catch(() => {})
  }
}

// 云函数只返回 fileID，大图走云存储 CDN 下载，避免 base64 穿过函数响应触发大小限制
function downloadFileID(fileID) {
  return new Promise((resolve, reject) => {
    wx.cloud.downloadFile({
      fileID,
      success: (res) => resolve(res.tempFilePath),
      fail: (err) => reject(new Error('图纸图片下载失败: ' + ((err && err.errMsg) || '')))
    })
  })
}

/**
 * 纯函数：把整幅生成图纸像素（RGBA）按 size×size 分块，每块取主色（占比最高的颜色桶），
 * 再映射为当前套装的色号网格。生成输出常带细网格线/辅助线，块内主色一定是格子内容；
 * 若取平均会把网格线混进背景导致发灰。块内无主色（如渐变）时退化为平均。
 */
/**
 * 肤色归一：把判定为肤色的主色统一为 G1 色号 RGB(255,228,211)，
 * 解决生成图把脸画成深棕/小麦色导致肤色不符的问题。
 * 判定条件：暖色相（R>G>B）、足够亮、色相不偏橙不偏黄太多，避免误伤头发/衣服。
 */
function skinNormalize(r, g, b) {
  // 暖肤色判定：暖色相 + 足够亮 + 有一定饱和度（排除暖灰白背景）
  if (
    r > g &&
    g > b &&
    r >= 190 &&
    g >= 150 &&
    r - g <= 90 &&
    g - b <= 85 &&
    r - b >= 25
  ) {
    return [255, 228, 211]
  }
  return [r, g, b]
}

function dominantBlockRgb(imageData, srcW, srcH, size) {
  const data = imageData.data
  const bw = Math.floor(srcW / size)
  const bh = Math.floor(srcH / size)
  const rgbArr = []
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const x0 = c * bw
      const y0 = r * bh
      const buckets = new Map()
      let total = 0
      for (let dy = 0; dy < bh; dy++) {
        const rowBase = (y0 + dy) * srcW + x0
        for (let dx = 0; dx < bw; dx++) {
          const i = (rowBase + dx) * 4
          if (data[i + 3] < 128) continue
          const key = ((data[i] >> 5) << 10) | ((data[i + 1] >> 5) << 5) | (data[i + 2] >> 5)
          let b = buckets.get(key)
          if (!b) {
            b = { r: 0, g: 0, b: 0, n: 0 }
            buckets.set(key, b)
          }
          b.r += data[i]
          b.g += data[i + 1]
          b.b += data[i + 2]
          b.n++
          total++
        }
      }
      if (total === 0) {
        rgbArr.push([255, 255, 255])
        continue
      }
      let best = null
      for (const b of buckets.values()) {
        if (!best || b.n > best.n) best = b
      }
      if (best.n / total >= 0.35) {
        // 肤色本地兜底（暂注释）：统一肤色为 G1，避免模型肤色飘移；需要时取消注释
        // rgbArr.push(
        //   skinNormalize(
        //     Math.round(best.r / best.n),
        //     Math.round(best.g / best.n),
        //     Math.round(best.b / best.n)
        //   )
        // )
        rgbArr.push([
          Math.round(best.r / best.n),
          Math.round(best.g / best.n),
          Math.round(best.b / best.n)
        ])
      } else {
        let sr = 0
        let sg = 0
        let sb = 0
        for (const b of buckets.values()) {
          sr += b.r
          sg += b.g
          sb += b.b
        }
        // 肤色本地兜底（暂注释），同上
        // rgbArr.push(
        //   skinNormalize(
        //     Math.round(sr / total),
        //     Math.round(sg / total),
        //     Math.round(sb / total)
        //   )
        // )
        rgbArr.push([Math.round(sr / total), Math.round(sg / total), Math.round(sb / total)])
      }
    }
  }
  return rgbArr
}

/**
 * 纯函数：整幅生成图纸像素 → 主色分块 → 当前套装色号网格。
 */
function imageDataToGrid(imageData, srcW, srcH, size, setKey) {
  return pattern.mapRgb(
    dominantBlockRgb(imageData, srcW, srcH, size),
    size,
    color.buildPalette(setKey)
  )
}

/**
 * 把生成的图片 data URL 写入临时文件 → 加载 → 读整幅像素 → 主色分块映射为色号网格。
 */
async function imageToGrid(dataUrl, size, setKey) {
  const m = /^data:image\/([a-zA-Z0-9.+-]+);base64,/.exec(dataUrl)
  if (!m) throw new Error('生成的图片格式不正确')
  const fs = wx.getFileSystemManager()
  const tempPath =
    wx.env.USER_DATA_PATH +
    '/ai_pix_' +
    Date.now() +
    '_' +
    Math.floor(Math.random() * 1000000) +
    '.' +
    m[1].toLowerCase()
  await new Promise((resolve, reject) => {
    fs.writeFile({
      filePath: tempPath,
      data: dataUrl.slice(dataUrl.indexOf(',') + 1),
      encoding: 'base64',
      success: resolve,
      fail: (err) => reject(new Error('图纸图片保存失败: ' + ((err && err.errMsg) || '')))
    })
  })
  return fileToGrid(tempPath, size, setKey)
}

/**
 * 从本地临时文件加载图片 → 读整幅像素 → 主色分块映射为色号网格（cloud 模式下载 fileID 后走这里）。
 */
async function fileToGrid(tempPath, size, setKey) {
  const loader = wx.createOffscreenCanvas({ type: '2d', width: 1, height: 1 })
  const img = await image.loadImageOnce(loader, tempPath)
  const canvas = wx.createOffscreenCanvas({ type: '2d', width: img.width, height: img.height })
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, img.width, img.height)
  ctx.drawImage(img, 0, 0, img.width, img.height)
  const imageData = ctx.getImageData(0, 0, img.width, img.height)
  background.cleanImageData(imageData) // 背景近白噪声 → 纯白，不影响主体内容
  return imageDataToGrid(imageData, img.width, img.height, size, setKey)
}

module.exports = { compressToBase64, callAiGenerate, generateGrid, isTimeoutError, CLOUD_RETRY_MAX, imageToGrid, imageDataToGrid, dominantBlockRgb, skinNormalize }
