import assert from 'node:assert/strict';
import test from 'node:test';

const plugin = await import('../index.js');
const { liveValue } = await import('../src/util.js');

const root = () => plugin.Config.toJSON();
const field = (key) => {
  const json = root();
  const node = json.refs[json.uid];
  return json.refs[node.dict[key]];
};

test('exposes a Config schema so the Harness settings page can render a form', () => {
  assert.equal(typeof plugin.Config, 'function');
  const json = root();
  assert.deepEqual(Object.keys(json.refs[json.uid].dict).sort(), [
    'allowedRoots',
    'dataDir',
    'ffmpegPath',
    'ffprobePath',
    'imageApiBaseUrl',
    'imageApiKey',
    'imageModel',
    'imageTimeoutMs',
    'pixabayApiKey',
    'port',
  ]);
});

test('marks every API key field as a write-only secret', () => {
  for (const key of ['pixabayApiKey', 'imageApiKey']) {
    assert.equal(field(key).meta?.role, 'secret', `${key} must be redacted by the host`);
  }
});

test('marks the settings-page fields volatile, which is what the form renders', () => {
  // The Harness settings service keeps only volatile fields in a form
  // (settings.host.js `volatileForm`), so a namespace without them never appears.
  for (const key of ['pixabayApiKey', 'imageApiKey', 'imageApiBaseUrl', 'imageModel']) {
    assert.equal(field(key).meta?.volatile, true, `${key} must be volatile to appear in settings`);
  }
  for (const key of ['allowedRoots', 'dataDir', 'port', 'ffmpegPath', 'ffprobePath']) {
    assert.notEqual(field(key).meta?.volatile, true, `${key} applies at startup and must not be volatile`);
  }
});

test('accepts an empty row config and keeps every field optional', () => {
  const parsed = plugin.Config({});
  assert.deepEqual(parsed.allowedRoots, []);
  assert.equal(liveValue(parsed.pixabayApiKey), undefined);
  assert.equal(liveValue(parsed.imageApiKey), undefined);
  assert.equal(parsed.port, undefined);
});

test('hands volatile fields to apply as live getters that resolve the stored value', () => {
  const parsed = plugin.Config({ pixabayApiKey: 'key-123', imageModel: 'model-x' });
  assert.equal(typeof parsed.pixabayApiKey.get, 'function');
  assert.equal(parsed.pixabayApiKey.get(), 'key-123');
  assert.equal(liveValue(parsed.imageModel), 'model-x');
  assert.equal(liveValue(parsed.imageApiKey), undefined);
});

test('keeps environment fallbacks reachable by leaving startup paths unset', () => {
  const parsed = plugin.Config({ allowedRoots: ['D:\\Media'] });
  assert.deepEqual(parsed.allowedRoots, ['D:\\Media']);
  assert.equal(parsed.dataDir, undefined);
  assert.equal(parsed.ffmpegPath, undefined);
});
