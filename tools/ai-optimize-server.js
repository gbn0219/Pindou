// 本地 AI 优化代理服务（开发用，无需部署云函数）
// 用法：node tools/ai-optimize-server.js   （读取项目根目录 .env 中的 DASHSCOPE_API_KEY，默认端口 8787）
// 小程序端在开发者工具勾选"不校验合法域名"后，通过 config.aiOptimize.localUrl 调用本服务。
const http = require('http')
const https = require('https')
const fs = require('fs')
const path = require('path')

const GENERATION_HOST = 'dashscope.aliyuncs.com'
const GENERATION_PATH = '/api/v1/services/aigc/multimodal-generation/generation'
const DEFAULT_MODEL = 'qwen-image-2.0-pro'

const DEFAULT_PROMPT =
  '图1是原始图片，图2是根据图1生成的拼豆图纸预览图，每个色块代表一颗拼豆。请基于图1优化图2，制作一张高质量的拼豆图纸：' +
  '1) 人物、物体和五官（眼睛、鼻子、嘴巴、耳朵等）的特征必须与图1保持一致，整体观感应像图1；' +
  '2) 物体和人物边界清晰，尽量使用黑色像素描边；' +
  '3) 平滑每个物体内部的颜色，去除杂色和孤立噪点，使同一区域颜色统一干净；' +
  '4) 配色与图1一致；' +
  '5) 保持 1:1 方形图纸风格；' +
  '6) 不要添加任何文字。输出与输入相同的方形像素图纸风格。'

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
            reject(new Error('AI 响应解析失败: ' + data.slice(0, 200)))
          }
        })
      }
    )
    req.on('timeout', () => req.destroy(new Error('AI 调用超时')))
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

function download(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const req = https.request(
      {
        host: u.host,
        path: u.pathname + u.search,
        method: 'GET',
        timeout: timeoutMs
      },
      (res) => {
        if (res.statusCode !== 200) {
          reject(new Error('下载结果失败: HTTP ' + res.statusCode))
          return
        }
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => resolve(Buffer.concat(chunks)))
      }
    )
    req.on('timeout', () => req.destroy(new Error('下载结果超时')))
    req.on('error', reject)
    req.end()
  })
}

async function optimize(apiKey, imageBase64, originalImageBase64, prompt) {
  const reqContent = []
  if (originalImageBase64) reqContent.push({ image: originalImageBase64 })
  reqContent.push({ image: imageBase64 }, { text: prompt || DEFAULT_PROMPT })
  const payload = {
    model: DEFAULT_MODEL,
    input: { messages: [{ role: 'user', content: reqContent }] },
    // 本地直连返回 base64，用 512 尺寸控制响应体积；云函数走云存储可用 1024
    parameters: { prompt_extend: true, size: '512*512', watermark: false }
  }
  const resp = await postJson(GENERATION_HOST, GENERATION_PATH, payload, apiKey, 120000)
  if (resp.code || resp.message) {
    throw new Error('AI 返回错误(' + (resp.code || 'unknown') + '): ' + (resp.message || ''))
  }
  const content =
    resp.output &&
    resp.output.choices &&
    resp.output.choices[0] &&
    resp.output.choices[0].message &&
    resp.output.choices[0].message.content
  const img = content && content[0] && content[0].image
  if (!img) throw new Error('AI 未返回图片结果')
  const buf = await download(img, 120000)
  return 'data:image/png;base64,' + buf.toString('base64')
}

const env = loadEnv()
const API_KEY = env.DASHSCOPE_API_KEY || process.env.DASHSCOPE_API_KEY
const PORT = Number(process.env.PORT || env.PORT || 8787)

const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  if (req.method === 'GET' && req.url === '/health') {
    res.end(JSON.stringify({ ok: true, keyConfigured: !!API_KEY, model: DEFAULT_MODEL }))
    return
  }
  if (req.method === 'POST' && req.url === '/ai-optimize') {
    let body = ''
    req.on('data', (c) => {
      body += c
    })
    req.on('end', async () => {
      if (!API_KEY) {
        res.statusCode = 500
        res.end(JSON.stringify({ error: '未配置 DASHSCOPE_API_KEY，请在项目根目录 .env 中填写' }))
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
      if (!data.imageBase64) {
        res.statusCode = 400
        res.end(JSON.stringify({ error: '缺少 imageBase64' }))
        return
      }
      try {
        const imageBase64 = await optimize(API_KEY, data.imageBase64, data.originalImageBase64, data.prompt)
        res.end(JSON.stringify({ imageBase64 }))
      } catch (e) {
        res.statusCode = 500
        res.end(JSON.stringify({ error: e.message }))
      }
    })
    return
  }
  res.statusCode = 404
  res.end(JSON.stringify({ error: 'not found' }))
})

server.listen(PORT, '127.0.0.1', () => {
  console.log('AI 优化代理服务已启动: http://127.0.0.1:' + PORT)
  console.log('API Key 已配置: ' + (API_KEY ? '是' : '否（请填写 .env 中的 DASHSCOPE_API_KEY）'))
})