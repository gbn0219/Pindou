/**
 * 小程序配置文件
 */

const host = '14592619.qcloud.la'

const config = {
  // 测试的请求地址，用于测试请求
  requestUrl: 'https://mp.weixin.qq.com',
  host,

  // 云开发环境 ID
  envId: 'release-b86096',
  // envId: 'test-f0b102',

  // 云开发 存储 示例文件的文件 ID
  demoImageFileId: 'cloud://release-b86096.7265-release-b86096-1258211818/demo.jpg',
  demoVideoFileId: 'cloud://release-b86096.7265-release-b86096/demo.mp4',

  // AI 生成图纸后端：'local' = 本地代理服务（tools/ai-generate-server.js，读取根目录 .env）；
  // 'cloud' = 云函数 ai-generate-pattern
  aiGenerate: {
    backend: 'cloud',
    // 开发者工具模拟器可用 http://127.0.0.1:8787；
    // 真机调试时必须改成电脑的局域网 IP（手机与电脑需在同一 Wi-Fi），
    // 运行 node tools/ai-generate-server.js 时启动日志会打印当前可用 IP。
    localUrl: 'http://10.210.135.185:8787'
  },
}

module.exports = config