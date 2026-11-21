import { mkdir, rename, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { readJson } from '../util.js';
import { VideoStudioError } from '../errors.js';

const TOKEN_URL = 'https://open.tiktokapis.com/v2/oauth/token/';
const VIDEO_LIST_URL = 'https://open.tiktokapis.com/v2/video/list/';
const VIDEO_FIELDS = 'id,create_time,share_url,video_description,title,duration,width,height,view_count,like_count,comment_count,share_count';

function normalizeAccountId(value = 'default') {
  const accountId = String(value || 'default').trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,39}$/.test(accountId)) {
    throw new VideoStudioError('accountId 必须以字母或数字开头，只能包含字母、数字、点、下划线和短横线，最多 40 个字符。', 'INVALID_ARGUMENT');
  }
  return accountId;
}

function emptyAccount() {
  return {
    accessToken: '',
    refreshToken: '',
    accessExpiresAt: 0,
    refreshExpiresAt: 0,
    openId: null,
    scope: null,
    pendingState: null,
    pendingStateExpiresAt: 0,
  };
}

function normalizeVideo(video) {
  const id = String(video.id || '');
  if (!/^\\d{8,30}$/.test(id)) return null;
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
    this.accounts = new Map();
    this.refreshPromises = new Map();
    this.fetchImpl = fetchImpl;
    const initial = emptyAccount();
    initial.accessToken = String(accessToken ?? process.env.DSH_VIDEO_STUDIO_TIKTOK_ACCESS_TOKEN ?? '').trim();
    initial.refreshToken = String(refreshToken ?? process.env.DSH_VIDEO_STUDIO_TIKTOK_REFRESH_TOKEN ?? '').trim();
    if (initial.accessToken || initial.refreshToken) this.accounts.set('default', initial);
  }

  getAccount(accountId = 'default') {
    const key = normalizeAccountId(accountId);
    let account = this.accounts.get(key);
    if (!account) {
      account = emptyAccount();
      this.accounts.set(key, account);
    }
    return account;
  }

  get accessToken() { return this.getAccount('default').accessToken; }
  set accessToken(value) { this.getAccount('default').accessToken = String(value || ''); }
  get refreshToken() { return this.getAccount('default').refreshToken; }
  set refreshToken(value) { this.getAccount('default').refreshToken = String(value || ''); }
  get accessExpiresAt() { return this.getAccount('default').accessExpiresAt; }
  set accessExpiresAt(value) { this.getAccount('default').accessExpiresAt = Number(value) || 0; }
  get refreshExpiresAt() { return this.getAccount('default').refreshExpiresAt; }
  set refreshExpiresAt(value) { this.getAccount('default').refreshExpiresAt = Number(value) || 0; }
  get pendingState() { return this.getAccount('default').pendingState; }
  set pendingState(value) { this.getAccount('default').pendingState = value; }
  get configured() {
    return [...this.accounts.values()].some((account) => Boolean(account.accessToken || (account.refreshToken && this.clientKey && this.clientSecret)));
  }

  listAccounts() {
    return [...this.accounts.entries()]
      .filter(([, account]) => account.accessToken || account.refreshToken || account.openId)
      .map(([accountId, account]) => ({
        accountId,
        openId: account.openId || null,
        connected: Boolean(account.accessToken || account.refreshToken),
        scopes: String(account.scope || '').split(/[ ,]+/).filter(Boolean),
      }));
  }

  async initialize() {
    if (!this.tokenPath) return;
    try {
      const saved = await readJson(this.tokenPath);
      if (saved.accounts && typeof saved.accounts === 'object' && !Array.isArray(saved.accounts)) {
        for (const [accountId, value] of Object.entries(saved.accounts)) {
          const key = normalizeAccountId(accountId);
          this.accounts.set(key, { ...emptyAccount(), ...(value || {}) });
        }
      } else if (saved.accessToken || saved.refreshToken || saved.pendingState) {
        // Migrate the original single-account token file to the named-account format.
        this.accounts.set('default', { ...emptyAccount(), ...saved });
      }
      const defaultAccount = this.accounts.get('default');
      if (defaultAccount) {
        if (!defaultAccount.accessToken) defaultAccount.accessToken = this.accessToken;
        if (!defaultAccount.refreshToken) defaultAccount.refreshToken = this.refreshToken;
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw new VideoStudioError('TikTok 本地令牌文件无法读取：' + error.message, 'TIKTOK_TOKEN_STORE_INVALID');
    }
  }

  async saveTokens(payload, accountId = 'default') {
    if (!this.tokenPath) return;
    const key = normalizeAccountId(accountId);
    const account = this.getAccount(key);
    account.openId = payload?.open_id ?? account.openId ?? null;
    account.scope = payload?.scope ?? account.scope ?? null;
    await mkdir(path.dirname(this.tokenPath), { recursive: true });
    const temporary = this.tokenPath + '.' + process.pid + '.tmp';
    const accounts = Object.fromEntries(this.accounts.entries());
    await writeFile(temporary, JSON.stringify({ version: 2, accounts, updatedAt: new Date().toISOString() }, null, 2), { encoding: 'utf8', mode: 0o600, flag: 'w' });
    await rename(temporary, this.tokenPath);
  }

  async createAuthorizationUrl({ redirectUri, accountId = 'default' } = {}) {
    const key = normalizeAccountId(accountId);
    if (!this.clientKey || !this.clientSecret) throw new VideoStudioError('创建 TikTok 授权链接前，必须配置 Client Key 和 Client Secret。', 'TIKTOK_OAUTH_NOT_CONFIGURED');
    let redirect;
    try { redirect = new URL(redirectUri); } catch { throw new VideoStudioError('redirectUri 必须是 TikTok 开发者后台已登记的 HTTPS 或 localhost 回调地址。', 'INVALID_ARGUMENT'); }
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(redirect.hostname);
    if (redirect.protocol !== 'https:' && !(local && redirect.protocol === 'http:')) throw new VideoStudioError('TikTok OAuth redirectUri 必须使用 HTTPS（本机 localhost 调试除外）。', 'INVALID_ARGUMENT');
    const account = this.getAccount(key);
    account.pendingState = randomBytes(24).toString('hex');
    account.pendingStateExpiresAt = Date.now() + 10 * 60 * 1000;
    await this.saveTokens(null, key);
    const url = new URL('https://www.tiktok.com/v2/auth/authorize/');
    url.searchParams.set('client_key', this.clientKey);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'user.info.basic,video.list');
    url.searchParams.set('redirect_uri', redirect.toString());
    url.searchParams.set('state', account.pendingState);
    return { authorizationUrl: url.toString(), accountId: key, state: account.pendingState, redirectUri: redirect.toString(), scopes: ['user.info.basic', 'video.list'], expiresInSeconds: 600, message: '请在浏览器打开 authorizationUrl，完成 TikTok 授权后，将回调 URL 中的 code 和 state 交给 video_tiktok_connect，并传回相同 accountId。' };
  }

  async exchangeAuthorizationCode({ code, state, redirectUri, accountId = 'default' } = {}) {
    const key = normalizeAccountId(accountId);
    const account = this.getAccount(key);
    if (!this.clientKey || !this.clientSecret) throw new VideoStudioError('TikTok Client Key 或 Client Secret 未配置。', 'TIKTOK_OAUTH_NOT_CONFIGURED');
    if (typeof code !== 'string' || !code.trim() || code.length > 2048) throw new VideoStudioError('TikTok OAuth code 无效。', 'INVALID_ARGUMENT');
    if (!account.pendingState || typeof state !== 'string' || state !== account.pendingState || Date.now() > account.pendingStateExpiresAt) {
      throw new VideoStudioError('TikTok OAuth state 不匹配或已过期，请重新生成授权链接。', 'TIKTOK_OAUTH_STATE_MISMATCH');
    }
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
    account.accessToken = payload.access_token;
    account.refreshToken = payload.refresh_token;
    account.accessExpiresAt = Date.now() + Math.max(0, Number(payload.expires_in) || 0) * 1000;
    account.refreshExpiresAt = Date.now() + Math.max(0, Number(payload.refresh_expires_in) || 0) * 1000;
    account.pendingState = null;
    account.pendingStateExpiresAt = 0;
    await this.saveTokens(payload, key);
    return { connected: true, accountId: key, openId: payload.open_id || null, scopes: grantedScopes, accessTokenExpiresIn: Number(payload.expires_in) || null, refreshTokenExpiresIn: Number(payload.refresh_expires_in) || null, message: 'TikTok 账号授权成功，令牌已保存在本机数据目录。' };
  }

  async refreshAccessToken(accountId = 'default') {
    const key = normalizeAccountId(accountId);
    const account = this.getAccount(key);
    if (!account.refreshToken || !this.clientKey || !this.clientSecret) throw new VideoStudioError('TikTok access token 已过期或无效。请为账号 ' + key + ' 配置授权信息并重新授权。', 'TIKTOK_REAUTH_REQUIRED');
    if (account.refreshExpiresAt && Date.now() > account.refreshExpiresAt) throw new VideoStudioError('TikTok refresh token 已过期，请重新授权账号 ' + key + '。', 'TIKTOK_REAUTH_REQUIRED');
    if (this.refreshPromises.has(key)) return this.refreshPromises.get(key);
    const pending = (async () => {
      const body = new URLSearchParams({ client_key: this.clientKey, client_secret: this.clientSecret, grant_type: 'refresh_token', refresh_token: account.refreshToken });
      let response;
      try {
        response = await this.fetchImpl(TOKEN_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'cache-control': 'no-cache' }, body, signal: AbortSignal.timeout(15000) });
      } catch (error) { throw new VideoStudioError('TikTok 令牌刷新请求失败：' + error.message, 'TIKTOK_NETWORK_ERROR', { cause: error }); }
      let payload;
      try { payload = JSON.parse(await response.text()); } catch { throw new VideoStudioError('TikTok 令牌刷新返回无效 JSON。', 'TIKTOK_INVALID_RESPONSE'); }
      if (!response.ok || payload.error) throw new VideoStudioError('TikTok 令牌刷新失败：' + (payload.error_description || payload.message || response.status), 'TIKTOK_TOKEN_REFRESH_FAILED');
      if (!payload.access_token || !payload.refresh_token) throw new VideoStudioError('TikTok 令牌刷新响应缺少 access_token 或 refresh_token。', 'TIKTOK_INVALID_RESPONSE');
      account.accessToken = payload.access_token;
      account.refreshToken = payload.refresh_token;
      account.accessExpiresAt = Date.now() + Math.max(0, Number(payload.expires_in) || 0) * 1000;
      account.refreshExpiresAt = Date.now() + Math.max(0, Number(payload.refresh_expires_in) || 0) * 1000;
      await this.saveTokens(payload, key);
      return account.accessToken;
    })();
    this.refreshPromises.set(key, pending);
    try { return await pending; }
    finally { this.refreshPromises.delete(key); }
  }

  async getAccessToken(accountId = 'default', forceRefresh = false) {
    const key = normalizeAccountId(accountId);
    const account = this.getAccount(key);
    if (!account.accessToken && !(account.refreshToken && this.clientKey && this.clientSecret)) {
      throw new VideoStudioError('尚未配置 TikTok 账号 ' + key + '。请先调用 video_tiktok_authorize 和 video_tiktok_connect 完成授权。', 'TIKTOK_NOT_CONFIGURED');
    }
    if (forceRefresh || (!account.accessToken && account.refreshToken) || (account.accessExpiresAt && Date.now() > account.accessExpiresAt - 5 * 60 * 1000)) {
      return this.refreshAccessToken(key);
    }
    return account.accessToken;
  }

  async requestVideoPage({ cursor, maxCount, signal, accountId = 'default' }, retry = true) {
    const key = normalizeAccountId(accountId);
    const token = await this.getAccessToken(key);
    const url = new URL(VIDEO_LIST_URL);
    url.searchParams.set('fields', VIDEO_FIELDS);
    let response;
    try {
      response = await this.fetchImpl(url, { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: JSON.stringify({ max_count: maxCount, ...(cursor === undefined ? {} : { cursor }) }), signal: signal || AbortSignal.timeout(20000) });
    } catch (error) { throw new VideoStudioError('TikTok 视频列表请求失败：' + error.message, 'TIKTOK_NETWORK_ERROR', { cause: error }); }
    let payload;
    try { payload = JSON.parse(await response.text()); } catch { throw new VideoStudioError('TikTok 视频列表返回无效 JSON。', 'TIKTOK_INVALID_RESPONSE'); }
    if (response.status === 401 && retry && this.getAccount(key).refreshToken) {
      await this.getAccessToken(key, true);
      return this.requestVideoPage({ cursor, maxCount, signal, accountId: key }, false);
    }
    if (!response.ok || (payload.error?.code && payload.error.code !== 'ok')) throw new VideoStudioError('TikTok 视频列表请求失败：' + (payload.error?.message || response.status), response.status === 429 ? 'TIKTOK_RATE_LIMIT' : 'TIKTOK_REQUEST_FAILED');
    return payload.data || {};
  }

  async listVideos({ limit = 100, signal, accountId = 'default' } = {}) {
    const key = normalizeAccountId(accountId);
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new VideoStudioError('TikTok 同步数量必须是 1–200。', 'INVALID_ARGUMENT');
    const videos = [];
    let cursor;
    let hasMore = true;
    while (hasMore && videos.length < limit) {
      const data = await this.requestVideoPage({ cursor, maxCount: Math.min(20, limit - videos.length), signal, accountId: key });
      const page = Array.isArray(data.videos) ? data.videos : [];
      for (const item of page) { const normalized = normalizeVideo(item); if (normalized) videos.push(normalized); }
      hasMore = data.has_more === true && page.length > 0;
      cursor = data.cursor;
      if (hasMore && !Number.isFinite(Number(cursor))) throw new VideoStudioError('TikTok 分页响应缺少有效 cursor。', 'TIKTOK_INVALID_RESPONSE');
    }
    const account = this.getAccount(key);
    return {
      provider: 'tiktok-display-api', accountId: key, openId: account.openId || null,
      count: videos.length, videos,
      metricsAvailable: ['views', 'likes', 'comments', 'shares'],
      metricsUnavailable: ['saves', 'profileVisits', 'follows', 'conversions'],
      note: 'TikTok Display API 不提供主页访问、关注和 CPS 转化数据；这些指标需要从业务后台或实际数据表补录。',
    };
  }
}
