# Video Studio 开发交接记录

> 用途：跨 ChatGPT 对话保存项目目标、当前开发状态、已完成工作、验证结果和下一步动作。新对话应先读本文，再继续操作仓库。
>
> 最近更新：2026-11-21
> 仓库：`wwxst/skill`
> 当前开发分支：`feat/auto-video-production`
> 最近一次业务修复与测试提交：`6aba5eb3a72320b1519b8f8d0a639630d155a8ec`
> 初审报告：`docs/CODE_REVIEW_2026-11-21.md`
> 修复复审报告：`docs/CODE_REVIEW_RECHECK_2026-11-21.md`
> Draft PR：[#1](https://github.com/wwxst/skill/pull/1)
> 续作时必须重新查询远程分支 HEAD；本文不把历史 SHA 当作永远最新的 HEAD。

## 1. 项目目标

本项目正在为 DeepSeek Harness 开发一个独立的视频制作插件：**Video Studio**。

核心目标是让 AI 不只是给剪辑建议，而是能通过 Harness 工具实际完成本地视频制作流程：

1. 创建视频项目并导入视频、图片、音频素材。
2. 读取素材信息，编排时间线。
3. 应用可复用模板，设置镜头运动、转场、字幕和音轨。
4. 调用本机 FFmpeg 执行渲染。
5. 查询渲染任务、检查输出文件并交付 MP4。

长期方向是逐步补齐素材获取、AI 内容与素材生产、质量检查和批量生产能力，为后续 TikTok 等视频内容自动化生产提供执行工具。插件是执行层，不负责替代 Harness 的模型推理和工具调度，也不需要重写 Harness 内核。

设计上参考了 EAC design world 对视频生产能力的划分，以及 AI 与执行引擎分离的思路；当前实现保持独立，不包含 EAC 的源码、模板、视频、图片或第三方设计库。

## 2. 仓库和分支状态

- 仓库： https://github.com/wwxst/skill
- 当前分支：`feat/auto-video-production`
- 基准：从 `main` 分支创建；当前与 `main` 的共同基准提交为 `1bf6014fc218de6f7a5d1fbdd6781dbda3b69dcb`。
- 最近一次业务修复与测试提交为 `6aba5eb3a72320b1519b8f8d0a639630d155a8ec`。
- 本轮在原始 4 项 P2 发现上完成修复，并补充测试；原报告中的端口冲突 P3 经复核确认是误判，已撤销。
- 修复复审报告：[`docs/CODE_REVIEW_RECHECK_2026-11-21.md`](CODE_REVIEW_RECHECK_2026-11-21.md)。
- `main` 未被修改；Draft PR [#1](https://github.com/wwxst/skill/pull/1) 已更新，尚未合并。续作时重新核对远程 HEAD、ahead/behind 数量和最新 CI。

不要把当前开发分支误认为已经进入 `main`。

## 3. 当前开发阶段

当前插件版本为 **0.2.0**，本轮主要完成「模板与动态画面」阶段。

### 已有的基础能力（0.1.0 核心）

- Harness 插件挂载和中文工具注册。
- 本地项目、素材、时间线及 revision 冲突保护。
- 视频、图片、音频素材导入和媒体信息读取。
- FFmpeg 顺序剪辑、视频入点/出点和恒定倍速。
- 画面比例、裁切/留边。
- 原视频声音、背景音乐、旁白混音。
- SRT 字幕保存和烧录。
- 后台渲染任务、进度查询、取消和失败状态。
- 本地可视化工作台及 MP4 输出。

### 本轮新增（0.2.0）

- 图片片段支持推近、拉远、向左/右/上/下平移。
- 支持 cut、fade、dissolve、wipe、slide、circle、pixelize 等转场。
- 支持动态文字叠加，包含开始/结束时间、位置、字号、颜色、淡入淡出。
- 新增内置「电影感图片转场」模板，支持 2–12 张图片。
- 支持将当前图片时间线保存为 JSON 模板，并在其他项目复用。
- 对镜头运动、转场、文字叠加参数做统一校验。
- 相邻片段两侧的转场时长总和不得超过中间片段时长，避免转场重叠。
- 启动状态会实际探测 libx264、libass、xfade、zoompan、acrossfade、amix 等关键能力，并列出缺失依赖。
- 保存模板记录参考画布高度；应用到不同分辨率项目时按目标画布高度缩放文字字号，不覆盖目标项目的画幅、分辨率和 FPS。
- 更新 Harness 工具定义和系统提示，引导 AI 优先查看和应用模板。

新增工具：

- `video_template_list`：列出内置模板和用户保存的模板。
- `video_template_save`：把当前项目的图片时间线保存为模板。
- `video_template_apply`：将模板映射到当前项目已导入的图片素材。

主要实现文件：

- `src/templates/schema.js`：镜头运动、转场、文字参数校验和时间线时长计算。
- `src/templates/library.js`：模板列举、保存、读取和应用编译。
- `src/templates/presets/cinematic-photo.json`：内置电影感图片模板。
- `src/store.js`：时间线状态持久化。
- `src/engine.js`：暴露模板业务方法。
- `src/tools.js`：注册模板工具、扩展时间线参数和 AI 工作流程提示。
- `src/render.js`：FFmpeg 图片镜头运动、转场、ASS 文字叠加和最终合成。
- `tests/production.test.js`：真实 FFmpeg 模板渲染和模板复用集成测试。

## 4. 测试和验证状态

GitHub Actions 已配置工作流：

- 文件：`.github/workflows/video-studio.yml`
- Workflow：Video Studio tests
- 修复代码与测试提交：`6aba5eb3a72320b1519b8f8d0a639630d155a8ec`
- GitHub Actions：[运行 #44859388937](https://github.com/wwxst/skill/actions/runs/44859388937) — **success**
- GitHub Actions：[运行 #44859393540](https://github.com/wwxst/skill/actions/runs/44859393540) — **success**
- 两次运行均完成 Node.js 安装、FFmpeg 安装和 `npm test`。
- 测试结果：**9 passed / 0 failed**，包含真实 MP4 渲染、zoompan 画面变化、ASS 文字像素验证、FFmpeg 能力探测、连续转场边界和跨分辨率模板复用。
- 仍未完成用户本机 Windows / DeepSeek Harness 安装验收。续作时检查最新 CI。

新增的生产集成测试会生成两张测试图片，应用内置模板，执行真实 MP4 渲染，检查画面尺寸、时长和音轨，然后保存模板并在另一个项目中再次应用。

注意：
- CI 通过表示仓库中的自动化测试在 GitHub Actions 环境通过。
- 尚不能据此声称已经在用户本机的 Windows / DeepSeek Harness 环境完成安装验收。
- 尚未完成用户本机 Windows / DeepSeek Harness 安装验收。

## 5. 当前明确不支持的能力

不要把规划能力说成已经实现。当前 README 明确列出的缺口包括：

- 自动语音识别（ASR）。
- AI 语音合成（TTS）。
- 自动选镜头。
- 在线模板市场。
- 网络素材搜索和下载。
- 专业级多轨合成、节点调色和复杂特效系统。
- CapCut / 剪映原生草稿或模板工程导出。

当前字幕需要提供 SRT，音乐和旁白需要先导入音频文件。用户保存模板目前只支持 2–12 个图片片段；不能把它描述成通用视频工程模板。

## 6. 后续路线

以 `docs/ROADMAP.md` 为准：

### 下一阶段 0.3：素材自动获取

- 素材搜索提供方接口。
- Pixabay API 搜索和按需下载。
- 本地素材库、标签、去重。
- 记录素材来源和授权信息。

### 之后 0.4：AI 内容与素材生产

- 根据选题和脚本自动生成镜头清单。
- 接入 AI 图片生成提供方。
- 按镜头需求搜索、生成和筛选素材。
- 自动填充模板参数，支持多版本生产。

### 之后 0.5：质量检查与批量生产

- 黑场、静帧、画面异常、音频响度检查。
- 字幕安全区和可读性检查。
- 批量渲染、失败重试和任务恢复。
- 连接 TikTok 内容知识库、选题 Skill 和真实发布数据反馈。

暂不纳入训练专用视频模型、重写 Harness 内核、CapCut 原生草稿格式和专业级节点调色系统。

## 7. 当前阻塞 / 待办

1. **单 Agent 初审和修复复审均已完成。** 没有创建或声称创建独立子 Agent。
2. 初审报告见 [`docs/CODE_REVIEW_2026-11-21.md`](CODE_REVIEW_2026-11-21.md)；修复复审见 [`docs/CODE_REVIEW_RECHECK_2026-11-21.md`](CODE_REVIEW_RECHECK_2026-11-21.md)。
3. 初审的 4 项 P2 已修复并通过测试：
   - 连续转场重叠校验。
   - FFmpeg 编码器和滤镜能力探测。
   - 模板只复用时间线样式，保留目标画布并按高度缩放字号，同时兼容旧模板。
   - 使用实际输出帧验证镜头运动和文字渲染。
4. 初审中的固定端口 P3 经复核撤销：生产集成测试直接创建 Engine，并不启动 HTTP 工作台服务，不会占用 4174 端口。
5. 最新修复代码提交 `6aba5eb3a72320b1519b8f8d0a639630d155a8ec` 的 CI 两次均成功，9 项测试全部通过。用户本机 Windows / DeepSeek Harness 验收仍待完成。
6. Draft PR [#1](https://github.com/wwxst/skill/pull/1) 已更新，未合并 main。下一步等待用户检查 PR；未经用户明确批准，不合并 main。

## 8. 新对话继续工作的要求

新对话开始时，先读取本文件以及：

- `plugins/dsh-video-studio/README.md`
- `plugins/dsh-video-studio/docs/ARCHITECTURE.md`
- `plugins/dsh-video-studio/docs/ROADMAP.md`

然后重新核对：

1. 远程 `feat/auto-video-production` 当前 HEAD。
2. 当前分支与 `main` 的差异。
3. 最新 GitHub Actions 运行结果。
4. 工作区和文件是否有其他会话的新改动。

**不要只根据本交接文档中的旧 SHA 判断仓库现状。** 本文是截至更新时间的快照，远程仓库才是最新代码事实来源。

### 可直接用于新对话的继续指令

> 继续开发 `wwxst/skill` 仓库的 Video Studio 插件。先读取 `plugins/dsh-video-studio/docs/DEVELOPMENT_HANDOFF.md`、插件 README、架构文档、Roadmap、`docs/CODE_REVIEW_2026-11-21.md` 和 `docs/CODE_REVIEW_RECHECK_2026-11-21.md`，再核对 GitHub 远程分支、diff 和最新 CI。0.2.0「模板与动态画面」已实现；初审发现的 4 项 P2 已修复，原 P3 端口冲突判断已撤销；最新 CI 9 项测试全部通过。Draft PR [#1](https://github.com/wwxst/skill/pull/1) 已更新，尚未合并 main。先汇报最新状态，等待用户检查 PR。未经明确批准，不要合并 main。

---

最后更新：2026-11-21
