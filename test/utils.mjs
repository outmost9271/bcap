import { chromium } from 'playwright-core';

/** 统一的断言计数器 */
export function createChecker(prefix = '[test]') {
  let failed = 0;
  const check = (cond, msg) => {
    console.log(cond ? `  PASS  ${msg}` : `  FAIL  ${msg}`);
    if (!cond) failed++;
  };
  const summary = () => {
    console.log('');
    console.log(failed === 0 ? `${prefix} 全部通过` : `${prefix} ${failed} 项失败`);
    return failed;
  };
  return { check, summary, get failed() { return failed; } };
}

/**
 * 用一个独立 tab 打开 data URL 测试页，返回 url 后断开连接。
 * 调用方重新连接后可用 url 找回这个 tab。
 */
export async function createTestPage(endpoint, html) {
  const browser = await chromium.connectOverCDP(endpoint, { timeout: 15000 });
  const ctx = browser.contexts()[0];
  const page = await ctx.newPage();
  await page.goto(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`, {
    waitUntil: 'domcontentloaded',
  });
  const url = page.url();
  await browser.close();
  return { url };
}

/** 关闭所有匹配的 tab（测试清理用） */
export async function closePages(endpoint, predicate) {
  const browser = await chromium.connectOverCDP(endpoint, { timeout: 15000 });
  const ctx = browser.contexts()[0];
  const closed = [];
  for (const p of ctx.pages()) {
    if (predicate(p.url())) {
      try {
        await p.close();
        closed.push(p.url());
      } catch {}
    }
  }
  await browser.close();
  return closed;
}
