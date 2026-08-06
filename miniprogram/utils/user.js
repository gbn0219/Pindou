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
    const raw = String((err && (err.errMsg || err.message)) || '')
    let msg = raw || '云函数调用失败'
    if (/FUNCTION_NOT_FOUND|\-501000|FunctionName parameter/.test(raw)) {
      msg = '服务未部署：请在开发者工具右键云函数 ' + name + ' → 上传并部署（云端安装依赖）'
    }
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
function createOrder(sessionId, imageHash) { return call('access', 'createOrder', { sessionId, imageHash }) }
function unlock(sessionId) { return call('access', 'unlock', { sessionId }) }
function saveGallery(payload) { return call('gallery', 'save', payload) }
function listGallery(page, pageSize) { return call('gallery', 'list', { page, pageSize }) }
function getGalleryItem(id) { return call('gallery', 'get', { id }) }
function updateGallery(payload) { return call('gallery', 'update', payload) }
function deleteGallery(id) { return call('gallery', 'delete', { id }) }
module.exports = { call, login, saveProfile, applyInvite, consumeQuota, checkAccess, createOrder, unlock, saveGallery, listGallery, getGalleryItem, updateGallery, deleteGallery }
