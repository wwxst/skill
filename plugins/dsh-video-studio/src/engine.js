import path from 'node:path';
import { readdir } from 'node:fs/promises';
import { createStore } from './store.js';
import { checkBinary, checkFfmpegCapabilities, probeMedia } from './media.js';
import { renderProject } from './render.js';
import { VideoStudioError } from './errors.js';
import { assertId, id, readJson, writeJsonAtomic } from './util.js';
import { listTemplates, getTemplate, saveTemplateFromProject, compileTemplate } from './templates/library.js';

export async function createEngine(config = {}) {
  const store = createStore(config);
  await store.initialize();
  const ffmpegPath = config.ffmpegPath || process.env.DSH_VIDEO_STUDIO_FFMPEG || 'ffmpeg';
  const ffprobePath = config.ffprobePath || process.env.DSH_VIDEO_STUDIO_FFPROBE || 'ffprobe';
  const port = Number(config.port ?? process.env.DSH_VIDEO_STUDIO_PORT ?? 4174);
  const jobs = new Map();
  const jobWriteChains = new Map();
  let closed = false;

  async function jobPath(jobId) {
    assertId(jobId, 'job', '任务 ID');
    return path.join(store.jobsDir, `${jobId}.json`);
  }

  async function saveJob(job) {
    const previous = jobWriteChains.get(job.id) || Promise.resolve();
    const current = previous.catch(() => {}).then(async () => {
      job.updatedAt = new Date().toISOString();
      await writeJsonAtomic(await jobPath(job.id), job);
      return job;
    });
    jobWriteChains.set(job.id, current);
    try { return await current; }
    finally { if (jobWriteChains.get(job.id) === current) jobWriteChains.delete(job.id); }
  }

  async function readJob(jobId) {
    const file = await jobPath(jobId);
    try { return await readJson(file); }
    catch (error) {
      if (error.code === 'ENOENT') throw new VideoStudioError(`任务不存在：${jobId}`, 'JOB_NOT_FOUND');
      throw error;
    }
  }

  async function recoverJobs() {
    const files = await readdir(store.jobsDir, { withFileTypes: true });
    for (const file of files) {
      if (!file.isFile() || !/^job_[a-f0-9]{12}\.json$/.test(file.name)) continue;
      try {
        const job = await readJson(path.join(store.jobsDir, file.name));
        if (job.status === 'queued' || job.status === 'running') {
          job.status = 'interrupted';
          job.error = 'Harness 或插件进程在任务完成前退出。请重新提交渲染任务。';
          job.finishedAt = new Date().toISOString();
          await saveJob(job);
        }
      } catch { /* Leave malformed records for manual inspection. */ }
    }
  }
  await recoverJobs();

  async function submitRender({ projectId, outputName }) {
    if (closed) throw new VideoStudioError('Video Studio 正在关闭，暂时不能提交任务。', 'PLUGIN_CLOSING');
    const project = await store.getRawProject(projectId);
    if (!project.timeline.clips?.length) throw new VideoStudioError('项目时间线为空，不能开始渲染。', 'EMPTY_TIMELINE');
    const job = {
      id: id('job'),
      kind: 'render',
      projectId,
      status: 'queued',
      progress: 0,
      stage: '等待执行',
      outputName: outputName || null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      finishedAt: null,
      result: null,
      error: null,
    };
    await saveJob(job);
    const controller = new AbortController();
    const entry = { controller, task: null };
    jobs.set(job.id, entry);
    entry.task = (async () => {
      try {
        job.status = 'running';
        job.stage = '准备素材';
        await saveJob(job);
        const result = await renderProject({
          store,
          projectId,
          outputName,
          ffmpegPath,
          ffprobePath,
          signal: controller.signal,
          onProgress: (progress) => {
            job.progress = Math.max(job.progress, Math.min(99, Math.round(progress)));
            job.stage = job.progress < 80 ? '正在剪辑和编码片段' : job.progress < 99 ? '正在合成音轨和字幕' : '正在检查成片';
            void saveJob(job).catch(() => {});
          },
        });
        if (controller.signal.aborted) throw controller.signal.reason;
        job.status = 'completed';
        job.progress = 100;
        job.stage = '已完成';
        job.result = result;
        job.finishedAt = new Date().toISOString();
        await saveJob(job);
      } catch (error) {
        if (controller.signal.aborted || error?.name === 'AbortError' || error?.code === 'JOB_CANCELLED') {
          job.status = 'cancelled';
          job.stage = '已取消';
          job.error = '任务已取消。';
        } else {
          job.status = 'failed';
          job.stage = '执行失败';
          job.error = error?.message || String(error);
          job.errorCode = error?.code || 'RENDER_FAILED';
        }
        job.finishedAt = new Date().toISOString();
        await saveJob(job).catch(() => {});
      } finally {
        jobs.delete(job.id);
      }
    })();
    return { jobId: job.id, status: job.status, projectId, message: '渲染任务已提交。请使用 video_job_status 查询进度。' };
  }

  async function getJob(jobId) {
    return readJob(jobId);
  }

  async function cancelJob(jobId) {
    const job = await readJob(jobId);
    const active = jobs.get(jobId);
    if (!active) {
      if (job.status === 'queued') {
        job.status = 'cancelled';
        job.stage = '已取消';
        job.error = '任务已取消。';
        job.finishedAt = new Date().toISOString();
        await saveJob(job);
      }
      return job;
    }
    active.controller.abort(new VideoStudioError('任务已由用户取消。', 'JOB_CANCELLED'));
    await active.task;
    return readJob(jobId);
  }

  async function templateList() {
    return listTemplates(store.dataDir);
  }

  async function templateSave({ projectId, expectedRevision, name, description = '' }) {
    return store.withProjectLock(projectId, async () => {
      const project = await store.getRawProject(projectId);
      if (expectedRevision !== project.revision) {
        throw new VideoStudioError('项目版本已变化，请重新读取项目后再保存模板。', 'REVISION_CONFLICT');
      }
      try {
        return await saveTemplateFromProject(store.dataDir, project, { name, description });
      } catch (error) {
        throw new VideoStudioError(error.message, 'INVALID_TEMPLATE');
      }
    });
  }

  async function templateApply({ projectId, expectedRevision, templateId, assetIds, title, durationPerImage }) {
    const project = await store.getRawProject(projectId);
    if (expectedRevision !== project.revision) {
      throw new VideoStudioError('项目版本已变化，请重新读取项目后再应用模板。', 'REVISION_CONFLICT');
    }
    let template;
    let compiled;
    try {
      template = await getTemplate(store.dataDir, templateId);
      const assets = new Map(project.assets.map((asset) => [asset.id, asset]));
      if (!Array.isArray(assetIds) || assetIds.some((assetId) => assets.get(assetId)?.role !== 'image')) {
        throw new Error('模板需要使用当前项目中已经导入的图片素材。');
      }
      compiled = compileTemplate(template, { assetIds, title, durationPerImage, targetOutput: project.output });
    } catch (error) {
      throw new VideoStudioError(error.message, 'INVALID_TEMPLATE');
    }
    const result = await store.updateTimeline({
      projectId,
      expectedRevision,
      ...compiled,
      musicAssetId: project.timeline.musicAssetId ?? null,
      voiceoverAssetId: project.timeline.voiceoverAssetId ?? null,
      originalAudioVolume: project.timeline.originalAudioVolume ?? 1,
      musicVolume: project.timeline.musicVolume ?? 0.18,
      voiceoverVolume: project.timeline.voiceoverVolume ?? 1,
      fit: 'crop',
    });
    return { ...result, templateId, templateName: template.name };
  }
  async function assetProbe({ projectId, assetId }) {
    return store.withProjectLock(projectId, async () => {
      const project = await store.getRawProject(projectId);
      const asset = project.assets.find((item) => item.id === assetId);
      if (!asset) throw new VideoStudioError(`项目中不存在素材：${assetId}`, 'ASSET_NOT_FOUND');
      const media = await probeMedia(asset.path, ffprobePath);
      asset.media = media;
      project.revision += 1;
      await store.saveRawProject(project);
      return { projectId, revision: project.revision, assetId, media };
    });
  }

  async function outputList(projectId) {
    const project = await store.getRawProject(projectId);
    return project.outputs.map((output) => ({
      name: output.name,
      size: output.size,
      duration: output.duration,
      width: output.width,
      height: output.height,
      createdAt: output.createdAt,
      revision: output.revision,
      url: `/files/${projectId}/${encodeURIComponent(output.name)}`,
    }));
  }

  async function status() {
    const [ffmpeg, ffprobe, ffmpegCapabilities] = await Promise.all([
      checkBinary(ffmpegPath),
      checkBinary(ffprobePath),
      checkFfmpegCapabilities(ffmpegPath),
    ]);
    const filters = ffmpegCapabilities.filters;
    const encoders = ffmpegCapabilities.encoders;
    const capabilities = {
      projectManagement: true,
      mediaImport: true,
      timelineEditing: true,
      videoRendering: ffmpeg.available && ffprobe.available && ffmpegCapabilities.available && encoders.libx264,
      srtSubtitles: ffmpegCapabilities.available && filters.subtitles,
      audioMixing: ffmpegCapabilities.available && filters.amix,
      automaticSpeechRecognition: false,
      textToSpeech: false,
      nativeCapCutDraftExport: false,
      reusableTemplates: true,
      imageMotion: ffmpegCapabilities.available && filters.zoompan,
      transitions: ffmpegCapabilities.available && filters.xfade && filters.acrossfade,
      textOverlays: ffmpegCapabilities.available && filters.ass,
    };
    const missingFeatures = [];
    if (!ffmpeg.available) missingFeatures.push('FFmpeg');
    if (!ffprobe.available) missingFeatures.push('FFprobe');
    if (!ffmpegCapabilities.available) {
      missingFeatures.push('FFmpeg 编码器和滤镜列表');
    } else {
      if (!encoders.libx264) missingFeatures.push('libx264 编码器');
      if (!filters.subtitles) missingFeatures.push('subtitles 滤镜（libass）');
      if (!filters.amix) missingFeatures.push('amix 音频混合滤镜');
      if (!filters.zoompan) missingFeatures.push('zoompan 镜头动画滤镜');
      if (!filters.xfade) missingFeatures.push('xfade 视频转场滤镜');
      if (!filters.acrossfade) missingFeatures.push('acrossfade 音频转场滤镜');
      if (!filters.ass) missingFeatures.push('ass 动态文字滤镜（libass）');
    }
    const requiredCapabilities = ['videoRendering', 'srtSubtitles', 'audioMixing', 'imageMotion', 'transitions', 'textOverlays'];
    const ready = requiredCapabilities.every((name) => capabilities[name]);
    return {
      name: 'Video Studio',
      version: '0.2.0',
      ready,
      basicReady: capabilities.videoRendering,
      missingFeatures,
      ffmpeg,
      ffprobe,
      ffmpegCapabilities,
      dataDir: store.dataDir,
      allowedRoots: store.allowedRoots,
      workbenchUrl: `http://127.0.0.1:${port}`,
      capabilities,
    };
  }

  async function close() {
    closed = true;
    const active = [...jobs.values()];
    for (const item of active) item.controller.abort(new VideoStudioError('Video Studio 插件正在卸载。', 'JOB_CANCELLED'));
    await Promise.allSettled(active.map((item) => item.task));
  }

  return {
    store,
    status,
    createProject: store.createProject,
    listProjects: store.listProjects,
    getProject: store.getProject,
    templateList,
    templateSave,
    templateApply,
    importAsset: store.importAsset,
    updateTimeline: store.updateTimeline,
    setSubtitles: store.setSubtitles,
    assetProbe,
    submitRender,
    getJob,
    cancelJob,
    outputList,
    close,
  };
}
