// cloudfunctions/gallery/index.js
/**
 * 图库云函数：save / list（页码分页，每页 PAGE_SIZE 条）。
 */
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const PAGE_SIZE = 10

function ok(data) { return Object.assign({ ok: true }, data) }
function fail(code, msg) { return { ok: false, code, msg } }

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  if (!OPENID) return fail('NO_LOGIN', '请先登录')
  const action = event.action
  if (action === 'save') {
    if (!event.originalFileID || !event.patternFileID) return fail('MISSING_FILE', '缺少图片文件')
    const data = {
      _openid: OPENID,
      originalFileID: event.originalFileID,
      patternFileID: event.patternFileID,
      mode: event.mode === 'photo' ? 'photo' : 'ai',
      style: String(event.style || ''),
      size: Number(event.size) || 52,
      set: String(event.set || '221'),
      createdAt: db.serverDate()
    }
    if (event.sessionId) data.sessionId = String(event.sessionId)
    await db.collection('gallery').add({ data })
    return ok({ saved: true })
  }
  if (action === 'list') {
    const page = Math.max(1, Math.floor(Number(event.page) || 1))
    const pageSize = Math.min(50, Math.max(1, Math.floor(Number(event.pageSize) || PAGE_SIZE)))
    const where = { _openid: OPENID }
    const col = db.collection('gallery')
    const total = (await col.where(where).count()).total
    const res = await col.where(where).orderBy('createdAt', 'desc').skip((page - 1) * pageSize).limit(pageSize).get()
    return ok({ items: res.data, page, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) })
  }
  return fail('BAD_ACTION', '未知操作')
}
