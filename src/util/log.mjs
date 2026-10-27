const tty = process.stdout.isTTY;

const wrap = (code) => (s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);

export const C = {
  dim: wrap(2),
  bold: wrap(1),
  red: wrap(31),
  green: wrap(32),
  yellow: wrap(33),
  cyan: wrap(36),
};

export const log = {
  raw: (...a) => console.log(...a),
  info: (...a) => console.log(...a),
  dim: (...a) => console.log(C.dim(a.join(' '))),
  step: (...a) => console.log(C.cyan('›'), ...a),
  ok: (...a) => console.log(C.green('✓'), ...a),
  warn: (...a) => console.warn(C.yellow('!'), ...a),
  err: (...a) => console.error(C.red('✗'), ...a),
};
