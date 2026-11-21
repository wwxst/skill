import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTransitions } from '../src/templates/schema.js';

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
