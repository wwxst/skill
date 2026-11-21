import { spawn } from 'node:child_process';
import { VideoStudioError } from './errors.js';

export function runProcess(binary, args, { signal, cwd, onStdout, onStderr, timeoutMs = 0 } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    const child = spawn(binary, args, { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timeout;
    let abortKillTimer;
    let timedOut = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      if (abortKillTimer) clearTimeout(abortKillTimer);
      signal?.removeEventListener('abort', abort);
      error ? reject(error) : resolve(result);
    };
    const abort = () => {
      child.kill('SIGTERM');
      abortKillTimer = setTimeout(() => child.kill('SIGKILL'), 2500);
      abortKillTimer.unref?.();
    };
    signal?.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;
      if (stdout.length > 2_000_000) stdout = stdout.slice(-1_000_000);
      onStdout?.(text);
    });
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      if (stderr.length > 64_000) stderr = stderr.slice(-48_000);
      onStderr?.(text);
    });
    child.once('error', (error) => {
      const wrapped = new VideoStudioError(`无法启动 ${binary}：${error.message}`, 'PROCESS_START_FAILED', { cause: error });
      finish(wrapped);
    });
    child.once('close', (code, childSignal) => {
      if (signal?.aborted) return finish(signal.reason ?? new DOMException('Aborted', 'AbortError'));
      if (timedOut) return finish(new VideoStudioError(`${binary} 执行超时（${timeoutMs}ms）。`, 'PROCESS_TIMEOUT'));
      if (code !== 0) {
        const message = stderr.trim().split('\n').slice(-8).join('\n') || `进程退出码：${code}`;
        return finish(new VideoStudioError(`${binary} 执行失败：${message}`, 'PROCESS_FAILED'));
      }
      finish(null, { stdout, stderr, code, signal: childSignal });
    });
    if (timeoutMs > 0) {
      timeout = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
        abortKillTimer = setTimeout(() => child.kill('SIGKILL'), 2500);
        abortKillTimer.unref?.();
      }, timeoutMs);
      timeout.unref?.();
    }
  });
}

export async function probeMedia(filePath, ffprobePath = 'ffprobe', signal) {
  const { stdout } = await runProcess(ffprobePath, [
    '-v', 'error', '-show_format', '-show_streams', '-of', 'json', filePath,
  ], { signal, timeoutMs: 30_000 });
  let parsed;
  try { parsed = JSON.parse(stdout); }
  catch (error) { throw new VideoStudioError(`FFprobe 返回了无法解析的数据：${error.message}`, 'PROBE_INVALID_OUTPUT'); }
  const streams = Array.isArray(parsed.streams) ? parsed.streams : [];
  const video = streams.find((stream) => stream.codec_type === 'video');
  const audio = streams.find((stream) => stream.codec_type === 'audio');
  const duration = Number(parsed.format?.duration ?? video?.duration ?? 0) || null;
  return {
    duration,
    format: parsed.format?.format_name ?? null,
    size: Number(parsed.format?.size ?? 0) || null,
    bitRate: Number(parsed.format?.bit_rate ?? 0) || null,
    video: video ? {
      codec: video.codec_name ?? null,
      width: Number(video.width) || null,
      height: Number(video.height) || null,
      frameRate: video.avg_frame_rate ?? video.r_frame_rate ?? null,
      pixelFormat: video.pix_fmt ?? null,
    } : null,
    audio: audio ? {
      codec: audio.codec_name ?? null,
      channels: Number(audio.channels) || null,
      sampleRate: Number(audio.sample_rate) || null,
    } : null,
  };
}

export async function checkBinary(binary, args = ['-version']) {
  try {
    const result = await runProcess(binary, args, { timeoutMs: 5000 });
    return { available: true, version: (result.stdout || result.stderr).split('\n')[0].trim() };
  } catch (error) {
    return { available: false, error: error.message, code: error.code ?? 'UNKNOWN' };
  }
}
