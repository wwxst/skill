export const MOTION_TYPES = ['none', 'zoom-in', 'zoom-out', 'pan-left', 'pan-right', 'pan-up', 'pan-down'];
export const TRANSITION_TYPES = ['cut', 'fade', 'dissolve', 'wipeleft', 'wiperight', 'slideleft', 'slideright', 'circleopen', 'circleclose', 'pixelize'];
export const OVERLAY_POSITIONS = ['top', 'center', 'bottom'];
export const OVERLAY_ANIMATIONS = ['none', 'fade-in', 'fade-out', 'fade-in-out'];

function finite(value, label, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    throw new Error(`${label}必须在 ${min}–${max} 之间。`);
  }
  return number;
}

export function normalizeMotion(value, role, index) {
  const input = typeof value === 'string' ? { type: value } : (value ?? {});
  const type = input.type ?? 'none';
  if (!MOTION_TYPES.includes(type)) {
    throw new Error(`第 ${index + 1} 个片段 motion 不支持：${type}。`);
  }
  if (role !== 'image' && type !== 'none') {
    throw new Error(`第 ${index + 1} 个片段只有图片素材支持镜头动画。`);
  }
  const intensity = finite(input.intensity ?? 0.12, `第 ${index + 1} 个片段动画强度`, 0.05, 0.25);
  return { type, intensity };
}

export function normalizeTransitions(value, clips) {
  const source = value ?? [];
  if (!Array.isArray(source)) throw new Error('transitions 必须是数组。');
  if (source.length === 0) {
    return Array.from({ length: Math.max(0, clips.length - 1) }, () => ({ type: 'cut', duration: 0 }));
  }
  if (source.length !== clips.length - 1) {
    throw new Error(`transitions 数量必须是片段数量减一（当前需要 ${clips.length - 1} 个）。`);
  }
  return source.map((item, index) => {
    const type = item?.type ?? 'cut';
    if (!TRANSITION_TYPES.includes(type)) throw new Error(`第 ${index + 1} 个转场类型不支持：${type}。`);
    const duration = finite(item?.duration ?? (type === 'cut' ? 0 : 0.5), `第 ${index + 1} 个转场时长`, 0, 2);
    if (type === 'cut' && duration !== 0) throw new Error(`第 ${index + 1} 个 cut 转场时长必须为 0。`);
    if (type !== 'cut' && (duration <= 0 || duration >= Math.min(clips[index].duration, clips[index + 1].duration))) {
      throw new Error(`第 ${index + 1} 个转场时长必须大于 0，且小于相邻片段的较短时长。`);
    }
    return { type, duration };
  });
}

export function timelineDuration(clips, transitions = []) {
  const clipDuration = clips.reduce((sum, clip) => sum + clip.duration, 0);
  const overlap = transitions.reduce((sum, item) => sum + (item.type === 'cut' ? 0 : item.duration), 0);
  return Math.max(0, clipDuration - overlap);
}

export function normalizeOverlays(value, duration) {
  const source = value ?? [];
  if (!Array.isArray(source) || source.length > 20) throw new Error('overlays 必须是数组，且最多 20 条。');
  return source.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`第 ${index + 1} 条文字必须是对象。`);
    const text = String(item.text ?? '').replace(/[{}\\]/g, '').replace(/[\r\n]+/g, ' ').trim().slice(0, 200);
    if (!text) throw new Error(`第 ${index + 1} 条文字不能为空。`);
    const start = finite(item.start ?? 0, `第 ${index + 1} 条文字开始时间`, 0, duration);
    const end = finite(item.end ?? duration, `第 ${index + 1} 条文字结束时间`, 0, duration);
    if (end <= start) throw new Error(`第 ${index + 1} 条文字结束时间必须大于开始时间。`);
    const position = item.position ?? 'center';
    if (!OVERLAY_POSITIONS.includes(position)) throw new Error(`第 ${index + 1} 条文字位置不支持：${position}。`);
    const animation = item.animation ?? 'fade-in-out';
    if (!OVERLAY_ANIMATIONS.includes(animation)) throw new Error(`第 ${index + 1} 条文字动画不支持：${animation}。`);
    const fontSize = finite(item.fontSize ?? 56, `第 ${index + 1} 条文字字号`, 20, 120);
    const color = item.color ?? '#FFFFFF';
    if (typeof color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(color)) {
      throw new Error(`第 ${index + 1} 条文字颜色必须使用 #RRGGBB 格式。`);
    }
    return { text, start, end, position, animation, fontSize, color: color.toUpperCase() };
  });
}
