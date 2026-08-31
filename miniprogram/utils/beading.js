// miniprogram/utils/beading.js
/**
 * 智能拼豆 / 一键跟拼（全屏引导）纯逻辑：图例构建、进度存取、强调参数。
 * 页面只负责 setData 与绘制；本模块可在 Node 中测试。
 */
const pattern = require('./pattern.js')
const hash = require('./hash.js')

/**
 * 全屏用色栏图例：排除背景格；sortBy='count' 数量降序（同数量保持色系顺序），否则色系顺序。
 */
function buildLegend(grid, palette, bgMask, sortBy) {
  const counts = pattern.countColors(grid, palette.map((i) => i.code), bgMask, sortBy)
  const hexByCode = {}
  palette.forEach((i) => {
    hexByCode[i.code] = i.hex
  })
  return counts.map((i) => ({ code: i.code, count: i.count, hex: hexByCode[i.code] }))
}

/**
 * 点亮进度存储键：优先用图纸对象上已固化的键，其次图库 id / AI 会话 id，
 * 最后按网格内容哈希（小程序关闭后原图纸本身不可恢复，哈希键仅会话内稳定）。
 */
function storageKey(p) {
  if (p.beadingKey) return p.beadingKey
  if (p.galleryId) return 'beading:g:' + p.galleryId
  if (p.sessionId) return 'beading:s:' + p.sessionId
  return 'beading:h:' + hash.fnv1a64(pattern.serializeGrid(p.grid) + '|' + p.set + '|' + p.size)
}

/**
 * 读取已点亮色号列表；无记录/异常返回空数组。
 */
function loadDone(p) {
  try {
    const v = wx.getStorageSync(storageKey(p))
    return Array.isArray(v && v.done) ? v.done : []
  } catch (e) {
    return []
  }
}

/**
 * 保存已点亮色号列表（每次"拼完了/撤回"后调用）。
 */
function saveDone(p, done) {
  try {
    wx.setStorageSync(storageKey(p), { done: done })
  } catch (e) {}
}

/**
 * 绘制强调参数：非全屏或普通模式返回 null；智能拼豆返回 spot，一键跟拼返回 build。
 */
function emphasisOpts(data, done) {
  if (!data.fullscreen || data.guideMode === 'none') return null
  if (data.guideMode === 'spot') {
    return data.fuseSelected ? { mode: 'spot', code: data.fuseSelected } : null
  }
  return { mode: 'build', code: data.buildCurrent || '', doneCodes: done || [] }
}

module.exports = { buildLegend, storageKey, loadDone, saveDone, emphasisOpts }
