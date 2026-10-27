import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EMBEDDED_CONFIG } from '../core/config.mjs';
import { listSessions } from '../core/session.mjs';
import { C } from '../util/log.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

function depVersion(name) {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules', name, 'package.json'), 'utf8')).version;
  } catch {
    return null;
  }
}

export async function doctor({ config, configSource, version }) {
  console.log(`bcap ${version}`);
  console.log('');

  let bad = 0;
  const row = (label, value, ok = true) => {
    if (!ok) bad++;
    const mark = ok ? C.green('ok') : C.red('fail');
    console.log(`  ${label.padEnd(26)} ${mark.padEnd(6)} ${value}`);
  };

  row('node', process.version, true);

  for (const dep of ['playwright-core', 'rrweb', 'rrweb-player']) {
    const v = depVersion(dep);
    row(dep, v || 'not installed', !!v);
  }

  row('config', configSource || '(built-in defaults)', true);
  row('endpoint', config.endpoint, true);

  const sessions = listSessions(config.outDir);
  row('out dir', `${config.outDir}  (${sessions.length} sessions)`, true);

  try {
    const base = config.endpoint.replace(/^ws/, 'http').replace(/\/$/, '');
    const res = await fetch(`${base}/json/version`, { signal: AbortSignal.timeout(5000) });
    const data = await res.json();
    row('cdp /json/version', `${res.status}  ${data.Browser || ''}`, res.ok);
  } catch (e) {
    row('cdp /json/version', String(e?.message || e), false);
  }

  if (!configSource) {
    console.log('');
    console.log('  提示: 插件内嵌配置缺失，正在使用内置默认值');
    console.log(`        创建: ${path.join(ROOT, 'config', 'bcap.config.json')}`);
  }

  console.log('');
  console.log(bad === 0 ? C.green('环境正常') : C.red(`${bad} 项异常`));
  process.exit(bad === 0 ? 0 : 1);
}
