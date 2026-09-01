// 新手引导气泡组件：遮罩变暗 + 目标高亮光圈 + 锚定气泡 + 右下角跳过
// 由页面通过 utils/guide.js 的 start/step 驱动，逐条传入当前锚点矩形
const guide = require('../../utils/guide.js')

Component({
  properties: {
    show: { type: Boolean, value: false },
    tips: { type: Array, value: [] },
    index: { type: Number, value: 0 },
    anchor: { type: Object, value: null },
    interactive: { type: Boolean, value: false }
  },
  data: {
    leaving: false,
    entered: false,
    pos: null,
    viewport: { width: 375, height: 667 },
    bubbleW: 260,
    bubbleH: 120
  },
  observers: {
    show(v) {
      if (v) {
        this._stepIndex = null
        this.setData({ leaving: false })
        this.layout()
      } else {
        this.setData({ leaving: true })
        setTimeout(() => {
          if (!this.data.show) this.setData({ leaving: false })
        }, 140)
      }
    },
    'index, anchor'(i, anchor) {
      if (!this.data.show) return
      if (anchor && anchor.width) {
        if (i !== this._stepIndex) {
          this._stepIndex = i
          this.layout()
        } else {
          this.reposition()
        }
      } else {
        this.setData({ pos: null, entered: false }) // 切换步骤时先隐藏气泡
      }
    }
  },
  methods: {
    layout() {
      const anchor = this.data.anchor
      if (!anchor || !anchor.width) {
        this.setData({ pos: null, entered: false })
        return
      }
      let info = {}
      try {
        info = wx.getSystemInfoSync() || {}
      } catch (err) {
        info = {}
      }
      const winW = info.windowWidth || 375
      const winH = info.windowHeight || 667
      const rpx = winW / 750
      const bubbleW = Math.min(520 * rpx, winW - 32)
      const bubbleH = 200 * rpx // 先按两行估算，测量完成前保持隐藏，避免位置跳动
      const pos = guide.computeBubble(anchor, { width: winW, height: winH }, { width: bubbleW, height: bubbleH })
      this.setData({ pos, viewport: { width: winW, height: winH }, bubbleW, bubbleH, entered: false }, () => {
        setTimeout(() => this.measureBubble(), 120)
        // 兜底：测量失败也要显示，避免气泡永久隐藏
        setTimeout(() => {
          if (!this.data.entered && this.data.pos) this.setData({ entered: true })
        }, 280)
      })
    },
    reposition() {
      const anchor = this.data.anchor
      if (!anchor || !anchor.width) return
      const pos = guide.computeBubble(anchor, this.data.viewport, { width: this.data.bubbleW, height: this.data.bubbleH })
      this.setData({ pos })
    },
    measureBubble() {
      this.createSelectorQuery()
        .select('.gt-bubble')
        .boundingClientRect()
        .exec((res) => {
          const r = res && res[0]
          const anchor = this.data.anchor
          if (!r || !r.height || !anchor) {
            if (this.data.pos) this.setData({ entered: true })
            return
          }
          const patch = { entered: true }
          if (Math.abs(r.height - this.data.bubbleH) > 4) {
            const pos = guide.computeBubble(anchor, this.data.viewport, { width: this.data.bubbleW, height: r.height })
            patch.pos = pos
            patch.bubbleH = r.height
          }
          this.setData(patch)
        })
    },
    onNext() {
      this.triggerEvent('next')
    },
    onSkip() {
      this.triggerEvent('skip')
    },
    onAnchorTap() {
      if (this.data.interactive) this.triggerEvent('anchor-tap')
    },
    noop() {}
  }
})