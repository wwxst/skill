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
      '检查 Video Studio 是否正常运行，返回 FFmpeg/FFprobe 状态、libx264 与关键滤镜探测结果、缺失依赖、素材允许目录和工作台地址。制作前先调用。',
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
      '把当前项目的图片时间线和视觉样式保存成可跨项目复用的模板。模板不保存或覆盖目标项目的画幅、分辨率和 FPS；文字字号会按目标画布高度自动缩放。保存前必须先读取项目 revision。',
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
      '把模板应用到当前项目。assetIds 按模板槽位顺序提供本项目已导入的图片素材 ID；内置电影感模板支持 2–12 张图片。应用后保留当前项目的画幅、分辨率和 FPS，保存模板中的文字字号按目标画布高度自动缩放。',
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
    definition(
      'video_media_search',
      '搜索 Pixabay 图片或视频素材。结果包含来源页面、作者、标签和预览信息；展示搜索结果时必须保留 Pixabay 来源链接。需要 API Key。',
      {
        query: string('搜索关键词，最多 100 字'),
        mediaType: enumString('素材类型', ['image', 'video']),
        orientation: enumString('画面方向', ['all', 'horizontal', 'vertical']),
        category: string('Pixabay 分类，可选'),
        imageType: enumString('图片类型，仅 image 搜索使用', ['all', 'photo', 'illustration', 'vector']),
        page: number('页码 1–100，默认 1'),
        perPage: number('每页数量 3–50，默认 20'),
        lang: string('搜索语言代码，默认 zh'),
        order: enumString('排序', ['popular', 'latest']),
      }, ['query'],
      (args) => engine.mediaSearch(args), true,
    ),
    definition(
      'video_media_download',
      '按 Pixabay 搜索结果的 ID 下载指定图片或视频到本地素材库，保存作者、来源页面和 Pixabay Content License 信息。不要批量抓取或绕过平台下载限制。',
      {
        mediaId: string('video_media_search 返回的 Pixabay 素材 ID'),
        mediaType: enumString('素材类型', ['image', 'video']),
        tags: { type: 'array', maxItems: 20, items: string('本地标签') },
      }, ['mediaId', 'mediaType'],
      (args) => engine.mediaDownload(args),
    ),
    definition(
      'video_library_add',
      '把允许目录中的本地素材加入中央素材库。素材按 SHA-256 去重，可记录标签，原文件不会被修改。',
      {
        sourcePath: string('本机素材绝对路径'),
        role: enumString('素材类型', ['image', 'video', 'audio']),
        name: string('素材显示名称，可选'),
        tags: { type: 'array', maxItems: 20, items: string('素材标签') },
      }, ['sourcePath', 'role'],
      (args) => engine.libraryAdd(args),
    ),
    definition(
      'video_library_list',
      '按关键词、类型和标签检索本地素材库。返回素材 ID、标签、来源、作者和授权记录，不返回磁盘绝对路径。',
      {
        query: string('名称、标签、作者或来源关键词，可选'),
        role: enumString('素材类型筛选', ['image', 'video', 'audio']),
        tags: { type: 'array', maxItems: 20, items: string('必须同时匹配的标签') },
        limit: number('返回数量 1–200，默认 100'),
        offset: number('分页偏移量，默认 0'),
      }, [],
      (args) => engine.libraryList(args), true,
    ),
    definition(
      'video_library_tag',
      '给本地素材库素材添加或移除标签。',
      {
        libraryId: string('素材库 ID'),
        add: { type: 'array', maxItems: 20, items: string('要添加的标签') },
        remove: { type: 'array', maxItems: 20, items: string('要移除的标签') },
      }, ['libraryId'],
      (args) => engine.libraryTag(args),
    ),
    definition(
      'video_library_import',
      '把素材库中的素材复制到指定项目，项目会保存素材来源、授权和标签元数据。',
      {
        projectId: string('目标项目 ID'),
        libraryId: string('素材库 ID'),
        label: string('项目内显示名称，可选'),
      }, ['projectId', 'libraryId'],
      (args) => engine.libraryImport(args),
    ),
    definition(
      'video_storyboard_create',
      '保存由当前对话 AI 根据选题和脚本规划出的镜头清单。每个镜头应写清画面描述、素材搜索词、时长、旁白和字幕；保存前必须读取项目 revision。',
      {
        projectId: string('项目 ID'),
        expectedRevision: number('当前项目 revision'),
        topic: string('视频选题'),
        script: string('完整脚本或旁白稿，可选'),
        shots: {
          type: 'array', minItems: 1, maxItems: 50,
          items: {
            type: 'object',
            properties: {
              title: string('镜头标题，可选'),
              narration: string('该镜头旁白或口播，可选'),
              visualPrompt: string('画面内容、主体、环境、构图和风格描述'),
              searchQuery: string('适合 Pixabay 的素材搜索词，可选'),
              duration: number('镜头时长 1–60 秒，默认 4'),
              sourcePreference: enumString('素材来源偏好', ['auto', 'pixabay', 'generate', 'manual']),
              assetId: string('已绑定的项目素材 ID，可选'),
              sourceIn: number('视频素材入点秒数，可选'),
              sourceOut: number('视频素材出点秒数，可选'),
              transitionType: enumString('该镜头结束后的转场', ['cut', 'fade', 'dissolve', 'wipeleft', 'wiperight', 'slideleft', 'slideright', 'circleopen', 'circleclose', 'pixelize']),
              transitionDuration: number('转场时长 0–2 秒'),
              overlayText: string('画面字幕或标题，可选'),
              overlayPosition: enumString('文字位置', ['top', 'center', 'bottom']),
              fontSize: number('字号 20–120'),
              overlayColor: string('文字颜色 #RRGGBB'),
              overlayAnimation: enumString('文字动画', ['none', 'fade-in', 'fade-out', 'fade-in-out']),
            },
            required: ['visualPrompt'],
            additionalProperties: false,
          },
        },
      }, ['projectId', 'expectedRevision', 'topic', 'shots'],
      (args) => engine.storyboardCreate(args),
    ),
    definition(
      'video_storyboard_get',
      '读取项目保存的镜头清单和每个镜头的素材绑定状态。',
      { projectId: string('项目 ID') }, ['projectId'],
      (args) => engine.storyboardGet(args), true,
    ),
    definition(
      'video_storyboard_apply',
      '把镜头清单和已导入素材组合成时间线。assetIds 按镜头顺序传入；如果镜头已绑定 assetId，可以省略 assetIds。可选 templateId 将镜头图片自动填入模板槽位。必须使用最新 revision。',
      {
        projectId: string('项目 ID'),
        expectedRevision: number('当前项目 revision'),
        assetIds: { type: 'array', minItems: 1, maxItems: 50, items: string('每个镜头对应的项目素材 ID') },
        fit: enumString('画面适配', ['crop', 'contain']),
        templateId: string('可选模板 ID；模板槽位数量必须与图片镜头数量一致'),
        title: string('模板标题，可选；默认使用选题'),
        durationPerImage: number('内置模板每张图片时长 2–15 秒'),
      }, ['projectId', 'expectedRevision'],
      (args) => engine.storyboardApply(args),
    ),
    definition(
      'video_image_generate',
      '按镜头画面描述调用兼容 OpenAI Images API 的图片生成服务，生成图片后自动存入素材库并导入项目；可选 shotIndex 自动绑定到镜头。图片生成可能产生费用，必须先向用户说明并取得明确确认，再设置 confirmCost=true。',
      {
        projectId: string('目标项目 ID'),
        prompt: string('详细图片生成提示词'),
        confirmCost: boolean('用户已明确同意本次图片生成可能产生的费用时才设为 true'),
        shotIndex: number('要自动绑定的镜头序号 1–50，可选'),
        size: string('图片尺寸：auto，或 16 的倍数且宽高比 1:3–3:1，例如 1024x1824'),
        quality: enumString('生成质量', ['low', 'medium', 'high', 'xhigh', 'max', 'auto']),
        outputFormat: enumString('图片格式', ['png', 'jpeg', 'webp']),
        tags: { type: 'array', maxItems: 20, items: string('素材标签') },
        name: string('素材名称，可选'),
      }, ['projectId', 'prompt', 'confirmCost'],
      (args) => engine.imageGenerate(args),
    ),
    definition(
      'video_project_duplicate',
      '根据当前项目复制多个制作版本。会复制项目素材、时间线、字幕和镜头清单，并为每个版本设置不同画幅、分辨率、帧率或标题文字；原项目不修改。',
      {
        projectId: string('源项目 ID'),
        expectedRevision: number('源项目当前 revision'),
        variants: {
          type: 'array', minItems: 1, maxItems: 10,
          items: {
            type: 'object',
            properties: {
              title: string('版本项目名称，可选'),
              aspectRatio: enumString('画幅比例', ['9:16', '16:9', '1:1']),
              width: number('自定义宽度，必须与 height 同时提供'),
              height: number('自定义高度，必须与 width 同时提供'),
              fps: number('帧率 1–60，可选'),
              overlayText: string('覆盖第一条文字或新增标题，可选'),
              outputName: string('建议输出文件名，可选'),
            },
            additionalProperties: false,
          },
        },
      }, ['projectId', 'expectedRevision', 'variants'],
      (args) => engine.projectDuplicate(args),
    ),
    definition(
      'video_batch_render',
      '按顺序批量渲染 1–20 个已完成时间线的项目。每项独立记录成功或失败，单项失败不会阻止后续项目；完成后可对失败项调用 video_job_retry。',
      {
        items: {
          type: 'array', minItems: 1, maxItems: 20,
          items: {
            type: 'object',
            properties: {
              projectId: string('待渲染项目 ID'),
              outputName: string('输出文件名，可选'),
            },
            required: ['projectId'],
            additionalProperties: false,
          },
        },
      }, ['items'],
      (args) => engine.submitBatchRender(args),
    ),
    definition(
      'video_job_retry',
      '重新执行失败或进程中断的渲染任务。批量任务只重试尚未成功的项目，不会重复渲染已完成项。',
      { jobId: string('原渲染任务 ID') }, ['jobId'],
      (args) => engine.retryJob(args),
    ),
    definition(
      'video_quality_check',
      '对指定项目最近一次或指定名称的 MP4 成片执行技术质量检查：黑场、静帧、音频响度、静音区间、字幕阅读速度和动态文字可读性。结果是辅助检查，不替代人工审片。',
      {
        projectId: string('项目 ID'),
        outputName: string('要检查的成片名称，可选；省略时检查最新成片'),
      }, ['projectId'],
      (args) => engine.qualityCheck(args), true,
    ),
    definition(
      'video_performance_record',
      '录入 TikTok 已发布作品的真实数据，沉淀具体账号 accountId、账号类型、选题、开头类型、CTA、模板和播放互动转化指标。只能录入实际数据，不要用估算值冒充真实成绩。',
      {
        projectId: string('对应的视频项目 ID'),
        accountId: string('具体账号标识，例如 capcut-project-01，可选，默认 default'),
        accountType: enumString('账号类型', ['acquisition', 'mid-video', 'other']),
        objective: string('运营目标，例如 acquisition、traffic、conversion'),
        topic: string('选题方向，可选'),
        hookType: string('开头类型，可选'),
        cta: string('行动引导，可选'),
        templateId: string('使用的模板 ID，可选'),
        postUrl: string('TikTok 作品链接，可选'),
        postedAt: string('发布时间 ISO 日期，可选'),
        views: number('实际播放量，非负整数'),
        likes: number('实际点赞数，非负整数'),
        comments: number('实际评论数，非负整数'),
        shares: number('实际分享数，非负整数'),
        saves: number('实际收藏数，非负整数'),
        profileVisits: number('实际主页访问数，非负整数'),
        follows: number('实际新增关注数，非负整数'),
        conversions: number('实际下载、注册或其他转化数，非负整数'),
      }, ['projectId', 'views'],
      (args) => engine.performanceRecord(args),
    ),
    definition(
      'video_performance_summary',
      '根据已录入的真实发布数据，按具体账号 accountId、账号类型、选题、开头类型、模板或运营目标汇总播放、互动、关注和转化率。返回样本量，不能把小样本比例当成稳定规律。',
      {
        groupBy: enumString('分组维度', ['objective', 'accountId', 'accountType', 'topic', 'hookType', 'templateId']),
        accountId: string('具体账号标识筛选，可选'),
        accountType: enumString('账号类型筛选', ['acquisition', 'mid-video', 'other']),
        from: string('统计开始日期 ISO，可选'),
        to: string('统计结束日期 ISO，可选'),
        limit: number('最多返回 1–200 组，默认 50'),
      }, [],
      (args) => engine.performanceSummary(args), true,
    ),
    definition(
      'video_tiktok_authorize',
      '生成指定 accountId 的 TikTok 官方 OAuth 授权链接。先在 TikTok 开发者后台登记 redirectUri 并配置 Client Key/Secret，再让用户打开链接授权。每个账号的 state 独立且 10 分钟过期。',
      { redirectUri: string('TikTok 开发者后台已登记的 HTTPS 或 localhost 回调地址'), accountId: string('账号标识，例如 capcut-project-01；不同 TikTok 账号使用不同标识') }, ['redirectUri'],
      (args) => engine.tiktokAuthorize(args),
    ),
    definition(
      'video_tiktok_connect',
      '使用用户授权回调 URL 中的 code 和 state 兑换 TikTok access/refresh token。redirectUri 必须与授权时完全一致。令牌会安全保存在本机数据目录。',
      { code: string('TikTok OAuth 回调 code'), state: string('授权链接返回的 state'), redirectUri: string('与授权时完全一致的回调地址'), accountId: string('授权时使用的同一个账号标识') }, ['code', 'state', 'redirectUri'],
      (args) => engine.tiktokConnect(args),
    ),
    definition(
      'video_tiktok_video_list',
      '通过 TikTok 官方 Display API 读取当前授权账号最近发布的公开作品及播放、点赞、评论、分享数据。需要 TikTok 开发者应用获批 video.list 权限并配置 OAuth 令牌。',
      { limit: number('读取最近 1–200 条作品，默认 100'), accountId: string('要读取的账号标识，默认 default') }, [],
      (args) => engine.tiktokVideoList(args), true,
    ),
    definition(
      'video_tiktok_sync',
      '把 TikTok 官方 API 返回的真实作品指标同步到对应 Video Studio 项目。先调用 video_tiktok_video_list 获取 videoId，再提供 projectId 和账号类型。每次同步会保存一条数据快照。',
      {
        limit: number('先读取最近多少条作品，1–200，默认 100'),
        mappings: { type: 'array', minItems: 1, maxItems: 200, items: {
          type: 'object',
          properties: {
            videoId: string('TikTok videoId'), projectId: string('对应的 Video Studio 项目 ID'),
            accountId: string('作品所属账号标识，默认 default'),
            accountType: enumString('账号类型', ['acquisition', 'mid-video', 'other']),
            objective: string('运营目标，可选'), topic: string('选题，可选；默认使用作品标题'),
            hookType: string('开头类型，可选'), cta: string('行动引导，可选'), templateId: string('模板 ID，可选'),
          },
          required: ['videoId', 'projectId'], additionalProperties: false,
        } },
      }, ['mappings'],
      (args) => engine.tiktokSync(args),
    ),
  ];
}

export const videoStudioInstructions = `你已连接 Video Studio 本地视频制作插件（0.5.0）。
制作前先调用 video_studio_status。检查 FFmpeg/FFprobe、libx264、libass 和关键滤镜；Pixabay 和图片生成是可选外部服务，状态会显示是否配置，不能因为未配置就误报本地剪辑引擎不可用。
标准制作流程：video_project_create → video_asset_import / video_library_import → video_project_get → 规划镜头 → 搜索或生成素材 → video_storyboard_create → 为每个镜头绑定素材 → video_storyboard_apply → 检查时间线和字幕 → video_render → video_job_status 轮询到终态 → video_quality_check → video_output_list。
CapCut 拉新项目必须优先使用仓库 Skill capcut-launch-tiktok 的文案结构、锚点前置、CTA 和视频简介规则；项目号（acquisition）与中视频号（mid-video）分开规划、分开统计，不要混用目标和指标。
镜头规划由当前对话 AI 根据用户选题、脚本、目标账号和时长生成；每个镜头写清画面描述、素材搜索词、时长、旁白、字幕和转场，再保存为 storyboard。Pixabay 搜索结果必须保留来源页面和作者信息；下载时记录 Pixabay Content License 和来源。Pixabay API 有速率限制，搜索结果缓存 24 小时，不要自动批量抓取或系统性下载。
图片生成可能产生费用。没有用户明确同意时，绝不能调用付费生成；只有用户确认后才能把 confirmCost 设置为 true。生成图片会自动进入本地素材库并导入项目。素材库按 SHA-256 去重，可用标签管理和跨项目复用。
项目素材只能从允许目录导入。默认允许当前工作目录、用户主目录和 Video Studio 数据目录；遇到 ASSET_PATH_NOT_ALLOWED 时提示用户配置 allowedRoots，不要绕过安全限制。
video_project_duplicate 可从同一源项目复制不同画幅、分辨率、帧率和标题版本；之后用 video_batch_render 顺序批量渲染。批量任务单项失败不会阻止其他项目，进程中断后可用 video_job_retry 只重试未完成项。
每次渲染后会自动执行一次基础质量检查，另可用 video_quality_check 检查黑场、静帧、音频响度、静音区间、字幕阅读速度和文字可读性。自动检测是辅助提示，不代替人工审片。
每个 TikTok 账号使用独立 accountId（例如 capcut-project-01、mid-video-01）。分别调用 video_tiktok_authorize 和 video_tiktok_connect 完成授权；账号令牌按 accountId 隔离并保存在本机。通过 video_tiktok_video_list 指定 accountId 读取对应作品，再在 video_tiktok_sync 的每条 mapping 中指定 accountId，将真实播放、点赞、评论、分享快照映射到项目；主页访问、关注和 CPS 转化通过 video_performance_record 补录。用 video_performance_summary 按 accountId 或 accountType 分别比较账号和账号类型的表现。只能录入真实数据；样本量不足时不能把比例推断为确定规律。
修改时间线、字幕、镜头清单或复制项目前，必须先 video_project_get 获取最新 revision；遇到 REVISION_CONFLICT 重新读取后再修改。模板目前只保存图片时间线、镜头运动、转场和文字样式，不覆盖目标项目的画幅、分辨率和 FPS。
当前仍不支持自动语音识别（ASR）、AI 语音合成（TTS）、CapCut 原生草稿导出、专业节点调色和专业级多轨合成。不要声称这些能力已实现。用户提供的音乐、旁白和 SRT 可以导入并参与渲染。
渲染任务返回 jobId 后必须轮询到终态；提交不等于完成。成片完成后核对时长、分辨率、音轨和质量检查结果。`;
