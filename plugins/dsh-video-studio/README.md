# Video Studio for DeepSeek Harness

一个面向 DeepSeek Harness 的本地视频制作插件。AI 通过 Harness 工具调用管理素材、编排时间线、添加字幕和音轨，并使用本机 FFmpeg 生成 MP4。

> 当前版本：`0.2.0`。目标适配 DeepSeek Harness `0.2.2-rc.5` 及兼容版本。需要 Node.js `24.9+`、FFmpeg `7+`、FFprobe `7+`。

## 能力

- 创建和管理本地视频项目，保存项目版本和时间线
- 导入视频、图片、音频，自动读取时长、分辨率、帧率和音轨信息
- 按时间线顺序拼接片段，设置源入点/出点和 0.25–4 倍恒定变速
- 图片片段支持缓慢推近、拉远和上下左右平移
- 支持淡入、溶解、擦除、滑动、圆形和像素化转场
- 支持带淡入/淡出效果的动态文字叠加
- 内置电影感图片转场模板，并可把当前图片时间线保存成跨项目复用模板
- 支持 9:16、16:9、1:1 和自定义分辨率
- 画面填充裁切或完整显示留边
- 保留视频原声，支持背景音乐和旁白混音及音量控制
- 保存 SRT 字幕，可选择烧录进视频
- 后台渲染任务、进度查询、取消和失败记录
- MP4 成片预览、下载和项目数据持久化
- 本机可视化工作台，默认地址 `http://127.0.0.1:4174`

## 不包含的能力

当前版本没有自动语音识别（ASR）、AI 语音合成（TTS）、自动选镜头、专业级多轨转场、节点调色、在线模板市场、网络素材搜索下载或剪映原生草稿导出。字幕需要提供 SRT 文本；配音和音乐需要先导入音频文件。

## 安装

请先确认：

```powershell
node --version
ffmpeg -version
ffprobe -version
```

DeepSeek Harness 当前官方主线要求 Node.js `24.9+`。FFmpeg 和 FFprobe 需要 `7+`，并且都能从 `PATH` 找到。

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

后续能力规划见 [ROADMAP](docs/ROADMAP.md)。

## 开发与验证

```sh
npm test
```

测试覆盖项目和素材导入、revision 冲突保护、真实 FFmpeg MP4 渲染、模板应用/保存/复用、图片动画与转场、路径限制，以及 Harness Host 插件挂载和工具注册。测试需要本机 FFmpeg/FFprobe，并要求 FFmpeg 构建包含 libass。

## 设计来源

本插件参考了 EAC design world 的视频生产能力划分和 AI/执行引擎分离思路；当前实现为独立代码，不包含 EAC 的源码、模板、视频、图片或第三方设计库。
