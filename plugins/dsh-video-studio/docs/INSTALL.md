# 安装与首次运行

## 环境要求

- DeepSeek Harness：目标版本 `0.2.2-rc.5` 或兼容版本
- Node.js：`24.9+`
- FFmpeg：`7+`
- FFprobe：`7+`

## Windows 安装

1. 把 `dsh-video-studio` 文件夹解压到固定位置，例如 `D:\Apps\dsh-video-studio`。
2. 确认 `ffmpeg.exe` 和 `ffprobe.exe` 所在的 `bin` 目录已经加入系统 PATH。
3. 在 PowerShell 运行：

```powershell
node --version
ffmpeg -version
ffprobe -version
dsh plugin --profile web add "link:D:\Apps\dsh-video-studio"
```

4. 在 Harness 的 Plugins 页面确认 `Video Studio 视频制作` 已启用。
5. 对话中调用 `video_studio_status`。
6. 调用 `video_workbench_open`，在本机浏览器打开返回的地址。

## 配置可导入素材目录

默认允许用户主目录和 Harness 当前工作目录。如果素材放在其他磁盘，可在启动 Harness 前设置：

```powershell
$env:DSH_VIDEO_STUDIO_ALLOWED_ROOTS = "D:\TikTok;E:\素材库"
$env:DSH_VIDEO_STUDIO_HOME = "D:\VideoStudioData"
```

然后从同一个 PowerShell 窗口启动 Harness。也可以把变量设置到 Windows 用户环境变量中。

## 首次验证

在 Harness 对话中依次测试：

```text
调用 video_studio_status。
```

```text
创建一个名为“Video Studio 测试”的 9:16 项目。
```

```text
打开 Video Studio 工作台，告诉我地址。
```

## 常见问题

### 提示找不到 ffmpeg 或 ffprobe

确认两个程序都加入 PATH，然后完全退出并重新启动 Harness。只在终端能运行，不代表已经运行的 Harness 进程能读取新 PATH。

### 提示素材路径不在允许目录

把素材放到用户主目录或 Harness 当前工作目录，或者设置 `DSH_VIDEO_STUDIO_ALLOWED_ROOTS`。不要尝试通过路径拼接绕过目录限制。

### 4174 端口被占用

设置 `DSH_VIDEO_STUDIO_PORT` 为其他空闲端口，例如 `4175`，然后重启 Harness。

### 渲染中途 Harness 退出

插件会把未完成任务标记为 `interrupted`。当前版本不支持从中断位置续渲，需要重新提交渲染；项目和源素材会保留。
