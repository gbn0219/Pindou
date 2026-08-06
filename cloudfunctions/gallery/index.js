// cloudfunctions/gallery/index.js
/**
 * 图库云函数：save / list（页码分页，每页 PAGE_SIZE 条）/ get（单条含 grid）/ update（回填与编辑保存）。
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
    if (event.originalThumbFileID) data.originalThumbFileID = String(event.originalThumbFileID)
    if (event.patternThumbFileID) data.patternThumbFileID = String(event.patternThumbFileID)
    if (event.originalPreviewFileID) data.originalPreviewFileID = String(event.originalPreviewFileID)
    if (event.patternPreviewFileID) data.patternPreviewFileID = String(event.patternPreviewFileID)
    if (typeof event.grid === 'string' && event.grid) data.grid = event.grid.slice(0, 400000)
    await db.collection('gallery').add({ data })
    return ok({ saved: true })
  }
  if (action === 'list') {
    const page = Math.max(1, Math.floor(Number(event.page) || 1))
    const pageSize = Math.min(50, Math.max(1, Math.floor(Number(event.pageSize) || PAGE_SIZE)))
    const where = { _openid: OPENID }
    const col = db.collection('gallery')
    const total = (await col.where(where).count()).total
    // grid 较大（104 盘约 35KB、208 盘约 140KB），列表用字段投影排除，编辑时按需 get
    const res = await col.where(where).orderBy('createdAt', 'desc').skip((page - 1) * pageSize).limit(pageSize)
      .field({
        _id: true, originalFileID: true, patternFileID: true,
        originalThumbFileID: true, patternThumbFileID: true,
        originalPreviewFileID: true, patternPreviewFileID: true,
        mode: true, style: true, size: true, set: true, sessionId: true, createdAt: true
      }).get()
    // 直接返回 fileID（含压缩缩略图），前端用 cloud:// 渲染，不依赖域名白名单
    return ok({ items: res.data, page, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) })
  }
  if (action === 'get') {
    if (!event.id) return fail('MISSING_ID', '缺少记录 ID')
    const res = await db.collection('gallery').where({ _openid: OPENID, _id: event.id }).limit(1).get()
    if (!res.data.length) return fail('NOT_FOUND', '记录不存在')
    return ok({ item: res.data[0] })
  }
  if (action === 'update') {
    if (!event.id) return fail('MISSING_ID', '缺少记录 ID')
    const res = await db.collection('gallery').where({ _openid: OPENID, _id: event.id }).limit(1).get()
    if (!res.data.length) return fail('NOT_FOUND', '记录不存在')
    const data = { updatedAt: db.serverDate() }
    const fields = ['patternFileID', 'patternThumbFileID', 'patternPreviewFileID', 'originalThumbFileID', 'originalPreviewFileID']
    for (const f of fields) {
      if (typeof event[f] === 'string' && event[f]) data[f] = event[f]
    }
    if (typeof event.grid === 'string' && event.grid) data.grid = event.grid.slice(0, 400000)
    await db.collection('gallery').doc(res.data[0]._id).update({ data })
    return ok({ updated: true })
  }
  return fail('BAD_ACTION', '未知操作')
}
