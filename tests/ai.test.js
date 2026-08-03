// tests/ai.test.js
/**
 * AI 生成前端纯函数测试。运行: node tests/ai.test.js
 */
const assert = require('assert')
const ai = require('../miniprogram/utils/ai.js')
const color = require('../miniprogram/utils/color.js')

const setCodes = color.buildPalette('48').map((i) => i.code)
assert.ok(setCodes.indexOf('A4') >= 0 && setCodes.indexOf('A6') >= 0, '48 套装应含 A4/A6')

// 合法 2×2 grid，行优先
const ok = ai.parseGridResponse(['A4', 'A6', 'A6', 'A4'], 2, setCodes)
assert.deepStrictEqual(ok, [['A4', 'A6'], ['A6', 'A4']], '合法 grid 应转为二维数组')

// 大小写归一
const lower = ai.parseGridResponse(['a4', 'A6', 'A6', 'a4'], 2, setCodes)
assert.deepStrictEqual(lower, [['A4', 'A6'], ['A6', 'A4']], '小写色号应归一为大写')

// 数量不对
assert.throws(() => ai.parseGridResponse(['A4', 'A6'], 2, setCodes), /数量不对/, '数量不足应报错')

// 非法色号
assert.throws(() => ai.parseGridResponse(['A4', 'ZZ', 'A6', 'A4'], 2, setCodes), /非法色号/, '非套装色号应报错')

// buildColorTable 与套装一致
const table = ai.buildColorTable('48')
assert.strictEqual(table.length, 48, '48 套装色表应有 48 项')
assert.ok(table.every((i) => i.code && i.hex && Array.isArray(i.rgb)), '色表项应含 code/hex/rgb')

console.log('ai.test.js 全部通过 ✓')