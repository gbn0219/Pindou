// cloudfunctions/sec-check/index.js
/**
 * 内容安全检测云函数：msg（文本 msgSecCheck）/ img（图片 imgSecCheck）。
 * 供小程序内所有用户发布场景调用（昵称/头像、导入图片、创意生成风格与修改要求），
 * 检测结果仅区分“合规/含违规信息”，不向用户透出检测细节。
 */
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const IMG_MAX_BYTES = 1 * 1024 * 1024 // imgSecCheck 图片上限 1M
const SCENES = [1, 2, 3, 4] // 1 资料；2 评论；3 论坛；4 社交日志

function ok(data) { return Object.assign({ ok: true }, data) }
function fail(code, msg) { return { ok: false, code, msg } }

function isRisky(err, res) {
  const code =
    (err && (err.errCode || err.errcode)) ||
    (res && (res.errCode || res.errcode))
  if (code === 87014) return true
  // msgSecCheck 2.0：errcode 0 时以 result.suggest 判断
  return !!(res && res.result && res.result.suggest === 'risky')
}

async function checkMsg(OPENID, event) {
  const content = String(event.content || '').trim().slice(0, 2500)
  if (!content) return ok({ risky: false })
  const scene = SCENES.indexOf(Number(event.scene)) >= 0 ? Number(event.scene) : 2
  try {
    const res = await cloud.openapi.security.msgSecCheck({
      openid: OPENID,
      scene,
      version: 2,
      content
    })
    return ok({ risky: isRisky(null, res) })
  } catch (err) {
    if (isRisky(err, null)) return ok({ risky: true })
    console.error('[sec-check] msgSecCheck 调用失败:', err)
    return fail('CHECK_FAIL', '内容安全检测失败')
  }
}

async function checkImg(OPENID, event) {
  const base64 = String(event.base64 || '')
  if (!base64) return ok({ risky: false })
  const buf = Buffer.from(base64, 'base64')
  if (!buf.length || buf.length > IMG_MAX_BYTES) return fail('IMG_TOO_LARGE', '图片过大')
  try {
    const res = await cloud.openapi.security.imgSecCheck({
      media: { contentType: 'image/jpeg', value: buf }
    })
    return ok({ risky: isRisky(null, res) })
  } catch (err) {
    if (isRisky(err, null)) return ok({ risky: true })
    console.error('[sec-check] imgSecCheck 调用失败:', err)
    return fail('CHECK_FAIL', '内容安全检测失败')
  }
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  if (!OPENID) return fail('NO_LOGIN', '请先登录')
  const action = event && event.action
  if (action === 'msg') return checkMsg(OPENID, event)
  if (action === 'img') return checkImg(OPENID, event)
  return fail('BAD_ACTION', '未知操作')
}
