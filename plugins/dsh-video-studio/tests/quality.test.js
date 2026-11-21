import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFfmpegQualityLog, parseSubtitleCues } from '../src/quality.js';

test('parses black, freeze, silence and audio volume signals from FFmpeg logs', () => {
  const log = [
    '[blackdetect] black_start:0.000 black_end:0.500 black_duration:0.500',
    '[freezedetect] freeze_start:1.000000',
    '[freezedetect] freeze_duration:2.500000',
    '[silencedetect] silence_start:3.000000',
    '[silencedetect] silence_duration:1.700000',
    '[volumedetect] mean_volume: -22.0 dB',
    '[volumedetect] max_volume: -0.8 dB',
  ].join('\n');
  const result = parseFfmpegQualityLog(log);
  assert.equal(result.blackSegments[0].duration, 0.5);
  assert.equal(result.freezeSegments[0].duration, 2.5);
  assert.equal(result.silenceSegments[0].duration, 1.7);
  assert.equal(result.meanVolumeDb, -22);
  assert.equal(result.maxVolumeDb, -0.8);
});

test('parses SRT cues for subtitle readability analysis', () => {
  const cues = parseSubtitleCues('1\n00:00:00,000 --> 00:00:02,000\nA short subtitle\n\n2\n00:00:02,000 --> 00:00:04,000\nSecond line\n');
  assert.equal(cues.length, 2);
  assert.equal(cues[0].duration, 2);
  assert.equal(cues[0].charCount, 16);
  assert.equal(cues[1].start, 2);
});
