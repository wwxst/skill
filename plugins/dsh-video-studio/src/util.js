import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { VideoStudioError } from './errors.js';

export const id = (prefix) => `${prefix}_${randomUUID().replaceAll('-', '').slice(0, 12)}`;

export function safeSegment(value, label = '名称') {
  if (typeof value !== 'string' || !value.trim()) {
    throw new VideoStudioError(`${label}不能为空。`, 'INVALID_ARGUMENT');
  }
  const cleaned = value.trim().replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  if (!cleaned || cleaned === '.' || cleaned === '..') {
    throw new VideoStudioError(`${label}包含无效字符。`, 'INVALID_ARGUMENT');
  }
  return cleaned;
}

export function assertId(value, prefix, label = 'ID') {
  if (typeof value !== 'string' || !new RegExp(`^${prefix}_[a-f0-9]{12}$`).test(value)) {
    throw new VideoStudioError(`${label}格式不正确。`, 'INVALID_ARGUMENT');
  }
  return value;
}

export async function ensureDir(path) {
  await mkdir(path, { recursive: true });
  return path;
}

export async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

export async function writeJsonAtomic(path, value) {
  await ensureDir(dirname(path));
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temporary, path);
}

export function isInside(parent, child) {
  const rel = relative(resolve(parent), resolve(child));
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
}

export function requireFinite(value, name, { min = -Infinity, max = Infinity, optional = false } = {}) {
  if (optional && value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new VideoStudioError(`${name}必须是 ${min} 到 ${max} 之间的数字。`, 'INVALID_ARGUMENT');
  }
  return value;
}

export function parseAllowedRoots(config = {}) {
  const env = process.env.DSH_VIDEO_STUDIO_ALLOWED_ROOTS;
  const configured = Array.isArray(config.allowedRoots) ? config.allowedRoots : [];
  const envRoots = env ? env.split(process.platform === 'win32' ? ';' : ':').filter(Boolean) : [];
  const roots = [...configured, ...envRoots, process.cwd()];
  return [...new Set(roots.map((root) => resolve(String(root).replace(/^~(?=$|[\\/])/, process.env.HOME || process.env.USERPROFILE || ''))))];
}
