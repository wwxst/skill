# Video Studio 开发交接记录

> 最近更新：2026-11-21
> 仓库：`wwxst/skill`
> 唯一正式分支：`main`
> 统一版本：`0.5.0`（旧版 0.1.0 已被替代）
> 正式合并提交：`707b2524a537477845b3a434cf555ae4c092d83a`
> PR：[已合并 #1](https://github.com/wwxst/skill/pull/1)，采用 Squash 合并
> 原 `feat/auto-video-production` 是旧开发分支，禁止作为后续安装入口。
> 新对话应以 `main` 实际文件和最新 CI 为准；当前文件是交接记录而非版本锁定声明。

## 项目目标

Video Studio 是给 DeepSeek Harness 使用的本地视频制作插件。Harness 当前模型负责选题、脚本、镜头规划和调用 Skill；插件负责素材、时间线、渲染、质量检查和发布数据反馈。它不是 Harness 内核替代品。

## 当前已实现

### 0.1 核心剪辑
- Harness 插件挂载和中文工具
- 项目、素材、时间线、revision 冲突保护
- 视频/图片/音频导入，FFmpeg MP4 渲染
- 音频混合、SRT 字幕、任务进度/取消/重试
- 本地可视化工作台

### 0.2 模板和动态画面
- 图片推近、拉远和平移
- 多种转场、ASS 动态文字
- 内置电影感模板、保存和跨项目复用
- 连续转场重叠校验、FFmpeg 能力探测、跨分辨率字号缩放

### 0.3 素材自动获取
- Pixabay 图片/视频搜索、分页、24 小时缓存
- 按需下载，限制来源域名、重定向、文件大小和文件类型
- 本地素材库、SHA-256 去重、标签和跨项目导入
- 记录素材来源、作者、来源页和 Pixabay Content License

### 0.4 AI 内容与素材生产
- Harness 模型按选题和脚本规划结构化 storyboard
- OpenAI Images API 兼容图片生成；支持自定义竖屏尺寸
- 镜头搜索/生成/素材绑定和模板填充
- 多画幅、多标题版本复制
- CapCut 拉新内容规则见 `skills/capcut-launch-tiktok/SKILL.md`

### 0.5 质量与批量生产
- 黑场、静帧、静音、音量、字幕速度和文字可读性辅助检查
- 多项目批量渲染、单项失败隔离、失败重试
- TikTok 多账号 OAuth 授权；按 accountId 隔离 state、令牌和作品读取
- OAuth state 10 分钟过期，校验原始 redirectUri；refresh token 自动轮换
- 多账号令牌文件写入串行化，避免并发授权/刷新时互相覆盖
- TikTok Display API 作品列表及播放、点赞、评论、分享指标同步
- 真实指标快照按具体账号、账号类型、项目、选题、开头和模板汇总
- 缺失的主页访问、关注、CPS 下载/注册转化保留为未提供，不伪装成 0；由业务后台补录

## 第三方授权与实机验收前准备

一次性实机验收步骤与验收记录表见 [ACCEPTANCE_CHECKLIST.md](ACCEPTANCE_CHECKLIST.md)。

以下项目代码已完成，但需要用户自己的凭据/平台权限才能实测：

1. Pixabay：`DSH_VIDEO_STUDIO_PIXABAY_API_KEY`
2. 图片生成：`DSH_VIDEO_STUDIO_IMAGE_API_KEY`；可选 Base URL / Model。图片生成会产生费用，每次调用前必须确认。
3. TikTok：在 TikTok for Developers 创建应用并获批 Login Kit、Display API 和 `user.info.basic`、`video.list`。设置 Client Key、Client Secret 和登记的 OAuth Redirect URI；运行 `video_tiktok_authorize` → 浏览器授权 → 将回调 `code/state` 交给 `video_tiktok_connect`。令牌保存在本机数据目录并自动轮换。
4. TikTok Display API 不提供主页访问、关注、下载/注册或 CPS 转化，须从业务后台补录。
5. 每个 TikTok 账号需要单独授权并分配唯一 accountId；同一个插件数据目录可保存多个账号令牌。

## 自动化验证

正式合并后的 `main` 提交 `707b2524a537477845b3a434cf555ae4c092d83a` 已通过 [GitHub Actions #44890879720](https://github.com/wwxst/skill/actions/runs/44890879720)：Windows 和 Ubuntu 均通过。合并前已验证的完整实现为 Windows 63/63、Ubuntu 63/63，0 失败。测试覆盖真实 FFmpeg MP4、美区稳定照片展示模板、镜头运动/文字、素材库去重、Pixabay 流式限制/媒体签名/API Key 脱敏、图片生成和模型配置、TikTok 多账号授权与指标同步、批量渲染和质量检查。

CI 通过不代表已完成用户 Windows + DeepSeek Harness 安装验收。最终需要在用户电脑上验证真实 FFmpeg 构建、Harness 安装、Pixabay Key、图片 API Key、TikTok OAuth 和真实素材生产。

## 明确不支持

- ASR / TTS
- CapCut / 剪映原生草稿导出
- 专业级多轨合成、节点调色和复杂特效
- 未经授权的 TikTok 私有数据抓取
- 自动发布 TikTok（当前只做制作和已发布数据同步）

## 统一版本和后续交付规则

- 用户已授权将两个分支版本统一，2026-11-21 已将 0.5.0 通过 PR #1 Squash 合并进 `main`。
- `main` 是**唯一正式安装和后续开发基线**；不再维护独立的 0.1.0，也不要向历史功能分支继续提交功能。
- 历史 `feat/auto-video-production` 仍可能存在于 GitHub 分支列表，但已不是另一套产品；可在 GitHub Branches 页面删除它，避免误用。
- 没有运行过用户 Windows + DeepSeek Harness 本机的完整验收；在正式投入批量生产前仍应按 `ACCEPTANCE_CHECKLIST.md` 实测。
- 新工作应先读取 main 的 README、ARCHITECTURE、ROADMAP 与本交接文档，再核对最新 CI，功能变更走独立 PR。

## 2026-11-21 美区模板反馈修复

- 用户实测反馈：样片《模板样片_夜色霓虹_9x16_v4.mp4》18.17 秒、1080×1920、30fps，主要是东亚霓虹街景及中文字幕；画面存在轻微跳动，内容不满足美区 CapCut 拉新/拉活需求。
- 已针对渲染流程采用图像运动 2 倍源画布采样（1080p 及以下），降低 zoompan 整数像素移动造成的细碎卡顿。
- Storyboard 默认静止镜头、不再全部强制 zoom-in，支持主动指定 motionType / motionIntensity 和最短 0.4 秒片段。
- 新增三套 `en-US` 图片转场预设：拉新结果先行、拉活照片快切、拉活回忆回顾；含 goal、locale、requiresCapCutAnchor 等元数据。
- 内容规则新增美区英文素材、差异化拉新/拉活、真实 CapCut 模板与 TikTok 系统锚点核验。
- 这些预设仅生产 MP4 视频展示，不是 CapCut 原生可编辑模板。实际 CPS/拉活转化仍依赖发布账号、可用的原生模板与平台真实锚点。
- 已在统一版 0.5.0 中通过 Windows、Ubuntu 的实际渲染测试；仍需实机检查最终照片质量、美区内容和真实 TikTok 模板/锚点。
