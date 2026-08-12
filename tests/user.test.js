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
assert.strictEqual(session.MAX_CANDIDATES, 5, '候选保留上限 5')
s = session.addCandidate(s, [['A1']])
s = session.addCandidate(s, [['A2']])
s = session.addCandidate(s, [['A3']])
s = session.addCandidate(s, [['A4']])
s = session.addCandidate(s, [['A5']])
assert.strictEqual(s.candidates.length, 5, '5 版内全部保留')
s = session.addCandidate(s, [['A6']])
assert.strictEqual(s.candidates.length, 5, '超出上限后仍保留 5 版')
assert.deepStrictEqual(s.candidates[0].grid, [['A2']], '超出上限替换最旧一版')
assert.strictEqual(s.index, 4, '新候选位于末尾')
s2 = session.addCandidate(session.createSession('x'), [['A1']], [[true, false]])
assert.deepStrictEqual(s2.candidates[0], { grid: [['A1']], bgMask: [[true, false]] }, '候选应携带网格级背景掩码')
assert.deepStrictEqual(session.switchCandidate(s, 1).index, 1, '可切换到已生成候选')
assert.deepStrictEqual(session.switchCandidate(s, 1).candidates[1].grid, [['A3']], '候选内容保留')
assert.throws(() => session.switchCandidate(s, 5), /下标越界/, '越界抛错')
assert.match(s.sessionId, /^\d+_[a-z0-9]{6}$/, 'sessionId 格式')

assert.deepStrictEqual(pager.pageWindow(1, 1), [1], '单页')
assert.deepStrictEqual(pager.pageWindow(3, 2), [1, 2, 3], '3 页无省略')
assert.deepStrictEqual(pager.pageWindow(10, 1), [1, 2, 3, '...', 10], '首页窗口')
assert.deepStrictEqual(pager.pageWindow(10, 10), [1, '...', 8, 9, 10], '末页窗口')
assert.deepStrictEqual(pager.pageWindow(10, 5), [1, '...', 3, 4, 5, 6, 7, '...', 10], '中间页窗口')

;(async () => {
  global.wx = { cloud: { callFunction: () => Promise.resolve({ result: { ok: true, user: { nickname: 'n', avatarFileID: 'f' } } }) } }
  const user = require('../miniprogram/utils/user.js')
  const u = await user.saveProfile({ nickname: 'n' })
  assert.strictEqual(u.nickname, 'n', 'saveProfile 直接返回 user 对象（含 nickname）')
  assert.strictEqual(u.avatarFileID, 'f', 'saveProfile 返回的 user 含 avatarFileID')
})().catch((e) => { console.error(e); process.exit(1) })

console.log('user.test.js 全部通过 \u2713')
