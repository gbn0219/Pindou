// tests/color.test.js
/**
 * 色卡与最近色匹配测试。运行: node tests/color.test.js
 */
const assert = require('assert')
const data = require('../miniprogram/data/colors.json')
const color = require('../miniprogram/utils/color.js')

const SIZES = { 48: 48, 72: 72, 144: 144, 221: 221 }

assert.strictEqual(Object.keys(data.colors).length, 221, '主表应有 221 色')
for (const key of Object.keys(SIZES)) {
  assert.strictEqual(data.sets[key].length, SIZES[key], '套装 ' + key + ' 应有 ' + SIZES[key] + ' 色')
  assert.ok(data.sets[key].every((c) => data.colors[c]), '套装 ' + key + ' 存在未知色号')
}
const has = (arr, item) => arr.indexOf(item) >= 0
assert.ok(data.sets['48'].every((c) => has(data.sets['72'], c)), '48 应 ⊆ 72')
assert.ok(data.sets['72'].every((c) => has(data.sets['144'], c)), '72 应 ⊆ 144')
assert.ok(data.sets['144'].every((c) => has(data.sets['221'], c)), '144 应 ⊆ 221')

const a4 = data.colors['A4']
assert.strictEqual(color.nearestColor(a4.rgb[0], a4.rgb[1], a4.rgb[2], color.buildPalette('221')).code, 'A4', '精确 RGB 应命中 A4')

const red = color.nearestColor(255, 0, 0, color.buildPalette('221'))
assert.ok(red.code.charAt(0) === 'F', '纯红应命中 F 系，实际 ' + red.code)

for (let i = 0; i < 200; i++) {
  const r = Math.floor(Math.random() * 256)
  const g = Math.floor(Math.random() * 256)
  const b = Math.floor(Math.random() * 256)
  const hit = color.nearestColor(r, g, b, color.buildPalette('48'))
  assert.ok(data.sets['48'].indexOf(hit.code) >= 0, '48 套装匹配越界: ' + hit.code)
}

console.log('color.test.js 全部通过 ✓')
