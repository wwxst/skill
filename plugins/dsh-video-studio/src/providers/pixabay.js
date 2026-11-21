import { createHash } from 'node:crypto';
import path from 'node:path';
import { ensureDir, readJson, writeJsonAtomic } from '../util.js';
import { VideoStudioError } from '../errors.js';

const IMAGE_API = 'https://pixabay.com/api/';
const VIDEO_API = 'https://pixabay.com/api/videos/';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024;
const ALLOWED_HOSTS = new Set(['pixabay.com', 'www.pixabay.com', 'cdn.pixabay.com']);

function normalizeTags(value) {
  return String(value || '').split(',').map((item) => item.trim()).filter(Boolean).slice(0, 20);
}

function imageResult(hit) {
  return {
    id: String(hit.id),
    provider: 'pixabay',
    mediaType: 'image',
    license: 'Pixabay Content License',
    title: normalizeTags(hit.tags).slice(0, 3).join(' '),
    tags: normalizeTags(hit.tags),
    sourceUrl: hit.pageURL,
    author: hit.user || null,
    previewUrl: hit.previewURL || null,
    width: Number(hit.imageWidth || hit.webformatWidth) || null,
    height: Number(hit.imageHeight || hit.webformatHeight) || null,
    views: Number(hit.views) || 0,
    downloads: Number(hit.downloads) || 0,
    likes: Number(hit.likes) || 0,
  };
}

function videoResult(hit) {
  const rendition = hit.videos?.medium || hit.videos?.small || hit.videos?.tiny || hit.videos?.large;
  return {
    id: String(hit.id),
    provider: 'pixabay',
    mediaType: 'video',
    license: 'Pixabay Content License',
    title: normalizeTags(hit.tags).slice(0, 3).join(' '),
    tags: normalizeTags(hit.tags),
    sourceUrl: hit.pageURL,
    author: hit.user || null,
    previewUrl: rendition?.thumbnail || null,
    width: Number(rendition?.width) || null,
    height: Number(rendition?.height) || null,
    duration: Number(hit.duration) || null,
    views: Number(hit.views) || 0,
    downloads: Number(hit.downloads) || 0,
    likes: Number(hit.likes) || 0,
  };
}

function extensionFromMime(mime, url) {
  const type = String(mime || '').split(';')[0].trim().toLowerCase();
  const byMime = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'video/mp4': '.mp4',
    'video/webm': '.webm',
  };
  if (byMime[type]) return byMime[type];
  const ext = path.extname(new URL(url).pathname).toLowerCase();
  if (['.jpg', '.jpeg', '.png', '.webp', '.mp4', '.webm'].includes(ext)) return ext === '.jpeg' ? '.jpg' : ext;
  throw new VideoStudioError('Pixabay 返回了不支持的素材格式：' + (type || 'unknown'), 'UNSUPPORTED_REMOTE_MEDIA');
}

function assertPixabayUrl(value) {
  let url;
  try { url = new URL(value); }
  catch { throw new VideoStudioError('Pixabay 返回的下载地址无效。', 'INVALID_REMOTE_URL'); }
  if (url.protocol !== 'https:' || !ALLOWED_HOSTS.has(url.hostname.toLowerCase()) || url.username || url.password) {
    throw new VideoStudioError('Pixabay 下载地址不在允许的 HTTPS 域名范围内。', 'REMOTE_HOST_NOT_ALLOWED');
  }
  return url;
}

async function readLimitedBody(response, maxBytes) {
  if (!response.body) throw new VideoStudioError('Pixabay 下载响应没有文件内容。', 'PIXABAY_EMPTY_DOWNLOAD');
  const chunks = [];
  let total = 0;
  for await (const chunk of response.body) {
    const buffer = Buffer.from(chunk);
    total += buffer.length;
    if (total > maxBytes) throw new VideoStudioError('Pixabay 素材超过下载大小上限。', 'REMOTE_MEDIA_TOO_LARGE');
    chunks.push(buffer);
  }
  if (!total) throw new VideoStudioError('Pixabay 下载素材为空。', 'PIXABAY_EMPTY_DOWNLOAD');
  return Buffer.concat(chunks, total);
}

function assertMediaSignature(buffer, mediaType, extension) {
  const validImage = extension === '.png'
    ? buffer.length > 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : extension === '.jpg'
      ? buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
      : extension === '.webp'
        ? buffer.length > 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP'
        : false;
  const validVideo = extension === '.mp4'
    ? buffer.length > 12 && buffer.toString('ascii', 4, 8) === 'ftyp'
    : extension === '.webm'
      ? buffer.length > 4 && buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))
      : false;
  if (!(mediaType === 'image' ? validImage : validVideo)) {
    throw new VideoStudioError('Pixabay 下载内容与声明的媒体格式不匹配。', 'UNSUPPORTED_REMOTE_MEDIA');
  }
}

export class PixabayProvider {
  constructor({ apiKey = process.env.DSH_VIDEO_STUDIO_PIXABAY_API_KEY, cacheDir, fetchImpl = globalThis.fetch, maxDownloadBytes = MAX_DOWNLOAD_BYTES } = {}) {
    this.apiKey = String(apiKey || '').trim();
    this.cacheDir = cacheDir;
    this.fetchImpl = fetchImpl;
    if (!Number.isInteger(maxDownloadBytes) || maxDownloadBytes < 1 || maxDownloadBytes > MAX_DOWNLOAD_BYTES) {
      throw new VideoStudioError('Pixabay 下载大小上限配置无效。', 'INVALID_ARGUMENT');
    }
    this.maxDownloadBytes = maxDownloadBytes;
  }

  get configured() { return Boolean(this.apiKey); }

  async requestJson(endpoint, params, signal) {
    if (!this.configured) throw new VideoStudioError('尚未配置 Pixabay API Key。请设置 DSH_VIDEO_STUDIO_PIXABAY_API_KEY。', 'PIXABAY_NOT_CONFIGURED');
    const url = new URL(endpoint);
    url.searchParams.set('key', this.apiKey);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    }
    let response;
    try {
      response = await this.fetchImpl(url, { signal: signal || AbortSignal.timeout(15000) });
    } catch (error) {
      throw new VideoStudioError('Pixabay 请求失败：' + error.message, 'PIXABAY_NETWORK_ERROR', { cause: error });
    }
    if (!response.ok) {
      const message = (await response.text()).slice(0, 500);
      const code = response.status === 429 ? 'PIXABAY_RATE_LIMIT' : 'PIXABAY_REQUEST_FAILED';
      throw new VideoStudioError('Pixabay 返回 HTTP ' + response.status + '：' + message, code);
    }
    try { return { data: await response.json(), headers: response.headers }; }
    catch (error) { throw new VideoStudioError('Pixabay 返回了无法解析的 JSON。', 'PIXABAY_INVALID_RESPONSE', { cause: error }); }
  }

  async search({ query, mediaType = 'image', orientation = 'vertical', category, imageType = 'photo', page = 1, perPage = 20, lang = 'zh', order = 'popular', signal } = {}) {
    if (!['image', 'video'].includes(mediaType)) throw new VideoStudioError('mediaType 只能是 image 或 video。', 'INVALID_ARGUMENT');
    if (typeof query !== 'string' || !query.trim() || query.trim().length > 100) throw new VideoStudioError('搜索关键词不能为空，且不能超过 100 个字符。', 'INVALID_ARGUMENT');
    if (!Number.isInteger(page) || page < 1 || page > 100) throw new VideoStudioError('搜索页码必须是 1–100。', 'INVALID_ARGUMENT');
    if (!Number.isInteger(perPage) || perPage < 3 || perPage > 50) throw new VideoStudioError('每页数量必须是 3–50。', 'INVALID_ARGUMENT');
    if (!['all', 'horizontal', 'vertical'].includes(orientation)) throw new VideoStudioError('orientation 参数无效。', 'INVALID_ARGUMENT');
    if (!['popular', 'latest'].includes(order)) throw new VideoStudioError('order 只能是 popular 或 latest。', 'INVALID_ARGUMENT');
    if (mediaType === 'image' && !['all', 'photo', 'illustration', 'vector'].includes(imageType)) throw new VideoStudioError('imageType 参数无效。', 'INVALID_ARGUMENT');

    const params = { q: query.trim(), orientation, page, per_page: perPage, lang, safesearch: 'true', order };
    if (category) params.category = category;
    if (mediaType === 'image') params.image_type = imageType;
    const cacheKey = createHash('sha256').update(JSON.stringify({ mediaType, params })).digest('hex');
    const cachePath = this.cacheDir ? path.join(this.cacheDir, 'pixabay-' + cacheKey + '.json') : null;
    if (cachePath) {
      try {
        const cached = await readJson(cachePath);
        if (Date.now() - cached.cachedAt < CACHE_TTL_MS) return { ...cached.result, cacheHit: true };
      } catch { /* Cache miss or stale cache. */ }
    }

    const { data, headers } = await this.requestJson(mediaType === 'video' ? VIDEO_API : IMAGE_API, params, signal);
    const results = (data.hits || []).map(mediaType === 'video' ? videoResult : imageResult);
    const result = {
      provider: 'pixabay',
      mediaType,
      query: query.trim(),
      total: Number(data.total) || 0,
      totalHits: Number(data.totalHits) || 0,
      page,
      perPage,
      results,
      attribution: '素材来源：Pixabay。点击每条素材的来源链接查看作者和授权信息。',
      rateLimit: {
        limit: Number(headers.get('x-ratelimit-limit')) || null,
        remaining: Number(headers.get('x-ratelimit-remaining')) || null,
        resetSeconds: Number(headers.get('x-ratelimit-reset')) || null,
      },
      cacheHit: false,
    };
    if (cachePath) {
      await ensureDir(this.cacheDir);
      await writeJsonAtomic(cachePath, { cachedAt: Date.now(), result });
    }
    return result;
  }

  async getById(mediaId, mediaType, signal) {
    if (!/^\d{1,20}$/.test(String(mediaId))) throw new VideoStudioError('Pixabay 素材 ID 格式不正确。', 'INVALID_ARGUMENT');
    if (!['image', 'video'].includes(mediaType)) throw new VideoStudioError('mediaType 只能是 image 或 video。', 'INVALID_ARGUMENT');
    const { data } = await this.requestJson(mediaType === 'video' ? VIDEO_API : IMAGE_API, { id: String(mediaId), safesearch: 'true' }, signal);
    const hit = data.hits?.[0];
    if (!hit) throw new VideoStudioError('Pixabay 中找不到该素材，请重新搜索。', 'PIXABAY_MEDIA_NOT_FOUND');
    return hit;
  }

  async download({ mediaId, mediaType = 'image', signal } = {}) {
    const hit = await this.getById(mediaId, mediaType, signal);
    const downloadUrl = mediaType === 'video'
      ? (hit.videos?.medium?.url || hit.videos?.small?.url || hit.videos?.tiny?.url || hit.videos?.large?.url)
      : (hit.fullHDURL || hit.largeImageURL || hit.webformatURL);
    if (!downloadUrl) throw new VideoStudioError('Pixabay 没有提供可下载的素材版本。', 'PIXABAY_DOWNLOAD_UNAVAILABLE');
    let url = assertPixabayUrl(downloadUrl);
    let response;
    for (let redirects = 0; redirects <= 3; redirects += 1) {
      response = await this.fetchImpl(url, { redirect: 'manual', signal: signal || AbortSignal.timeout(30000) });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      if (redirects === 3) throw new VideoStudioError('Pixabay 下载重定向次数过多。', 'REMOTE_REDIRECT_LIMIT');
      const location = response.headers.get('location');
      if (!location) throw new VideoStudioError('Pixabay 下载重定向缺少 Location。', 'INVALID_REMOTE_REDIRECT');
      url = assertPixabayUrl(new URL(location, url).toString());
    }
    if (!response?.ok) throw new VideoStudioError('Pixabay 素材下载失败，HTTP ' + (response?.status || 0), 'PIXABAY_DOWNLOAD_FAILED');
    const declaredSize = Number(response.headers.get('content-length')) || 0;
    if (declaredSize > this.maxDownloadBytes) throw new VideoStudioError('素材超过 ' + Math.round(this.maxDownloadBytes / (1024 * 1024)) + 'MB 下载上限。', 'REMOTE_MEDIA_TOO_LARGE');
    const mimeType = response.headers.get('content-type') || '';
    const extension = extensionFromMime(mimeType, url.toString());
    if (mediaType === 'image' && !['.jpg', '.png', '.webp'].includes(extension)) throw new VideoStudioError('下载内容不是受支持的图片。', 'UNSUPPORTED_REMOTE_MEDIA');
    if (mediaType === 'video' && !['.mp4', '.webm'].includes(extension)) throw new VideoStudioError('下载内容不是受支持的视频。', 'UNSUPPORTED_REMOTE_MEDIA');
    const buffer = await readLimitedBody(response, this.maxDownloadBytes);
    assertMediaSignature(buffer, mediaType, extension);
    const normalized = mediaType === 'video' ? videoResult(hit) : imageResult(hit);
    return {
      buffer,
      extension,
      role: mediaType,
      name: normalized.title || ('Pixabay ' + mediaId),
      source: {
        provider: 'pixabay',
        mediaId: String(mediaId),
        mediaType,
        sourceUrl: hit.pageURL,
        author: hit.user || null,
        tags: normalized.tags,
        license: 'Pixabay Content License',
        downloadedAt: new Date().toISOString(),
      },
      media: normalized,
    };
  }
}
