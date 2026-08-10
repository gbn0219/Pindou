// tests/progress.test.js
/**
 * 生成进度估算器测试。
 * 运行： node tests/progress.test.js
 */
const assert = require('assert')
const progress = require('../miniprogram/utils/progress.js')

// 时间线性估算：climb 阶段按 durationMs 推进并封顶
{
  const origNow = Date.now
  let fakeNow = 0
  Date.now = () => fakeNow
  try {
    const p = progress.createProgress({ durationMs: 100 })
    assert.strictEqual(p.value(), 0, '未开始为初始值 0')
    p.climb(12, 88)
    assert.strictEqual(p.value(), 12, '阶段起点为 12')
    fakeNow = 50
    assert.strictEqual(p.value(), 50, '50ms 应到 12+(88-12)*0.5=50')
    fakeNow = 100
    assert.strictEqual(p.value(), 88, '到达阶段上限 88')
    fakeNow = 500
    assert.strictEqual(p.value(), 88, '超过时长不应超出阶段上限')

    p.bump(95)
    assert.strictEqual(p.value(), 95, '阶段完成直接跳变到 95')
    p.finish()
    assert.strictEqual(p.value(), 100, '完成后应为 100')
  } finally {
    Date.now = origNow
  }
}

// 越界钳制：climb/bump 超出 0~100 时钳制
{
  const p = progress.createProgress()
  p.climb(-10, 999)
  assert.strictEqual(p.value(), 0, '负值应钳制到 0')
  p.bump(120)
  assert.strictEqual(p.value(), 100, '超过 100 应钳制')
}

// 默认时长 60 秒：30 秒应到 50%
{
  const origNow = Date.now
  let fakeNow = 0
  Date.now = () => fakeNow
  try {
    const p = progress.createProgress()
    p.climb(0, 100)
    fakeNow = 30000
    assert.strictEqual(p.value(), 50, '默认 60s 时 30s 应为 50%')
  } finally {
    Date.now = origNow
  }
}

console.log('progress.test.js 全部通过 ✓')
