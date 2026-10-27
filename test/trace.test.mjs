import fs from 'node:fs';
import path from 'node:path';
import { createChecker } from './utils.mjs';
import { inspectTrace } from '../src/util/trace-inspect.mjs';
import { chromium } from 'playwright-core';

const ENDPOINT = process.env.CDP_URL || 'http://192.168.133.1:9223';
const OUT_DIR = path.resolve('out/test-trace');

fs.rmSync(OUT_DIR, { recursive: true, force: true });

// 先建一个独立 tab，避免在用户页面上做自测
const probe = await chromium.connectOverCDP(ENDPOINT, { timeout: 15000 });
const ctx0 = probe.contexts()[0];
const testPage = await ctx0.newPage();
await testPage.goto(
  'data:text/html,<html><body style="margin:0"><h1>capture-selftest</h1>' +
    '<button id=btn style="width:200px;height:60px" ' +
    'onclick="document.getElementById(\'out\').textContent=\'clicked\'">go</button>' +
    '<div id=out></div></body></html>',
  { waitUntil: 'domcontentloaded' },
);
const testUrl = testPage.url();
await probe.close();

const { startRecorder } = await import('../src/core/recorder-trace.mjs');
const rec = await startRecorder({
  endpoint: ENDPOINT,
  outDir: OUT_DIR,
  verbose: true,
  screenshots: true,
  screen: true,
  snapshotGap: 120,
  debounce: 350,
});

// 找到刚才那个测试页并模拟一次真实点击
const matches = rec.context.pages().filter((p) => p.url() === testUrl);
const target = matches[matches.length - 1];
if (!target) {
  console.error('[selftest] 找不到测试页');
  await rec.stop();
  process.exit(1);
}
await rec.attachPage(target);

console.log('[selftest] 模拟 pointerdown + click ...');
const box = await target.locator('#btn').boundingBox();
await target.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

// 模拟输入（走 debounce 通道）
console.log('[selftest] 模拟 input ...');
await target.evaluate(() => {
  const i = document.createElement('input');
  i.id = 'q';
  document.body.appendChild(i);
  i.focus();
});
await target.keyboard.type('hello', { delay: 30 });

await target.waitForTimeout(2500);

await target.close().catch(() => {});
const { tracePath, eventsPath, stats } = await rec.stop();

console.log('[selftest] stats:', JSON.stringify(stats));

// ---- 断言 ----
const { check, summary } = createChecker('[selftest]');

check(fs.existsSync(tracePath), 'trace.zip 已生成');
check(fs.existsSync(eventsPath), 'events.jsonl 已生成');

const events = fs
  .readFileSync(eventsPath, 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l));
console.log('[selftest] event types:', [...new Set(events.map((e) => e.type))].join(', '));

check(stats.events > 0, `采集到事件 (${stats.events})`);
check(events.some((e) => e.type === 'pointerdown'), '捕获 pointerdown');
check(events.some((e) => e.type === 'click'), '捕获 click');
check(events.some((e) => e.type === 'keydown'), '捕获 keydown');
check(events.some((e) => e.sel && e.sel.includes('#btn')), '选择器命中 #btn');
check(stats.snapshots > 0, `触发快照 (${stats.snapshots})`);

const { counts } = inspectTrace(tracePath);
console.log('[selftest] trace events:', JSON.stringify(counts));

check((counts['frame-snapshot'] || 0) >= 3, `trace 含 frame-snapshot (${counts['frame-snapshot'] || 0})`);
check((counts.before || 0) >= 1, `trace 含 before (${counts.before || 0})`);
check((counts.after || 0) >= 1, `trace 含 after (${counts.after || 0})`);
check((counts['screencast-frame'] || 0) >= 1, `trace 含 screencast-frame (${counts['screencast-frame'] || 0})`);

const failed = summary();
console.log('  trace :', tracePath);
console.log('  events:', eventsPath);
process.exit(failed === 0 ? 0 : 1);
