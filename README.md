# bcap

通过 CDP 旁挂到已打开的 Chrome，把一次人工演示录成结构化数据：DOM 变化、网络请求、操作序列，以及三者对齐后的四元组。

不接管浏览器，不重启会话，不下载新浏览器。

## 特性

- **两套 DOM 采集**
  - `rrweb`：全量一次 + `MutationObserver` 增量，页面开销接近 0
  - `trace`：Playwright trace 离散快照，产物可被 Trace Viewer 打开
- **网络 HAR**：请求头、请求体、响应头、响应体、WebSocket 帧
- **任意时刻重建 DOM**
- **自包含回放 HTML**：单文件，可离线打开
- **四元组**：动作 + 上下文 + DOM 变化 + 网络，过滤轮询与埋点

## 安装

### 作为 Pi 包

```bash
pi install git:github.com/outmost9271/bcap
```

安装后 `skills/bcap` 会被 Pi 加载，agent 可以直接按 skill 指令调用。

### 从源码

```bash
git clone https://github.com/outmost9271/bcap.git
cd bcap
npm install
./bin/bcap --help
```

全局使用：

```bash
npm link
bcap --help
```

## 前置

- Node.js 20+
- Chrome 以 `--remote-debugging-port=9222` 启动

```bash
bcap doctor
```

## 快速开始

```bash
# 1. 检查环境
bcap doctor

# 2. 开始录制（在浏览器里完成一次演示）
bcap record

# 3. 回看
bcap list
bcap replay <id> --list
bcap tuples <id>
bcap player <id>
```

## 命令

```text
bcap record [选项]                录制会话
bcap replay <session>             重建 DOM 或列出时间线
bcap player <session>             生成自包含回放 HTML
bcap tuples <session>             生成四元组
bcap list                         列出所有录制
bcap doctor                       检查环境
```

### record

```bash
bcap record                          # rrweb 增量（默认）
bcap record -m trace -p light        # Playwright trace，低开销
bcap record -m trace -p full         # 全量快照 + 连续截图（会卡）
bcap record --duration 30s           # 定时停止
bcap record --only-new               # 只挂载录制后新建的页面
```

`-p` 的三个 profile：

| profile | DOM 快照 | 连续截图 | 页面开销 |
|---|---|---|---|
| `light` | ✅ | ❌ | 低 |
| `full` | ✅ | ✅ | 高 |
| `events` | ❌ | ❌ | 无感 |

### replay

```bash
bcap replay <id> --list              # FullSnapshot / 鼠标 / 输入 时间线
bcap replay <id> --at 5000 > a.html  # 重建 5000ms 时刻的 DOM
bcap replay <id> > final.html        # 重建最终状态
```

### player

```bash
bcap player <id>                     # 生成 out/<id>/replay.html
bcap player <id> --out demo.html
```

`replay.html` 内联了 rrweb、rrweb-player、CSS 和全部事件，单文件约 2~3MB。

### tuples

```bash
bcap tuples <id>
```

输出 `steps.jsonl`，每条是一个四元组：

```json
{
  "step": 2,
  "t": 265651,
  "action": {
    "type": "click",
    "text": "新增",
    "selector": "#sfext3-gen344",
    "selectorStable": "text=\"新增\"",
    "stable": false
  },
  "context": {
    "url": "https://10.2.2.201/framework.php#/...",
    "title": "AF1",
    "heading": null,
    "beforeText": ["AF1", "深信服防火墙", "静态路由"]
  },
  "domDiff": {
    "added": ["新建静态路由", "描述", "目的地址/掩码", "接口"],
    "removed": ["暂无数据"],
    "truncated": false
  },
  "network": [
    { "at": 152, "method": "GET", "url": ".../networkargs", "status": 200, "duration": 102, "size": 3072 }
  ]
}
```

生成规则：

| 部分 | 来源 |
|---|---|
| action | `events.jsonl` 的 click/change/submit，同元素 800ms 内合并 |
| context | 事件时刻重建出的 DOM 的 URL / 标题 / 可见文本 |
| domDiff | 事件前后两个时刻的文本级差异，最多 12 条 |
| network | `trace.network` 时间窗内的请求，过滤轮询、埋点、静态资源、4xx |

## 配置

配置内嵌在插件里，唯一来源：

```text
<插件根>/config/bcap.config.json
```

```bash
bcap config --path   # 打印配置文件路径
bcap config          # 打印生效配置
```

加载顺序：**CLI 参数 > 插件内嵌配置 > 内置默认**。

不读取 cwd、`$HOME` 或环境变量里的配置，保证同一插件在任何目录行为一致。

| 字段 | 说明 |
|---|---|
| `endpoint` | CDP 端点 |
| `outDir` | 会话输出目录，支持 `~` |
| `mode` | 默认录制模式：`rrweb` / `trace` |
| `trace.profile` | `light` / `full` / `events` |
| `trace.snapshotGap` | 两次快照的最小间隔（ms） |
| `trace.debounce` | 输入合并窗口（ms） |

修改后无需重启，下一条命令即生效；`pi` 安装的包需要 `pi update --extensions` 才会同步 GitHub 上的改动。

## 产物

一次录制一个目录：

```text
out/
└── 20261027-140028/
    ├── meta.json      端点、模式、起止时间、页面、统计
    ├── rrweb.jsonl    DOM 全量 + 增量
    ├── events.jsonl   操作事件（选择器 / 文本 / 输入值）
    ├── trace.zip      网络 HAR
    ├── steps.jsonl    四元组
    └── replay.html    回放（bcap player 生成）
```

## 架构

```text
bin/bcap                入口（环境引导 + 转交 Node）
src/cli/                命令实现
src/core/
  config.mjs            配置加载与合并
  session.mjs           会话目录与 meta.json
  cdp.mjs               CDP 连接 / attachPage / tracing
  inject.mjs            注入脚本模板
  recorder-rrweb.mjs    rrweb 录制
  recorder-trace.mjs    Playwright trace 录制
  rr-replay.mjs         rrweb 事件流重建
  tuples.mjs            四元组生成
src/util/               日志 / 文件 / trace 检查
test/                   自测
skills/bcap/SKILL.md    Pi skill
```

两套录制器共用 `cdp.mjs` 与 `inject.mjs`，差异只在 DOM 采集方式。

## 测试

```bash
npm test
```

覆盖：trace 录制、rrweb 录制、四元组生成、CDP 能力验证。

## 限制

- 文本级 DOM diff，不是结构级
- 不重建 Shadow DOM / Canvas / iframe 的增量
- 输入框失焦才产生 `change`，一直不失焦会丢最终值
- `trace.zip` 含 Cookie 与请求体，视为敏感数据

## License

MIT
