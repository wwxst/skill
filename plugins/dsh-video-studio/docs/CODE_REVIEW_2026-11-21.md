# Video Studio 0.2.0 单 Agent 代码审查报告

> 本文记录首次审查基线。经用户批准修复后的复审结果见 [CODE_REVIEW_RECHECK_2026-11-21.md](CODE_REVIEW_RECHECK_2026-11-21.md)。

- 审查日期：2026-11-21
- 仓库：`wwxst/skill`
- 审查分支：`feat/auto-video-production`
- 审查基准：`main`
- 审查 HEAD：`2cc454caed82e2b875c4f39f5ed5a0efd3edfdbf`
- 审查方式：单 Agent 静态代码审查 + GitHub Actions 结果核对
- 是否使用独立子 Agent：否；本次按用户同意的单 Agent 方式执行
- 是否修改业务代码：否
- 结论：**PASS WITH WARNINGS**

## 1. 范围与仓库状态

审查覆盖当前分支相对 main 的全部 15 个变更文件，包括：

- FFmpeg 图片镜头运动、转场、音视频合成和 ASS 文字叠加。
- 模板 schema、内置模板、模板保存/读取/应用。
- Store、Engine、Harness 工具定义。
- 集成测试、插件挂载测试和 GitHub Actions。
- README、架构、Roadmap 和交接文档。

审查时 GitHub 比较结果：

- 分支领先 main 21 个提交，落后 0 个提交。
- 最新 HEAD 为 `2cc454caed82e2b875c4f39f5ed5a0efd3edfdbf`。
- main 未修改。
- 尚无 PR。

最新 CI 运行：

- [GitHub Actions #44854271454](https://github.com/wwxst/skill/actions/runs/44854271454)
- 触发提交：`2cc454caed82e2b875c4f39f5ed5a0efd3edfdbf`
- Node.js 安装、FFmpeg 安装、插件测试均成功。

CI 成功说明当前自动化测试在 GitHub Actions 环境通过，不代表已完成用户 Windows / DeepSeek Harness 本机安装验收。

## 2. 发现的问题

### Finding 1 — P2：相邻转场允许互相重叠，可能产生非预期三层混合

位置：

- `plugins/dsh-video-studio/src/templates/schema.js:27-45`
- `plugins/dsh-video-studio/src/render.js:117-145`

现状：

`normalizeTransitions` 只检查单个转场时长小于左右相邻片段时长，没有检查同一个中间片段两侧转场的总时长。

例如三个片段时长均为 2 秒，两段转场分别为 1.5 秒。当前校验会接受，因为每段转场都小于相邻片段的 2 秒。

但渲染时第一段 xfade 在时间轴 0.5–2.0 秒发生，第二段 xfade 在 1.0–2.5 秒发生，两段转场重叠 1 秒。第二段转场会把前一段仍在混合的画面再次与第三段画面混合，形成三层画面交叠。

影响：

- 用户设置较长连续转场时，视觉结果可能与“每两个片段独立转场”的直觉不一致。
- 现有测试没有覆盖连续转场重叠场景。

建议：

- 对每个中间片段增加约束：前一个转场时长 + 后一个转场时长不能超过该片段时长。
- 如果产品确实想支持三层重叠转场，应明确其行为并添加对应渲染测试。

### Finding 2 — P2：环境检查没有验证 FFmpeg 实际功能，能力状态可能误报

位置：

- `plugins/dsh-video-studio/src/media.js:96-103`
- `plugins/dsh-video-studio/src/engine.js:227-255`
- `plugins/dsh-video-studio/src/render.js:249-256`

现状：

`checkBinary` 只执行 `ffmpeg -version`，确认程序能启动就返回 available。

但渲染代码还依赖：

- `libx264` 编码器。
- `ass` / `subtitles` 滤镜（需要 libass）。
- `xfade` 转场滤镜。
- `zoompan` 镜头运动滤镜。

当前 `status()` 只根据 FFmpeg 和 FFprobe 是否能启动来计算 ready，并且无条件把 transitions、textOverlays 等能力标记为 true。

影响：

- 用户安装了一个缺少 libass 或 libx264 的 FFmpeg 构建时，状态仍可能显示 ready。
- AI 会以为功能可用，实际渲染时才报错。
- README 提到测试需要 libass，但运行时没有检查。

建议：

- 增加 FFmpeg filters 和 encoders 能力探测。
- 对 libx264、ass、subtitles、xfade、zoompan 等关键能力分别返回状态。
- 缺少依赖时，在 status 中提前说明，而不是等到渲染失败。

### Finding 3 — P2：保存模板记录了输出参数，但应用模板时没有恢复

位置：

- `plugins/dsh-video-studio/src/templates/library.js:59-75`
- `plugins/dsh-video-studio/src/templates/library.js:82-120`
- `plugins/dsh-video-studio/src/engine.js:170-198`

现状：

保存模板时会写入：

`output: { ...project.output }`

其中包括分辨率、画幅和 FPS。

但是 `compileTemplate` 没有读取 `template.output`，`templateApply` 也只更新时间线，没有修改目标项目的输出设置。

同时，模板保存的文字字号是绝对像素值，应用到不同分辨率的项目时不会自动缩放。

影响：

- 在不同画幅或分辨率的项目之间复用模板时，输出参数不会跟随模板。
- 文字大小可能不合适。
- 保存的 output 字段目前没有实际用途，容易让人误以为模板会完整恢复输出设置。

建议：

二选一：

1. 如果模板只负责复用时间线，就删除无用的 output 字段，并在工具说明中明确。
2. 如果模板需要复用完整画面规格，就在应用时恢复或校验画幅、分辨率和 FPS，并按目标分辨率调整文字字号。

### Finding 4 — P2：集成测试没有真正验证镜头运动和文字的视觉结果

位置：

- `plugins/dsh-video-studio/tests/production.test.js:28-35`
- `plugins/dsh-video-studio/tests/production.test.js:56-70`

现状：

测试图片由纯红色和纯蓝色生成。

测试会检查：

- 模板应用结果。
- zoom-in 参数是否保存。
- fade 转场是否保存。
- 标题是否保存在时间线。
- MP4 是否成功输出。
- 分辨率、时长和音轨。

但纯色图片没有可供观察的画面细节。即使 zoompan 被错误移除，测试仍可能通过。

测试也没有抽取输出帧来验证标题实际绘制出来。

另外，当前只验证一组两片段 fade 转场，没有覆盖平移、zoom-out、多转场连续组合等场景。

建议：

- 使用带有明显位置特征的测试图片。
- 抽取首帧、中间帧和尾帧，比较画面变化，验证 zoompan 真正生效。
- 检查文字叠加后的画面像素或生成帧。
- 增加多片段、混合转场和音频同步测试。

### 原 Finding 5 — P3：固定端口冲突判断经复核撤销（误判）

位置：

- `plugins/dsh-video-studio/tests/production.test.js:37`
- `plugins/dsh-video-studio/index.js`

复核后确认：

- `createEngine()` 本身不会启动 HTTP 工作台服务，只会把传入的 port 用于生成 status 返回的 workbenchUrl。
- HTTP 服务是在 `index.js` 的 `apply()` 中通过 `startServer()` 启动的。
- `production.test.js` 直接调用 `createEngine()`，没有启动 HTTP 服务，也就没有绑定 4174 端口。

因此，原先“本机已有工作台时会端口冲突”的判断不成立。删除测试中显式的 `port: 4174` 参数只是清理无用配置，不是修复端口冲突。该项从问题清单中撤销。

## 3. 已确认正常的部分

以下部分通过静态检查和当前 CI 结果，没有发现明显阻断问题：

- 模板 ID 使用固定格式校验，用户模板读取路径不允许直接传入任意路径。
- 模板应用会校验素材属于当前项目，并且必须是图片。
- 模板保存使用项目锁，避免保存时读取到并发修改中的项目快照。
- 模板应用最终通过 updateTimeline 的 expectedRevision 再次检查版本，避免并发覆盖。
- 时间线统一校验片段、转场和文字叠加参数。
- ASS 文本会清理花括号、反斜杠和换行，降低用户文字注入 ASS 控制标签的风险。
- FFmpeg 使用参数数组启动，不通过 Shell 拼接命令。
- 渲染使用临时目录，并在 finally 中清理临时素材。
- CI 已在安装 FFmpeg 的环境中成功完成真实 MP4 模板集成测试。

以上是代码审查结论，不代表对所有操作系统、所有 FFmpeg 构建和全部素材格式都完成了兼容性验证。

## 4. 总体结论

**PASS WITH WARNINGS**

- P1 阻断问题：本次未发现。
- P2 中等级问题：4 项（后续修复见复审报告）。
- P3 低等级问题：0 项（原端口问题已复核撤销）。

当前实现的基础链路可以在 CI 环境中运行，模板应用、渲染、保存和复用的主流程已通过集成测试。

但建议在合并 main 前处理或明确接受 P2 问题，尤其是连续转场约束和 FFmpeg 能力探测。

## 5. 后续动作

本报告记录首次只读审查结论。用户随后批准修复，已处理 4 项 P2 并补齐测试；原 P3 固定端口问题经代码路径复核后撤销。具体修改、测试结果和复审结论见 [CODE_REVIEW_RECHECK_2026-11-21.md](CODE_REVIEW_RECHECK_2026-11-21.md)。Draft PR [#1](https://github.com/wwxst/skill/pull/1) 已更新，尚未合并 main。

---

审查报告由单 Agent 完成；没有创建或声称创建独立子 Agent。
