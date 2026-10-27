import { parseArgs } from '../core/args.mjs';
import { loadConfig } from '../core/config.mjs';
import { record } from './record.mjs';
import { replay } from './replay.mjs';
import { player } from './player.mjs';
import { tuples } from './tuples.mjs';
import { list } from './list.mjs';
import { doctor } from './doctor.mjs';
import { showConfig } from './config.mjs';

const VERSION = '0.2.0';

const HELP = `bcap — 浏览器会话录制与分析

用法:
  bcap <命令> [选项]

命令:
  record                录制会话（默认 rrweb 增量）
  replay <session>      重建 DOM 或列出时间线
  player <session>      生成自包含回放 HTML
  tuples <session>      生成四元组（动作+上下文+DOM变化+网络）
  list                  列出所有录制
  config                显示配置来源与内容
  doctor                检查环境

全局选项:
  -e, --endpoint <url>  CDP 端点
  -o, --out <dir>       输出目录（默认 ./out）
  -m, --mode <name>     rrweb | trace（默认 rrweb）
  -p, --profile <name>  trace 模式：light | full | events
      --json            机器可读输出
  -h, --help            帮助
  -v, --version         版本

示例:
  bcap record
  bcap record -m trace -p light
  bcap replay 20261027-140028 --list
  bcap tuples 20261027-140028
  bcap player 20261027-140028
`;

const COMMAND_HELP = {
  record: `bcap record [选项]

  -m, --mode <name>       rrweb | trace
  -p, --profile <name>    light | full | events（仅 trace 模式）
      --duration <time>   自动停止，如 30s / 2m / 500ms
      --snapshot-gap <ms> 两次快照的最小间隔（trace 模式）
      --only-new          只挂载录制开始后新建的页面
  -e, --endpoint <url>   覆盖 CDP 端点
  -o, --out <dir>        覆盖输出目录

录制中按 Ctrl+C 结束，或输入 stop 回车。
`,
  replay: `bcap replay <session|rrweb.jsonl> [选项]

      --list              列出时间线关键点
      --at <ms>           输出该时刻的 DOM
`,
  player: `bcap player <session|rrweb.jsonl> [选项]

      --out <file>        输出 HTML 路径（默认会话目录 replay.html）
`,
  tuples: `bcap tuples <session|rrweb.jsonl> [选项]

      --events <file>     指定 events.jsonl
      --trace <file>      指定 trace.zip
      --out <file>        指定输出路径（默认会话目录 steps.jsonl）
`,
  list: `bcap list [--json]
`,
  config: `bcap config [--path]

      --path  只输出配置文件路径
`,
  doctor: `bcap doctor
`,
};

const argv = process.argv.slice(2);
const command = argv[0];

if (!command || command === '-h' || command === '--help' || command === 'help') {
  console.log(HELP);
  process.exit(0);
}

if (command === '-v' || command === '--version' || command === 'version') {
  console.log(VERSION);
  process.exit(0);
}

const args = parseArgs(argv.slice(1));

if (args.help) {
  console.log(COMMAND_HELP[command] || HELP);
  process.exit(0);
}

const { config, source } = loadConfig({ cli: args });

const COMMANDS = { record, replay, player, tuples, list, doctor, config: showConfig };
const fn = COMMANDS[command];

if (!fn) {
  console.error(`未知命令: ${command}\n`);
  console.error(HELP);
  process.exit(1);
}

await fn({ args, config, configSource: source, version: VERSION });
