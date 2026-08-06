// tests/ai.test.js
/**
 * AI 生成前端纯函数测试：dominantBlockRgb / imageDataToGrid（整幅像素 → 主色分块 → 色号网格）。
 * 运行： node tests/ai.test.js
 */
const assert = require('assert')
const ai = require('../miniprogram/utils/ai.js')
const color = require('../miniprogram/utils/color.js')

const setCodes = color.buildPalette('48').map((i) => i.code)
assert.ok(setCodes.indexOf('A4') >= 0 && setCodes.indexOf('A6') >= 0, '48 套装应含 A4/A6')

const palette = color.buildPalette('48')
const rgbOf = (code) => palette.find((i) => i.code === code).rgb
const codeOf = (r, g, b) => color.nearestColor(r, g, b, palette).code

// 构造 8×8 像素图：2×2 格子（每格 4×4 块），格子间有 1px 深色网格线
// 网格线像素为 (60,60,60)，模拟 AI 输出自带的辅助线
function makeGridImage() {
  const w = 8
  const data = new Uint8ClampedArray(w * w * 4)
  const colors = [
    ['A4', 'A6'],
    ['A6', 'A4']
  ]
  for (let y = 0; y < w; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const isLine = x % 4 === 3 || y % 4 === 3
      if (isLine) {
        data[i] = 60
        data[i + 1] = 60
        data[i + 2] = 60
      } else {
        const cell = colors[Math.floor(y / 4)][Math.floor(x / 4)]
        const rgb = rgbOf(cell)
        data[i] = rgb[0]
        data[i + 1] = rgb[1]
        data[i + 2] = rgb[2]
      }
      data[i + 3] = 255
    }
  }
  return { data }
}

// 主色分块应忽略网格线，正确得到 A4/A6 网格
const img = makeGridImage()
const rgb = ai.dominantBlockRgb(img, 8, 8, 2)
assert.deepStrictEqual(rgb.map((p) => codeOf(p[0], p[1], p[2])), ['A4', 'A6', 'A6', 'A4'], '主色分块应忽略细网格线')

const grid = ai.imageDataToGrid(img, 8, 8, 2, '48')
assert.deepStrictEqual(grid, [['A4', 'A6'], ['A6', 'A4']], 'imageDataToGrid 应返回正确的二维网格')

// 整块透明按白色处理
const img2 = makeGridImage()
for (let y = 0; y < 4; y++) {
  for (let x = 0; x < 4; x++) {
    const i = (y * 8 + x) * 4
    img2.data[i] = 255
    img2.data[i + 1] = 0
    img2.data[i + 2] = 0
    img2.data[i + 3] = 0
  }
}
const white = codeOf(255, 255, 255)
const grid2 = ai.imageDataToGrid(img2, 8, 8, 2, '48')
assert.strictEqual(grid2[0][0], white, '全透明块应按白色处理')

// 无网格线的普通像素图同样正确
const img3 = makeGridImage()
for (let y = 0; y < 8; y++) {
  for (let x = 0; x < 8; x++) {
    const i = (y * 8 + x) * 4
    if (x % 4 === 3 || y % 4 === 3) continue
    const cell = [['A4', 'A6'], ['A6', 'A4']][Math.floor(y / 4)][Math.floor(x / 4)]
    const rgbv = rgbOf(cell)
    img3.data[i] = rgbv[0]
    img3.data[i + 1] = rgbv[1]
    img3.data[i + 2] = rgbv[2]
  }
}
const grid3 = ai.imageDataToGrid(img3, 8, 8, 2, '48')
assert.deepStrictEqual(grid3, [['A4', 'A6'], ['A6', 'A4']], '普通像素图映射正确')

// 肤色归一：G4 小麦色应归一为 G1，深棕头发/橙色/深灰不误伤
assert.deepStrictEqual(ai.skinNormalize(220, 179, 135), [255, 228, 211], 'G4 小麦色应归一为 G1')
assert.deepStrictEqual(ai.skinNormalize(255, 228, 211), [255, 228, 211], 'G1 本身保持不变')
assert.deepStrictEqual(ai.skinNormalize(113, 61, 47), [113, 61, 47], '深棕头发不应归一')
assert.deepStrictEqual(ai.skinNormalize(253, 169, 81), [253, 169, 81], '橙色不应误伤')
assert.deepStrictEqual(ai.skinNormalize(70, 70, 72), [70, 70, 72], '深灰不应归一')
assert.deepStrictEqual(ai.skinNormalize(245, 240, 235), [245, 240, 235], '暖灰白背景不应归一为肤色')


// ---- 提示词构造（tools/prompt.js）----
const prompt = require('../tools/prompt.js')

{
  const p = prompt.buildPrompt({
    size: 52,
    style: '卡通：简化造型、粗黑描边、平涂色块、五官夸张',
    styleKey: 'cartoon',
    subject: 'person'
  })
  assert.ok(p.indexOf('52×52') >= 0, '提示词应包含盘面尺寸')
  assert.ok(p.indexOf('卡通') >= 0, '卡通预设应包含卡通风格描述')
  assert.ok(p.indexOf('G1') >= 0, '人物提示词应包含肤色 G1 要求')
  assert.ok(p.indexOf('拼豆友好') >= 0, '应包含拼豆友好的大块同色要求')
}

{
  const p = prompt.buildPrompt({
    size: 78,
    style: '马卡龙：低饱和马卡龙色系、圆润柔和、减少硬边',
    styleKey: 'macaron',
    subject: 'person'
  })
  assert.ok(p.indexOf('马卡龙') >= 0, '马卡龙预设应包含马卡龙风格描述')
}

// 写实风预设：保留原图光影结构与真实质感，不注入卡通化的五官/描边要求
{
  const p = prompt.buildPrompt({
    size: 52,
    style: '写实风：保留原图的光影、结构与真实质感，仅像素化为拼豆图纸，不卡通化、不加描边',
    styleKey: 'realistic',
    subject: 'person'
  })
  assert.ok(p.indexOf('写实') >= 0, '写实风预设应包含写实风格描述')
  assert.ok(p.indexOf('不额外勾线') >= 0, '写实风不应添加描边')
  assert.ok(p.indexOf('3~5 档色阶') >= 0, '写实风应保留多档明暗层次')
  assert.ok(p.indexOf('20~40 种颜色') >= 0, '写实风应允许更多颜色保留质感')
  assert.ok(p.indexOf('禁止放大眼睛、粗黑眼线、腮红圆块') >= 0, '写实风应禁止卡通化五官')
  assert.ok(p.indexOf('圆润可爱的脸型') < 0, '写实风不应包含卡通脸型画法')
  assert.ok(p.indexOf('粗描边') < 0, '写实风不应包含粗描边要求')
  assert.ok(p.indexOf('写实风参考样例') >= 0, '写实风应使用拼接的写实参考样例描述')
}

// 自动判断主体 + 写实风：应使用写实五官规则
{
  const p = prompt.buildPrompt({ size: 52, style: '写实风', styleKey: 'realistic' })
  assert.ok(p.indexOf('主体判断') >= 0, '自动模式应包含主体判断指令')
  assert.ok(p.indexOf('五官（写实）') >= 0, '自动判断 + 写实风应使用写实五官规则')
  assert.ok(p.indexOf('圆润可爱的脸型') < 0, '自动判断 + 写实风不应包含卡通脸型画法')
}

// 额外要求：附加在所选风格之后，不覆盖风格
{
  const p = prompt.buildPrompt({
    size: 52,
    style: '卡通：简化造型、粗黑描边、平涂色块、五官夸张',
    styleKey: 'cartoon',
    subject: 'person',
    extra: '去掉画面中的眼镜'
  })
  assert.ok(p.indexOf('「额外要求」去掉画面中的眼镜') >= 0, '额外要求应附加到提示词')
}
{
  const p = prompt.buildPrompt({ size: 52, style: '卡通', styleKey: 'cartoon' })
  assert.ok(p.indexOf('「额外要求」') < 0, '未填额外要求时不应出现该节')
}

// 自定义风格：不得注入卡通/马卡龙风格提示词，只保留用户输入
{
  const p = prompt.buildPrompt({
    size: 52,
    style: '赛博朋克霓虹',
    styleKey: 'custom',
    subject: 'person'
  })
  assert.ok(p.indexOf('卡通') < 0 && p.indexOf('马卡龙') < 0, '自定义风格不应注入卡通/马卡龙风格提示词')
  assert.ok(p.indexOf('赛博朋克霓虹') >= 0, '自定义风格应出现在提示词中')
}

// 主体类型：动物不含人物肤色 G1，物体不含五官参考
{
  const p = prompt.buildPrompt({ size: 52, style: '卡通', styleKey: 'cartoon', subject: 'animal' })
  assert.ok(p.indexOf('动物') >= 0, '动物提示词应包含主体要求')
  assert.ok(p.indexOf('花纹') >= 0, '动物提示词应包含毛色花纹要求')
  assert.ok(p.indexOf('G1') < 0, '动物提示词不应包含人物肤色 G1')
}
{
  const p = prompt.buildPrompt({ size: 52, style: '卡通', styleKey: 'cartoon', subject: 'object' })
  assert.ok(p.indexOf('物体') >= 0, '物体提示词应包含主体要求')
  assert.ok(p.indexOf('五官参考') < 0, '物体提示词不应包含五官参考')
}
{
  const p = prompt.buildPrompt({ size: 52, style: '卡通', styleKey: 'cartoon', subject: 'virtual' })
  assert.ok(p.indexOf('虚拟形象') >= 0, '虚拟形象提示词应包含主体要求')
}

// 抠图/背景：主体措辞
{
  const p = prompt.buildPrompt({ size: 52, style: '卡通', styleKey: 'cartoon', subject: 'person', cutout: true })
  assert.ok(p.indexOf('抠图') >= 0 && p.indexOf('主体') >= 0, '抠图提示词应使用主体措辞')
  assert.ok(p.indexOf('只允许使用纯白色') >= 0 && p.indexOf('严格等于') >= 0, '抠图提示词应要求背景严格纯白')
  const q = prompt.buildPrompt({ size: 52, style: '卡通', styleKey: 'cartoon', subject: 'person' })
  assert.ok(q.indexOf('背景') >= 0 && q.indexOf('抠图') < 0, '非抠图应使用背景措辞')
}


// 轮廓闭合：提示词必须要求轮廓线闭合，防止内部白色被误判为背景
{
  const p = prompt.buildPrompt({ size: 52, style: '卡通', styleKey: 'cartoon', subject: 'person' })
  assert.ok(p.indexOf('轮廓闭合') >= 0 && p.indexOf('完全闭合') >= 0, '提示词应要求轮廓线完全闭合')
  const q = prompt.buildPrompt({ size: 52, style: '写实风', styleKey: 'realistic', subject: 'person' })
  assert.ok(q.indexOf('轮廓闭合') >= 0, '写实风提示词也应要求轮廓闭合')
}

// 自动判断主体：不传 subject 时提示词应包含主体判断指令与全部类别规则
{
  const p = prompt.buildPrompt({ size: 52, style: '卡通', styleKey: 'cartoon' })
  assert.ok(p.indexOf('主体判断') >= 0, '自动模式应包含主体判断指令')
  assert.ok(
    p.indexOf('人物') >= 0 &&
      p.indexOf('动物') >= 0 &&
      p.indexOf('物体') >= 0 &&
      p.indexOf('虚拟形象') >= 0,
    '自动模式应包含全部主体类别规则'
  )
  assert.ok(p.indexOf('G1') >= 0, '自动模式应保留人物肤色 G1 规则')
}

// 自动判断 + 自定义风格：不得注入卡通/马卡龙
{
  const p = prompt.buildPrompt({ size: 52, style: '赛博朋克霓虹', styleKey: 'custom' })
  assert.ok(p.indexOf('卡通') < 0 && p.indexOf('马卡龙') < 0, '自动模式 + 自定义风格不应注入卡通/马卡龙')
}


// 每格单色约束：明确每格对应一个纯色方块，避免取色偏差
{
  const p = prompt.buildPrompt({ size: 52, style: '卡通', styleKey: 'cartoon' })
  assert.ok(p.indexOf('色块均匀') >= 0, '应包含色块均匀（每格单色）要求')
  assert.ok(p.indexOf('52×52 个纯色方块') >= 0, '应明确纯色方块数量与盘面一致')
  assert.ok(p.indexOf('禁止渐变、混色、抗锯齿') >= 0, '应禁止块内渐变/混色/抗锯齿')
}

// 任意盘面尺寸（15~208）：提示词应使用实际尺寸
{
  const p = prompt.buildPrompt({ size: 208, style: '卡通', styleKey: 'cartoon' })
  assert.ok(p.indexOf('208×208') >= 0, '提示词应使用自定义盘面尺寸')
}

// 云函数超时判定：仅超时类错误可重试
{
  assert.strictEqual(ai.isTimeoutError({ errMsg: 'cloud.callFunction:fail Error: errCode: -504002 | errMsg: FUNCTION_EXCEED_TIME_LIMIT' }), true, 'FUNCTION_EXCEED 超时应判定为可重试')
  assert.strictEqual(ai.isTimeoutError({ errMsg: 'cloud.callFunction:fail timeout' }), true, 'timeout 应判定为可重试')
  assert.strictEqual(ai.isTimeoutError({ errMsg: 'cloud.callFunction:fail 函数执行超时' }), true, '中文超时应判定为可重试')
  assert.strictEqual(ai.isTimeoutError({ errMsg: 'cloud.callFunction:fail invalid api key' }), false, '缺 Key 等业务错误不应重试')
  assert.strictEqual(ai.isTimeoutError({ message: 'AI 调用失败: 429' }), false, '限流等业务错误不应重试')
  assert.ok(ai.CLOUD_RETRY_MAX >= 1, '应配置至少一次自动重试')
}

// 云函数超时自动重试：超时两次后成功 / 非超时错误不重试
;(async () => {
  const calls = []
  global.wx = {
    cloud: {
      callFunction() {
        calls.push(1)
        if (calls.length < 3) return Promise.reject({ errMsg: 'cloud.callFunction:fail FUNCTION_EXCEED_TIME_LIMIT' })
        return Promise.resolve({ result: { image: 'data:image/png;base64,AA==' } })
      }
    }
  }
  try {
    const retries = []
    const res = await ai.callAiGenerate({
      imageBase64: 'x', size: 52, set: '48', style: '卡通', styleKey: 'cartoon', cutout: false, extra: '',
      onRetry: (u, t) => retries.push([u, t])
    })
    assert.ok(res && res.image, '重试后应返回生成结果')
    assert.strictEqual(calls.length, 3, '超时应自动重试到第 3 次尝试')
    assert.deepStrictEqual(retries, [[1, 2], [2, 2]], '应上报重试进度 (1/2、2/2)')
  } finally {
    delete global.wx
  }

  const errCalls = []
  global.wx = {
    cloud: {
      callFunction() {
        errCalls.push(1)
        return Promise.reject({ errMsg: 'cloud.callFunction:fail invalid api key' })
      }
    }
  }
  try {
    await assert.rejects(
      () => ai.callAiGenerate({ imageBase64: 'x', size: 52, set: '48', style: '卡通', styleKey: 'cartoon', cutout: false, extra: '' }),
      /invalid api key/
    )
    assert.strictEqual(errCalls.length, 1, '非超时错误不应重试')
  } finally {
    delete global.wx
  }

  // 云函数返回 imageFileID（大图走云存储）时，前端应直接透传
  global.wx = {
    cloud: {
      callFunction() {
        return Promise.resolve({ result: { imageFileID: 'cloud://ai-tmp/test_pattern.png' } })
      }
    }
  }
  try {
    const res = await ai.callAiGenerate({ imageBase64: 'x', size: 52, set: '48', style: '卡通', styleKey: 'cartoon', cutout: false, extra: '' })
    assert.strictEqual(res.imageFileID, 'cloud://ai-tmp/test_pattern.png', '应透传云函数返回的 imageFileID')
  } finally {
    delete global.wx
  }

  console.log('ai.test.js 全部通过 ✓')
})().catch((e) => {
  console.error(e)
  process.exit(1)
})