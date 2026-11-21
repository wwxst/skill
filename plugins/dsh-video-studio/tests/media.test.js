import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFfmpegCapabilities } from '../src/media.js';

test('parses the FFmpeg filters and encoders required by Video Studio', () => {
  const filters = [
    'Filters:',
    ' ... ass V->V Render ASS subtitles onto input video using the libass library',
    ' ... subtitles V->V Render text subtitles onto input video using the libass library',
    ' ... xfade VV->V Cross fade one video with another video.',
    ' ... zoompan V->V Apply Zoom & Pan effect.',
    ' ... acrossfade AA->A Cross fade two audio inputs.',
    ' ... amix N->A Audio mixing.',
  ].join('\n');
  const encoders = [
    'Encoders:',
    ' V....D libx264 H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10',
  ].join('\n');

  assert.deepEqual(parseFfmpegCapabilities(filters, encoders), {
    filters: {
      ass: true,
      subtitles: true,
      xfade: true,
      zoompan: true,
      acrossfade: true,
      amix: true,
    },
    encoders: { libx264: true },
  });
});

test('reports unavailable FFmpeg features instead of assuming they exist', () => {
  const result = parseFfmpegCapabilities('Filters:\n ... zoompan V->V Zoom and pan', 'Encoders:');
  assert.equal(result.filters.zoompan, true);
  assert.equal(result.filters.ass, false);
  assert.equal(result.filters.subtitles, false);
  assert.equal(result.filters.xfade, false);
  assert.equal(result.encoders.libx264, false);
});
