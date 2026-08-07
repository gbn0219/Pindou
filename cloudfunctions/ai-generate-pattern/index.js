// AI 生成拼豆图纸云函数（图像方案，与本地代理服务 tools/ai-generate-server.js 保持一致）
// 流程：接收原图 base64 → 调用火山方舟 Seedream（doubao-seedream-5-0-260128，OpenAI 兼容
// images/generations 接口）图生图生成像素风格图纸 → 下载图片转 base64 → 返回 { image }
// 环境变量：ARK_API_KEY（必填）、ARK_MODEL（可选，默认 doubao-seedream-5-0-260128）
// 注意：云函数超时需在控制台调大（建议 60s）。提示词与本地服务共用 tools/prompt.js 的同步副本（./prompt.js）。
const http = require('http')
const https = require('https')
const fs = require('fs')
const path = require('path')
const cloud = require('wx-server-sdk')
const { buildPrompt } = require('./prompt')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const MAX_ATTEMPTS = 3 // 每张原图免费生成次数上限

const GEN_HOST = 'ark.cn-beijing.volces.com'
const GEN_PATH = '/api/v3/images/generations'
const DEFAULT_MODEL = 'doubao-seedream-5-0-260128'
const GEN_SIZE = '2k' // Seedream 2K（约 2048×2048 方形）；Ark 尺寸参数只接受 WIDTHxHEIGHT 或 2k/3k/4k（1K 以下不满足最小像素要求）
const BOARD_MIN = 15 // 拼豆盘最小边长
const BOARD_MAX = 208 // 拼豆盘最大边长
// 五官画法示例拼图（tools/face-refs/face-ref.jpg 合成，部署目录内为其副本），作为第三张参考图随请求发送，
// 仅用于学习五官表达，提示词禁止复制示例中的角色/内容。
const FACE_REF_PATH = path.join(__dirname, 'face-ref.jpg')

function postJson(host, pathname, payload, apiKey, timeoutMs) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload)
    const req = https.request(
      {
        host,
        path: pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          Authorization: 'Bearer ' + apiKey
        },
        timeout: timeoutMs
      },
      (res) => {
        let data = ''
        res.on('data', (chunk) => {
          data += chunk
        })
        res.on('end', () => {
          try {
            resolve(JSON.parse(data))
          } catch (e) {
            reject(new Error('生成服务响应解析失败: ' + data.slice(0, 200)))
          }
        })
      }
    )
    req.on('timeout', () => req.destroy(new Error('生成调用超时')))
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

function downloadBinary(url, timeoutMs, redirectsLeft) {
  return new Promise((resolve, reject) => {
    const mod = url.indexOf('https:') === 0 ? https : http
    const req = mod.get(url, { timeout: timeoutMs || 60000 }, (res) => {
      if (
        res.statusCode >= 300 &&
        res.statusCode < 400 &&
        res.headers.location &&
        redirectsLeft > 0
      ) {
        res.resume()
        resolve(downloadBinary(res.headers.location, timeoutMs, redirectsLeft - 1))
        return
      }
      if (res.statusCode >= 400) {
        res.resume()
        reject(new Error('生成图片下载失败: HTTP ' + res.statusCode))
        return
      }
      const chunks = []
      res.on('data', (chunk) => {
        chunks.push(chunk)
      })
      res.on('end', () =>
        resolve({
          buffer: Buffer.concat(chunks),
          contentType: res.headers['content-type'] || 'image/jpeg'
        })
      )
    })
    req.on('timeout', () => req.destroy(new Error('生成图片下载超时')))
    req.on('error', reject)
  })
}

function imageDataUrl(filePath) {
  let ext = path.extname(filePath).slice(1).toLowerCase() || 'jpg'
  if (ext === 'jpg') ext = 'jpeg' // MIME 标准为 image/jpeg
  const base64 = fs.readFileSync(filePath).toString('base64')
  return 'data:image/' + ext + ';base64,' + base64
}
function extractImageUrl(resp) {
  // OpenAI 兼容返回：{ data: [{ url }] }
  if (resp && resp.data && resp.data[0] && resp.data[0].url) return resp.data[0].url
  return null
}

async function generate(apiKey, model, data) {
  const size = Number(data.size)
  if (!Number.isInteger(size) || size < BOARD_MIN || size > BOARD_MAX) {
    throw new Error('图像生成仅支持 ' + BOARD_MIN + '×' + BOARD_MIN + ' ~ ' + BOARD_MAX + '×' + BOARD_MAX + ' 的整数盘面')
  }
  if (!data.imageBase64) {
    throw new Error('请求缺少 imageBase64')
  }
  const images = [data.imageBase64]
  if (fs.existsSync(FACE_REF_PATH)) images.push(imageDataUrl(FACE_REF_PATH))
  const payload = {
    model,
    prompt: buildPrompt({
      size,
      style: data.style || '卡通',
      styleKey: data.styleKey || 'cartoon',
      cutout: data.cutout,
      subject: data.subject || 'auto',
      extra: data.extra
    }),
    image: images,
    size: GEN_SIZE,
    response_format: 'url',
    watermark: false, // 默认 true 会加"AI生成"水印，拼豆图纸必须关闭
    seed: Math.floor(Math.random() * 2147483647) // 随机种子：不传时模型用固定默认种子，相同输入会返回同一张图
  }
  // 调用火山方舟：429 / 5xx / 网络异常自动重试，避免用户连续生成被限流
  let resp = null
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      resp = await postJson(GEN_HOST, GEN_PATH, payload, apiKey, 120000)
    } catch (e) {
      if (attempt >= 3) throw new Error('生成调用失败: ' + e.message)
      await new Promise((r) => setTimeout(r, 5000 * (attempt + 1)))
      continue
    }
    const errMsg =
      (resp && ((resp.error && resp.error.message) || resp.message || resp.code)) || ''
    if (!errMsg) break
    const retriable = /rate limit|429|5\d\d|throttl/i.test(errMsg)
    if (!retriable || attempt >= 3) {
      throw new Error('生成服务返回错误: ' + errMsg)
    }
    await new Promise((r) => setTimeout(r, 8000 * (attempt + 1)))
  }
  const url = extractImageUrl(resp)
  if (!url) {
    throw new Error('生成服务未返回图片 URL: ' + JSON.stringify(resp).slice(0, 300))
  }
  const { buffer, contentType } = await downloadBinary(url, 60000, 5)
  return { image: 'data:' + (contentType || 'image/jpeg') + ';base64,' + buffer.toString('base64') }
}

async function checkQuota(openid, event) {
  const db = cloud.database()
  const users = await db.collection('users').where({ _openid: openid }).limit(1).get()
  if (users.data.length && users.data[0].freeVip) return
  if (!event.imageHash) throw new Error('缺少 imageHash')
  const col = db.collection('ai_sessions')
  const res = await col.where({ _openid: openid, imageHash: event.imageHash }).limit(1).get()
  if (!res.data.length) {
    await col.add({
      data: {
        _openid: openid, sessionId: event.sessionId || '', imageHash: event.imageHash,
        attempts: 1, unlocked: false, createdAt: db.serverDate(), updatedAt: db.serverDate()
      }
    })
    return
  }
  const doc = res.data[0]
  if (doc.unlocked) return
  if (doc.attempts >= MAX_ATTEMPTS) throw new Error('已达该图片免费生成上限（3 次），请解锁一张或更换图片')
  await col.doc(doc._id).update({ data: { attempts: doc.attempts + 1, updatedAt: db.serverDate() } })
}

exports.main = async (event) => {
  const apiKey = process.env.ARK_API_KEY
  if (!apiKey) {
    return { error: '云函数未配置 ARK_API_KEY 环境变量' }
  }
  const { OPENID } = cloud.getWXContext()
  if (!OPENID) return { error: '请先登录' }
  const model = process.env.ARK_MODEL || DEFAULT_MODEL
  try {
    await checkQuota(OPENID, event || {})
    return await generate(apiKey, model, event || {})
  } catch (e) {
    return { error: e.message }
  }
}