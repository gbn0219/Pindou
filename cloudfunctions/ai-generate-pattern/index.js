// AI 生成拼豆图纸云函数（图像方案，与本地代理服务 tools/ai-generate-server.js 保持一致）
// 流程：接收原图 base64 → 调用火山方舟 Seedream（doubao-seedream-5-0-260128，OpenAI 兼容
// images/generations 接口）图生图生成像素风格图纸 → 下载图片转 base64 → 返回 { image }
// 环境变量：ARK_API_KEY（必填）、ARK_MODEL（可选，默认 doubao-seedream-5-0-260128）
// 注意：云函数超时需在控制台调大（建议 60s）；部署目录内需包含 ref-pack.jpg。
const http = require('http')
const https = require('https')
const fs = require('fs')
const path = require('path')
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const GEN_HOST = 'ark.cn-beijing.volces.com'
const GEN_PATH = '/api/v3/images/generations'
const DEFAULT_MODEL = 'doubao-seedream-5-0-260128'
const GEN_SIZE = '2K'
const BOARD_MIN = 15 // 拼豆盘最小边长
const BOARD_MAX = 208 // 拼豆盘最大边长
const REF_PACK_PATH = path.join(__dirname, 'ref-pack.jpg')
// 写实风参考样例（tools/style-refs/realistic-ref.jpg 复制而来），风格为 realistic 时作为第二张参考图。
const REALISTIC_REF_PATH = path.join(__dirname, 'realistic-ref.jpg')
// 五官画法示例拼图（tools/face-refs/face-ref.jpg 合成），作为第三张参考图随请求发送，
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
        reject(new Error('AI 图片下载失败: HTTP ' + res.statusCode))
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
    req.on('timeout', () => req.destroy(new Error('AI 图片下载超时')))
    req.on('error', reject)
  })
}

function imageDataUrl(filePath) {
  let ext = path.extname(filePath).slice(1).toLowerCase() || 'jpg'
  if (ext === 'jpg') ext = 'jpeg' // MIME 标准为 image/jpeg
  const base64 = fs.readFileSync(filePath).toString('base64')
  return 'data:image/' + ext + ';base64,' + base64
}

function buildPrompt(size, style, styleKey, cutout, extra) {
  const realistic = styleKey === 'realistic'
  const extraReq = String(extra || '').trim()
  return (
    '请把「第一张图」（用户照片）转换成 ' +
    size +
    '×' +
    size +
    ' 的拼豆像素图图纸：每个格子一个纯色块，格子紧密拼接、无缝隙，输出必须是单张完整的像素画，整体为 1:1 正方形。\n' +
    (realistic
      ? '「参考图」第二张图是写实风参考样例（两张「原图转拼豆图纸」对比图：一张布偶猫照片、一张动漫插画）：请参照它们的转换思路——保留原图的结构、光影、质感与风格，只把画面像素化为拼豆图纸，不简化造型、不卡通化；最终风格以「风格」章节的要求为准。\n'
      : '「参考图」第二张图是参考拼图：两张「原图转像素图」示例，请参照它们的转换思路，把真实照片抽象成方块像素画，保留人物的姿态、表情、发型、服装特征，简化背景与细节；最终风格以「风格」章节的要求为准。\n') +
    (realistic
      ? '「五官参考」第三张图仅供学习像素颗粒表达；写实风下五官必须忠实还原「第一张图」原图的比例、形状、光影与表情，禁止卡通大眼、粗眼线、圆腮红画法。\n'
      : '「五官参考」第三张图是五官表达示例（5 个拼豆像素画人脸）：请学习并借鉴其中的五官画法——大而有神的眼睛（上眼睑线、瞳孔、左上角高光，避免豆豆眼）、清晰的眉毛、小巧的鼻子、上扬微笑的嘴巴、脸颊圆形腮红、圆润可爱的脸型。\n') +
    '⚠ 重点：这些示例只用于学习五官的画法与风格，禁止照搬、复制或生成示例中的任何角色、动物、造型、服装、背景或具体内容（如米老鼠、小熊、圣诞帽、示例中的具体人物），五官以外的构图与内容必须完全来自「第一张图」（用户照片）。\n' +
    '「重要」不要模仿参考图中的文字、水印、贴纸、标语或广告元素，输出画面中不得出现任何文字、数字或水印。\n' +
    '「构图」人物居中，头部到肩部或半身特写，主体占画面 70% 以上。\n' +
    (realistic
      ? '「肤色」忠实还原原图肤色与明暗：脸部用 2~3 档色阶表现受光与阴影，阴影色从原图取，禁止整体偏色，也不要加深为深棕/深灰。\n'
      : '「肤色」最重要的颜色要求：脸部大面积肤色必须统一使用 G1 色号的 RGB(255,228,211)（#FFE4D3），脸部主色占比 80% 以上；额头、面颊、鼻子、下巴等脸部主体一律用这个浅色。禁止用深棕、小麦色、暗肤色、灰色或大面积深色阴影画脸；阴影最多占脸部 10%，阴影色必须是浅暖色（接近 RGB 240,205,185），不得使用深色。\n') +
    (realistic
      ? '「五官（写实）」严格按照原图的比例、形状、间距与表情绘制五官：眼睛大小与原图一致，保留瞳孔、高光与眼白；眉毛、鼻子、嘴巴按原图的形状与明暗归纳成色块，禁止放大眼睛、粗黑眼线、腮红圆块等卡通化处理。\n'
      : '「眼睛（像素画法）」每只眼睛约 5~7 格宽、4~6 格高的横向椭圆：上眼皮用 1 格深的黑色或深棕色粗线，下眼皮用细线；眼白用浅米白色；瞳孔为 2×2 格深棕或黑色，位于眼睛中央偏下；瞳孔左上角必须有 1~2 格纯白高光；两眼睛间距约 4 格。若原图戴眼镜，必须把眼镜画清晰：1 格粗的深色镜框包裹双眼，镜片为浅色，镜腿延伸到脸两侧。\n' +
    '「眉毛」每条约 5~7 格宽、1 格高的细长弧形，用比头发浅的棕色，位于眼睛上方 1~2 格，略微上挑。\n' +
    '「鼻子」极简：只用 1 格浅肉色或淡粉色点表示鼻尖，位于两眼连线中点下方 2~4 格。\n' +
    '「嘴巴」微笑弧线，4~6 格宽、1~2 格高，粉红色或珊瑚粉，嘴角微微上翘，颜色比腮红稍深。\n' +
    '「腮红」两颊各一个约 3×3 格的淡粉或蜜桃粉色块，位于眼睛斜下方、鼻翼外侧。\n') +
    (realistic
      ? '「头发」按原图的发型轮廓、发丝方向与受光分区，用 3~4 档色阶表现发色与高光。\n'
      : '「头发」用三层颜色表现：外层深色（黑或深棕）勾勒发型轮廓，中层为发色主体，内层用 1~2 格宽的浅色高光条带；发丝缩成块、方向统一，不要细碎杂点。\n') +
    (realistic
      ? '「衣服」按原图的服装款式与明暗褶皱，用 3~5 档色阶表现体积，主色严格对照原图取色。\n'
      : '「衣服」用 2~3 种纯色块平涂，衣服主色必须与原图衣服的主色完全一致（严格对照原图取色，禁止换色、禁止偏色、禁止加深或减淡），领口、袖口用色块分界，不要花纹和细小褶皱，深色描边勾勒轮廓；整套服装配色统一协调，与肤色、发色有明显区分。\n') +
    (realistic
      ? '「描边」不添加描边：轮廓与明暗边界按原图自然呈现，只保留原图本身就有的深色边缘，不额外勾线。\n'
      : '「描边」人物外轮廓用深色（黑或深棕）粗描边，内部线条少而粗。\n') +
    (realistic
      ? '「颜色」整体控制在 20~40 种颜色内，按原图层次保留明暗与质感，配色与原图一致。\n'
      : '「颜色」整体控制在 12~20 种颜色内，配色与原图主色一致，低饱和、柔和。\n') +
    '「风格」' +
    style +
    '\n' +
    (extraReq ? '「额外要求」' + extraReq + '\n' : '') +
    (cutout
      ? '「抠图」最重要的要求：背景只允许使用纯白色——每一个背景像素必须严格等于 RGB(255,255,255)（#FFFFFF），不允许任何近白色、米白、奶白、浅灰、灰白、阴影、渐变、晕影或轻微杂色；人物边缘与背景交界必须干净利落、无混色过渡、无残留背景色。人物以外不得出现任何原背景物体、家具、墙面、植物、阴影、渐变或装饰，如同把人物从照片中完整抠出后放在纯白画布上。\n'
      : '「背景」背景必须是纯白色（RGB 255,255,255），不要任何背景颜色、渐变或装饰。\n') +
    '「禁止」不要画网格线、辅助线、边框；不要渐变或抗锯齿混色；不要文字、数字、水印、贴纸；不要多格拼接或九宫格。'
  )
}

function extractImageUrl(resp) {
  // OpenAI 兼容返回：{ data: [{ url }] }
  if (resp && resp.data && resp.data[0] && resp.data[0].url) return resp.data[0].url
  return null
}

async function generate(apiKey, model, data) {
  const size = Number(data.size)
  if (!Number.isInteger(size) || size < BOARD_MIN || size > BOARD_MAX) {
    throw new Error('AI 图像生成仅支持 ' + BOARD_MIN + '×' + BOARD_MIN + ' ~ ' + BOARD_MAX + '×' + BOARD_MAX + ' 的整数盘面')
  }
  if (!data.imageBase64) {
    throw new Error('请求缺少 imageBase64')
  }
  const images = [data.imageBase64]
  const styleRef = data.styleKey === 'realistic' ? REALISTIC_REF_PATH : REF_PACK_PATH
  if (fs.existsSync(styleRef)) images.push(imageDataUrl(styleRef))
  if (fs.existsSync(FACE_REF_PATH)) images.push(imageDataUrl(FACE_REF_PATH))
  const payload = {
    model,
    prompt: buildPrompt(size, data.style || '卡通', data.styleKey, data.cutout, data.extra),
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
      if (attempt >= 3) throw new Error('AI 调用失败: ' + e.message)
      await new Promise((r) => setTimeout(r, 5000 * (attempt + 1)))
      continue
    }
    const errMsg =
      (resp && ((resp.error && resp.error.message) || resp.message || resp.code)) || ''
    if (!errMsg) break
    const retriable = /rate limit|429|5\d\d|throttl/i.test(errMsg)
    if (!retriable || attempt >= 3) {
      throw new Error('AI 返回错误: ' + errMsg)
    }
    await new Promise((r) => setTimeout(r, 8000 * (attempt + 1)))
  }
  const url = extractImageUrl(resp)
  if (!url) {
    throw new Error('AI 未返回图片 URL: ' + JSON.stringify(resp).slice(0, 300))
  }
  const { buffer, contentType } = await downloadBinary(url, 60000, 5)
  return { image: 'data:' + (contentType || 'image/jpeg') + ';base64,' + buffer.toString('base64') }
}

exports.main = async (event) => {
  const apiKey = process.env.ARK_API_KEY
  if (!apiKey) {
    return { error: '云函数未配置 ARK_API_KEY 环境变量' }
  }
  const model = process.env.ARK_MODEL || DEFAULT_MODEL
  try {
    return await generate(apiKey, model, event || {})
  } catch (e) {
    return { error: e.message }
  }
}