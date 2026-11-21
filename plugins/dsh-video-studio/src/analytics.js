import path from 'node:path';
import { ensureDir, id, readJson, writeJsonAtomic } from './util.js';
import { VideoStudioError } from './errors.js';

const METRICS = ['views', 'likes', 'comments', 'shares', 'saves', 'profileVisits', 'follows', 'conversions'];

function metric(value, name) {
  const number = Number(value ?? 0);
  if (!Number.isSafeInteger(number) || number < 0 || number > 1_000_000_000_000) {
    throw new VideoStudioError(name + ' 必须是 0 到 1 万亿之间的整数。', 'INVALID_METRIC');
  }
  return number;
}

export function createPerformanceStore(dataDir) {
  const directory = path.join(dataDir, 'analytics');
  const filePath = path.join(directory, 'performance.json');
  let chain = Promise.resolve();

  async function initialize() {
    await ensureDir(directory);
    try { await readJson(filePath); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await writeJsonAtomic(filePath, { version: 1, records: [] });
    }
  }

  async function read() {
    try {
      const data = await readJson(filePath);
      if (!Array.isArray(data.records)) throw new Error('records must be an array');
      return data;
    } catch (error) {
      if (error.code === 'ENOENT') return { version: 1, records: [] };
      throw new VideoStudioError('TikTok 数据反馈文件损坏：' + error.message, 'ANALYTICS_STORE_INVALID');
    }
  }

  async function mutate(fn) {
    const current = chain.catch(() => {}).then(async () => {
      const data = await read();
      const result = await fn(data);
      await writeJsonAtomic(filePath, data);
      return result;
    });
    chain = current;
    return current;
  }

  async function record(input = {}) {
    if (typeof input.projectId !== 'string' || !/^vs_[a-f0-9]{12}$/.test(input.projectId)) {
      throw new VideoStudioError('记录发布数据必须提供有效的 projectId。', 'INVALID_ARGUMENT');
    }
    const accountType = input.accountType ?? 'acquisition';
    if (!['acquisition', 'mid-video', 'other'].includes(accountType)) throw new VideoStudioError('accountType 只能是 acquisition、mid-video 或 other。', 'INVALID_ARGUMENT');
    const objective = String(input.objective || (accountType === 'mid-video' ? 'traffic' : 'acquisition')).slice(0, 80);
    const postedAt = input.postedAt ? new Date(input.postedAt) : new Date();
    if (Number.isNaN(postedAt.getTime())) throw new VideoStudioError('postedAt 日期格式无效。', 'INVALID_ARGUMENT');
    const availableMetrics = Array.isArray(input.availableMetrics)
      ? [...new Set(input.availableMetrics.filter((name) => METRICS.includes(name)))]
      : METRICS.filter((name) => input[name] !== undefined && input[name] !== null);
    if (!availableMetrics.length) throw new VideoStudioError('至少需要提供一项真实发布指标。', 'INVALID_METRIC');
    const metrics = Object.fromEntries(METRICS.map((name) => [name, metric(input[name], name)]));
    const record = {
      id: id('perf'),
      projectId: input.projectId,
      accountType,
      objective,
      topic: String(input.topic || '').slice(0, 300),
      hookType: String(input.hookType || '').slice(0, 100),
      cta: String(input.cta || '').slice(0, 160),
      templateId: input.templateId ? String(input.templateId).slice(0, 80) : null,
      postUrl: input.postUrl ? String(input.postUrl).slice(0, 1000) : null,
      platformVideoId: input.platformVideoId ? String(input.platformVideoId).slice(0, 80) : null,
      source: input.source ? String(input.source).slice(0, 80) : 'manual',
      availableMetrics,
      postedAt: postedAt.toISOString(),
      metrics,
      createdAt: new Date().toISOString(),
    };
    return mutate(async (data) => {
      data.records.push(record);
      return record;
    });
  }

  async function summary({ groupBy = 'objective', accountType, from, to, limit = 50 } = {}) {
    const allowedGroups = ['objective', 'accountType', 'topic', 'hookType', 'templateId'];
    if (!allowedGroups.includes(groupBy)) throw new VideoStudioError('groupBy 参数无效。', 'INVALID_ARGUMENT');
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new VideoStudioError('limit 必须是 1–200。', 'INVALID_ARGUMENT');
    const fromTime = from ? new Date(from).getTime() : -Infinity;
    const toTime = to ? new Date(to).getTime() : Infinity;
    if (Number.isNaN(fromTime) || Number.isNaN(toTime) || fromTime > toTime) throw new VideoStudioError('数据统计时间范围无效。', 'INVALID_ARGUMENT');
    const data = await read();
    const records = data.records.filter((item) =>
      (!accountType || item.accountType === accountType)
      && new Date(item.postedAt).getTime() >= fromTime
      && new Date(item.postedAt).getTime() <= toTime,
    );
    const groups = new Map();
    for (const item of records) {
      const key = String(item[groupBy] ?? '(未填写)');
      if (!groups.has(key)) groups.set(key, {
        key,
        sampleCount: 0,
        metrics: Object.fromEntries(METRICS.map((name) => [name, 0])),
        metricSampleCounts: Object.fromEntries(METRICS.map((name) => [name, 0])),
      });
      const group = groups.get(key);
      group.sampleCount += 1;
      const available = Array.isArray(item.availableMetrics) ? item.availableMetrics : METRICS;
      for (const name of METRICS) {
        if (available.includes(name)) {
          group.metrics[name] += item.metrics[name] || 0;
          group.metricSampleCounts[name] += 1;
        }
      }
    }
    const result = [...groups.values()].map((group) => {
      const views = group.metrics.views;
      const hasViews = group.metricSampleCounts.views > 0 && views > 0;
      const engagementMetrics = ['likes', 'comments', 'shares', 'saves'].filter((name) => group.metricSampleCounts[name] > 0);
      const engagement = engagementMetrics.reduce((sum, name) => sum + group.metrics[name], 0);
      const hasFollows = group.metricSampleCounts.follows > 0;
      const hasConversions = group.metricSampleCounts.conversions > 0;
      return {
        ...group,
        availableMetrics: METRICS.filter((name) => group.metricSampleCounts[name] > 0),
        engagementRate: hasViews && engagementMetrics.length ? Number((engagement / views).toFixed(4)) : null,
        followRate: hasViews && hasFollows ? Number((group.metrics.follows / views).toFixed(4)) : null,
        conversionRate: hasViews && hasConversions ? Number((group.metrics.conversions / views).toFixed(4)) : null,
      };
    }).sort((a, b) => b.metrics.views - a.metrics.views).slice(0, limit);
    return {
      groupBy,
      accountType: accountType || null,
      sampleCount: records.length,
      groups: result,
      note: '统计仅基于已录入的真实发布数据；样本不足时不要把比例当作稳定结论。',
    };
  }

  return { initialize, record, summary, list: async () => (await read()).records };
}
