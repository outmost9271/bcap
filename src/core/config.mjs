import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const expandHome = (p) =>
  typeof p === 'string' && p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p;

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

export function configCandidates(cwd = process.cwd()) {
  const list = [];
  if (process.env.BCAP_CONFIG) list.push(path.resolve(process.env.BCAP_CONFIG));
  list.push(path.join(cwd, 'bcap.config.json'));
  list.push(path.join(os.homedir(), '.config', 'bcap', 'config.json'));
  return list;
}

/**
 * 配置优先级：CLI > 环境变量 > 项目配置 > 用户配置 > 默认
 * @returns {{config: object, source: string|null}}
 */
export function loadConfig({ cwd = process.cwd(), cli = {} } = {}) {
  let config = merge(DEFAULTS, {});
  let source = null;

  for (const file of configCandidates(cwd)) {
    const data = readJson(file);
    if (data) {
      config = merge(config, data);
      source = file;
      break;
    }
  }

  if (process.env.BCAP_ENDPOINT) config.endpoint = process.env.BCAP_ENDPOINT;
  if (process.env.BCAP_OUT_DIR) config.outDir = process.env.BCAP_OUT_DIR;
  if (process.env.BCAP_MODE) config.mode = process.env.BCAP_MODE;

  config = merge(config, clean(cli));
  config.outDir = path.resolve(cwd, expandHome(config.outDir));

  return { config, source };
}

export { DEFAULTS };
