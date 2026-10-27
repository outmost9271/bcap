import fs from 'node:fs';
import { buildTuples } from '../core/tuples.mjs';
import { findSession } from '../core/session.mjs';
import { readJsonl } from '../util/fs.mjs';
import { log } from '../util/log.mjs';

export async function tuples({ args, config }) {
  const target = args._[0];
  if (!target) {
    log.err('用法: bcap tuples <会话ID|rrweb.jsonl> [--out <steps.jsonl>]');
    process.exit(1);
  }

  const session = findSession(config.outDir, target);
  const rrwebPath = target.endsWith('.jsonl') ? target : session?.path('rrweb.jsonl');
  const eventsPath = args.events || session?.path('events.jsonl');
  const tracePath = args.trace || session?.path('trace.zip');

  if (!rrwebPath || !fs.existsSync(rrwebPath)) {
    log.err('找不到 rrweb.jsonl：', target);
    process.exit(1);
  }

  const rrweb = readJsonl(rrwebPath);
  const events = eventsPath && fs.existsSync(eventsPath) ? readJsonl(eventsPath) : [];

  console.log('输入：');
  console.log('  rrweb :', rrwebPath);
  console.log('  events:', eventsPath && fs.existsSync(eventsPath) ? eventsPath : '（无）');
  console.log('  trace :', tracePath && fs.existsSync(tracePath) ? tracePath : '（无）');
  console.log('');

  const steps = buildTuples({
    events,
    rrweb,
    traceZip: tracePath && fs.existsSync(tracePath) ? tracePath : undefined,
  });

  const outPath =
    args.out || (session ? session.path('steps.jsonl') : rrwebPath.replace(/rrweb\.jsonl$/, 'steps.jsonl'));

  fs.writeFileSync(outPath, steps.map((s) => JSON.stringify(s)).join('\n') + '\n');

  console.log(`生成 ${steps.length} 个四元组：`);
  console.log('');
  console.log('  #  时间(ms)   动作      定位器                                      DOM 变化   网络');
  console.log('  ─  ─────────  ────────  ──────────────────────────────────────────  ─────────  ────');

  for (const s of steps) {
    const loc =
      s.action.type === 'change' || s.action.type === 'input'
        ? `= ${JSON.stringify(String(s.action.value ?? '').slice(0, 30))}`
        : s.action.selectorStable || s.action.selector || '';
    const diff = `+${s.domDiff.added.length}/-${s.domDiff.removed.length}`;
    console.log(
      `  ${String(s.step).padStart(2)}  ${String(s.t).padStart(9)}  ${s.action.type.padEnd(8)}  ${loc.slice(0, 40).padEnd(42)}  ${diff.padEnd(9)}  ${s.network.length}`,
    );
  }

  const interesting = steps.filter((s) => s.network.length > 0);
  if (interesting.length) {
    console.log('');
    console.log('涉及网络的步骤：');
    for (const s of interesting) {
      const label =
        s.action.type === 'change' || s.action.type === 'input'
          ? `= ${JSON.stringify(String(s.action.value ?? '').slice(0, 40))}`
          : s.action.text || s.action.selectorStable || s.action.type;
      console.log(`  [${s.step}] ${label}`);
      for (const n of s.network) {
        console.log(`      ${n.at >= 0 ? '+' : ''}${n.at}ms  ${n.method} ${n.status} ${n.url.slice(0, 90)}`);
      }
    }
  }

  console.log('');
  console.log('输出：', outPath);
}
