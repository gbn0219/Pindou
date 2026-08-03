# AGENTS.md

## 项目

拼豆图纸生成微信小程序：用户导入一张图片 →（可选 AI 卡通化，本期未做）→ 像素化并映射到拼豆标准色 → 生成、展示、修改、导出拼豆图纸。

当前只包含三个页面（均在主包，无分包、无 tabBar）：

1. 主页面 `miniprogram/page/index/index`：图片导入、色系选择（48/72/144/221）、拼豆盘大小（52×52 / 78×78 / 104×104）、生成按钮
2. 图纸展示页 `miniprogram/page/pattern/index`：canvas 展示图纸（每格显示色号、可双指缩放/拖动）、色号豆子数量清单、导出 PNG 到相册、进入修改
3. 图纸修改页 `miniprogram/page/pattern-edit/index`：canvas 逐格改色，底部"小盒子陈列"取色面板（按 A/B/C/D/E/F/G/H/M 色系分区，仅显示当前套装颜色）

## 技术栈与目录

微信小程序原生（JS + WXML + WXSS，不使用 TS）。**无任何第三方 npm 依赖**（官方模板自带的 demo 页面、分包、tabBar、weui、npm 包已移除；如需找回，见 git 历史）。

```
miniprogram/
  app.json                    页面注册（仅 3 页）
  page/index/                 主页面
  page/pattern/               展示页
  page/pattern-edit/          修改页
  utils/color.js              sRGB→CIELAB、最近色匹配、按套装构建调色板（纯函数，node 可测）
  utils/pattern.js            网格映射/计数/canvas 绘制（mapRgbGrid / countColors 纯函数可测）
  data/colors.json            色卡数据源（由脚本生成，勿手改）
  data/colors.js              运行时数据模块（与 colors.json 同源；小程序 require JSON 不可靠，运行时统一加载 .js）
  styles/tokens.wxss          Hum 设计令牌（色彩/字号/间距/动效，各页面 @import）
scripts/build-colors.js       解析 docs/拼豆标准色彩RGB与拼豆盘尺寸.md → 生成 data/colors.json 与 data/colors.js
tests/                        无框架 node 单测（断言失败即非 0 退出）
cloudfunctions/               官方模板遗留云函数（本项目未使用；如后续需要云能力再上传部署）
docs/superpowers/             设计文档与实施计划（历史过程文档，保留备查）
```

## 数据与算法约定

- 默认色卡：MARD 221 色，RGB 以 docs 第 3 节主表为准；48/72/144 为 221 的套装子集（`data/colors.json` 的 `sets` 字段只表达成员关系）
- 像素化流程：主页面用 `wx.createOffscreenCanvas` 按 **contain** 方式把图片缩放到 N×N（白底补齐、透明像素按白）→ `getImageData` → **CIELAB 最近色匹配**，只允许输出当前所选套装内的色号；不做抖动
- 图纸数据流：主页面生成后存入 `getApp().globalData.pattern = { grid, size, set, imagePath }`，展示/修改页共享，不持久化
- `grid` 为二维数组：`grid[row][col] = 色号`（如 "A1"）

## 前端要点（canvas 相关，改动前先理解）

- 展示页与修改页的 canvas 位于 `movable-area > movable-view(scale)` 内，用于缩放/拖动查看 52~104 格的大图纸
- **必须**同时给 movable-view 和 canvas 设置显式 CSS 宽高（数据字段 `canvasPx`），否则画布会缩在左上角；初始缩放 `initScale` 与位移 `viewX/viewY` 由页面 JS 测量展示区后计算（铺满并居中），见两个页面各自的 `drawPattern()` / `draw()`
- 修改页触摸定位：`col = floor(touch.x / this.data.scale / (CELL+GAP))`，`scale` 初始等于 `initScale`，双指缩放由 `bindscale` 更新；真机坐标换算若有偏差以真机实测为准
- 导出：临时把 canvas 分辨率切成 `EXPORT_CELL=16`（104 格 → 1767px，规避部分设备 2048px 画布上限），导出后恢复展示分辨率
- 修改页绘制带"节点未就绪自动重试"（onReady/onShow 触发），改动渲染逻辑时保持该兜底

## 验证

- 运行单测：`node tests/color.test.js && node tests/pattern.test.js`
- 新增/修改 JS 一律执行 `node --check <file>`；JSON 用 `node -e "JSON.parse(...)"` 校验
- 微信开发者工具安装在 `D:\Tencent\Winxin_develop`（`cli.bat open --project D:\Code\Weixin\Pindou` 可打开项目），修改代码后在开发者工具点"编译"，在模拟器验证三个页面
- 本机有 `claude-vision-skill`（千问识图），开发中可截图并用 `node vision.js <图片路径> "描述..."` 辅助检查模拟器效果
- 云函数改动需在开发者工具中右键"上传并部署（云端安装依赖）"；本项目暂未使用云函数

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