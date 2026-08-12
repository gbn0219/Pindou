// miniprogram/utils/progress.js
/**
 * 生成进度估算与浮层驱动（index / pattern 页共用，可在 Node 中测试估算逻辑）。
 *
 * 真实进度未知的生成阶段按时间线性估算（默认 2 分钟走完一段，对应一次 AI 生成的实际耗时），
 * 阶段切换用 bump 直接跳变，避免进度长时间不动让用户以为卡死。
 *
 * 用法：
 *   const prog = progressUtil.createProgress()       // 默认 durationMs 120000
 *   progressUtil.startOverlay(page, prog)            // 显示浮层并每 400ms 刷新百分比
 *   prog.bump(5)                                     // 阶段确定：直接跳到 5%
 *   prog.climb(12, 88)                               // 等待阶段：12% → 88% 按时间线性推进
 *   prog.finish() / progressUtil.stopOverlay(page)   // 完成：隐藏浮层
 */
function createProgress(opts) {
  const durationMs = (opts && opts.durationMs) || 120000
  let running = false
  let startMs = 0
  let base = 0
  let cap = 100
  const clamp = (v) => Math.max(0, Math.min(100, v))
  return {
    climb(basePct, capPct) {
      base = clamp(basePct)
      cap = Math.max(base, clamp(capPct))
      startMs = Date.now()
      running = true
      return this
    },
    bump(pct) {
      base = clamp(pct)
      cap = Math.max(base, cap)
      startMs = Date.now()
      running = true
      return this
    },
    value() {
      if (!running) return base
      const el = Date.now() - startMs
      return Math.round(base + Math.min(1, el / durationMs) * (cap - base))
    },
    finish() {
      running = false
      base = 100
      return 100
    }
  }
}

function clearTimer(page) {
  if (page._progressTimer) {
    clearInterval(page._progressTimer)
    page._progressTimer = null
  }
}

function startOverlay(page, prog) {
  clearTimer(page)
  page.setData({ progressShow: true, progressPct: prog.value(), progressTip: '' })
  page._progressTimer = setInterval(() => {
    page.setData({ progressPct: prog.value() })
  }, 400)
  return prog
}

function stopOverlay(page) {
  clearTimer(page)
  page.setData({ progressShow: false, progressPct: 0, progressTip: '' })
}

module.exports = { createProgress, startOverlay, stopOverlay }
