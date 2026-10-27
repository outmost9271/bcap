import fs from 'node:fs';
import path from 'node:path';
import { createChecker } from './utils.mjs';
import { inspectTrace } from '../src/util/trace-inspect.mjs';
import { chromium } from 'playwright-core';

const ENDPOINT = process.env.CDP_URL || 'http://192.168.133.1:9223';
const OUT_DIR = path.resolve('out/test-rrweb');
fs.rmSync(OUT_DIR, { recursive: true, force: true });

// 先建独立测试页，避免给用户页面注入 rrweb
const probe = await chromium.connectOverCDP(ENDPOINT, { timeout: 15000 });
const ctx0 = probe.contexts()[0];
const testPage = await ctx0.newPage();
await testPage.goto(
  'data:text/html,<html><body style="margin:0"><h1>rr-selftest</h1>' +
    '<button id=btn onclick="document.getElementById(\'out\').textContent=\'clicked\'">go</button>' +
    '<ul id=list></ul><div id=out></div>' +
    '<script>setTimeout(()=>{const li=document.createElement("li");li.textContent="async-item";document.getElementById("list").appendChild(li)},800)</script>' +
    '</body></html>',
  { waitUntil: 'domcontentloaded' },
);
const testUrl = testPage.url();
await probe.close();

const { startRrRecorder } = await import('../src/core/recorder-rrweb.mjs');
const rec = await startRrRecorder({
  endpoint: ENDPOINT,
  outDir: OUT_DIR,
  attachExisting: false,
  verbose: true,
});

const matches = rec.context.pages().filter((p) => p.url() === testUrl);
const target = matches[matches.length - 1];
if (!target) {
  console.error('[selftest-rr] 找不到测试页');
  await rec.stop();
  process.exit(1);
}
await rec.attachPage(target);

// 等第一个 full snapshot
await target.waitForTimeout(400);

console.log('[selftest-rr] 点击 + 输入 ...');
await target.click('#btn');
await target.evaluate(() => {
  const i = document.createElement('input');
  i.id = 'q';
  document.body.appendChild(i);
  i.focus();
});
await target.keyboard.type('hello', { delay: 30 });
await target.waitForTimeout(1200); // 等异步 DOM 变化（setTimeout 800ms）

await target.close().catch(() => {});
const { rrwebPath, eventsPath, stats } = await rec.stop();

console.log('[selftest-rr] stats:', JSON.stringify(stats));

// ---- 断言 ----
const { check, summary } = createChecker('[selftest-rr]');

check(fs.existsSync(rrwebPath), 'rrweb.jsonl 已生成');
check(fs.existsSync(eventsPath), 'events.jsonl 已生成');
check(stats.fullSnapshots >= 1, `有 FullSnapshot (${stats.fullSnapshots})`);
check(stats.incremental >= 5, `有增量事件 (${stats.incremental})`);

const evs = fs.readFileSync(rrwebPath, 'utf8').split('\n').filter(Boolean).map(JSON.parse);
const inc = evs.filter((e) => e.type === 3);
const sources = [...new Set(inc.map((e) => e.data?.source))].sort();
console.log('[selftest-rr] incremental sources:', sources.join(', '));
check(sources.includes(0), '含 DOM mutation (source=0)');
check(sources.includes(5), '含 input (source=5)');
check(sources.includes(2), '含 mouse interaction (source=2)');

// 重建
const { loadEvents, createReplay } = await import('../src/core/rr-replay.mjs');
const replay = createReplay(loadEvents(rrwebPath));
const finalHtml = replay.htmlAt(Infinity);
check(finalHtml.length > 50, `重建出 HTML (${finalHtml.length} bytes)`);
check(finalHtml.includes('clicked'), '重建 HTML 含点击后的内容');
check(finalHtml.includes('async-item'), '重建 HTML 含异步新增的节点');
check(finalHtml.includes('<input'), '重建 HTML 含动态创建的 input');
check(finalHtml.includes('value="hello"') || finalHtml.includes('hello'), '重建 HTML 含输入值');

const early = replay.htmlAt(500);
check(!early.includes('async-item'), '时间点 0 不含后来的异步节点（时间轴正确）');

// 网络
const { hasNetwork, networkLines } = inspectTrace(rec.tracePath);
check(hasNetwork, `trace.zip 内含 trace.network (${networkLines} 条)`);

// 可读事件
const readable = fs.readFileSync(eventsPath, 'utf8').split('\n').filter(Boolean).map(JSON.parse);
check(readable.some((e) => e.type === 'click' && e.sel?.includes('#btn')), '可读事件命中 #btn');

const failed = summary();
console.log('  rrweb :', rrwebPath);
console.log('  events:', eventsPath);
process.exit(failed === 0 ? 0 : 1);
