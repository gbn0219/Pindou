// 本地 AI 生成代理服务（开发用，无需部署云函数）
// 用法：node tools/ai-generate-server.js（读取项目根目录 .env 中的 DASHSCOPE_API_KEY，默认端口 8787）
// 小程序端在开发者工具勾选"不校验合法域名"后，通过 config.aiGenerate.localUrl 调用本服务。
const http = require('http')
const https = require('https')
const fs = require('fs')
const path = require('path')

const CHAT_HOST = 'dashscope.aliyuncs.com'
const CHAT_PATH = '/compatible-mode/v1/chat/completions'
const DEFAULT_MODEL = 'qwen3-vl-plus'

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

function buildColorTable(colors) {
  return colors
    .map((c) => c.code + ' ' + c.hex + ' (' + c.rgb.join(',') + ')')
    .join('\n')
}

function buildSystemPrompt(size, style, colors) {
  const total = size * size
  return (
    '你是拼豆图纸生成器。用户会给你一张真实图片，你需要根据图片内容生成一张 ' + size + '×' + size + ' 的拼豆图纸。\n' +
    '要求：\n' +
    '1) 图纸内容与图片一致（人物/物体的轮廓、五官、姿态、位置关系），以拼豆色块表达；\n' +
    '2) 风格：' + style + '；\n' +
    '3) 只使用下方色表中的色号，禁止使用色表以外的颜色；\n' +
    '4) grid 必须恰好包含 ' + total + ' 个色号，按行优先（第 1 行 ' + size + ' 个 → 第 2 行 ' + size + ' 个 → …）；\n' +
    '5) 不得输出任何解释、前后缀或多余文字，直接调用 submit_pixel_pattern 提交结果。\n\n' +
    '色表（色号 = hex RGB）：\n' +
    buildColorTable(colors)
  )
}

function buildTools(size, set) {
  const total = size * size
  return [
    {
      type: 'function',
      function: {
        name: 'submit_pixel_pattern',
        description:
          '提交根据图片生成的拼豆图纸。grid 必须恰好包含 ' + total + ' 个色号，按行优先排列，每个色号必须来自给定色表。',
        parameters: {
          type: 'object',
          properties: {
            style: { type: 'string', description: '用户选择的图纸风格描述' },
            board_size: { type: 'integer', enum: [size], description: '图纸边长（格数）' },
            color_set: { type: 'string', enum: [set], description: '当前色系' },
            grid: {
              type: 'array',
              items: { type: 'string' },
              minItems: total,
              maxItems: total,
              description: size + '×' + size + ' 个拼豆色号（如 A1），行优先'
            }
          },
          required: ['style', 'board_size', 'color_set', 'grid']
        }
      }
    }
  ]
}

function validateArgs(args, size, set, colors) {
  const total = size * size
  if (!args || typeof args !== 'object') throw new Error('AI 返回的函数参数不是合法 JSON 对象')
  if (args.board_size !== size) throw new Error('AI 返回的 board_size 应为 ' + size + '，实际 ' + args.board_size)
  if (args.color_set !== set) throw new Error('AI 返回的 color_set 应为 ' + set + '，实际 ' + args.color_set)
  const codes = {}
  for (const c of colors) codes[c.code.toLowerCase()] = true
  if (!Array.isArray(args.grid)) throw new Error('AI 未返回 grid 数组')
  if (args.grid.length !== total) {
    throw new Error('AI 返回色号数量不对：应为 ' + total + ' 个，实际 ' + args.grid.length + ' 个')
  }
  for (const code of args.grid) {
    if (!codes[String(code).toLowerCase()]) {
      throw new Error('AI 返回了非法色号：' + code)
    }
  }
}

async function generate(apiKey, model, data) {
  const size = Number(data.size)
  const set = String(data.set)
  if (!data.imageBase64 || !Array.isArray(data.colors) || !data.colors.length) {
    throw new Error('请求缺少 imageBase64 或 colors')
  }
  const userText =
    '请把这张图片生成为 ' + size + '×' + size + ' 拼豆图纸（风格：' + data.style + '），并调用 submit_pixel_pattern 提交。'
  const payload = {
    model,
    messages: [
      { role: 'system', content: buildSystemPrompt(size, data.style, data.colors) },
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: data.imageBase64 } },
          { type: 'text', text: userText }
        ]
      }
    ],
    tools: buildTools(size, set),
    tool_choice: { type: 'function', function: { name: 'submit_pixel_pattern' } }
  }
  const resp = await postJson(CHAT_HOST, CHAT_PATH, payload, apiKey, 120000)
  if (resp.error || resp.code) {
    const msg = (resp.error && resp.error.message) || resp.message || resp.code || 'unknown'
    throw new Error('AI 返回错误: ' + msg)
  }
  const message = resp.choices && resp.choices[0] && resp.choices[0].message
  const call = message && message.tool_calls && message.tool_calls[0]
  if (!call || !call.function || !call.function.arguments) {
    throw new Error('AI 未返回结构化的图纸数据（缺少 tool_calls）')
  }
  let args
  try {
    args = JSON.parse(call.function.arguments)
  } catch (e) {
    throw new Error('AI 返回的 function.arguments 不是合法 JSON')
  }
  validateArgs(args, size, set, data.colors)
  return { grid: args.grid }
}

const env = loadEnv()
const API_KEY = env.DASHSCOPE_API_KEY || process.env.DASHSCOPE_API_KEY
const MODEL = env.DASHSCOPE_MODEL || process.env.DASHSCOPE_MODEL || DEFAULT_MODEL
const PORT = Number(process.env.PORT || env.PORT || 8787)

const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  if (req.method === 'GET' && req.url === '/health') {
    res.end(JSON.stringify({ ok: true, keyConfigured: !!API_KEY, model: MODEL }))
    return
  }
  if (req.method === 'POST' && req.url === '/ai-generate') {
    const t0 = Date.now()
    console.log('[ai-generate] 收到请求')
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
      try {
        const result = await generate(API_KEY, MODEL, data)
        res.end(JSON.stringify(result))
        console.log('[ai-generate] 成功，耗时', ((Date.now() - t0) / 1000).toFixed(1) + 's')
      } catch (e) {
        res.statusCode = 500
        res.end(JSON.stringify({ error: e.message }))
        console.error('[ai-generate] 失败，耗时', ((Date.now() - t0) / 1000).toFixed(1) + 's:', e.message)
      }
    })
    return
  }
  res.statusCode = 404
  res.end(JSON.stringify({ error: 'not found' }))
})

server.listen(PORT, '0.0.0.0', () => {
  console.log('AI 生成代理服务已启动: http://127.0.0.1:' + PORT)
  console.log('API Key 已配置: ' + (API_KEY ? '是' : '否（请填写 .env 中的 DASHSCOPE_API_KEY）'))
  console.log('模型: ' + MODEL)
})