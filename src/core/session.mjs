import fs from 'node:fs';
import path from 'node:path';

const pad = (n) => String(n).padStart(2, '0');

export function timestampId(date = new Date()) {
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

/** 一次录制 = 一个目录 */
export function createSession(outDir, mode, endpoint) {
  fs.mkdirSync(outDir, { recursive: true });

  let id = timestampId();
  let dir = path.join(outDir, id);
  let n = 1;
  while (fs.existsSync(dir)) {
    id = `${timestampId()}-${n++}`;
    dir = path.join(outDir, id);
  }
  fs.mkdirSync(dir, { recursive: true });

  const meta = {
    id,
    mode,
    endpoint,
    startedAt: new Date().toISOString(),
    endedAt: null,
    durationMs: null,
    pages: [],
    stats: null,
  };

  const metaPath = path.join(dir, 'meta.json');
  const write = () => fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2) + '\n');
  write();

  return {
    id,
    dir,
    mode,
    meta,
    path: (name) => path.join(dir, name),
    writeMeta(patch = {}) {
      Object.assign(meta, patch);
      write();
    },
    finish({ stats, pages } = {}) {
      const end = new Date();
      meta.endedAt = end.toISOString();
      meta.durationMs = end.getTime() - new Date(meta.startedAt).getTime();
      if (stats) meta.stats = stats;
      if (pages) meta.pages = pages;
      write();
    },
  };
}

/** 按 ID / 目录 / 文件路径解析会话 */
export function findSession(outDir, target) {
  if (!target) return null;

  if (target.endsWith('.jsonl') || target.endsWith('.zip')) {
    const dir = path.dirname(path.resolve(target));
    return { id: path.basename(dir), dir, meta: readMeta(dir) };
  }

  const direct = path.resolve(target);
  if (fs.existsSync(direct) && fs.statSync(direct).isDirectory()) {
    return { id: path.basename(direct), dir: direct, meta: readMeta(direct) };
  }

  const byId = path.join(outDir, target);
  if (fs.existsSync(byId)) {
    return { id: target, dir: byId, meta: readMeta(byId) };
  }

  // 前缀匹配
  if (fs.existsSync(outDir)) {
    const hits = fs
      .readdirSync(outDir)
      .filter((name) => name.startsWith(target))
      .sort();
    if (hits.length === 1) {
      const dir = path.join(outDir, hits[0]);
      return { id: hits[0], dir, meta: readMeta(dir) };
    }
    if (hits.length > 1) {
      throw new Error(`会话 ID 前缀不唯一：${target}（${hits.join(', ')}）`);
    }
  }

  return null;
}

function readMeta(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
  } catch {
    return null;
  }
}

export function listSessions(outDir) {
  if (!fs.existsSync(outDir)) return [];
  return fs
    .readdirSync(outDir)
    .map((name) => {
      const dir = path.join(outDir, name);
      if (!fs.statSync(dir).isDirectory()) return null;
      const meta = readMeta(dir);
      if (!meta) return null;
      return { ...meta, dir };
    })
    .filter(Boolean)
    .sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
}
