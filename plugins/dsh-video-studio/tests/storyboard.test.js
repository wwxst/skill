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

test('photo storyboard defaults to steady frames and supports short cut timing', () => {
  const storyboard = normalizeStoryboard({
    topic: 'US photo edit',
    shots: [
      { visualPrompt: 'Before photo', duration: 0.6, transitionType: 'cut', transitionDuration: 0 },
      { visualPrompt: 'After photo', duration: 0.9, motionType: 'zoom-in', motionIntensity: 0.06 },
    ],
  });
  const compiled = compileStoryboard(storyboard, {
    assets: [{ id: 'before', role: 'image' }, { id: 'after', role: 'image' }],
    timeline: {},
  }, { assetIds: ['before', 'after'] });
  assert.equal(compiled.clips[0].motion.type, 'none');
  assert.equal(compiled.clips[1].motion.type, 'zoom-in');
  assert.equal(compiled.clips[1].motion.intensity, 0.06);
  assert.equal(compiled.clips[0].duration, 0.6);
});
