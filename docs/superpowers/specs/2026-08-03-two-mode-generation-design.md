# 双模式图纸生成（照片还原 / AI 生成）设计文档

> 日期：2026-08-03（Asia/Shanghai）
> 状态：已评审通过（修订：移除 AI 优化、AI 仅 52×52、5 个风格示例 + 自定义关键词、照片还原原地改造、AI 生成新建文件）
> 分支：codex/pindou-pattern
> 关联：docs/superpowers/specs/2026-08-03-pixelation-smoothing-design.md（前身，已作废）、docs/superpowers/specs/2026-08-03-ai-optimize-design.md（前身，已作废）

## 1. 背景与问题

旧版生成管线（v4：dominantBlocks 高对比细线保留 → CIELAB 映射 → 两级 mergeGrid → removeSmallRegions → denoiseGrid）参数多、逻辑复杂，对不同图像效果差异过大，用户难以预期结果。另有"AI 优化图纸"功能（展示页入口 + ai-optimize 后端）与"AI 卡通化"预留位，产品定位不清。

结论：改为**两种明确的生成方式**，每种一个清晰的管线，不做投机性后处理。

## 2. 目标

1. **照片还原**：方格内取平均 + CIELAB 最近色映射，最大限度接近原照片色彩分布；免费、离线、可单测。
2. **AI 生成**：AI 直接根据真实图片生成带指定风格的拼豆图纸，完全不使用取平均；以 JSON function call 严格约束样式与输出，AI 返回 52×52=2704 个拼豆色号（如 A1）。

## 3. 评审决策记录

| # | 决策 | 说明 |
| --- | --- | --- |
| 1 | 移除 AI 优化图纸 | 前端入口、tools/ai-optimize-server.js、云函数 ai-optimize-pattern 全部删除 |
| 2 | AI 生成仅 52×52 | 模型输出 token 上限约束（见 5.4） |
| 3 | 5 个风格示例 + 自定义关键词 | 卡通、马卡龙、扁平插画、复古像素、水彩；自定义输入优先 |
| 4 | 照片还原原地改造，AI 生成新建文件 | pattern.js / index 页原地改；utils/ai.js、后端文件新建 |
| 5 | 旧 WIP 作废 | 工作区未提交的 v4 平滑优化与 AI 优化改动不再保留 |

## 4. 方式一：照片还原

管线：选图 → 裁剪页（可选）→ `wx.createOffscreenCanvas` 建 4N×4N 中间画布，contain 绘制（白底补齐、透明像素按白）→ `averageBlocks(data, size4, size, block)` 每 4×4 块求平均 RGB → N×N 代表色 → `mapRgb`（CIELAB 最近色，只输出当前套装内色号）→ grid。

- 采样仅此一步，**不做**相似色合并、孤立点平滑、区域合并、抖动。
- 透明像素不计入平均；全透明块按白。
- 支持 52/78/104。

## 5. 方式二：AI 生成

### 5.1 调用链

```
主页选 AI 生成 + 风格 → 点生成（确认计费弹窗）
  → 原图压缩为 ~768px JPEG base64（utils/ai.js compressToBase64）
  → 后端：config.aiGenerate.backend = 'local'（tools/ai-generate-server.js）| 'cloud'（ai-generate-pattern）
  → 百炼 OpenAI 兼容接口 /compatible-mode/v1/chat/completions，模型默认 qwen3-vl-plus
  → system：完整色表 + 风格 + 输出规则；tools：submit_pixel_pattern（JSON schema）；tool_choice 强制
  → 解析 tool_calls[0].function.arguments → 后端校验 → 返回 { grid }（扁平数组，行优先）
  → 前端 parseGridResponse 再次校验 → 二维 grid
```

### 5.2 function call 约束（后端 tools 定义）

```json
{
  "type": "function",
  "function": {
    "name": "submit_pixel_pattern",
    "description": "提交根据图片生成的拼豆图纸。grid 必须恰好包含 2704 个色号，按行优先排列，每个色号必须来自给定色表。",
    "parameters": {
      "type": "object",
      "properties": {
        "style": { "type": "string", "description": "用户选择的图纸风格描述" },
        "board_size": { "type": "integer", "enum": [52] },
        "color_set": { "type": "string", "enum": ["48", "72", "144", "221"] },
        "grid": {
          "type": "array",
          "items": { "type": "string" },
          "minItems": 2704,
          "maxItems": 2704,
          "description": "52×52 个拼豆色号（如 A1），行优先"
        }
      },
      "required": ["style", "board_size", "color_set", "grid"]
    }
  }
}
```

### 5.3 提示词与校验

- system：你是拼豆图纸生成器；图纸内容与图片一致（轮廓/五官/姿态/位置关系），以拼豆色块表达；风格定义；只使用色表内色号；grid 恰好 2704 个色号、行优先；不得输出解释文字，直接调用 submit_pixel_pattern。
- 用户消息：图片（base64 data URL）+ "请把这张图片生成为 52×52 拼豆图纸（风格：xxx），并调用 submit_pixel_pattern 提交。"
- 后端校验：`args.grid` 长度 === 2704、每个色号属于当前套装（大小写归一）；失败返回明确错误文案，前端 toast，不自动重试。
- 前端校验：`parseGridResponse(rawGrid, size, setCodes)` 同样校验后转二维 grid。

### 5.4 盘面限制（token 估算）

qwen3-vl-plus 最大输出 32768 token：

| 盘面 | 色号数 | JSON 约需 token | 结论 |
| --- | --- | --- | --- |
| 52×52 | 2704 | ~7K | 稳定，支持 |
| 78×78 | 6084 | ~18K | 可行但有质量风险，二期再评估 |
| 104×104 | 10816 | ~30K+ | 超限，不支持 |

AI 模式 UI 强制 52×52（78/104 禁用并提示）。

### 5.5 风格

| key | 名称 | 给模型的风格定义（概要） |
| --- | --- | --- |
| cartoon | 卡通 | 简化造型、粗黑描边、平涂色块、五官夸张 |
| macaron | 马卡龙 | 低饱和马卡龙色系、圆润柔和、减少硬边 |
| flat | 扁平插画 | 简洁扁平、色块归纳、弱化细节 |
| retro | 复古像素 | 8-bit 复古游戏像素风、高对比、锯齿边缘 |
| watercolor | 水彩 | 水彩晕染感、柔和的颜色过渡、边缘朦胧 |

用户可在输入框填写自定义风格关键词；输入框留空用所选示例，填写后以自定义为准（示例与自定义都作为 function call 的 style 参数发给模型）。

## 6. 后端设计

- 本地：`tools/ai-generate-server.js`（Node http/https，无第三方依赖），读取根目录 `.env` 的 DASHSCOPE_API_KEY，监听 0.0.0.0:8787，端点 `/ai-generate`、`/health`。
- 云端：`cloudfunctions/ai-generate-pattern/`（wx-server-sdk），环境变量 DASHSCOPE_API_KEY（必填）、DASHSCOPE_MODEL（可选，默认 qwen3-vl-plus）；结果直接返回 JSON（52×52 约 20KB，低于 callFunction 上限，无需云存储中转）。
- 请求体：`{ imageBase64, size, set, style, colors }`（colors 为当前套装色表 [{code, hex, rgb}]，由前端从 colorsData 构建，避免云函数内复制数据）。
- 旧 `tools/ai-optimize-server.js` 与 `cloudfunctions/ai-optimize-pattern/` 删除。

## 7. 前端改动

- `miniprogram/utils/ai.js`（新建）：compressToBase64 / callAiGenerate（local/cloud 分发）/ parseGridResponse（纯函数可测）。
- `miniprogram/page/index/index.js|wxml|wxss`（原地）：生成方式选择、风格 chips + 自定义输入框、AI 计费确认、generate 按 mode 分支、AI 模式强制 52。
- `miniprogram/page/pattern/index.js|wxml`：meta 区显示生成方式与风格。
- `miniprogram/config.js`：新增 `aiGenerate: { backend: 'local', localUrl: 'http://127.0.0.1:8787' }`。
- `miniprogram/utils/pattern.js`（原地）：新增 averageBlocks，删除 dominantBlocks/mergeGrid/denoiseGrid/removeSmallRegions 等平滑函数。
- `tests/pattern.test.js`：删除平滑相关用例，新增 averageBlocks 用例。

## 8. 风险与说明

- 模型可能返回非法色号或数量不对 → 前后端双重校验 + 明确错误提示；不自动重试（保持简单，可后续加）。
- qwen3-vl-plus 无严格 JSON schema 强制 → 依赖 prompt + tool + 服务端校验兜底。
- 按次计费 → 前端生成前弹确认框。
- 模型/API 细节（function call、输出上限）以实施时实测为准；模型名可用 DASHSCOPE_MODEL 覆盖。

## 9. 文件改动清单

| 文件 | 动作 |
| --- | --- |
| miniprogram/utils/pattern.js | 改：averageBlocks 替代平滑管线 |
| tests/pattern.test.js | 改：新增 averageBlocks 用例、删除平滑用例 |
| miniprogram/utils/ai.js | 新建 |
| miniprogram/page/index/index.js / .wxml / .wxss | 改：双模式 UI 与逻辑 |
| miniprogram/page/pattern/index.js / .wxml | 改：meta 显示生成方式 |
| miniprogram/config.js | 改：aiGenerate 配置 |
| tools/ai-generate-server.js | 新建 |
| tools/ai-optimize-server.js | 删除 |
| cloudfunctions/ai-generate-pattern/ | 新建 |
| cloudfunctions/ai-optimize-pattern/ | 删除 |
| .env.example | 改：DASHSCOPE_MODEL 示例 |
| AGENTS.md / docs/项目结构与开发说明.md | 改：同步 |
| docs/superpowers/specs/2026-08-03-two-mode-generation-design.md | 新建（本文档） |
| docs/superpowers/plans/2026-08-03-two-mode-generation.md | 新建（实施计划） |

## 10. 验证

1. `node tests/color.test.js && node tests/pattern.test.js` 全通过。
2. 所有改动 JS `node --check`。
3. 本地服务 `node tools/ai-generate-server.js` 后 `/health` 返回 keyConfigured。
4. 开发者工具编译通过；照片还原直接生成；AI 生成（本地模式）完成一次真实调用并校验 2704 色号。
5. 模拟器验证：AI 模式下 78/104 禁用、风格自定义生效、展示页 meta 显示生成方式。