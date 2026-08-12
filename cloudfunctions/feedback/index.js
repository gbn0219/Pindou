// cloudfunctions/feedback/index.js
/**
 * 意见反馈云函数：submit 写入 feedback 集合（自动尝试建集合）。
 * 记录内容、设备信息与提交人 openid；不含联系方式与外部通知（按确认后的设计）。
 */
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const CONTENT_MAX = 500

function ok(data) { return Object.assign({ ok: true }, data) }
function fail(code, msg) { return { ok: false, code, msg } }

async function ensureCollection() {
  try {
    await db.createCollection('feedback')
  } catch (e) {
    // 集合已存在或当前环境不支持时忽略
  }
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  if (!OPENID) return fail('NO_LOGIN', '请先登录')
  if (!event || event.action !== 'submit') return fail('BAD_ACTION', '未知操作')
  const content = String(event.content || '').trim()
  if (!content) return fail('EMPTY_CONTENT', '请填写反馈内容')
  if (content.length > CONTENT_MAX) return fail('TOO_LONG', '反馈内容过长')
  await ensureCollection()
  const data = {
    _openid: OPENID,
    content,
    status: 'new',
    createdAt: db.serverDate()
  }
  const device = String(event.device || '').trim()
  if (device) data.device = device.slice(0, 200)
  await db.collection('feedback').add({ data })
  return ok({ saved: true })
}
