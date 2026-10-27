---
name: bcap
description: 录制浏览器会话并分析：rrweb 增量 DOM、网络 HAR、重建任意时刻的 DOM、提取「动作+上下文+DOM变化+网络」四元组。适用于让用户演示一次网页操作、逆向站点 API、学习未知页面的交互流程。
---

# bcap

`bcap` 通过 CDP 旁挂到用户已打开的 Chrome，把一次人工演示录成结构化数据。

## 定位命令

优先用 `PATH` 里的 `bcap`。若不可用，用本 skill 所在包的入口：

```bash
BCAP="$(cd "$(dirname "<本 SKILL.md 的实际路径>")/../.." && pwd)/bin/bcap"
"$BCAP" --help
```

路径按当前加载到的 SKILL.md 位置推导，不要写死任何固定绝对路径。

## 前置检查

```bash
bcap doctor
```

`cdp /json/version` 必须显示 ok。失败时不要重试、不要换端口、不要启动新浏览器，直接把端点和错误原文告诉用户。

## 工作流

1. 确认用户在浏览器里已经打开目标页面。
2. 开始录制：

```bash
bcap record
```

3. 让用户在浏览器里完成一次完整演示，然后回到终端按 Ctrl+C（或输入 `stop` 回车）。
4. 产物在 `out/<会话ID>/`：

```text
meta.json      端点、模式、起止时间、页面、统计
rrweb.jsonl    DOM 全量 + 增量
events.jsonl   可读操作事件（选择器 / 文本 / 输入值）
trace.zip      网络 HAR（含请求体与响应体）
steps.jsonl    四元组（由 bcap tuples 生成）
```

## 命令

| 命令 | 用途 |
|---|---|
| `bcap record` | 录制（默认 rrweb 增量，页面开销最低） |
| `bcap record -m trace -p light` | Playwright trace 离散快照 |
| `bcap record --duration 30s` | 定时停止 |
| `bcap list` | 列出所有会话 |
| `bcap replay <id> --list` | 时间线关键点（FullSnapshot / 鼠标 / 输入） |
| `bcap replay <id> --at 5000` | 重建该时刻的 DOM |
| `bcap player <id>` | 生成自包含回放 HTML |
| `bcap tuples <id>` | 生成四元组 |
| `bcap doctor` | 检查 Node、依赖、配置、CDP 端点 |

会话 ID 支持前缀匹配，只写日期时间的前几位也能定位。

## 读取产物

```bash
# 有语义的网络请求（过滤轮询与埋点由 tuples 负责）
unzip -p out/<id>/trace.zip trace.network \
  | jq -r 'select(.snapshot) | "\(.snapshot.request.method) \(.snapshot.response.status) \(.snapshot.request.url)"'

# 操作序列
jq -r 'select(.type=="click" or .type=="change") | "\(.ts) \(.type) \(.sel)"' out/<id>/events.jsonl

# 四元组摘要
jq -c '{step, action: .action.text, added: .domDiff.added, net: [.network[].url]}' out/<id>/steps.jsonl
```

## 注意事项

- 默认 rrweb 模式对页面几乎没有影响；`-m trace -p full` 会明显卡顿，只用于需要逐帧回放的场景。
- 不要同时运行两个 bcap 录制，网络会被录两遍。
- 录制期间不要用 `agent-browser record start` 或 `network route`，会和 screencast / Fetch 拦截冲突。
- `trace.zip` 含 Cookie、请求体、响应体，视为敏感数据，不要提交到版本库。
- 密码框已脱敏为 `***`；其他输入值需要自行判断是否敏感。
