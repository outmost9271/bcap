import fs from 'node:fs';
import path from 'node:path';
import { listSessions } from '../core/session.mjs';
import { humanDuration, humanSize } from '../util/fs.mjs';
import { log } from '../util/log.mjs';

export async function list({ args, config }) {
  const sessions = listSessions(config.outDir);

  if (args.json) {
    console.log(JSON.stringify(sessions, null, 2));
    return;
  }

  if (!sessions.length) {
    log.dim(`还没有录制（${config.outDir}）`);
    return;
  }

  const rows = sessions.map((s) => {
    const stats = s.stats || {};
    let bytes = 0;
    for (const f of ['rrweb.jsonl', 'events.jsonl', 'trace.zip', 'steps.jsonl']) {
      try {
        bytes += fs.statSync(path.join(s.dir, f)).size;
      } catch {}
    }
    return {
      id: s.id,
      mode: s.mode || '-',
      duration: humanDuration(s.durationMs),
      events: stats.rrEvents ?? stats.events ?? 0,
      size: humanSize(bytes),
      page: String(s.pages?.[0] || '').replace(/^https?:\/\//, '').slice(0, 46),
    };
  });

  const header = ['ID', '模式', '时长', '事件', '大小', '页面'];
  console.log(header[0].padEnd(18), header[1].padEnd(7), header[2].padEnd(7), header[3].padEnd(6), header[4].padEnd(9), header[5]);
  console.log('─'.repeat(18), '─'.repeat(7), '─'.repeat(7), '─'.repeat(6), '─'.repeat(9), '─'.repeat(30));
  for (const r of rows) {
    console.log(
      r.id.padEnd(18),
      r.mode.padEnd(7),
      r.duration.padEnd(7),
      String(r.events).padEnd(6),
      r.size.padEnd(9),
      r.page,
    );
  }
}
