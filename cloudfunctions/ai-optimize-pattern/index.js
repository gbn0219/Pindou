// AI 优化拼豆图纸云函数
// 流程：接收图纸 base64 → 调用千问图像编辑模型优化（保留边界/黑色描边/平滑内部颜色）
//       → 下载结果上传云存储 → 返回 fileID（避免 callFunction 响应体积限制）
// 环境变量：DASHSCOPE_API_KEY（必填）、DASHSCOPE_MODEL（可选，默认 qwen-image-2.0-pro）
const https = require('https')
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

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

function postJson(host, path, payload, apiKey, timeoutMs) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload)
    const req = https.request(
      {
        host,
        path,
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

exports.main = async (event) => {
  const apiKey = process.env.DASHSCOPE_API_KEY
  if (!apiKey) {
    return { error: '云函数未配置 DASHSCOPE_API_KEY 环境变量' }
  }
  const imageBase64 = event && event.imageBase64
  if (!imageBase64) {
    return { error: '缺少 imageBase64 参数' }
  }
  const originalImageBase64 = event && event.originalImageBase64
  const model = process.env.DASHSCOPE_MODEL || DEFAULT_MODEL
  const prompt = (event && event.prompt) || DEFAULT_PROMPT
  // 图1 = 原图（基准），图2 = 当前图纸；AI 基于原图优化图纸，避免自由发挥导致不像原图
  const reqContent = []
  if (originalImageBase64) reqContent.push({ image: originalImageBase64 })
  reqContent.push({ image: imageBase64 }, { text: prompt })
  const payload = {
    model,
    input: {
      messages: [{ role: 'user', content: reqContent }]
    },
    parameters: {
      prompt_extend: true,
      size: '1024*1024',
      watermark: false
    }
  }

  let resp
  try {
    resp = await postJson(GENERATION_HOST, GENERATION_PATH, payload, apiKey, 120000)
  } catch (e) {
    return { error: 'AI 调用失败: ' + e.message }
  }
  if (resp.code || resp.message) {
    return { error: 'AI 返回错误(' + (resp.code || 'unknown') + '): ' + (resp.message || '') }
  }
  const content =
    resp.output &&
    resp.output.choices &&
    resp.output.choices[0] &&
    resp.output.choices[0].message &&
    resp.output.choices[0].message.content
  const img = content && content[0] && content[0].image
  if (!img) {
    return { error: 'AI 未返回图片结果' }
  }

  let buf
  try {
    buf = await download(img, 120000)
  } catch (e) {
    return { error: '下载 AI 结果失败: ' + e.message }
  }
  const cloudPath =
    'ai-pattern/' +
    Date.now() +
    '-' +
    Math.random().toString(36).slice(2, 8) +
    '.png'
  try {
    const up = await cloud.uploadFile({ cloudPath, fileContent: buf })
    return { fileID: up.fileID }
  } catch (e) {
    return { error: '上传云存储失败: ' + e.message }
  }
}
