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

const INJECT = buildInject({ rrweb: true });

/**
 * rrweb 增量方案。
 * DOM：rrweb（全量一次 + MutationObserver 增量）
 * 网络：Playwright tracing（snapshots 只留初始快照，用于激活 network 记录）
 * 可读操作：页面内事件监听
 */
export async function startRrRecorder({
  endpoint,
  outDir,
  attachExisting = true,
  verbose = true,
} = {}) {
  const { paths, streams } = createOutputSet(outDir, [
    { key: 'rrweb', prefix: 'rrweb', ext: '.jsonl' },
    { key: 'events', prefix: 'events', ext: '.jsonl' },
    { key: 'trace', prefix: 'trace', ext: '.zip' },
  ]);
  const rrwebPath = paths.rrweb;
  const eventsPath = paths.events;
  const tracePath = paths.trace;
  const { log, logErr } = makeLogger('rr', verbose);

  const stats = {
    pages: 0,
    rrEvents: 0,
    fullSnapshots: 0,
    incremental: 0,
    readableEvents: 0,
    rrBytes: 0,
  };

  const { browser, ctx } = await connect(endpoint, { log });

  function onPayload(page, payload) {
    let msg;
    try {
      msg = JSON.parse(payload);
    } catch {
      return;
    }

    if (msg.kind === 'rr' && Array.isArray(msg.batch)) {
      for (const e of msg.batch) {
        stats.rrEvents++;
        if (e.type === 2) stats.fullSnapshots++;
        else if (e.type === 3) stats.incremental++;
        const line = JSON.stringify(e) + '\n';
        stats.rrBytes += line.length;
        streams.rrweb.write(line);
      }
      return;
    }

    if (msg.kind === 'ev' && msg.event) {
      stats.readableEvents++;
      streams.events.write(JSON.stringify(msg.event) + '\n');
    }
  }

  const attached = new WeakSet();

  async function attach(page) {
    if (!page || attached.has(page) || page.isClosed()) return;
    attached.add(page);
    const ok = await attachPage(ctx, page, { initScript: INJECT, onPayload, log, logErr });
    if (ok) stats.pages++;
  }

  watchPages(ctx, attach);

  // snapshots 必须开，否则 Playwright 不记录 network；但我们从不触发 action，
  // 所以只会有 tracing.start 时的一次初始快照。
  await startTrace(ctx, { dom: true, aria: false, screen: false, screenshots: false });
  log('tracing started（network on, snapshots 仅初始一次）');

  if (attachExisting) for (const p of ctx.pages()) await attach(p);

  let stopping = false;
  async function stop() {
    if (stopping) return { rrwebPath, eventsPath, tracePath, stats };
    stopping = true;

    // 给页面一次 flush 机会（后台 tab 的定时器可能被节流）
    for (const p of ctx.pages?.() || []) {
      await p
        .evaluate(() => {
          try { window.__capFlush && window.__capFlush(); } catch {}
        })
        .catch(() => {});
      await p
        .evaluate(() => {
          try { window.__capRrStop && window.__capRrStop(); } catch {}
        })
        .catch(() => {});
    }
    await new Promise((r) => setTimeout(r, 300));

    await stopTrace(ctx, tracePath, { log, logErr });
    await closeStreams(streams);
    await browser.close().catch(() => {});

    log('rrweb saved:', rrwebPath, `${(stats.rrBytes / 1024).toFixed(1)}KB`);
    log('events saved:', eventsPath);
    log('stats:', JSON.stringify(stats));
    return { rrwebPath, eventsPath, tracePath, stats };
  }

  return {
    browser,
    context: ctx,
    rrwebPath,
    eventsPath,
    tracePath,
    stats,
    stop,
    attachPage: attach,
  };
}
