# Video Studio for DeepSeek Harness

一个面向 DeepSeek Harness 的本地视频制作插件。AI 通过 Harness 工具调用管理素材、编排时间线、添加字幕和音轨，并使用本机 FFmpeg 生成 MP4。

> 当前唯一正式版本：`0.5.0`（仓库 `main` 分支，旧版 `0.1.0` 已替代）。目标适配 DeepSeek Harness `0.2.2-rc.5` 及兼容版本。需要 Node.js `24.9+`、FFmpeg `7+`、FFprobe `7+`。

## 能力

- 创建和管理本地视频项目，保存项目版本和时间线
- 导入视频、图片、音频，自动读取时长、分辨率、帧率和音轨信息
- 按时间线顺序拼接片段，设置源入点/出点和 0.25–4 倍恒定变速
- 图片片段支持缓慢推近、拉远和上下左右平移
- 支持淡入、溶解、擦除、滑动、圆形和像素化转场
- 支持带淡入/淡出效果的动态文字叠加
- 内置电影感图片转场模板，并可把当前图片时间线保存成跨项目复用模板；应用模板时保留目标项目的画幅、分辨率和 FPS，文字字号按目标画布高度自动缩放
- 支持 9:16、16:9、1:1 和自定义分辨率
- 画面填充裁切或完整显示留边
- 保留视频原声，支持背景音乐和旁白混音及音量控制
- 保存 SRT 字幕，可选择烧录进视频
- 后台渲染任务、进度查询、取消和失败记录
- MP4 成片预览、下载和项目数据持久化
- 本机可视化工作台，默认地址 `http://127.0.0.1:4174`
- Pixabay 图片/视频搜索下载、24 小时缓存、来源和授权记录
- 本地素材库、SHA-256 去重、标签和跨项目导入
- AI 镜头清单、图片生成、素材绑定和模板自动填充
- 多画幅项目复制、批量渲染和失败任务重试
- 黑场、静帧、静音、音量、字幕阅读速度和文字可读性检查
- 多个 TikTok 账号独立 OAuth 授权、令牌轮换和隔离保存
- TikTok 官方作品列表及播放、点赞、评论、分享数据同步
- 真实发布数据快照按具体账号、账号类型、选题、开头和模板统计

模板只复用图片时间线、镜头运动、转场和文字样式，不会修改目标项目的画幅、分辨率或 FPS。保存模板时会记录原画布高度，应用到其他分辨率时按目标画布高度等比例调整文字字号（限制在 20–120）。

## 不包含的能力

当前版本没有自动语音识别（ASR）、AI 语音合成（TTS）、专业级多轨转场、节点调色、在线模板市场或剪映原生草稿导出。字幕需要提供 SRT 文本；配音和音乐需要先导入音频文件。TikTok Display API 不提供主页访问、关注和 CPS 转化数据，这些指标需要通过 video_performance_record 补录。

## 安装

请先确认：

```powershell
node --version
ffmpeg -version
ffprobe -version
```

DeepSeek Harness 当前官方主线要求 Node.js `24.9+`。FFmpeg 和 FFprobe 需要 `7+`，并且都能从 `PATH` 找到；FFmpeg 还需要包含 `libx264`、`libass` 及本插件使用的转场、镜头运动和音频滤镜。运行 `video_studio_status` 会实际探测这些依赖，并列出不可用的功能。

1. 解压插件目录，例如 `D:\Apps\dsh-video-studio`。
2. 打开 PowerShell，运行安装脚本（默认安装到 `web` profile）：

```powershell
.\scripts\install.ps1 -Profile web
```

也可以直接执行 Harness 命令：

```powershell
dsh plugin --profile web add "link:D:\Apps\dsh-video-studio"
```

如果你的 profile 不是 `web`，把命令中的 profile 名称换成实际使用的名称。安装后在 Harness 的 Plugins 页面检查 `Video Studio 视频制作` 是否启用。

3. 重新打开或重新组合当前 Harness profile，然后在对话中发送：

```text
调用 video_studio_status，检查 Video Studio 是否安装成功，以及 FFmpeg 和 FFprobe 是否可用。
```

4. 打开可视化工作台：

```text
调用 video_workbench_open，告诉我工作台地址。
```

默认地址：`http://127.0.0.1:4174`。工作台只能从运行 Harness 的这台电脑访问。


## US TikTok CapCut 模板制作（拉新 / 拉活）

新内置模板在 `video_template_list` 中标记 `locale=en-US` 和 `goal`：

| 模板 | goal | 图片槽位 | 内容结构 |
|---|---|---:|---|
| `us-photo-reveal-acquisition` | `acquisition` | 4 | 先出结果 → 原图 → 变换 → 结果；英文教学型钩子 |
| `us-photo-transition-activation` | `activation` | 7 | 短切与轻擦除，让照片在节奏点出现明显变化 |
| `us-photo-memory-recap` | `activation` | 6 | 美国受众常见的个人照片回顾、毕业、宠物、旅行等主题 |

美区模板默认静帧，不会对每张图强制推近。仅手动选择轻微镜头运动时才使用 2 倍渲染采样（在常见 1080p 画幅内）减少像素级跳动。

**重要：** 这三套是可复用的 MP4 视频展示剪辑预设，**不是** CapCut 可上传/分享的原生模板文件，也不能自动给 TikTok 视频挂系统级 CapCut 锚点。拉新必须先有真实有效的 CapCut 模板和发布锚点，才能加对应 CTA。拉活展示也应关联实际可用模板。主题、英文用语、真人素材授权和歌曲商业使用许可均需核实。

制作流程和拉新/拉活差异参考 [US_CAPCUT_TEMPLATE_GUIDE](docs/US_CAPCUT_TEMPLATE_GUIDE.md)。

## TikTok 内容 Skill 与数据连接

本仓库包含 `skills/capcut-launch-tiktok/SKILL.md`。制作 CapCut 拉新项目时，应在 DeepSeek Harness 中启用该 Skill，并按其锚点前置、短句字幕、教程型结构、搜索简介和视觉安全区规则生成镜头与字幕。Video Studio 负责执行素材导入、镜头时间线、字幕、渲染和质量检查；内容策略仍由 Harness 当前模型与 Skill 提供。中视频账号使用独立的流量目标，不套用 CapCut CPS 拉新 CTA。

## TikTok 数据连接

1. 在 TikTok for Developers 创建应用，申请 Login Kit 和 Display API，并取得 `user.info.basic`、`video.list` 权限。
2. 将 TikTok OAuth Redirect URI 配置为 HTTPS 回调地址，并设置 Client Key、Client Secret 环境变量。
3. 给每个账号指定唯一的 `accountId`，例如 `capcut-project-01`、`mid-video-01`。分别调用 `video_tiktok_authorize` 生成授权链接，浏览器登录对应账号并同意授权。
4. TikTok 回调后，将 URL 中的 `code`、`state`、原始 `redirectUri` 和相同的 `accountId` 交给 `video_tiktok_connect`。state 10 分钟过期，回调地址必须与授权时一致。
5. 调用 `video_tiktok_video_list` 时指定 `accountId`；同步时在每条 `video_tiktok_sync` mapping 中指定作品所属账号。不同账号的令牌和作品数据彼此隔离。
6. 主页访问、关注、下载、注册和 CPS 转化由业务后台提供时，通过 `video_performance_record` 补录，并填写相同的 `accountId`。

令牌按账号保存在本机数据目录的 `integrations/tiktok-token.json`，refresh token 轮换后自动更新；工具不会返回令牌。可通过 `video_studio_status` 查看已连接账号的标识和授权 scope。权限和字段以 [TikTok Display API 文档](https://developers.tiktok.com/docs/en/display-api-overview) 为准。

## 常用工具

| 工具 | 作用 |
| --- | --- |
| `video_studio_status` | 检查环境和可用能力 |
| `video_project_create` | 创建项目 |
| `video_project_list` | 列出项目 |
| `video_project_get` | 读取项目、素材、时间线和 revision |
| `video_template_list` | 列出内置和已保存模板 |
| `video_template_save` | 把当前图片时间线保存为可复用模板 |
| `video_template_apply` | 将模板应用到当前项目 |
| `video_asset_import` | 导入视频、图片或音频 |
| `video_asset_probe` | 重新读取媒体信息 |
| `video_timeline_update` | 保存剪辑时间线和音轨 |
| `video_subtitles_set` | 保存 SRT 字幕 |
| `video_render` | 提交 MP4 渲染任务 |
| `video_job_status` | 查询任务状态和进度 |
| `video_job_cancel` | 取消渲染任务 |
| `video_output_list` | 列出成片 |
| `video_workbench_open` | 返回工作台地址 |
| `video_media_search` / `video_media_download` | 搜索并下载 Pixabay 素材 |
| `video_library_add` / `video_library_list` / `video_library_tag` / `video_library_import` | 管理中央素材库 |
| `video_storyboard_create` / `video_storyboard_get` / `video_storyboard_apply` | 创建、读取并应用 AI 镜头清单 |
| `video_image_generate` | 生成图片并导入素材库（需确认费用） |
| `video_project_duplicate` / `video_batch_render` | 复制多画幅版本并批量渲染 |
| `video_job_retry` / `video_quality_check` | 重试失败任务并检查成片 |
| `video_performance_record` / `video_performance_summary` | 记录真实发布数据并按账号/内容维度分析 |
| `video_tiktok_authorize` | 生成 TikTok OAuth 授权链接 |
| `video_tiktok_connect` | 兑换授权码并保存本机令牌 |
| `video_tiktok_video_list` | 读取授权账号作品及基础互动数据 |
| `video_tiktok_sync` | 将作品指标快照关联到项目 |

## 给 AI 的示例需求

```text
先检查 Video Studio 环境。创建一个 9:16 的 TikTok 项目，
把 D:\TikTok\素材 目录里的视频导入项目，读取每条素材的时长，
按素材内容安排剪辑顺序，保留原视频声音，背景音乐音量设为 0.15。
生成时间线后先告诉我预计时长，等我确认后再渲染 MP4。
```

AI 需要按下面流程工作：

1. 检查环境。
2. 创建项目并导入素材。
3. 读取素材信息，规划片段；需要复用结构时先调用 `video_template_list`。
4. 读取当前 revision 后调用 `video_template_apply`，或使用 `video_timeline_update` 自定义动画、转场和文字。
5. 需要字幕时保存 SRT。
6. 提交渲染任务并轮询到终态。
7. 检查输出文件和实际媒体信息。

## 路径与环境配置

默认只允许从用户主目录、Harness 当前工作目录导入素材。也可以通过环境变量增加目录：

| 环境变量 | 作用 |
| --- | --- |
| `DSH_VIDEO_STUDIO_HOME` | 项目和任务数据目录，默认 `~/.dsh-video-studio` |
| `DSH_VIDEO_STUDIO_ALLOWED_ROOTS` | 额外允许导入素材的目录；Windows 用分号分隔，macOS/Linux 用冒号分隔 |
| `DSH_VIDEO_STUDIO_FFMPEG` | 自定义 FFmpeg 可执行文件路径 |
| `DSH_VIDEO_STUDIO_FFPROBE` | 自定义 FFprobe 可执行文件路径 |
| `DSH_VIDEO_STUDIO_PORT` | 工作台端口，默认 `4174` |
| `DSH_VIDEO_STUDIO_PIXABAY_API_KEY` | Pixabay API Key，用于搜索和下载素材 |
| `DSH_VIDEO_STUDIO_IMAGE_API_KEY` | 图片生成服务 API Key |
| `DSH_VIDEO_STUDIO_IMAGE_BASE_URL` | 图片生成 API Base URL，默认 `https://api.openai.com/v1` |
| `DSH_VIDEO_STUDIO_IMAGE_MODEL` | 图片生成模型名称 |
| `DSH_VIDEO_STUDIO_TIKTOK_CLIENT_KEY` | TikTok 开发者应用 Client Key |
| `DSH_VIDEO_STUDIO_TIKTOK_CLIENT_SECRET` | TikTok 开发者应用 Client Secret |
| `DSH_VIDEO_STUDIO_TIKTOK_ACCESS_TOKEN` | TikTok OAuth 用户 Access Token，仅用于默认账号 `default` |
| `DSH_VIDEO_STUDIO_TIKTOK_REFRESH_TOKEN` | 默认账号的 TikTok OAuth Refresh Token；轮换后保存在本地 integrations/tiktok-token.json。其他账号通过 OAuth 工具按 accountId 授权 |

例如 Windows：

```powershell
$env:DSH_VIDEO_STUDIO_ALLOWED_ROOTS = "D:\TikTok;E:\素材库"
$env:DSH_VIDEO_STUDIO_HOME = "D:\VideoStudioData"
```

设置环境变量后，需要重启 Harness 进程让插件读取新值。macOS/Linux 可以运行 `bash scripts/install.sh web` 执行环境检查和安装。

## 数据和安全

- 插件只监听 `127.0.0.1`，不对局域网或公网开放工作台端口。
- 工作台拒绝非本机 Host 和跨站写请求，不提供任意文件读取接口。
- 导入素材时会检查真实路径是否位于允许目录中，再复制到项目目录。
- 原始素材不会被改写；渲染文件写入项目的 `outputs` 目录。
- 插件卸载时会取消正在执行的渲染任务。
- 进程重启后，未完成的任务会标记为 `interrupted`，不会假装自动续跑。

后续能力规划见 [ROADMAP](docs/ROADMAP.md)。跨对话开发进度和继续工作说明见 [DEVELOPMENT_HANDOFF](docs/DEVELOPMENT_HANDOFF.md)。首次代码审查见 [CODE_REVIEW_2026-11-21](docs/CODE_REVIEW_2026-11-21.md)，修复复审见 [CODE_REVIEW_RECHECK_2026-11-21](docs/CODE_REVIEW_RECHECK_2026-11-21.md)，0.5.0 当前版本复核见 [CODE_REVIEW_0.5.0_2026-11-21](docs/CODE_REVIEW_0.5.0_2026-11-21.md)。实机验收步骤见 [ACCEPTANCE_CHECKLIST](docs/ACCEPTANCE_CHECKLIST.md)。

## 开发与验证

```sh
npm test
```

测试覆盖项目和素材导入、revision 冲突保护、真实 FFmpeg MP4 渲染、模板应用/保存/复用、图片动画与转场、路径限制，以及 Harness Host 插件挂载和工具注册。测试需要本机 FFmpeg/FFprobe，并要求 FFmpeg 构建包含 libass。

## 设计来源

本插件参考了 EAC design world 的视频生产能力划分和 AI/执行引擎分离思路；当前实现为独立代码，不包含 EAC 的源码、模板、视频、图片或第三方设计库。
