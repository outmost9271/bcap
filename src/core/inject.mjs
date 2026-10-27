import fs from 'node:fs';

const RRWEB_SRC = fs.readFileSync(
  new URL('../../node_modules/rrweb/dist/rrweb.umd.min.cjs', import.meta.url),
  'utf8',
);

/**
 * 通用可读事件采集。
 * 统一发 { kind: 'ev', event: {...} }，两套录制器共用。
 */
export const READABLE_EVENTS = String.raw`
;(() => {
  if (window.__capEvInstalled) return;
  window.__capEvInstalled = true;

  const MAX_TEXT = 150;
  const MAX_VALUE = 300;

  const pick = (el) => {
    if (!el || el.nodeType !== 1) return null;
    if (el.id) return '#' + CSS.escape(el.id);
    const tag = el.tagName.toLowerCase();
    const testid = el.getAttribute('data-testid') || el.getAttribute('data-test-id');
    if (testid) return tag + '[data-testid="' + testid + '"]';
    const role = el.getAttribute('role');
    if (role) return tag + '[role="' + role + '"]';
    const label = el.getAttribute('aria-label');
    if (label) return tag + '[aria-label="' + label + '"]';
    const text = (el.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 40);
    return text ? tag + ':' + text : tag;
  };

  const emit = (type, e) => {
    try {
      const el = e.target;
      const isPassword = el && el.type === 'password';
      window.__cap(JSON.stringify({
        kind: 'ev',
        event: {
          type,
          ts: Math.round(performance.now()),
          url: location.href,
          title: document.title,
          sel: pick(el),
          text: (el && el.innerText ? el.innerText : '').replace(/\s+/g, ' ').slice(0, MAX_TEXT),
          value: el && 'value' in el ? (isPassword ? '***' : String(el.value).slice(0, MAX_VALUE)) : null,
          key: e.key || null,
          x: typeof e.clientX === 'number' ? e.clientX : null,
          y: typeof e.clientY === 'number' ? e.clientY : null,
        },
      }));
    } catch (_) {}
  };

  window.__capEmit = emit;

  for (const t of ['pointerdown', 'click', 'change', 'submit', 'paste', 'pagehide']) {
    addEventListener(t, (e) => emit(t, e), true);
  }
  for (const t of ['input', 'keydown']) {
    addEventListener(t, (e) => emit(t, e), true);
  }
})();
`;

/** 手动打点：Alt+Shift+S 触发一次 __snapshot__ 事件 */
export const TRACE_TRIGGER = String.raw`
;(() => {
  if (window.__capTriggerInstalled) return;
  window.__capTriggerInstalled = true;
  addEventListener('keydown', (e) => {
    if (e.altKey && e.shiftKey && (e.key === 'S' || e.key === 's')) {
      e.preventDefault();
      if (typeof window.__capEmit === 'function') window.__capEmit('__snapshot__', e);
    }
  }, true);
})();
`;

/** rrweb 启动器：批量回传，避免每条事件一次 binding 调用 */
export const RRWEB_BOOTSTRAP = String.raw`
;(() => {
  if (window.__capRrInstalled) return;
  if (typeof rrweb === 'undefined' || !rrweb.record) return;
  window.__capRrInstalled = true;

  const buf = [];
  let timer = null;
  let seq = 0;

  const flush = () => {
    if (!buf.length) return;
    const batch = buf.splice(0, buf.length);
    try { window.__cap(JSON.stringify({ kind: 'rr', batch })); } catch (_) {}
  };
  const schedule = () => {
    if (timer) return;
    timer = setTimeout(() => { timer = null; flush(); }, 120);
  };

  const stop = rrweb.record({
    emit(e) {
      e.__t = Math.round(performance.now());
      e.__seq = ++seq;
      buf.push(e);
      if (buf.length >= 80) flush();
      else schedule();
    },
    recordCanvas: false,
    collectFonts: false,
    inlineStylesheet: false,
    maskAllInputs: false,
    maskInputOptions: { password: true },
    sampling: { mousemove: 50, scroll: 100, input: 'all' },
    checkoutEveryNms: 10 * 60 * 1000,
  });
  window.__capRrStop = stop;
  window.__capFlush = flush;

  addEventListener('pagehide', flush, true);
  document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });
})();
`;

/**
 * 拼装注入脚本。
 * @param {object} opts
 * @param {boolean} [opts.rrweb]         是否注入 rrweb
 * @param {boolean} [opts.traceTrigger]  是否启用手动打点快捷键
 */
export function buildInject({ rrweb = false, traceTrigger = false } = {}) {
  const parts = [];
  if (rrweb) parts.push(RRWEB_SRC, RRWEB_BOOTSTRAP);
  parts.push(READABLE_EVENTS);
  if (traceTrigger) parts.push(TRACE_TRIGGER);
  return parts.join('\n');
}
