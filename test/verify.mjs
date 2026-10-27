import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { inspectTrace } from '../src/util/trace-inspect.mjs';

const ENDPOINT = process.env.CDP_URL || 'http://192.168.133.1:9223';
const OUT = path.resolve('out/test-verify');
fs.mkdirSync(OUT, { recursive: true });
const tracePath = path.join(OUT, 'verify.zip');

const log = (...a) => console.log('[verify]', ...a);

let browser;
try {
  const t0 = Date.now();
  browser = await chromium.connectOverCDP(ENDPOINT, { timeout: 15000 });
  log('connected', browser.version(), `${Date.now() - t0}ms`);

  const contexts = browser.contexts();
  log('contexts:', contexts.length);
  const ctx = contexts[0];
  globalThis.__ctx = ctx;
  log('existing pages:', ctx.pages().map((p) => p.url()));

  // 用新 tab 验证，避免影响用户已打开的页面；用 data URL 避免外网依赖
  const page = await ctx.newPage();
  await page.goto(
    'data:text/html,<html><body><h1>capture-verify</h1><button id=b>ok</button></body></html>',
    { waitUntil: 'domcontentloaded', timeout: 15000 },
  );
  log('test page:', page.url(), '| title:', await page.title());

  await ctx.tracing.start({ snapshots: true, screenshots: true, sources: false });
  log('tracing started');

  // 关键验证：trial action 是否产生快照
  await page.locator('html').click({ trial: true, force: true, timeout: 2000 });
  log('trial click ok');

  await page.waitForTimeout(500);
  await ctx.tracing.stop({ path: tracePath });
  log('tracing stopped, size =', fs.statSync(tracePath).size);

  await page.close();
} catch (e) {
  console.error('[verify] FAILED:', e?.message || e);
  if (e?.stack) console.error(e.stack);
  // 即使中途失败也落一份 trace，方便排查
  try {
    await globalThis.__ctx?.tracing.stop({ path: tracePath });
    log('fallback trace written');
  } catch {}
} finally {
  if (browser) await browser.close().catch(() => {});
}

// ---- 检查产物 ----
if (!fs.existsSync(tracePath)) {
  log('no trace.zip produced');
  process.exit(1);
}

const { entries, counts, networkLines } = inspectTrace(tracePath);
log('zip entries:', entries.join(', '));
log('trace events:', JSON.stringify(counts));
log('network lines:', networkLines);
