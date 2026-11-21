import http from 'node:http';
import path from 'node:path';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { VideoStudioError } from './errors.js';

const PUBLIC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');

function sendJson(response, status, value, headers = {}) {
  const body = Buffer.from(JSON.stringify(value));
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': body.length,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...headers,
  });
  response.end(body);
}

function isLoopbackOrigin(origin) {
  return /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(String(origin || ''));
}

const CALLBACK_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]{0,63}$/;

function sendCallback(response, status, value, callback, headers = {}) {
  if (!callback) {
    sendJson(response, status, value, headers);
    return;
  }
  // JSONP: a <script> load is exempt from CORS, preflight, and private-network
  // checks, so the settings page can still read the model list on browsers or
  // proxies that block the equivalent fetch().
  const body = Buffer.from(`/**/${callback}(${JSON.stringify(value)});`);
  response.writeHead(200, {
    'content-type': 'application/javascript; charset=utf-8',
    'content-length': body.length,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...headers,
  });
  response.end(body);
}

async function logRejectedModelRequest(engine, line) {
  try {
    const dir = engine?.store?.dataDir;
    if (!dir) return;
    const { appendFile, mkdir } = await import('node:fs/promises');
    await mkdir(dir, { recursive: true });
    await appendFile(path.join(dir, 'image-models.log'), `${new Date().toISOString()} ${line}\n`, 'utf8');
  } catch { /* Diagnostics must never break the response. */ }
}

/**
 * Read-only model list for the Harness settings page, which runs on a different
 * loopback origin than the workbench. It is answered before assertLocalRequest
 * instead of relaxing that check for every other API.
 */
async function serveImageModels(request, response, engine, port, url, method) {
  const host = String(request.headers.host || '').toLowerCase();
  const origin = request.headers.origin;
  // Echo whatever the browser sent so a CORS-capable client can read the body,
  // including the rejection paths below; a rejection without the header would
  // surface as an unreadable "Failed to fetch".
  const cors = {
    'access-control-allow-origin': origin || '*',
    'access-control-allow-private-network': 'true',
  };
  const callback = CALLBACK_PATTERN.test(String(url.searchParams.get('callback') || ''))
    ? url.searchParams.get('callback')
    : undefined;

  if (method === 'OPTIONS') {
    response.writeHead(204, {
      ...cors,
      'access-control-allow-methods': 'GET, OPTIONS',
      'access-control-allow-headers': 'accept, content-type, accept-language',
      'access-control-max-age': '600',
    });
    response.end();
    return;
  }

  const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`, '127.0.0.1', 'localhost']);
  if (!allowedHosts.has(host)) {
    await logRejectedModelRequest(engine, `host=${host} origin=${origin ?? '-'} reason=host`);
    sendCallback(response, 403, { error: '只允许通过本机地址访问 Video Studio。', code: 'HOST_NOT_ALLOWED' }, callback, cors);
    return;
  }
  // `null` is what an Electron renderer or a sandboxed frame sends; `dsh-app://` is
  // the Harness desktop shell's own custom protocol. Both still only reach a
  // loopback-bound endpoint, and the payload is a model-name list.
  const appOrigin = typeof origin === 'string' && /^(dsh-app|file):/i.test(origin);
  if (origin !== undefined && origin !== 'null' && !appOrigin && !isLoopbackOrigin(origin)) {
    await logRejectedModelRequest(engine, `host=${host} origin=${origin} reason=origin`);
    sendCallback(response, 403, { error: '跨站请求已被拒绝。', code: 'ORIGIN_NOT_ALLOWED' }, callback, cors);
    return;
  }

  try {
    sendCallback(response, 200, await engine.imageModels(), callback, cors);
  } catch (error) {
    const code = error?.code || 'IMAGE_MODELS_FAILED';
    const status = code === 'IMAGE_PROVIDER_NOT_CONFIGURED' ? 400
      : code === 'IMAGE_PROVIDER_UNAUTHORIZED' ? 401
        : code === 'IMAGE_PROVIDER_NO_MODELS' ? 404
          : 502;
    sendCallback(response, status, { error: error?.message || String(error), code }, callback, cors);
  }
}

async function readBody(request, limit = 10 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw new VideoStudioError('请求内容太大。', 'BODY_TOO_LARGE');
    chunks.push(chunk);
  }
  if (size === 0) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new VideoStudioError('请求必须是有效的 JSON。', 'INVALID_JSON'); }
}

function assertLocalRequest(request, port) {
  const host = String(request.headers.host || '').toLowerCase();
  const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`, `127.0.0.1`, `localhost`]);
  if (!allowedHosts.has(host)) throw new VideoStudioError('只允许通过本机地址访问 Video Studio。', 'HOST_NOT_ALLOWED');
  const origin = request.headers.origin;
  if (origin && origin !== `http://127.0.0.1:${port}` && origin !== `http://localhost:${port}`) {
    throw new VideoStudioError('跨站请求已被拒绝。', 'ORIGIN_NOT_ALLOWED');
  }
}

function contentType(fileName) {
  const ext = path.extname(fileName).toLowerCase();
  return ({ '.mp4': 'video/mp4', '.srt': 'text/plain; charset=utf-8', '.json': 'application/json; charset=utf-8' })[ext] || 'application/octet-stream';
}

async function serveOutput(request, response, engine, projectId, fileName) {
  const filePath = await engine.store.resolveProjectOutput(projectId, fileName);
  const info = await stat(filePath);
  const range = request.headers.range;
  response.setHeader('accept-ranges', 'bytes');
  response.setHeader('content-type', contentType(fileName));
  response.setHeader('cache-control', 'no-store');
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match) { response.writeHead(416); response.end(); return; }
    const start = match[1] ? Number(match[1]) : 0;
    const end = match[2] ? Math.min(Number(match[2]), info.size - 1) : info.size - 1;
    if (start > end || start >= info.size) { response.writeHead(416); response.end(); return; }
    response.writeHead(206, { 'content-range': `bytes ${start}-${end}/${info.size}`, 'content-length': end - start + 1 });
    createReadStream(filePath, { start, end }).pipe(response);
    return;
  }
  response.writeHead(200, { 'content-length': info.size });
  createReadStream(filePath).pipe(response);
}

export async function startServer(engine, { port = 4174, host = '127.0.0.1' } = {}) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new VideoStudioError('工作台端口必须在 1–65535 之间。', 'INVALID_PORT');
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url || '/', `http://${request.headers.host || `127.0.0.1:${port}`}`);
      const pathname = decodeURIComponent(url.pathname);
      const method = request.method || 'GET';

      if ((method === 'GET' || method === 'OPTIONS') && pathname === '/api/image-models') {
        return await serveImageModels(request, response, engine, port, url, method);
      }
      assertLocalRequest(request, port);

      if (method === 'GET' && pathname === '/') {
        const html = await readFile(path.join(PUBLIC_DIR, 'index.html'));
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': html.length, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; media-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'" });
        response.end(html);
        return;
      }
      if (method === 'GET' && pathname === '/api/status') return sendJson(response, 200, await engine.status());
      if (method === 'GET' && pathname === '/api/projects') return sendJson(response, 200, await engine.listProjects());
      if (method === 'POST' && pathname === '/api/projects') return sendJson(response, 201, await engine.createProject(await readBody(request)));

      const assetMatch = /^\/api\/projects\/([^/]+)\/assets$/.exec(pathname);
      if (method === 'POST' && assetMatch) return sendJson(response, 201, await engine.importAsset({ projectId: assetMatch[1], ...(await readBody(request)) }));
      const timelineMatch = /^\/api\/projects\/([^/]+)\/timeline$/.exec(pathname);
      if (method === 'PUT' && timelineMatch) return sendJson(response, 200, await engine.updateTimeline({ projectId: timelineMatch[1], ...(await readBody(request)) }));
      const subtitleMatch = /^\/api\/projects\/([^/]+)\/subtitles$/.exec(pathname);
      if (method === 'GET' && subtitleMatch) { response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }); response.end(await engine.store.getSubtitles(subtitleMatch[1])); return; }
      if (method === 'POST' && subtitleMatch) return sendJson(response, 200, await engine.setSubtitles({ projectId: subtitleMatch[1], ...(await readBody(request, 2_500_000)) }));
      const renderMatch = /^\/api\/projects\/([^/]+)\/render$/.exec(pathname);
      if (method === 'POST' && renderMatch) return sendJson(response, 202, await engine.submitRender({ projectId: renderMatch[1], ...(await readBody(request)) }));
      const outputsMatch = /^\/api\/projects\/([^/]+)\/outputs$/.exec(pathname);
      if (method === 'GET' && outputsMatch) return sendJson(response, 200, await engine.outputList(outputsMatch[1]));
      const projectMatch = /^\/api\/projects\/([^/]+)$/.exec(pathname);
      if (method === 'GET' && projectMatch) return sendJson(response, 200, await engine.getProject(projectMatch[1]));
      const jobCancelMatch = /^\/api\/jobs\/([^/]+)\/cancel$/.exec(pathname);
      if (method === 'POST' && jobCancelMatch) { await readBody(request); return sendJson(response, 200, await engine.cancelJob(jobCancelMatch[1])); }
      const jobMatch = /^\/api\/jobs\/([^/]+)$/.exec(pathname);
      if (method === 'GET' && jobMatch) return sendJson(response, 200, await engine.getJob(jobMatch[1]));
      if (method === 'POST' && pathname === '/api/media/search') return sendJson(response, 200, await engine.mediaSearch(await readBody(request)));
      if (method === 'POST' && pathname === '/api/media/download') return sendJson(response, 201, await engine.mediaDownload(await readBody(request)));
      if (method === 'GET' && pathname === '/api/library') {
        const tags = url.searchParams.getAll('tag');
        return sendJson(response, 200, await engine.libraryList({
          query: url.searchParams.get('query') || '',
          role: url.searchParams.get('role') || undefined,
          tags,
          limit: Number(url.searchParams.get('limit') || 100),
          offset: Number(url.searchParams.get('offset') || 0),
        }));
      }
      if (method === 'POST' && pathname === '/api/library') return sendJson(response, 201, await engine.libraryAdd(await readBody(request)));
      if (method === 'POST' && pathname === '/api/library/tag') return sendJson(response, 200, await engine.libraryTag(await readBody(request)));
      if (method === 'POST' && pathname === '/api/library/import') return sendJson(response, 201, await engine.libraryImport(await readBody(request)));

      const storyboardMatch = /^\/api\/projects\/([^/]+)\/storyboard$/.exec(pathname);
      if (method === 'GET' && storyboardMatch) return sendJson(response, 200, await engine.storyboardGet({ projectId: storyboardMatch[1] }));
      if (method === 'POST' && storyboardMatch) return sendJson(response, 200, await engine.storyboardCreate({ projectId: storyboardMatch[1], ...(await readBody(request)) }));
      const storyboardApplyMatch = /^\/api\/projects\/([^/]+)\/storyboard\/apply$/.exec(pathname);
      if (method === 'POST' && storyboardApplyMatch) return sendJson(response, 200, await engine.storyboardApply({ projectId: storyboardApplyMatch[1], ...(await readBody(request)) }));
      const imageGenerateMatch = /^\/api\/projects\/([^/]+)\/images\/generate$/.exec(pathname);
      if (method === 'POST' && imageGenerateMatch) return sendJson(response, 201, await engine.imageGenerate({ projectId: imageGenerateMatch[1], ...(await readBody(request)) }));
      const duplicateMatch = /^\/api\/projects\/([^/]+)\/duplicate$/.exec(pathname);
      if (method === 'POST' && duplicateMatch) return sendJson(response, 201, await engine.projectDuplicate({ projectId: duplicateMatch[1], ...(await readBody(request)) }));
      const qualityMatch = /^\/api\/projects\/([^/]+)\/quality$/.exec(pathname);
      if (method === 'POST' && qualityMatch) return sendJson(response, 200, await engine.qualityCheck({ projectId: qualityMatch[1], ...(await readBody(request)) }));
      if (method === 'POST' && pathname === '/api/batch/render') return sendJson(response, 202, await engine.submitBatchRender(await readBody(request)));
      const retryMatch = /^\/api\/jobs\/([^/]+)\/retry$/.exec(pathname);
      if (method === 'POST' && retryMatch) { await readBody(request); return sendJson(response, 202, await engine.retryJob(retryMatch[1])); }
      if (method === 'POST' && pathname === '/api/performance') return sendJson(response, 201, await engine.performanceRecord(await readBody(request)));
      if (method === 'GET' && pathname === '/api/performance/summary') return sendJson(response, 200, await engine.performanceSummary({
        groupBy: url.searchParams.get('groupBy') || 'objective',
        accountType: url.searchParams.get('accountType') || undefined,
        from: url.searchParams.get('from') || undefined,
        to: url.searchParams.get('to') || undefined,
        limit: Number(url.searchParams.get('limit') || 50),
      }));

      const outputMatch = /^\/files\/([^/]+)\/([^/]+)$/.exec(pathname);
      if (method === 'GET' && outputMatch) return await serveOutput(request, response, engine, outputMatch[1], outputMatch[2]);

      sendJson(response, 404, { error: '没有这个接口。', code: 'NOT_FOUND' });
    } catch (error) {
      const status = error?.code === 'PROJECT_NOT_FOUND' || error?.code === 'JOB_NOT_FOUND' || error?.code === 'ASSET_NOT_FOUND' || error?.code === 'LIBRARY_ITEM_NOT_FOUND' || error?.code === 'OUTPUT_NOT_FOUND' || error?.code === 'STORYBOARD_NOT_FOUND' ? 404
        : error?.code === 'REVISION_CONFLICT' ? 409
          : error?.code === 'BODY_TOO_LARGE' ? 413
            : error?.code === 'HOST_NOT_ALLOWED' || error?.code === 'ORIGIN_NOT_ALLOWED' ? 403
              : 400;
      if (!response.headersSent) sendJson(response, status, { error: error?.message || String(error), code: error?.code || 'REQUEST_FAILED' });
      else response.destroy(error);
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  const address = server.address();
  return {
    url: `http://${host}:${address.port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}
