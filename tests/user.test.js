// tests/user.test.js
/**
 * 用户中心纯函数测试：图片哈希 / 创意生成会话候选 / 分页页码窗口。
 * 运行：node tests/user.test.js
 */
const assert = require('assert')
const hash = require('../miniprogram/utils/hash.js')
const session = require('../miniprogram/utils/session.js')
const pager = require('../miniprogram/utils/pager.js')

const h1 = hash.fnv1a64('abc')
assert.strictEqual(h1, hash.fnv1a64('abc'), '同输入同输出')
assert.notStrictEqual(h1, hash.fnv1a64('abd'), '不同输入不同输出')
assert.match(h1, /^[0-9a-f]{16}$/, '16 位十六进制')

let s = session.createSession(h1)
assert.strictEqual(s.candidates.length, 0, '初始无候选')
assert.strictEqual(session.canGenerate(s), true, '初始可生成')
s = session.addCandidate(s, [['A1']])
s = session.addCandidate(s, [['A2']])
s = session.addCandidate(s, [['A3']])
assert.strictEqual(session.canGenerate(s), false, '3 次后不可再生成')
assert.deepStrictEqual(session.switchCandidate(s, 1).index, 1, '可切换到已生成候选')
assert.deepStrictEqual(session.switchCandidate(s, 1).candidates[1], [['A2']], '候选内容保留')
assert.throws(() => session.switchCandidate(s, 3), /下标越界/, '越界抛错')
assert.match(s.sessionId, /^\d+_[a-z0-9]{6}$/, 'sessionId 格式')

assert.deepStrictEqual(pager.pageWindow(1, 1), [1], '单页')
assert.deepStrictEqual(pager.pageWindow(3, 2), [1, 2, 3], '3 页无省略')
assert.deepStrictEqual(pager.pageWindow(10, 1), [1, 2, 3, '...', 10], '首页窗口')
assert.deepStrictEqual(pager.pageWindow(10, 10), [1, '...', 8, 9, 10], '末页窗口')
assert.deepStrictEqual(pager.pageWindow(10, 5), [1, '...', 3, 4, 5, 6, 7, '...', 10], '中间页窗口')

console.log('user.test.js 全部通过 \u2713')
