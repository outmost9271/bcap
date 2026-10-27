import { startRrRecorder } from '../core/recorder-rrweb.mjs';
import { startRecorder as startTraceRecorder } from '../core/recorder-trace.mjs';
import { createSession } from '../core/session.mjs';
import { parseDuration, toBool, toNumber } from '../core/args.mjs';
import { runRecorder } from './runner.mjs';
import { log } from '../util/log.mjs';

const SNAPSHOT_TYPES = ['click', 'change', 'submit', '__snapshot__'];

const PROFILES = {
  light: {
    dom: true,
    screenshots: false,
    screen: false,
    aria: false,
    snapshotGap: 2500,
    debounce: 2500,
    snapshotTypes: SNAPSHOT_TYPES,
  },
  full: {
    dom: true,
    screenshots: true,
    screen: true,
    aria: true,
    snapshotGap: 500,
    debounce: 500,
    snapshotTypes: SNAPSHOT_TYPES,
  },
  events: {
    dom: false,
    screenshots: false,
    screen: false,
    aria: false,
    snapshotGap: Number.POSITIVE_INFINITY,
    debounce: 0,
    snapshotTypes: [],
  },
};

export async function record({ args, config }) {
  const mode = args.mode || config.mode;
  if (!['rrweb', 'trace'].includes(mode)) {
    log.err(`未知模式：${mode}（可选 rrweb / trace）`);
    process.exit(1);
  }

  const profileName = args.profile || config.trace?.profile || 'light';
  const profile = PROFILES[profileName] || PROFILES.light;
  const endpoint = args.endpoint || config.endpoint;
  const session = createSession(config.outDir, mode, endpoint);

  const start =
    mode === 'trace'
      ? () =>
          startTraceRecorder({
            endpoint,
            outDir: session.dir,
            ...profile,
            snapshotGap: toNumber(args.snapshotGap, config.trace?.snapshotGap ?? profile.snapshotGap),
            debounce: toNumber(args.debounce, config.trace?.debounce ?? profile.debounce),
            screenshots: toBool(args.screenshots, profile.screenshots),
            screen: toBool(args.screen, profile.screen),
            aria: toBool(args.aria, profile.aria),
          })
      : () =>
          startRrRecorder({
            endpoint,
            outDir: session.dir,
            attachExisting: !args.onlyNew,
          });

  await runRecorder({
    start,
    session,
    duration: parseDuration(args.duration),
    banner: () =>
      [
        '',
        '────────────────────────────────────────',
        ` 录制中 · ${mode}${mode === 'trace' ? ` (${profileName})` : ''}`,
        ` 端点  ${endpoint}`,
        ` 会话  ${session.id}`,
        ' 结束  Ctrl+C 或输入 stop 回车',
        '────────────────────────────────────────',
        '',
      ].join('\n'),
    summary: (r, s) =>
      [
        `  目录  ${s.dir}`,
        mode === 'rrweb'
          ? `  rrweb ${r.rrwebPath}\n  events ${r.eventsPath}\n  trace ${r.tracePath}`
          : `  trace ${r.tracePath}\n  events ${r.eventsPath}`,
        '',
        ` 下一步  bcap tuples ${s.id}`,
      ].join('\n'),
  });
}
