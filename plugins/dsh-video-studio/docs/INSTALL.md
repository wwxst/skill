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

## 在设置里配置

Harness 的 **设置 → 视频制作**（Settings → Video studio）提供配置页。只有**可热更新（volatile）**字段会出现在这个页面，因为 Harness 的设置服务只把 volatile 字段渲染成表单：

| 字段 | 说明 |
| --- | --- |
| Pixabay API Key | 素材搜索和下载，保存后立即生效，写入后不再回显 |
| 模型名称 / Base URL / API Key | 图片生成服务，保存后立即生效，API Key 写入后不再回显 |

API Key 字段在 Host 侧按 `role('secret')` 脱敏，保存后不会回传浏览器；想清除就点该字段旁的「清除」。

「模型名称」旁的 **获取模型** 会读取 `Base URL` 的 `/models` 接口（OpenAI 兼容），拉到的模型作为输入建议，仍可手填。请求由本机工作台（`127.0.0.1:4174`）发起，因此 API Key 不会进入浏览器，也不需要提供方支持 CORS；如果改过工作台端口，这个按钮连不上，手填模型名即可。同一个能力也可以用工具 `video_image_models` 调用。

启动期配置不在这个页面：允许导入目录、工作台端口、数据目录、ffmpeg/ffprobe 路径请用设置页右上角的 **打开配置文件** 修改 `cordis.patch.yml`，然后重启 Harness。把它们做成 volatile 会让「保存后不重启、于是不生效」变成陷阱，所以没有这么做。

环境变量仍然有效，但配置里的值优先。

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
