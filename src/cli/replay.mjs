import fs from 'node:fs';
import { createReplay } from '../core/rr-replay.mjs';
import { findSession } from '../core/session.mjs';
import { readJsonl } from '../util/fs.mjs';
import { log } from '../util/log.mjs';

export async function replay({ args, config }) {
  const target = args._[0];
  if (!target) {
    log.err('用法: bcap replay <会话ID|rrweb.jsonl> [--list] [--at <ms>]');
    process.exit(1);
  }

  const session = findSession(config.outDir, target);
  const file = target.endsWith('.jsonl') ? target : session?.path('rrweb.jsonl');

  if (!file || !fs.existsSync(file)) {
    log.err('找不到 rrweb.jsonl：', target);
    process.exit(1);
  }

  const events = readJsonl(file);
  if (!events.length) {
    log.err('没有解析到事件：', file);
    process.exit(1);
  }

  const engine = createReplay(events);

  if (args.list) {
    const frames = engine.keyframes();
    const counts = frames.reduce((m, f) => ((m[f.kind] = (m[f.kind] || 0) + 1), m), {});
    console.log('事件数:', events.length, '| 分类:', JSON.stringify(counts));
    console.log('');
    console.log('时间(ms)   类型            详情');
    console.log('---------  --------------  ------------------------------------------');

    let shown = 0;
    for (const f of frames) {
      if (f.kind === 'mutation') continue;
      const detail =
        f.kind === 'full-snapshot'
          ? ''
          : f.kind === 'input'
            ? `node#${f.nodeId} text=${JSON.stringify(String(f.text ?? '').slice(0, 40))}`
            : `node#${f.nodeId} action=${f.action}`;
      console.log(`${String(f.t).padStart(9)}  ${f.kind.padEnd(14)}  ${detail}`);
      if (++shown > 200) {
        console.log('... (截断)');
        break;
      }
    }
    return;
  }

  const at = args.at !== undefined ? Number(args.at) : Infinity;
  process.stdout.write(engine.htmlAt(at));
}
