// cloudfunctions/account/index.js
/**
 * 用户中心云函数：login / getProfile / saveProfile。
 * 身份来自 cloud.getWXContext().OPENID（标准微信登录，云开发自动完成）。
 */
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

function ok(data) { return Object.assign({ ok: true }, data) }
function fail(code, msg) { return { ok: false, code, msg } }

async function getOrCreateUser(openid) {
  const col = db.collection('users')
  const res = await col.where({ _openid: openid }).limit(1).get()
  const withOpenid = (doc) => Object.assign({}, doc, { openid: doc._openid })
  if (res.data.length) return withOpenid(res.data[0])
  const doc = {
    _openid: openid,
    nickname: '',
    avatarFileID: '',
    createdAt: db.serverDate(),
    updatedAt: db.serverDate()
  }
  await col.add({ data: doc })
  return withOpenid(doc)
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
  return fail('BAD_ACTION', '未知操作')
}
