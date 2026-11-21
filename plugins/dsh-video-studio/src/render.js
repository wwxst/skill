import path from 'node:path';
import { copyFile, rm, writeFile, stat } from 'node:fs/promises';
import { ensureDir, safeSegment } from './util.js';
import { runProcess, probeMedia } from './media.js';
import { VideoStudioError } from './errors.js';

function concatEscape(filePath) {
  return path.resolve(filePath).replaceAll('\\', '/').replaceAll("'", "'\\''");
}

function filterEscape(filePath) {
  return path.resolve(filePath)
    .replaceAll('\\', '/')
    .replaceAll(':', '\\:')
    .replaceAll("'", "\\'")
    .replaceAll(',', '\\,')
    .replaceAll('[', '\\[')
    .replaceAll(']', '\\]');
}

function atempoChain(speed) {
  const factors = [];
  let remaining = speed;
  while (remaining < 0.5) { factors.push(0.5); remaining /= 0.5; }
  while (remaining > 2) { factors.push(2); remaining /= 2; }
  factors.push(remaining);
  return factors.map((factor) => `atempo=${factor}`).join(',');
}

function progressParser(duration, start, span, update) {
  let buffer = '';
  let lastSeconds = 0;
  return (chunk) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const match = /^out_time_(?:ms|us)=(\d+)$/.exec(line.trim());
      if (!match) continue;
      const seconds = Number(match[1]) / 1_000_000;
      if (!Number.isFinite(seconds) || seconds < lastSeconds) continue;
      lastSeconds = seconds;
      update(Math.min(99, Math.max(start, start + span * seconds / Math.max(duration, 0.01))));
    }
  };
}

async function runFfmpeg(ffmpegPath, args, { signal, duration, progressStart, progressSpan, onProgress } = {}) {
  const parser = duration && onProgress ? progressParser(duration, progressStart ?? 0, progressSpan ?? 100, onProgress) : undefined;
  await runProcess(ffmpegPath, ['-progress', 'pipe:1', '-nostats', ...args], { signal, timeoutMs: 0, onStdout: parser });
}

export async function renderProject({ store, projectId, outputName, ffmpegPath = 'ffmpeg', ffprobePath = 'ffprobe', signal, onProgress }) {
  const project = await store.getRawProject(projectId);
  const { clips } = project.timeline;
  if (!Array.isArray(clips) || clips.length === 0) throw new VideoStudioError('时间线为空，至少需要一个视频或图片片段。', 'EMPTY_TIMELINE');
  const assets = new Map(project.assets.map((asset) => [asset.id, asset]));
  const totalDuration = clips.reduce((sum, clip) => sum + clip.duration, 0);
  const projectDir = store.projectPath(projectId);
  const tempDir = path.join(projectDir, 'tmp', `render-${Date.now()}`);
  const outputDir = path.join(projectDir, 'outputs');
  await Promise.all([ensureDir(tempDir), ensureDir(outputDir)]);
  const baseName = safeSegment(outputName || `video-${new Date().toISOString().replace(/[:.]/g, '-')}`, '输出文件名');
  const finalName = baseName.toLowerCase().endsWith('.mp4') ? baseName : `${baseName}.mp4`;
  const outputPath = path.join(outputDir, finalName);
  const clipFiles = [];
  const width = project.output.width;
  const height = project.output.height;
  const fps = project.output.fps;

  try {
    for (let index = 0; index < clips.length; index += 1) {
      signal?.throwIfAborted();
      const clip = clips[index];
      const asset = assets.get(clip.assetId);
      if (!asset) throw new VideoStudioError(`时间线引用的素材已不存在：${clip.assetId}`, 'ASSET_NOT_FOUND');
      const clipPath = path.join(tempDir, `clip-${String(index + 1).padStart(3, '0')}.mp4`);
      const filterFit = clip.fit === 'contain'
        ? `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black`
        : `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`;
      const sourceDuration = asset.role === 'image' ? clip.duration : clip.sourceOut - clip.sourceIn;
      const playback = asset.role === 'image' ? 1 : clip.speed;
      const trimAndSpeed = asset.role === 'image'
        ? `trim=duration=${clip.duration.toFixed(4)},setpts=PTS-STARTPTS`
        : `trim=duration=${sourceDuration.toFixed(4)},setpts=(PTS-STARTPTS)/${playback}`;
      const vf = `${trimAndSpeed},${filterFit},fps=${fps},setsar=1,format=yuv420p`;
      const args = ['-hide_banner', '-loglevel', 'error', '-y'];
      if (asset.role === 'image') args.push('-loop', '1', '-framerate', String(fps), '-i', asset.path);
      else args.push('-ss', String(clip.sourceIn), '-i', asset.path);
      const hasSourceAudio = asset.role === 'video' && Boolean(asset.media?.audio);
      if (!hasSourceAudio) args.push('-f', 'lavfi', '-t', String(clip.duration), '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000');
      args.push('-vf', vf, '-map', '0:v:0');
      if (hasSourceAudio) {
        args.push('-map', '0:a:0', '-af', `atrim=duration=${sourceDuration.toFixed(4)},asetpts=PTS-STARTPTS,${atempoChain(playback)},apad,atrim=duration=${clip.duration.toFixed(4)}`);
      } else {
        args.push('-map', '1:a:0');
      }
      args.push(
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22',
        '-pix_fmt', 'yuv420p', '-r', String(fps),
        '-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-ac', '2',
        '-t', String(clip.duration),
        '-movflags', '+faststart', clipPath,
      );
      const clipStart = (index / clips.length) * 78;
      const clipSpan = 78 / clips.length;
      await runFfmpeg(ffmpegPath, args, {
        signal,
        duration: clip.duration,
        progressStart: clipStart,
        progressSpan: clipSpan,
        onProgress,
      });
      clipFiles.push(clipPath);
    }

    signal?.throwIfAborted();
    const concatList = path.join(tempDir, 'concat.txt');
    await writeFile(concatList, `${clipFiles.map((file) => `file '${concatEscape(file)}'`).join('\n')}\n`, 'utf8');
    const joinedPath = path.join(tempDir, 'joined.mp4');
    await runFfmpeg(ffmpegPath, [
      '-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', concatList,
      '-c', 'copy', '-movflags', '+faststart', joinedPath,
    ], { signal });
    onProgress?.(82);

    const music = project.timeline.musicAssetId ? assets.get(project.timeline.musicAssetId) : null;
    const voice = project.timeline.voiceoverAssetId ? assets.get(project.timeline.voiceoverAssetId) : null;
    const subtitle = project.timeline.subtitles?.burnIn ? project.timeline.subtitles.path : null;
    if ((music && music.role !== 'audio') || (voice && voice.role !== 'audio')) {
      throw new VideoStudioError('音乐和旁白必须是音频素材。', 'INVALID_AUDIO_ASSET');
    }

    if (!music && !voice && !subtitle) {
      await copyFile(joinedPath, outputPath);
    } else {
      const args = ['-hide_banner', '-loglevel', 'error', '-y', '-i', joinedPath];
      const externalAudio = [];
      if (music) {
        args.push('-stream_loop', '-1', '-i', music.path);
        externalAudio.push({ index: externalAudio.length + 1, volume: project.timeline.musicVolume ?? 0.18 });
      }
      if (voice) {
        args.push('-i', voice.path);
        externalAudio.push({ index: externalAudio.length + 1, volume: project.timeline.voiceoverVolume ?? 1 });
      }
      const filters = [];
      let audioMap = '0:a:0';
      const needsAudioMix = externalAudio.length > 0;
      if (needsAudioMix) {
        const labels = ['[baseaudio]'];
        filters.push(`[0:a:0]volume=${project.timeline.originalAudioVolume ?? 1},atrim=duration=${totalDuration.toFixed(4)},asetpts=PTS-STARTPTS[baseaudio]`);
        for (let index = 0; index < externalAudio.length; index += 1) {
          const item = externalAudio[index];
          const label = `external${index}`;
          filters.push(`[${item.index}:a]volume=${item.volume},atrim=duration=${totalDuration.toFixed(4)},asetpts=PTS-STARTPTS[${label}]`);
          labels.push(`[${label}]`);
        }
        filters.push(`${labels.join('')}amix=inputs=${labels.length}:duration=longest:dropout_transition=2,atrim=duration=${totalDuration.toFixed(4)},asetpts=PTS-STARTPTS[aout]`);
        audioMap = '[aout]';
      }
      let videoMap = '0:v:0';
      if (subtitle) {
        const style = 'FontName=Arial,FontSize=24,Outline=2,Shadow=1,Alignment=2,MarginV=100';
        const subtitleFilter = `subtitles=filename='${filterEscape(subtitle)}':force_style='${style}'`;
        if (filters.length > 0) {
          filters.push(`[0:v]${subtitleFilter}[vout]`);
          videoMap = '[vout]';
        } else {
          args.push('-vf', subtitleFilter);
        }
      }
      if (filters.length > 0) args.push('-filter_complex', filters.join(';'));
      args.push('-map', videoMap, '-map', audioMap);
      args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-pix_fmt', 'yuv420p');
      if (needsAudioMix) args.push('-c:a', 'aac', '-b:a', '192k');
      else args.push('-c:a', 'copy');
      args.push('-t', String(totalDuration), '-movflags', '+faststart', outputPath);
      await runFfmpeg(ffmpegPath, args, {
        signal,
        duration: totalDuration,
        progressStart: 84,
        progressSpan: 14,
        onProgress,
      });
    }

    signal?.throwIfAborted();
    const media = await probeMedia(outputPath, ffprobePath, signal);
    const output = {
      name: finalName,
      path: outputPath,
      size: (await stat(outputPath)).size,
      duration: media.duration,
      width: media.video?.width ?? width,
      height: media.video?.height ?? height,
      fps: media.video?.frameRate ?? `${fps}/1`,
      createdAt: new Date().toISOString(),
      revision: project.revision,
    };
    await store.appendOutput(projectId, output);
    onProgress?.(100);
    const { path: _outputPath, ...publicOutput } = output;
    return { projectId, output: { ...publicOutput, url: `/files/${projectId}/${encodeURIComponent(finalName)}` } };
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}
