# Video Studio 开发交接记录

> 最近更新：2026-11-21
> 仓库：`wwxst/skill`
> 分支：`feat/auto-video-production`
> 当前开发版本：`0.5.0`
> 交接时远程 HEAD：`8e474acf9640de86b104b06296a998ca69b55949`
> PR：[Draft #1](https://github.com/wwxst/skill/pull/1)
> 新对话必须重新核对远程 HEAD、main 差异和最新 CI。

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
- TikTok OAuth 授权链接、state 校验、授权码兑换和 refresh token 自动轮换
- TikTok Display API 作品列表及播放、点赞、评论、分享指标同步
- 真实指标快照按项目、账号类型、选题、开头和模板汇总
- 缺失的主页访问、关注、CPS 下载/注册转化保留为未提供，不伪装成 0；由业务后台补录

## 第三方授权与实机验收前准备

以下项目代码已完成，但需要用户自己的凭据/平台权限才能实测：

1. Pixabay：`DSH_VIDEO_STUDIO_PIXABAY_API_KEY`
2. 图片生成：`DSH_VIDEO_STUDIO_IMAGE_API_KEY`；可选 Base URL / Model。图片生成会产生费用，每次调用前必须确认。
3. TikTok：在 TikTok for Developers 创建应用并获批 Login Kit、Display API 和 `user.info.basic`、`video.list`。设置 Client Key、Client Secret 和登记的 OAuth Redirect URI；运行 `video_tiktok_authorize` → 浏览器授权 → 将回调 `code/state` 交给 `video_tiktok_connect`。令牌保存在本机数据目录并自动轮换。
4. TikTok Display API 不提供主页访问、关注、下载/注册或 CPS 转化，须从业务后台补录。

## 自动化验证

当前最近一次已确认成功的 CI 需要以 GitHub Actions 最新 HEAD 结果为准。测试覆盖真实 FFmpeg MP4、模板、镜头运动/文字像素、素材库去重、Pixabay、安全下载、图片生成响应校验、TikTok OAuth/分页/令牌轮换、TikTok 指标端到端同步、批量渲染和质量检查。

CI 通过不代表已完成用户 Windows + DeepSeek Harness 安装验收。最终需要在用户电脑上验证真实 FFmpeg 构建、Harness 安装、Pixabay Key、图片 API Key、TikTok OAuth 和真实素材生产。

## 明确不支持

- ASR / TTS
- CapCut / 剪映原生草稿导出
- 专业级多轨合成、节点调色和复杂特效
- 未经授权的 TikTok 私有数据抓取
- 自动发布 TikTok（当前只做制作和已发布数据同步）

## 分支和交付规则

- 当前开发分支：`feat/auto-video-production`
- `main` 未修改；PR #1 仍为 Draft，未合并。
- 未经用户明确批准，不合并 main、不发布正式版本。
- 继续工作前读取本文件、README、ARCHITECTURE、ROADMAP，再核对远程 HEAD、diff、最新 CI。
