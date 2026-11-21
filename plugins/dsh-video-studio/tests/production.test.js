import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createEngine } from '../src/engine.js';
import { probeMedia } from '../src/media.js';

function run(binary, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: 'ignore' });
    child.once('error', reject);
    child.once('close', (code) => code === 0 ? resolve() : reject(new Error(`${binary} exited ${code}`)));
  });
}

async function waitForJob(engine, jobId, timeoutMs = 60_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const job = await engine.getJob(jobId);
    if (['completed', 'failed', 'cancelled', 'interrupted'].includes(job.status)) return job;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('render job timed out in test');
}

test('applies, renders, saves, and reuses a cinematic photo template', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-video-template-test-'));
  const dataDir = path.join(root, 'data');
  const imageA = path.join(root, 'red.png');
  const imageB = path.join(root, 'blue.png');
  await mkdir(dataDir, { recursive: true });
  await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=red:s=320x180:d=1', '-frames:v', '1', imageA]);
  await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=blue:s=320x180:d=1', '-frames:v', '1', imageB]);

  const engine = await createEngine({ dataDir, allowedRoots: [root], port: 4174 });
  t.after(async () => { await engine.close(); await rm(root, { recursive: true, force: true }); });

  const project = await engine.createProject({ title: 'Cinematic template test', aspectRatio: '16:9', width: 320, height: 180, fps: 24 });
  const first = await engine.importAsset({ projectId: project.id, sourcePath: imageA, role: 'image' });
  const second = await engine.importAsset({ projectId: project.id, sourcePath: imageB, role: 'image' });
  const current = await engine.getProject(project.id);

  const templates = await engine.templateList();
  assert.ok(templates.some((item) => item.id === 'cinematic-photo' && item.isBuiltIn));

  const applied = await engine.templateApply({
    projectId: project.id,
    expectedRevision: current.revision,
    templateId: 'cinematic-photo',
    assetIds: [first.asset.id, second.asset.id],
    title: 'Cinematic test',
    durationPerImage: 2,
  });
  assert.equal(applied.clipCount, 2);
  assert.ok(Math.abs(applied.duration - 3.55) < 0.02);
  assert.equal(applied.timeline.transitions[0].type, 'fade');
  assert.equal(applied.timeline.clips[0].motion.type, 'zoom-in');
  assert.equal(applied.timeline.overlays[0].text, 'Cinematic test');

  const submitted = await engine.submitRender({ projectId: project.id, outputName: 'cinematic-test' });
  const job = await waitForJob(engine, submitted.jobId);
  assert.equal(job.status, 'completed', job.error || 'render did not complete');
  const outputPath = await engine.store.resolveProjectOutput(project.id, 'cinematic-test.mp4');
  const media = await probeMedia(outputPath);
  assert.equal(media.video.width, 320);
  assert.equal(media.video.height, 180);
  assert.ok(Math.abs(media.duration - 3.55) < 0.15);
  assert.ok(media.audio, 'rendered slideshow should contain an audio stream');

  const readyToSave = await engine.getProject(project.id);
  const saved = await engine.templateSave({
    projectId: project.id,
    expectedRevision: readyToSave.revision,
    name: 'My cinematic layout',
    description: 'A reusable photo slideshow layout',
  });
  assert.equal(saved.isBuiltIn, false);
  assert.equal(saved.assetCount, 2);

  const secondProject = await engine.createProject({ title: 'Template reuse test', aspectRatio: '16:9', width: 320, height: 180, fps: 24 });
  const reusedA = await engine.importAsset({ projectId: secondProject.id, sourcePath: imageA, role: 'image' });
  const reusedB = await engine.importAsset({ projectId: secondProject.id, sourcePath: imageB, role: 'image' });
  const secondCurrent = await engine.getProject(secondProject.id);
  const reused = await engine.templateApply({
    projectId: secondProject.id,
    expectedRevision: secondCurrent.revision,
    templateId: saved.id,
    assetIds: [reusedA.asset.id, reusedB.asset.id],
  });
  assert.equal(reused.clipCount, 2);
  assert.equal(reused.timeline.transitions[0].type, 'fade');
  assert.equal(reused.timeline.overlays[0].text, 'Cinematic test');
});
