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

function extractFrame(binary, inputPath, timestamp) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, [
      '-hide_banner', '-loglevel', 'error', '-ss', String(timestamp),
      '-i', inputPath, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1',
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = [];
    let stderr = '';
    child.stdout.on('data', (chunk) => chunks.push(chunk));
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) resolve(Buffer.concat(chunks));
      else reject(new Error(`Frame extraction failed (${code}): ${stderr}`));
    });
  });
}

function countDifferentPixels(first, second, { frameWidth, frameHeight, startY = 0 }) {
  assert.equal(first.length, second.length);
  let changed = 0;
  for (let y = startY; y < frameHeight; y += 1) {
    for (let x = 0; x < frameWidth; x += 1) {
      const offset = (y * frameWidth + x) * 3;
      const difference = Math.abs(first[offset] - second[offset])
        + Math.abs(first[offset + 1] - second[offset + 1])
        + Math.abs(first[offset + 2] - second[offset + 2]);
      if (difference > 45) changed += 1;
    }
  }
  return changed;
}

function countBrightPixels(frame, { frameWidth, left, top, width, height }) {
  let count = 0;
  for (let y = top; y < top + height; y += 1) {
    for (let x = left; x < left + width; x += 1) {
      const offset = (y * frameWidth + x) * 3;
      if (frame[offset] > 210 && frame[offset + 1] > 210 && frame[offset + 2] > 210) count += 1;
    }
  }
  return count;
}

test('applies, renders, saves, and reuses a cinematic photo template', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-video-template-test-'));
  const dataDir = path.join(root, 'data');
  const imageA = path.join(root, 'pattern.png');
  const imageB = path.join(root, 'blue.png');
  await mkdir(dataDir, { recursive: true });
  await run('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'color=c=black:s=320x180:d=1',
    '-vf', 'drawbox=x=80:y=100:w=100:h=50:color=white:t=fill',
    '-frames:v', '1', imageA,
  ]);
  await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=blue:s=320x180:d=1', '-frames:v', '1', imageB]);

  const engine = await createEngine({ dataDir, allowedRoots: [root] });
  t.after(async () => { await engine.close(); await rm(root, { recursive: true, force: true }); });

  const status = await engine.status();
  assert.equal(status.ready, true, `FFmpeg is missing required capabilities: ${status.missingFeatures.join(', ')}`);
  assert.equal(status.capabilities.videoRendering, true);
  assert.equal(status.capabilities.imageMotion, true);
  assert.equal(status.capabilities.transitions, true);
  assert.equal(status.capabilities.textOverlays, true);
  assert.equal(status.capabilities.srtSubtitles, true);
  assert.equal(status.capabilities.audioMixing, true);

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
    title: 'TEST',
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

  const earlyFrame = await extractFrame('ffmpeg', outputPath, 0.2);
  const laterFrame = await extractFrame('ffmpeg', outputPath, 1.2);
  assert.equal(earlyFrame.length, 320 * 180 * 3);
  assert.ok(
    countDifferentPixels(earlyFrame, laterFrame, { frameWidth: 320, frameHeight: 180, startY: 90 }) > 100,
    'zoompan should visibly change the static image over time',
  );
  const titleFrame = await extractFrame('ffmpeg', outputPath, 0.8);
  assert.ok(
    countBrightPixels(titleFrame, { frameWidth: 320, left: 60, top: 0, width: 200, height: 90 }) > 50,
    'ASS title should be rendered into the upper part of the output frame',
  );

  const readyToSave = await engine.getProject(project.id);
  const saved = await engine.templateSave({
    projectId: project.id,
    expectedRevision: readyToSave.revision,
    name: 'My cinematic layout',
    description: 'A reusable photo slideshow layout',
  });
  assert.equal(saved.isBuiltIn, false);
  assert.equal(saved.assetCount, 2);

  const secondProject = await engine.createProject({ title: 'Template reuse test', aspectRatio: '16:9', width: 480, height: 270, fps: 30 });
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
  assert.equal(reused.timeline.overlays[0].text, 'TEST');
  assert.equal(reused.timeline.overlays[0].fontSize, 96);
  const reusedProject = await engine.getProject(secondProject.id);
  assert.equal(reusedProject.output.width, 480);
  assert.equal(reusedProject.output.height, 270);
  assert.equal(reusedProject.output.fps, 30);
});
