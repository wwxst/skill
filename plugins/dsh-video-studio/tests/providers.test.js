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
  assert.equal(saved.refreshToken, 'rotated-refresh');
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
