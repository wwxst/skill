import { VideoStudioError } from './errors.js';
import { TRANSITION_TYPES } from './templates/schema.js';

function shortText(value, label, max, required = false) {
  const text = String(value ?? '').trim();
  if (required && !text) throw new VideoStudioError(label + '不能为空。', 'INVALID_STORYBOARD');
  if (text.length > max) throw new VideoStudioError(label + '不能超过 ' + max + ' 个字符。', 'INVALID_STORYBOARD');
  return text;
}

export function normalizeStoryboard({ topic, script = '', shots } = {}) {
  if (!Array.isArray(shots) || shots.length < 1 || shots.length > 50) {
    throw new VideoStudioError('镜头清单必须包含 1–50 个镜头。', 'INVALID_STORYBOARD');
  }
  const normalizedShots = shots.map((shot, index) => {
    if (!shot || typeof shot !== 'object' || Array.isArray(shot)) throw new VideoStudioError('第 ' + (index + 1) + ' 个镜头必须是对象。', 'INVALID_STORYBOARD');
    const duration = Number(shot.duration ?? 4);
    if (!Number.isFinite(duration) || duration < 1 || duration > 60) throw new VideoStudioError('第 ' + (index + 1) + ' 个镜头时长必须是 1–60 秒。', 'INVALID_STORYBOARD');
    const transitionType = shot.transitionType ?? 'cut';
    if (!TRANSITION_TYPES.includes(transitionType)) throw new VideoStudioError('第 ' + (index + 1) + ' 个镜头的转场类型无效。', 'INVALID_STORYBOARD');
    const transitionDuration = Number(shot.transitionDuration ?? (transitionType === 'cut' ? 0 : 0.35));
    if (!Number.isFinite(transitionDuration) || transitionDuration < 0 || transitionDuration > 2 || (transitionType === 'cut' && transitionDuration !== 0) || (transitionType !== 'cut' && transitionDuration <= 0)) {
      throw new VideoStudioError('第 ' + (index + 1) + ' 个镜头的转场时长无效。', 'INVALID_STORYBOARD');
    }
    const sourcePreference = shot.sourcePreference ?? 'auto';
    if (!['auto', 'pixabay', 'generate', 'manual'].includes(sourcePreference)) throw new VideoStudioError('第 ' + (index + 1) + ' 个镜头的素材来源策略无效。', 'INVALID_STORYBOARD');
    const overlayPosition = shot.overlayPosition ?? 'bottom';
    if (!['top', 'center', 'bottom'].includes(overlayPosition)) throw new VideoStudioError('第 ' + (index + 1) + ' 个镜头的文字位置无效。', 'INVALID_STORYBOARD');
    const fontSize = Number(shot.fontSize ?? 56);
    if (!Number.isFinite(fontSize) || fontSize < 20 || fontSize > 120) throw new VideoStudioError('第 ' + (index + 1) + ' 个镜头的文字字号必须是 20–120。', 'INVALID_STORYBOARD');
    return {
      id: 'shot-' + String(index + 1).padStart(2, '0'),
      index: index + 1,
      title: shortText(shot.title, '镜头标题', 120),
      narration: shortText(shot.narration, '镜头旁白', 1000),
      visualPrompt: shortText(shot.visualPrompt, '画面描述', 1000, true),
      searchQuery: shortText(shot.searchQuery, '素材搜索词', 100),
      duration,
      sourcePreference,
      assetId: shot.assetId ? String(shot.assetId) : null,
      sourceIn: Number(shot.sourceIn ?? 0),
      sourceOut: shot.sourceOut === undefined ? null : Number(shot.sourceOut),
      transitionType,
      transitionDuration,
      overlayText: shortText(shot.overlayText, '画面文字', 200),
      overlayPosition,
      fontSize,
      overlayColor: shot.overlayColor ?? '#FFFFFF',
      overlayAnimation: shot.overlayAnimation ?? 'fade-in-out',
    };
  });
  return {
    version: 1,
    topic: shortText(topic, '选题', 300, true),
    script: shortText(script, '脚本', 12000),
    shots: normalizedShots,
    updatedAt: new Date().toISOString(),
  };
}

export function compileStoryboard(storyboard, project, { assetIds, fit = 'crop' } = {}) {
  const shots = storyboard?.shots;
  if (!Array.isArray(shots) || !shots.length) throw new VideoStudioError('项目还没有镜头清单。', 'STORYBOARD_NOT_FOUND');
  if (!['crop', 'contain'].includes(fit)) throw new VideoStudioError('fit 只能是 crop 或 contain。', 'INVALID_ARGUMENT');
  if (assetIds !== undefined && (!Array.isArray(assetIds) || assetIds.length !== shots.length)) {
    throw new VideoStudioError('assetIds 数量必须与镜头数量完全一致。', 'INVALID_STORYBOARD_ASSETS');
  }
  const assets = new Map(project.assets.map((asset) => [asset.id, asset]));
  const clips = [];
  const transitions = [];
  const overlays = [];
  let cursor = 0;
  for (let index = 0; index < shots.length; index += 1) {
    const shot = shots[index];
    const assetId = assetIds?.[index] || shot.assetId;
    const asset = assets.get(assetId);
    if (!asset || !['image', 'video'].includes(asset.role)) {
      throw new VideoStudioError('第 ' + (index + 1) + ' 个镜头没有绑定当前项目内的视频或图片素材。', 'INVALID_STORYBOARD_ASSETS');
    }
    let clip;
    if (asset.role === 'image') {
      clip = { assetId, duration: shot.duration, speed: 1, sourceIn: 0, sourceOut: shot.duration, fit, motion: { type: 'zoom-in', intensity: 0.1 } };
    } else {
      const sourceIn = Number(shot.sourceIn || 0);
      const requestedOut = shot.sourceOut === null ? sourceIn + shot.duration : Number(shot.sourceOut);
      const sourceOut = Math.min(Number(asset.media?.duration || requestedOut), requestedOut);
      if (!Number.isFinite(sourceOut) || sourceOut <= sourceIn) throw new VideoStudioError('第 ' + (index + 1) + ' 个视频镜头超出了素材时长。', 'INVALID_STORYBOARD_ASSETS');
      clip = { assetId, sourceIn, sourceOut, speed: 1, fit, motion: { type: 'none', intensity: 0.1 } };
    }
    clips.push(clip);
    const actualDuration = asset.role === 'image' ? shot.duration : (clip.sourceOut - clip.sourceIn);
    if (shot.overlayText) {
      overlays.push({
        text: shot.overlayText,
        start: cursor,
        end: cursor + actualDuration,
        position: shot.overlayPosition,
        fontSize: shot.fontSize,
        color: shot.overlayColor,
        animation: shot.overlayAnimation,
      });
    }
    if (index < shots.length - 1) {
      transitions.push({ type: shot.transitionType, duration: shot.transitionDuration });
      cursor += actualDuration - (shot.transitionType === 'cut' ? 0 : shot.transitionDuration);
    }
  }
  return {
    clips,
    transitions,
    overlays,
    musicAssetId: project.timeline.musicAssetId ?? null,
    voiceoverAssetId: project.timeline.voiceoverAssetId ?? null,
    originalAudioVolume: project.timeline.originalAudioVolume ?? 1,
    musicVolume: project.timeline.musicVolume ?? 0.18,
    voiceoverVolume: project.timeline.voiceoverVolume ?? 1,
    fit,
  };
}
