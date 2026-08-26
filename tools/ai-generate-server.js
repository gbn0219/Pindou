// 本地生成代理服务（开发用，无需部署云函数）
// 用法：node tools/ai-generate-server.js（读取项目根目录 .env 中的 ARK_API_KEY，默认端口 8787）
// 小程序端在开发者工具勾选"不校验合法域名"后，通过 config.aiGenerate.localUrl 调用本服务。
//
// 流程：POST /ai-generate 提交任务立即返回 taskId → 客户端轮询 GET /ai-generate/status?taskId=xx
//
// 为什么用图像生成：
// 1) 文字色号方案（qwen3-vl function call）实测在 ~300 token 处提前截断，2704 个色号一次输出必失败；
//    分块生成又导致块与块之间风格不统一。
// 2) 改为调用豆包 Seedream（doubao-seedream-5.0-lite，火山方舟 OpenAI 兼容接口
//    images/generations）直接生成一张像素风格的图纸图片（2K ≈ 2048×2048），
//    由前端读取图片像素映射为拼豆色号，完全绕开输出 token 上限。
//    52/78/104 三种盘面统一用 2K 输出，前端 dominantBlockRgb 按盘面 floor 分块取主色，
//    不依赖"每格 16px"的精确尺寸。
const http = require('http')
const https = require('https')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { buildPrompt } = require('./prompt')

const GEN_HOST = 'ark.cn-beijing.volces.com'
const GEN_PATH = '/api/plan/v3/images/generations'
const DEFAULT_MODEL = 'doubao-seedream-5.0-lite' // 可在 .env 里用 ARK_MODEL 覆盖
const GEN_SIZE = '2k' // Seedream 2K（约 2048×2048 方形）；Ark 尺寸参数只接受 WIDTHxHEIGHT 或 2k/3k/4k（1K 以下不满足最小像素要求）
const BOARD_MIN = 15 // 拼豆盘最小边长
const BOARD_MAX = 208 // 拼豆盘最大边长
// 风格参考拼图不再发送（tools/style-refs/ref-pack.jpg、realistic-ref.jpg 文件保留未删）：
// Seedream 多图输入偶尔会直接返回参考图本身，画面引导改为提示词描述（tools/prompt.js）。
// 男孩/女孩脸部参考图（tools/face-refs/boy-face-ref.jpg、girl-face-ref.jpg）随请求固定发送，
// 仅用于学习五官表达，提示词禁止复制示例中的角色/内容。
const BOY_REF_PATH = path.join(__dirname, 'face-refs', 'boy-face-ref.jpg')
const GIRL_REF_PATH = path.join(__dirname, 'face-refs', 'girl-face-ref.jpg')
const TASK_TTL_MS = 10 * 60 * 1000
const tasks = new Map()
let taskSeq = 0

function loadEnv() {
  const env = {}
  const envPath = path.join(__dirname, '..', '.env')
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^([A-Za-z0-9_]+)=(.*)$/)
      if (m) env[m[1]] = m[2].trim()
    }
  }
  return env
}

function lanAddresses() {
  const list = []
  const nets = os.networkInterfaces()
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) list.push(net.address)
    }
  }
  return list
}

function createTask() {
  const taskId = 'task_' + Date.now() + '_' + ++taskSeq
  const task = { status: 'pending', image: null, error: null, createdAt: Date.now() }
  tasks.set(taskId, task)
  return { taskId, task }
}

function pruneTasks() {
  const now = Date.now()
  for (const [id, t] of tasks) {
    if (now - t.createdAt > TASK_TTL_MS) tasks.delete(id)
  }
}

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
  if (fs.existsSync(BOY_REF_PATH)) images.push(imageDataUrl(BOY_REF_PATH)) // 男孩脸部参考
  if (fs.existsSync(GIRL_REF_PATH)) images.push(imageDataUrl(GIRL_REF_PATH)) // 女孩脸部参考
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
  // 一次任务只调一次 Seedream（不做 429/5xx 自动重试，避免一次生成多次调模型）
  const resp = await postJson(GEN_HOST, GEN_PATH, payload, apiKey, 300000)
  const errMsg =
    (resp && ((resp.error && resp.error.message) || resp.message || resp.code)) || ''
  if (errMsg) {
    throw new Error('生成服务返回错误: ' + errMsg)
  }
  const url = extractImageUrl(resp)
  if (!url) {
    throw new Error('生成服务未返回图片 URL: ' + JSON.stringify(resp).slice(0, 300))
  }
  const { buffer, contentType } = await downloadBinary(url, 120000, 5)
  return { image: 'data:' + (contentType || 'image/jpeg') + ';base64,' + buffer.toString('base64') }
}

const env = loadEnv()
const API_KEY = env.ARK_API_KEY || process.env.ARK_API_KEY
const MODEL = env.ARK_MODEL || process.env.ARK_MODEL || DEFAULT_MODEL
const PORT = Number(process.env.PORT || env.PORT || 8787)

const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  if (req.method === 'GET' && req.url === '/health') {
    res.end(JSON.stringify({ ok: true, keyConfigured: !!API_KEY, model: MODEL }))
    return
  }
  if (req.method === 'GET' && req.url.indexOf('/ai-generate/status') === 0) {
    const q = new URL(req.url, 'http://localhost').searchParams
    const taskId = q.get('taskId')
    const task = taskId && tasks.get(taskId)
    if (!task) {
      res.statusCode = 404
      res.end(JSON.stringify({ error: 'task not found' }))
      return
    }
    res.end(JSON.stringify({ status: task.status, image: task.image, error: task.error }))
    return
  }
  if (req.method === 'POST' && req.url === '/ai-generate') {
    let body = ''
    req.on('data', (chunk) => {
      body += chunk
    })
    req.on('end', () => {
      if (!API_KEY) {
        res.statusCode = 500
        res.end(JSON.stringify({ error: '未配置 ARK_API_KEY，请在项目根目录 .env 中填写' }))
        return
      }
      let data
      try {
        data = JSON.parse(body)
      } catch (e) {
        res.statusCode = 400
        res.end(JSON.stringify({ error: '请求体不是合法 JSON' }))
        return
      }
      pruneTasks()
      const { taskId, task } = createTask()
      console.log('[ai-generate] 收到请求，任务', taskId)
      res.end(JSON.stringify({ taskId }))
      generate(API_KEY, MODEL, data)
        .then((result) => {
          task.status = 'done'
          task.image = result.image
          console.log(
            '[ai-generate] 任务',
            taskId,
            '成功，耗时',
            ((Date.now() - task.createdAt) / 1000).toFixed(1) + 's'
          )
        })
        .catch((e) => {
          task.status = 'error'
          task.error = e.message
          console.error(
            '[ai-generate] 任务',
            taskId,
            '失败，耗时',
            ((Date.now() - task.createdAt) / 1000).toFixed(1) + 's:',
            e.message
          )
        })
    })
    return
  }
  res.statusCode = 404
  res.end(JSON.stringify({ error: 'not found' }))
})

server.listen(PORT, '0.0.0.0', () => {
  console.log('生成代理服务已启动: http://127.0.0.1:' + PORT)
  const lans = lanAddresses()
  if (lans.length) {
    console.log(
      '真机调试 localUrl（手机与电脑同一 Wi-Fi）：' +
        lans.map((ip) => 'http://' + ip + ':' + PORT).join(' 或 ')
    )
  } else {
    console.log('未检测到局域网 IP，真机调试请手动填写电脑 IP 到 config.localUrl')
  }
  console.log('API Key 已配置: ' + (API_KEY ? '是' : '否（请填写 .env 中的 ARK_API_KEY）'))
  console.log('模型: ' + MODEL)
})