import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { createChecker, createTestPage } from './utils.mjs';
import { startRrRecorder } from '../src/core/recorder-rrweb.mjs';
import { buildTuples } from '../src/core/tuples.mjs';
import { loadEvents } from '../src/core/rr-replay.mjs';

const ENDPOINT = process.env.CDP_URL || 'http://192.168.133.1:9223';
const OUT = path.resolve('out/test-tuples');
fs.rmSync(OUT, { recursive: true, force: true });

const html = `<html><body>
<h1>tuple-test</h1>
<button id=btn onclick="addItem()">添加</button>
<input id=q>
<ul id=list></ul>
<script>
function addItem() {
  const li = document.createElement('li');
  li.textContent = '新条目-' + (document.querySelectorAll('#list li').length + 1);
  document.getElementById('list').appendChild(li);
  fetch('https://example.com/', { mode: 'no-cors' }).catch(function () {});
}
</script>
</body></html>`;

const { url: testUrl } = await createTestPage(ENDPOINT, html);

const rec = await startRrRecorder({
  endpoint: ENDPOINT,
  outDir: OUT,
  attachExisting: false,
  verbose: false,
});

const matches = rec.context.pages().filter((p) => p.url() === testUrl);
const target = matches[matches.length - 1];
if (!target) {
  console.error('[selftest-tuples] 找不到测试页');
  await rec.stop();
  process.exit(1);
}
await rec.attachPage(target);
await target.waitForTimeout(600);

console.log('[selftest-tuples] 点击 + 输入 + 失焦 ...');
await target.click('#btn');
await target.waitForTimeout(400);
await target.click('#q');
await target.keyboard.type('hello', { delay: 30 });
await target.locator('body').click({ position: { x: 5, y: 5 } }); // 触发 change
await target.waitForTimeout(1200);
await target.close().catch(() => {});

const { rrwebPath, eventsPath, tracePath, stats } = await rec.stop();
console.log('[selftest-tuples] stats:', JSON.stringify(stats));

const steps = buildTuples({
  events: loadEvents(eventsPath),
  rrweb: loadEvents(rrwebPath),
  traceZip: tracePath,
});

const { check, summary } = createChecker('[selftest-tuples]');

check(steps.length >= 2, `生成四元组 (${steps.length})`);
check(steps.every((s) => s.action && s.context && s.domDiff && s.network), '每条都含 4 个部分');

const clickStep = steps.find((s) => s.action.type === 'click' && (s.action.text || '').includes('添加'));
check(!!clickStep, '找到「添加」点击步骤');
if (clickStep) {
  check(clickStep.action.selectorStable?.includes('添加'), '有可读定位器');
  check(
    clickStep.domDiff.added.some((x) => x.includes('新条目-1')),
    'DOM diff 含新增的列表项',
  );
  check(clickStep.context.url === testUrl, 'context.url 正确');
  check(clickStep.context.title === null || clickStep.context.title === '', 'context.title 已采集');
}

const changeStep = steps.find((s) => s.action.type === 'change' && s.action.value === 'hello');
check(!!changeStep, '找到输入框 change 步骤');
if (changeStep) {
  check(!!changeStep.action.selectorStable, '输入框有稳定定位器');
}

const withNet = steps.filter((s) => s.network.length > 0);
console.log(
  '[selftest-tuples] 网络步骤:',
  withNet.map((s) => `${s.step}:${s.network.map((n) => n.method + ' ' + n.status).join(',')}`).join(' | ') || '无',
);
check(withNet.length >= 1, `至少一步关联到网络 (${withNet.length})`);

const failed = summary();
console.log('  steps :', steps.length);
console.log('  rrweb :', rrwebPath);
console.log('  events:', eventsPath);
process.exit(failed === 0 ? 0 : 1);
