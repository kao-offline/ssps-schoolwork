// Minimal alternate-screen setup dashboard. No dependencies, plain ANSI.
// Non-TTY output stays line-based so logs and CI keep working.
const BLUE = '\x1b[34m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';
const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export function tuiEnabled() {
  return Boolean(process.stdout.isTTY) && !process.env.NO_COLOR && !process.env.CI;
}

function strip(text) {
  return String(text).replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '').replace(/\r/g, '');
}

function bar(completed, total, width = 22) {
  const filled = total > 0 ? Math.round((completed / total) * width) : 0;
  return '█'.repeat(filled) + '░'.repeat(Math.max(0, width - filled));
}

export function createTui() {
  if (!tuiEnabled()) return null;
  const steps = [];
  const logs = [];
  let active = -1;
  let frame = 0;
  let progress = null;
  let suspended = false;
  let timer;
  let startedAt = Date.now();

  function paint() {
    if (suspended) return;
    const width = process.stdout.columns || 80;
    const rule = '─'.repeat(Math.min(width - 2, 76));
    let out = '\x1b[H\x1b[J';
    out += `${BOLD}SSPS ${BLUE}/ MCP${RESET}${BOLD} — Schoolwork, already in context.${RESET}\n`;
    out += `${DIM}Local only: accounts and cache stay on this computer.${RESET}\n`;
    out += `${DIM}${rule}${RESET}\n`;
    steps.forEach((step, index) => {
      const mark = step.state === 'done' ? `${BLUE}✓${RESET}` : step.state === 'fail' ? '\x1b[31m✗\x1b[0m' : index === active ? FRAMES[frame % FRAMES.length] : `${DIM}○${RESET}`;
      const detail = step.detail ? ` ${DIM}${strip(step.detail).slice(0, 52)}${RESET}` : '';
      out += ` ${mark} ${step.label}${detail}\n`;
      if (index === active && progress) {
        out += `   ${BLUE}${bar(progress.completed, progress.total)}${RESET} ${progress.completed}/${progress.total}${progress.extra ? ` ${DIM}${strip(progress.extra).slice(0, 30)}${RESET}` : ''}\n`;
      }
    });
    out += `${DIM}${rule}${RESET}\n`;
    for (const line of logs.slice(-3)) out += ` ${DIM}›${RESET} ${strip(line).slice(0, width - 6)}\n`;
    const elapsed = Math.round((Date.now() - startedAt) / 1000);
    out += `\n ${DIM}${elapsed}s elapsed · Ctrl+C aborts, completed steps are kept${RESET}`;
    process.stdout.write(out);
  }

  function start() {
    process.stdout.write('\x1b[?1049h\x1b[?25l');
    const stop = () => { clearInterval(timer); process.stdout.write('\x1b[?25h\x1b[?1049l'); };
    process.once('exit', stop);
    process.once('SIGINT', () => { stop(); });
    timer = setInterval(() => { frame++; paint(); }, 120);
    paint();
  }

  const ui = {
    step(label) { steps.push({ label, state: 'pending', detail: '' }); paint(); return steps.length - 1; },
    run(id, detail) {
      if (active >= 0 && steps[active]) steps[active].state = 'pending';
      active = id;
      steps[id].state = 'active';
      steps[id].detail = detail || '';
      progress = null;
      paint();
    },
    ok(id, detail) { steps[id].state = 'done'; steps[id].detail = detail || ''; progress = null; paint(); },
    bad(id, detail) { steps[id].state = 'fail'; steps[id].detail = detail || ''; progress = null; paint(); },
    info(id, detail) { steps[id].detail = detail || ''; paint(); },
    bar(completed, total, extra) { progress = { completed, total, extra }; paint(); },
    log(line) { const text = strip(line).trim(); if (text) { logs.push(text); paint(); } },
    // Interactive children (sign-in) need the real terminal: step out, run, step back in.
    async suspend(task) {
      suspended = true;
      clearInterval(timer);
      process.stdout.write('\x1b[?25h\x1b[?1049l');
      try { return await task(); }
      finally {
        suspended = false;
        process.stdout.write('\x1b[?1049h\x1b[?25l');
        timer = setInterval(() => { frame++; paint(); }, 120);
        paint();
      }
    },
    stop() { clearInterval(timer); process.stdout.write('\x1b[?25h\x1b[?1049l'); },
  };
  start();
  return ui;
}

// Static recap that survives the alternate screen: call after stop().
export function recap(lines) {
  for (const [label, detail] of lines) console.log(`✓ ${label}${detail ? ` · ${detail}` : ''}`);
}

// Spawn with output captured into the dashboard log; failures dump the tail.
export async function runTui(spawnFn, ui, command, parameters, { input, tail = 8, cwd } = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawnFn(command, parameters, { cwd, stdio: input === undefined ? ['ignore', 'pipe', 'pipe'] : ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let output = '';
    const collect = chunk => {
      output += chunk.toString();
      const lines = output.split('\n');
      output = lines.pop() || '';
      for (const line of lines) ui?.log(line);
    };
    child.stdout?.on('data', collect);
    child.stderr?.on('data', collect);
    if (input !== undefined) child.stdin.end(input);
    child.on('error', () => reject(new Error('Could not start a required setup command.')));
    child.on('close', code => {
      if (code === 0) return resolveRun();
      if (output.trim()) ui?.log(output.trim().split('\n').slice(-tail).join('\n'));
      reject(new Error(`Setup phase failed (exit ${code}). Fix the error above and rerun the same command.`));
    });
  });
}
