import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeStoryboard, compileStoryboard } from '../src/storyboard.js';

test('normalizes a shot list and compiles it into an image timeline', () => {
  const storyboard = normalizeStoryboard({
    topic: 'A city at night',
    script: 'A short cinematic story',
    shots: [
      { title: 'Opening', visualPrompt: 'Wide city skyline at night', searchQuery: 'city skyline night', duration: 4, transitionType: 'fade', transitionDuration: 0.3, overlayText: 'CITY LIGHTS' },
      { title: 'Street', visualPrompt: 'A quiet street with neon lights', duration: 3, transitionType: 'cut', transitionDuration: 0 },
    ],
  });
  const project = {
    assets: [
      { id: 'asset_a', role: 'image' },
      { id: 'asset_b', role: 'image' },
    ],
    timeline: {},
  };
  const compiled = compileStoryboard(storyboard, project, { assetIds: ['asset_a', 'asset_b'] });
  assert.equal(compiled.clips.length, 2);
  assert.equal(compiled.clips[0].duration, 4);
  assert.equal(compiled.transitions[0].type, 'fade');
  assert.equal(compiled.overlays[0].text, 'CITY LIGHTS');
  assert.equal(compiled.overlays[0].end, 4);
});

test('rejects missing assets and malformed shot lists', () => {
  assert.throws(() => normalizeStoryboard({ topic: 'Topic', shots: [] }), /1–50/);
  const storyboard = normalizeStoryboard({ topic: 'Topic', shots: [{ visualPrompt: 'A scene' }] });
  assert.throws(() => compileStoryboard(storyboard, { assets: [], timeline: {} }), (error) => error.code === 'INVALID_STORYBOARD_ASSETS');
});
