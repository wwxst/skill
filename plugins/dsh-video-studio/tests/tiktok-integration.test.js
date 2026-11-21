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
      const requestUrl = new URL(String(url));
      assert.equal(requestUrl.hostname, 'open.tiktokapis.com');
      assert.equal(requestUrl.pathname, '/v2/video/list/');
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


test('syncs two separately authorized TikTok accounts into independent performance groups', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'video-tiktok-multi-sync-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const videosByToken = {
    'Bearer project-access': '11111111111111111111',
    'Bearer midvideo-access': '22222222222222222222',
  };
  const engine = await createEngine({
    dataDir: path.join(root, 'data'),
    allowedRoots: [root],
    tiktokClientKey: 'client-key',
    tiktokClientSecret: 'client-secret',
    fetchImpl: async (url, options) => {
      if (String(url) === 'https://open.tiktokapis.com/v2/oauth/token/') {
        const code = options.body.get('code');
        const suffix = code === 'project-code' ? 'project' : 'midvideo';
        return new Response(JSON.stringify({
          access_token: suffix + '-access',
          refresh_token: suffix + '-refresh',
          expires_in: 7200,
          refresh_expires_in: 15552000,
          open_id: suffix + '-open-id',
          scope: 'user.info.basic,video.list',
        }), { status: 200 });
      }
      const videoId = videosByToken[options.headers.authorization];
      assert.ok(videoId, 'request must use the token belonging to the selected account');
      return new Response(JSON.stringify({
        data: {
          videos: [{
            id: videoId, create_time: 1700000000,
            share_url: 'https://www.tiktok.com/@creator/video/' + videoId,
            title: 'Account-specific post', view_count: 1000, like_count: 100,
            comment_count: 10, share_count: 5,
          }],
          cursor: 0, has_more: false,
        },
        error: { code: 'ok', message: '' },
      }), { status: 200 });
    },
  });
  t.after(() => engine.close());

  const project = await engine.createProject({ title: 'Acquisition account video' });
  const midVideo = await engine.createProject({ title: 'Mid-video account video' });
  const redirectUri = 'https://example.com/tiktok/callback';
  const projectAuth = await engine.tiktokAuthorize({ redirectUri, accountId: 'capcut-project-01' });
  await engine.tiktokConnect({ code: 'project-code', state: projectAuth.state, redirectUri, accountId: 'capcut-project-01' });
  const midVideoAuth = await engine.tiktokAuthorize({ redirectUri, accountId: 'mid-video-01' });
  await engine.tiktokConnect({ code: 'midvideo-code', state: midVideoAuth.state, redirectUri, accountId: 'mid-video-01' });

  const synced = await engine.tiktokSync({
    limit: 1,
    mappings: [
      { accountId: 'capcut-project-01', videoId: '11111111111111111111', projectId: project.id, accountType: 'acquisition' },
      { accountId: 'mid-video-01', videoId: '22222222222222222222', projectId: midVideo.id, accountType: 'mid-video' },
    ],
  });
  assert.equal(synced.syncedCount, 2);
  assert.deepEqual(synced.synced.map((item) => item.accountId), ['capcut-project-01', 'mid-video-01']);
  const summary = await engine.performanceSummary({ groupBy: 'accountId' });
  assert.equal(summary.groups.length, 2);
  assert.equal(summary.groups.find((item) => item.key === 'capcut-project-01').metrics.views, 1000);
  assert.equal(summary.groups.find((item) => item.key === 'mid-video-01').metrics.views, 1000);
});
