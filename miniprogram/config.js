/**
 * 小程序配置文件
 */

const host = '14592619.qcloud.la'

const config = {
  // 测试的请求地址，用于测试会话
  requestUrl: 'https://mp.weixin.qq.com',
  host,

  // 云开发环境 ID
  envId: 'release-b86096',
  // envId: 'test-f0b102',

  // 云开发-存储 示例文件的文件 ID
  demoImageFileId: 'cloud://release-b86096.7265-release-b86096-1258211818/demo.jpg',
  demoVideoFileId: 'cloud://release-b86096.7265-release-b86096/demo.mp4',

  // AI 优化图纸后端：'local' = 本地代理服务（tools/ai-optimize-server.js，读取根目录 .env）；
  // 'cloud' = 云函数 ai-optimize-pattern
  aiOptimize: {
    backend: 'local',
    localUrl: 'http://127.0.0.1:8787'
  },
}

module.exports = config
