import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { PixabayProvider } from '../src/providers/pixabay.js';
import { createImageGenerationProvider } from '../src/providers/image-generation.js';

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
