import { readFile } from 'node:fs/promises';
import { probeMedia, runProcess } from './media.js';

function seconds(value) {
  const parts = String(value).trim().replace(',', '.').split(':').map(Number);
  if (parts.some((item) => !Number.isFinite(item))) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] ?? null;
}

export function parseSubtitleCues(srt) {
  const cues = [];
  const blocks = String(srt || '').replace(/^\uFEFF/, '').split(/\r?\n\s*\r?\n/);
  for (const block of blocks) {
    const lines = block.split(/\r?\n/);
    const timeIndex = lines.findIndex((line) => /\d{2}:\d{2}:\d{2}[,.]\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}[,.]\d{3}/.test(line));
    if (timeIndex < 0) continue;
    const match = /(\d{2}:\d{2}:\d{2}[,.]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[,.]\d{3})/.exec(lines[timeIndex]);
    if (!match) continue;
    const start = seconds(match[1]);
    const end = seconds(match[2]);
    const text = lines.slice(timeIndex + 1).join('\n').replace(/<[^>]+>/g, '').trim();
    if (start === null || end === null || end <= start || !text) continue;
    cues.push({ start, end, duration: end - start, text, lineCount: text.split('\n').length, charCount: text.replace(/\s/g, '').length });
  }
  return cues;
}

export function parseFfmpegQualityLog(log) {
  const text = String(log || '');
  const collect = (pattern, names) => {
    const result = [];
    for (const match of text.matchAll(pattern)) {
      const item = {};
      names.forEach((name, index) => { item[name] = Number(match[index + 1]); });
      result.push(item);
    }
    return result;
  };
  const black = collect(/black_start:([0-9.]+)\s+black_end:([0-9.]+)\s+black_duration:([0-9.]+)/g, ['start', 'end', 'duration']);
  const freezes = collect(/freeze_start:([0-9.]+)[\\s\\S]*?freeze_duration:([0-9.]+)/g, ['start', 'duration']);
  const silences = collect(/silence_start:([0-9.]+)[\\s\\S]*?silence_duration:([0-9.]+)/g, ['start', 'duration']);
  const mean = /mean_volume:\s*(-?[0-9.]+)\s*dB/i.exec(text);
  const peak = /max_volume:\s*(-?[0-9.]+)\s*dB/i.exec(text);
  return {
    blackSegments: black,
    freezeSegments: freezes,
    silenceSegments: silences,
    meanVolumeDb: mean ? Number(mean[1]) : null,
    maxVolumeDb: peak ? Number(peak[1]) : null,
  };
}

export async function analyzeMediaQuality({ filePath, project, ffmpegPath = 'ffmpeg', ffprobePath = 'ffprobe', signal } = {}) {
  const media = await probeMedia(filePath, ffprobePath, signal);
  const args = ['-hide_banner', '-loglevel', 'info', '-i', filePath];
  if (media.video) args.push('-vf', 'blackdetect=d=0.4:pix_th=0.10,freezedetect=n=-50dB:d=2');
  if (media.audio) args.push('-af', 'volumedetect,silencedetect=n=-50dB:d=1');
  args.push('-f', 'null', '-');
  let log = '';
  let analysisError = null;
  try {
    const result = await runProcess(ffmpegPath, args, { signal, timeoutMs: 5 * 60 * 1000 });
    log = result.stderr + '\n' + result.stdout;
  } catch (error) {
    analysisError = error.message;
  }
  const detected = parseFfmpegQualityLog(log);
  const findings = [];
  for (const segment of detected.blackSegments) {
    if (segment.duration >= 0.4) findings.push({ severity: 'warning', code: 'BLACK_FRAME', message: '检测到黑场，持续 ' + segment.duration.toFixed(2) + ' 秒。', start: segment.start, duration: segment.duration });
  }
  for (const segment of detected.freezeSegments) {
    if (segment.duration >= 2) findings.push({ severity: 'warning', code: 'FROZEN_FRAME', message: '检测到疑似静帧，持续 ' + segment.duration.toFixed(2) + ' 秒。', start: segment.start, duration: segment.duration });
  }
  for (const segment of detected.silenceSegments) {
    if (segment.duration >= 1.5) findings.push({ severity: 'info', code: 'AUDIO_SILENCE', message: '检测到静音区间，持续 ' + segment.duration.toFixed(2) + ' 秒。', start: segment.start, duration: segment.duration });
  }
  if (detected.meanVolumeDb !== null && detected.meanVolumeDb < -30) findings.push({ severity: 'warning', code: 'LOW_AUDIO_LEVEL', message: '整体音量偏低，平均音量 ' + detected.meanVolumeDb + ' dB。' });
  if (detected.maxVolumeDb !== null && detected.maxVolumeDb > -1) findings.push({ severity: 'warning', code: 'AUDIO_PEAK_HIGH', message: '音频峰值接近削波，最大音量 ' + detected.maxVolumeDb + ' dB。' });

  const subtitlePath = project?.timeline?.subtitles?.path;
  if (subtitlePath) {
    try {
      const cues = parseSubtitleCues(await readFile(subtitlePath, 'utf8'));
      for (const cue of cues) {
        const longestLine = Math.max(...cue.text.split('\n').map((line) => [...line].length));
        const charsPerSecond = cue.charCount / Math.max(cue.duration, 0.1);
        if (longestLine > (project.output.height > project.output.width ? 20 : 32)) {
          findings.push({ severity: 'warning', code: 'SUBTITLE_LINE_TOO_LONG', message: '字幕单行文字偏长，建议拆成两行。', start: cue.start });
        }
        if (charsPerSecond > 18) findings.push({ severity: 'warning', code: 'SUBTITLE_TOO_FAST', message: '字幕阅读速度约 ' + charsPerSecond.toFixed(1) + ' 字/秒，建议缩短文字或延长显示时间。', start: cue.start });
        if (cue.duration < 0.8) findings.push({ severity: 'warning', code: 'SUBTITLE_TOO_SHORT', message: '字幕显示时间不足 0.8 秒。', start: cue.start });
      }
    } catch (error) {
      findings.push({ severity: 'warning', code: 'SUBTITLE_CHECK_FAILED', message: '字幕检查失败：' + error.message });
    }
  }
  for (const overlay of project?.timeline?.overlays || []) {
    const length = [...String(overlay.text || '')].length;
    if (length > 28 || Number(overlay.fontSize) > 100) {
      findings.push({ severity: 'warning', code: 'OVERLAY_READABILITY', message: '动态文字可能过长或字号过大，请检查安全区和可读性。' });
    }
  }
  if (analysisError) findings.push({ severity: 'info', code: 'FFMPEG_ANALYSIS_PARTIAL', message: 'FFmpeg 画面/音频分析未完整执行：' + analysisError });
  return {
    file: filePath,
    media,
    checks: {
      mediaProbe: true,
      blackFrameDetection: !analysisError && Boolean(media.video),
      freezeDetection: !analysisError && Boolean(media.video),
      audioLoudness: !analysisError && Boolean(media.audio),
      subtitleReadability: Boolean(subtitlePath),
      overlayReadability: true,
    },
    metrics: detected,
    findings,
    summary: {
      warningCount: findings.filter((item) => item.severity === 'warning').length,
      infoCount: findings.filter((item) => item.severity === 'info').length,
      passed: findings.every((item) => item.severity !== 'warning'),
    },
    generatedAt: new Date().toISOString(),
    note: '自动质量检查用于发现常见技术问题，不能替代人工检查叙事、素材匹配和整体观感。',
  };
}
