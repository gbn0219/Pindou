# 双模式图纸生成实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把拼豆图纸生成改为两种方式：照片还原（4×4 块平均 + CIELAB 最近色）与 AI 生成（qwen3-vl-plus function call 返回 2704 个色号），并移除 AI 优化废案。

**Architecture:** 照片还原在现有 utils/pattern.js 与主页原地改造（averageBlocks 替代 v4 平滑管线）；AI 生成新建 utils/ai.js（前端）、tools/ai-generate-server.js（本地代理）与 cloudfunctions/ai-generate-pattern/（云函数），后端统一走百炼 OpenAI 兼容接口 + submit_pixel_pattern 函数调用，服务端校验 JSON grid。

**Tech Stack:** 微信小程序原生 JS/WXML/WXSS；Node（本地代理用内置 http/https）；DashScope 百炼 compatible-mode（qwen3-vl-plus）；无第三方 npm 依赖。

---

## Task 1: 照片还原管线（pattern.js + 单测）

**Files:**
- Modify: `miniprogram/utils/pattern.js`
- Modify: `tests/pattern.test.js`

- [ ] **Step 1: 在 pattern.js 新增纯函数 `averageBlocks(data, size4, size, block)`**（4×4 块平均，透明像素不计入、全透明块按白），并删除 `dominantBlocks / mergeGrid / denoiseGrid / removeSmallRegions / modeColor / hasAdjacentPair / lum`，exports 改为 `averageBlocks`
- [ ] **Step 2: 重写 tests/pattern.test.js**：保留 mapRgbGrid/countColors 用例；新增 averageBlocks 用例（均匀块取该色、混合块取算术平均、透明排除、全透明按白、2×2 网格正确）
- [ ] **Step 3: 验证**：`node tests/pattern.test.js` 全通过；`node --check miniprogram/utils/pattern.js`
- [ ] **Step 4: Commit**：`docs` 与 `pattern.js` 一起按阶段提交

## Task 2: 主页面双模式 UI 与逻辑（原地）

**Files:**
- Modify: `miniprogram/page/index/index.js` / `.wxml` / `.wxss`
- Modify: `miniprogram/config.js`

- [ ] **Step 1: config.js 新增** `aiGenerate: { backend: 'local', localUrl: 'http://127.0.0.1:8787' }`
- [ ] **Step 2: index.js**：新增 `mode/selectedStyle/customStyle/styles` 数据与 `pickMode/pickStyle/onCustomStyleInput`；`generate()` 按 mode 分支（photo 走 averageBlocks→mapRgb；ai 先弹计费确认再调 utils/ai.js）；AI 模式强制 size=52
- [ ] **Step 3: index.wxml/wxss**：生成方式两个 chip；AI 模式下显示 5 个风格 chip + 自定义输入框；78/104 在 AI 模式下禁用
- [ ] **Step 4: 验证**：`node --check miniprogram/page/index/index.js`；开发者工具编译通过

## Task 3: AI 生成前端模块（新建）

**Files:**
- Create: `miniprogram/utils/ai.js`

- [ ] **Step 1: 实现 `compressToBase64(src, maxSize=768)`**：offscreen canvas contain 绘制 → jpg 0.85 → base64 data URL
- [ ] **Step 2: 实现 `callAiGenerate({ imageBase64, size, set, style, colors })`**：按 `config.aiGenerate.backend` 分发（local: wx.request /ai-generate；cloud: wx.cloud.callFunction ai-generate-pattern），返回 `{ grid }`
- [ ] **Step 3: 实现纯函数 `parseGridResponse(rawGrid, size, setCodes)`**：长度必须等于 N×N、色号大小写归一且属于套装；返回二维 grid，失败抛明确错误
- [ ] **Step 4: 验证**：`node --check miniprogram/utils/ai.js`；tests/pattern.test.js 中加入 parseGridResponse 用例

## Task 4: AI 生成后端（本地代理 + 云函数，新建）

**Files:**
- Create: `tools/ai-generate-server.js`
- Create: `cloudfunctions/ai-generate-pattern/index.js`、`package.json`
- Delete: `tools/ai-optimize-server.js`、`cloudfunctions/ai-optimize-pattern/`
- Modify: `.env.example`（DASHSCOPE_MODEL 示例改为 qwen3-vl-plus）

- [ ] **Step 1: 本地代理**：读取 .env 的 DASHSCOPE_API_KEY；POST /ai-generate（入参 imageBase64/size/set/style/colors）→ 构建 system 提示词（色表+风格+输出规则）+ tools.submit_pixel_pattern + tool_choice → 调 `https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions`（默认 qwen3-vl-plus）→ 解析 tool_calls arguments → 校验（长度 2704、色号在套装内）→ 返回 `{ grid }`；/health 返回 keyConfigured
- [ ] **Step 2: 云函数**：同逻辑（wx-server-sdk init），环境变量 DASHSCOPE_API_KEY / DASHSCOPE_MODEL，返回 `{ grid }` 或 `{ error }`
- [ ] **Step 3: 删除旧 ai-optimize 文件**
- [ ] **Step 4: 验证**：`node --check tools/ai-generate-server.js`、`node --check cloudfunctions/ai-generate-pattern/index.js`；启动本地服务后 GET /health 返回 ok；`rg -n "aiOptimize|ai-optimize|ai-optimize-pattern"` 无残留
- [ ] **Step 5: Commit**

## Task 5: 展示页 meta 显示生成方式

**Files:**
- Modify: `miniprogram/page/pattern/index.js` / `.wxml`

- [ ] **Step 1: onLoad 读取 p.mode/p.style 并 setData**
- [ ] **Step 2: wxml meta 增加"生成方式"项**：`{{mode === 'ai' ? 'AI 生成 · ' + style : '照片还原'}}`
- [ ] **Step 3: 验证**：`node --check miniprogram/page/pattern/index.js`；开发者工具编译通过

## Task 6: 全量验证与提交

- [ ] `node tests/color.test.js && node tests/pattern.test.js`
- [ ] 所有改动/新建 JS `node --check`
- [ ] `rg -n "aiOptimize|ai-optimize"` 无残留（docs 历史文档除外）
- [ ] 开发者工具编译 + 模拟器验证两种生成方式
- [ ] Commit 全部改动