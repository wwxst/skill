import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { createEngine } from '../src/engine.js';

test('syncs TikTok Display API metrics into the matching project without inventing unavailable metrics', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'video-tiktok-sync-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const videoId = '1234567890123456789';
  const engine = await createEngine({
    dataDir: path.join(root, 'data'),
    allowedRoots: [root],
    tiktokAccessToken: 'test-access-token',
    fetchImpl: async (url, options) => {
      assert.match(String(url), /^https:\/\/open\\.tiktokapis\\.com\/v2\/video\/list\\//);
      assert.equal(options.headers.authorization, 'Bearer test-access-token');
      return new Response(JSON.stringify({
        data: {
          videos: [{
            id: videoId,
            create_time: 1700000000,
            share_url: 'https://www.tiktok.com/@creator/video/' + videoId,
            title: 'CapCut template hook',
            view_count: 1200,
            like_count: 120,
            comment_count: 12,
            share_count: 6,
          }],
          cursor: 0,
          has_more: false,
        },
        error: { code: 'ok', message: '' },
      }), { status: 200 });
    },
  });
  t.after(() => engine.close());

  const project = await engine.createProject({ title: 'TikTok metrics project' });
  const listed = await engine.tiktokVideoList({ limit: 20 });
  assert.equal(listed.count, 1);
  assert.equal(listed.videos[0].id, videoId);

  const synced = await engine.tiktokSync({
    mappings: [{ videoId, projectId: project.id, accountType: 'acquisition', hookType: 'result-first' }],
  });
  assert.equal(synced.syncedCount, 1);
  assert.equal(synced.synced[0].metrics.views, 1200);
  assert.deepEqual(synced.synced[0].availableMetrics, ['views', 'likes', 'comments', 'shares']);

  const summary = await engine.performanceSummary({ groupBy: 'accountType' });
  assert.equal(summary.groups[0].metrics.views, 1200);
  assert.equal(summary.groups[0].engagementRate, 0.115);
  assert.equal(summary.groups[0].followRate, null);
  assert.equal(summary.groups[0].conversionRate, null);
});
