# Video Studio 0.2.0 修复复审报告

- 日期：2026-11-21
- 仓库：`wwxst/skill`
- 分支：`feat/auto-video-production`
- 初审基准：`2cc454caed82e2b875c4f39f5ed5a0efd3edfdbf`
- 修复提交：`b4e2a1d4d248b15f256b0a8b643e7205b6071a90`、`6aba5eb3a72320b1519b8f8d0a639630d155a8ec`
- 修复验证 HEAD：`6aba5eb3a72320b1519b8f8d0a639630d155a8ec`
- PR：[Draft #1](https://github.com/wwxst/skill/pull/1)
- 审查方式：单 Agent 复核；没有创建或声称创建独立子 Agent
- 结论：**PASS — 初审中确认的 4 项 P2 已处理，原 P3 误判已撤销**

## 1. 修复结果

### Finding 1 — 连续转场重叠：已修复

`normalizeTransitions` 现在检查每个中间片段两侧转场的时长总和，不能超过该中间片段的时长。这样相邻 xfade 区间不会在同一个中间片段上互相覆盖。

新增测试覆盖：
- 两侧转场总时长超过中间片段时拒绝。
- 两侧转场总时长刚好等于中间片段时允许。

### Finding 2 — FFmpeg 能力误报：已修复

新增 FFmpeg 能力探测，实际读取 `-filters` 和 `-encoders` 输出，检查：

- `libx264`
- `ass`、`subtitles`
- `xfade`、`acrossfade`
- `zoompan`
- `amix`

`video_studio_status` 现在返回 `ffmpegCapabilities`、逐项 `capabilities`、`missingFeatures`，并区分基础渲染是否可用和完整功能是否就绪。缺少滤镜或编码器时不再无条件把对应功能标记为可用。

新增解析器单元测试；真实 FFmpeg 集成测试也检查运行环境中的功能状态。

### Finding 3 — 模板输出参数和字号：已修复

明确采用“模板复用时间线样式，不覆盖目标项目输出设置”的方案：

- 新保存模板使用 `referenceCanvas` 记录参考画布尺寸，不再把它伪装成需要恢复的项目 output 设置。
- 应用模板时保留目标项目的画幅、分辨率和 FPS。
- 文字字号根据参考画布高度与目标画布高度的比例缩放，并限制在现有 20–120 字号范围内。
- 旧版模板中的 `output` 字段仍作为参考画布读取，兼容已保存的旧模板。

集成测试使用 320×180 模板应用到 480×270、30 FPS 项目，验证字号从 64 缩放到 96，同时目标项目输出设置不变。另有单元测试覆盖旧模板兼容。

### Finding 4 — 动画和文字缺少视觉验证：已修复

生产集成测试不再只检查时间线参数和 MP4 文件存在：

- 使用带有明显白色矩形图案的静态图片。
- 从实际输出 MP4 抽取不同时间点的原始帧，比较画面像素，确认 zoompan 确实产生画面变化。
- 抽取标题显示时刻的帧，检查预期文字区域内确实存在足够的亮色像素，确认 ASS 文字已渲染进视频。

这仍是针对当前固定测试素材和测试环境的自动化验证，不等于对所有字号、字体、画幅和 FFmpeg 构建做了视觉验收。

### 原 Finding 5 — 固定 4174 端口：撤销，不属于实际问题

复核代码后发现：

- `createEngine()` 不会启动 HTTP 工作台服务。
- 它只用 port 生成 status 返回的 workbenchUrl。
- 工作台服务是在 `index.js` 的 `apply()` 中才通过 `startServer()` 启动。
- `production.test.js` 直接创建 Engine，没有启动服务，因此不会占用 4174 端口。

所以初审的端口冲突判断不成立。测试中去掉显式 port 参数仅是清理无用配置，不作为功能修复项。

## 2. 自动化验证

以下两次 GitHub Actions 都针对同一个修复 HEAD `6aba5eb3a72320b1519b8f8d0a639630d155a8ec`，均成功：

- [GitHub Actions #44859388937](https://github.com/wwxst/skill/actions/runs/44859388937) — success
- [GitHub Actions #44859393540](https://github.com/wwxst/skill/actions/runs/44859393540) — success

测试日志结果：

- **9 passed**
- **0 failed**
- 安装 Node.js 成功。
- 安装 FFmpeg 成功。
- 真实 MP4 渲染成功。
- zoompan 像素变化验证通过。
- ASS 文字画面验证通过。
- FFmpeg 能力解析和状态验证通过。
- 连续转场边界测试通过。
- 新旧模板字号缩放测试通过。

## 3. 最终结论

- P1 阻断项：0
- 未解决的 P2：0
- 有效 P3：0（初审中 1 项经复核撤销）

初审发现的 4 项 P2 已修复，新增测试在 GitHub Actions 环境全部通过。当前没有发现本轮修复引入的阻断问题。

**仍需注意：** GitHub Actions 通过不代表已在用户本机 Windows / DeepSeek Harness 环境完成安装和实际素材验收。

本次只更新开发分支和 Draft PR，没有修改 `main`，没有合并或发布。
