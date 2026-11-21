import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { createPerformanceStore } from '../src/analytics.js';

test('records actual performance metrics and summarizes by hook type', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'video-analytics-test-'));
  const store = createPerformanceStore(root);
  await store.initialize();
  t.after(() => rm(root, { recursive: true, force: true }));
  await store.record({ projectId: 'vs_123456789abc', accountType: 'acquisition', topic: 'template growth', hookType: 'question', views: 1000, likes: 100, comments: 10, shares: 20, saves: 30, follows: 40, conversions: 5 });
  await store.record({ projectId: 'vs_123456789abc', accountType: 'acquisition', topic: 'template growth', hookType: 'question', views: 2000, likes: 200, comments: 20, shares: 30, saves: 50, follows: 60, conversions: 10 });
  const summary = await store.summary({ groupBy: 'hookType' });
  assert.equal(summary.sampleCount, 2);
  assert.equal(summary.groups[0].sampleCount, 2);
  assert.equal(summary.groups[0].metrics.views, 3000);
  assert.equal(summary.groups[0].engagementRate, 0.1533);
  assert.equal(summary.groups[0].followRate, 0.0333);
});

test('stores TikTok source and metric availability metadata', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'video-analytics-source-test-'));
  const store = createPerformanceStore(root);
  await store.initialize();
  t.after(() => rm(root, { recursive: true, force: true }));
  const record = await store.record({
    projectId: 'vs_123456789abc', platformVideoId: '1234567890123456789',
    source: 'tiktok-display-api', availableMetrics: ['views', 'likes', 'comments', 'shares'],
    views: 1000, likes: 100, comments: 10, shares: 5,
  });
  assert.equal(record.source, 'tiktok-display-api');
  assert.equal(record.platformVideoId, '1234567890123456789');
  assert.deepEqual(record.availableMetrics, ['views', 'likes', 'comments', 'shares']);
});
