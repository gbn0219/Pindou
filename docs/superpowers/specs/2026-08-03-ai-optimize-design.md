# AI 优化拼豆图纸设计文档

> 日期：2026-08-03（Asia/Shanghai）
> 状态：已实现（原型已用真实图片验证）
> 分支：`codex/pindou-pattern`

## 1. 背景

经典图像处理（v1 块平均 / v2 中值+双线性 / v3 主色采样 / v4 块平均+严格保线）已迭代多轮，用户实测仍不够美观：细节（眼镜、耳机、五官）与颜色保真之间存在天然权衡，单靠像素算法难以同时满足"保边界 + 平滑内部 + 还原原图"。

结论：**先用 v4 管线快速生成初步图纸，再把图纸本身交给 AI 优化**（不是把原图卡通化——卡通化是另一独立功能）。

## 2. 流程

```
生成图纸（v4 管线） → 展示页点击"AI 优化"
  → 当前图纸渲染为纯色 PNG（无编号，52/78/104 × 10px）
  → 原图（裁剪后 imagePath）缩到 512px 转 JPEG base64
  → 原图 + 图纸 base64 传给云函数 ai-optimize-pattern
  → 千问图像编辑模型（qwen-image-2.0-pro）多图输入：图1=原图（基准），图2=图纸
  → 结果上传云存储，返回 fileID
  → 前端下载 → 重新走 dominantBlocks → mapRgb → mergeGrid → denoiseGrid
  → 新图纸替换当前图纸并刷新图例
```

## 3. AI 提示词（云函数内 DEFAULT_PROMPT，双图：图1=原图，图2=图纸）

1. 人物、物体和五官（眼睛、鼻子、嘴巴、耳朵等）的特征必须与图1保持一致，整体观感应像图1；
2. 物体和人物边界清晰，尽量使用黑色像素描边；
3. 平滑每个物体内部的颜色，去除杂色和孤立噪点，使同一区域颜色统一干净；
4. 配色与图1一致；
5. 保持 1:1 方形图纸风格；
6. 不要添加任何文字。输出与输入相同的方形像素图纸风格。

## 4. 架构

- 后端双模式（`config.aiOptimize.backend`）：
  - `local`（开发默认，无需部署）：`tools/ai-optimize-server.js` 本地代理，读取根目录 `.env` 的 `DASHSCOPE_API_KEY`，监听 127.0.0.1:8787；直接返回 base64（AI 输出 512×512 控制响应体积）；开发者工具需勾选"不校验合法域名"
  - `cloud`（生产）：云函数 `cloudfunctions/ai-optimize-pattern/`，调用千问原生端点 `/api/v1/services/aigc/multimodal-generation/generation`，I2I 多图输入（原图+图纸）；结果下载后 `cloud.uploadFile` 上传云存储返回 fileID（规避 callFunction 响应体积限制）；环境变量 `DASHSCOPE_API_KEY`（必填）、`DASHSCOPE_MODEL`（可选）
- 前端：`page/pattern/index.js` 的 `aiOptimize` / `renderGridToBase64` / `loadOriginalBase64` / `callAiOptimize` / `saveBase64ToFile` / `reprocess`；按钮在展示页底部
- 计费：按模型调用次数计费，前端点击前弹确认框

## 5. 验证（真实图片原型）

用同一张卡通头像（黑框眼镜+白色耳机+托腮）实测：

- 原 v4 图纸（A）：五官模糊、皮肤与头发有杂色噪点、眼镜框与肤色混在一起
- 仅图纸单图优化（C）：AI 自由发挥，五官/眼镜/耳机变形、配色偏离原图，用户反馈"不像了"
- 原图+图纸双图优化（D，当前实现）：以原图为基准，五官、眼镜、耳机、托腮动作、配色均明显更接近原图，边界整齐、内部平滑、杂色少；千问对比确认 D 优于 C 且更像原图
- 注意：AI 输出为自然图像，重新像素化后自动回到 52/78/104 网格与所选色系

## 6. 使用步骤

本地模式（推荐开发用）：
1. 项目根目录 `.env` 填写 `DASHSCOPE_API_KEY=sk-...`（已有 .env.example）
2. 启动服务：`node tools/ai-optimize-server.js`
3. 开发者工具"详情 → 本地设置"勾选"不校验合法域名"
4. 展示页点击"AI 优化"

云函数模式（生产可选）：
1. 右键 `cloudfunctions/ai-optimize-pattern` → "上传并部署（云端安装依赖）"
2. 云函数配置环境变量 `DASHSCOPE_API_KEY`
3. `config.aiOptimize.backend` 改为 `'cloud'`

## 7. 后续可选项

- 主页面提供"生成后自动 AI 优化"开关（当前为展示页手动触发）
- 支持用户自定义提示词
- AI 卡通化（原图卡通化）作为独立入口