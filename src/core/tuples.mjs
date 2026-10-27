import { loadEvents, createReplay } from './rr-replay.mjs';
import { inspectTrace, readEntry } from '../util/trace-inspect.mjs';

/** 轮询、埋点、静态资源：不计入四元组的网络 */
const NOISE = [
  /\/vsysstatus/i,
  /\/statusmsg\.cgi/i,
  /\/updatecookie/i,
  /\/events(\?|$)/i,
  /\/log(\?|$)/i,
  /\/track(\?|$)/i,
  /\/beacon(\?|$)/i,
  /\/collect(\?|$)/i,
  /\/heartbeat/i,
  /\.(js|css|png|jpe?g|gif|svg|woff2?|ico|map)(\?|$)/i,
  /performance\.uedc\./i,
  /google-analytics|googletagmanager|sentry\.io/i,
];

const KEY_TYPES = new Set(['click', 'change', 'submit']);

const isNoise = (url) => NOISE.some((re) => re.test(url));

/** 自动生成的 ID 不能当稳定定位器 */
function isStableSelector(sel) {
  if (!sel) return false;
  if (/^#(sfext|ext-gen|comp-|gen\d)/i.test(sel)) return false;
  if (/^#\d+$/.test(sel)) return false;
  return true;
}

function stableLocator(ev) {
  const text = (ev.text || '').trim().replace(/\s+/g, ' ');
  if (text && text.length <= 30) return `text=${JSON.stringify(text)}`;
  if (isStableSelector(ev.sel)) return ev.sel;
  return null;
}

function extractText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, '\n')
    .split('\n')
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter((s) => s.length >= 2 && s.length <= 100)
    .filter((s) => !/^\d{1,2}:\d{2}(:\d{2})?$/.test(s))
    .filter((s) => !/^\d{4}-\d{2}-\d{2}/.test(s));
}

function diffText(before, after, limit = 12) {
  const b = new Set(extractText(before));
  const a = new Set(extractText(after));
  const added = [...a].filter((x) => !b.has(x));
  const removed = [...b].filter((x) => !a.has(x));
  return {
    added: added.slice(0, limit),
    removed: removed.slice(0, limit),
    truncated: added.length > limit || removed.length > limit,
  };
}

function extractHeading(html) {
  const m = html.match(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/i);
  if (!m) return null;
  const text = m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return text && text.length <= 60 ? text : null;
}

/** 从 events.jsonl 选关键动作，合并同一元素 800ms 内的重复 */
function pickActions(events) {
  const sorted = [...events].sort((a, b) => a.ts - b.ts);
  const out = [];
  const lastByKey = new Map();
  for (const ev of sorted) {
    if (!KEY_TYPES.has(ev.type)) continue;
    const key = `${ev.type}:${ev.sel}`;
    const prev = lastByKey.get(key);
    if (prev != null && ev.ts - prev < 800) continue;
    lastByKey.set(key, ev.ts);
    out.push(ev);
  }
  return out;
}

/** events.jsonl 缺失时，从 rrweb 的 mouse/input 事件兜底 */
function actionsFromRrweb(rrweb) {
  const out = [];
  for (const e of rrweb) {
    if (e.type !== 3) continue;
    const d = e.data || {};
    if (d.source === 2 && d.type === 2) {
      out.push({ type: 'click', ts: e.__t, sel: `node#${d.id}`, text: '', url: '' });
    } else if (d.source === 5) {
      out.push({ type: 'input', ts: e.__t, sel: `node#${d.id}`, text: '', value: d.text, url: '' });
    }
  }
  return out;
}

/** 从 trace.zip 读网络资源 */
function loadNetwork(zipPath) {
  if (!zipPath) return [];
  let entries;
  try {
    ({ entries } = inspectTrace(zipPath));
  } catch {
    return [];
  }
  const name = entries.find((n) => n.endsWith('.network'));
  if (!name) return [];

  const out = [];
  for (const line of readEntry(zipPath, name).split('\n').filter(Boolean)) {
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    const s = o.snapshot;
    if (!s?.request?.url) continue;
    const wallTime = Date.parse(s.startedDateTime);
    if (!Number.isFinite(wallTime)) continue;
    out.push({
      wallTime,
      method: s.request.method,
      url: s.request.url,
      status: s.response?.status ?? null,
      duration: Math.round(s.time || 0),
      size: s.response?.content?.size ?? null,
    });
  }
  return out;
}

/**
 * 生成四元组：动作 + 上下文 + DOM 变化 + 网络。
 *
 * @param {object} opts
 * @param {object[]} opts.events      events.jsonl 解析结果
 * @param {object[]} opts.rrweb       rrweb.jsonl 解析结果
 * @param {string} [opts.traceZip]    trace.zip 路径
 * @param {number} [opts.beforeGap]   动作前回看窗口（ms）
 * @param {number} [opts.afterGap]    动作后观察窗口（ms）
 * @param {number} [opts.netBefore]   网络向前对齐窗口（ms）
 * @param {number} [opts.netAfter]    网络向后对齐窗口（ms）
 */
export function buildTuples({
  events = [],
  rrweb = [],
  traceZip,
  beforeGap = 50,
  afterGap = 800,
  netBefore = 200,
  netAfter = 2000,
} = {}) {
  if (!rrweb.length) return [];

  const replay = createReplay(rrweb);

  // rrweb 自带 wall clock timestamp；__t 是 performance.now()
  const anchor = rrweb.find((e) => e.timestamp != null && e.__t != null);
  const timeOrigin = anchor ? anchor.timestamp - anchor.__t : 0;

  const network = loadNetwork(traceZip).map((n) => ({
    ...n,
    t: n.wallTime - timeOrigin,
  }));

  const actions = events.length ? pickActions(events) : actionsFromRrweb(rrweb);

  const steps = [];
  for (let i = 0; i < actions.length; i++) {
    const ev = actions[i];
    const t = ev.ts;
    const nextT = actions[i + 1]?.ts ?? t + netAfter;
    const netEnd = Math.min(t + netAfter, nextT);

    const before = replay.htmlAt(Math.max(0, t - beforeGap));
    const after = replay.htmlAt(t + afterGap);

    const diff = diffText(before, after);
    const related = network
      .filter(
        (n) =>
          n.t >= t - netBefore &&
          n.t <= netEnd &&
          !isNoise(n.url) &&
          (n.status == null || (n.status >= 200 && n.status < 400)),
      )
      .map((n) => ({
        at: Math.round(n.t - t),
        method: n.method,
        url: n.url,
        status: n.status,
        duration: n.duration,
        size: n.size,
      }));

    steps.push({
      step: steps.length + 1,
      t,
      action: {
        type: ev.type,
        text: ev.text || null,
        value: ev.value ?? null,
        selector: ev.sel || null,
        selectorStable: stableLocator(ev),
        stable: isStableSelector(ev.sel),
      },
      context: {
        url: ev.url || null,
        title: ev.title || null,
        heading: extractHeading(before),
        beforeText: extractText(before).slice(0, 8),
      },
      domDiff: diff,
      network: related,
    });
  }

  return steps;
}

export { loadEvents, loadNetwork, extractText, diffText };
