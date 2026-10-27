import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const expandHome = (p) =>
  typeof p === 'string' && p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p;

/** 插件根目录 */
export const PLUGIN_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** 插件内嵌配置：唯一被读取的配置文件 */
export const EMBEDDED_CONFIG = path.join(PLUGIN_ROOT, 'config', 'bcap.config.json');

const DEFAULTS = {
  endpoint: 'http://127.0.0.1:9222',
  outDir: './out',
  mode: 'rrweb',
  trace: {
    profile: 'light',
    snapshotGap: 2500,
    debounce: 2500,
  },
};

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function merge(base, over) {
  const out = { ...base, ...over };
  if (base.trace || over.trace) {
    out.trace = { ...(base.trace || {}), ...(over.trace || {}) };
  }
  return out;
}

function clean(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null || v === '') continue;
    if (k === '_') continue;
    out[k] = v;
  }
  return out;
}

/**
 * 配置加载策略：
 *   1. 插件内嵌 config/bcap.config.json（强制优先，唯一配置文件来源）
 *   2. CLI 参数覆盖（仅用于临时调整，不改变默认值）
 *   3. 内置 DEFAULTS（内嵌文件缺失时兜底）
 *
 * 不读取 cwd、$HOME、BCAP_* 环境变量中的配置，避免同一插件在不同目录表现不一致。
 */
export function loadConfig({ cwd = process.cwd(), cli = {} } = {}) {
  let config = merge(DEFAULTS, {});
  let source = null;

  const embedded = readJson(EMBEDDED_CONFIG);
  if (embedded) {
    config = merge(config, embedded);
    source = EMBEDDED_CONFIG;
  }

  config = merge(config, clean(cli));
  config.outDir = path.resolve(cwd, expandHome(config.outDir));

  return { config, source };
}

/** 配置来源清单：现在只有插件内嵌文件 */
export function configCandidates() {
  return [EMBEDDED_CONFIG];
}

export function embeddedConfigExists() {
  return fs.existsSync(EMBEDDED_CONFIG);
}

export { DEFAULTS };
