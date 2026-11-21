import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { PixabayProvider } from '../src/providers/pixabay.js';
import { createImageGenerationProvider } from '../src/providers/image-generation.js';
import { TikTokProvider } from '../src/providers/tiktok.js';

const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(16, 1)]);
const hit = {
  id: 123,
  pageURL: 'https://pixabay.com/photos/city-night-123/',
  type: 'photo',
  tags: 'city, night, skyline',
  previewURL: 'https://cdn.pixabay.com/photo/preview.jpg',
  largeImageURL: 'https://cdn.pixabay.com/photo/city.png',
  imageWidth: 1600,
  imageHeight: 900,
  user: 'creator',
  views: 100,
  downloads: 20,
  likes: 5,
};

test('Pixabay search caches results for 24 hours and preserves source attribution', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'video-pixabay-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  let apiCalls = 0;
  const fetchImpl = async (input) => {
    const url = new URL(input);
    if (url.hostname === 'pixabay.com') {
      apiCalls += 1;
      return new Response(JSON.stringify({ total: 1, totalHits: 1, hits: [hit] }), {
        status: 200,
        headers: { 'content-type': 'application/json', 'x-ratelimit-remaining': '90' },
      });
    }
    if (url.hostname === 'cdn.pixabay.com') {
      return new Response(png, { status: 200, headers: { 'content-type': 'image/png', 'content-length': String(png.length) } });
    }
    throw new Error('Unexpected host');
  };
  const provider = new PixabayProvider({ apiKey: 'test-secret', cacheDir: root, fetchImpl });
  const first = await provider.search({ query: 'city night', mediaType: 'image' });
  const second = await provider.search({ query: 'city night', mediaType: 'image' });
  assert.equal(first.results[0].sourceUrl, hit.pageURL);
  assert.equal(first.results[0].author, 'creator');
  assert.equal(first.results[0].license, 'Pixabay Content License');
  assert.equal(second.cacheHit, true);
  assert.equal(apiCalls, 1);

  const downloaded = await provider.download({ mediaId: '123', mediaType: 'image' });
  assert.equal(downloaded.role, 'image');
  assert.equal(downloaded.extension, '.png');
  assert.equal(downloaded.source.author, 'creator');
  assert.equal(downloaded.source.sourceUrl, hit.pageURL);
  assert.equal(downloaded.buffer.length, png.length);
  assert.equal(apiCalls, 2);
});

test('Pixabay download rejects a URL outside the Pixabay CDN allowlist', async () => {
  const provider = new PixabayProvider({
    apiKey: 'test-secret',
    fetchImpl: async (input) => {
      const url = new URL(input);
      if (url.hostname === 'pixabay.com') {
        return new Response(JSON.stringify({ totalHits: 1, hits: [{ ...hit, largeImageURL: 'https://evil.example/file.png' }] }), { status: 200 });
      }
      throw new Error('Should not request an untrusted host');
    },
  });
  await assert.rejects(provider.download({ mediaId: '123', mediaType: 'image' }), (error) => error.code === 'REMOTE_HOST_NOT_ALLOWED');
});

test('Pixabay download retries the 429 burst limit and then succeeds', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'video-pixabay-retry-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  let fileCalls = 0;
  const fetchImpl = async (input) => {
    const url = new URL(input);
    if (url.hostname === 'pixabay.com') {
      return new Response(JSON.stringify({ total: 1, totalHits: 1, hits: [hit] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    fileCalls += 1;
    if (fileCalls < 3) return new Response('', { status: 429, headers: { 'retry-after': '0' } });
    return new Response(png, { status: 200, headers: { 'content-type': 'image/png', 'content-length': String(png.length) } });
  };
  const provider = new PixabayProvider({ apiKey: 'test-secret', cacheDir: root, fetchImpl, retryDelaysMs: [0, 0] });
  const downloaded = await provider.download({ mediaId: '123', mediaType: 'image' });
  assert.equal(downloaded.extension, '.png');
  assert.equal(fileCalls, 3, 'two 429 responses are retried before the successful attempt');
});

test('Pixabay download explains the burst limit once the retries are exhausted', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'video-pixabay-429-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  let fileCalls = 0;
  const fetchImpl = async (input) => {
    const url = new URL(input);
    if (url.hostname === 'pixabay.com') {
      return new Response(JSON.stringify({ total: 1, totalHits: 1, hits: [hit] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    fileCalls += 1;
    return new Response('', { status: 429 });
  };
  const provider = new PixabayProvider({ apiKey: 'test-secret', cacheDir: root, fetchImpl, retryDelaysMs: [0, 0] });
  await assert.rejects(provider.download({ mediaId: '123', mediaType: 'image' }), (error) => {
    assert.equal(error.code, 'PIXABAY_DOWNLOAD_FAILED');
    assert.match(error.message, /HTTP 429/);
    assert.match(error.message, /避免同时下载多个素材/);
    return true;
  });
  assert.equal(fileCalls, 3, 'one attempt plus two retries');
});

test('Pixabay downloads are serialized so they do not trip the burst limit', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'video-pixabay-serial-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const events = [];
  const fetchImpl = async (input) => {
    const url = new URL(input);
    if (url.hostname === 'pixabay.com') {
      return new Response(JSON.stringify({ total: 1, totalHits: 1, hits: [hit] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    events.push('start');
    await new Promise((resolve) => setTimeout(resolve, 25));
    events.push('end');
    return new Response(png, { status: 200, headers: { 'content-type': 'image/png', 'content-length': String(png.length) } });
  };
  const provider = new PixabayProvider({ apiKey: 'test-secret', cacheDir: root, fetchImpl, retryDelaysMs: [] });
  await Promise.all([
    provider.download({ mediaId: '123', mediaType: 'image' }),
    provider.download({ mediaId: '123', mediaType: 'image' }),
  ]);
  assert.deepEqual(events, ['start', 'end', 'start', 'end'], 'a second download waits for the first file fetch');
});

test('OpenAI-compatible image generation validates returned PNG bytes', async () => {
  const fetchImpl = async (url, options) => {
    assert.equal(String(url), 'https://images.example/v1/images/generations');
    assert.equal(options.headers.authorization, 'Bearer test-key');
    const payload = { created: 1700000000, data: [{ b64_json: png.toString('base64') }] };
    return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const provider = createImageGenerationProvider({
    imageApiKey: 'test-key',
    imageApiBaseUrl: 'https://images.example/v1',
    imageModel: 'test-image-model',
    fetchImpl,
  });
  const result = await provider.generate({ prompt: 'A quiet mountain lake', size: '1024x1536', outputFormat: 'png' });
  assert.equal(result.model, 'test-image-model');
  assert.equal(result.extension, '.png');
  assert.equal(result.buffer.length, png.length);
  assert.equal(provider.configured, true);
});

test('explains a 405 as a missing API prefix instead of dumping an nginx page', async () => {
  const provider = createImageGenerationProvider({
    imageApiKey: 'test-key',
    imageApiBaseUrl: 'https://images.example',
    fetchImpl: async () => new Response('<html><title>405 Not Allowed</title>nginx</html>', { status: 405 }),
  });
  await assert.rejects(provider.generate({ prompt: 'A test image' }), (error) => {
    assert.equal(error.code, 'IMAGE_PROVIDER_REQUEST_FAILED');
    assert.match(error.message, /HTTP 405/);
    assert.match(error.message, /Base URL 可能缺少 API 前缀/);
    assert.equal(error.message.includes('<html>'), false);
    return true;
  });
});

test('image generation waits ten minutes by default and stays configurable', async () => {
  const { resolveImageTimeoutMs } = await import('../src/providers/image-generation.js');
  assert.equal(resolveImageTimeoutMs({}), 600000);
  assert.equal(resolveImageTimeoutMs({ imageTimeoutMs: 900000 }), 900000);
  assert.equal(resolveImageTimeoutMs({ imageTimeoutMs: '450000' }), 450000);
  assert.equal(resolveImageTimeoutMs({ imageTimeoutMs: 1000 }), 600000, 'below the floor falls back to the default');
  assert.equal(resolveImageTimeoutMs({ imageTimeoutMs: 'abc' }), 600000);
  assert.equal(resolveImageTimeoutMs({ imageTimeoutMs: 999999999 }), 600000, 'absurd waits fall back to the default');
});

test('reports a generation timeout with actionable advice', async () => {
  const provider = createImageGenerationProvider({
    imageApiKey: 'test-key',
    imageApiBaseUrl: 'https://images.example/v1',
    imageTimeoutMs: 5000,
    fetchImpl: async () => {
      const error = new Error('The operation was aborted due to timeout');
      error.name = 'TimeoutError';
      throw error;
    },
  });
  await assert.rejects(provider.generate({ prompt: 'slow' }), (error) => {
    assert.equal(error.code, 'IMAGE_PROVIDER_TIMEOUT');
    assert.match(error.message, /超时/);
    assert.match(error.message, /imageTimeoutMs/);
    return true;
  });
});

test('lists image models from the OpenAI-compatible /models endpoint', async () => {
  const fetchImpl = async (url, options) => {
    assert.equal(String(url), 'https://images.example/v1/models');
    assert.equal(options.headers.authorization, 'Bearer test-key');
    const payload = { data: [{ id: 'gpt-image-1' }, { id: 'dall-e-3' }, { id: 'gpt-image-1' }] };
    return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const provider = createImageGenerationProvider({
    imageApiKey: 'test-key',
    imageApiBaseUrl: 'https://images.example/v1',
    fetchImpl,
  });
  const result = await provider.listModels();
  assert.deepEqual(result.models, ['dall-e-3', 'gpt-image-1']);
  assert.equal(result.count, 2);
  assert.equal(result.baseUrl, 'https://images.example/v1');
});

test('model listing follows a changed volatile key without rebuilding the provider', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push(options.headers.authorization);
    return new Response(JSON.stringify({ data: [{ id: 'live-model' }] }), { status: 200 });
  };
  let key;
  const provider = createImageGenerationProvider({
    imageApiKey: { get: () => key },
    imageApiBaseUrl: 'https://images.example/v1',
    fetchImpl,
  });
  await assert.rejects(provider.listModels(), (error) => error.code === 'IMAGE_PROVIDER_NOT_CONFIGURED');
  key = 'late-key';
  assert.deepEqual((await provider.listModels()).models, ['live-model']);
  assert.deepEqual(calls, ['Bearer late-key']);
});

test('model listing reports authorization failures without leaking the key', async () => {
  const provider = createImageGenerationProvider({
    imageApiKey: 'super-secret',
    imageApiBaseUrl: 'https://images.example/v1',
    fetchImpl: async () => new Response('invalid key super-secret', { status: 401 }),
  });
  await assert.rejects(provider.listModels(), (error) => {
    assert.equal(error.code, 'IMAGE_PROVIDER_UNAUTHORIZED');
    assert.equal(error.message.includes('super-secret'), false);
    return true;
  });
});

test('image generation fails clearly when API credentials are missing', async () => {
  const provider = createImageGenerationProvider({ imageApiKey: '' });
  await assert.rejects(provider.generate({ prompt: 'A test image' }), (error) => error.code === 'IMAGE_PROVIDER_NOT_CONFIGURED');
});

test('TikTok Display API paginates and returns official public-video metrics', async () => {
  const calls = [];
  const provider = new TikTokProvider({
    accessToken: 'access-token',
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), body: JSON.parse(options.body), auth: options.headers.authorization });
      const page = calls.length;
      return new Response(JSON.stringify({
        data: {
          videos: [{
            id: String(1234567890123456789 + page), create_time: 1700000000,
            share_url: 'https://www.tiktok.com/@creator/video/1234567890123456789',
            title: 'A real TikTok post', view_count: 1200, like_count: 120, comment_count: 12, share_count: 6,
          }],
          cursor: page, has_more: page === 1,
        },
        error: { code: 'ok', message: '' },
      }), { status: 200 });
    },
  });
  const result = await provider.listVideos({ limit: 2 });
  assert.equal(result.count, 2);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].auth, 'Bearer access-token');
  assert.equal(calls[1].body.cursor, 1);
  assert.equal(result.videos[0].metrics.views, 1200);
  assert.deepEqual(result.metricsUnavailable, ['saves', 'profileVisits', 'follows', 'conversions']);
});

test('TikTok provider rotates refresh tokens and persists the replacement', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'video-tiktok-token-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const provider = new TikTokProvider({
    dataDir: root, clientKey: 'client-key', clientSecret: 'client-secret', refreshToken: 'old-refresh',
    fetchImpl: async (url, options) => {
      assert.equal(String(url), 'https://open.tiktokapis.com/v2/oauth/token/');
      assert.equal(options.body.get('refresh_token'), 'old-refresh');
      return new Response(JSON.stringify({
        access_token: 'new-access', refresh_token: 'rotated-refresh',
        expires_in: 7200, refresh_expires_in: 15552000, open_id: 'open-id', scope: 'user.info.basic,video.list',
      }), { status: 200 });
    },
  });
  assert.equal(await provider.getAccessToken(), 'new-access');
  assert.equal(provider.refreshToken, 'rotated-refresh');
  const { readFile } = await import('node:fs/promises');
  const saved = JSON.parse(await readFile(path.join(root, 'integrations', 'tiktok-token.json'), 'utf8'));
  assert.equal(saved.accounts.default.refreshToken, 'rotated-refresh');
});

test('image generation accepts custom portrait sizes suitable for vertical video', async () => {
  let sent;
  const provider = createImageGenerationProvider({
    imageApiKey: 'test-key', imageApiBaseUrl: 'https://images.example/v1', imageModel: 'gpt-image-2.6-flare',
    fetchImpl: async (_url, options) => {
      sent = JSON.parse(options.body);
      return new Response(JSON.stringify({ data: [{ b64_json: png.toString('base64') }] }), { status: 200 });
    },
  });
  await provider.generate({ prompt: 'Vertical cinematic city scene', size: '1024x1824', quality: 'high' });
  assert.equal(sent.size, '1024x1824');
  await assert.rejects(provider.generate({ prompt: 'bad', size: '1025x1824' }), (error) => error.code === 'INVALID_ARGUMENT');
});

test('TikTok OAuth authorization validates state and exchanges code for rotating tokens', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'video-tiktok-oauth-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  let tokenRequest;
  const provider = new TikTokProvider({
    dataDir: root, clientKey: 'client-key', clientSecret: 'client-secret',
    fetchImpl: async (url, options) => {
      tokenRequest = { url: String(url), body: options.body };
      return new Response(JSON.stringify({
        access_token: 'oauth-access', refresh_token: 'oauth-refresh',
        expires_in: 7200, refresh_expires_in: 15552000, open_id: 'open-id',
        scope: 'user.info.basic,video.list',
      }), { status: 200 });
    },
  });
  await provider.initialize();
  const auth = await provider.createAuthorizationUrl({ redirectUri: 'https://example.com/tiktok/callback' });
  const authUrl = new URL(auth.authorizationUrl);
  assert.equal(authUrl.searchParams.get('client_key'), 'client-key');
  assert.equal(authUrl.searchParams.get('scope'), 'user.info.basic,video.list');
  await assert.rejects(
    provider.exchangeAuthorizationCode({ code: 'code', state: 'wrong', redirectUri: auth.redirectUri }),
    (error) => error.code === 'TIKTOK_OAUTH_STATE_MISMATCH',
  );
  const connected = await provider.exchangeAuthorizationCode({ code: 'auth-code', state: auth.state, redirectUri: auth.redirectUri });
  assert.equal(connected.connected, true);
  assert.equal(tokenRequest.body.get('grant_type'), 'authorization_code');
  assert.equal(tokenRequest.body.get('code'), 'auth-code');
  assert.equal(provider.refreshToken, 'oauth-refresh');
});


test('Pixabay download enforces streamed size limits without trusting Content-Length', async () => {
  const provider = new PixabayProvider({
    apiKey: 'test-secret',
    maxDownloadBytes: 16,
    fetchImpl: async (input) => {
      const url = new URL(input);
      if (url.hostname === 'pixabay.com') {
        return new Response(JSON.stringify({ totalHits: 1, hits: [hit] }), { status: 200 });
      }
      if (url.hostname === 'cdn.pixabay.com') {
        const body = new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(12));
            controller.enqueue(new Uint8Array(12));
            controller.close();
          },
        });
        return new Response(body, { status: 200, headers: { 'content-type': 'image/png' } });
      }
      throw new Error('Unexpected host');
    },
  });
  await assert.rejects(provider.download({ mediaId: '123', mediaType: 'image' }), (error) => error.code === 'REMOTE_MEDIA_TOO_LARGE');
});

test('Pixabay download rejects payloads whose bytes do not match the declared image type', async () => {
  const provider = new PixabayProvider({
    apiKey: 'test-secret',
    fetchImpl: async (input) => {
      const url = new URL(input);
      if (url.hostname === 'pixabay.com') return new Response(JSON.stringify({ totalHits: 1, hits: [hit] }), { status: 200 });
      if (url.hostname === 'cdn.pixabay.com') return new Response(Buffer.from('<html>not an image</html>'), { status: 200, headers: { 'content-type': 'image/png' } });
      throw new Error('Unexpected host');
    },
  });
  await assert.rejects(provider.download({ mediaId: '123', mediaType: 'image' }), (error) => error.code === 'UNSUPPORTED_REMOTE_MEDIA');
});


test('keeps multiple named TikTok accounts and OAuth states isolated', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'video-tiktok-multi-account-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const tokenRequests = [];
  const videoRequests = [];
  const provider = new TikTokProvider({
    dataDir: root, clientKey: 'client-key', clientSecret: 'client-secret',
    fetchImpl: async (url, options) => {
      if (String(url) === 'https://open.tiktokapis.com/v2/oauth/token/') {
        const code = options.body.get('code');
        tokenRequests.push(code);
        const suffix = code === 'project-code' ? 'project' : 'midvideo';
        return new Response(JSON.stringify({
          access_token: 'access-' + suffix,
          refresh_token: 'refresh-' + suffix,
          expires_in: 7200,
          refresh_expires_in: 15552000,
          open_id: 'open-' + suffix,
          scope: 'user.info.basic,video.list',
        }), { status: 200 });
      }
      const request = new URL(String(url));
      assert.equal(request.pathname, '/v2/video/list/');
      videoRequests.push(options.headers.authorization);
      return new Response(JSON.stringify({ data: { videos: [], cursor: 0, has_more: false }, error: { code: 'ok' } }), { status: 200 });
    },
  });
  await provider.initialize();
  const [projectAuth, midVideoAuth] = await Promise.all([
    provider.createAuthorizationUrl({ redirectUri: 'https://example.com/tiktok/callback', accountId: 'capcut-project-01' }),
    provider.createAuthorizationUrl({ redirectUri: 'https://example.com/tiktok/callback', accountId: 'mid-video-01' }),
  ]);
  assert.notEqual(projectAuth.state, midVideoAuth.state);

  await assert.rejects(
    provider.exchangeAuthorizationCode({ code: 'project-code', state: projectAuth.state, redirectUri: projectAuth.redirectUri, accountId: 'mid-video-01' }),
    (error) => error.code === 'TIKTOK_OAUTH_STATE_MISMATCH',
  );
  await assert.rejects(
    provider.exchangeAuthorizationCode({ code: 'project-code', state: projectAuth.state, redirectUri: 'https://other.example/callback', accountId: 'capcut-project-01' }),
    (error) => error.code === 'TIKTOK_OAUTH_REDIRECT_MISMATCH',
  );
  await provider.exchangeAuthorizationCode({ code: 'project-code', state: projectAuth.state, redirectUri: projectAuth.redirectUri, accountId: 'capcut-project-01' });
  await provider.exchangeAuthorizationCode({ code: 'mid-video-code', state: midVideoAuth.state, redirectUri: midVideoAuth.redirectUri, accountId: 'mid-video-01' });

  const projectState = provider.getAccount('capcut-project-01');
  const midVideoState = provider.getAccount('mid-video-01');
  assert.equal(projectState.openId, 'open-project');
  assert.equal(midVideoState.openId, 'open-midvideo');
  assert.equal(await provider.getAccessToken('capcut-project-01'), 'access-project');
  assert.equal(await provider.getAccessToken('mid-video-01'), 'access-midvideo');

  await provider.listVideos({ accountId: 'capcut-project-01', limit: 1 });
  await provider.listVideos({ accountId: 'mid-video-01', limit: 1 });
  assert.deepEqual(videoRequests, ['Bearer access-project', 'Bearer access-midvideo']);

  const saved = JSON.parse(await (await import('node:fs/promises')).readFile(path.join(root, 'integrations', 'tiktok-token.json'), 'utf8'));
  assert.deepEqual(Object.keys(saved.accounts).sort(), ['capcut-project-01', 'mid-video-01']);
  const restored = new TikTokProvider({ dataDir: root, clientKey: 'client-key', clientSecret: 'client-secret' });
  await restored.initialize();
  assert.deepEqual(restored.listAccounts().map((account) => account.accountId).sort(), ['capcut-project-01', 'mid-video-01']);
  assert.deepEqual(tokenRequests, ['project-code', 'mid-video-code']);
});

test('rejects an expired TikTok OAuth state', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'video-tiktok-state-expiry-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const provider = new TikTokProvider({
    dataDir: root, clientKey: 'client-key', clientSecret: 'client-secret',
    fetchImpl: async () => { throw new Error('Expired state must be rejected before network request'); },
  });
  await provider.initialize();
  const auth = await provider.createAuthorizationUrl({ redirectUri: 'https://example.com/tiktok/callback', accountId: 'account-01' });
  provider.getAccount('account-01').pendingStateExpiresAt = Date.now() - 1;
  await assert.rejects(
    provider.exchangeAuthorizationCode({ code: 'expired-code', state: auth.state, redirectUri: auth.redirectUri, accountId: 'account-01' }),
    (error) => error.code === 'TIKTOK_OAUTH_STATE_MISMATCH',
  );
});


test('Pixabay network errors never reveal the API key in returned messages', async () => {
  const secret = 'pixabay-secret-key';
  const provider = new PixabayProvider({
    apiKey: secret,
    fetchImpl: async (url) => { throw new Error('fetch failed: ' + String(url)); },
  });
  await assert.rejects(
    provider.search({ query: 'city skyline' }),
    (error) => error.code === 'PIXABAY_NETWORK_ERROR' && !error.message.includes(secret) && error.message.includes('[redacted]'),
  );
});
