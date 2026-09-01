// custom-tab-bar/index.js
/**
 * 自定义底部 tabBar：图标 + 文字，高度为原生两倍（200rpx + 安全区）。
 * 选中态颜色与页面主色一致（--color-accent #f6ce00）。
 */
Component({
  data: {
    selected: 0,
    hidden: false,
    color: '#7a8189',
    selectedColor: '#f6ce00',
    list: [
      { pagePath: '/page/index/index', text: '首页', iconPath: '/images/tabbar/home.png', selectedIconPath: '/images/tabbar/home-active.png' },
      { pagePath: '/page/profile/index', text: '个人中心', iconPath: '/images/tabbar/user.png', selectedIconPath: '/images/tabbar/user-active.png' }
    ]
  },
  methods: {
    hide() {
      this.setData({ hidden: true })
    },
    show() {
      this.setData({ hidden: false })
    },
    switchTab(e) {
      const index = Number(e.currentTarget.dataset.index)
      const item = this.data.list[index]
      if (!item || index === this.data.selected) return
      wx.switchTab({ url: item.pagePath })
    }
  }
})
