// miniprogram/utils/session.js
/**
 * 创意生成会话：免费模式不限制生成次数，保留最近 MAX_CANDIDATES 版候选供用户切换
 * （候选只存内存 globalData.aiSession，超出上限替换最旧一版）。
 */
const MAX_CANDIDATES = 5
function genId() {
  return Date.now() + '_' + Math.random().toString(36).slice(2, 8)
}
function createSession(imageHash) {
  return { sessionId: genId(), imageHash, candidates: [], index: 0, used: 0 }
}
function addCandidate(s, grid) {
  const candidates = s.candidates.concat([grid])
  if (candidates.length > MAX_CANDIDATES) candidates.shift()
  return Object.assign({}, s, { candidates, index: candidates.length - 1, used: candidates.length })
}
function switchCandidate(s, i) {
  if (i < 0 || i >= s.candidates.length) throw new Error('候选下标越界')
  return Object.assign({}, s, { index: i })
}
module.exports = { MAX_CANDIDATES, createSession, addCandidate, switchCandidate }
