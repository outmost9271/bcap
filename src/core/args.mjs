const SHORT = {
  e: 'endpoint',
  o: 'out',
  m: 'mode',
  p: 'profile',
  h: 'help',
  v: 'version',
};

const camel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

/** 手写参数解析：支持 --k v、--k=v、-k v、--flag */
export function parseArgs(argv) {
  const out = { _: [] };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];

    if (a === '--') {
      out._.push(...argv.slice(i + 1));
      break;
    }

    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq >= 0) {
        out[camel(a.slice(2, eq))] = a.slice(eq + 1);
      } else {
        const key = camel(a.slice(2));
        const next = argv[i + 1];
        if (next !== undefined && (!next.startsWith('-') || next === '-')) {
          out[key] = argv[++i];
        } else {
          out[key] = true;
        }
      }
      continue;
    }

    if (a.startsWith('-') && a.length === 2) {
      const key = SHORT[a[1]] || a[1];
      const next = argv[i + 1];
      if (next !== undefined && (!next.startsWith('-') || next === '-')) {
        out[key] = argv[++i];
      } else {
        out[key] = true;
      }
      continue;
    }

    out._.push(a);
  }

  return out;
}

export function toNumber(v, fallback) {
  if (v === undefined || v === null || v === '' || v === true) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function toBool(v, fallback = false) {
  if (v === undefined || v === null || v === '') return fallback;
  if (v === true) return true;
  if (v === false) return false;
  return !['0', 'false', 'no', 'off'].includes(String(v).toLowerCase());
}

/** --duration 3s / 500ms / 2m / 3000（默认秒） */
export function parseDuration(v) {
  if (v === undefined || v === null || v === true) return 0;
  const m = String(v).match(/^(\d+(?:\.\d+)?)(ms|s|m)?$/);
  if (!m) return 0;
  const n = Number(m[1]);
  const unit = m[2] || 's';
  if (unit === 'ms') return n;
  if (unit === 'm') return n * 60_000;
  return n * 1000;
}
