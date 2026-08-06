# 图库提速 / 大图纸高清导出 / 图库在线编辑 技术文档

> 日期：2026-08-06（Asia/Shanghai）
> 状态：已评审（由用户直接授权"先出技术文档，再按文档修改"）
> 关联：`docs/superpowers/specs/2026-08-05-user-center-login-gallery-design.md`（图库/登录/解锁前身，本文在其基础上增量修改）

## 1. 背景与问题

当前图库、导出与修改链路存在三个问题：

1. **图库加载慢、预览失败**：图库列表每页 10 条 × 2 张缩略图；旧记录没有缩略图/预览图字段时回退加载全尺寸文件（图纸 PNG 含图例可达数 MB、原图可能 5~10MB），明显拖慢列表。点击图片预览时，前端先 `wx.cloud.downloadFile` 下载两张图（15s 超时）再 `wx.previewImage`，任一超时即整体失败，弹"图片加载失败"。
2. **104 及以上大图纸导出分辨率低**：画布受部分设备 2048px 上限约束，且底部色号清单占用高度预算后被整体等比缩小。104 盘每格实际仅约 15px、156/208 盘约 10px，保存的图片放大后每个像素块颜色发糊。
3. **图库条目不可编辑**：图库只存图片 fileID，不存像素网格（grid）；修改页只能从展示页进入，且没有保存回图库的通道。

## 2. 根因分析

### 2.1 图库慢与预览失败

- `page/gallery/index.js` 的 `onPreview` 用 `Promise.all(ids.map(downloadFile))` 先下载原图+图纸两张图再打开预览；每张下载带 15s 超时。旧记录回退到全尺寸文件时下载量大，超时概率高 → "图片加载失败"。
- `wx.previewImage` 自基础库 **2.2.3 起直接支持 `cloud://` 云文件 ID**，无需先下载；本项目基础库版本远高于此。下载式预览既慢又引入了多余的失败点。
- 列表 `<image src="cloud://...">` 直渲 + `lazy-load` 已是推荐做法，瓶颈在于：旧记录无 `*ThumbFileID`/`*PreviewFileID` 字段时回退全图；`saveToGallery` 上传原图时未压缩（相机原图可能 5~10MB）。

### 2.2 导出分辨率低

- `utils/pattern.js` 的 `EXPORT_CELL=16`、`EXPORT_MAX_DIM=2048`：104 盘图纸 1767px，加图例后总高约 2200px，被 `scale=min(1, 2048/max)` 缩到约 0.92 → 每格约 15px；156/208 盘直接压到 2048px 上限 → 每格约 10px。
- `wx.canvasToTempFilePath` 的 `destWidth/destHeight` 支持等比放大输出（官方确认可提升保存图片质量），且社区经验确认画布尺寸超出设备上限会导出空白 → 应保持画布 ≤2048，用输出放大而不是增大画布。

### 2.3 图库不可编辑

- `gallery` 集合没有 `grid` 字段；`gallery` 云函数只有 `save/list`；修改页 `pattern-edit` 没有"保存到图库"动作。

## 3. 设计决策

| # | 决策 | 理由 |
| --- | --- | --- |
| D1 | 预览改为直接把 `cloud://` fileID 传给 `wx.previewImage`（优先 preview → thumb → 全图），删除下载式预览 | 官方支持云文件 ID（基础库 2.2.3+）；去掉 15s 下载超时这个失败点，预览秒开、图片在查看器内懒加载 |
| D2 | 列表保持 `cloud://` 直渲 + `lazy-load`；新增"老数据缩略图/预览图回填" | 压缩解决"慢"的核心：旧记录缺 `*ThumbFileID`/`*PreviewFileID` 时，后台逐条下载全图→本地生成 360/1080 JPEG→上传→用新增的 `gallery.update` 回写字段并刷新列表；一次性开销，之后列表/预览都走小图 |
| D3 | `saveToGallery` 原图上传前压缩为 ≤1280px JPEG（不再上传原始大图） | 原 08-05 设计文档已约定"原图上传前压缩到 ≤1280px JPEG"，落地修正；减小存储与旧数据回退时的加载量 |
| D4 | 导出画布仍 ≤2048，`canvasToTempFilePath` 输出 `destWidth/destHeight ×2`（`EXPORT_UPSCALE=2`） | 规避设备画布上限风险；纯色块经 2× 放大后颜色完全不变、块内平整，仅 1px 格线轻微柔化；104 盘输出约 3900px（每格约 36px）、208 盘约 3700px（每格约 18px），清晰度翻倍 |
| D5 | `gallery.save` 增加 `grid`（色号串）；`list` 用字段投影排除 `grid`；新增 `get`（单条含 grid）与 `update`（回写图纸图/缩略图/预览图/grid）action | 列表不背大字段（104 盘 grid 串约 35KB、208 盘约 140KB），编辑时才按需拉取；`update` 同时服务于"编辑保存"与"老数据回填" |
| D6 | 图库卡片加"编辑"按钮：`get` 详情 → 解析 grid → 写入 `globalData.pattern`（带 `galleryId`）→ 进修改页；修改页有 `galleryId` 时显示"保存"，保存=重渲染导出图+缩略图/预览图→上传→`update`→返回图库 | 复用现有修改页全部交互，不新建页面；保存链路与展示页导出共用同一套渲染实现 |
| D7 | 不做：4096 原生大画布、服务端拼图（jimp 云函数）、下一页预加载 | 4096 画布在旧设备可能静默导出空白；服务端拼图引入新云函数与 npm 依赖，复杂度高；`<image>` 走微信云 CDN 自带缓存，预加载收益低且浪费流量 |

## 4. 数据设计

### 4.1 `gallery` 集合

在 08-05 字段基础上新增：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `grid` | string | 色号序列化串：按行优先 `row.join(',')` 后再用 `,` 连接整张网格（如 `A1,B1,C1,...`），方形网格维度由 `size` 字段决定；104 盘约 35KB、208 盘约 140KB，远低于单文档上限 |
| `updatedAt` | Date | `update` 时刷新 |

`list` 返回时用 `field()` 只返回：`_id / originalFileID / patternFileID / originalThumbFileID / patternThumbFileID / originalPreviewFileID / patternPreviewFileID / mode / style / size / set / sessionId / createdAt`，**排除 grid**。

### 4.2 序列化格式

`utils/pattern.js` 新增纯函数（node 可测）：

- `serializeGrid(grid)` → 行优先逗号连接字符串；空网格返回 `''`。
- `parseGrid(str, size)` → 按 `size×size` 重塑二维数组；`size` 非法或串长度 ≠ `size*size` 时抛错。

### 4.3 云存储路径

编辑保存与回填均上传新文件（`gallery/<openid>/<ts>_pattern_edited.png` 等），不回写删除旧文件——旧文件成为孤儿存储，量级可忽略，本次不做清理。

## 5. 云函数改动（`cloudfunctions/gallery/index.js`）

| action | 请求 | 响应 | 说明 |
| --- | --- | --- | --- |
| `save`（改） | 增加可选 `grid` | `{ ok }` | `grid` 截断到 400000 字符后存储 |
| `list`（改） | 不变 | `{ items, total, totalPages }` | `field()` 投影排除 `grid` |
| `get`（新） | `{ id }` | `{ item }` | 校验 `_openid + _id` 归属，返回含 `grid` 的完整记录 |
| `update`（新） | `{ id, patternFileID?, patternThumbFileID?, patternPreviewFileID?, originalThumbFileID?, originalPreviewFileID?, grid? }` | `{ ok }` | 校验归属后仅更新传入字段 + `updatedAt` |

## 6. 前端改动清单

| 文件 | 动作 | 说明 |
| --- | --- | --- |
| `miniprogram/utils/pattern.js` | 改 | 新增 `serializeGrid` / `parseGrid` |
| `miniprogram/utils/export.js` | 新建 | 统一图纸资产生成：`renderPatternExport`（全图+图例，输出 ×2）、`renderGridJpeg`（网格缩略图）、`renderSquareJpeg`（原图方图压缩）；导出与修改页共用，避免两处重复实现 |
| `miniprogram/utils/user.js` | 改 | 新增 `getGalleryItem(id)` / `updateGallery(payload)` |
| `miniprogram/page/pattern/index.js` | 改 | `makeExportFile/makeSquareJpeg/makeGridJpeg` 改为调用 `utils/export.js`（删除本地重复实现与孤儿 `restoreDisplay`、`image` 引用）；`saveToGallery` 原图改为 1280px JPEG、`save` 增加 `grid` |
| `miniprogram/page/pattern-edit/index.js/.wxml` | 改 | `onLoad` 检测 `pattern.galleryId` → `fromGallery`；新增 `save()`（渲染导出+缩略图+预览图→上传→`updateGallery`）；顶栏条件显示"保存"按钮 |
| `miniprogram/page/gallery/index.js/.wxml` | 改 | 预览改传 `cloud://`（preview→thumb→全图回退）；新增"编辑"按钮与 `onEdit`（get→parseGrid→写 `globalData.pattern`→跳修改页）；新增老数据回填（缺 `*ThumbFileID`/`*PreviewFileID` 时后台下载→压缩→上传→`update`→刷新列表） |
| `tests/pattern.test.js` | 改 | 新增 `serializeGrid`/`parseGrid` 往返与异常用例 |
| `AGENTS.md` | 改 | 同步图库/导出/编辑说明 |

## 7. 错误处理与边界

- 预览：不再有下载超时路径；`wx.previewImage` 内部对 cloud:// 图片有加载失败态，用户可自行关闭，不再弹业务 toast。
- 编辑入口：旧记录无 `grid` → toast"该图纸暂无像素数据，无法编辑"，不跳转。
- 编辑保存：任一步失败（渲染/上传/云函数）→ toast 失败原因，修改页保留当前 grid，不丢已编辑内容。
- 老数据回填：后台顺序执行、失败静默跳过（不影响列表展示），`_backfilling` 标志防并发重复。
- 未登录用户：图库页本就要求登录（云函数 `NO_LOGIN`），编辑/回填沿用现有登录校验。
- 208 盘 grid 约 140KB：`get` 单条拉取可接受；`list` 已排除。

## 8. 验证方案

1. 单测：`node tests/color.test.js && node tests/pattern.test.js && node tests/ai.test.js && node tests/user.test.js` 全通过；新增/修改 JS 全部 `node --check`。
2. 云函数：`save` 带 `grid` 成功；`list` 返回不含 `grid`；`get` 返回含 `grid` 且校验归属；`update` 仅本人记录可改。
3. 开发者工具模拟器：
   - 图库：点击缩略图直接打开预览（不再出现"加载中…"下载步骤）；旧数据（无缩略图字段）首次进入后台回填，随后列表刷新为小图。
   - 导出：104/156/208 盘导出 PNG 分辨率约为之前的 2 倍，放大后色块颜色清晰、格线完整。
   - 编辑：图库卡片"编辑"→ 修改页可涂色/换色/吸色 → "保存"→ 返回图库列表，缩略图更新为编辑后的图纸；再次进入展示页可见同一 grid。
4. 真机验证：预览打开速度、导出文件大小与清晰度、编辑保存后图库缩略图刷新。
