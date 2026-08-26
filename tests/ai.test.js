// tests/ai.test.js
/**
 * 前端纯函数测试：dominantBlockRgb / imageDataToGrid（整幅像素 → 主色分块 → 色号网格）。
 * 运行： node tests/ai.test.js
 */
const assert = require('assert')
const ai = require('../miniprogram/utils/ai.js')
const appConfig = require('../miniprogram/config')
appConfig.aiGenerate.backend = 'cloud' // 本测试只覆盖云函数异步任务链路，固定 cloud 模式
const color = require('../miniprogram/utils/color.js')
const background = require('../miniprogram/utils/background.js')
const pattern = require('../miniprogram/utils/pattern.js')

const setCodes = color.buildPalette('48').map((i) => i.code)
assert.ok(setCodes.indexOf('A4') >= 0 && setCodes.indexOf('A6') >= 0, '48 套装应含 A4/A6')

const palette = color.buildPalette('48')
const rgbOf = (code) => palette.find((i) => i.code === code).rgb
const codeOf = (r, g, b) => color.nearestColor(r, g, b, palette).code

// 构造 8×8 像素图：2×2 格子（每格 4×4 块），格子间有 1px 深色网格线
// 网格线像素为 (60,60,60)，模拟输出自带的辅助线
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


// ---- AI 返回图：白色主体全部标注色号，洋红背景映射为白色背景（不标注） ----
// 模拟抠图模式输出：洋红背景 + 白色主体（严格对齐格子，避免边界格歧义）
function fakeCtx() {
  const calls = []
  return {
    calls,
    fillStyle: '', strokeStyle: '', lineWidth: 0, font: '', textAlign: '', textBaseline: '',
    shadowColor: '', shadowBlur: 0, shadowOffsetY: 0,
    fillRect() { calls.push(['fillRect', ...arguments]) },
    strokeRect() { calls.push(['strokeRect', ...arguments]) },
    fillText() { calls.push(['fillText', ...arguments]) },
    beginPath() {},
    moveTo() { calls.push(['moveTo', ...arguments]) },
    lineTo() { calls.push(['lineTo', ...arguments]) },
    arcTo() { calls.push(['arcTo', ...arguments]) },
    closePath() {},
    arc() { calls.push(['arc', ...arguments]) },
    stroke() { calls.push(['stroke']) },
    fill() { calls.push(['fill']) },
    save() {},
    restore() {},
    translate() {},
    measureText(text) { return { width: String(text).length * 10 } }
  }
}
{
  const W = 64
  const H = 64
  const SIZE = 8
  const data = new Uint8ClampedArray(W * H * 4)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4
      const inRect = x >= 16 && x < 48 && y >= 16 && y < 48
      data[i] = 255
      data[i + 1] = inRect ? 255 : 0
      data[i + 2] = 255
      data[i + 3] = 255
    }
  }
  const imageData = { data, width: W, height: H }
  const cellArea = Math.round((W / SIZE) * (H / SIZE))
  const pxMask = background.cleanMarkerBackground(imageData, { noiseMax: Math.max(128, cellArea * 4) })
  assert.ok(pxMask, '抠图模式应识别到洋红标记背景')
  const gridBgMask = []
  for (let r = 0; r < SIZE; r++) gridBgMask.push(new Array(SIZE).fill(false))
  const rgbArr = ai.dominantBlockRgb(imageData, W, H, SIZE, pxMask, gridBgMask)
  const pal = color.buildPalette('48')
  const grid = pattern.mapRgb(rgbArr, SIZE, pal)
  const counts = pattern.countColors(grid, pal.map((i) => i.code), gridBgMask)
  const byCode = {}
  counts.forEach((i) => { byCode[i.code] = i.count })

  // 白色主体（第 2~5 行/列）：前景、色号为白色系 H1、计入色块数（会被标注）
  for (let r = 2; r <= 5; r++) {
    for (let c = 2; c <= 5; c++) {
      assert.strictEqual(gridBgMask[r][c], false, '白色主体格(' + r + ',' + c + ')应为前景')
      assert.strictEqual(grid[r][c], 'H1', '白色主体格(' + r + ',' + c + ')应映射为白色色号')
    }
  }
  assert.strictEqual(byCode['H1'], 16, '白色主体 16 格全部计入色块数')

  // 洋红背景（矩形外）：映射为白色 H1、标记为背景、不计入色块数（不标注）
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (r >= 2 && r <= 5 && c >= 2 && c <= 5) continue
      assert.strictEqual(gridBgMask[r][c], true, '洋红背景格(' + r + ',' + c + ')应为背景')
      assert.strictEqual(grid[r][c], 'H1', '洋红背景格(' + r + ',' + c + ')应映射为白色')
    }
  }

  // 渲染层面：只有前景白色格标注色号，背景格不标注
  const ctx = fakeCtx()
  pattern.renderGrid(ctx, grid, pal, { cellSize: 16, gap: 1, code: true, noCodeMask: gridBgMask })
  const texts = ctx.calls.filter((c) => c[0] === 'fillText').map((c) => c[1])
  assert.strictEqual(texts.filter((t) => t === 'H1').length, 16, '只有白色主体 16 格标注 H1，背景格不标注')
}
// ---- ensureWhiteBackground（输出前背景白化保险）----
{
  const pal = color.buildPalette('221')
  const g = []
  for (let r = 0; r < 6; r++) {
    const row = []
    for (let c = 0; c < 6; c++) row.push(r >= 2 && r <= 3 && c >= 2 && c <= 3 ? 'A4' : 'E6')
    g.push(row)
  }
  const mask = background.ensureWhiteBackground(g, pal, null)
  assert.ok(mask, '洋红背景应生成背景掩码')
  for (let r = 0; r < 6; r++) {
    for (let c = 0; c < 6; c++) {
      const isBg = !(r >= 2 && r <= 3 && c >= 2 && c <= 3)
      assert.strictEqual(mask[r][c], isBg, '洋红连通背景格(' + r + ',' + c + ')应为背景')
      assert.strictEqual(g[r][c], isBg ? 'H1' : 'A4', '背景格应强制白色，主体保持原色')
    }
  }
}
{
  // 已有掩码时：掩码格强制白色，洋红系且连边的背景并入
  const pal = color.buildPalette('221')
  const g = []
  for (let r = 0; r < 4; r++) {
    const row = []
    for (let c = 0; c < 4; c++) row.push(r === 0 || r === 3 || c === 0 || c === 3 ? 'E6' : 'A4')
    g.push(row)
  }
  const mask = [
    [true, true, true, true],
    [true, false, false, true],
    [true, false, false, true],
    [true, true, true, true]
  ]
  const out = background.ensureWhiteBackground(g, pal, mask)
  assert.deepStrictEqual(out, mask, '掩码内容应保持')
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      assert.strictEqual(g[r][c], mask[r][c] ? 'H1' : 'A4', '掩码格应强制白色')
    }
  }
}
{
  // 主体内部的洋红/粉色不并入背景（不误伤衣服等）
  const pal = color.buildPalette('221')
  const g = []
  for (let r = 0; r < 8; r++) {
    const row = []
    for (let c = 0; c < 8; c++) {
      const border = r === 0 || r === 7 || c === 0 || c === 7
      const dress = r >= 3 && r <= 4 && c >= 3 && c <= 4
      row.push(border ? 'E6' : dress ? 'E6' : 'A4')
    }
    g.push(row)
  }
  const mask = background.ensureWhiteBackground(g, pal, null)
  assert.ok(mask, '边框洋红应识别为背景')
  assert.strictEqual(mask[3][3], false, '主体内部洋红格不应并入背景')
  assert.strictEqual(g[3][3], 'E6', '主体内部洋红格保持原色')
  assert.strictEqual(mask[0][0], true, '边框洋红格应为背景')
}
{
  // 无洋红背景时返回 null、不改网格
  const pal = color.buildPalette('221')
  const g = [['A4', 'A4'], ['A4', 'A4']]
  const mask = background.ensureWhiteBackground(g, pal, null)
  assert.strictEqual(mask, null, '无洋红背景应返回 null')
  assert.deepStrictEqual(g, [['A4', 'A4'], ['A4', 'A4']], '网格不应被修改')
{
  // 洋红背景被白色外圈包住（标记色识别成功但内部背景画成 E5/E6）时也能白化
  const pal = color.buildPalette('221')
  const g = []
  for (let r = 0; r < 10; r++) {
    const row = []
    for (let c = 0; c < 10; c++) {
      const frame = r === 0 || r === 9 || c === 0 || c === 9
      const subject = r >= 4 && r <= 5 && c >= 4 && c <= 5
      row.push(frame || subject ? 'H1' : 'E5')
    }
    g.push(row)
  }
  const mask = background.ensureWhiteBackground(g, pal, null)
  assert.ok(mask, '被白色外圈包住的洋红背景也应识别')
  assert.strictEqual(mask[2][2], true, '内部洋红背景格应为背景')
  assert.strictEqual(g[2][2], 'H1', '内部洋红背景格应强制白色')
  assert.strictEqual(mask[4][4], false, '中心主体不应并入背景')
  assert.strictEqual(g[4][4], 'H1', '中心白色主体保持白色前景')
}
{
  // 红色衣服（F5）不误删：大面积红色与白色背景相邻仍保留
  const pal = color.buildPalette('221')
  const g = []
  for (let r = 0; r < 10; r++) {
    const row = []
    for (let c = 0; c < 10; c++) {
      const frame = r === 0 || r === 9 || c === 0 || c === 9
      const shirt = r >= 3 && r <= 6 && c >= 3 && c <= 6
      row.push(frame ? 'H1' : shirt ? 'F5' : 'H1')
    }
    g.push(row)
  }
  const mask = background.ensureWhiteBackground(g, pal, null)
  assert.strictEqual(mask[3][3], false, '红色衣服不应并入背景')
  assert.strictEqual(g[3][3], 'F5', '红色衣服保持原色')
}
{
  // 小块粉色细节（如 2x2 饰品）不误删：面积小于并入阈值
  const pal = color.buildPalette('221')
  const g = []
  for (let r = 0; r < 8; r++) {
    const row = []
    for (let c = 0; c < 8; c++) {
      const frame = r === 0 || r === 7 || c === 0 || c === 7
      const detail = r >= 2 && r <= 3 && c >= 2 && c <= 3
      row.push(frame ? 'H1' : detail ? 'E6' : 'H1')
    }
    g.push(row)
  }
  const mask = background.ensureWhiteBackground(g, pal, null)
  assert.strictEqual(mask[2][2], false, '小块粉色细节不应并入背景')
  assert.strictEqual(g[2][2], 'E6', '小块粉色细节保持原色')
}

}

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
  assert.ok(p.indexOf('第二张图') < 0 && p.indexOf('五官参考') >= 0, '写实风提示词不再引用风格参考图，但保留五官参考引导')
}

// 自动判断主体 + 写实风：应使用写实五官规则
{
  const p = prompt.buildPrompt({ size: 52, style: '写实风', styleKey: 'realistic' })
  assert.ok(p.indexOf('主体判断') >= 0, '自动模式应包含主体判断指令')
  assert.ok(p.indexOf('五官（写实）') >= 0, '自动判断 + 写实风应使用写实五官规则')
  assert.ok(p.indexOf('圆润可爱的脸型') < 0, '自动判断 + 写实风不应包含卡通脸型画法')
}

// 重新生成：应引用第二张图（上一版结果），并保留抠图标记色要求
{
  const p = prompt.buildPrompt({
    size: 52,
    style: '卡通',
    styleKey: 'cartoon',
    subject: 'person',
    cutout: true,
    extra: '嘴巴要微笑',
    regenerate: true
  })
  assert.ok(p.indexOf('第二张图') >= 0 && p.indexOf('上一版生成结果') >= 0, '重新生成应引用上一版生成结果')
  assert.ok(p.indexOf('不要整体重画') >= 0, '应要求仅按额外要求调整、不整体重画')
  assert.ok(p.indexOf('RGB(255,0,255)') >= 0, '抠图 + 重新生成仍应要求洋红标记背景')
}
{
  const p = prompt.buildPrompt({ size: 52, style: '卡通', styleKey: 'cartoon', regenerate: false })
  assert.ok(p.indexOf('第二张图') < 0, '非重新生成不应引用第二张图')
}

// 背景掩码：块内标记色背景占比 >= 50% 时强制映射为白色（H1），其余块正常取主色
{
  const img4 = makeGridImage() // 2×2 格、每格 4×4 像素
  const mask = new Uint8Array(8 * 8)
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      const i = (y * 8 + x) * 4
      img4.data[i] = 255
      img4.data[i + 1] = 0
      img4.data[i + 2] = 255
      mask[y * 8 + x] = 1
    }
  }
  const white = codeOf(255, 255, 255)
  const grid4 = ai.imageDataToGrid(img4, 8, 8, 2, '48', { bgMask: mask })
  assert.strictEqual(grid4[0][0], white, '背景格应强制映射为白色')
  assert.deepStrictEqual(grid4, [[white, 'A6'], ['A6', 'A4']], '其余块正常主色分块')
}

// 网格级背景掩码：outBgMask 应标记洋红占比 >= 50% 的格为背景（true），其余为 false
{
  const img5 = makeGridImage()
  const mask5 = new Uint8Array(8 * 8)
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      const i = (y * 8 + x) * 4
      img5.data[i] = 255
      img5.data[i + 1] = 0
      img5.data[i + 2] = 255
      mask5[y * 8 + x] = 1
    }
  }
  const outBg = [[false, false], [false, false]]
  ai.dominantBlockRgb(img5, 8, 8, 2, mask5, outBg)
  assert.deepStrictEqual(outBg, [[true, false], [false, false]], '背景格应标记为 true，其余为 false')
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

// 五官参考：人物提示词应引用男孩/女孩参考图，且不放大留白输入
{
  const p = prompt.buildPrompt({
    size: 52,
    style: '卡通：简化造型、粗黑描边、平涂色块、五官夸张',
    styleKey: 'cartoon',
    subject: 'person'
  })
  assert.ok(p.indexOf('男孩') >= 0 && p.indexOf('女孩') >= 0, '人物提示词应引用男孩/女孩参考图')
  assert.ok(p.indexOf('表情') >= 0 && p.indexOf('微笑') >= 0 && p.indexOf('不开心') >= 0, '应保留表情识别与表情随原图')
  assert.ok(p.indexOf('闭眼') >= 0, '应支持睁眼/闭眼')
  assert.ok(p.indexOf('留白说明') >= 0 && p.indexOf('不放大') >= 0, '应包含留白说明并禁止放大重构图')
}

// 写实风仍按原图如实绘制，仅把参考图作为像素颗粒表达参考
{
  const p = prompt.buildPrompt({ size: 52, style: '写实风', styleKey: 'realistic', subject: 'person' })
  assert.ok(p.indexOf('男孩') >= 0 && p.indexOf('女孩') >= 0, '写实风仍保留参考图引导')
  assert.ok(p.indexOf('五官（写实）') >= 0, '写实风仍保留如实还原要求')
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
{
  const p = prompt.buildPrompt({ size: 52, style: '卡通', styleKey: 'cartoon', subject: 'scenery' })
  assert.ok(p.indexOf('场景') >= 0, '风景提示词应包含场景要求')
  assert.ok(p.indexOf('肤色') < 0 && p.indexOf('腮红') < 0, '风景提示词不应包含人物专属要求')
}
{
  const p = prompt.buildPrompt({ size: 52, style: '写实风', styleKey: 'realistic', subject: 'scenery' })
  assert.ok(p.indexOf('场景') >= 0, '写实风风景提示词应包含场景要求')
}
{
  const p = prompt.buildPrompt({ size: 52, style: '卡通', styleKey: 'cartoon', subject: 'person' })
  assert.ok(p.indexOf('第二张图') < 0 && p.indexOf('五官参考') >= 0, '人物提示词保留五官参考引导，不再引用风格参考图')
}

// 抠图/背景：主体措辞
{
  const p = prompt.buildPrompt({ size: 52, style: '卡通', styleKey: 'cartoon', subject: 'person', cutout: true })
  assert.ok(p.indexOf('抠图') >= 0 && p.indexOf('主体') >= 0, '抠图提示词应使用主体措辞')
  assert.ok(p.indexOf('标记色') >= 0 && p.indexOf('RGB(255,0,255)') >= 0, '抠图提示词应要求背景洋红标记色')
  assert.ok(p.indexOf('漂浮任何独立的小色块') >= 0, '抠图提示词应禁止背景中出现孤立色块')
  const q = prompt.buildPrompt({ size: 52, style: '卡通', styleKey: 'cartoon', subject: 'person' })
  assert.ok(q.indexOf('背景') >= 0 && q.indexOf('抠图') < 0, '非抠图应使用背景措辞')
}

// 保留背景（非抠图）：必须保留原图背景，禁止纯白/纯色/留白
{
  const p = prompt.buildPrompt({ size: 52, style: '卡通', styleKey: 'cartoon', subject: 'person', cutout: false })
  assert.ok(p.indexOf('原始背景') >= 0, '非抠图应要求保留原图背景')
  assert.ok(p.indexOf('禁止把背景改成纯白') >= 0, '非抠图应明确禁止纯白背景')
  assert.ok(p.indexOf('背景必须是纯白色') < 0, '非抠图不应再要求纯白背景')
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
      p.indexOf('虚拟形象') >= 0 &&
      p.indexOf('风景') >= 0 &&
      p.indexOf('不要强行套用人物规则') >= 0,
    '自动模式应包含全部主体类别规则与人物优先的兜底引导'
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

// ---- 云函数异步任务（start → 轮询 status → 下载云存储结果）----
// 模拟 wx 环境：start 立即返回 taskId；status 按脚本返回；downloadFile 给临时路径；readFile 给 base64。
// 用立即执行的 setTimeout 跳过真实轮询/重试延迟（真实间隔由 POLL_INTERVAL / CLOUD_RETRY_DELAY 控制）。
function cloudMock(script) {
  const calls = [] // 每次 callFunction 的 data
  const downloads = [] // 每次 downloadFile 的 fileID
  const uploads = [] // 每次 uploadFile 的 cloudPath
  const wx = {
    cloud: {
      callFunction({ data }) {
        calls.push(JSON.parse(JSON.stringify(data)))
        const step = typeof script === 'function' ? script(calls.length, data) : script[calls.length - 1]
        // 脚本耗尽时返回 status:error，避免轮询无限进行
        if (!step) return Promise.resolve({ result: { ok: true, status: 'error', error: 'mock 步骤耗尽' } })
        if (step.reject) return Promise.reject(step.reject)
        return Promise.resolve({ result: step.result })
      },
      downloadFile({ fileID, success, fail }) {
        downloads.push(fileID)
        const ext = (fileID.split('.').pop() || 'jpg').replace(/[^a-z0-9]/gi, '')
        // downloadResultFile 使用 success 回调风格（wx.cloud.downloadFile 同时支持 Promise 风格）
        success({ tempFilePath: '/tmp/result.' + ext })
      },
      uploadFile({ cloudPath, filePath }) {
        uploads.push(cloudPath)
        return Promise.resolve({ fileID: 'cloud://env/' + cloudPath })
      }
    },
    getFileSystemManager() {
      return {
        readFile({ success }) {
          success({ data: 'QUJD' }) // base64("ABC")，仅验证链路
        },
        writeFile({ success }) {
          success({ errMsg: 'ok' })
        },
        unlinkSync() {}
      }
    },
    env: { USER_DATA_PATH: '/tmp' }
  }
  return { wx, calls, downloads, uploads }
}
const immediate = (fn) => {
  fn()
  return 0
}
const baseParams = { imageBase64: 'data:image/jpeg;base64,QUJD', size: 52, set: '48', style: '卡通', styleKey: 'cartoon', cutout: false, extra: '' }

;(async () => {
  global.getApp = () => ({ globalData: { user: { openid: 'u' } } })
  // happy path：上传原图 → start → pending → done → 下载 → data URL
  {
    const m = cloudMock([
      { result: { ok: true, taskId: 't1' } },
      { result: { ok: true, status: 'pending' } },
      { result: { ok: true, status: 'done', fileID: 'cloud://env/ai-tasks/u/t1.jpg', ext: 'jpg' } }
    ])
    global.wx = m.wx
    const old = global.setTimeout
    global.setTimeout = immediate
    try {
      const res = await ai.callAiGenerate(baseParams)
      assert.ok(res && res.image, '应返回生成结果')
      assert.strictEqual(res.image, 'data:image/jpg;base64,QUJD', '应下载云存储结果并转 data URL')
      assert.strictEqual(m.uploads.length, 1, '云模式应先把原图上传云存储')
      assert.strictEqual(m.calls[0].action, 'start', '首次调用应为 start')
      assert.strictEqual(m.calls[0].imageBase64, undefined, 'start 不再携带 base64')
      assert.ok(m.calls[0].imageFileID, 'start 应携带 imageFileID')
      assert.ok(m.calls[0].requestId, 'start 应携带幂等 requestId')
      assert.strictEqual(m.calls[1].action, 'status', '随后应轮询 status')
      assert.strictEqual(m.calls[1].taskId, 't1', '轮询应携带 taskId')
      assert.deepStrictEqual(m.downloads, ['cloud://env/ai-tasks/u/t1.jpg'], '应下载结果文件')
    } finally {
      delete global.wx
      global.setTimeout = old
    }
  }

  // 后台 status='error'：不自动重新提交（一张图只触发一次模型调用），抛友好文案
  {
    const m = cloudMock([
      { result: { ok: true, taskId: 't1' } },
      { result: { ok: true, status: 'error', error: '生成服务返回错误: 429' } }
    ])
    global.wx = m.wx
    const old = global.setTimeout
    global.setTimeout = immediate
    try {
      await assert.rejects(
        () => ai.callAiGenerate(baseParams),
        /生成失败，请稍后重试/,
        '失败应抛友好文案，不自动重提'
      )
      const starts = m.calls.filter((c) => c.action === 'start')
      assert.strictEqual(starts.length, 1, '一张图只提交一次 start，不重复触发模型调用')
    } finally {
      delete global.wx
      global.setTimeout = old
    }
  }

  console.log('ai.test.js 全部通过 ✓')
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
