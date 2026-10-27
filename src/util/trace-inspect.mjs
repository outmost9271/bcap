import { execFileSync } from 'node:child_process';

const MAX_BUFFER = 256 * 1024 * 1024;

export function listEntries(zipPath) {
  return execFileSync('unzip', ['-Z1', zipPath], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
}

export function readEntry(zipPath, name) {
  return execFileSync('unzip', ['-p', zipPath, name], {
    encoding: 'utf8',
    maxBuffer: MAX_BUFFER,
  });
}

function parseJsonl(text) {
  return text
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

/**
 * 读取 Playwright trace.zip，返回解压清单、trace 事件、事件计数、网络行数。
 */
export function inspectTrace(zipPath) {
  const entries = listEntries(zipPath);
  const traceName = entries.find((n) => n.endsWith('.trace'));
  const networkName = entries.find((n) => n.endsWith('.network'));

  const traceEvents = traceName ? parseJsonl(readEntry(zipPath, traceName)) : [];
  const counts = {};
  for (const e of traceEvents) counts[e.type] = (counts[e.type] || 0) + 1;

  const networkLines = networkName
    ? readEntry(zipPath, networkName).split('\n').filter(Boolean).length
    : 0;

  return { entries, traceEvents, counts, networkLines, hasNetwork: !!networkName };
}
