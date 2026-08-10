/**
 * 图纸背景近白噪声清洗测试。
 * 运行： node tests/background.test.js
 */
const assert = require('assert')
const background = require('../miniprogram/utils/background.js')

function makeImage(w, h) {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 255
    data[i + 1] = 255
    data[i + 2] = 255
    data[i + 3] = 255
  }
  return { data, width: w, height: h }
}

function px(img, x, y, r, g, b) {
  const i = (y * img.width + x) * 4
  img.data[i] = r
  img.data[i + 1] = g
  img.data[i + 2] = b
  img.data[i + 3] = 255
}

function at(img, x, y) {
  const i = (y * img.width + x) * 4
  return [img.data[i], img.data[i + 1], img.data[i + 2]]
}

// 背景近白噪声被洗成纯白；主体、内部白色高光、贴着主体的细节都不受影响
{
  const img = makeImage(16, 16)
  // 主体：红色方块（5..10 行/列）
  for (let y = 5; y <= 10; y++) {
    for (let x = 5; x <= 10; x++) px(img, x, y, 255, 0, 0)
  }
  // 背景近白噪声：顶部 3 行都是 240 灰白（连通到上边界）
  for (let y = 0; y < 3; y++) {
    for (let x = 0; x < 16; x++) px(img, x, y, 240, 240, 240)
  }
  // 背景柔化边缘：紧贴背景的 220 浅灰
  px(img, 0, 3, 220, 220, 220)
  // 背景内孤立噪点（1px 灰点，不连主体）
  px(img, 3, 3, 200, 200, 200)
  px(img, 12, 12, 180, 180, 180)
  // 主体内部白色高光（不连边界，属于内容）
  px(img, 7, 7, 250, 250, 250)
  // 贴着主体的灰色小点（与红色主体连通，属于内容）
  px(img, 5, 11, 200, 200, 200)
  // 背景内小型彩色内容（2×2 红点，被背景包围）：彩色内容不应被当作噪声移除
  px(img, 2, 13, 255, 0, 0)
  px(img, 3, 13, 255, 0, 0)
  px(img, 2, 14, 255, 0, 0)
  px(img, 3, 14, 255, 0, 0)

  background.cleanImageData(img)

  assert.deepStrictEqual(at(img, 0, 0), [255, 255, 255], '顶部近白噪声应洗成纯白')
  assert.deepStrictEqual(at(img, 15, 1), [255, 255, 255], '连通边界的近白应洗成纯白')
  assert.deepStrictEqual(at(img, 0, 3), [255, 255, 255], '紧贴背景的柔和浅色应并入背景')
  assert.deepStrictEqual(at(img, 3, 3), [255, 255, 255], '背景内孤立噪点应移除')
  assert.deepStrictEqual(at(img, 12, 12), [255, 255, 255], '背景内孤立噪点应移除')
  assert.deepStrictEqual(at(img, 5, 5), [255, 0, 0], '主体颜色不应改变')
  assert.deepStrictEqual(at(img, 7, 7), [250, 250, 250], '主体内部白色高光不应被清洗')
  assert.deepStrictEqual(at(img, 5, 11), [200, 200, 200], '贴着主体的细节不应被清洗')
  assert.deepStrictEqual(at(img, 2, 13), [255, 0, 0], '背景内小型彩色内容不应被当作噪声移除')
}

// 无近白背景：图像完全不变
{
  const img = makeImage(8, 8)
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) px(img, x, y, 100, 100, 100)
  }
  background.cleanImageData(img)
  assert.deepStrictEqual(at(img, 0, 0), [100, 100, 100], '无近白时不应改动')
  assert.deepStrictEqual(at(img, 7, 7), [100, 100, 100], '无近白时不应改动')
}

// 全白图像：清洗后仍全白（不报错）
{
  const img = makeImage(4, 4)
  background.cleanImageData(img)
  assert.deepStrictEqual(at(img, 1, 1), [255, 255, 255], '全白应保持全白')
}

// 0 尺寸：不报错
{
  const img = { data: new Uint8ClampedArray(0), width: 0, height: 0 }
  background.cleanImageData(img)
  assert.strictEqual(img.data.length, 0, '0 尺寸不应报错')
}

// 洋红标记背景：逐像素识别，不依赖四边连通；主体内部白色高光不被清洗
{
  const img = makeImage(16, 16)
  // 背景：整幅洋红（含被主体切出的"孤立背景块"）
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) px(img, x, y, 255, 0, 255)
  }
  // 主体：红色方块（5..10 行/列）
  for (let y = 5; y <= 10; y++) {
    for (let x = 5; x <= 10; x++) px(img, x, y, 255, 0, 0)
  }
  // 主体内部白色高光（不连背景，属于内容）
  px(img, 7, 7, 250, 250, 250)
  // 背景内近白残留（与洋红相邻）：应并入背景
  px(img, 0, 0, 250, 250, 250)
  px(img, 15, 15, 245, 245, 245)
  // 背景内孤立彩色碎块（2×2 蓝点，不连主体）：标记色模式下无论颜色都应并入背景
  px(img, 2, 13, 20, 20, 220)
  px(img, 3, 13, 20, 20, 220)
  px(img, 2, 14, 20, 20, 220)
  px(img, 3, 14, 20, 20, 220)

  const mask = background.cleanMarkerBackground(img, { noiseMax: 8 })
  assert.ok(mask, '应识别出洋红标记背景')
  assert.strictEqual(at(img, 0, 0)[0], 255, '近白残留应并入背景')
  assert.strictEqual(at(img, 15, 15)[0], 255, '近白残留应并入背景')
  assert.strictEqual(at(img, 2, 13)[0], 255, '背景内孤立彩色碎块应并入背景')
  assert.deepStrictEqual(at(img, 5, 5), [255, 0, 0], '主体颜色不应改变')
  assert.deepStrictEqual(at(img, 7, 7), [250, 250, 250], '主体内部白色高光不应被清洗')
  assert.strictEqual(mask[0], 1, '掩码应标记背景')
  assert.strictEqual(mask[5 * 16 + 5], 0, '主体不应在掩码内')
  assert.strictEqual(mask[2 * 16 + 13], 1, '彩色碎块应纳入背景掩码')
}

// 偏粉/玫红背景（模型把洋红画成 E6 #EB4172）：边框主色学习应仍识别为背景
{
  const img = makeImage(16, 16)
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) px(img, x, y, 235, 65, 114)
  }
  // 主体：红色方块（5..10 行/列）
  for (let y = 5; y <= 10; y++) {
    for (let x = 5; x <= 10; x++) px(img, x, y, 255, 0, 0)
  }
  const mask = background.cleanMarkerBackground(img, { noiseMax: 8 })
  assert.ok(mask, '粉背景应识别出背景掩码')
  assert.deepStrictEqual(at(img, 0, 0), [255, 255, 255], '粉背景应被洗成白色')
  assert.deepStrictEqual(at(img, 5, 5), [255, 0, 0], '主体颜色不应改变')
  assert.strictEqual(mask[5 * 16 + 5], 0, '主体不应在掩码内')
}

// 洋红标记覆盖不足：返回 null（调用方回退近白清洗）
{
  const img = makeImage(16, 16)
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) px(img, x, y, 250, 250, 250)
  }
  // 仅 2 个洋红像素（约 0.8%），低于 1% 覆盖率阈值
  px(img, 0, 0, 255, 0, 255)
  px(img, 1, 0, 255, 0, 255)
  assert.strictEqual(background.cleanMarkerBackground(img), null, '覆盖率不足应返回 null')
}

// flood fill 像素索引错位回归：主体像素的"4 倍别名"是背景时，不应被误并入背景（曾导致头顶头发被吃）
{
  const img = makeImage(16, 16)
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) px(img, x, y, 255, 0, 255)
  }
  // 主体：红色大块（1..10 行，2..13 列），超过 noiseMax 不会被当噪点
  for (let y = 1; y <= 10; y++) {
    for (let x = 2; x <= 13; x++) px(img, x, y, 255, 0, 0)
  }
  // 主体内一个洋红"洞"（8,4）：其线性索引 72 是主体像素 (2,1) 索引 18 的 4 倍别名，
  // 旧代码 flood fill 检查 isFill(nidx*4) 时会把 (2,1) 误判为背景
  px(img, 8, 4, 255, 0, 255)
  const mask = background.cleanMarkerBackground(img, { noiseMax: 8 })
  assert.ok(mask, '应识别出洋红标记背景')
  assert.strictEqual(mask[1 * 16 + 2], 0, '主体像素（其 4 倍别名是洋红洞）不应被误并入背景')
  assert.strictEqual(mask[4 * 16 + 8], 1, '洋红洞本身仍应标记为背景')
  assert.deepStrictEqual(at(img, 2, 1), [255, 0, 0], '主体像素颜色不应改变')
}

console.log('background.test.js 全部通过 ✓')
