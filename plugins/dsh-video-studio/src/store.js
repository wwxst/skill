import os from 'node:os';
import path from 'node:path';
import { access, copyFile, lstat, realpath, readdir, stat } from 'node:fs/promises';
import { VideoStudioError } from './errors.js';
import { ensureDir, id, isInside, readJson, safeSegment, writeJsonAtomic, assertId } from './util.js';
import { probeMedia } from './media.js';

const ASPECTS = {
  '9:16': [1080, 1920],
  '16:9': [1920, 1080],
  '1:1': [1080, 1080],
};

export function createStore(config = {}) {
  const home = os.homedir();
  const dataDir = path.resolve(config.dataDir || process.env.DSH_VIDEO_STUDIO_HOME || path.join(home, '.dsh-video-studio'));
  const cwd = path.resolve(process.cwd());
  const cwdIsFilesystemRoot = path.parse(cwd).root === cwd;
  const allowedRoots = [...new Set([
    ...((config.allowedRoots || []).map((item) => path.resolve(String(item).replace(/^~(?=$|[\\/])/, home)))),
    ...((process.env.DSH_VIDEO_STUDIO_ALLOWED_ROOTS || '').split(path.delimiter).filter(Boolean).map((item) => path.resolve(item))),
    ...(!cwdIsFilesystemRoot ? [cwd] : []),
    home,
    dataDir,
  ])];
  const projectsDir = path.join(dataDir, 'projects');
  const jobsDir = path.join(dataDir, 'jobs');
  const projectLocks = new Map();

  async function withProjectLock(projectId, task) {
    const previous = projectLocks.get(projectId) || Promise.resolve();
    let release;
    const current = new Promise((resolve) => { release = resolve; });
    projectLocks.set(projectId, current);
    await previous;
    try { return await task(); }
    finally {
      release();
      if (projectLocks.get(projectId) === current) projectLocks.delete(projectId);
    }
  }

  async function initialize() {
    await ensureDir(projectsDir);
    await ensureDir(jobsDir);
  }

  async function resolveAllowedFile(sourcePath) {
    if (typeof sourcePath !== 'string' || !sourcePath.trim()) {
      throw new VideoStudioError('素材路径不能为空。', 'INVALID_ARGUMENT');
    }
    const requested = path.resolve(sourcePath);
    let actual;
    try { actual = await realpath(requested); }
    catch (error) { throw new VideoStudioError(`找不到素材：${requested}`, 'ASSET_NOT_FOUND', { cause: error }); }
    const fileStat = await stat(actual);
    if (!fileStat.isFile()) throw new VideoStudioError('素材路径必须指向一个文件。', 'ASSET_NOT_FILE');
    if (!allowedRoots.some((root) => isInside(root, actual))) {
      throw new VideoStudioError(`出于安全考虑，素材只能从允许目录导入。当前路径不在允许目录内：${actual}。可在插件配置 allowedRoots 中增加目录。`, 'ASSET_PATH_NOT_ALLOWED');
    }
    return { path: actual, stat: fileStat };
  }

  function projectPath(projectId) {
    assertId(projectId, 'vs', '项目 ID');
    return path.join(projectsDir, projectId);
  }

  async function readProject(projectId) {
    const file = path.join(projectPath(projectId), 'project.json');
    try { return await readJson(file); }
    catch (error) {
      if (error.code === 'ENOENT') throw new VideoStudioError(`项目不存在：${projectId}`, 'PROJECT_NOT_FOUND');
      throw error;
    }
  }

  async function saveProject(project) {
    project.updatedAt = new Date().toISOString();
    await writeJsonAtomic(path.join(projectPath(project.id), 'project.json'), project);
    return project;
  }

  async function createProject({ title, aspectRatio = '9:16', width, height, fps = 30, brief = '' }) {
    if (typeof title !== 'string' || !title.trim()) throw new VideoStudioError('项目名称不能为空。', 'INVALID_ARGUMENT');
    const defaults = ASPECTS[aspectRatio];
    if ((width === undefined) !== (height === undefined)) throw new VideoStudioError('自定义分辨率必须同时提供 width 和 height。', 'INVALID_ARGUMENT');
    if (!defaults && (!Number.isInteger(width) || !Number.isInteger(height))) {
      throw new VideoStudioError('画幅请选择 9:16、16:9、1:1，或同时提供自定义 width 和 height。', 'INVALID_ARGUMENT');
    }
    const outputWidth = width ?? defaults[0];
    const outputHeight = height ?? defaults[1];
    if (!Number.isInteger(outputWidth) || !Number.isInteger(outputHeight) || outputWidth < 128 || outputHeight < 128 || outputWidth > 3840 || outputHeight > 3840 || outputWidth % 2 || outputHeight % 2) {
      throw new VideoStudioError('视频宽高必须是 128–3840 之间的偶数。', 'INVALID_ARGUMENT');
    }
    if (!Number.isInteger(fps) || fps < 1 || fps > 60) throw new VideoStudioError('帧率必须是 1–60 之间的整数。', 'INVALID_ARGUMENT');
    const projectId = id('vs');
    const directory = projectPath(projectId);
    await Promise.all([
      ensureDir(path.join(directory, 'assets')),
      ensureDir(path.join(directory, 'outputs')),
      ensureDir(path.join(directory, 'tmp')),
    ]);
    const now = new Date().toISOString();
    const project = {
      id: projectId,
      title: title.trim(),
      brief: String(brief || '').slice(0, 8000),
      createdAt: now,
      updatedAt: now,
      revision: 1,
      output: { aspectRatio, width: outputWidth, height: outputHeight, fps },
      assets: [],
      timeline: { clips: [], musicAssetId: null, voiceoverAssetId: null, originalAudioVolume: 1, musicVolume: 0.18, voiceoverVolume: 1, subtitles: null },
      outputs: [],
    };
    await saveProject(project);
    return project;
  }

  async function listProjects() {
    const entries = await readdir(projectsDir, { withFileTypes: true });
    const projects = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !/^vs_[a-f0-9]{12}$/.test(entry.name)) continue;
      try {
        const project = await readJson(path.join(projectsDir, entry.name, 'project.json'));
        projects.push({ id: project.id, title: project.title, updatedAt: project.updatedAt, revision: project.revision, assetCount: project.assets?.length ?? 0, outputCount: project.outputs?.length ?? 0 });
      } catch { /* Ignore incomplete project folders. */ }
    }
    return projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async function importAsset(args) {
    const { projectId, sourcePath, role = 'video', label } = args;
    return withProjectLock(projectId, async () => {
    const project = await readProject(projectId);
    if (!['video', 'image', 'audio'].includes(role)) throw new VideoStudioError('素材类型只能是 video、image 或 audio。', 'INVALID_ARGUMENT');
    const source = await resolveAllowedFile(sourcePath);
    const sourceName = path.basename(source.path);
    const ext = path.extname(sourceName).slice(0, 16).toLowerCase();
    if (role === 'image' && !['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.tif', '.tiff'].includes(ext)) {
      throw new VideoStudioError('图片素材目前支持 PNG、JPG、WEBP、BMP、TIFF。', 'UNSUPPORTED_IMAGE');
    }
    let media = null;
    try { media = await probeMedia(source.path, config.ffprobePath || 'ffprobe'); }
    catch (error) {
      if (role !== 'image') throw new VideoStudioError(`无法读取素材媒体信息：${error.message}`, 'ASSET_PROBE_FAILED', { cause: error });
    }
    if (role === 'video' && !media?.video) throw new VideoStudioError('选择的文件没有视频流，请将素材类型改为 image 或 audio。', 'ASSET_TYPE_MISMATCH');
    if (role === 'audio' && !media?.audio) throw new VideoStudioError('选择的文件没有音频流。', 'ASSET_TYPE_MISMATCH');
    const assetId = id('asset');
    const storedName = `${assetId}${ext}`;
    const storedPath = path.join(projectPath(projectId), 'assets', storedName);
    await copyFile(source.path, storedPath);
    const assetStat = await stat(storedPath);
    const asset = {
      id: assetId,
      name: label?.trim() || sourceName,
      originalName: sourceName,
      role,
      path: storedPath,
      size: assetStat.size,
      importedAt: new Date().toISOString(),
      media,
    };
    project.assets.push(asset);
    project.revision += 1;
    await saveProject(project);
    const { path: _storedPath, ...publicAsset } = asset;
    return { projectId, revision: project.revision, asset: publicAsset };
    });
  }

  async function getProject(projectId) {
    const project = await readProject(projectId);
    return {
      ...project,
      assets: project.assets.map(({ path: assetPath, ...asset }) => ({ ...asset, fileName: path.basename(assetPath) })),
      timeline: {
        ...project.timeline,
        subtitles: project.timeline.subtitles ? { burnIn: project.timeline.subtitles.burnIn, updatedAt: project.timeline.subtitles.updatedAt, url: `/files/${project.id}/subtitles.srt` } : null,
      },
      outputs: project.outputs.map(({ path: outputPath, ...output }) => ({ ...output, fileName: path.basename(outputPath), url: `/files/${project.id}/${encodeURIComponent(path.basename(outputPath))}` })),
    };
  }

  async function updateTimeline(args) {
    const { projectId, expectedRevision, clips, musicAssetId = null, voiceoverAssetId = null, originalAudioVolume = 1, musicVolume = 0.18, voiceoverVolume = 1, fit = 'crop' } = args;
    return withProjectLock(projectId, async () => {
    const project = await readProject(projectId);
    if (expectedRevision !== project.revision) throw new VideoStudioError(`项目版本已变化。你提交的是 revision ${expectedRevision}，当前版本是 ${project.revision}。请重新读取项目后再修改。`, 'REVISION_CONFLICT');
    if (!Array.isArray(clips) || clips.length < 1 || clips.length > 100) throw new VideoStudioError('时间线 clips 数量必须为 1–100。', 'INVALID_ARGUMENT');
    if (!['crop', 'contain'].includes(fit)) throw new VideoStudioError('fit 只能是 crop 或 contain。', 'INVALID_ARGUMENT');
    const byId = new Map(project.assets.map((asset) => [asset.id, asset]));
    const normalizedClips = clips.map((clip, index) => {
      const asset = byId.get(clip.assetId);
      if (!asset || !['video', 'image'].includes(asset.role)) throw new VideoStudioError(`第 ${index + 1} 个片段引用了不存在或非视频/图片素材：${clip.assetId}`, 'INVALID_CLIP_ASSET');
      const speed = Number(clip.speed ?? 1);
      if (!Number.isFinite(speed) || speed < 0.25 || speed > 4) throw new VideoStudioError(`第 ${index + 1} 个片段 speed 必须在 0.25–4 之间。`, 'INVALID_ARGUMENT');
      const sourceIn = Number(clip.sourceIn ?? 0);
      if (!Number.isFinite(sourceIn) || sourceIn < 0) throw new VideoStudioError(`第 ${index + 1} 个片段 sourceIn 无效。`, 'INVALID_ARGUMENT');
      let sourceOut;
      let duration;
      if (asset.role === 'image') {
        duration = Number(clip.duration);
        if (!Number.isFinite(duration) || duration <= 0 || duration > 600) throw new VideoStudioError(`第 ${index + 1} 个图片片段必须提供 0–600 秒的 duration。`, 'INVALID_ARGUMENT');
        sourceOut = duration;
      } else {
        sourceOut = Number(clip.sourceOut ?? asset.media?.duration ?? 0);
        if (!Number.isFinite(sourceOut) || sourceOut <= sourceIn) throw new VideoStudioError(`第 ${index + 1} 个片段 sourceOut 必须大于 sourceIn。`, 'INVALID_ARGUMENT');
        if (asset.media?.duration && sourceOut > asset.media.duration + 0.05) throw new VideoStudioError(`第 ${index + 1} 个片段 sourceOut 超出了素材时长。`, 'INVALID_ARGUMENT');
        duration = (sourceOut - sourceIn) / speed;
      }
      return { assetId: asset.id, sourceIn, sourceOut, speed, duration, fit };
    });
    for (const [assetId, role, label] of [[musicAssetId, 'audio', '背景音乐'], [voiceoverAssetId, 'audio', '旁白']]) {
      if (assetId !== null && assetId !== undefined && (!byId.has(assetId) || byId.get(assetId).role !== role)) {
        throw new VideoStudioError(`${label}必须引用本项目中已导入的音频素材。`, 'INVALID_AUDIO_ASSET');
      }
    }
    if (![originalAudioVolume, musicVolume, voiceoverVolume].every((value) => Number.isFinite(value) && value >= 0 && value <= 2)) {
      throw new VideoStudioError('原视频、音乐和旁白音量必须在 0–2 之间。', 'INVALID_ARGUMENT');
    }
    project.timeline = {
      ...project.timeline,
      clips: normalizedClips,
      musicAssetId: musicAssetId || null,
      voiceoverAssetId: voiceoverAssetId || null,
      originalAudioVolume,
      musicVolume,
      voiceoverVolume,
      fit,
    };
    project.revision += 1;
    await saveProject(project);
    return { projectId, revision: project.revision, clipCount: normalizedClips.length, duration: normalizedClips.reduce((sum, clip) => sum + clip.duration, 0), timeline: project.timeline };
    });
  }

  async function setSubtitles(args) {
    const { projectId, expectedRevision, srtContent, burnIn = false } = args;
    return withProjectLock(projectId, async () => {
    const project = await readProject(projectId);
    if (expectedRevision !== project.revision) throw new VideoStudioError(`项目版本已变化。当前 revision 是 ${project.revision}，请先重新读取项目。`, 'REVISION_CONFLICT');
    if (typeof srtContent !== 'string' || !srtContent.trim() || srtContent.length > 2_000_000) throw new VideoStudioError('SRT 内容不能为空，且不能超过 2MB。', 'INVALID_ARGUMENT');
    if (!/\d{2}:\d{2}:\d{2}[,.]\d{3}\s+-->\s+\d{2}:\d{2}:\d{2}[,.]\d{3}/.test(srtContent)) {
      throw new VideoStudioError('没有检测到有效的 SRT 时间码（例如 00:00:01,000 --> 00:00:03,000）。', 'INVALID_SRT');
    }
    const subtitlePath = path.join(projectPath(projectId), 'outputs', 'subtitles.srt');
    const { writeFile } = await import('node:fs/promises');
    await writeFile(subtitlePath, srtContent.replace(/\r?\n/g, '\r\n'), 'utf8');
    project.timeline.subtitles = { path: subtitlePath, burnIn: Boolean(burnIn), updatedAt: new Date().toISOString() };
    project.revision += 1;
    await saveProject(project);
    return { projectId, revision: project.revision, subtitleFile: 'subtitles.srt', url: `/files/${projectId}/subtitles.srt`, burnIn: Boolean(burnIn) };
    });
  }

  async function getSubtitles(projectId) {
    const file = path.join(projectPath(projectId), 'outputs', 'subtitles.srt');
    try { return await (await import('node:fs/promises')).readFile(file, 'utf8'); }
    catch (error) { if (error.code === 'ENOENT') return ''; throw error; }
  }

  async function getRawProject(projectId) { return readProject(projectId); }
  async function saveRawProject(project) { return saveProject(project); }
  async function appendOutput(projectId, output) {
    return withProjectLock(projectId, async () => {
      const latest = await readProject(projectId);
      latest.outputs.push(output);
      await saveProject(latest);
      return latest;
    });
  }
  async function resolveProjectOutput(projectId, fileName) {
    const directory = path.join(projectPath(projectId), 'outputs');
    const safeName = path.basename(fileName);
    const outputPath = path.join(directory, safeName);
    if (!isInside(directory, outputPath)) throw new VideoStudioError('输出路径无效。', 'INVALID_PATH');
    await access(outputPath);
    return outputPath;
  }

  async function inspectFile(filePath) {
    const info = await lstat(filePath);
    return { isFile: info.isFile(), size: info.size };
  }

  return {
    dataDir, allowedRoots, projectsDir, jobsDir, initialize, createProject, listProjects,
    getProject, getRawProject, saveRawProject, appendOutput, withProjectLock, importAsset, updateTimeline, setSubtitles, getSubtitles,
    readProject, projectPath, resolveAllowedFile, resolveProjectOutput, inspectFile,
  };
}
