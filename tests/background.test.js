/**
 * AI 图纸背景近白噪声清洗测试。
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

console.log('background.test.js 全部通过 ✓')
