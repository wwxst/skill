import { VideoStudioError } from '../errors.js';
import { liveValue } from '../util.js';

function validBaseUrl(value) {
  let url;
  try { url = new URL(value); }
  catch { throw new VideoStudioError('图片生成 API Base URL 无效。', 'IMAGE_PROVIDER_CONFIG_INVALID'); }
  const local = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
    throw new VideoStudioError('图片生成 API 必须使用 HTTPS（本机 localhost 调试除外）。', 'IMAGE_PROVIDER_CONFIG_INVALID');
  }
  return url.toString().replace(/\/+$/, '');
}

function mimeFor(format) {
  return format === 'jpeg' ? 'image/jpeg' : format === 'webp' ? 'image/webp' : 'image/png';
}

function assertImageBytes(buffer, format) {
  const valid = format === 'png'
    ? buffer.length > 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : format === 'jpeg'
      ? buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
      : buffer.length > 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP';
  if (!valid) throw new VideoStudioError('图片生成服务返回的数据不是预期的 ' + format + ' 图片。', 'IMAGE_PROVIDER_INVALID_IMAGE');
}

const DEFAULT_TIMEOUT_MS = 600000;
const MIN_TIMEOUT_MS = 5000;
const MAX_TIMEOUT_MS = 900000;

/** Image generation regularly runs for minutes; keep the wait bounded but configurable. */
export function resolveImageTimeoutMs(config = {}) {
  const raw = Number(liveValue(config.imageTimeoutMs) ?? process.env.DSH_VIDEO_STUDIO_IMAGE_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
  if (!Number.isFinite(raw) || raw < MIN_TIMEOUT_MS || raw > MAX_TIMEOUT_MS) return DEFAULT_TIMEOUT_MS;
  return Math.round(raw);
}

export function createImageGenerationProvider(config = {}) {
  const fetchImpl = config.fetchImpl ?? globalThis.fetch;

  // These values may be live volatile fields, so resolve them per operation: the
  // Harness settings page edits the key, base URL, and model while the plugin runs.
  function resolve() {
    const apiKey = String(liveValue(config.imageApiKey) ?? process.env.DSH_VIDEO_STUDIO_IMAGE_API_KEY ?? '').trim();
    const rawBaseUrl = liveValue(config.imageApiBaseUrl) ?? process.env.DSH_VIDEO_STUDIO_IMAGE_BASE_URL ?? 'https://api.openai.com/v1';
    const baseUrl = validBaseUrl(rawBaseUrl);
    const model = String(liveValue(config.imageModel) ?? process.env.DSH_VIDEO_STUDIO_IMAGE_MODEL ?? 'gpt-image-2.6-flare').trim();
    return { apiKey, baseUrl, model };
  }

  async function generate({ prompt, size = '1024x1536', quality = 'medium', outputFormat = 'png', signal } = {}) {
    const { apiKey, baseUrl, model } = resolve();
    if (!apiKey) throw new VideoStudioError('尚未配置图片生成 API Key。请设置 DSH_VIDEO_STUDIO_IMAGE_API_KEY。', 'IMAGE_PROVIDER_NOT_CONFIGURED');
    if (typeof prompt !== 'string' || !prompt.trim() || prompt.trim().length > 4000) throw new VideoStudioError('图片生成提示词不能为空，且不能超过 4000 个字符。', 'INVALID_ARGUMENT');
    const dimensions = String(size);
    if (dimensions !== 'auto') {
      const match = /^(\d{3,4})x(\d{3,4})$/.exec(dimensions);
      const width = match ? Number(match[1]) : 0;
      const height = match ? Number(match[2]) : 0;
      if (!match || width < 256 || height < 256 || width > 3840 || height > 3840 || width % 16 !== 0 || height % 16 !== 0 || width / height < 1 / 3 || width / height > 3) {
        throw new VideoStudioError('图片尺寸必须为 auto，或 256–3840 之间、16 的倍数，宽高比在 1:3 到 3:1 之间，例如 1024x1824。', 'INVALID_ARGUMENT');
      }
    }
    if (!['low', 'medium', 'high', 'xhigh', 'max', 'auto'].includes(quality)) throw new VideoStudioError('图片质量只支持 low、medium、high、xhigh、max、auto。', 'INVALID_ARGUMENT');
    if (!['png', 'jpeg', 'webp'].includes(outputFormat)) throw new VideoStudioError('图片格式只支持 png、jpeg、webp。', 'INVALID_ARGUMENT');

    const timeout = AbortSignal.timeout(resolveImageTimeoutMs(config));
    const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let response;
    let raw;
    try {
      response = await fetchImpl(baseUrl + '/images/generations', {
        method: 'POST',
        headers: { authorization: 'Bearer ' + apiKey, 'content-type': 'application/json' },
        body: JSON.stringify({ model, prompt: prompt.trim(), n: 1, size, quality, output_format: outputFormat }),
        signal: requestSignal,
      });
      // Read the body inside the same guard: a provider that sends headers and then
      // stalls the body would otherwise surface the bare AbortSignal message.
      raw = await response.text();
    } catch (error) {
      if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
        throw new VideoStudioError(
          '图片生成请求超时（等待 ' + Math.round(resolveImageTimeoutMs(config) / 1000) + ' 秒）。'
            + '可以调高 imageTimeoutMs，或用更小的尺寸/更低的 quality 重试。',
          'IMAGE_PROVIDER_TIMEOUT',
          { cause: error },
        );
      }
      throw new VideoStudioError('图片生成请求失败：' + error.message, 'IMAGE_PROVIDER_NETWORK_ERROR', { cause: error });
    }
    if (!response.ok) {
      let message = raw.slice(0, 1000);
      try { message = JSON.parse(raw).error?.message || message; } catch { /* Keep response text. */ }
      if (/^\s*</.test(message)) message = '服务返回了 HTML 错误页';
      message = message.replaceAll(apiKey, '[redacted]').replace(/\s+/g, ' ').trim().slice(0, 300);
      // A bare host usually means the API prefix is missing: /images/generations
      // then hits the web server instead of the API and comes back 404 or 405.
      const hint = response.status === 404 || response.status === 405
        ? ' Base URL 可能缺少 API 前缀，请填写形如 https://host/v1 的地址。'
        : '';
      const code = response.status === 429 ? 'IMAGE_PROVIDER_RATE_LIMIT' : 'IMAGE_PROVIDER_REQUEST_FAILED';
      throw new VideoStudioError('图片生成服务返回 HTTP ' + response.status + '：' + message + hint, code);
    }
    let payload;
    try { payload = JSON.parse(raw); }
    catch (error) { throw new VideoStudioError('图片生成服务返回了无法解析的 JSON。', 'IMAGE_PROVIDER_INVALID_RESPONSE', { cause: error }); }
    const base64 = payload.data?.[0]?.b64_json;
    if (typeof base64 !== 'string' || !base64.trim()) {
      throw new VideoStudioError('图片生成服务没有返回 b64_json 图片数据。请使用兼容 OpenAI Images API 的提供方。', 'IMAGE_PROVIDER_INVALID_RESPONSE');
    }
    if (base64.length > 80 * 1024 * 1024) throw new VideoStudioError('图片生成结果超过 60MB 限制。', 'IMAGE_PROVIDER_IMAGE_TOO_LARGE');
    const buffer = Buffer.from(base64, 'base64');
    if (!buffer.length || buffer.length > 60 * 1024 * 1024) throw new VideoStudioError('图片生成结果为空或超过 60MB。', 'IMAGE_PROVIDER_IMAGE_TOO_LARGE');
    assertImageBytes(buffer, outputFormat);
    return {
      buffer,
      extension: outputFormat === 'jpeg' ? '.jpg' : '.' + outputFormat,
      mimeType: mimeFor(outputFormat),
      model,
      revisedPrompt: payload.data?.[0]?.revised_prompt || null,
      createdAt: payload.created ? new Date(payload.created * 1000).toISOString() : new Date().toISOString(),
    };
  }

  async function listModels() {
    const { apiKey, baseUrl } = resolve();
    if (!apiKey) throw new VideoStudioError('尚未配置图片生成 API Key。请设置 DSH_VIDEO_STUDIO_IMAGE_API_KEY 或在设置页填写。', 'IMAGE_PROVIDER_NOT_CONFIGURED');
    let response;
    try {
      response = await fetchImpl(baseUrl + '/models', {
        headers: { authorization: 'Bearer ' + apiKey },
        signal: AbortSignal.timeout(15000),
      });
    } catch (error) {
      const message = String(error?.message || error).replaceAll(apiKey, '[redacted]');
      throw new VideoStudioError('读取图片模型列表失败：' + message, 'IMAGE_PROVIDER_NETWORK_ERROR', { cause: error });
    }
    const raw = await response.text();
    if (!response.ok) {
      const message = raw.slice(0, 500).replaceAll(apiKey, '[redacted]');
      const code = response.status === 401 || response.status === 403 ? 'IMAGE_PROVIDER_UNAUTHORIZED' : 'IMAGE_PROVIDER_REQUEST_FAILED';
      throw new VideoStudioError('图片生成服务返回 HTTP ' + response.status + '：' + message, code);
    }
    let payload;
    try { payload = JSON.parse(raw); }
    catch (error) { throw new VideoStudioError('模型列表不是有效的 JSON。', 'IMAGE_PROVIDER_INVALID_RESPONSE', { cause: error }); }
    const entries = Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.models) ? payload.models : [];
    const models = [...new Set(entries
      .map((entry) => (typeof entry === 'string' ? entry : entry?.id))
      .filter((value) => typeof value === 'string' && value.trim())
      .map((value) => value.trim()))].sort();
    if (models.length === 0) throw new VideoStudioError('图片生成服务没有返回任何模型，请确认 Base URL 是否兼容 OpenAI /models 接口。', 'IMAGE_PROVIDER_NO_MODELS');
    return { baseUrl, models, count: models.length };
  }

  return {
    get configured() {
      try { return Boolean(resolve().apiKey); } catch { return false; }
    },
    get model() {
      try { return resolve().model; } catch { return null; }
    },
    get baseUrl() {
      try { return resolve().baseUrl; } catch { return null; }
    },
    generate,
    listModels,
  };
}
