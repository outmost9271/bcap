import {
  connect,
  createOutputSet,
  attachPage,
  watchPages,
  startTrace,
  stopTrace,
  closeStreams,
  makeLogger,
} from './cdp.mjs';
import { buildInject } from './inject.mjs';

const DEBOUNCED = new Set(['input', 'keydown']);
const INJECT = buildInject({ traceTrigger: true });

/**
 * Playwright trace 方案：离散全量快照。
 * DOM 快照由 trial hover 触发，网络由 tracing 自动记录。
 *
 * @param {object} opts
 * @param {string} opts.endpoint  CDP 端点
 * @param {string} opts.outDir    输出目录
 * @param {number} [opts.snapshotGap] 同一页面两次快照触发的最小间隔（ms）
 * @param {number} [opts.debounce]    input/keydown 的合并窗口（ms）
 * @param {boolean} [opts.screenshots] 每个 action 抓截图（开销大）
 * @param {boolean} [opts.screen]     连续 screencast 帧（开销最大）
 * @param {boolean} [opts.aria]       ARIA 快照（大页面开销明显）
 * @param {boolean} [opts.dom]        是否启用 DOM 快照
 * @param {string[]} [opts.snapshotTypes] 哪些事件触发快照
 * @param {boolean} [opts.verbose]
 */
export async function startRecorder({
  endpoint,
  outDir,
  snapshotGap = 1500,
  debounce = 1500,
  screenshots = false,
  screen = false,
  aria = false,
  dom = true,
  snapshotTypes = ['click', 'change', 'submit', '__snapshot__'],
  verbose = true,
} = {}) {
  const { paths, streams } = createOutputSet(outDir, [
    { key: 'trace', prefix: 'trace', ext: '.zip' },
    { key: 'events', prefix: 'events', ext: '.jsonl' },
  ]);
  const tracePath = paths.trace;
  const eventsPath = paths.events;
  const { log, logErr } = makeLogger('capture', verbose);

  const stats = { pages: 0, events: 0, snapshots: 0, skipped: 0, snapshotMs: 0 };

  const { browser, ctx } = await connect(endpoint, { log });

  // ---------- 快照触发 ----------
  const lastSnapshotAt = new WeakMap();
  const inFlight = new WeakSet();
  const debounceTimers = new WeakMap();

  function triggerSnapshot(page, reason) {
    if (!page || page.isClosed()) return;
    if (inFlight.has(page)) {
      stats.skipped++;
      return;
    }
    const now = Date.now();
    const last = lastSnapshotAt.get(page) || 0;
    if (now - last < snapshotGap) {
      stats.skipped++;
      return;
    }
    lastSnapshotAt.set(page, now);
    inFlight.add(page);
    stats.snapshots++;
    const t0 = Date.now();
    log(`snapshot <- ${reason}`);
    // trial hover：走完整 action 流程（产生 before/after 快照），但不派发真实交互。
    // 实测比 trial click 轻一半（hover 不做 hit-target 检查）。
    page
      .locator('html')
      .hover({ trial: true, force: true, timeout: 80 })
      .catch(() => {})
      .finally(() => {
        stats.snapshotMs += Date.now() - t0;
        inFlight.delete(page);
      });
  }

  function onPayload(page, payload) {
    let msg;
    try {
      msg = JSON.parse(payload);
    } catch {
      return;
    }
    const ev = msg.event || msg;

    stats.events++;
    streams.events.write(JSON.stringify(ev) + '\n');

    if (!snapshotTypes.includes(ev.type)) {
      stats.skipped++;
      return;
    }

    if (DEBOUNCED.has(ev.type)) {
      const prev = debounceTimers.get(page);
      if (prev) clearTimeout(prev);
      debounceTimers.set(
        page,
        setTimeout(() => {
          debounceTimers.delete(page);
          triggerSnapshot(page, 'input-debounce');
        }, debounce),
      );
    } else {
      triggerSnapshot(page, ev.type);
    }
  }

  // ---------- 逐页注入 ----------
  const attached = new WeakSet();

  async function attach(page) {
    if (!page || attached.has(page) || page.isClosed()) return;
    attached.add(page);
    const ok = await attachPage(ctx, page, { initScript: INJECT, onPayload, log, logErr });
    if (ok) stats.pages++;
  }

  watchPages(ctx, attach);

  // ---------- 开录 ----------
  await startTrace(ctx, { dom, aria, screen, screenshots });
  log(
    'tracing started |',
    `dom=${dom ? 'on' : 'off'} aria=${aria ? 'on' : 'off'} screen=${screen ? 'on' : 'off'} screenshots=${screenshots ? 'on' : 'off'}`,
  );

  for (const p of ctx.pages()) await attach(p);

  // ---------- 停止 ----------
  let stopping = false;
  async function stop() {
    if (stopping) return { tracePath, eventsPath, stats };
    stopping = true;
    for (const p of ctx.pages?.() || []) {
      const t = debounceTimers.get(p);
      if (t) clearTimeout(t);
    }
    await stopTrace(ctx, tracePath, { log, logErr });
    await closeStreams(streams);
    await browser.close().catch(() => {});
    log('events saved:', eventsPath);
    log('stats:', JSON.stringify(stats));
    return { tracePath, eventsPath, stats };
  }

  return {
    browser,
    context: ctx,
    tracePath,
    eventsPath,
    stats,
    stop,
    triggerSnapshot,
    attachPage: attach,
  };
}
