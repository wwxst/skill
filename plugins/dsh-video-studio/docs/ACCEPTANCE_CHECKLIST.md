# Video Studio 0.5.0 实机验收清单

> 目的：开发分支自动化验证通过后，在用户 Windows + DeepSeek Harness 环境一次性完成验收。
> 适用分支：`feat/auto-video-production`

## 1. 验收前准备

- Windows 已安装 Node.js 24.9+。
- FFmpeg / FFprobe 7+，并且 FFmpeg 构建包含 `libx264`、`libass`、`ass`、`subtitles`、`xfade`、`zoompan`、`acrossfade`、`amix`。
- 从当前开发分支安装插件，重启 DeepSeek Harness。
- 在 Harness 插件列表中确认 Video Studio 已启用。

PowerShell 检查：

```powershell
node --version
ffmpeg -version
ffprobe -version
ffmpeg -filters | Select-String "ass|subtitles|xfade|zoompan|acrossfade|amix"
ffmpeg -encoders | Select-String "libx264"
```

## 2. 外部服务配置

在 PowerShell 当前窗口临时配置，完成验收后可改成用户级环境变量：

```powershell
$env:DSH_VIDEO_STUDIO_ALLOWED_ROOTS = "D:\TikTok;E:\素材"
$env:DSH_VIDEO_STUDIO_PIXABAY_API_KEY = "你的 Pixabay API Key"
$env:DSH_VIDEO_STUDIO_IMAGE_API_KEY = "你的图片生成 API Key"
$env:DSH_VIDEO_STUDIO_IMAGE_MODEL = "gpt-image-2.6-flare"
$env:DSH_VIDEO_STUDIO_TIKTOK_CLIENT_KEY = "你的 TikTok Client Key"
$env:DSH_VIDEO_STUDIO_TIKTOK_CLIENT_SECRET = "你的 TikTok Client Secret"
```

配置后从这个 PowerShell 窗口启动 Harness，或将变量保存为用户环境变量后重新登录。不要把密钥粘贴到普通对话、项目文档或 Git 仓库。

TikTok 还需要在开发者后台登记 OAuth Redirect URI，并获批 Login Kit、Display API 和 `video.list` 权限。授权时运行 `video_tiktok_authorize`，浏览器完成授权后把回调 URL 中的 `code`、`state` 和完全相同的 `redirectUri` 交给 `video_tiktok_connect`。

## 3. 一次性端到端验收

按顺序完成并记录结果：

1. **环境检查**：调用 `video_studio_status`。本地渲染、字幕、音频、转场和文字能力应全部可用；Pixabay、图片生成、TikTok 状态应与实际配置一致。
2. **项目和本地素材**：创建 9:16 项目；从允许目录导入一张图片、一段视频和一段音频；读取项目，确认媒体信息和 revision 正常。
3. **Pixabay**：搜索竖屏图片或视频，确认搜索结果有作者、来源页和授权信息；下载一项并确认进入素材库。
4. **图片生成**：先明确确认本次可能产生 API 费用，再生成一张竖屏图片；确认素材被保存到素材库并导入项目。
5. **镜头清单**：CapCut 拉新内容按 `skills/capcut-launch-tiktok/SKILL.md` 规划；创建 storyboard，绑定素材，应用到时间线。检查字幕、转场、镜头运动和音轨。
6. **单项目渲染**：提交 MP4 渲染，轮询任务到终态；确认文件能播放、时长/画幅/音轨正确。
7. **质量检查**：运行 `video_quality_check`，检查黑场、静帧、静音、响度、字幕阅读速度和文字可读性结果。自动检查是提示，不替代人工审片。
8. **多版本和批量**：复制 9:16、1:1 或 16:9 版本，提交批量渲染；确认单项结果分别记录，失败项可单独重试。
9. **TikTok 数据**：完成 OAuth 后读取授权账号作品；将一条已发布作品的 videoId 映射到对应项目，运行 `video_tiktok_sync`；确认播放、点赞、评论、分享指标和来源标记正确。
10. **业务转化补录**：通过 `video_performance_record` 补录业务后台的主页访问、关注、下载、注册或 CPS 转化数据；运行 `video_performance_summary`，确认项目号与中视频号分开统计，缺失指标显示为空而不是 0。

## 4. 验收边界

以下能力当前不在 0.5.0 范围内，不作为本轮验收失败项：

- 自动语音识别（ASR）和 AI 语音合成（TTS）。
- TikTok 自动发布。
- CapCut / 剪映原生草稿导出。
- 专业级多轨合成、节点调色和复杂特效。
- TikTok Display API 无权提供的主页访问、关注和 CPS 转化；这些需要业务后台数据补录。

## 5. 验收记录

| 项目 | 结果 | 备注 |
|---|---|---|
| Harness 安装和插件加载 | 待验收 | |
| FFmpeg / FFprobe 能力 | 待验收 | |
| 本地素材导入 | 待验收 | |
| Pixabay 搜索与下载 | 待验收 | |
| AI 图片生成 | 待验收 | |
| Storyboard 到时间线 | 待验收 | |
| MP4 渲染与质量检查 | 待验收 | |
| 多版本批量渲染 | 待验收 | |
| TikTok OAuth 与数据同步 | 待验收 | |
| CPS 转化数据补录与统计 | 待验收 | |

验收完成后再决定是否将 PR 从 Draft 转为 Ready，并由用户明确批准后再合并 main。
