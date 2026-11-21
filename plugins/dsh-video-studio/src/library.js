import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ensureDir, id, readJson, writeJsonAtomic, assertId } from './util.js';
import { VideoStudioError } from './errors.js';

const VALID_TAG = /^[\p{L}\p{N} _.-]{1,32}$/u;

function normalizeTags(tags) {
  if (tags === undefined) return [];
  if (!Array.isArray(tags) || tags.length > 20) throw new VideoStudioError('tags 必须是最多 20 个标签的数组。', 'INVALID_ARGUMENT');
  return [...new Set(tags.map((tag) => {
    const value = String(tag).trim();
    if (!VALID_TAG.test(value)) throw new VideoStudioError('标签长度必须是 1–32 个字符，不能包含特殊路径字符。', 'INVALID_ARGUMENT');
    return value;
  }))];
}

function publicItem(item) {
  const { path: _path, ...value } = item;
  return value;
}

async function hashFile(filePath) {
  const hash = createHash('sha256');
  await new Promise((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.once('error', reject);
    stream.once('end', resolve);
  });
  return hash.digest('hex');
}

export function createMediaLibrary({ dataDir, resolveAllowedFile, store, ffprobePath = 'ffprobe', pixabay, imageProvider } = {}) {
  const directory = path.join(dataDir, 'library');
  const assetsDir = path.join(directory, 'assets');
  const cacheDir = path.join(directory, 'cache');
  const indexPath = path.join(directory, 'index.json');
  let writeChain = Promise.resolve();

  async function initialize() {
    await Promise.all([ensureDir(assetsDir), ensureDir(cacheDir)]);
    try { await readJson(indexPath); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await writeJsonAtomic(indexPath, { version: 1, items: [] });
    }
  }

  async function readIndex() {
    try {
      const index = await readJson(indexPath);
      if (!Array.isArray(index.items)) throw new Error('Invalid media library index');
      return index;
    } catch (error) {
      if (error.code === 'ENOENT') return { version: 1, items: [] };
      throw new VideoStudioError('本地素材库索引损坏：' + error.message, 'LIBRARY_INDEX_INVALID');
    }
  }

  async function updateIndex(mutator) {
    const current = writeChain.catch(() => {}).then(async () => {
      const index = await readIndex();
      const result = await mutator(index);
      await writeJsonAtomic(indexPath, index);
      return result;
    });
    writeChain = current;
    return current;
  }

  async function addBuffer({ buffer, extension, role, name, tags = [], source = null, media = null }) {
    if (!Buffer.isBuffer(buffer) || !buffer.length) throw new VideoStudioError('素材内容为空。', 'INVALID_ARGUMENT');
    if (!['image', 'video', 'audio'].includes(role)) throw new VideoStudioError('素材类型无效。', 'INVALID_ARGUMENT');
    const allowed = role === 'image' ? ['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.tif', '.tiff']
      : role === 'video' ? ['.mp4', '.webm', '.mov', '.mkv']
        : ['.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg'];
    const ext = String(extension || '').toLowerCase();
    if (!allowed.includes(ext)) throw new VideoStudioError('素材扩展名与类型不匹配：' + ext, 'UNSUPPORTED_MEDIA');
    const digest = createHash('sha256').update(buffer).digest('hex');
    const cleanTags = normalizeTags(tags);
    const sourceRecord = source && typeof source === 'object' ? {
      provider: String(source.provider || 'local').slice(0, 40),
      mediaId: source.mediaId ? String(source.mediaId).slice(0, 80) : null,
      mediaType: source.mediaType ? String(source.mediaType).slice(0, 20) : null,
      sourceUrl: source.sourceUrl ? String(source.sourceUrl).slice(0, 1000) : null,
      author: source.author ? String(source.author).slice(0, 120) : null,
      license: source.license ? String(source.license).slice(0, 120) : null,
      prompt: source.prompt ? String(source.prompt).slice(0, 4000) : null,
      model: source.model ? String(source.model).slice(0, 120) : null,
      downloadedAt: source.downloadedAt || new Date().toISOString(),
    } : { provider: 'local', downloadedAt: new Date().toISOString() };

    return updateIndex(async (index) => {
      let existing = index.items.find((item) => item.sha256 === digest);
      if (existing) {
        existing.tags = [...new Set([...(existing.tags || []), ...cleanTags])].slice(0, 20);
        existing.sources ||= [];
        if (sourceRecord && !existing.sources.some((item) => item.provider === sourceRecord.provider && item.sourceUrl === sourceRecord.sourceUrl && item.prompt === sourceRecord.prompt)) {
          existing.sources.push(sourceRecord);
        }
        existing.updatedAt = new Date().toISOString();
        return publicItem(existing);
      }
      const fileName = digest + ext;
      const filePath = path.join(assetsDir, fileName);
      const temporary = filePath + '.' + process.pid + '.tmp';
      await writeFile(temporary, buffer, { flag: 'wx' });
      await rename(temporary, filePath);
      const item = {
        id: id('lib'),
        name: String(name || fileName).trim().slice(0, 160) || fileName,
        role,
        extension: ext,
        fileName,
        path: filePath,
        size: buffer.length,
        sha256: digest,
        tags: cleanTags,
        sources: [sourceRecord],
        media,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      index.items.push(item);
      return publicItem(item);
    });
  }

  async function addFile({ filePath, role, name, tags = [] }) {
    const resolved = await resolveAllowedFile(filePath);
    const ext = path.extname(resolved.path).toLowerCase();
    if (!['image', 'video', 'audio'].includes(role)) throw new VideoStudioError('素材类型无效。', 'INVALID_ARGUMENT');
    const digest = await hashFile(resolved.path);
    const existing = (await readIndex()).items.find((item) => item.sha256 === digest);
    if (existing) {
      if (existing.role !== role) throw new VideoStudioError('相同文件已存在于素材库，但素材类型不一致。', 'LIBRARY_ROLE_CONFLICT');
      return updateIndex(async (index) => {
        const item = index.items.find((entry) => entry.id === existing.id);
        item.tags = [...new Set([...(item.tags || []), ...normalizeTags(tags)])].slice(0, 20);
        item.sources ||= [];
        if (!item.sources.some((source) => source.provider === 'local')) item.sources.push({ provider: 'local', downloadedAt: new Date().toISOString() });
        item.updatedAt = new Date().toISOString();
        return publicItem(item);
      });
    }
    const buffer = await readFile(resolved.path);
    return addBuffer({ buffer, extension: ext, role, name: name || path.basename(resolved.path), tags, source: { provider: 'local' } });
  }

  async function list({ query = '', tags = [], role, limit = 100, offset = 0 } = {}) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new VideoStudioError('素材库 limit 必须是 1–200。', 'INVALID_ARGUMENT');
    if (!Number.isInteger(offset) || offset < 0) throw new VideoStudioError('素材库 offset 不能小于 0。', 'INVALID_ARGUMENT');
    const wantedTags = normalizeTags(tags);
    const needle = String(query || '').trim().toLowerCase();
    const index = await readIndex();
    const filtered = index.items.filter((item) => {
      if (role && item.role !== role) return false;
      if (wantedTags.length && !wantedTags.every((tag) => (item.tags || []).includes(tag))) return false;
      if (!needle) return true;
      const haystack = [item.name, item.role, ...(item.tags || []), ...(item.sources || []).flatMap((source) => [source.provider, source.author, source.prompt, source.sourceUrl])].join(' ').toLowerCase();
      return haystack.includes(needle);
    }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return { total: filtered.length, items: filtered.slice(offset, offset + limit).map(publicItem) };
  }

  async function tag({ libraryId, add = [], remove = [] }) {
    assertId(libraryId, 'lib', '素材库 ID');
    const additions = normalizeTags(add);
    const removals = normalizeTags(remove);
    return updateIndex(async (index) => {
      const item = index.items.find((entry) => entry.id === libraryId);
      if (!item) throw new VideoStudioError('素材库中不存在该素材：' + libraryId, 'LIBRARY_ITEM_NOT_FOUND');
      item.tags = [...new Set([...(item.tags || []).filter((value) => !removals.includes(value)), ...additions])].slice(0, 20);
      item.updatedAt = new Date().toISOString();
      return publicItem(item);
    });
  }

  async function importToProject({ projectId, libraryId, label }) {
    assertId(libraryId, 'lib', '素材库 ID');
    const index = await readIndex();
    const item = index.items.find((entry) => entry.id === libraryId);
    if (!item) throw new VideoStudioError('素材库中不存在该素材：' + libraryId, 'LIBRARY_ITEM_NOT_FOUND');
    const result = await store.importAsset({
      projectId,
      sourcePath: item.path,
      role: item.role,
      label: label || item.name,
      metadata: { libraryId: item.id, tags: item.tags, sources: item.sources },
    });
    return { ...result, libraryId: item.id };
  }

  async function downloadPixabay(args) {
    if (!pixabay) throw new VideoStudioError('Pixabay 提供方未初始化。', 'PIXABAY_NOT_CONFIGURED');
    const downloaded = await pixabay.download(args);
    return addBuffer({
      buffer: downloaded.buffer,
      extension: downloaded.extension,
      role: downloaded.role,
      name: downloaded.name,
      tags: downloaded.source.tags || args.tags || [],
      source: downloaded.source,
      media: downloaded.media,
    });
  }

  async function generateImage(args) {
    if (!imageProvider) throw new VideoStudioError('图片生成提供方未初始化。', 'IMAGE_PROVIDER_NOT_CONFIGURED');
    const generated = await imageProvider.generate(args);
    return addBuffer({
      buffer: generated.buffer,
      extension: generated.extension,
      role: 'image',
      name: args.name || String(args.prompt).slice(0, 80),
      tags: args.tags || [],
      source: {
        provider: 'image-generation',
        prompt: args.prompt,
        model: generated.model,
        downloadedAt: generated.createdAt,
      },
      media: { width: null, height: null, mimeType: generated.mimeType },
    });
  }

  async function get(libraryId) {
    assertId(libraryId, 'lib', '素材库 ID');
    const item = (await readIndex()).items.find((entry) => entry.id === libraryId);
    if (!item) throw new VideoStudioError('素材库中不存在该素材：' + libraryId, 'LIBRARY_ITEM_NOT_FOUND');
    return item;
  }

  return {
    initialize,
    addFile,
    addBuffer,
    list,
    tag,
    get,
    importToProject,
    downloadPixabay,
    generateImage,
    cacheDir,
    get pixabayConfigured() { return Boolean(pixabay?.configured); },
    get imageGenerationConfigured() { return Boolean(imageProvider?.configured); },
    imageModel: imageProvider?.model || null,
  };
}
