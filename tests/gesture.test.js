/**
 * 双指手势（缩放 + 拖动）纯函数测试（视口模型：canvas 像素坐标，无缩放换算歧义）。
 * 模拟双指张开（放大）、双指并拢（缩小）、双指整体移动（拖动）、缩放+拖动组合、多步不漂移。
 * 运行： node tests/gesture.test.js
 */
const assert = require('assert')
const gesture = require('../miniprogram/utils/gesture.js')
const pattern = require('../miniprogram/utils/pattern.js')

// 构造一对触点：中点 (midX, midY)，两指水平间距 2*dx（dy=0 便于计算）
function touches(midX, midY, dx, dy) {
  return [
    { x: midX + dx, y: midY + dy },
    { x: midX - dx, y: midY - dy }
  ]
}

// 画布内容点（局部坐标）在 view 下的屏幕位置（= canvas 像素坐标）
function screenOf(view, localX, localY) {
  return {
    x: localX * view.scale + view.ox,
    y: localY * view.scale + view.oy
  }
}

// 纯缩放：双指张开（dist 100 → 120），中点不动 → 缩放 1.2 倍，锚点内容不移动
{
  const start = { dist: 100, midX: 100, midY: 100, scale: 0.2, ox: 10, oy: 20 }
  const [t1, t2] = touches(100, 100, 60, 0) // dist = 120
  const r = gesture.viewportPinchStep(start, start, t1, t2)
  assert.ok(Math.abs(r.scale - 0.24) < 1e-9, '间距 1.2 倍 → 缩放 1.2 倍')
  const c0 = { x: (start.midX - start.ox) / start.scale, y: (start.midY - start.oy) / start.scale }
  const before = screenOf(start, c0.x, c0.y)
  const after = screenOf(r, c0.x, c0.y)
  assert.ok(Math.abs(after.x - before.x) < 1e-6, '缩放锚点内容 x 不应移动')
  assert.ok(Math.abs(after.y - before.y) < 1e-6, '缩放锚点内容 y 不应移动')
}

// 纯缩放（缩小）：双指并拢（dist 100 → 80）→ 缩放 0.8 倍
{
  const start = { dist: 100, midX: 100, midY: 100, scale: 0.2, ox: 10, oy: 20 }
  const [t1, t2] = touches(100, 100, 40, 0) // dist = 80
  const r = gesture.viewportPinchStep(start, start, t1, t2)
  assert.ok(Math.abs(r.scale - 0.16) < 1e-9, '间距 0.8 倍 → 缩放 0.8 倍')
}

// 纯拖动：间距不变，双指中点整体移动 (+30, +20) → 视图跟随，缩放不变
{
  const start = { dist: 100, midX: 100, midY: 100, scale: 0.2, ox: 10, oy: 20 }
  const [t1, t2] = touches(130, 120, 50, 0) // dist = 100，中点 +30/+20
  const r = gesture.viewportPinchStep(start, start, t1, t2)
  assert.ok(Math.abs(r.scale - 0.2) < 1e-9, '间距不变 → 缩放不变')
  assert.ok(Math.abs(r.ox - 40) < 1e-9, '视图 ox 应跟随中点 +30')
  assert.ok(Math.abs(r.oy - 40) < 1e-9, '视图 oy 应跟随中点 +20')
}

// 多步放大不漂移：分 3 步 dist 100 → 130，最终缩放 = 1.3 倍，锚点位置不变
{
  const start = { dist: 100, midX: 100, midY: 100, scale: 0.2, ox: 10, oy: 20 }
  let cur = { scale: start.scale, ox: start.ox, oy: start.oy }
  for (const d of [110, 120, 130]) {
    const [t1, t2] = touches(100, 100, d / 2, 0) // 中点固定（屏幕不动，只张开）
    cur = gesture.viewportPinchStep(start, cur, t1, t2)
  }
  assert.ok(Math.abs(cur.scale - 0.26) < 1e-9, '多步缩放应等于总缩放比 1.3')
  const c0 = { x: (start.midX - start.ox) / start.scale, y: (start.midY - start.oy) / start.scale }
  const after = screenOf(cur, c0.x, c0.y)
  assert.ok(Math.abs(after.x - 100) < 1e-6, '多步缩放锚点 x 不漂移')
  assert.ok(Math.abs(after.y - 100) < 1e-6, '多步缩放锚点 y 不漂移')
}

// 缩放 + 拖动组合：先放大到 1.2 倍，再拖动 (+40, +30)，锚点内容跟随手指移动
{
  const start = { dist: 100, midX: 100, midY: 100, scale: 0.2, ox: 10, oy: 20 }
  let cur = { scale: start.scale, ox: start.ox, oy: start.oy }
  let [t1, t2] = touches(100, 100, 60, 0) // 放大到 0.24
  cur = gesture.viewportPinchStep(start, cur, t1, t2)
  t1 = { x: 100 + 60 + 40, y: 100 + 30 }
  t2 = { x: 100 - 60 + 40, y: 100 + 30 }
  cur = gesture.viewportPinchStep(start, cur, t1, t2)
  assert.ok(Math.abs(cur.scale - 0.24) < 1e-9, '组合手势中缩放保持不变')
  const c0 = { x: (start.midX - start.ox) / start.scale, y: (start.midY - start.oy) / start.scale }
  const after = screenOf(cur, c0.x, c0.y)
  assert.ok(Math.abs(after.x - (100 + 40)) < 1e-6, '组合手势拖动后锚点 x 随手指 +40')
  assert.ok(Math.abs(after.y - (100 + 30)) < 1e-6, '组合手势拖动后锚点 y 随手指 +30')
}

// 缩放夹取：dist 100 → 2 时理论缩放 0.004，应夹到下限
{
  const start = { dist: 100, midX: 100, midY: 100, scale: 0.2, ox: 10, oy: 20 }
  const [t1, t2] = touches(100, 100, 1, 0) // dist = 2
  const r = gesture.viewportPinchStep(start, start, t1, t2)
  assert.strictEqual(r.scale, gesture.MIN_SCALE, '应夹到最小缩放')
}

// 大尺寸盘面（208，画布按 displayCell 自适应）：初始视图应完整落在区域内
{
  const total = 208 * (pattern.displayCell(208) + pattern.GAP) - pattern.GAP
  const areaW = 350
  const areaH = 310
  const scale = Math.max(0.05, Math.min(1, Math.min(areaW, areaH) / total))
  const ox = (areaW - total * scale) / 2
  const oy = (areaH - total * scale) / 2
  assert.ok(ox > -1 && ox + total * scale <= areaW + 1, '208 盘初始应完整落在区域内（x）')
  assert.ok(oy > -1 && oy + total * scale <= areaH + 1, '208 盘初始应完整落在区域内（y）')
}

console.log('gesture.test.js 全部通过 ✓')