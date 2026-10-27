import readline from 'node:readline';
import { log } from '../util/log.mjs';

/** 录制 CLI 通用骨架：启动、banner、信号、duration、stdin stop、收尾 */
export async function runRecorder({ start, session, duration = 0, banner, summary }) {
  let rec;
  try {
    rec = await start();
  } catch (e) {
    log.err('启动失败：', e?.message || e);
    session.finish({ stats: { error: String(e?.message || e) } });
    process.exit(2);
  }

  if (banner) log.raw(banner(rec, session));

  let finished = false;
  async function finish(reason) {
    if (finished) return;
    finished = true;
    log.raw('');
    log.step(`收尾（${reason}）...`);

    const pages = rec.context?.pages?.().map((p) => p.url()) || [];

    let result;
    try {
      result = await rec.stop();
    } catch (e) {
      log.err('收尾失败：', e?.message || e);
      process.exit(3);
    }

    session.finish({ stats: result.stats, pages });

    log.raw('');
    log.ok(`会话 ${session.id} 已保存`);
    log.raw(summary ? summary(result, session) : `  ${session.dir}`);
    process.exit(0);
  }

  process.on('SIGINT', () => finish('SIGINT'));
  process.on('SIGTERM', () => finish('SIGTERM'));

  if (duration > 0) {
    setTimeout(() => finish(`--duration ${duration}ms`), duration);
  } else {
    const rl = readline.createInterface({ input: process.stdin });
    rl.on('line', (line) => {
      if (line.trim() === 'stop') finish('stdin');
    });
  }
}
