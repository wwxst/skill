import path from 'node:path';
import { copyFile, readdir, rm, stat } from 'node:fs/promises';
import { createStore } from './store.js';
import { checkBinary, checkFfmpegCapabilities, probeMedia } from './media.js';
import { renderProject } from './render.js';
import { VideoStudioError } from './errors.js';
import { assertId, id, readJson, writeJsonAtomic } from './util.js';
import { listTemplates, getTemplate, saveTemplateFromProject, compileTemplate } from './templates/library.js';
import { PixabayProvider } from './providers/pixabay.js';
import { createImageGenerationProvider } from './providers/image-generation.js';
import { createMediaLibrary } from './library.js';
import { normalizeStoryboard, compileStoryboard } from './storyboard.js';
import { analyzeMediaQuality } from './quality.js';
import { createPerformanceStore } from './analytics.js';
import { TikTokProvider } from './providers/tiktok.js';
import { timelineDuration } from './templates/schema.js';

export async function createEngine(config = {}) {
  const store = createStore(config);
  await store.initialize();
  const ffmpegPath = config.ffmpegPath || process.env.DSH_VIDEO_STUDIO_FFMPEG || 'ffmpeg';
  const ffprobePath = config.ffprobePath || process.env.DSH_VIDEO_STUDIO_FFPROBE || 'ffprobe';
  const port = Number(config.port ?? process.env.DSH_VIDEO_STUDIO_PORT ?? 4174);
  const pixabay = new PixabayProvider({
    apiKey: config.pixabayApiKey,
    cacheDir: path.join(store.dataDir, 'library', 'cache'),
    fetchImpl: config.fetchImpl,
  });
  const imageProvider = createImageGenerationProvider({
    imageApiKey: config.imageApiKey,
    imageApiBaseUrl: config.imageApiBaseUrl,
    imageModel: config.imageModel,
    fetchImpl: config.fetchImpl,
  });
  const tiktok = new TikTokProvider({
    dataDir: store.dataDir,
    clientKey: config.tiktokClientKey,
    clientSecret: config.tiktokClientSecret,
    accessToken: config.tiktokAccessToken,
    refreshToken: config.tiktokRefreshToken,
    fetchImpl: config.fetchImpl,
  });
  await tiktok.initialize();
  const library = createMediaLibrary({
    dataDir: store.dataDir,
    resolveAllowedFile: store.resolveAllowedFile,
    store,
    ffprobePath,
    pixabay,
    imageProvider,
  });
  await library.initialize();
  const performanceStore = createPerformanceStore(store.dataDir);
  await performanceStore.initialize();
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
            job.progress = Math.max(job.progress, Math.min(94, Math.round(progress)));
            job.stage = job.progress < 80 ? '正在剪辑和编码片段' : '正在合成音轨和字幕';
            void saveJob(job).catch(() => {});
          },
        });
        if (controller.signal.aborted) throw controller.signal.reason;
        job.progress = 96;
        job.stage = '正在检查成片质量';
        let quality = null;
        try {
          const outputPath = await store.resolveProjectOutput(projectId, result.output.name);
          quality = await analyzeMediaQuality({ filePath: outputPath, project, ffmpegPath, ffprobePath, signal: controller.signal });
        } catch (error) {
          quality = { summary: { passed: false, warningCount: 0, infoCount: 1 }, findings: [{ severity: 'info', code: 'QUALITY_CHECK_FAILED', message: error.message }] };
        }
        job.status = 'completed';
        job.progress = 100;
        job.stage = '已完成';
        job.result = { ...result, quality };
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

  async function submitBatchRender({ items } = {}) {
    if (closed) throw new VideoStudioError('Video Studio 正在关闭，暂时不能提交任务。', 'PLUGIN_CLOSING');
    if (!Array.isArray(items) || items.length < 1 || items.length > 20) throw new VideoStudioError('批量渲染必须提供 1–20 个项目。', 'INVALID_ARGUMENT');
    const normalizedItems = [];
    const seenProjects = new Set();
    for (const item of items) {
      if (!item || typeof item.projectId !== 'string') throw new VideoStudioError('批量渲染的每一项都必须提供 projectId。', 'INVALID_ARGUMENT');
      if (seenProjects.has(item.projectId)) throw new VideoStudioError('同一项目在一个批量任务中只能出现一次，请先复制成多个版本项目。', 'INVALID_ARGUMENT');
      seenProjects.add(item.projectId);
      const project = await store.getRawProject(item.projectId);
      if (!project.timeline.clips?.length) throw new VideoStudioError('项目时间线为空，不能批量渲染：' + item.projectId, 'EMPTY_TIMELINE');
      normalizedItems.push({ projectId: item.projectId, outputName: item.outputName || null });
    }
    const job = {
      id: id('job'),
      kind: 'batch-render',
      items: normalizedItems,
      status: 'queued',
      progress: 0,
      stage: '等待执行',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      finishedAt: null,
      result: { items: [] },
      error: null,
    };
    await saveJob(job);
    const controller = new AbortController();
    const entry = { controller, task: null };
    jobs.set(job.id, entry);
    entry.task = (async () => {
      try {
        job.status = 'running';
        job.stage = '准备批量任务';
        await saveJob(job);
        const results = [];
        for (let index = 0; index < normalizedItems.length; index += 1) {
          controller.signal.throwIfAborted();
          const item = normalizedItems[index];
          const record = { projectId: item.projectId, outputName: item.outputName, status: 'running', result: null, error: null };
          results.push(record);
          job.result = { items: results };
          job.stage = '正在处理第 ' + (index + 1) + '/' + normalizedItems.length + ' 个项目';
          await saveJob(job);
          try {
            const project = await store.getRawProject(item.projectId);
            const result = await renderProject({
              store,
              projectId: item.projectId,
              outputName: item.outputName,
              ffmpegPath,
              ffprobePath,
              signal: controller.signal,
              onProgress: (progress) => {
                const overall = ((index + Math.min(99, progress) / 100) / normalizedItems.length) * 100;
                job.progress = Math.max(job.progress, Math.min(98, Math.round(overall)));
                void saveJob(job).catch(() => {});
              },
            });
            controller.signal.throwIfAborted();
            let quality = null;
            try {
              const outputPath = await store.resolveProjectOutput(item.projectId, result.output.name);
              quality = await analyzeMediaQuality({ filePath: outputPath, project, ffmpegPath, ffprobePath, signal: controller.signal });
            } catch (error) {
              quality = { summary: { passed: false, warningCount: 0, infoCount: 1 }, findings: [{ severity: 'info', code: 'QUALITY_CHECK_FAILED', message: error.message }] };
            }
            record.status = 'completed';
            record.result = { ...result, quality };
          } catch (error) {
            record.status = controller.signal.aborted ? 'cancelled' : 'failed';
            record.error = error?.message || String(error);
            record.errorCode = error?.code || 'RENDER_FAILED';
            job.result = { items: results };
            await saveJob(job);
            if (controller.signal.aborted) throw error;
          }
          job.result = { items: results };
          job.progress = Math.max(job.progress, Math.round(((index + 1) / normalizedItems.length) * 100));
          await saveJob(job);
        }
        const failures = results.filter((item) => item.status !== 'completed').length;
        job.status = 'completed';
        job.progress = 100;
        job.stage = failures ? '批量完成，部分任务失败' : '批量渲染完成';
        job.error = failures ? failures + ' 个项目渲染失败，可调用 video_job_retry 重试。' : null;
        job.result = { items: results, summary: { total: results.length, succeeded: results.length - failures, failed: failures } };
        job.finishedAt = new Date().toISOString();
        await saveJob(job);
      } catch (error) {
        if (controller.signal.aborted || error?.name === 'AbortError' || error?.code === 'JOB_CANCELLED') {
          job.status = 'cancelled';
          job.stage = '批量任务已取消';
          job.error = '批量任务已取消；已完成的项目结果会保留。';
        } else {
          job.status = 'failed';
          job.stage = '批量任务失败';
          job.error = error?.message || String(error);
          job.errorCode = error?.code || 'BATCH_RENDER_FAILED';
        }
        job.finishedAt = new Date().toISOString();
        await saveJob(job).catch(() => {});
      } finally {
        jobs.delete(job.id);
      }
    })();
    return { jobId: job.id, status: job.status, itemCount: normalizedItems.length, message: '批量渲染任务已提交。请使用 video_job_status 查询进度。' };
  }

  async function retryJob(jobId) {
    const previous = await readJob(jobId);
    if (previous.kind === 'render') {
      if (!['failed', 'interrupted'].includes(previous.status)) throw new VideoStudioError('单项目渲染任务只有 failed 或 interrupted 状态可以重试。', 'JOB_NOT_RETRYABLE');
      return submitRender({ projectId: previous.projectId, outputName: previous.outputName });
    }
    if (previous.kind === 'batch-render') {
      const finished = new Set((previous.result?.items || []).filter((item) => item.status === 'completed').map((item) => item.projectId));
      const retryItems = (previous.items || []).filter((item) => !finished.has(item.projectId));
      if (!retryItems.length) throw new VideoStudioError('批量任务没有失败或中断的项目需要重试。', 'JOB_NOT_RETRYABLE');
      if (!['failed', 'interrupted', 'completed', 'cancelled'].includes(previous.status)) throw new VideoStudioError('当前批量任务状态不能重试。', 'JOB_NOT_RETRYABLE');
      return submitBatchRender({ items: retryItems });
    }
    throw new VideoStudioError('该任务类型不支持重试。', 'JOB_NOT_RETRYABLE');
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

  async function qualityCheck({ projectId, outputName } = {}) {
    const project = await store.getRawProject(projectId);
    const output = outputName
      ? project.outputs.find((item) => item.name === outputName || path.basename(item.path || '') === outputName)
      : project.outputs.at(-1);
    if (!output) throw new VideoStudioError('项目还没有可检查的成片。', 'OUTPUT_NOT_FOUND');
    const filePath = await store.resolveProjectOutput(projectId, output.name);
    return analyzeMediaQuality({ filePath, project, ffmpegPath, ffprobePath });
  }

  async function mediaSearch(args) {
    return pixabay.search(args);
  }

  async function mediaDownload(args) {
    return library.downloadPixabay(args);
  }

  async function libraryAdd(args) {
    const resolved = await store.resolveAllowedFile(args.sourcePath);
    const media = await probeMedia(resolved.path, ffprobePath).catch(() => null);
    return library.addFile({ filePath: resolved.path, role: args.role, name: args.name, tags: args.tags, media });
  }

  async function libraryList(args) {
    return library.list(args);
  }

  async function libraryTag(args) {
    return library.tag(args);
  }

  async function libraryImport(args) {
    return library.importToProject(args);
  }

  async function imageGenerate({ projectId, prompt, confirmCost, shotIndex, size, quality, outputFormat, tags, name } = {}) {
    if (confirmCost !== true) throw new VideoStudioError('图片生成可能产生 API 费用。请先取得用户明确确认，并设置 confirmCost=true。', 'IMAGE_GENERATION_CONFIRMATION_REQUIRED');
    if (shotIndex !== undefined && shotIndex !== null) {
      if (!Number.isInteger(shotIndex) || shotIndex < 1 || shotIndex > 50) throw new VideoStudioError('shotIndex 必须是 1–50 的镜头序号。', 'INVALID_ARGUMENT');
      const project = await store.getRawProject(projectId);
      if (!project.storyboard?.shots?.[shotIndex - 1]) throw new VideoStudioError('项目中不存在第 ' + shotIndex + ' 个镜头。', 'STORYBOARD_NOT_FOUND');
    }
    const item = await library.generateImage({ prompt, size, quality, outputFormat, tags, name });
    const imported = await library.importToProject({ projectId, libraryId: item.id, label: name || item.name });
    if (shotIndex !== undefined && shotIndex !== null) {
      const updated = await store.withProjectLock(projectId, async () => {
        const project = await store.getRawProject(projectId);
        if (!project.storyboard?.shots?.[shotIndex - 1]) throw new VideoStudioError('项目中不存在第 ' + shotIndex + ' 个镜头。', 'STORYBOARD_NOT_FOUND');
        project.storyboard.shots[shotIndex - 1].assetId = imported.asset.id;
        project.revision += 1;
        await store.saveRawProject(project);
        return { revision: project.revision, storyboard: project.storyboard };
      });
      imported.revision = updated.revision;
    }
    return { ...imported, libraryId: item.id, generated: true, model: item.sources?.[0]?.model || library.imageModel };
  }

  async function storyboardCreate({ projectId, expectedRevision, topic, script, shots }) {
    return store.withProjectLock(projectId, async () => {
      const project = await store.getRawProject(projectId);
      if (expectedRevision !== project.revision) throw new VideoStudioError('项目版本已变化，请重新读取项目后再保存镜头清单。', 'REVISION_CONFLICT');
      project.storyboard = normalizeStoryboard({ topic, script, shots });
      project.revision += 1;
      await store.saveRawProject(project);
      return { projectId, revision: project.revision, storyboard: project.storyboard };
    });
  }

  async function storyboardGet({ projectId }) {
    const project = await store.getRawProject(projectId);
    if (!project.storyboard) throw new VideoStudioError('项目还没有镜头清单。', 'STORYBOARD_NOT_FOUND');
    return { projectId, revision: project.revision, storyboard: project.storyboard };
  }

  async function storyboardApply({ projectId, expectedRevision, assetIds, fit = 'crop', templateId, title, durationPerImage }) {
    const project = await store.getRawProject(projectId);
    if (expectedRevision !== project.revision) throw new VideoStudioError('项目版本已变化，请重新读取项目后再应用镜头清单。', 'REVISION_CONFLICT');
    if (templateId) {
      const storyboard = project.storyboard;
      if (!storyboard?.shots?.length) throw new VideoStudioError('项目还没有镜头清单。', 'STORYBOARD_NOT_FOUND');
      const selectedAssets = assetIds || storyboard.shots.map((shot) => shot.assetId);
      const assets = new Map(project.assets.map((asset) => [asset.id, asset]));
      if (!Array.isArray(selectedAssets) || selectedAssets.some((assetId) => assets.get(assetId)?.role !== 'image')) {
        throw new VideoStudioError('模板模式下，每个镜头都必须绑定当前项目中已导入的图片素材。', 'INVALID_STORYBOARD_ASSETS');
      }
      let compiled;
      let template;
      try {
        template = await getTemplate(store.dataDir, templateId);
        compiled = compileTemplate(template, {
          assetIds: selectedAssets,
          title: title || storyboard.topic,
          durationPerImage,
          targetOutput: project.output,
        });
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
        fit,
      });
      return { ...result, templateId, templateName: template.name };
    }
    const compiled = compileStoryboard(project.storyboard, project, { assetIds, fit });
    return store.updateTimeline({ projectId, expectedRevision, ...compiled });
  }

  async function projectDuplicate({ projectId, expectedRevision, variants } = {}) {
    const source = await store.getRawProject(projectId);
    if (expectedRevision !== source.revision) throw new VideoStudioError('项目版本已变化，请重新读取项目后再复制。', 'REVISION_CONFLICT');
    if (!Array.isArray(variants) || variants.length < 1 || variants.length > 10) throw new VideoStudioError('多版本制作需要提供 1–10 个版本配置。', 'INVALID_ARGUMENT');
    const clones = [];
    for (let index = 0; index < variants.length; index += 1) {
      const variant = variants[index] || {};
      const hasCustomSize = variant.width !== undefined || variant.height !== undefined;
      if (hasCustomSize && (!Number.isInteger(variant.width) || !Number.isInteger(variant.height))) throw new VideoStudioError('自定义分辨率必须同时提供 width 和 height。', 'INVALID_ARGUMENT');
      if (variant.aspectRatio && hasCustomSize) throw new VideoStudioError('版本配置不能同时设置 aspectRatio 和自定义 width/height。', 'INVALID_ARGUMENT');
      const outputArgs = variant.aspectRatio
        ? { aspectRatio: variant.aspectRatio }
        : { width: variant.width ?? source.output.width, height: variant.height ?? source.output.height };
      const clone = await store.createProject({
        title: variant.title || (source.title + ' - 版本 ' + (index + 1)),
        brief: source.brief,
        fps: variant.fps ?? source.output.fps,
        ...outputArgs,
      });
      try {
        const mapping = new Map();
        const assets = [];
        for (const asset of source.assets) {
          const assetId = id('asset');
          const fileName = assetId + path.extname(asset.path);
          const targetPath = path.join(store.projectPath(clone.id), 'assets', fileName);
          await copyFile(asset.path, targetPath);
          const info = await stat(targetPath);
          mapping.set(asset.id, assetId);
          assets.push({ ...asset, id: assetId, path: targetPath, size: info.size });
        }
        clone.assets = assets;
        clone.timeline = structuredClone(source.timeline);
        clone.timeline.clips = (clone.timeline.clips || []).map((clip) => ({ ...clip, assetId: mapping.get(clip.assetId) || clip.assetId }));
        const fontScale = clone.output.height / Math.max(source.output.height, 1);
        clone.timeline.overlays = (clone.timeline.overlays || []).map((overlay) => ({
          ...overlay,
          fontSize: Math.max(20, Math.min(120, Math.round(Number(overlay.fontSize ?? 56) * fontScale))),
        }));
        clone.timeline.musicAssetId = mapping.get(clone.timeline.musicAssetId) || null;
        clone.timeline.voiceoverAssetId = mapping.get(clone.timeline.voiceoverAssetId) || null;
        if (clone.timeline.subtitles?.path) {
          const subtitlePath = path.join(store.projectPath(clone.id), 'outputs', 'subtitles.srt');
          await copyFile(clone.timeline.subtitles.path, subtitlePath);
          clone.timeline.subtitles.path = subtitlePath;
        }
        clone.outputs = [];
        clone.storyboard = source.storyboard ? structuredClone(source.storyboard) : null;
        if (clone.storyboard?.shots) clone.storyboard.shots = clone.storyboard.shots.map((shot) => ({
          ...shot,
          assetId: mapping.get(shot.assetId) || shot.assetId,
          fontSize: Math.max(20, Math.min(120, Math.round(Number(shot.fontSize ?? 56) * fontScale))),
        }));
        if (variant.overlayText) {
          const overlays = clone.timeline.overlays || [];
          const totalDuration = timelineDuration(clone.timeline.clips || [], clone.timeline.transitions || []);
          if (overlays.length) overlays[0] = { ...overlays[0], text: String(variant.overlayText).slice(0, 200) };
          else if (totalDuration > 0) overlays.push({ text: String(variant.overlayText).slice(0, 200), start: 0, end: Math.min(3, totalDuration), position: 'top', fontSize: 64, color: '#FFFFFF', animation: 'fade-in-out' });
          clone.timeline.overlays = overlays;
        }
        clone.revision = 2;
        await store.saveRawProject(clone);
        clones.push({
          projectId: clone.id,
          title: clone.title,
          revision: clone.revision,
          output: clone.output,
          outputName: variant.outputName || ('variant-' + (index + 1)),
        });
      } catch (error) {
        await rm(store.projectPath(clone.id), { recursive: true, force: true }).catch(() => {});
        throw error;
      }
    }
    return { sourceProjectId: projectId, variants: clones, message: '版本项目已复制。接下来可将 variants 中的 projectId 传给 video_batch_render。' };
  }

  async function performanceRecord(args) {
    const project = await store.getRawProject(args.projectId);
    return performanceStore.record({ ...args, topic: args.topic || project.storyboard?.topic || '' });
  }

  async function performanceSummary(args) {
    return performanceStore.summary(args);
  }

  async function tiktokAuthorize(args) { return tiktok.createAuthorizationUrl(args); }
  async function tiktokConnect(args) { return tiktok.exchangeAuthorizationCode(args); }
  async function tiktokVideoList(args) { return tiktok.listVideos(args); }

  async function tiktokSync({ mappings, limit = 100 } = {}) {
    if (!Array.isArray(mappings) || mappings.length < 1 || mappings.length > 200) throw new VideoStudioError('TikTok 同步必须提供 1–200 条作品与项目的对应关系。', 'INVALID_ARGUMENT');
    const seen = new Set();
    for (const mapping of mappings) {
      if (!mapping || !/^\d{8,30}$/.test(String(mapping.videoId || ''))) throw new VideoStudioError('每条映射都必须提供有效的 TikTok videoId。', 'INVALID_ARGUMENT');
      if (seen.has(String(mapping.videoId))) throw new VideoStudioError('同一批次不能重复映射同一个 TikTok videoId。', 'INVALID_ARGUMENT');
      seen.add(String(mapping.videoId));
      if (!['acquisition', 'mid-video', 'other'].includes(mapping.accountType || 'acquisition')) throw new VideoStudioError('账号类型无效。', 'INVALID_ARGUMENT');
      await store.getRawProject(mapping.projectId);
    }
    const result = await tiktok.listVideos({ limit });
    const byId = new Map(result.videos.map((video) => [video.id, video]));
    const synced = [], missing = [];
    for (const mapping of mappings) {
      const video = byId.get(String(mapping.videoId));
      if (!video) { missing.push({ videoId: String(mapping.videoId), reason: '最近作品列表中没有该 ID；可能超出同步范围或不属于当前授权账号。' }); continue; }
      const record = await performanceStore.record({
        projectId: mapping.projectId, accountType: mapping.accountType || 'acquisition',
        objective: mapping.objective, topic: mapping.topic || video.title, hookType: mapping.hookType,
        cta: mapping.cta, templateId: mapping.templateId, postUrl: video.shareUrl,
        platformVideoId: video.id, source: 'tiktok-display-api', availableMetrics: video.availableMetrics,
        postedAt: video.createTime || undefined, views: video.metrics.views ?? 0,
        likes: video.metrics.likes ?? 0, comments: video.metrics.comments ?? 0, shares: video.metrics.shares ?? 0,
      });
      synced.push({ videoId: video.id, projectId: mapping.projectId, recordId: record.id, metrics: video.metrics, availableMetrics: video.availableMetrics });
    }
    return { provider: 'tiktok-display-api', syncedCount: synced.length, missingCount: missing.length, synced, missing, unavailableMetrics: result.metricsUnavailable, note: '仅同步 API 实际返回的播放、点赞、评论、分享；主页访问、关注和转化需要另行补录。' };
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
      localMediaLibrary: true,
      pixabaySearch: library.pixabayConfigured,
      imageGeneration: library.imageGenerationConfigured,
      storyboardPlanning: true,
      qualityInspection: true,
      batchRendering: true,
      failedJobRetry: true,
      tiktokPerformanceFeedback: true,
      tiktokDisplayApi: tiktok.configured,
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
      version: '0.5.0',
      ready,
      basicReady: capabilities.videoRendering,
      missingFeatures,
      ffmpeg,
      ffprobe,
      ffmpegCapabilities,
      providers: {
        pixabay: { configured: library.pixabayConfigured },
        imageGeneration: { configured: library.imageGenerationConfigured, model: library.imageModel },
        tiktok: {
          configured: tiktok.configured,
          authorizationReady: Boolean(config.tiktokClientKey || process.env.DSH_VIDEO_STUDIO_TIKTOK_CLIENT_KEY) && Boolean(config.tiktokClientSecret || process.env.DSH_VIDEO_STUDIO_TIKTOK_CLIENT_SECRET),
          automaticRefresh: Boolean(config.tiktokClientKey || process.env.DSH_VIDEO_STUDIO_TIKTOK_CLIENT_KEY) && Boolean(config.tiktokClientSecret || process.env.DSH_VIDEO_STUDIO_TIKTOK_CLIENT_SECRET),
        },
      },
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
    submitBatchRender,
    retryJob,
    getJob,
    cancelJob,
    outputList,
    qualityCheck,
    mediaSearch,
    mediaDownload,
    libraryAdd,
    libraryList,
    libraryTag,
    libraryImport,
    imageGenerate,
    storyboardCreate,
    storyboardGet,
    storyboardApply,
    projectDuplicate,
    performanceRecord,
    performanceSummary,
    tiktokAuthorize,
    tiktokConnect,
    tiktokVideoList,
    tiktokSync,
    close,
  };
}
