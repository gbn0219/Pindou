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
const POLL_MAX_MS = 300000 // 本地服务轮询总等待上限 5 分钟（开发调试用）
const POLL_INTERVAL_SLOW = 10000 // 云函数轮询超过 1 分钟后放慢间隔，减少长等待期无效 status 调用
const POLL_TASK_MAX_MS = 870000 // 云函数异步任务单次总等待上限（worker 配置 900s 超时，预留状态更新与下载余量）

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
        console.error('[ai-generate] 本地任务失败:', taskId, d.error || '本地生成服务生成失败')
        reject(new Error(d.error || '本地生成服务生成失败'))
        return
      }
      if (Date.now() - start > POLL_MAX_MS) {
        console.error('[ai-generate] 本地任务轮询超时:', taskId, Math.round(POLL_MAX_MS / 1000) + 's')
        reject(new Error('生成超时（超过 ' + Math.round(POLL_MAX_MS / 1000) + ' 秒），请重试'))
        return
      }
      setTimeout(() => pollTask(ai, taskId, resolve, reject, start), POLL_INTERVAL)
    })
    .catch(() => {
      // 轮询网络抖动时继续重试，直到总等待上限
      if (Date.now() - start > POLL_MAX_MS) {
        console.error('[ai-generate] 本地任务轮询超时:', taskId, Math.round(POLL_MAX_MS / 1000) + 's')
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

function callCloudFunction(name, data) {
  return wx.cloud
    .callFunction({ name, data })
    .then((res) => {
      const result = res && res.result
      if (!result || result.ok === false) {
        const msg = (result && result.error) || '云函数调用失败'
        const detail = result && result.detail
        if (detail) console.error('[ai-generate] 云函数返回错误详情:', detail)
        throw new Error(detail ? msg + '：' + detail : msg)
      }
      return result
    })
}

function readFileBase64(filePath) {
  return new Promise((resolve, reject) => {
    wx.getFileSystemManager().readFile({
      filePath,
      encoding: 'base64',
      success: (r) => resolve(r.data),
      fail: (err) => reject(new Error('生成结果读取失败: ' + ((err && err.errMsg) || '')))
    })
  })
}

async function downloadResultFile(fileID, ext) {
  const extName = ext || 'jpg'
  let lastErr = null
  for (let i = 0; i < 3; i++) {
    try {
      const res = await new Promise((resolve, reject) => {
        wx.cloud.downloadFile({
          fileID,
          success: resolve,
          fail: (err) => reject(new Error((err && err.errMsg) || '生成结果下载失败'))
        })
      })
      const base64 = await readFileBase64(res.tempFilePath)
      return 'data:image/' + extName + ';base64,' + base64
    } catch (e) {
      lastErr = e
    }
  }
  throw lastErr || new Error('生成结果下载失败')
}

function pollCloudTask(taskId) {
  return new Promise((resolve, reject) => {
    const start = Date.now()
    // 前 1 分钟每 3s 轮询，之后放慢到 10s，减少长等待期无效 status 调用
    const nextInterval = () => (Date.now() - start > 60000 ? POLL_INTERVAL_SLOW : POLL_INTERVAL)
    const tick = () => {
      callCloudFunction('ai-generate-pattern', { action: 'status', taskId })
        .then((d) => {
          if (d.status === 'done' && d.fileID) {
            resolve(d)
            return
          }
          if (d.status === 'error') {
            console.error('[ai-generate] 云函数任务失败（status=error）:', taskId, d.error || '生成失败')
            reject(new Error(d.error || '生成失败'))
            return
          }
          if (Date.now() - start > POLL_TASK_MAX_MS) {
            console.error('[ai-generate] 云函数任务轮询超时:', taskId, Math.round(POLL_TASK_MAX_MS / 1000) + 's')
            reject(new Error('生成超时'))
            return
          }
          setTimeout(tick, nextInterval())
        })
        .catch(() => {
          // 轮询网络抖动时继续重试，直到单次总等待上限
          if (Date.now() - start > POLL_TASK_MAX_MS) {
            console.error('[ai-generate] 云函数任务轮询超时:', taskId, Math.round(POLL_TASK_MAX_MS / 1000) + 's')
            reject(new Error('生成超时'))
            return
          }
          setTimeout(tick, nextInterval())
        })
    }
    tick()
  })
}

// 基础库层错误（-404012/-404005、callFunction 超时重试等）对用户无意义，统一换成友好文案
function sanitizeCloudError(err) {
  const msg = String((err && err.message) || '')
  if (/cloud\.call(Function|Container)|-\d{5,6}|polling|FUNCTION_EXCEED|exceed max/.test(msg)) return ''
  return msg
}

function callCloudTask(data) {
  // 单次提交：一张图只触发一次模型调用；失败不自动重提，由用户手动重新生成
  return callCloudFunction('ai-generate-pattern', Object.assign({ action: 'start' }, data))
    .then((d) => {
      if (!d.taskId) throw new Error((d && d.error) || '云函数未返回任务 ID')
      return pollCloudTask(d.taskId)
    })
    .then((r) => downloadResultFile(r.fileID, r.ext))
    .then((dataUrl) => ({ image: dataUrl }))
    .catch((err) => {
      console.error('[ai-generate] 云函数任务失败:', err && (err.message || err))
      const detail = sanitizeCloudError(err)
      throw new Error(detail ? '生成失败，请稍后重试：' + detail : '生成失败，请稍后重试')
    })
}

function writeTempBase64(dataUrl) {
  const m = /^data:image\/([a-zA-Z0-9.+-]+);base64,/.exec(dataUrl || '')
  if (!m) return Promise.reject(new Error('图片数据格式不正确'))
  const fs = wx.getFileSystemManager()
  const tempPath =
    wx.env.USER_DATA_PATH +
    '/ai_input_' +
    Date.now() +
    '_' +
    Math.floor(Math.random() * 1000000) +
    '.' +
    m[1].toLowerCase()
  return new Promise((resolve, reject) => {
    fs.writeFile({
      filePath: tempPath,
      data: dataUrl.slice(dataUrl.indexOf(',') + 1),
      encoding: 'base64',
      success: () => resolve(tempPath),
      fail: (err) => reject(new Error('图片临时文件写入失败: ' + ((err && err.errMsg) || '')))
    })
  })
}

function uploadInput(dataUrl, openid, key) {
  if (!dataUrl) return Promise.resolve('')
  return writeTempBase64(dataUrl).then((tempPath) =>
    wx.cloud
      .uploadFile({
        cloudPath: 'ai-inputs/' + openid + '/' + key + '.' + (tempPath.split('.').pop() || 'jpg'),
        filePath: tempPath
      })
      .then((r) => {
        try {
          wx.getFileSystemManager().unlinkSync(tempPath)
        } catch (e) {
          /* 临时文件清理失败可忽略 */
        }
        return r.fileID
      })
  )
}

function callAiGenerate(params) {
  const ai = (config && config.aiGenerate) || {}
  const base = {
    size: params.size,
    set: params.set,
    style: params.style,
    styleKey: params.styleKey,
    extra: params.extra || '',
    cutout: !!params.cutout,
    regenerate: !!params.regenerate,
    imageHash: params.imageHash || '',
    sessionId: params.sessionId || '',
    requestId: Date.now() + '_' + Math.floor(Math.random() * 1000000) // 每次点击唯一，调度函数幂等去重
  }
  if (ai.backend === 'local' && ai.localUrl) {
    return callLocal(ai, Object.assign({ imageBase64: params.imageBase64, refImageBase64: params.refImageBase64 || '' }, base))
  }
  // 云模式：先把图片传到云存储（uploadFile 不受 callFunction 大小/超时限制），start 只带 fileID，
  // 避免携带几百 KB base64 触发 callFunction 客户端超时（-404012）
  const u = ((getApp && getApp()) && getApp().globalData && getApp().globalData.user) || {}
  const openid = u.openid || u._openid || 'guest'
  const key = (params.imageHash || Date.now()) + '_' + Math.floor(Math.random() * 1000000)
  return Promise.all([
    uploadInput(params.imageBase64, openid, 'img_' + key),
    uploadInput(params.refImageBase64, openid, 'ref_' + key)
  ]).then(([imageFileID, refImageFileID]) =>
    callCloudTask(Object.assign({ imageFileID, refImageFileID }, base))
  )
}

function canvasToTempFile(canvas, px) {
  return new Promise((resolve, reject) => {
    wx.canvasToTempFilePath({
      canvas,
      fileType: 'jpg',
      quality: 0.8,
      destWidth: px,
      destHeight: px,
      success: (r) => resolve(r.tempFilePath),
      fail: reject
    })
  })
}

/**
 * 生成并映射网格：base64 已在 params.imageBase64。
 * 返回 { grid, prevImage, bgMask }：grid 为当前套装色号网格；bgMask 为抠图模式下的
 * 网格级背景掩码（true=背景格，不标色号；未识别到标记色时为 null）；prevImage 为"清洗后"的生成图
 * （背景已处理为白色，缩至 MAX_SIZE），供重新生成时作为第二张参考图，可能为空字符串。
 */
async function generateGrid(params) {
  const resp = await callAiGenerate(params)
  return imageToGrid(resp.image, params.size, params.set, { cutout: !!params.cutout, savePrev: true })
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

function dominantBlockRgb(imageData, srcW, srcH, size, bgMask, outBgMask) {
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
      let bgTotal = 0
      for (let dy = 0; dy < bh; dy++) {
        const rowBase = (y0 + dy) * srcW + x0
        for (let dx = 0; dx < bw; dx++) {
          const i = (rowBase + dx) * 4
          if (data[i + 3] < 128) continue
          if (bgMask && bgMask[rowBase + dx]) bgTotal++
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
        if (outBgMask) outBgMask[r][c] = false
        continue
      }
      // 背景格：块内标记色背景占比 >= 50% 时强制映射为白色（H1），确保后续白色连通域识别
      if (bgMask && bgTotal / total >= 0.5) {
        rgbArr.push([255, 255, 255])
        if (outBgMask) outBgMask[r][c] = true
        continue
      }
      if (outBgMask) outBgMask[r][c] = false
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
function imageDataToGrid(imageData, srcW, srcH, size, setKey, opts) {
  return pattern.mapRgb(
    dominantBlockRgb(imageData, srcW, srcH, size, opts && opts.bgMask),
    size,
    color.buildPalette(setKey)
  )
}

/**
 * 把生成的图片 data URL 写入临时文件 → 加载 → 读整幅像素 → 主色分块映射为色号网格。
 * opts：{ cutout, savePrev }。cutout 时用洋红标记色识别背景（未检测到标记色则回退近白清洗）；
 * savePrev 时返回清洗后的压缩版生成图路径（供重新生成作第二张参考图）。
 * 返回 { grid, prevImage, bgMask }：bgMask 为抠图模式下的网格级背景掩码
 * （true=背景格，不标色号；未识别到标记色时为 null，调用方回退白色连通域判定）。
 */
async function imageToGrid(dataUrl, size, setKey, opts) {
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
  const loader = wx.createOffscreenCanvas({ type: '2d', width: 1, height: 1 })
  const img = await image.loadImageOnce(loader, tempPath)
  const canvas = wx.createOffscreenCanvas({ type: '2d', width: img.width, height: img.height })
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, img.width, img.height)
  ctx.drawImage(img, 0, 0, img.width, img.height)
  const imageData = ctx.getImageData(0, 0, img.width, img.height)
  let bgMask = null
  if (opts && opts.cutout) {
    // 洋红标记背景 → 纯白；噪点上限按盘面格子面积估算（约 4 格 = 2×2 格，吸收背景中漂浮的浅灰/杂色小块），
    // 把背景中漂浮的孤立彩色碎块一并并入背景；未检测到标记色时回退近白清洗
    const cellArea = Math.round((img.width / size) * (img.height / size))
    bgMask = background.cleanMarkerBackground(imageData, { noiseMax: Math.max(128, cellArea * 4) })
    console.log('[ai-generate] 抠图背景处理:', bgMask ? '识别到洋红标记背景' : '未识别到标记色，回退近白清洗')
    if (!bgMask) background.cleanImageData(imageData)
  } else {
    background.cleanImageData(imageData) // 背景近白噪声 → 纯白，不影响主体内容
  }
  let gridBgMask = null
  if (bgMask) {
    gridBgMask = []
    for (let r = 0; r < size; r++) gridBgMask.push(new Array(size).fill(false))
  }
  const grid = pattern.mapRgb(
    dominantBlockRgb(imageData, img.width, img.height, size, bgMask, gridBgMask),
    size,
    color.buildPalette(setKey)
  )
  // 输出前保险：抠图模式审查背景是否为白色（洋红/玫红且与背景相邻或连边的区域并入背景并强制白色）
  if (opts && opts.cutout) {
    gridBgMask = background.ensureWhiteBackground(grid, color.buildPalette(setKey), gridBgMask)
  }
  let prevImage = ''
  if (opts && opts.savePrev) {
    // 保留"清洗后"的生成图（背景已为白色），供重新生成时作第二张参考图
    ctx.putImageData(imageData, 0, 0)
    prevImage = await canvasToTempFile(canvas, MAX_SIZE)
  }
  return { grid, prevImage, bgMask: gridBgMask }
}

module.exports = { compressToBase64, callAiGenerate, generateGrid, imageToGrid, imageDataToGrid, dominantBlockRgb, skinNormalize }
