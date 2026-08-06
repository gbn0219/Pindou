// miniprogram/utils/gesture.js
/**
 * 双指手势（缩放 + 拖动）纯函数，可在 Node 中测试。
 *
 * 视图模型：画布直接绘制在“区域大小”的 canvas 上（无 CSS 缩放），内容通过
 * ctx 变换呈现：画布局部坐标 p 映射到屏幕 = p * scale + (ox, oy)。
 * 触点坐标就是 canvas 像素坐标，无任何缩放换算歧义。
 * view = { scale, ox, oy }
 */

const MIN_SCALE = 0.05
const MAX_SCALE = 4

/**
 * 双指一次移动后的新视图状态（相对捏合起点的绝对缩放 + 锚定 + 拖动）。
 * 缩放 = 间距比 × 起点缩放；锚点 = 起点双指中点下的画布内容，
 * 该内容点跟随“起点中点 + 手指屏幕位移”（即先锚定缩放、再叠加拖动，过程连贯）。
 *
 * @param {object} start 捏合起点：{ dist, midX, midY, scale, ox, oy }
 * @param {object} current 当前视图：{ scale, ox, oy }
 * @param {object} t1 触点 1：{ x, y }（canvas 像素）
 * @param {object} t2 触点 2：{ x, y }
 * @returns {{ scale: number, ox: number, oy: number }}
 */
function viewportPinchStep(start, current, t1, t2) {
  const dist = Math.sqrt((t1.x - t2.x) * (t1.x - t2.x) + (t1.y - t2.y) * (t1.y - t2.y))
  if (!dist || !start.dist) {
    return { scale: current.scale, ox: current.ox, oy: current.oy }
  }
  const midX = (t1.x + t2.x) / 2
  const midY = (t1.y + t2.y) / 2
  let scale = start.scale * (dist / start.dist)
  scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale))
  // 起点双指中点下的画布内容点
  const c0X = (start.midX - start.ox) / start.scale
  const c0Y = (start.midY - start.oy) / start.scale
  const ox = start.midX + (midX - start.midX) - c0X * scale
  const oy = start.midY + (midY - start.midY) - c0Y * scale
  return { scale, ox, oy }
}

/**
 * 把视图约束在坐标条框内：内容不进入四周坐标条区域（不遮挡坐标）。
 * total 为内容世界尺寸（正方形网格边长）；ruler 为每侧坐标条宽高（屏幕 px）。
 * 内容小于内区时锁定居中；大于内区时平移范围受限在框内。
 */
function clampView(view, total, areaW, areaH, ruler) {
  const innerW = areaW - ruler * 2
  const innerH = areaH - ruler * 2
  const w = total * view.scale
  const h = total * view.scale
  let ox = view.ox
  let oy = view.oy
  if (w <= innerW) ox = ruler + (innerW - w) / 2
  else ox = Math.max(ruler + innerW - w, Math.min(ruler, ox))
  if (h <= innerH) oy = ruler + (innerH - h) / 2
  else oy = Math.max(ruler + innerH - h, Math.min(ruler, oy))
  return { scale: view.scale, ox, oy }
}

module.exports = { viewportPinchStep, clampView, MIN_SCALE, MAX_SCALE }