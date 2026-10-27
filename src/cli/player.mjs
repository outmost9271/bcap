import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

const RRWEB_SRC = fs.readFileSync(path.join(ROOT, 'node_modules/rrweb/dist/rrweb.umd.min.cjs'), 'utf8');
const PLAYER_SRC = fs.readFileSync(path.join(ROOT, 'node_modules/rrweb-player/dist/rrweb-player.umd.min.cjs'), 'utf8');
const PLAYER_CSS = fs.readFileSync(path.join(ROOT, 'node_modules/rrweb-player/dist/style.min.css'), 'utf8');
const GLOBAL_CSS = fs.readFileSync(path.join(ROOT, 'node_modules/rrweb-player/dist/global.css'), 'utf8');

export async function player({ args, config }) {
  const file = args._[0];
  if (!file) {
    console.error('用法: bcap player <会话ID|rrweb.jsonl> [--out replay.html]');
    process.exit(1);
  }

  const { findSession } = await import('../core/session.mjs');
  const fsx = await import('node:fs');
  const session = findSession(config.outDir, file);
  const input = file.endsWith('.jsonl') ? file : session?.path('rrweb.jsonl');
  if (!input || !fsx.existsSync(input)) {
    console.error('找不到 rrweb.jsonl：', file);
    process.exit(1);
  }

  const outFile = args.out || (session ? session.path('replay.html') : input.replace(/\.jsonl$/, '.html'));

  const events = fsx
    .readFileSync(input, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      try { return JSON.parse(l); } catch { return null; }
    })
    .filter(Boolean);

  if (!events.length) {
    console.error('没有解析到事件');
    process.exit(1);
  }

// 防止 </script> 截断内联脚本
const eventsJson = JSON.stringify(events).replace(/</g, '\\u003c');

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>rrweb replay · ${path.basename(file)}</title>
<style>${GLOBAL_CSS}</style>
<style>${PLAYER_CSS}</style>
<style>
  html,body{margin:0;padding:0;height:100%;background:#0f1115;color:#e6e6e6;
    font:13px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
  #wrap{display:flex;flex-direction:column;height:100%}
  #bar{padding:8px 12px;background:#161a20;border-bottom:1px solid #262c36;
    display:flex;gap:12px;align-items:center;flex-wrap:wrap}
  #bar b{color:#7dd3fc;font-weight:600}
  #bar span{color:#8b949e}
  #player{flex:1;min-height:0;overflow:auto}
  #err{color:#f87171;padding:12px;white-space:pre-wrap}
</style>
</head>
<body>
<div id="wrap">
  <div id="bar">
    <b>rrweb replay</b>
    <span id="meta"></span>
  </div>
  <div id="player"></div>
  <div id="err"></div>
</div>
<script>${RRWEB_SRC}</script>
<script>${PLAYER_SRC}</script>
<script>
(function () {
  var events = ${eventsJson};
  var el = document.getElementById('player');

  var full = events.filter(function (e) { return e.type === 2; }).length;
  var inc = events.filter(function (e) { return e.type === 3; }).length;
  var t0 = events[0] && events[0].__t;
  var t1 = events.length && events[events.length - 1].__t;
  document.getElementById('meta').textContent =
    events.length + ' 条事件 · ' + full + ' 全量 · ' + inc + ' 增量 · ' +
    (t0 != null && t1 != null ? ((t1 - t0) / 1000).toFixed(1) + 's' : '');

  var M = window.rrwebPlayer;
  var Ctor = (M && (M.default || M.Player)) || M;
  if (!Ctor) {
    document.getElementById('err').textContent = 'rrwebPlayer 未加载';
    return;
  }

  var common = {
    events: events,
    autoPlay: false,
    showController: true,
    speedOption: [1, 2, 4, 8, 16],
    skipInactive: false,
    showCaptions: false,
  };

  var attempts = [
    function () { return new Ctor({ target: el, props: common }); },
    function () { return new Ctor({ target: el, data: common }); },
    function () { return new Ctor({ target: el, props: { events: events } }); },
    function () { return new Ctor({ target: el, ...common }); },
  ];

  var lastErr = null;
  for (var i = 0; i < attempts.length; i++) {
    try {
      var p = attempts[i]();
      if (p) {
        window.__player = p;
        window.__playerOk = true;
        window.__playerApi = i;
        return;
      }
    } catch (e) {
      lastErr = String(e && e.message || e);
    }
  }
  window.__playerErr = lastErr;
  document.getElementById('err').textContent = 'player 初始化失败：' + (lastErr || 'unknown');
})();
</script>
</body>
</html>
`;

fs.writeFileSync(outFile, html);
  console.log('generated:', outFile);
  console.log('events:', events.length, '| size:', (html.length / 1024).toFixed(0), 'KB');
}
