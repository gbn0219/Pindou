// miniprogram/utils/session.js
/**
 * 创意生成会话：每张原图最多 MAX_CANDIDATES 次候选，候选只存内存（globalData.aiSession）。
 */
const MAX_CANDIDATES = 3
function genId() {
  return Date.now() + '_' + Math.random().toString(36).slice(2, 8)
}
function createSession(imageHash) {
  return { sessionId: genId(), imageHash, candidates: [], index: 0, used: 0 }
}
function addCandidate(s, grid) {
  const candidates = s.candidates.concat([grid])
  return Object.assign({}, s, { candidates, index: candidates.length - 1, used: candidates.length })
}
function switchCandidate(s, i) {
  if (i < 0 || i >= s.candidates.length) throw new Error('候选下标越界')
  return Object.assign({}, s, { index: i })
}
function canGenerate(s) {
  return s.candidates.length < MAX_CANDIDATES
}
module.exports = { MAX_CANDIDATES, createSession, addCandidate, switchCandidate, canGenerate }
