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

async function waitForJob(engine, jobId, timeoutMs = 45_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const job = await engine.getJob(jobId);
    if (['completed', 'failed', 'cancelled', 'interrupted'].includes(job.status)) return job;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('render job timed out in test');
}

test('creates project, imports media, guards revisions, and renders a real MP4', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-video-studio-test-'));
  const dataDir = path.join(root, 'data');
  const inputVideo = path.join(root, 'sample.mp4');
  const inputAudio = path.join(root, 'music.wav');
  await mkdir(dataDir, { recursive: true });
  await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=24', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=2', '-t', '2', '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', inputVideo]);
  await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-c:a', 'pcm_s16le', inputAudio]);

  const engine = await createEngine({ dataDir, allowedRoots: [root], port: 4174 });
  t.after(async () => { await engine.close(); await rm(root, { recursive: true, force: true }); });

  const status = await engine.status();
  assert.equal(status.ready, true);
  const project = await engine.createProject({ title: 'Integration test', aspectRatio: '16:9', width: 320, height: 180, fps: 24 });
  assert.equal(project.revision, 1);

  const video = await engine.importAsset({ projectId: project.id, sourcePath: inputVideo, role: 'video' });
  const audio = await engine.importAsset({ projectId: project.id, sourcePath: inputAudio, role: 'audio' });
  assert.equal(video.asset.role, 'video');
  assert.equal(audio.asset.role, 'audio');

  const current = await engine.getProject(project.id);
  const timeline = await engine.updateTimeline({
    projectId: project.id,
    expectedRevision: current.revision,
    clips: [{ assetId: video.asset.id, sourceIn: 0, sourceOut: 2, speed: 1 }],
    musicAssetId: audio.asset.id,
    musicVolume: 0.12,
  });
  assert.equal(timeline.clipCount, 1);
  await assert.rejects(
    engine.updateTimeline({ projectId: project.id, expectedRevision: current.revision, clips: [{ assetId: video.asset.id, sourceIn: 0, sourceOut: 2 }] }),
    (error) => error.code === 'REVISION_CONFLICT',
  );

  const afterTimeline = await engine.getProject(project.id);
  const subtitles = await engine.setSubtitles({
    projectId: project.id,
    expectedRevision: afterTimeline.revision,
    srtContent: '1\n00:00:00,000 --> 00:00:01,500\nVideo Studio test\n',
    burnIn: true,
  });
  assert.equal(subtitles.burnIn, true);

  const submitted = await engine.submitRender({ projectId: project.id, outputName: 'test-output' });
  const job = await waitForJob(engine, submitted.jobId);
  assert.equal(job.status, 'completed', job.error || 'render did not complete');
  assert.equal(job.progress, 100);
  assert.ok(job.result.output.url.endsWith('test-output.mp4'));
  const outputs = await engine.outputList(project.id);
  assert.equal(outputs.length, 1);
  assert.equal(outputs[0].width, 320);
  assert.equal(outputs[0].height, 180);
  assert.ok(outputs[0].duration > 1.8 && outputs[0].duration < 2.2);
  const outputPath = await engine.store.resolveProjectOutput(project.id, 'test-output.mp4');
  const outputMedia = await probeMedia(outputPath);
  assert.ok(outputMedia.audio, 'rendered output should contain mixed audio');
});

test('rejects media paths outside configured roots', async (t) => {
  const allowed = await mkdtemp(path.join(os.tmpdir(), 'dsh-video-allowed-'));
  const candidates = [process.env.RUNNER_TEMP, os.tmpdir()].filter(Boolean);
  const isInside = (parent, child) => {
    const relative = path.relative(path.resolve(parent), path.resolve(child));
    return relative === '' || (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative));
  };
  const deniedBase = candidates.find((candidate) => !isInside(os.homedir(), candidate) && !isInside(process.cwd(), candidate));
  if (!deniedBase) throw new Error('Test runner has no writable temporary directory outside default allowed roots.');
  const denied = await mkdtemp(path.join(deniedBase, 'dsh-video-denied-'));
  const dataDir = path.join(allowed, 'data');
  await mkdir(dataDir, { recursive: true });
  const file = path.join(denied, 'outside.mp4');
  await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=blue:s=160x90:r=24', '-t', '1', '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', file]);
  const engine = await createEngine({ dataDir, allowedRoots: [allowed] });
  t.after(async () => { await engine.close(); await rm(allowed, { recursive: true, force: true }); await rm(denied, { recursive: true, force: true }); });
  const project = await engine.createProject({ title: 'Path test' });
  await assert.rejects(engine.importAsset({ projectId: project.id, sourcePath: file, role: 'video' }), (error) => error.code === 'ASSET_PATH_NOT_ALLOWED');
});
