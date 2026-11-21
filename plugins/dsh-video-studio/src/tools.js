const object = (properties = {}, required = []) => ({
  type: 'object', properties, required, additionalProperties: false,
});
const string = (description, extra = {}) => ({ type: 'string', description, ...extra });
const number = (description, extra = {}) => ({ type: 'number', description, ...extra });
const boolean = (description) => ({ type: 'boolean', description });
const enumString = (description, values) => ({ type: 'string', enum: values, description });

const output = {
  schema: {},
  render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
};

function definition(name, description, properties, required, execute, isConcurrencySafe = false) {
  return {
    name,
    description,
    parameters: object(properties, required),
    output,
    isConcurrencySafe: () => isConcurrencySafe,
    async execute(args, execution) {
      execution?.signal?.throwIfAborted();
      return execute(args, execution);
    },
  };
}

export function createToolDefinitions(engine) {
  return [
    definition(
      'video_studio_status',
      '检查 Video Studio 是否正常运行，返回 FFmpeg/FFprobe 状态、素材允许目录、工作台地址和当前已实现能力。制作前先调用。',
      {}, [],
      () => engine.status(), true,
    ),
    definition(
      'video_project_create',
      '创建本地视频项目。默认 9:16 竖屏 1080x1920；也支持 16:9、1:1 或自定义偶数宽高。',
      {
        title: string('项目名称'),
        brief: string('视频目标、受众、内容要求等简报，可选'),
        aspectRatio: enumString('画幅比例，默认 9:16', ['9:16', '16:9', '1:1']),
        width: number('自定义宽度，必须与 height 一起提供，128–3840 的偶数'),
        height: number('自定义高度，必须与 width 一起提供，128–3840 的偶数'),
        fps: number('帧率，1–60，默认 30'),
      }, ['title'],
      (args) => engine.createProject(args),
    ),
    definition(
      'video_project_list',
      '列出本机 Video Studio 项目，返回项目 ID、名称、版本、素材数量和成片数量。',
      {}, [],
      () => engine.listProjects(), true,
    ),
    definition(
      'video_project_get',
      '读取项目详情、素材清单、时间线、修订号和历史成片。修改时间线或字幕前先读取项目。',
      { projectId: string('项目 ID') }, ['projectId'],
      (args) => engine.getProject(args.projectId), true,
    ),
    definition(
      'video_template_list',
      '列出内置和已保存的视频模板。',
      {}, [],
      () => engine.templateList(), true,
    ),
    definition(
      'video_template_save',
      '把当前项目的图片时间线保存成可跨项目复用的模板。保存前必须先读取项目 revision。',
      {
        projectId: string('项目 ID'),
        expectedRevision: number('video_project_get 返回的当前 revision'),
        name: string('模板名称'),
        description: string('模板说明，可选'),
      }, ['projectId', 'expectedRevision', 'name'],
      (args) => engine.templateSave(args),
    ),
    definition(
      'video_template_apply',
      '把模板应用到当前项目。assetIds 按模板槽位顺序提供本项目已导入的图片素材 ID；内置电影感模板支持 2–12 张图片。',
      {
        projectId: string('项目 ID'),
        expectedRevision: number('video_project_get 返回的当前 revision'),
        templateId: string('video_template_list 返回的模板 ID'),
        assetIds: { type: 'array', minItems: 2, maxItems: 12, items: string('项目内已导入的图片素材 ID') },
        title: string('可选标题，仅内置电影感模板使用'),
        durationPerImage: number('内置模板每张图片时长 2–15 秒，默认 3.5 秒'),
      }, ['projectId', 'expectedRevision', 'templateId', 'assetIds'],
      (args) => engine.templateApply(args),
    ),
    definition(
      'video_asset_import',
      '把本机视频、图片或音频复制到项目素材目录，不修改原文件。sourcePath 必须位于 Video Studio 允许目录中；默认允许用户主目录和当前工作目录，可在插件配置 allowedRoots 扩展。导入后会自动读取媒体信息。',
      {
        projectId: string('项目 ID'),
        sourcePath: string('本机素材的绝对路径'),
        role: enumString('素材类型', ['video', 'image', 'audio']),
        label: string('素材显示名称，可选'),
      }, ['projectId', 'sourcePath', 'role'],
      (args) => engine.importAsset(args),
    ),
    definition(
      'video_asset_probe',
      '重新读取指定素材的时长、分辨率、帧率、编码和音频信息。',
      { projectId: string('项目 ID'), assetId: string('素材 ID') }, ['projectId', 'assetId'],
      (args) => engine.assetProbe(args),
    ),
    definition(
      'video_timeline_update',
      '设置项目剪辑时间线。必须先 video_project_get 读取当前 revision。支持图片推拉/平移动画、片段间转场、动态文字叠加、背景音乐和旁白。',
      {
        projectId: string('项目 ID'),
        expectedRevision: number('video_project_get 返回的当前 revision'),
        clips: {
          type: 'array', minItems: 1, maxItems: 100,
          description: '按播放顺序排列的片段。视频需要 assetId，可选 sourceIn/sourceOut/speed；图片需要 assetId 和 duration。',
          items: {
            type: 'object',
            properties: {
              assetId: string('已导入的视频或图片素材 ID'),
              sourceIn: number('源素材入点秒数，默认 0'),
              sourceOut: number('源素材出点秒数，默认素材结尾；视频片段使用'),
              speed: number('播放速度 0.25–4，默认 1；1.5 表示 1.5 倍速'),
              duration: number('图片片段显示时长秒数，图片必填'),
              fit: enumString('该片段画面适配，可覆盖全局 fit', ['crop', 'contain']),
              motion: {
                type: 'object',
                properties: {
                  type: enumString('镜头运动', ['none', 'zoom-in', 'zoom-out', 'pan-left', 'pan-right', 'pan-up', 'pan-down']),
                  intensity: number('运动强度 0.05–0.25，默认 0.12'),
                },
                required: ['type'],
                additionalProperties: false,
              },
            },
            required: ['assetId'],
            additionalProperties: false,
          },
        },
        transitions: {
          type: 'array', maxItems: 99,
          description: '每两个相邻片段之间一个转场；省略或空数组表示全部硬切。非 cut 转场会产生时间重叠。',
          items: {
            type: 'object',
            properties: {
              type: enumString('转场类型', ['cut', 'fade', 'dissolve', 'wipeleft', 'wiperight', 'slideleft', 'slideright', 'circleopen', 'circleclose', 'pixelize']),
              duration: number('转场时长秒数，0–2；cut 必须为 0'),
            },
            required: ['type', 'duration'],
            additionalProperties: false,
          },
        },
        overlays: {
          type: 'array', maxItems: 20,
          description: '动态文字叠加，时间范围必须在最终视频时长内。',
          items: {
            type: 'object',
            properties: {
              text: string('显示文字，最多 200 字'),
              start: number('开始时间秒数'),
              end: number('结束时间秒数'),
              position: enumString('文字位置', ['top', 'center', 'bottom']),
              animation: enumString('文字动画', ['none', 'fade-in', 'fade-out', 'fade-in-out']),
              fontSize: number('字号 20–120，默认 56'),
              color: string('文字颜色，#RRGGBB 格式，默认 #FFFFFF'),
            },
            required: ['text', 'start', 'end'],
            additionalProperties: false,
          },
        },
        musicAssetId: string('已导入的背景音乐素材 ID，可选；空值表示不添加'),
        voiceoverAssetId: string('已导入的旁白音频素材 ID，可选'),
        originalAudioVolume: number('原视频自带声音音量 0–2，默认 1'),
        musicVolume: number('背景音乐音量 0–2，默认 0.18'),
        voiceoverVolume: number('旁白音量 0–2，默认 1'),
        fit: enumString('画面适配：crop 填满并裁切；contain 完整显示并留黑边', ['crop', 'contain']),
      }, ['projectId', 'expectedRevision', 'clips'],
      (args) => engine.updateTimeline(args),
    ),
    definition(
      'video_subtitles_set',
      '把用户提供的 SRT 字幕保存到项目。可选择是否将字幕烧录进视频画面；不负责自动语音识别，SRT 内容需要由用户或其他工具提供。修改前先读取项目 revision。',
      {
        projectId: string('项目 ID'),
        expectedRevision: number('当前项目 revision'),
        srtContent: string('完整 SRT 字幕文本'),
        burnIn: boolean('是否烧录到画面，默认 false；false 时保留 SRT 侧文件'),
      }, ['projectId', 'expectedRevision', 'srtContent'],
      (args) => engine.setSubtitles(args),
    ),
    definition(
      'video_render',
      '提交真实 MP4 渲染任务并立即返回 jobId。渲染可能持续较长时间，必须继续调用 video_job_status 轮询到 completed/failed/cancelled；完成后读取项目成片列表并检查输出。',
      {
        projectId: string('项目 ID'),
        outputName: string('输出文件名，可选，不需要带 .mp4'),
      }, ['projectId'],
      (args) => engine.submitRender(args),
    ),
    definition(
      'video_job_status',
      '查询视频渲染任务的状态、阶段、进度、错误和输出文件。',
      { jobId: string('video_render 返回的任务 ID') }, ['jobId'],
      (args) => engine.getJob(args.jobId), true,
    ),
    definition(
      'video_job_cancel',
      '取消排队或正在执行的视频渲染任务。已完成的任务不会被删除，项目素材和历史成片也会保留。',
      { jobId: string('任务 ID') }, ['jobId'],
      (args) => engine.cancelJob(args.jobId),
    ),
    definition(
      'video_output_list',
      '列出项目已经生成的 MP4 成片，返回时长、分辨率、大小和本地工作台预览地址。',
      { projectId: string('项目 ID') }, ['projectId'],
      (args) => engine.outputList(args.projectId), true,
    ),
    definition(
      'video_workbench_open',
      '返回本机 Video Studio 可视化工作台地址。可以在浏览器中查看项目、编辑时间线、提交渲染和预览成片。',
      {}, [],
      async () => ({ url: (await engine.status()).workbenchUrl, message: '请在运行 DeepSeek Harness 的这台电脑上打开该地址。' }), true,
    ),
  ];
}

export const videoStudioInstructions = `你已连接 Video Studio 本地视频制作插件。
制作前先调用 video_studio_status 检查 FFmpeg 和 FFprobe 是否可用。
推荐流程：video_project_create 创建项目 → video_asset_import 导入素材 → video_project_get 查看素材信息和 revision → video_template_list 查看可用模板；有合适模板时调用 video_template_apply，没有合适模板时调用 video_timeline_update 自己编排 → 需要复用原创图片模板时调用 video_template_save → video_render 提交渲染 → 持续调用 video_job_status 直到任务进入终态 → video_output_list 核对成片。
视频和图片素材必须先导入项目，时间线只引用项目内 assetId。视频原声会保留；图片或无原声的视频片段会补静音轨。片段按 clips 数组顺序播放。图片片段可设置 zoom-in、zoom-out、pan-left/right/up/down；转场数组必须比片段数量少一个，省略或空数组表示硬切；动态文字叠加的时间必须落在最终视频时长内。保存模板目前只支持 2–12 个图片片段，应用模板时 assetIds 按模板槽位顺序传入。
时间线和字幕修改必须使用最近一次 video_project_get 返回的 revision，出现 REVISION_CONFLICT 时重新读取后再修改。保存模板也必须传当前 revision。
导入素材只能使用允许目录中的文件。默认允许当前工作目录和用户主目录；遇到 ASSET_PATH_NOT_ALLOWED 时，不要尝试绕过限制，应提示用户把文件放入允许目录或配置 allowedRoots。
当前支持基础顺序剪辑、入点/出点、恒定倍速、图片推拉和平移、淡入/溶解/擦除/滑动/圆形/像素化转场、动态文字叠加、内置和用户保存的可复用模板、背景音乐、旁白混音、SRT 字幕和 MP4 导出。当前不支持自动语音识别、AI 配音、自动选镜头、在线素材搜索下载、专业节点调色和原生剪映草稿导出；不要声称这些功能已经完成。SRT 和音频素材需要用户或其他工具提供。
渲染任务返回 jobId 后必须轮询任务状态，不能把“已提交”说成“已完成”。成片完成后核对实际输出、时长、分辨率和音轨；技术检查通过不代表叙事和视觉质量已经通过。原始素材不会被修改。`;
