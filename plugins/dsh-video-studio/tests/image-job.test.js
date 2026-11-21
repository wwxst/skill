import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { createEngine } from '../src/engine.js';

test('image generation returns a job id and reports failures through the job', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'video-image-job-'));
  const engine = await createEngine({ dataDir: root, allowedRoots: [root] });
  t.after(async () => {
    await engine.close();
    await rm(root, { recursive: true, force: true });
  });

  const project = await engine.createProject({ title: 'Image job test' });
  const submitted = await engine.imageGenerate({ projectId: project.id, prompt: 'A quiet lake at dawn', confirmCost: true });
  assert.match(submitted.jobId, /^job_[a-f0-9]{12}$/);
  assert.ok(['queued', 'running'].includes(submitted.status), 'submission must not block on the provider');

  let job;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    job = await engine.getJob(submitted.jobId);
    if (['failed', 'completed', 'cancelled'].includes(job.status)) break;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.equal(job.kind, 'image-generate');
  assert.equal(job.status, 'failed', 'no API key is configured in the test environment');
  assert.equal(job.errorCode, 'IMAGE_PROVIDER_NOT_CONFIGURED');
});

test('image generation still refuses to spend money without confirmation', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'video-image-confirm-'));
  const engine = await createEngine({ dataDir: root, allowedRoots: [root] });
  t.after(async () => {
    await engine.close();
    await rm(root, { recursive: true, force: true });
  });
  const project = await engine.createProject({ title: 'Confirm test' });
  await assert.rejects(
    engine.imageGenerate({ projectId: project.id, prompt: 'x', confirmCost: false }),
    (error) => error.code === 'IMAGE_GENERATION_CONFIRMATION_REQUIRED',
  );
});
