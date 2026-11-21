import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { startServer } from '../src/server.js';

async function freePort() {
  return await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

const engine = {
  imageModels: async () => ({ baseUrl: 'https://images.example/v1', models: ['gpt-image-1', 'dall-e-3'], count: 2 }),
};

test('serves the model list to another loopback origin for the settings page', async (t) => {
  const port = await freePort();
  const server = await startServer(engine, { port });
  t.after(() => server.close());

  const response = await fetch(`http://127.0.0.1:${port}/api/image-models`, {
    headers: { origin: 'http://127.0.0.1:61310' },
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), 'http://127.0.0.1:61310');
  const payload = await response.json();
  assert.deepEqual(payload.models, ['gpt-image-1', 'dall-e-3']);
});

test('answers the preflight for the model list', async (t) => {
  const port = await freePort();
  const server = await startServer(engine, { port });
  t.after(() => server.close());

  const response = await fetch(`http://127.0.0.1:${port}/api/image-models`, {
    method: 'OPTIONS',
    headers: { origin: 'http://localhost:52000', 'access-control-request-method': 'GET' },
  });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-methods'), 'GET, OPTIONS');
});

test('rejects the model list from a non-loopback origin', async (t) => {
  const port = await freePort();
  const server = await startServer(engine, { port });
  t.after(() => server.close());

  const response = await fetch(`http://127.0.0.1:${port}/api/image-models`, {
    headers: { origin: 'https://evil.example' },
  });
  assert.equal(response.status, 403);
});

test('serves the model list as JSONP so a script tag can bypass CORS', async (t) => {
  const port = await freePort();
  const server = await startServer(engine, { port });
  t.after(() => server.close());

  const response = await fetch(`http://127.0.0.1:${port}/api/image-models?callback=vsModels_abc123`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /javascript/);
  const body = await response.text();
  assert.match(body, /^\/\*\*\/vsModels_abc123\(/);
  assert.match(body, /gpt-image-1/);
});

test('ignores an invalid JSONP callback name instead of echoing it', async (t) => {
  const port = await freePort();
  const server = await startServer(engine, { port });
  t.after(() => server.close());

  const response = await fetch(`http://127.0.0.1:${port}/api/image-models?callback=alert(1)`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /json/);
});

test('accepts the null origin an Electron renderer sends', async (t) => {
  const port = await freePort();
  const server = await startServer(engine, { port });
  t.after(() => server.close());

  const response = await fetch(`http://127.0.0.1:${port}/api/image-models`, { headers: { origin: 'null' } });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.count, 2);
});

test('accepts the Harness desktop shell custom-protocol origin', async (t) => {
  // The desktop renderer sends Origin: dsh-app://app, which a loopback http check
  // rejects; that rejection is what made the settings button fail on this machine.
  const port = await freePort();
  const server = await startServer(engine, { port });
  t.after(() => server.close());

  const response = await fetch(`http://127.0.0.1:${port}/api/image-models`, {
    headers: { origin: 'dsh-app://app' },
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), 'dsh-app://app');
  assert.deepEqual((await response.json()).models, ['gpt-image-1', 'dall-e-3']);
});

test('keeps CORS headers on failures so the settings page can show the reason', async (t) => {
  const port = await freePort();
  const failing = {
    imageModels: async () => {
      const error = new Error('尚未配置图片生成 API Key。');
      error.code = 'IMAGE_PROVIDER_NOT_CONFIGURED';
      throw error;
    },
  };
  const server = await startServer(failing, { port });
  t.after(() => server.close());

  const response = await fetch(`http://127.0.0.1:${port}/api/image-models`, {
    headers: { origin: 'http://127.0.0.1:61310' },
  });
  assert.equal(response.status, 400);
  assert.equal(response.headers.get('access-control-allow-origin'), 'http://127.0.0.1:61310');
  const payload = await response.json();
  assert.equal(payload.code, 'IMAGE_PROVIDER_NOT_CONFIGURED');
  assert.match(payload.error, /API Key/);
});

test('does not relax the same-origin rule for the other workbench APIs', async (t) => {
  const port = await freePort();
  const server = await startServer({ imageModels: engine.imageModels, status: async () => ({ ok: true }) }, { port });
  t.after(() => server.close());

  const response = await fetch(`http://127.0.0.1:${port}/api/status`, {
    headers: { origin: 'http://127.0.0.1:61310' },
  });
  assert.equal(response.status, 403);
  const payload = await response.json();
  assert.equal(payload.code, 'ORIGIN_NOT_ALLOWED');
});
