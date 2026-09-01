// utils/guide.js — 新手引导：提示配置、已读记忆、气泡定位、页面侧驱动（node 可测纯逻辑）
// 纯函数部分（computeBubble / isSeen / markSeen / TIPS）不依赖 wx，可单测；
// 页面侧驱动（start / step / next / skip / finish）运行在小程序环境。

const STORAGE_PREFIX = 'guideTipsSeen_'
// TODO 测试用开关：true = 每次进入页面都显示引导（方便定位/交互调试）；改回 false 恢复一次性记忆
const ALWAYS_SHOW_GUIDE = true

// 各页提示：selector 为页面内查询目标（类名）；text 为气泡文案；
// interactive 表示高亮区域可点击（点按后由页面处理，如打开选项弹层）；
// scroll: false 表示目标在固定浮层内（弹层/全屏面板），无需页面滚动
const TIPS = {
  index: [
    { key: 'i1', selector: '.import-card', text: '点这里选图' },
    { key: 'i4', selector: '.ai-summary', text: '图纸选项' },
    { key: 'i2', selector: '.ai-set-section', text: '这里选择图纸颜色数量', scroll: false },
    { key: 'i3', selector: '.ai-size-section', text: '这里选择图纸大小', scroll: false },
    { key: 's1', selector: '.scan-entry', text: '点这里识别已有图纸' }
  ],
  scan: [
    { key: 's2', selector: '.cells-row', text: '格数作为对齐参考' },
    { key: 's3', selector: '.footer-actions', text: '缩放/拖动图片对齐网格，点此识别图纸' }
  ],
  pattern: [
    { key: 'p1', selector: '.canvas-area', text: '双指缩放、单指拖动查看' },
    { key: 'p2', selector: '.legend-list', text: '用到的颜色清单' },
    { key: 'p3', selector: '.action-bar', text: '图纸支持修改和导出为图片' }
  ],
  patternEdit: [
    { key: 'e1', selector: '.tool-row', text: '涂色/换色/吸色' },
    { key: 'e2', selector: '.canvas-area', text: '轻点格子改色，拖动不会误涂' },
    { key: 'e3', selector: '.palette', text: '按色系分区选色，点格子上色' },
    { key: 'e4', selector: '.top-bar', text: '改错了可撤销；裁剪可切掉多余部分' }
  ],
  gallery: [
    { key: 'g1', selector: '.pair-thumbs', text: '点原图或图纸可放大预览' },
    { key: 'g2', selector: '.pair-primary', text: '直接进入全屏拼豆或改色' },
    { key: 'g3', selector: '.pair-secondary', text: '重新导出图片，或删除条目' }
  ],
  profile: [
    { key: 'pr1', selector: '.profile-card', text: '点头像换头像，点昵称改名字' },
    { key: 'pr2', selector: '.menu-card', text: '图库/使用指南/常见问题/反馈都在这里' }
  ],
  profileGuest: [
    { key: 'pr3', selector: '.login-card', text: '一键登录后可用创意生成、自动存图库' }
  ],
  beading: [
    { key: 'b1', selector: '.fuse-strip', text: '点击颜色一键跟拼，手机和拼豆板已拼颜色保持一致', scroll: false },
    { key: 'b3', selector: '.fuse-strip', text: '点颜色高亮整图对应格子', scroll: false }
  ]
}

function tipsFor(pageKey) {
  return TIPS[pageKey] || []
}

function keyOf(pageKey) {
  return STORAGE_PREFIX + pageKey
}

function defaultStorage() {
  return {
    get(key) {
      return wx.getStorageSync(key)
    },
    set(key, value) {
      wx.setStorageSync(key, value)
    }
  }
}

function isSeen(pageKey, storage) {
  const s = storage || defaultStorage()
  return !!s.get(keyOf(pageKey))
}

function markSeen(pageKey, storage) {
  const s = storage || defaultStorage()
  s.set(keyOf(pageKey), true)
}

// ---- 气泡定位（纯函数）----
const BUBBLE_MARGIN = 12 // 与屏幕边缘最小间距 px
const BUBBLE_GAP = 10 // 气泡与锚点间距 px
const ARROW_HALF = 8 // 箭头半宽 px

function computeBubble(anchor, viewport, bubble) {
  const vw = viewport.width
  const vh = viewport.height
  const bw = bubble.width
  const bh = bubble.height
  const cx = anchor.left + anchor.width / 2
  let left = Math.max(BUBBLE_MARGIN, Math.min(vw - bw - BUBBLE_MARGIN, cx - bw / 2))
  let top = anchor.top + anchor.height + BUBBLE_GAP
  let placement = 'bottom'
  if (top + bh + BUBBLE_MARGIN > vh && anchor.top - BUBBLE_GAP - bh >= BUBBLE_MARGIN) {
    top = anchor.top - BUBBLE_GAP - bh
    placement = 'top'
  } else {
    top = Math.max(BUBBLE_MARGIN, Math.min(top, vh - bh - BUBBLE_MARGIN))
  }
  let arrowLeft = Math.max(14, Math.min(bw - 28, cx - left - ARROW_HALF))
  return { left: Math.round(left), top: Math.round(top), placement, arrowLeft: Math.round(arrowLeft) }
}

// ---- 页面侧驱动（运行在小程序环境，依赖 wx）----
// 页面 data 需含 guideShow/guideTips/guideIndex/guideAnchor/guideInteractive
// hooks.beforeStep(i, tip, measure)：测量前介入（如先把弹层滚到目标）
// hooks.afterNext(i, tip, after)：推进后介入（如关掉弹层再走下一步）
function start(page, pageKey, tips, hooks) {
  if (!tips || !tips.length) return false
  if (page.data.guideShow) return false
  if (!ALWAYS_SHOW_GUIDE && isSeen(pageKey)) return false
  page.guidePageKey = pageKey
  page.guideHooks = hooks || {}
  page.guideShownCount = 0 // 实际展示过的步数（整轮都没展示则不标记已看）
  page.setData({
    guideShow: true,
    guideTips: tips,
    guideIndex: 0,
    guideAnchor: null,
    guideInteractive: false
  })
  step(page, 0)
  return true
}

function step(page, i) {
  const tips = page.data.guideTips || []
  const tip = tips[i]
  if (!tip) return finish(page)
  // 先清空锚点（组件会隐藏气泡），页面定位完成后再显示，气泡出现时页面不再滑动
  page.setData({ guideIndex: i, guideAnchor: null, guideInteractive: !!(tip.interactive) })
  const hooks = page.guideHooks || {}
  let winH = 0
  try {
    winH = (wx.getSystemInfoSync() || {}).windowHeight || 0
  } catch (err) {
    winH = 0
  }
  const show = (r, stepIndex) => {
    page.guideShownCount = (page.guideShownCount || 0) + 1
    page.setData({ guideAnchor: { left: r.left, top: r.top, width: r.width, height: r.height } })
    // 布局/滚动完全稳定后再复测一次，修正瞬时偏移
    setTimeout(() => {
      if (page.data.guideIndex !== stepIndex) return
      wx.createSelectorQuery()
        .select(tip.selector)
        .boundingClientRect()
        .exec((res) => {
          const r2 = res && res[0]
          if (!r2 || !r2.width) return
          page.setData({ guideAnchor: { left: r2.left, top: r2.top, width: r2.width, height: r2.height } })
        })
    }, 220)
  }
  const measure = (tryCount, scrolled) => {
    wx.createSelectorQuery()
      .select(tip.selector)
      .boundingClientRect()
      .exec((res) => {
        const r = res && res[0]
        if (!r || !r.width || !r.height) {
          // 目标暂时测不到（布局未就绪等）→ 短暂重试，避免整轮被跳过
          if (tryCount < 3) return setTimeout(() => measure(tryCount + 1, scrolled), 150)
          return next(page)
        }
        const visible = r.top >= 0 && r.bottom <= winH
        if (!scrolled && tip.scroll !== false && !visible && winH > 0) {
          // 目标在视口外：瞬时定位（不滑动），定位完成后再显示气泡
          wx.pageScrollTo({
            selector: tip.selector,
            duration: 0,
            success: () => setTimeout(() => measure(tryCount + 1, true), 120),
            fail: () => show(r, i)
          })
          return
        }
        show(r, i)
      })
  }
  if (hooks.beforeStep) hooks.beforeStep(i, tip, measure)
  else measure()
}

function next(page) {
  const tips = page.data.guideTips || []
  const i = page.data.guideIndex
  const tip = tips[i]
  const hooks = page.guideHooks || {}
  if (i >= tips.length - 1) return finish(page)
  const after = () => step(page, i + 1)
  if (hooks.afterNext) hooks.afterNext(i, tip, after)
  else after()
}

function skip(page) {
  // 用户主动跳过：无论是否展示过都记为已看
  if (page.guidePageKey) markSeen(page.guidePageKey)
  page.setData({ guideShow: false })
}

function finish(page) {
  // 至少展示过一条才算看完；整轮都没展示（如目标始终不可测）不标记，下次进入重试
  if (page.guidePageKey && (page.guideShownCount || 0) > 0) markSeen(page.guidePageKey)
  page.setData({ guideShow: false })
}

module.exports = { TIPS, tipsFor, isSeen, markSeen, computeBubble, start, step, next, skip, finish }