import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createEngine } from '../src/engine.js';

function run(binary, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: 'ignore' });
    child.once('error', reject);
    child.once('close', (code) => code === 0 ? resolve() : reject(new Error(binary + ' exited ' + code)));
  });
}

async function waitForJob(engine, jobId, timeoutMs = 180_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const job = await engine.getJob(jobId);
    if (['completed', 'failed', 'cancelled', 'interrupted'].includes(job.status)) return job;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('render job timed out in integration test');
}

test('storyboard to multi-version batch render, quality checks and TikTok feedback work end to end', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'video-studio-workflow-test-'));
  const dataDir = path.join(root, 'data');
  const imageA = path.join(root, 'scene-a.png');
  const imageB = path.join(root, 'scene-b.png');
  await mkdir(dataDir, { recursive: true });
  await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=black:s=320x180:d=1', '-vf', 'drawbox=x=30:y=40:w=90:h=70:color=white:t=fill', '-frames:v', '1', imageA]);
  await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=blue:s=320x180:d=1', '-vf', 'drawbox=x=180:y=40:w=90:h=70:color=yellow:t=fill', '-frames:v', '1', imageB]);

  const engine = await createEngine({ dataDir, allowedRoots: [root] });
  t.after(async () => { await engine.close(); await rm(root, { recursive: true, force: true }); });

  const status = await engine.status();
  assert.equal(status.version, '0.5.0');
  assert.equal(status.capabilities.storyboardPlanning, true);
  assert.equal(status.capabilities.batchRendering, true);
  assert.equal(status.capabilities.qualityInspection, true);
  assert.equal(status.providers.pixabay.configured, false);

  const project = await engine.createProject({ title: 'Story production', width: 320, height: 180, fps: 24 });
  const first = await engine.importAsset({ projectId: project.id, sourcePath: imageA, role: 'image' });
  const second = await engine.importAsset({ projectId: project.id, sourcePath: imageB, role: 'image' });
  let current = await engine.getProject(project.id);
  const saved = await engine.storyboardCreate({
    projectId: project.id,
    expectedRevision: current.revision,
    topic: 'A two-scene city story',
    script: 'A quiet opening followed by a bright reveal.',
    shots: [
      { title: 'Opening', visualPrompt: 'A dark city scene with a white geometric shape', assetId: first.asset.id, duration: 2.5, transitionType: 'fade', transitionDuration: 0.25, overlayText: 'THE CITY' },
      { title: 'Reveal', visualPrompt: 'A blue city scene with a yellow geometric shape', assetId: second.asset.id, duration: 2.5, transitionType: 'cut', transitionDuration: 0 },
    ],
  });
  assert.equal(saved.storyboard.shots.length, 2);
  const applied = await engine.storyboardApply({ projectId: project.id, expectedRevision: saved.revision });
  assert.equal(applied.clipCount, 2);
  current = await engine.getProject(project.id);
  assert.equal(current.timeline.transitions[0].type, 'fade');

  const duplicated = await engine.projectDuplicate({
    projectId: project.id,
    expectedRevision: current.revision,
    variants: [
      { title: 'Landscape cut', width: 320, height: 180, fps: 24, overlayText: 'LANDSCAPE' },
      { title: 'Portrait cut', width: 180, height: 320, fps: 24, overlayText: 'PORTRAIT' },
    ],
  });
  assert.equal(duplicated.variants.length, 2);
  assert.deepEqual(duplicated.variants.map((item) => [item.output.width, item.output.height]), [[320, 180], [180, 320]]);

  const batch = await engine.submitBatchRender({
    items: duplicated.variants.map((item) => ({ projectId: item.projectId, outputName: item.outputName })),
  });
  const batchJob = await waitForJob(engine, batch.jobId);
  assert.equal(batchJob.status, 'completed', batchJob.error || 'batch render failed');
  assert.deepEqual(batchJob.result.summary, { total: 2, succeeded: 2, failed: 0 });
  assert.ok(batchJob.result.items.every((item) => item.status === 'completed'));
  assert.ok(batchJob.result.items.every((item) => item.result.quality?.checks?.mediaProbe));

  const quality = await engine.qualityCheck({ projectId: duplicated.variants[0].projectId });
  assert.equal(quality.checks.mediaProbe, true);
  assert.ok(Array.isArray(quality.findings));

  const recorded = await engine.performanceRecord({
    projectId: project.id,
    accountType: 'acquisition',
    objective: 'template acquisition',
    topic: 'A two-scene city story',
    hookType: 'question',
    views: 1200,
    likes: 110,
    comments: 12,
    shares: 25,
    saves: 40,
    profileVisits: 90,
    follows: 35,
    conversions: 8,
  });
  assert.match(recorded.id, /^perf_[a-f0-9]{12}$/);
  const summary = await engine.performanceSummary({ groupBy: 'hookType' });
  assert.equal(summary.sampleCount, 1);
  assert.equal(summary.groups[0].key, 'question');
  assert.equal(summary.groups[0].metrics.views, 1200);

  const interruptedJobId = 'job_abcdef123456';
  await writeFile(path.join(dataDir, 'jobs', interruptedJobId + '.json'), JSON.stringify({
    id: interruptedJobId,
    kind: 'batch-render',
    items: [{ projectId: duplicated.variants[0].projectId, outputName: 'retried-output' }],
    status: 'completed',
    progress: 100,
    result: { items: [{ projectId: duplicated.variants[0].projectId, status: 'failed' }] },
    createdAt: new Date().toISOString(),
  }));
  const retry = await engine.retryJob(interruptedJobId);
  const retryJob = await waitForJob(engine, retry.jobId);
  assert.equal(retryJob.status, 'completed', retryJob.error || 'retry failed');
  assert.equal(retryJob.result.summary.succeeded, 1);
  assert.equal(retryJob.result.items[0].result.output.name, 'retried-output.mp4');

  await assert.rejects(
    engine.imageGenerate({ projectId: project.id, prompt: 'A test', confirmCost: false }),
    (error) => error.code === 'IMAGE_GENERATION_CONFIRMATION_REQUIRED',
  );
});
