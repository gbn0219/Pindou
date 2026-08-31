// tests/beading.test.js
/**
 * 智能拼豆/一键跟拼 纯逻辑测试。运行: node tests/beading.test.js
 */
const assert = require('assert')
const color = require('../miniprogram/utils/color.js')
const beading = require('../miniprogram/utils/beading.js')

const palette = color.buildPalette('48')
const grid = [
  ['A6', 'A6', 'A6'],
  ['A4', 'A4', 'A6']
]

// ---- buildLegend ----
{
  const legend = beading.buildLegend(grid, palette, null, 'count')
  assert.deepStrictEqual(legend, [
    { code: 'A6', count: 4, hex: palette.find((i) => i.code === 'A6').hex },
    { code: 'A4', count: 2, hex: palette.find((i) => i.code === 'A4').hex }
  ], '按数量降序且带 hex')
  assert.deepStrictEqual(beading.buildLegend(grid, palette, null, 'color').map((i) => i.code), ['A4', 'A6'], '按颜色=色系顺序')
}

// ---- storageKey：优先级 beadingKey > galleryId > sessionId > 网格哈希 ----
{
  const p = { grid, set: '48', size: 2 }
  const k = beading.storageKey(p)
  assert.ok(k.indexOf('beading:h:') === 0, '无标识时按网格哈希')
  assert.strictEqual(beading.storageKey(p), k, '同图纸键稳定')
  assert.strictEqual(beading.storageKey({ beadingKey: 'beading:g:9', grid }), 'beading:g:9', '已固化键优先')
  assert.strictEqual(beading.storageKey({ galleryId: 9, grid, set: '48', size: 2 }), 'beading:g:9', '图库 id 优先于哈希')
  assert.strictEqual(beading.storageKey({ sessionId: 's1', grid, set: '48', size: 2 }), 'beading:s:s1', '会话 id 次之')
}

// ---- loadDone：Node 无 wx，异常兜底返回空数组 ----
{
  assert.deepStrictEqual(beading.loadDone({ grid, set: '48', size: 2 }), [], '无 wx 环境应兜底为空')
}

// ---- emphasisOpts ----
{
  assert.strictEqual(beading.emphasisOpts({ fullscreen: false, guideMode: 'build', buildCurrent: 'A6' }, []), null, '非全屏不强调')
  assert.strictEqual(beading.emphasisOpts({ fullscreen: true, guideMode: 'none' }, []), null, '普通模式不强调')
  assert.deepStrictEqual(beading.emphasisOpts({ fullscreen: true, guideMode: 'spot', fuseSelected: 'C1' }, []), { mode: 'spot', code: 'C1' }, '智能拼豆参数')
  assert.strictEqual(beading.emphasisOpts({ fullscreen: true, guideMode: 'spot', fuseSelected: '' }, []), null, '智能拼豆未选色不强调')
  assert.deepStrictEqual(
    beading.emphasisOpts({ fullscreen: true, guideMode: 'build', buildCurrent: 'A6' }, ['B1']),
    { mode: 'build', code: 'A6', doneCodes: ['B1'] },
    '一键跟拼参数'
  )
  assert.deepStrictEqual(
    beading.emphasisOpts({ fullscreen: true, guideMode: 'build', buildCurrent: '' }, []),
    { mode: 'build', code: '', doneCodes: [] },
    '一键跟拼未选当前色时仅显示已点亮'
  )
}

console.log('beading.test.js 全部通过 ✓')
