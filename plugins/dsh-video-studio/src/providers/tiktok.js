import { mkdir, rename, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { readJson } from '../util.js';
import { VideoStudioError } from '../errors.js';

const TOKEN_URL = 'https://open.tiktokapis.com/v2/oauth/token/';
const VIDEO_LIST_URL = 'https://open.tiktokapis.com/v2/video/list/';
const VIDEO_FIELDS = 'id,create_time,share_url,video_description,title,duration,width,height,view_count,like_count,comment_count,share_count';

function normalizeVideo(video) {
  const id = String(video.id || '');
  if (!/^\d{8,30}$/.test(id)) return null;
  const count = (value) => Number.isSafeInteger(Number(value)) && Number(value) >= 0 ? Number(value) : null;
  const fields = { views: 'view_count', likes: 'like_count', comments: 'comment_count', shares: 'share_count' };
  return {
    id, provider: 'tiktok-display-api',
    title: String(video.title || video.video_description || '').slice(0, 150),
    description: String(video.video_description || '').slice(0, 150),
    createTime: Number.isFinite(Number(video.create_time)) ? new Date(Number(video.create_time) * 1000).toISOString() : null,
    shareUrl: typeof video.share_url === 'string' ? video.share_url : null,
    duration: count(video.duration), width: count(video.width), height: count(video.height),
    metrics: Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, count(video[field])])),
    availableMetrics: Object.entries(fields).filter(([, field]) => video[field] !== undefined && video[field] !== null).map(([key]) => key),
  };
}

export class TikTokProvider {
  constructor({ dataDir, clientKey, clientSecret, accessToken, refreshToken, fetchImpl = globalThis.fetch } = {}) {
    this.tokenPath = dataDir ? path.join(dataDir, 'integrations', 'tiktok-token.json') : null;
    this.clientKey = String(clientKey ?? process.env.DSH_VIDEO_STUDIO_TIKTOK_CLIENT_KEY ?? '').trim();
    this.clientSecret = String(clientSecret ?? process.env.DSH_VIDEO_STUDIO_TIKTOK_CLIENT_SECRET ?? '').trim();
    this.accessToken = String(accessToken ?? process.env.DSH_VIDEO_STUDIO_TIKTOK_ACCESS_TOKEN ?? '').trim();
    this.refreshToken = String(refreshToken ?? process.env.DSH_VIDEO_STUDIO_TIKTOK_REFRESH_TOKEN ?? '').trim();
    this.accessExpiresAt = 0;
    this.refreshExpiresAt = 0;
    this.pendingState = null;
    this.fetchImpl = fetchImpl;
    this.refreshPromise = null;
  }
  get configured() { return Boolean(this.accessToken || (this.refreshToken && this.clientKey && this.clientSecret)); }

  async initialize() {
    if (!this.tokenPath) return;
    try {
      const saved = await readJson(this.tokenPath);
      this.accessToken = saved.accessToken || this.accessToken;
      this.refreshToken = saved.refreshToken || this.refreshToken;
      this.accessExpiresAt = Number(saved.accessExpiresAt) || 0;
      this.refreshExpiresAt = Number(saved.refreshExpiresAt) || 0;
      this.pendingState = saved.pendingState || null;
    } catch (error) {
      if (error.code !== 'ENOENT') throw new VideoStudioError('TikTok 本地令牌文件无法读取：' + error.message, 'TIKTOK_TOKEN_STORE_INVALID');
    }
  }

  async saveTokens(payload) {
    if (!this.tokenPath) return;
    await mkdir(path.dirname(this.tokenPath), { recursive: true });
    const temporary = this.tokenPath + '.' + process.pid + '.tmp';
    await writeFile(temporary, JSON.stringify({
      accessToken: this.accessToken, refreshToken: this.refreshToken,
      accessExpiresAt: this.accessExpiresAt, refreshExpiresAt: this.refreshExpiresAt,
      openId: payload?.open_id || null, scope: payload?.scope || null,
      pendingState: this.pendingState, updatedAt: new Date().toISOString(),
    }, null, 2), { encoding: 'utf8', mode: 0o600, flag: 'w' });
    await rename(temporary, this.tokenPath);
  }

  async createAuthorizationUrl({ redirectUri } = {}) {
    if (!this.clientKey || !this.clientSecret) throw new VideoStudioError('创建 TikTok 授权链接前，必须配置 Client Key 和 Client Secret。', 'TIKTOK_OAUTH_NOT_CONFIGURED');
    let redirect;
    try { redirect = new URL(redirectUri); } catch { throw new VideoStudioError('redirectUri 必须是 TikTok 开发者后台已登记的 HTTPS 或 localhost 回调地址。', 'INVALID_ARGUMENT'); }
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(redirect.hostname);
    if (redirect.protocol !== 'https:' && !(local && redirect.protocol === 'http:')) throw new VideoStudioError('TikTok OAuth redirectUri 必须使用 HTTPS（本机 localhost 调试除外）。', 'INVALID_ARGUMENT');
    this.pendingState = randomBytes(24).toString('hex');
    await this.saveTokens();
    const url = new URL('https://www.tiktok.com/v2/auth/authorize/');
    url.searchParams.set('client_key', this.clientKey);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'user.info.basic,video.list');
    url.searchParams.set('redirect_uri', redirect.toString());
    url.searchParams.set('state', this.pendingState);
    return { authorizationUrl: url.toString(), state: this.pendingState, redirectUri: redirect.toString(), scopes: ['user.info.basic', 'video.list'], message: '请在浏览器打开 authorizationUrl，完成 TikTok 授权后，将回调 URL 中的 code 和 state 交给 video_tiktok_connect。' };
  }

  async exchangeAuthorizationCode({ code, state, redirectUri } = {}) {
    if (!this.clientKey || !this.clientSecret) throw new VideoStudioError('TikTok Client Key 或 Client Secret 未配置。', 'TIKTOK_OAUTH_NOT_CONFIGURED');
    if (typeof code !== 'string' || !code.trim() || code.length > 2048) throw new VideoStudioError('TikTok OAuth code 无效。', 'INVALID_ARGUMENT');
    if (!this.pendingState || typeof state !== 'string' || state !== this.pendingState) throw new VideoStudioError('TikTok OAuth state 不匹配或已过期，请重新生成授权链接。', 'TIKTOK_OAUTH_STATE_MISMATCH');
    let redirect;
    try { redirect = new URL(redirectUri); } catch { throw new VideoStudioError('redirectUri 无效。', 'INVALID_ARGUMENT'); }
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(redirect.hostname);
    if (redirect.protocol !== 'https:' && !(local && redirect.protocol === 'http:')) throw new VideoStudioError('TikTok OAuth redirectUri 必须使用 HTTPS（本机 localhost 调试除外）。', 'INVALID_ARGUMENT');
    const body = new URLSearchParams({ client_key: this.clientKey, client_secret: this.clientSecret, code: code.trim(), grant_type: 'authorization_code', redirect_uri: redirect.toString() });
    let response;
    try {
      response = await this.fetchImpl(TOKEN_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body, signal: AbortSignal.timeout(15000) });
    } catch (error) { throw new VideoStudioError('TikTok OAuth code 兑换失败：' + error.message, 'TIKTOK_NETWORK_ERROR', { cause: error }); }
    let payload;
    try { payload = JSON.parse(await response.text()); } catch { throw new VideoStudioError('TikTok OAuth 返回无效 JSON。', 'TIKTOK_INVALID_RESPONSE'); }
    if (!response.ok || payload.error || !payload.access_token || !payload.refresh_token) throw new VideoStudioError('TikTok OAuth 授权失败：' + (payload.error_description || payload.message || response.status), 'TIKTOK_OAUTH_FAILED');
    const grantedScopes = String(payload.scope || '').split(/[ ,]+/).filter(Boolean);
    if (grantedScopes.length && !grantedScopes.includes('video.list')) {
      throw new VideoStudioError('TikTok 账号授权缺少 video.list 权限，请重新授权并勾选所需权限。', 'TIKTOK_SCOPE_MISSING');
    }
    this.accessToken = payload.access_token;
    this.refreshToken = payload.refresh_token;
    this.accessExpiresAt = Date.now() + Math.max(0, Number(payload.expires_in) || 0) * 1000;
    this.refreshExpiresAt = Date.now() + Math.max(0, Number(payload.refresh_expires_in) || 0) * 1000;
    this.pendingState = null;
    await this.saveTokens(payload);
    return { connected: true, openId: payload.open_id || null, scopes: String(payload.scope || '').split(/[ ,]+/).filter(Boolean), accessTokenExpiresIn: Number(payload.expires_in) || null, refreshTokenExpiresIn: Number(payload.refresh_expires_in) || null, message: 'TikTok 账号授权成功，令牌已保存在本机数据目录。' };
  }

  async refreshAccessToken() {
    if (!this.refreshToken || !this.clientKey || !this.clientSecret) throw new VideoStudioError('TikTok access token 已过期或无效。请配置 client key、client secret 和 refresh token。', 'TIKTOK_REAUTH_REQUIRED');
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = (async () => {
      const body = new URLSearchParams({ client_key: this.clientKey, client_secret: this.clientSecret, grant_type: 'refresh_token', refresh_token: this.refreshToken });
      let response;
      try {
        response = await this.fetchImpl(TOKEN_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'cache-control': 'no-cache' }, body, signal: AbortSignal.timeout(15000) });
      } catch (error) { throw new VideoStudioError('TikTok 令牌刷新请求失败：' + error.message, 'TIKTOK_NETWORK_ERROR', { cause: error }); }
      let payload;
      try { payload = JSON.parse(await response.text()); } catch { throw new VideoStudioError('TikTok 令牌刷新返回无效 JSON。', 'TIKTOK_INVALID_RESPONSE'); }
      if (!response.ok || payload.error) throw new VideoStudioError('TikTok 令牌刷新失败：' + (payload.error_description || payload.message || response.status), 'TIKTOK_TOKEN_REFRESH_FAILED');
      if (!payload.access_token || !payload.refresh_token) throw new VideoStudioError('TikTok 令牌刷新响应缺少 access_token 或 refresh_token。', 'TIKTOK_INVALID_RESPONSE');
      this.accessToken = payload.access_token;
      this.refreshToken = payload.refresh_token;
      this.accessExpiresAt = Date.now() + Math.max(0, Number(payload.expires_in) || 0) * 1000;
      this.refreshExpiresAt = Date.now() + Math.max(0, Number(payload.refresh_expires_in) || 0) * 1000;
      await this.saveTokens(payload);
      return this.accessToken;
    })();
    try { return await this.refreshPromise; } finally { this.refreshPromise = null; }
  }

  async getAccessToken(forceRefresh = false) {
    if (!this.configured) throw new VideoStudioError('尚未配置 TikTok API。需要 TikTok 开发者应用获批 video.list 权限并配置 OAuth access token；建议同时配置 client key、client secret 和 refresh token 以自动续期。', 'TIKTOK_NOT_CONFIGURED');
    if (forceRefresh || (!this.accessToken && this.refreshToken) || (this.accessExpiresAt && Date.now() > this.accessExpiresAt - 5 * 60 * 1000)) return this.refreshAccessToken();
    return this.accessToken;
  }

  async requestVideoPage({ cursor, maxCount, signal }, retry = true) {
    const token = await this.getAccessToken();
    const url = new URL(VIDEO_LIST_URL);
    url.searchParams.set('fields', VIDEO_FIELDS);
    let response;
    try {
      response = await this.fetchImpl(url, { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: JSON.stringify({ max_count: maxCount, ...(cursor === undefined ? {} : { cursor }) }), signal: signal || AbortSignal.timeout(20000) });
    } catch (error) { throw new VideoStudioError('TikTok 视频列表请求失败：' + error.message, 'TIKTOK_NETWORK_ERROR', { cause: error }); }
    let payload;
    try { payload = JSON.parse(await response.text()); } catch { throw new VideoStudioError('TikTok 视频列表返回无效 JSON。', 'TIKTOK_INVALID_RESPONSE'); }
    if (response.status === 401 && retry && this.refreshToken) {
      await this.getAccessToken(true);
      return this.requestVideoPage({ cursor, maxCount, signal }, false);
    }
    if (!response.ok || (payload.error?.code && payload.error.code !== 'ok')) throw new VideoStudioError('TikTok 视频列表请求失败：' + (payload.error?.message || response.status), response.status === 429 ? 'TIKTOK_RATE_LIMIT' : 'TIKTOK_REQUEST_FAILED');
    return payload.data || {};
  }

  async listVideos({ limit = 100, signal } = {}) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new VideoStudioError('TikTok 同步数量必须是 1–200。', 'INVALID_ARGUMENT');
    const videos = [];
    let cursor;
    let hasMore = true;
    while (hasMore && videos.length < limit) {
      const data = await this.requestVideoPage({ cursor, maxCount: Math.min(20, limit - videos.length), signal });
      const page = Array.isArray(data.videos) ? data.videos : [];
      for (const item of page) { const normalized = normalizeVideo(item); if (normalized) videos.push(normalized); }
      hasMore = data.has_more === true && page.length > 0;
      cursor = data.cursor;
      if (hasMore && !Number.isFinite(Number(cursor))) throw new VideoStudioError('TikTok 分页响应缺少有效 cursor。', 'TIKTOK_INVALID_RESPONSE');
    }
    return {
      provider: 'tiktok-display-api', count: videos.length, videos,
      metricsAvailable: ['views', 'likes', 'comments', 'shares'],
      metricsUnavailable: ['saves', 'profileVisits', 'follows', 'conversions'],
      note: 'TikTok Display API 不提供主页访问、关注和 CPS 转化数据；这些指标需要从业务后台或实际数据表补录。',
    };
  }
}
