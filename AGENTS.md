# AGENTS.md

## 项目

拼豆图纸生成微信小程序：用户导入一张图片 →（可选裁剪）→ 选择生成方式 → 像素化并映射到拼豆标准色 → 生成、展示、修改、导出拼豆图纸。

当前包含四个页面（均在主包，无分包、无 tabBar）：

1. 主页面 `miniprogram/page/index/index`：图片导入、色系选择（48/72/144/221）、拼豆盘大小（52×52 / 78×78 / 104×104）、生成方式（照片还原 / AI 生成）、AI 风格选择
2. 裁剪页 `miniprogram/page/crop/index`：选图后先裁剪（任意比例方框：拖动框内部移动位置，拖动四边/四角调整大小），完成后返回主页面，最终图纸仍为方形网格
3. 图纸展示页 `miniprogram/page/pattern/index`：canvas 展示图纸（每格显示色号、可双指缩放/拖动）、色号豆子数量清单、导出 PNG 到相册、进入修改
4. 图纸修改页 `miniprogram/page/pattern-edit/index`：canvas 逐格改色，底部"小盒子陈列"取色面板（按 A/B/C/D/E/F/G/H/M 色系分区，仅显示当前套装颜色）

## 生成方式（核心）

### 方式一：照片还原（默认，免费离线）

选图 → 裁剪页（可选）→ 主页面用 `wx.createOffscreenCanvas` 建 **4N×4N** 中间画布，按 **contain** 方式画入（白底补齐、透明像素按白）→ **`averageBlocks`**：每 4×4 块求平均 RGB 得到 N×N 代表色（不做任何平滑/合并/去噪）→ **`mapRgb`**：CIELAB 最近色匹配，只输出当前套装内色号 → grid。支持 52/78/104 三种盘面。

### 方式二：AI 生成（按次计费，仅 52×52）

选图 → 裁剪页（可选）→ 主页面选 AI 生成 + 风格 → 原图压缩为 ~768px JPEG base64 → 调用后端（`config.aiGenerate.backend`）：

- `local`：`tools/ai-generate-server.js`（读取根目录 `.env` 的 `DASHSCOPE_API_KEY`，开发者工具需勾选"不校验合法域名"；真机调试时把 `config.aiGenerate.localUrl` 改为电脑局域网 IP——服务启动日志会打印可用 IP，手机与电脑需同一 Wi-Fi、防火墙放行 8787、用"真机调试"模式打开）
- `cloud`：云函数 `ai-generate-pattern`

后端以 **OpenAI 兼容接口**（`/compatible-mode/v1/chat/completions`）调用多模态模型（默认 `qwen3-vl-plus`，`DASHSCOPE_MODEL` 可覆盖）：

- system 消息携带**完整色表**（色号 + hex + RGB）、**风格定义**与**输出规则**；
- `tools` 定义 `submit_pixel_pattern`，用 JSON schema 严格约束 `style / board_size=52 / color_set / grid`（grid 必须恰好 2704 个色号、行优先、全部来自色表）；
- `tool_choice` 强制模型调用该函数，模型响应中的 `function.arguments` 即 JSON（如 `{"grid":["A1","A4",...]}`）；
- 后端解析并校验（数量、色号合法性）后返回 JSON grid；前端渲染前再次校验。

**风格**：前端内置 5 个示例（卡通、马卡龙、扁平插画、复古像素、水彩），用户也可在输入框填写自定义风格关键词；输入框留空用所选示例，填写后以自定义为准。AI 生成仅支持 52×52，78/104 在 AI 模式下禁用。

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
  utils/pattern.js            网格映射/计数/canvas 绘制 + 照片还原采样（averageBlocks / mapRgb / countColors / renderGrid，node 可测）
  utils/ai.js                 AI 生成前端：原图压缩、调用后端（local/cloud）、grid 校验（node 可测）
  utils/image.js              图片加载工具（唯一临时路径绕过 iOS createImage 缓存，带超时+重试）
  data/colors.json            色卡数据源（由脚本生成，勿手改）
  data/colors.js              运行时数据模块（与 colors.json 同源；小程序 require JSON 不可靠，运行时统一加载 .js）
  styles/tokens.wxss          Hum 设计令牌（色彩/字号/间距/动效，各页面 @import）
scripts/build-colors.js       解析 docs/拼豆标准色彩RGB与拼豆盘尺寸.md → 生成 data/colors.json 与 data/colors.js
tools/ai-generate-server.js   本地 AI 生成代理服务（开发用，读取根目录 .env，默认端口 8787）
tests/                        无框架 node 单测（断言失败即非 0 退出）
cloudfunctions/ai-generate-pattern/  AI 生成云函数（cloud 模式）
cloudfunctions/               其余为官方模板遗留云函数（本项目未使用）
docs/superpowers/             设计文档与实施计划（历史过程文档，保留备查）
```

## 数据与算法约定

- 默认色卡：MARD 221 色，RGB 以 docs 第 3 节主表为准；48/72/144 为 221 的套装子集（`data/colors.json` 的 `sets` 字段只表达成员关系）
- 照片还原管线：选图 → 裁剪页（可选）→ 主页面 `wx.createOffscreenCanvas` 建 **4N×4N** 中间画布，按 **contain** 绘制（白底补齐、透明像素按白）→ **`averageBlocks`**（4×4 块平均 → N×N RGB，透明像素不计入、全透明块按白）→ **`mapRgb`**（CIELAB 最近色匹配，只输出当前套装内色号）。**不做**相似色合并、孤立点平滑、区域合并、抖动等任何后处理
- AI 生成管线：选图 → 裁剪页（可选）→ 主页面选 AI 生成 + 风格 → 原图压缩为 ~768px JPEG base64 → 后端（local/cloud）→ qwen3-vl-plus（多模态 + function call，system 带完整色表与输出规则，`submit_pixel_pattern` 的 JSON schema 约束 style/board_size/color_set/grid）→ 后端校验（grid 长度 = N×N、色号全部来自当前套装）→ 返回 JSON → 前端再次校验后渲染
- 风格：5 个内置示例（卡通、马卡龙、扁平插画、复古像素、水彩），支持用户输入自定义风格关键词；自定义输入优先于示例
- **AI 优化图纸：已移除**，不再保留任何入口与后端
- 图纸数据流：主页面生成后存入 `getApp().globalData.pattern = { grid, size, set, imagePath, mode, style }`（`mode: 'photo' | 'ai'`，`style` 为展示用风格名/自定义文本），展示/修改页共享，不持久化
- `grid` 为二维数组：`grid[row][col] = 色号`（如 "A1"）

## 前端要点（canvas 相关，改动前先理解）

- 展示页与修改页的 canvas 位于 `movable-area > movable-view(scale)` 内，用于缩放/拖动查看 52~104 格的大图纸
- **必须**同时给 movable-view 和 canvas 设置显式 CSS 宽高（数据字段 `canvasPx`），否则画布会缩在左上角；初始缩放 `initScale` 与位移 `viewX/viewY` 由页面 JS 测量展示区后计算（铺满并居中），见两个页面各自的 `drawPattern()` / `draw()`
- 修改页触摸定位：`col = floor(touch.x / this.data.scale / (CELL+GAP))`，`scale` 初始等于 `initScale`，双指缩放由 `bindscale` 更新；真机坐标换算若有偏差以真机实测为准
- 编号显示：展示/修改页默认铺满视图**隐藏编号**（纯色图预览清晰）；放大到每格 ≥13.6px（scale ≥0.65）自动显示编号；导出图固定带编号
- 导出：临时把 canvas 分辨率切成 `EXPORT_CELL=16`（104 格 → 1767px，规避部分设备 2048px 画布上限），导出后恢复展示分辨率
- 修改页绘制带"节点未就绪/尺寸为 0 自动重试"（最多 8 次，120ms 间隔）；movable-view 关闭位置动画（`animation="{{false}}"`）且不使用 `out-of-bounds`，避免初始定位把画布带出视野；改动渲染逻辑时保持该兜底

## 验证

- 运行单测：`node tests/color.test.js && node tests/pattern.test.js && node tests/ai.test.js`
- 新增/修改 JS 一律执行 `node --check <file>`；JSON 用 `node -e "JSON.parse(...)"` 校验
- 微信开发者工具安装在 `D:\Tencent\Winxin_develop`（`cli.bat open --project D:\Code\Weixin\Pindou` 可打开项目），修改代码后在开发者工具点"编译"，在模拟器验证三个页面
- 本机有 `claude-vision-skill`（千问识图），开发中可截图并用 `node vision.js <图片路径> "描述..."` 辅助检查模拟器效果
- AI 生成本地模式：项目根目录 `.env` 填写 `DASHSCOPE_API_KEY`（已有 `.env.example`），运行 `node tools/ai-generate-server.js`，开发者工具勾选"不校验合法域名"
- 云函数改动需在开发者工具中右键"上传并部署（云端安装依赖）"
- 云函数 `ai-generate-pattern`（cloud 模式）需配置环境变量：`DASHSCOPE_API_KEY`（必填）、`DASHSCOPE_MODEL`（可选，默认 `qwen3-vl-plus`）；在开发者工具云函数面板或云开发控制台"云函数 → 配置 → 环境变量"中设置

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