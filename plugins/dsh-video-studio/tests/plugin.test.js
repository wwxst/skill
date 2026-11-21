import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { apply } from '../index.js';

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

test('mounts as a current DeepSeek Harness host bundle and registers video tools', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-video-plugin-test-'));
  const port = await freePort();
  const registered = [];
  const cleanups = [];
  const sections = [];
  const ctx = {
    tools: { register(definition) { registered.push(definition); return () => {}; } },
    systemPrompt: { section(section) { sections.push(section); return () => {}; } },
    effect(effect) { cleanups.push(effect()); },
  };
  try {
    await apply(ctx, { dataDir: path.join(root, 'data'), allowedRoots: [root], port });
    assert.ok(registered.some((tool) => tool.name === 'video_render'));
    assert.ok(registered.some((tool) => tool.name === 'video_project_create'));
    assert.equal(registered.length, 37);
    for (const name of ['video_media_search', 'video_media_download', 'video_library_list', 'video_storyboard_create', 'video_image_generate', 'video_image_models', 'video_project_duplicate', 'video_batch_render', 'video_job_retry', 'video_quality_check', 'video_performance_record', 'video_performance_summary', 'video_tiktok_authorize', 'video_tiktok_connect', 'video_tiktok_video_list', 'video_tiktok_sync']) {
      assert.ok(registered.some((tool) => tool.name === name), 'missing tool: ' + name);
    }
    const createTool = registered.find((tool) => tool.name === 'video_project_create');
    const created = await createTool.execute({ title: 'Tool registration test' }, { signal: new AbortController().signal });
    assert.match(created.id, /^vs_[a-f0-9]{12}$/);
    assert.equal(sections.length, 1);
    const response = await fetch(`http://127.0.0.1:${port}/api/status`);
    assert.equal(response.status, 200);
    const status = await response.json();
    assert.equal(status.name, 'Video Studio');
    assert.equal(status.version, '0.5.0');
    assert.equal(status.ready, true);
    assert.equal(status.capabilities.localMediaLibrary, true);
    assert.equal(status.providers.pixabay.configured, false);
    assert.equal(status.providers.imageGeneration.configured, false);
    const page = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Video Studio/);
    assert.ok(page.headers.get('content-security-policy'));
    const denied = await fetch(`http://127.0.0.1:${port}/api/projects`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://example.com' }, body: JSON.stringify({ title: 'cross-origin' }) });
    assert.equal(denied.status, 403);
  } finally {
    for (const cleanup of cleanups.reverse()) if (typeof cleanup === 'function') await cleanup();
    await rm(root, { recursive: true, force: true });
  }
});
