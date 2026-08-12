const config = require('./config')
const themeListeners = []
global.isDemo = true
App({
  
  onLaunch(opts, data) {
    // const that = this;
    // const canIUseSetBackgroundFetchToken = wx.canIUse('setBackgroundFetchToken')
    // if (canIUseSetBackgroundFetchToken) {
    //   wx.setBackgroundFetchToken({
    //     token: 'getBackgroundFetchToken',
    //   })
    // }
    // if (wx.getBackgroundFetchData) {
    //   wx.getBackgroundFetchData({
    //     fetchType: 'pre',
    //     success(res) {
    //       that.globalData.backgroundFetchData  = res;
    //       console.log('读取预拉取数据成功')
    //     },
    //     fail() {
    //       console.log('读取预拉取数据失败')
    //       wx.showToast({
    //         title: '无缓存数据',
    //         icon: 'none'
    //       })
    //     },
    //     complete() {
    //       console.log('结束读取')
    //     }
    //   })
    // }
    console.log('App Launch', opts)
    if (data && data.path) {
      wx.navigateTo({
        url: data.path,
      })
    }
    if (!wx.cloud) {
      console.error('请使用 2.2.3 或以上的基础库以使用云能力')
    } else {
      wx.cloud.init({
        env: config.envId,
        traceUser: true,
      })
    }
    this.restoreLogin()
  },

  
  onShow(opts) {
    console.log('App Show', opts)
    // console.log(wx.getSystemInfoSync())
  },
  onHide() {
    console.log('App Hide')
  },
  onThemeChange({ theme }) {
    this.globalData.theme = theme
    themeListeners.forEach((listener) => {
        listener(theme)
    })
  },
  watchThemeChange(listener) {
      if (themeListeners.indexOf(listener) < 0) {
          themeListeners.push(listener)
      }
  },
  unWatchThemeChange(listener) {
      const index = themeListeners.indexOf(listener)
      if (index > -1) {
          themeListeners.splice(index, 1)
      }
  },
  globalData: {
    theme: wx.getSystemInfoSync().theme,
    hasLogin: false,
    openid: null,
    user: null,
    loggedOut: false,
    iconTabbar: '/page/weui/example/images/icon_tabbar.png',
  },
  // lazy loading openid
  getUserOpenId(callback) {
    const self = this

    if (self.globalData.openid) {
      callback(null, self.globalData.openid)
    } else {
      wx.login({
        success(data) {
          wx.cloud.callFunction({
            name: 'login',
            data: {
              action: 'openid'
            },
            success: res => {
              console.log('拉取openid成功', res)
              self.globalData.openid = res.result.openid
              callback(null, self.globalData.openid)
            },
            fail: err => {
              console.log('拉取用户openid失败，将无法正常使用开放接口等服务', res)
              callback(res)
            }
          })
        },
        fail(err) {
          console.log('wx.login 接口调用失败，将无法正常使用开放接口等服务', err)
          callback(err)
        }
      })
    }
  },
  // 通过云函数获取用户 openid，支持回调或 Promise
  getUserOpenIdViaCloud() {
    return wx.cloud.callFunction({
      name: 'wxContext',
      data: {}
    }).then(res => {
      this.globalData.openid = res.result.openid
      return res.result.openid
    })
  },
  restoreLogin() {
    const loggedOut = wx.getStorageSync('loggedOut')
    if (loggedOut) {
      // 用户主动退出登录：保持未登录，等待用户点“微信一键登录”再登录
      this.globalData.loggedOut = true
      this.globalData.user = null
      return
    }
    const user = wx.getStorageSync('user')
    if (user && (user.openid || user._openid)) {
      if (!user.openid && user._openid) user.openid = user._openid
      this.globalData.user = user
    }
  },
  ensureLogin() {
    if (this.globalData.loggedOut) {
      return Promise.reject(new Error('已退出登录'))
    }
    if (this.globalData.user && (this.globalData.user.openid || this.globalData.user._openid)) {
      return Promise.resolve(this.globalData.user)
    }
    const userApi = require('./utils/user.js')
    return userApi.login().then((r) => {
      const u = r.user
      if (!u.openid && u._openid) u.openid = u._openid
      this.globalData.user = u
      wx.setStorageSync('user', u)
      return u
    })
  }
})
