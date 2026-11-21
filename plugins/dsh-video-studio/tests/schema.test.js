import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTransitions } from '../src/templates/schema.js';
import { compileTemplate } from '../src/templates/library.js';

const clips = [{ duration: 2 }, { duration: 2 }, { duration: 2 }];

test('rejects adjacent transitions that overlap on their shared middle clip', () => {
  assert.throws(
    () => normalizeTransitions([
      { type: 'fade', duration: 1.5 },
      { type: 'dissolve', duration: 1.5 },
    ], clips),
    /第 2 个片段两侧转场时长总和不能超过该片段时长/,
  );
});

test('allows adjacent transitions when their combined duration exactly fits the middle clip', () => {
  const transitions = normalizeTransitions([
    { type: 'fade', duration: 1 },
    { type: 'dissolve', duration: 1 },
  ], clips);
  assert.equal(transitions.length, 2);
  assert.equal(transitions[0].duration + transitions[1].duration, clips[1].duration);
});

test('scales saved-template text for a different target canvas and supports legacy templates', () => {
  const template = {
    kind: 'saved',
    output: { width: 320, height: 180 },
    clips: [{ duration: 2, fit: 'crop', motion: { type: 'zoom-in', intensity: 0.12 } }],
    transitions: [],
    overlays: [{
      text: 'HELLO',
      start: 0,
      end: 2,
      position: 'top',
      animation: 'none',
      fontSize: 64,
      color: '#FFFFFF',
    }],
  };
  const compiled = compileTemplate(template, {
    assetIds: ['asset_test'],
    targetOutput: { width: 480, height: 270, fps: 30 },
  });
  assert.equal(compiled.overlays[0].fontSize, 96);
});

test('US photo templates keep stable frames and early English hooks', () => {
  const usPreset = {
    kind: 'preset', name: 'US Photo Reveal', minAssets: 3, maxAssets: 3, locale: 'en-US',
    slots: [
      { duration: 1.2, caption: '$TITLE', fallbackTitle: 'HOW TO DO THIS PHOTO EDIT', motion: { type: 'none', intensity: 0.08 }, transition: { type: 'cut', duration: 0 } },
      { duration: 1.1, motion: { type: 'none', intensity: 0.08 }, transition: { type: 'wipeleft', duration: 0.15 } },
      { duration: 1.8, motion: { type: 'none', intensity: 0.08 } },
    ],
  };
  const result = compileTemplate(usPreset, {
    assetIds: ['a', 'b', 'c'],
    title: 'HOW TO MAKE THIS EDIT',
    targetOutput: { width: 1080, height: 1920 },
  });
  assert.deepEqual(result.clips.map(c => c.duration), [1.2, 1.1, 1.8]);
  assert.ok(result.clips.every(c => c.motion.type === 'none'));
  assert.equal(result.overlays[0].text, 'HOW TO MAKE THIS EDIT');
  assert.equal(result.transitions[1].type, 'wipeleft');
  assert.throws(() => compileTemplate(usPreset, { assetIds: ['a', 'b', 'c'], durationPerImage: 3 }), /固定分镜时长/);
});
