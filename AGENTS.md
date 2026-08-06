# AGENTS.md

## 项目

拼豆图纸生成微信小程序：用户导入一张图片 →（可选裁剪）→ 选择生成方式 → 像素化并映射到拼豆标准色 → 生成、展示、修改、导出拼豆图纸。

当前包含六个页面（均在主包，无分包；底部为原生 tabBar：首页 / 我的）：

1. 主页面 `miniprogram/page/index/index`（tab）：图片导入、色系选择（48/72/144/221）、拼豆盘大小（52×52 / 78×78 / 104×104）、生成方式（照片还原 / 创意生成）、创意生成风格选择
2. 裁剪页 `miniprogram/page/crop/index`：选图后先裁剪（任意比例方框：拖动框内部移动位置，拖动四边/四角调整大小），完成后返回主页面，最终图纸仍为方形网格
3. 图纸展示页 `miniprogram/page/pattern/index`：canvas 展示图纸（每格显示色号、可双指缩放/拖动）、色号豆子数量清单、导出 PNG 到相册、进入修改；创意生成结果先以"锁定预览"展示（纯色、不可交互），解锁后才进入完整交互
4. 图纸修改页 `miniprogram/page/pattern-edit/index`：canvas 逐格改色，底部"小盒子陈列"取色面板（按 A/B/C/D/E/F/G/H/M 色系分区，仅显示当前套装颜色）
5. 个人中心 `miniprogram/page/profile/index`（tab）：微信登录（云开发 openid）、头像昵称、邀请码（GBNLY99 免费）、图库入口
6. 图库 `miniprogram/page/gallery/index`：原始图片-生成图纸对列表（页码分页、缩略图/预览图压缩、点击图片 cloud:// 直接预览、条目"编辑"进入修改页、"删除"移除条目及关联云存储文件；旧数据缺缩略图/预览图时后台回填）

## 生成方式（核心）

### 方式一：照片还原（默认，免费离线）

选图 → 裁剪页（可选）→ 主页面用 `wx.createOffscreenCanvas` 建 **4N×4N** 中间画布，按 **contain** 方式画入（白底补齐、透明像素按白）→ **`averageBlocks`**：每 4×4 块求平均 RGB 得到 N×N 代表色（不做任何平滑/合并/去噪）→ **`mapRgb`**：CIELAB 最近色匹配，只输出当前套装内色号 → grid。支持 52/78/104 三种盘面。

### 方式二：创意生成（登录 + 每图最多 3 次免费预览，解锁后按次计费，支持 52/78/104）

- 门禁与解锁：仅登录用户可用；每张原图最多 3 次免费预览（服务端 `ai_sessions` 按 `(openid, imageHash)` 计数），未解锁只能看纯色图（不可查看色号/缩放/修改/导出）；付费（`PAY_MODE=mock`）或邀请码 `GBNLY99` 解锁后进入完整交互，并在解锁/导出时自动入库图库

选图 → 裁剪页（可选）→ 主页面选 AI 生成 + 风格 → 原图压缩为 ~768px JPEG base64 → 调用后端（`config.aiGenerate.backend`）：

- `local`：`tools/ai-generate-server.js`（读取根目录 `.env` 的 `ARK_API_KEY`，开发者工具需勾选"不校验合法域名"；真机调试时把 `config.aiGenerate.localUrl` 改为电脑局域网 IP——服务启动日志会打印可用 IP，手机与电脑需同一 Wi-Fi、防火墙放行 8787、用"真机调试"模式打开；若报 ERR_ADDRESS_UNREACHABLE 说明不在同一局域网（公司/校园网常见 AP 隔离），改用手机热点：手机开热点 → 电脑连热点 → 按启动日志的新 IP 更新 localUrl）
- `cloud`：云函数 `ai-generate-pattern`（**图像方案，与本地服务同步**；部署时需配置 `ARK_API_KEY`、控制台调大超时到 60s，部署目录含 ref-pack.jpg / realistic-ref.jpg / face-ref.jpg）

后端以**图像生成方案**调用火山方舟 OpenAI 兼容接口（默认模型 `doubao-seedream-5-0-260128`，`ARK_MODEL` 可覆盖）：
- 请求 `POST https://ark.cn-beijing.volces.com/api/v3/images/generations`，多图输入：原图（base64）+ 一张参考拼图（两张「原图转像素图」示例，见 `tools/style-refs/ref-pack.jpg`，作为第二张参考图）+ 一张五官画法示例拼图（5 张拼豆像素画人脸合成，见 `tools/face-refs/face-ref.jpg`，作为第三张参考图；仅用于学习五官画法，提示词明确禁止复制示例角色/内容），`size` 统一取 `2K`（约 2048×2048，前端按盘面 floor 分块，不依赖每格 16px），`watermark: false`（默认会加"AI生成"水印）；
- 输出对应尺寸的像素风格图纸 PNG（URL 24h 有效，服务端立即下载并转 base64 返回）；
- 前端把图片写入临时文件 → offscreen canvas 读整幅像素 → **主色分块**（`dominantBlockRgb`，每块取占比最高的颜色，抗 AI 自带的网格线/辅助线）→ CIELAB 最近色映射到当前套装色号 → 生成 grid；
- **不输出文字色号**（2704 个色号一次输出会被 token 截断，分块生成又导致块间风格不统一），彻底绕开输出 token 上限；
- 本地服务采用“提交任务 + 轮询”：`POST /ai-generate` 立即返回 taskId，客户端每 3s 轮询 `GET /ai-generate/status?taskId=xx`（wx.request 单次最长 60s，生成可能超时），最长等待 5 分钟。


**风格**：前端内置 5 个示例（卡通、马卡龙、扁平插画、复古像素、水彩），用户也可在输入框填写自定义风格关键词；输入框留空用所选示例，填写后以自定义为准。两张「原图转像素图」示例合成为一张参考拼图（`tools/style-refs/ref-pack.jpg`），5 张拼豆像素画人脸合成为一张五官画法示例拼图（`tools/face-refs/face-ref.jpg`），两者每次 AI 生成固定随请求发送、前端无需选择；另有「抠出人物（背景变白）」开关。提示词对构图、五官（眼睛/眉毛/鼻子/嘴巴/腮红）、头发、衣服、皮肤（肤色锁定 G1：RGB 255,228,211，禁止深棕/深灰皮肤与深色阴影）、描边、配色、背景均有明确要求，并按示例的转换思路生成。AI 生成支持 52/78/104 三种盘面。

**AI 优化图纸功能已移除**（原展示页入口、`tools/ai-optimize-server.js`、云函数 `ai-optimize-pattern` 均不再保留）。

## 技术栈与目录

微信小程序原生（JS + WXML + WXSS，不使用 TS）。**无任何第三方 npm 依赖**（官方模板自带的 demo 页面、分包、tabBar、weui、npm 包已移除；如需找回，见 git 历史）。

```
miniprogram/
  app.json                    页面注册（4 页）
  page/index/                 主页面（生成方式/风格选择）
  page/crop/                  裁剪页
  page/pattern/               展示页
  page/pattern-edit/          修改页
  utils/color.js              sRGB→CIELAB、最近色匹配、按套装构建调色板（纯函数，node 可测）
  utils/pattern.js            网格映射/计数/canvas 绘制 + 照片还原采样（averageBlocks / mapRgb / countColors / renderGrid / serializeGrid / parseGrid，node 可测）
  utils/export.js            图纸资产生成（整图导出 ×EXPORT_UPSCALE 放大 / 网格缩略图 / 原图方形压缩，小程序环境可用）
  utils/ai.js                 AI 生成前端：原图压缩、调用后端（local/cloud）、读 AI 图纸像素映射色号（imageToGrid / imageDataToGrid / dominantBlockRgb，node 可测）
  utils/image.js              图片加载工具（唯一临时路径绕过 iOS createImage 缓存，带超时+重试）
  data/colors.json            色卡数据源（由脚本生成，勿手改）
  data/colors.js              运行时数据模块（与 colors.json 同源；小程序 require JSON 不可靠，运行时统一加载 .js）
  styles/tokens.wxss          Hum 设计令牌（色彩/字号/间距/动效，各页面 @import）
scripts/build-colors.js       解析 docs/拼豆标准色彩RGB与拼豆盘尺寸.md → 生成 data/colors.json 与 data/colors.js
tools/ai-generate-server.js   本地 AI 生成代理服务（开发用，读取根目录 .env，默认端口 8787）
tools/style-refs/             原图转像素图示例源图 + 合成参考拼图 ref-pack.jpg（服务端固定随请求发送）
tools/face-refs/              五官画法示例源图 + 合成拼图 face-ref.jpg（服务端固定随请求发送，仅作五官画法参考）
tools/convert-examples/        原图转像素图示例源图（合成进 ref-pack.jpg）
tests/                        无框架 node 单测（断言失败即非 0 退出）
cloudfunctions/ai-generate-pattern/  AI 生成云函数（cloud 模式，登录 + 每图 3 次配额校验）
cloudfunctions/account/             用户中心云函数（登录/资料/邀请码）
cloudfunctions/access/              访问控制云函数（配额/解锁/订单，PAY_MODE=mock）
cloudfunctions/gallery/             图库云函数（入库/页码分页列表/单条详情 get/记录更新 update/删除 delete）
cloudfunctions/               其余为官方模板遗留云函数（本项目未使用）
docs/superpowers/             设计文档与实施计划（历史过程文档，保留备查）
```

## 数据与算法约定

- 默认色卡：MARD 221 色，RGB 以 docs 第 3 节主表为准；48/72/144 为 221 的套装子集（`data/colors.json` 的 `sets` 字段只表达成员关系）
- 照片还原管线：选图 → 裁剪页（可选）→ 主页面 `wx.createOffscreenCanvas` 建 **4N×4N** 中间画布，按 **contain** 绘制（白底补齐、透明像素按白）→ **`averageBlocks`**（4×4 块平均 → N×N RGB，透明像素不计入、全透明块按白）→ **`mapRgb`**（CIELAB 最近色匹配，只输出当前套装内色号）。**不做**相似色合并、孤立点平滑、区域合并、抖动等任何后处理
- AI 生成管线：选图 → 裁剪页（可选）→ 主页面选 AI 生成 + 风格（可选抠图；固定携带参考拼图）→ 原图压缩为 ~768px JPEG base64 → 后端（local/cloud）→ 豆包 Seedream（doubao-seedream-5-0-260128，火山方舟 images/generations）图像生成，`size` 统一 `2K`（约 2048×2048）→ 返回图片 base64 → 前端 offscreen canvas 读整幅像素 → `dominantBlockRgb` 主色分块 → `mapRgb` CIELAB 最近色映射到当前套装 → 二维 grid。无文字色号输出，无 token 上限问题
- 风格：5 个内置示例（卡通、马卡龙、扁平插画、复古像素、水彩），支持用户输入自定义风格关键词；自定义输入优先于示例
- **AI 优化图纸：已移除**，不再保留任何入口与后端
- 图纸数据流：主页面生成后存入 `getApp().globalData.pattern = { grid, size, set, imagePath, mode, style }`（`mode: 'photo' | 'ai'`，`style` 为展示用风格名/自定义文本），展示/修改页共享，不持久化
- 创意生成会话：`getApp().globalData.aiSession = { sessionId, imageHash, candidates, index, params }`（每张原图最多 3 个候选，仅内存）
- 用户与图库：登录后 `globalData.user` 缓存（`wx.setStorageSync`）；云数据库集合 `users` / `ai_sessions` / `gallery` / `orders`，云存储路径 `gallery/<openid>/`、`avatars/<openid>/`；`gallery` 记录含 `grid`（行优先逗号色号串，`serializeGrid`/`parseGrid` 序列化），列表接口用字段投影排除 `grid`、编辑时按需 `get`，编辑保存/缩略图回填走 `update`
- `grid` 为二维数组：`grid[row][col] = 色号`（如 "A1"）

## 前端要点（canvas 相关，改动前先理解）

- 展示页与修改页的 canvas 位于 `movable-area > movable-view(scale)` 内，用于缩放/拖动查看 52~104 格的大图纸
- **必须**同时给 movable-view 和 canvas 设置显式 CSS 宽高（数据字段 `canvasPx`），否则画布会缩在左上角；初始缩放 `initScale` 与位移 `viewX/viewY` 由页面 JS 测量展示区后计算（铺满并居中），见两个页面各自的 `drawPattern()` / `draw()`
- 修改页触摸定位：`col = floor(touch.x / this.data.scale / (CELL+GAP))`，`scale` 初始等于 `initScale`，双指缩放由 `bindscale` 更新；真机坐标换算若有偏差以真机实测为准；轻点判定：touchstart→touchend 位移 ≤16px 且耗时 ≤400ms 才视为点格涂色，拖拽移动不触发涂色
- 编号显示：展示/修改页默认铺满视图**隐藏编号**（纯色图预览清晰）；放大到每格 ≥13.6px（scale ≥0.65）自动显示编号；导出图固定带编号
- 导出：画布按 `layoutExport` 布局且不超过 `EXPORT_MAX_DIM=2048`（规避部分设备画布上限），输出经 `canvasToTempFilePath` 的 `destWidth/destHeight` ×`EXPORT_UPSCALE=2` 放大（104 盘约 3900px，纯色块颜色保持精确）；导出与图库缩略图/预览图统一走 `utils/export.js`
- 修改页绘制带"节点未就绪/尺寸为 0 自动重试"（最多 8 次，120ms 间隔）；movable-view 关闭位置动画（`animation="{{false}}"`）且不使用 `out-of-bounds`，避免初始定位把画布带出视野；改动渲染逻辑时保持该兜底

## 验证

- 运行单测：`node tests/color.test.js && node tests/pattern.test.js && node tests/ai.test.js && node tests/user.test.js`
- 新增/修改 JS 一律执行 `node --check <file>`；JSON 用 `node -e "JSON.parse(...)"` 校验
- 微信开发者工具安装在 `D:\Tencent\Winxin_develop`（`cli.bat open --project D:\Code\Weixin\Pindou` 可打开项目），修改代码后在开发者工具点"编译"，在模拟器验证各页面
- 本机有 `claude-vision-skill`（千问识图），开发中可截图并用 `node vision.js <图片路径> "描述..."` 辅助检查模拟器效果
- AI 生成本地模式：项目根目录 `.env` 填写 `ARK_API_KEY`（火山方舟 API Key，已有 `.env.example`），运行 `node tools/ai-generate-server.js`，开发者工具勾选"不校验合法域名"
- 云函数改动需在开发者工具中右键"上传并部署（云端安装依赖）"
- 云函数 `ai-generate-pattern`（cloud 模式）需配置环境变量：`ARK_API_KEY`（必填）、`ARK_MODEL`（可选，默认 `doubao-seedream-5-0-260128`）；在开发者工具云函数面板或云开发控制台"云函数 → 配置 → 环境变量"中设置（云函数与本地服务同为 Seedream 图像方案；部署目录含 ref-pack.jpg 与 face-ref.jpg；云函数超时建议在控制台调大到 60s）

## 工作准则

### 1. 先思考再写码
- 明确假设再动手；不确定就问；存在多个合理解释时列出来，不要默默选一个
- 有更简单的做法就直接说，必要时提出反对意见

### 2. 简单优先
- 只写解决问题所需的最少代码；不做投机性抽象、不做未被要求的"灵活性/可配置性"
- 能压缩到更短就重写，避免过度设计

### 3. 外科手术式修改
- 只改必须改的地方，不顺手"优化"无关代码或格式
- 匹配现有代码风格（JS + WXML + WXSS，不使用 TS）
- 自己改出来的孤儿代码要清理；既有死代码只提不删
- 每一行改动都应能追溯到用户请求

### 4. 目标驱动执行
- 把任务转成可验证目标，例如"加校验"→"写无效输入用例并跑通"
- 多步任务先给简短计划：步骤 → 验证方式
- 小程序以"微信开发者工具编译通过、页面可交互"为验证标准