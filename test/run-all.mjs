import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TESTS = ['trace.test.mjs', 'rrweb.test.mjs', 'tuples.test.mjs', 'verify.mjs'];

let failed = 0;
for (const name of TESTS) {
  console.log(`\n=== ${name} ===`);
  const r = spawnSync(process.execPath, [path.join(HERE, name)], { stdio: 'inherit' });
  if (r.status !== 0) failed++;
}

console.log('');
console.log(failed === 0 ? '全部通过' : `${failed} 个测试失败`);
process.exit(failed === 0 ? 0 : 1);
