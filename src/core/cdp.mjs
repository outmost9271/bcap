import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

/** 带前缀的日志器 */
export function makeLogger(tag, verbose = true) {
  return {
    log: (...a) => verbose && console.log(`[${tag}]`, ...a),
    logErr: (...a) => console.error(`[${tag}]`, ...a),
  };
}

/** 连接 CDP，返回 { browser, ctx } */
export async function connect(endpoint, { log } = {}) {
  const browser = await chromium.connectOverCDP(endpoint, { timeout: 15000 });
  const ctx = browser.contexts()[0];
  log?.('connected', browser.version(), '| contexts:', browser.contexts().length);
  return { browser, ctx };
}

/**
 * 创建输出文件集合。
 * @param {string} outDir
 * @param {{key:string, prefix:string, ext:string}[]} specs
 * @returns {{stamp:string, paths:Record<string,string>, streams:Record<string,fs.WriteStream>}}
 */
export function createOutputSet(dir, specs) {
  fs.mkdirSync(dir, { recursive: true });
  const paths = {};
  const streams = {};
  for (const { key, prefix, ext } of specs) {
    paths[key] = path.join(dir, `${prefix}${ext}`);
    if (ext !== '.zip') {
      streams[key] = fs.createWriteStream(paths[key], { flags: 'a' });
    }
  }
  return { paths, streams };
}

/**
 * 把一个页面挂到录制器上：
 * Runtime.addBinding + addScriptToEvaluateOnNewDocument + 当前文档补注入。
 * @returns {Promise<boolean>} 是否成功
 */
export async function attachPage(
  ctx,
  page,
  { initScript, onPayload, bindingName = '__cap', log, logErr } = {},
) {
  if (!page || page.isClosed()) return false;
  try {
    const session = await ctx.newCDPSession(page);
    await session.send('Runtime.enable');
    await session.send('Runtime.addBinding', { name: bindingName });
    await session.send('Page.addScriptToEvaluateOnNewDocument', {
      source: initScript,
    });
    session.on('Runtime.bindingCalled', (e) => {
      if (e.name === bindingName) onPayload?.(page, e.payload);
    });
    // 已打开的 document 立即注入，不需要刷新
    await page
      .evaluate(initScript)
      .catch((e) => logErr?.('inject failed:', page.url().slice(0, 60), e?.message || e));
    log?.('attached', page.url().slice(0, 90));
    return true;
  } catch (e) {
    logErr?.('attach failed:', page.url().slice(0, 80), e?.message || e);
    return false;
  }
}

/** 监听新页面，用 attach 回调处理 */
export function watchPages(ctx, attach) {
  ctx.on('page', (p) => attach(p).catch(() => {}));
}

/** 启动 tracing。snapshots=false 时 Playwright 不会记录 network，调用方注意。 */
export async function startTrace(ctx, { dom = true, aria = false, screen = false, screenshots = false } = {}) {
  await ctx.tracing.start({
    snapshots: dom ? { dom: true, aria, screen } : false,
    screenshots,
    sources: false,
  });
}

/** 停止 tracing 并写出 zip，失败不抛 */
export async function stopTrace(ctx, tracePath, { log, logErr } = {}) {
  try {
    await ctx.tracing.stop({ path: tracePath });
    log?.('trace saved:', tracePath);
  } catch (e) {
    logErr?.('tracing.stop failed:', e?.message || e);
  }
}

/** 关闭所有输出流 */
export async function closeStreams(streams) {
  for (const s of Object.values(streams)) {
    await new Promise((r) => s.end(r));
  }
}
