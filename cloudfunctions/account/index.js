// cloudfunctions/account/index.js
/**
 * 用户中心云函数：login / getProfile / saveProfile / applyInvite。
 * 身份来自 cloud.getWXContext().OPENID（标准微信登录，云开发自动完成）。
 */
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const INVITE_CODE = process.env.INVITE_CODE || 'GBNLY99'

function ok(data) { return Object.assign({ ok: true }, data) }
function fail(code, msg) { return { ok: false, code, msg } }

async function getOrCreateUser(openid) {
  const col = db.collection('users')
  const res = await col.where({ _openid: openid }).limit(1).get()
  if (res.data.length) return res.data[0]
  const doc = {
    _openid: openid,
    nickname: '',
    avatarFileID: '',
    freeVip: false,
    inviteCode: '',
    createdAt: db.serverDate(),
    updatedAt: db.serverDate()
  }
  await col.add({ data: doc })
  return doc
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  if (!OPENID) return fail('NO_LOGIN', '请先登录')
  const action = event.action
  if (action === 'login' || action === 'getProfile') {
    return ok({ user: await getOrCreateUser(OPENID) })
  }
  if (action === 'saveProfile') {
    const data = { updatedAt: db.serverDate() }
    if (typeof event.nickname === 'string') data.nickname = event.nickname.slice(0, 30)
    if (typeof event.avatarFileID === 'string') data.avatarFileID = event.avatarFileID
    await db.collection('users').where({ _openid: OPENID }).update({ data })
    return ok({ user: await getOrCreateUser(OPENID) })
  }
  if (action === 'applyInvite') {
    if (event.code !== INVITE_CODE) return fail('BAD_CODE', '邀请码无效')
    await db.collection('users').where({ _openid: OPENID }).update({
      data: { freeVip: true, inviteCode: String(event.code), updatedAt: db.serverDate() }
    })
    return ok({ user: await getOrCreateUser(OPENID) })
  }
  return fail('BAD_ACTION', '未知操作')
}
