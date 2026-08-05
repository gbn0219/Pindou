// miniprogram/utils/hash.js
/**
 * 图片哈希：FNV-1a 双种子，输出 16 位十六进制。
 * 用于按 (openid, imageHash) 统计创意生成次数；非加密哈希，防作弊能力有限（见设计文档 10.4）。
 */
function fnv1a(str, seed) {
  let h = seed >>> 0
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}
function fnv1a64(str) {
  const a = fnv1a(str, 0x811c9dc5)
  const b = fnv1a(str, 0xcbf29ce4)
  return ('00000000' + a.toString(16)).slice(-8) + ('00000000' + b.toString(16)).slice(-8)
}
module.exports = { fnv1a64 }
