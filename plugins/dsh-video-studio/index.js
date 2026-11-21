import Schema from '@deepseek-ai/schemastery';
import { createEngine } from './src/engine.js';
import { startServer } from './src/server.js';
import { createToolDefinitions, videoStudioInstructions } from './src/tools.js';

export const name = 'video-studio';
export const inject = ['tools', 'systemPrompt'];

/**
 * Settings that the Harness settings page can read and write for this plugin row.
 * Every field stays optional so the DSH_VIDEO_STUDIO_* environment variables keep
 * working as fallbacks; role('secret') fields are redacted by the host and only
 * accept writes, so an API key is never sent back to the browser.
 */
export const Config = Schema.object({
  allowedRoots: Schema.array(Schema.string()).description('额外允许导入素材的目录，例如 D:\\素材库。'),
  dataDir: Schema.string().description('项目、任务和成片的存储目录，留空使用 ~/.dsh-video-studio。'),
  port: Schema.natural().description('工作台 HTTP 端口，留空使用 4174。'),
  ffmpegPath: Schema.string().description('ffmpeg 可执行文件路径，留空使用 PATH 中的 ffmpeg。'),
  ffprobePath: Schema.string().description('ffprobe 可执行文件路径，留空使用 PATH 中的 ffprobe。'),
  // Volatile fields are the only ones the Harness settings page renders, and they
  // reach apply() as live getters; src/util.js `liveValue` resolves them per call.
  pixabayApiKey: Schema.string().role('secret').volatile().description('Pixabay API Key，用于素材搜索和下载。'),
  imageApiKey: Schema.string().role('secret').volatile().description('图片生成服务的 API Key，兼容 OpenAI Images API。'),
  imageApiBaseUrl: Schema.string().volatile().description('图片生成服务的 Base URL，留空使用官方地址。'),
  imageModel: Schema.string().volatile().description('图片生成模型名称。'),
  imageTimeoutMs: Schema.natural().description('图片生成请求超时毫秒数，默认 300000（5 分钟）。'),
});

export async function apply(ctx, config = {}) {
  const engine = await createEngine(config);
  let server;
  try {
    const port = Number(config.port ?? process.env.DSH_VIDEO_STUDIO_PORT ?? 4174);
    server = await startServer(engine, { port, host: '127.0.0.1' });
    for (const tool of createToolDefinitions(engine)) ctx.tools.register(tool);
    ctx.systemPrompt.section({
      name: 'video-studio:workflow',
      order: 8600,
      interpolate: false,
      text: `${videoStudioInstructions}\n工作台地址：${server.url}`,
    });
    ctx.effect(() => async () => {
      try { await server?.close(); }
      finally { await engine.close(); }
    });
  } catch (error) {
    try { await server?.close(); }
    finally { await engine.close(); }
    throw error;
  }
}
