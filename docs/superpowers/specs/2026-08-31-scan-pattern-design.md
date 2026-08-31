# 图纸识别（扫描）功能设计

日期：2026-08-31
状态：已与用户确认（方形 MVP · 圈整图校准 · 识别后映射色系）

## 目标

用户导入一张已有拼豆图纸（截图 / 拍照），**不调用 AI**，纯本地识别为 R×C 色号网格，
随后无缝进入现有展示 / 修改 / 智能拼豆 / 导出流程。作为小程序的第二大功能，
入口放在首页显眼位置。

## 范围（MVP）

- **方形图纸**：宽 == 高（R == C）。长宽不等留待后续——现有展示 / 修改 / 导出都假设单值
  `size`，泛化到 rows/cols 属于独立改造，不在本次范围。
- **校准**：圈整个图纸范围（方案 B）。整图框的每边误差被 R/C 平分，天然抗“圈不准”。
- **色卡**：识别后一律映射到所选色系色号（默认 221，可切 48 / 72 / 144），与现有编辑 / 拼豆打通。
- **不做**：旋转 / 透视校正（提示用户截图或拍正）；画廊入库（后续再补，入库时补 sec-check）。

## 入口与页面

- 首页 hero 下方新增全宽显眼卡片「识别已有图纸」，tap → `page/scan/index`（主包第 8 页）。
- 展示页 meta 文案增加 `mode === 'scan'` 分支，显示「图纸识别」（现只有 ai / 照片还原）。

## 识别管线

```
导入图纸图 → 输入 宽(列)×高(行) → 拖框圈出整个图纸范围 → 实时网格叠加预览 → 微调
→ 逐格取主色 dominantColor → CIELAB 最近色映射色号 → postProcessGrid 后处理
→ globalData.pattern(mode:'scan') → 跳展示页 → 修改 / 智能拼豆 / 导出复用
```

1. **读图**：offscreen canvas 读原图像素。
2. **逐格取色**：每格取主色（占比最高的色桶，按 RGB 高位量化分桶），抗网格线 / 描边 / 抗锯齿 /
   拍照光影；主色占比不足 35% 时退化平均（兜底）。
3. **映射**：CIELAB 最近色 → 所选色系色号，复用 `color.nearestColor` / `buildPalette`。
4. **后处理**：复用 `postProcessGrid`（杂色合并、邻近色合并、去噪）。
5. **落数据**：

```js
globalData.pattern = {
  grid,                 // 色号二维数组（方形 rows×cols）
  size: rows,           // 方形 MVP：size == rows == cols
  set,                  // 用户所选色系，默认 '221'
  imagePath,
  mode: 'scan',
  style: '图纸识别',
  bgMask: 全 false 的 rows×cols 数组 // 扫描图每格都是真实豆色，不做白色背景去除
}
```

`bgMask` 全 false：让展示 / 计数 / 拼豆把白色格子也当作正常豆色（照片还原才会把连通白色当背景）。

## utils/scan.js 纯函数（node 可测）

- `dominantColor(imageData, x0, y0, w, h)` → `[r, g, b]`：区域内主色桶，退化平均。
- `scanGrid(imageData, rows, cols, box)` → `rows×cols` 的 RGB 二维数组；`box = { x0, y0, x1, y1 }`
  为图纸范围（图片像素坐标），`cellW = (x1-x0)/cols`、`cellH = (y1-y0)/rows`，逐格调用
  `dominantColor`。
- 无 wx 依赖，色号映射复用 `pattern.mapRgb`（方形下 size == rows == cols）。

## 校准交互（方案 B）

- canvas 按 aspectFit 显示整图；双指缩放、单指平移（复用 `gesture.js` 纯函数 + 页面内本地
  clampRect，图片非方形，不复用方形 `clampView`）。
- 拖动画出整图框（图片坐标）；框内拖动整体移动；四角调整大小；框内实时叠加
  `rows`×`cols` 网格线（含外框），让用户一眼看出对没对齐。
- 微调兜底：原点四向移动（步长 cell/5）、格宽 / 格高 ±1%（从中心缩放）。
- 「重置」恢复视图与选框；「识别图纸」进入识别。

## 误差处理

- **采样层**：主色桶天然抗细网格线 / 抗锯齿；占比不足退化平均。
- **校准层**：整图框误差被 R/C 平分（每格误差 ≈ 框边误差 / C，趋于零）；实时网格叠加预览；
  微调按钮手动纠偏。
- **旋转 / 透视**：不做，导入阶段提示用户用截图或拍正。

## 内容安全

识别为纯本地处理，不入库、不发布，MVP 不调 `sec-check`；后续如果支持“保存到图库”再补
`imgSecCheck`。

## 测试

- `tests/scan.test.js`（node）：
  - 合成多色块 + 细网格线图，验证 `dominantColor` / `scanGrid` 主色正确；
  - 选框偏移 / 略大略小的容差用例（验证“圈不准也没关系”）；
  - 色号映射 sanity（RGB → 套装色号）。
- 自举验证（可选手动）：现有图纸导出 PNG 再扫描回来，对比色号网格一致率。
- 新增 / 修改 JS 一律 `node --check`；开发者工具编译验证各页面。

## 改动清单

- 新增：`page/scan/index.{js,wxml,wxss,json}`、`utils/scan.js`、`tests/scan.test.js`。
- 修改：`app.json`（注册页面）、`page/index/index.{wxml,js}`（入口卡片 + 跳转）、
  `page/pattern/index.wxml`（meta 文案分支）。
- 无第三方 npm 依赖；不触碰展示 / 修改 / 导出核心渲染逻辑（方形前提下零改动）。
