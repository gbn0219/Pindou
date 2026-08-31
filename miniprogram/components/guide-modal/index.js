// miniprogram/components/guide-modal/index.js
// 功能引导弹窗：六大功能卡片 + 联动流程图（首启 / 个人中心「使用指南」共用）
Component({
  properties: {
    show: { type: Boolean, value: false }
  },
  data: {
    leaving: false,
    features: [
      { key: 'photo', title: '照片还原', desc: '导入照片，本地像素化秒出图纸 · 免费离线' },
      { key: 'ai', title: '创意生成', desc: '导入照片，换种风格出图纸，可重新生成、可换风格' },
      { key: 'scan', title: '识别已有图纸', desc: '手上已有图纸？截图上传，识别成可编辑图纸' },
      { key: 'edit', title: '修改图纸', desc: '逐格改色，手动修掉不顺眼的地方' },
      { key: 'beading', title: '智能拼豆板 · 一键跟拼', desc: '全屏照着拼：选中色高亮其余变淡，或按图例逐色点亮进度' },
      { key: 'gallery', title: '图库 · 导出', desc: '图纸自动存档，随时回来拼；也能导出高清图' }
    ]
  },
  observers: {
    show(v) {
      if (v) {
        this.setData({ leaving: false })
      } else {
        this.setData({ leaving: true })
        setTimeout(() => {
          if (!this.data.show) this.setData({ leaving: false })
        }, 140)
      }
    }
  },
  methods: {
    onMask() {
      this.triggerEvent('close')
    },
    onStart() {
      this.triggerEvent('start')
    },
    noop() {}
  }
})
