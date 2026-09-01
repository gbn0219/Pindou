// tests/guide.test.js — 新手引导纯逻辑测试。运行: node tests/guide.test.js
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const guide = require('../miniprogram/utils/guide.js')

// ---- computeBubble 定位 ----
{
  const viewport = { width: 375, height: 667 }
  const bubble = { width: 240, height: 120 }
  const pos = guide.computeBubble({ left: 60, top: 100, width: 100, height: 50 }, viewport, bubble)
  assert.strictEqual(pos.placement, 'bottom', '下方空间充足时气泡在锚点下方')
  assert.strictEqual(pos.top, 160, 'top = 锚点底 + 间距')
  const pos2 = guide.computeBubble({ left: 60, top: 600, width: 100, height: 50 }, viewport, bubble)
  assert.strictEqual(pos2.placement, 'top', '下方放不下时翻到上方')
  assert.strictEqual(pos2.top, 470, 'top = 锚点上 - 间距 - 气泡高')
  const pos3 = guide.computeBubble({ left: -200, top: 100, width: 100, height: 50 }, viewport, bubble)
  assert.ok(pos3.left >= 12, '水平左侧钳制')
  const pos4 = guide.computeBubble({ left: 500, top: 100, width: 100, height: 50 }, viewport, bubble)
  assert.ok(pos4.left + 240 <= 375 - 12, '水平右侧钳制')
  assert.ok(pos.arrowLeft >= 14 && pos.arrowLeft <= 240 - 28, '箭头水平钳制在气泡内')
}

// ---- 已读记忆 ----
{
  const store = {}
  const storage = { get: (k) => store[k], set: (k, v) => { store[k] = v } }
  assert.strictEqual(guide.isSeen('index', storage), false, '初始未看过')
  guide.markSeen('index', storage)
  assert.strictEqual(guide.isSeen('index', storage), true, '看完后不再出现')
  assert.strictEqual(guide.isSeen('pattern', storage), false, '不同页面互不影响')
}

// ---- 提示配置：字段完整、选择器存在于页面 WXML ----
{
  const PAGE_WXML = {
    index: 'miniprogram/page/index/index.wxml',
    scan: 'miniprogram/page/scan/index.wxml',
    pattern: 'miniprogram/page/pattern/index.wxml',
    patternEdit: 'miniprogram/page/pattern-edit/index.wxml',
    gallery: 'miniprogram/page/gallery/index.wxml',
    profile: 'miniprogram/page/profile/index.wxml'
  }
  const wxmlCache = {}
  const getWxml = (file) => {
    if (!wxmlCache[file]) wxmlCache[file] = fs.readFileSync(path.join(__dirname, '..', file), 'utf-8')
    return wxmlCache[file]
  }
  for (const key of Object.keys(guide.TIPS)) {
    const tips = guide.TIPS[key]
    assert.ok(tips.length >= 1, key + ' 至少一条提示')
    assert.ok(tips.length <= 6, key + ' 提示不超过 6 条')
    const seen = {}
    for (const tip of tips) {
      assert.ok(tip.key, key + ' 提示需要 key')
      assert.ok(!seen[tip.key], key + ' 提示 key 重复: ' + tip.key)
      seen[tip.key] = true
      assert.ok(tip.text && tip.text.length > 0, key + '/' + tip.key + ' 需要文案')
      assert.ok(tip.selector && tip.selector.indexOf('.') === 0, key + '/' + tip.key + ' selector 应为类名')
    }
  }
  for (const key of Object.keys(PAGE_WXML)) {
    const wxml = getWxml(PAGE_WXML[key])
    for (const tip of guide.TIPS[key]) {
      assert.ok(wxml.indexOf(tip.selector.slice(1)) >= 0, key + '/' + tip.key + ' 选择器 ' + tip.selector + ' 不在页面 WXML 中')
    }
  }
  // 全屏拼豆提示目标在 pattern 与 pattern-edit 两页都存在
  for (const tip of guide.TIPS.beading) {
    assert.ok(getWxml(PAGE_WXML.pattern).indexOf(tip.selector.slice(1)) >= 0, 'beading/' + tip.key + ' 选择器不在 pattern 页')
    assert.ok(getWxml(PAGE_WXML.patternEdit).indexOf(tip.selector.slice(1)) >= 0, 'beading/' + tip.key + ' 选择器不在 pattern-edit 页')
  }
}



// ---- 完成/跳过语义：整轮未展示不标记已看，跳过始终标记 ----
{
  const store = {}
  global.wx = {
    getStorageSync: (k) => store[k],
    setStorageSync: (k, v) => { store[k] = v }
  }
  const makePage = () => ({
    data: { guideShow: true, guideTips: guide.TIPS.beading, guideIndex: 0, guideAnchor: null, guideInteractive: false },
    guidePageKey: 'beading',
    guideShownCount: 0,
    guideHooks: {},
    setData(patch) { Object.assign(this.data, patch) }
  })
  const p1 = makePage()
  guide.finish(p1)
  assert.strictEqual(store['guideTipsSeen_beading'], undefined, '整轮未展示不标记已看')
  const p2 = makePage()
  p2.guideShownCount = 2
  guide.finish(p2)
  assert.strictEqual(store['guideTipsSeen_beading'], true, '展示过则看完标记已看')
  const p3 = makePage()
  guide.skip(p3)
  assert.strictEqual(store['guideTipsSeen_beading'], true, '跳过始终标记已看')
  delete global.wx
}

console.log('guide.test.js 全部通过 ✓')