import { createEngine } from './src/engine.js';
import { startServer } from './src/server.js';
import { createToolDefinitions, videoStudioInstructions } from './src/tools.js';

export const name = 'video-studio';
export const inject = ['tools', 'systemPrompt'];

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
