import path from 'node:path';
import { copyFile, rm, writeFile, stat } from 'node:fs/promises';
import { ensureDir, safeSegment } from './util.js';
import { runProcess, probeMedia } from './media.js';
import { VideoStudioError } from './errors.js';
import { timelineDuration } from './templates/schema.js';

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

function motionOversample(clip, width, height) {
  // A larger source canvas gives zoompan subpixel-level effective crop movement.
  // Avoid scaling above 2K output sizes: high-resolution projects can become memory-heavy.
  return clip.motion?.type && clip.motion.type !== 'none' && width * height <= 1920 * 1080 ? 2 : 1;
}

function motionFilter(clip, width, height, fps) {
  const motion = clip.motion?.type ?? 'none';
  if (motion === 'none') return '';
  const intensity = Number(clip.motion?.intensity ?? 0.12);
  const frames = Math.max(1, Math.ceil(clip.duration * fps));
  const step = (intensity / frames).toFixed(8);
  const zoom = (1 + intensity).toFixed(4);
  let z = '1';
  let x = '(iw-iw/zoom)/2';
  let y = '(ih-ih/zoom)/2';
  if (motion === 'zoom-in') z = `1+${step}*on`;
  if (motion === 'zoom-out') z = `1+${intensity.toFixed(4)}-${step}*on`;
  if (motion === 'pan-left') { z = zoom; x = `(iw-iw/zoom)*on/${frames}`; }
  if (motion === 'pan-right') { z = zoom; x = `(iw-iw/zoom)*(1-on/${frames})`; }
  if (motion === 'pan-up') { z = zoom; y = `(ih-ih/zoom)*on/${frames}`; }
  if (motion === 'pan-down') { z = zoom; y = `(ih-ih/zoom)*(1-on/${frames})`; }
  return `zoompan=z='${z}':x='${x}':y='${y}':d=1:s=${width}x${height}:fps=${fps}`;
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

function assTime(seconds) {
  const total = Math.max(0, Math.round(seconds * 100));
  const hours = Math.floor(total / 360000);
  const minutes = Math.floor((total % 360000) / 6000);
  const wholeSeconds = Math.floor((total % 6000) / 100);
  const centiseconds = total % 100;
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(wholeSeconds).padStart(2, '0')}.${String(centiseconds).padStart(2, '0')}`;
}

function assColor(hex) {
  const value = hex.replace('#', '');
  return `&H00${value.slice(4, 6)}${value.slice(2, 4)}${value.slice(0, 2)}&`;
}

async function writeOverlayAss(filePath, overlays, width, height) {
  const header = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    'WrapStyle: 2',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    'Style: Default,Arial,56,&H00FFFFFF,&H000000FF,&H00101010,&H64000000,-1,0,0,0,100,100,0,0,1,3,1,2,60,60,100,1',
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];
  const lines = overlays.map((overlay) => {
    const align = overlay.position === 'top' ? 8 : overlay.position === 'bottom' ? 2 : 5;
    const y = overlay.position === 'top' ? Math.round(height * 0.12)
      : overlay.position === 'bottom' ? Math.round(height * 0.86) : Math.round(height * 0.5);
    const fade = overlay.animation === 'fade-in' ? '\\fad(300,0)'
      : overlay.animation === 'fade-out' ? '\\fad(0,300)'
        : overlay.animation === 'fade-in-out' ? '\\fad(300,300)' : '';
    const text = String(overlay.text ?? '').replace(/[{}\\]/g, '').replace(/[\r\n]+/g, ' ');
    const tags = `\\an${align}\\pos(${Math.round(width / 2)},${y})\\fs${overlay.fontSize ?? 56}\\1c${assColor(overlay.color ?? '#FFFFFF')}${fade}`;
    return `Dialogue: 0,${assTime(overlay.start)},${assTime(overlay.end)},Default,,0,0,0,,{${tags}}${text}`;
  });
  await writeFile(filePath, `${[...header, ...lines].join('\n')}\n`, 'utf8');
}

async function joinWithTransitions({ ffmpegPath, clipFiles, clips, transitions, fps, outputPath, totalDuration, signal, onProgress }) {
  const args = ['-hide_banner', '-loglevel', 'error', '-y'];
  for (const file of clipFiles) args.push('-i', file);
  const filters = [];
  for (let index = 0; index < clipFiles.length; index += 1) {
    filters.push(`[${index}:v]fps=${fps},format=yuv420p,settb=AVTB,setpts=PTS-STARTPTS[v${index}]`);
    filters.push(`[${index}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,asetpts=PTS-STARTPTS[a${index}]`);
  }
  let video = 'v0';
  let audio = 'a0';
  let elapsed = clips[0].duration;
  for (let index = 1; index < clips.length; index += 1) {
    const transition = transitions[index - 1] ?? { type: 'cut', duration: 0 };
    const nextVideo = `v${index}`;
    const nextAudio = `a${index}`;
    const outVideo = `vx${index}`;
    const outAudio = `ax${index}`;
    if (transition.type === 'cut' || transition.duration === 0) {
      filters.push(`[${video}][${nextVideo}]concat=n=2:v=1:a=0,settb=AVTB,setpts=PTS-STARTPTS[${outVideo}]`);
      filters.push(`[${audio}][${nextAudio}]concat=n=2:v=0:a=1,aresample=48000,asetpts=PTS-STARTPTS[${outAudio}]`);
      elapsed += clips[index].duration;
    } else {
      const duration = Number(transition.duration).toFixed(4);
      const offset = Math.max(0, elapsed - Number(transition.duration)).toFixed(4);
      filters.push(`[${video}][${nextVideo}]xfade=transition=${transition.type}:duration=${duration}:offset=${offset},settb=AVTB,setpts=PTS-STARTPTS[${outVideo}]`);
      filters.push(`[${audio}][${nextAudio}]acrossfade=d=${duration}:c1=tri:c2=tri[${outAudio}]`);
      elapsed += clips[index].duration - Number(transition.duration);
    }
    video = outVideo;
    audio = outAudio;
  }
  args.push(
    '-filter_complex', filters.join(';'),
    '-map', `[${video}]`, '-map', `[${audio}]`,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-pix_fmt', 'yuv420p', '-r', String(fps),
    '-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-ac', '2',
    '-t', String(totalDuration), '-movflags', '+faststart', outputPath,
  );
  await runFfmpeg(ffmpegPath, args, {
    signal, duration: totalDuration, progressStart: 72, progressSpan: 10, onProgress,
  });
}

export async function renderProject({ store, projectId, outputName, ffmpegPath = 'ffmpeg', ffprobePath = 'ffprobe', signal, onProgress }) {
  const project = await store.getRawProject(projectId);
  const { clips } = project.timeline;
  if (!Array.isArray(clips) || clips.length === 0) throw new VideoStudioError('时间线为空，至少需要一个视频或图片片段。', 'EMPTY_TIMELINE');
  const assets = new Map(project.assets.map((asset) => [asset.id, asset]));
  const transitions = project.timeline.transitions ?? Array.from({ length: clips.length - 1 }, () => ({ type: 'cut', duration: 0 }));
  const overlays = project.timeline.overlays ?? [];
  const totalDuration = timelineDuration(clips, transitions);
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
      const scaleFactor = asset.role === 'image' ? motionOversample(clip, width, height) : 1;
      const fitWidth = width * scaleFactor;
      const fitHeight = height * scaleFactor;
      const filterFit = clip.fit === 'contain'
        ? `scale=${fitWidth}:${fitHeight}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${fitWidth}:${fitHeight}:(ow-iw)/2:(oh-ih)/2:color=black`
        : `scale=${fitWidth}:${fitHeight}:force_original_aspect_ratio=increase:flags=lanczos,crop=${fitWidth}:${fitHeight}`;
      const sourceDuration = asset.role === 'image' ? clip.duration : clip.sourceOut - clip.sourceIn;
      const playback = asset.role === 'image' ? 1 : clip.speed;
      const trimAndSpeed = asset.role === 'image'
        ? `trim=duration=${clip.duration.toFixed(4)},setpts=PTS-STARTPTS`
        : `trim=duration=${sourceDuration.toFixed(4)},setpts=(PTS-STARTPTS)/${playback}`;
      const motion = asset.role === 'image' ? motionFilter(clip, width, height, fps) : '';
      const vf = [trimAndSpeed, filterFit, motion, `fps=${fps}`, 'setsar=1', 'format=yuv420p'].filter(Boolean).join(',');
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
      const clipStart = (index / clips.length) * 72;
      const clipSpan = 72 / clips.length;
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
    const joinedPath = path.join(tempDir, 'joined.mp4');
    const hasTransitions = transitions.some((item) => item.type !== 'cut' && item.duration > 0);
    if (hasTransitions) {
      await joinWithTransitions({ ffmpegPath, clipFiles, clips, transitions, fps, outputPath: joinedPath, totalDuration, signal, onProgress });
    } else {
      const concatList = path.join(tempDir, 'concat.txt');
      await writeFile(concatList, `${clipFiles.map((file) => `file '${concatEscape(file)}'`).join('\n')}\n`, 'utf8');
      await runFfmpeg(ffmpegPath, [
        '-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', concatList,
        '-c', 'copy', '-movflags', '+faststart', joinedPath,
      ], { signal });
    }
    onProgress?.(82);

    const music = project.timeline.musicAssetId ? assets.get(project.timeline.musicAssetId) : null;
    const voice = project.timeline.voiceoverAssetId ? assets.get(project.timeline.voiceoverAssetId) : null;
    const subtitle = project.timeline.subtitles?.burnIn ? project.timeline.subtitles.path : null;
    if ((music && music.role !== 'audio') || (voice && voice.role !== 'audio')) {
      throw new VideoStudioError('音乐和旁白必须是音频素材。', 'INVALID_AUDIO_ASSET');
    }

    const overlayPath = overlays.length ? path.join(tempDir, 'overlays.ass') : null;
    if (overlayPath) await writeOverlayAss(overlayPath, overlays, width, height);
    const videoFilters = [];
    if (subtitle) {
      const style = 'FontName=Arial,FontSize=24,Outline=2,Shadow=1,Alignment=2,MarginV=100';
      videoFilters.push(`subtitles=filename='${filterEscape(subtitle)}':force_style='${style}'`);
    }
    if (overlayPath) videoFilters.push(`ass=filename='${filterEscape(overlayPath)}'`);

    if (!music && !voice && !subtitle && !overlayPath) {
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
      if (videoFilters.length) {
        if (needsAudioMix) {
          filters.push(`[0:v]${videoFilters.join(',')}[vout]`);
          videoMap = '[vout]';
        } else {
          args.push('-vf', videoFilters.join(','));
        }
      }
      if (filters.length) args.push('-filter_complex', filters.join(';'));
      args.push('-map', videoMap, '-map', audioMap);
      args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-pix_fmt', 'yuv420p');
      if (needsAudioMix) args.push('-c:a', 'aac', '-b:a', '192k', '-ar', '48000');
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
