// miniprogram/utils/user.js
/**
 * 用户中心云函数封装：account / access / gallery。
 * 统一返回 { ok:true, ... } 或 { ok:false, code, msg }；错误以 Error 抛出（err.code 可判型）。
 */
function call(name, action, data) {
  return wx.cloud.callFunction({ name, data: Object.assign({ action }, data || {}) }).then((res) => {
    const r = (res && res.result) || {}
    if (!r.ok) {
      const err = new Error(r.msg || '操作失败')
      err.code = r.code || 'ERROR'
      throw err
    }
    return r
  }).catch((err) => {
    const msg = (err && (err.errMsg || err.message)) || '云函数调用失败'
    const e = new Error(msg)
    e.code = (err && err.code) || 'CALL_FAIL'
    throw e
  })
}
function login() { return call('account', 'login') }
function saveProfile(payload) { return call('account', 'saveProfile', payload) }
function applyInvite(code) { return call('account', 'applyInvite', { code }) }
function consumeQuota(payload) { return call('access', 'consumeQuota', payload) }
function checkAccess(sessionId) { return call('access', 'checkAccess', { sessionId }) }
function createOrder(sessionId) { return call('access', 'createOrder', { sessionId }) }
function unlock(sessionId) { return call('access', 'unlock', { sessionId }) }
function saveGallery(payload) { return call('gallery', 'save', payload) }
function listGallery(page, pageSize) { return call('gallery', 'list', { page, pageSize }) }
module.exports = { call, login, saveProfile, applyInvite, consumeQuota, checkAccess, createOrder, unlock, saveGallery, listGallery }
