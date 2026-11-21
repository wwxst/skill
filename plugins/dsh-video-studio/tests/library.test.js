import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { createMediaLibrary } from '../src/library.js';

const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(16, 2)]);

test('local media library tags, deduplicates by SHA-256, and imports metadata into projects', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'video-library-test-'));
  const dataDir = path.join(root, 'data');
  const inputDir = path.join(root, 'inputs');
  await mkdir(inputDir, { recursive: true });
  const imagePath = path.join(inputDir, 'sample.png');
  await writeFile(imagePath, png);
  const imported = [];
  const store = {
    async importAsset(args) {
      imported.push(args);
      return { projectId: args.projectId, revision: 2, asset: { id: 'asset_123456789abc', name: args.label, role: args.role, metadata: args.metadata } };
    },
  };
  const library = createMediaLibrary({
    dataDir,
    store,
    resolveAllowedFile: async (filePath) => {
      const actual = await realpath(filePath);
      return { path: actual, stat: await stat(actual) };
    },
  });
  await library.initialize();
  t.after(() => rm(root, { recursive: true, force: true }));

  const first = await library.addFile({ filePath: imagePath, role: 'image', tags: ['city', 'night'] });
  const second = await library.addBuffer({ buffer: png, extension: '.png', role: 'image', name: 'same image', tags: ['cinematic'] });
  assert.equal(first.id, second.id);
  assert.equal(first.sha256, second.sha256);

  const tagged = await library.tag({ libraryId: first.id, add: ['hero'], remove: ['night'] });
  assert.deepEqual(tagged.tags.sort(), ['city', 'cinematic', 'hero'].sort());
  const listed = await library.list({ query: 'hero', role: 'image' });
  assert.equal(listed.total, 1);
  assert.equal(listed.items[0].id, first.id);
  assert.equal('path' in listed.items[0], false);

  const result = await library.importToProject({ projectId: 'vs_123456789abc', libraryId: first.id });
  assert.equal(result.libraryId, first.id);
  assert.equal(imported[0].metadata.libraryId, first.id);
  assert.deepEqual([...imported[0].metadata.tags].sort(), [...tagged.tags].sort());
});
