// 生成 worker：独立云函数调用，拥有完整 60s 执行预算（微信云函数单次执行上限固定 60s，无法调大）。
// 由 ai-generate-pattern 的 start 通过云调用接口 addDelayedFunctionTask 延时触发：
//   读取 ai_tasks 中 pending 任务 → 下载参数 JSON（云存储）→ 调火山方舟 Seedream
//   （doubao-seedream-5-0-260128，OpenAI 兼容 images/generations）生成像素风格图纸 → 下载图片
//   → 上传云存储 ai-tasks/<openid>/<taskId>.<ext> → 更新任务 done/error。
// 单次预算内优先保证完成一次生成；超预算或失败时任务落 error，由前端自动重新提交
// （每次重提都是新的任务 ID + 新的 60s 预算），不向用户暴露云函数原始报错。
// 环境变量：ARK_API_KEY（必填）、ARK_MODEL（可选，默认 doubao-seedream-5-0-260128）。
const http = require('http')
const https = require('https')
const fs = require('fs')
const path = require('path')
const cloud = require('wx-server-sdk')
const { buildPrompt } = require('./prompt')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const GEN_HOST = 'ark.cn-beijing.volces.com'
const GEN_PATH = '/api/v3/images/generations'
const DEFAULT_MODEL = 'doubao-seedream-5-0-260128'
const GEN_SIZE = '2k' // Seedream 2K（约 2048×2048 方形）；Ark 尺寸参数只接受 WIDTHxHEIGHT 或 2k/3k/4k（1K 以下不满足最小像素要求）
const BOARD_MIN = 15 // 拼豆盘最小边长
const BOARD_MAX = 208 // 拼豆盘最大边长
// 五官画法示例拼图（tools/face-refs/face-ref.jpg 合成，部署目录内为其副本），作为第三张参考图随请求发送，
// 仅用于学习五官表达，提示词禁止复制示例中的角色/内容。
const FACE_REF_PATH = path.join(__dirname, 'face-ref.jpg')
const TASK_COLLECTION = 'ai_tasks' // 异步任务记录集合（start 写 pending，worker 更新 done/error）
const WORKER_BUDGET_MS = 55000 // 云函数上限 60s，预留写库与返回时间

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
  if (data.refImageBase64) images.push(data.refImageBase64) // 重新生成：上一版结果（清洗后压缩图）作为第二张参考图
  if (fs.existsSync(FACE_REF_PATH)) images.push(imageDataUrl(FACE_REF_PATH))
  const payload = {
    model,
    prompt: buildPrompt({
      size,
      style: data.style || '卡通',
      styleKey: data.styleKey || 'cartoon',
      cutout: data.cutout,
      subject: data.subject || 'auto',
      extra: data.extra,
      regenerate: !!data.regenerate
    }),
    image: images,
    size: GEN_SIZE,
    response_format: 'url',
    watermark: false, // 默认 true 会加"AI生成"水印，拼豆图纸必须关闭
    seed: Math.floor(Math.random() * 2147483647) // 随机种子：不传时模型用固定默认种子，相同输入会返回同一张图
  }
  // 调用火山方舟：429 / 5xx / 网络异常自动重试，避免用户连续生成被限流
  console.log('[ai-generate-worker] 调用 Seedream 开始，模型', model, '尺寸', GEN_SIZE, '提示词', payload.prompt.length, '字符，参考图', images.length, '张')
  const tApi = Date.now()
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
    if (!errMsg) {
      console.log('[ai-generate-worker] Seedream 返回成功，生成耗时', Math.round((Date.now() - tApi) / 1000) + 's')
      break
    }
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
  console.log('[ai-generate-worker] 开始下载结果图')
  const tDl = Date.now()
  const { buffer, contentType } = await downloadBinary(url, 60000, 5)
  console.log('[ai-generate-worker] 结果图下载完成，耗时', Math.round((Date.now() - tDl) / 1000) + 's', '大小', Math.round(buffer.length / 1024) + 'KB')
  return { image: 'data:' + (contentType || 'image/jpeg') + ';base64,' + buffer.toString('base64') }
}


function withDeadline(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('生成超时（60 秒预算内未完成，请重试）')),
      ms
    )
    promise.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        clearTimeout(timer)
        reject(e)
      }
    )
  })
}

function extFromDataUrl(dataUrl) {
  const m = /^data:image\/([a-zA-Z0-9.+-]+);base64,/.exec(dataUrl || '')
  const t = (m && m[1].toLowerCase()) || 'jpeg'
  return t === 'jpeg' || t === 'jpg' ? 'jpg' : t
}

async function readParams(fileID) {
  const res = await cloud.downloadFile({ fileID })
  return JSON.parse((res.fileContent || '').toString('utf8') || '{}')
}

async function runTask(event) {
  const openid = event.openid
  const taskId = event.taskId
  if (!openid || !taskId) return { ok: false, error: '缺少 openid/taskId' }
  const db = cloud.database()
  const patch = (p) =>
    db
      .collection(TASK_COLLECTION)
      .where({ _openid: openid, taskId })
      .update({ data: Object.assign({ updatedAt: Date.now() }, p) })
  const res = await db
    .collection(TASK_COLLECTION)
    .where({ _openid: openid, taskId })
    .limit(1)
    .get()
  const rec = res.data && res.data[0]
  if (!rec) return { ok: false, error: '任务不存在' }
  if (rec.status !== 'pending') return { ok: true, status: rec.status } // 已处理（含重提后的旧任务），跳过
  console.log('[ai-generate-worker] 开始生成任务:', taskId)
  const startedAt = Date.now()
  await patch({ status: 'running' })
  const apiKey = process.env.ARK_API_KEY
  if (!apiKey) {
    console.error('[ai-generate-worker] 任务失败（未配置 ARK_API_KEY 环境变量）:', taskId)
    await patch({ status: 'error', error: '云函数未配置 ARK_API_KEY 环境变量' })
    return { ok: true }
  }
  let params = {}
  try {
    if (rec.paramsFileID) {
      params = await readParams(rec.paramsFileID)
      // 参数已读入内存，删除避免云存储积压；失败只留一条日志
      try {
        await cloud.deleteFile({ fileList: [rec.paramsFileID] })
      } catch (e) {
        console.error('[ai-generate-worker] 清理参数文件失败:', e)
      }
    }
  } catch (e) {
    console.error('[ai-generate-worker] 任务参数读取失败:', taskId, e.message)
    await patch({ status: 'error', error: '任务参数读取失败: ' + e.message })
    return { ok: true }
  }
  try {
    const model = process.env.ARK_MODEL || DEFAULT_MODEL
    const result = await withDeadline(generate(apiKey, model, params), WORKER_BUDGET_MS)
    const imageDataUrl = (result && result.image) || ''
    if (!imageDataUrl) throw new Error('生成结果为空')
    const ext = extFromDataUrl(imageDataUrl)
    const buffer = Buffer.from(imageDataUrl.slice(imageDataUrl.indexOf(',') + 1), 'base64')
    const tUp = Date.now()
    const uploaded = await cloud.uploadFile({
      cloudPath: 'ai-tasks/' + openid + '/' + taskId + '.' + ext,
      fileContent: buffer
    })
    console.log('[ai-generate-worker] 结果图上传完成，耗时', Math.round((Date.now() - tUp) / 1000) + 's')
    await patch({ status: 'done', fileID: uploaded.fileID, ext })
    console.log('[ai-generate-worker] 任务成功:', taskId, '耗时', Math.round((Date.now() - startedAt) / 1000) + 's')
  } catch (e) {
    // 失败只记录原因，由前端轮询到 status='error' 后自动重新提交
    console.error('[ai-generate-worker] 任务失败:', taskId, e.message, '耗时', Math.round((Date.now() - startedAt) / 1000) + 's')
    await patch({ status: 'error', error: e.message })
  }
  return { ok: true }
}

exports.main = async (event) => {
  try {
    return await runTask(event || {})
  } catch (e) {
    console.error('[ai-generate-worker] 任务异常:', e)
    return { ok: false, error: e.message }
  }
}
