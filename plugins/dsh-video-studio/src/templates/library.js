import path from 'node:path';
import { readFile, readdir } from 'node:fs/promises';
import { ensureDir, id, readJson, writeJsonAtomic } from '../util.js';
import { timelineDuration } from './schema.js';

const BUILTIN_PATH = new URL('./presets/cinematic-photo.json', import.meta.url);

async function builtins() {
  return [JSON.parse(await readFile(BUILTIN_PATH, 'utf8'))];
}

function templateSummary(template, isBuiltIn) {
  return {
    id: template.id,
    name: template.name,
    description: template.description ?? '',
    isBuiltIn,
    assetCount: template.kind === 'preset' ? null : template.clips.length,
    updatedAt: template.updatedAt ?? null,
  };
}

export async function listTemplates(dataDir) {
  const directory = path.join(dataDir, 'templates');
  await ensureDir(directory);
  const result = (await builtins()).map((template) => templateSummary(template, true));
  const files = await readdir(directory, { withFileTypes: true });
  for (const file of files) {
    if (!file.isFile() || !/^tpl_[a-f0-9]{12}\.json$/.test(file.name)) continue;
    try {
      const template = await readJson(path.join(directory, file.name));
      result.push(templateSummary(template, false));
    } catch { /* Ignore invalid template files; the original file remains available for inspection. */ }
  }
  return result.sort((a, b) => Number(b.isBuiltIn) - Number(a.isBuiltIn) || a.name.localeCompare(b.name));
}

export async function getTemplate(dataDir, templateId) {
  const preset = (await builtins()).find((item) => item.id === templateId);
  if (preset) return preset;
  if (typeof templateId !== 'string' || !/^tpl_[a-f0-9]{12}$/.test(templateId)) {
    throw new Error(`模板不存在：${templateId}`);
  }
  try { return await readJson(path.join(dataDir, 'templates', `${templateId}.json`)); }
  catch (error) {
    if (error.code === 'ENOENT') throw new Error(`模板不存在：${templateId}`);
    throw error;
  }
}

export async function saveTemplateFromProject(dataDir, project, { name, description = '' }) {
  if (typeof name !== 'string' || !name.trim()) throw new Error('模板名称不能为空。');
  const clips = project.timeline?.clips ?? [];
  if (clips.length < 2 || clips.length > 12) throw new Error('保存模板需要 2–12 个图片片段。');
  const assets = new Map(project.assets.map((asset) => [asset.id, asset]));
  if (clips.some((clip) => assets.get(clip.assetId)?.role !== 'image')) {
    throw new Error('第一版只支持把图片时间线保存为可复用模板；视频片段模板后续再开放。');
  }
  const template = {
    id: id('tpl'),
    kind: 'saved',
    version: 2,
    name: name.trim().slice(0, 80),
    description: String(description).slice(0, 500),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    referenceCanvas: { width: project.output.width, height: project.output.height },
    clips: clips.map((clip) => ({
      duration: clip.duration,
      fit: clip.fit ?? 'crop',
      motion: clip.motion ?? { type: 'none', intensity: 0.12 },
    })),
    transitions: (project.timeline.transitions ?? []).map((item) => ({ ...item })),
    overlays: (project.timeline.overlays ?? []).map((item) => ({ ...item })),
  };
  const directory = path.join(dataDir, 'templates');
  await ensureDir(directory);
  await writeJsonAtomic(path.join(directory, `${template.id}.json`), template);
  return templateSummary(template, false);
}

function scaleOverlayFonts(overlays, template, targetOutput) {
  const referenceCanvas = template.referenceCanvas ?? template.output;
  const referenceHeight = Number(referenceCanvas?.height);
  const targetHeight = Number(targetOutput?.height);
  if (!Number.isFinite(referenceHeight) || referenceHeight <= 0 || !Number.isFinite(targetHeight) || targetHeight <= 0) {
    return overlays;
  }
  const scale = targetHeight / referenceHeight;
  return overlays.map((overlay) => {
    const originalSize = Number(overlay.fontSize ?? 56);
    if (!Number.isFinite(originalSize)) return overlay;
    const fontSize = Math.max(20, Math.min(120, Math.round(originalSize * scale)));
    return { ...overlay, fontSize };
  });
}

export function compileTemplate(template, { assetIds, title, durationPerImage, targetOutput } = {}) {
  if (!Array.isArray(assetIds) || assetIds.some((item) => typeof item !== 'string' || !item)) {
    throw new Error('assetIds 必须是已导入项目的素材 ID 数组。');
  }
  let clips;
  let transitions;
  let overlays;
  if (template.kind === 'preset') {
    if (assetIds.length < template.minAssets || assetIds.length > template.maxAssets) {
      throw new Error(`模板“${template.name}”需要 ${template.minAssets}–${template.maxAssets} 张图片。`);
    }
    const duration = Number(durationPerImage ?? template.durationPerImage);
    if (!Number.isFinite(duration) || duration < 2 || duration > 15) throw new Error('每张图片时长必须在 2–15 秒之间。');
    clips = assetIds.map((assetId, index) => ({
      assetId,
      duration,
      fit: template.fit,
      motion: { type: template.motions[index % template.motions.length], intensity: template.intensity },
    }));
    transitions = Array.from({ length: clips.length - 1 }, () => ({ ...template.transition }));
    const finalDuration = timelineDuration(clips, transitions);
    overlays = typeof title === 'string' && title.trim() ? [{
      text: title.trim().slice(0, 100),
      start: 0,
      end: Math.min(3, finalDuration),
      position: 'top',
      fontSize: 64,
      color: '#FFFFFF',
      animation: 'fade-in-out',
    }] : [];
  } else {
    if (assetIds.length !== template.clips.length) {
      throw new Error(`模板“${template.name}”需要 ${template.clips.length} 个图片素材槽位，当前提供了 ${assetIds.length} 个。`);
    }
    clips = template.clips.map((clip, index) => ({ ...clip, assetId: assetIds[index] }));
    transitions = template.transitions ?? [];
    overlays = template.overlays ?? [];
  }
  return { clips, transitions, overlays: scaleOverlayFonts(overlays, template, targetOutput) };
}
