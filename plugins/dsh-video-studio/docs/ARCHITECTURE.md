# 架构说明

```text
DeepSeek Harness
  └─ Profile bundle (cordis.patch.yml)
       └─ Host plugin (index.js)
            ├─ ctx.tools.register(...) — AI 工具
            ├─ ctx.systemPrompt.section(...) — 工作流程提示
            ├─ Engine — 项目、素材、时间线、模板、任务
            ├─ Template Library — 内置预设与用户保存的 JSON 模板
            ├─ Local HTTP server — 127.0.0.1 工作台
            └─ FFmpeg / FFprobe — 实际媒体执行
```

## 边界

- Harness 负责对话、模型推理、工具调度和插件生命周期。
- 插件负责视频项目、素材路径校验、时间线数据、任务状态和本地工作台。
- Template Library 负责模板列举、保存、素材槽位映射和时间线参数编译；模板只描述内容结构，不执行媒体处理。
- FFmpeg/FFprobe 负责媒体探测、片段编码、图片镜头运动、xfade/acrossfade 转场、文字叠加、音频混合、字幕烧录和 MP4 输出。
- 插件不修改 Harness 核心，不依赖 EAC 的运行时代码。

## 持久化结构

默认数据目录为 `~/.dsh-video-studio`：

```text
.dsh-video-studio/
  projects/
    vs_<id>/
      project.json
      assets/
      outputs/
      tmp/
  templates/
    tpl_<id>.json
  jobs/
    job_<id>.json
```

`project.json` 保存项目元数据、素材引用、revision、时间线和成片记录。原素材导入时复制到项目 `assets`，源文件不修改。每次修改时间线或字幕都要求携带当前 revision，防止旧数据覆盖新数据。

## 长任务

`video_render` 只创建任务记录并返回 job ID。后台渲染过程中更新阶段和进度，`video_job_status` 读取持久化状态。插件卸载时会取消活动任务；进程意外退出后，重启时将旧的 running/queued 任务标记为 `interrupted`。
