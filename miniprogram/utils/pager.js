// miniprogram/utils/pager.js
/**
 * 页码窗口：当前页 ±2 + 固定首尾页，跳过页码用 '...' 占位。
 */
function pageWindow(total, current, span) {
  if (total <= 1) return [1]
  const s = span || 2
  const set = new Set([1, total])
  for (let i = current - s; i <= current + s; i++) {
    if (i >= 1 && i <= total) set.add(i)
  }
  const sorted = Array.from(set).sort((a, b) => a - b)
  const out = []
  let prev = 0
  for (const n of sorted) {
    if (n - prev > 1) out.push('...')
    out.push(n)
    prev = n
  }
  return out
}
module.exports = { pageWindow }
