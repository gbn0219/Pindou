// cloudfunctions/access/index.js
/**
 * 访问控制云函数：consumeQuota / checkAccess / createOrder / unlock。
 * PAY_MODE=mock（默认）直接模拟支付成功；邀请码用户 freeVip 全部免费。
 */
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const MAX_ATTEMPTS = 3
const PAY_MODE = process.env.PAY_MODE || 'mock'
const UNLOCK_PRICE = Number(process.env.UNLOCK_PRICE || 100)

function ok(data) { return Object.assign({ ok: true }, data) }
function fail(code, msg) { return { ok: false, code, msg } }

async function getUser(openid) {
  const res = await db.collection('users').where({ _openid: openid }).limit(1).get()
  return res.data[0] || { freeVip: false }
}
async function getSession(openid, sessionId) {
  const res = await db.collection('ai_sessions').where({ _openid: openid, sessionId }).limit(1).get()
  return res.data[0] || null
}

async function consumeQuota(openid, event) {
  const col = db.collection('ai_sessions')
  const res = await col.where({ _openid: openid, imageHash: event.imageHash }).limit(1).get()
  const u = await getUser(openid)
  if (u.freeVip) return ok({ attempts: res.data.length ? res.data[0].attempts : 1, remaining: -1 })
  if (!event.imageHash) return fail('NO_HASH', '缺少 imageHash')
  if (res.data.length === 0) {
    await col.add({
      data: {
        _openid: openid, sessionId: event.sessionId || '', imageHash: event.imageHash,
        attempts: 1, unlocked: false, createdAt: db.serverDate(), updatedAt: db.serverDate()
      }
    })
    return ok({ attempts: 1, remaining: MAX_ATTEMPTS - 1 })
  }
  const doc = res.data[0]
  if (doc.unlocked) return ok({ attempts: doc.attempts, remaining: -1 })
  if (doc.attempts >= MAX_ATTEMPTS) return fail('QUOTA_EXCEED', '已达该图片免费生成上限（3 次），请解锁一张或更换图片')
  await col.doc(doc._id).update({ data: { attempts: doc.attempts + 1, updatedAt: db.serverDate() } })
  return ok({ attempts: doc.attempts + 1, remaining: MAX_ATTEMPTS - doc.attempts - 1 })
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  if (!OPENID) return fail('NO_LOGIN', '请先登录')
  const action = event.action
  if (action === 'consumeQuota') return consumeQuota(OPENID, event || {})
  if (action === 'checkAccess') {
    const s = await getSession(OPENID, event.sessionId || '')
    const u = await getUser(OPENID)
    return ok({ unlocked: !!(s && s.unlocked), freeVip: !!u.freeVip })
  }
  if (action === 'createOrder') {
    let s = await getSession(OPENID, event.sessionId || '')
    if (!s) {
      // 旧版本生成或会话未落库：解锁时自动补建（已付费/邀请码，不破坏计费规则）
      const imageHash = String(event.imageHash || '')
      const add = await db.collection('ai_sessions').add({
        data: {
          _openid: OPENID, sessionId: String(event.sessionId || ''), imageHash,
          attempts: MAX_ATTEMPTS, unlocked: false, createdAt: db.serverDate(), updatedAt: db.serverDate()
        }
      })
      s = { _id: add._id, sessionId: String(event.sessionId || '') }
    }
    const u = await getUser(OPENID)
    if (u.freeVip) return ok({ paid: true })
    if (PAY_MODE !== 'mock') return fail('PAY_NOT_READY', '支付未开通，请先配置 PAY_MODE')
    const addOrder = await db.collection('orders').add({
      data: {
        _openid: OPENID, sessionId: s.sessionId, amountFen: UNLOCK_PRICE, status: 'paid',
        createdAt: db.serverDate(), paidAt: db.serverDate()
      }
    })
    await db.collection('ai_sessions').doc(s._id).update({ data: { unlocked: true, updatedAt: db.serverDate() } })
    return ok({ paid: true, orderId: addOrder._id })
  }
  if (action === 'unlock') {
    const s = await getSession(OPENID, event.sessionId || '')
    if (!s) return fail('NO_SESSION', '会话不存在')
    const u = await getUser(OPENID)
    if (!u.freeVip) {
      const paid = await db.collection('orders').where({ _openid: OPENID, sessionId: s.sessionId, status: 'paid' }).limit(1).get()
      if (!paid.data.length) return fail('NOT_PAID', '未支付')
    }
    await db.collection('ai_sessions').doc(s._id).update({ data: { unlocked: true, updatedAt: db.serverDate() } })
    return ok({ unlocked: true })
  }
  return fail('BAD_ACTION', '未知操作')
}
