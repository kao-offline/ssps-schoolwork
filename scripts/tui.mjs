// Minimal alternate-screen setup dashboard. No dependencies, plain ANSI.
// Non-TTY output stays line-based so logs and CI keep working.
const BLUE = '\x1b[36m';
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
  const filled = total > 0 ? Math.max(0, Math.min(width, Math.round((completed / total) * width))) : 0;
  return '█'.repeat(filled) + '░'.repeat(Math.max(0, width - filled));
}

export function createTui({ output = process.stdout, enabled = tuiEnabled() } = {}) {
  if (!enabled) return null;
  const steps = [];
  const logs = [];
  let active = -1;
  let frame = 0;
  let progress = null;
  let suspended = false;
  let timer;
  let stopped = false;
  let startedAt = Date.now();

  function paint() {
    if (suspended || stopped) return;
    const width = Math.max(12, output.columns || 80);
    const height = Math.max(6, output.rows || 24);
    const clip = text => Array.from(strip(text).replace(/[\x00-\x1f\x7f]/g, ' ')).slice(0, width - 1).join('');
    const done = steps.filter(step => step.state === 'done').length;
    const lines = [
      `${BOLD}${BLUE}${clip('SSPS / MCP   •   Local setup')}${RESET}`,
      `${DIM}${clip('Your accounts. Your computer. Your school context.')}${RESET}`,
      `${DIM}${'─'.repeat(width - 1)}${RESET}`,
      clip(`${done}/${steps.length} completed   ${bar(done, steps.length, Math.min(20, width - 1))}`),
    ];
    for (const [index, step] of steps.entries()) {
      const mark = step.state === 'done' ? '✓' : step.state === 'fail' ? '✕' : index === active ? FRAMES[frame % FRAMES.length] : '○';
      lines.push(clip(` ${mark} ${step.label.replace(/\[\d\/\d\] /g, '')}`));
      if (step.detail && index === active) lines.push(`${DIM}${clip('   ' + step.detail)}${RESET}`);
      if (index === active && progress) lines.push(`${BLUE}${clip(`   ${progress.completed}/${progress.total}  ${progress.extra || ''}`)}${RESET}`);
    }
    const footer = `${DIM}${clip(`${Math.round((Date.now() - startedAt) / 1000)}s elapsed • Ctrl+C to stop • Rerun to resume`)}${RESET}`;
    const space = Math.max(0, height - lines.length - 2);
    if (space) lines.push(...logs.slice(-Math.min(3, space)).map(line => clip(' › ' + line)));
    // Keep the active phase visible even in short terminals.
    const visible = lines.length > height - 2 ? [...lines.slice(0, 3), ...lines.slice(-(height - 5))] : lines;
    output.write('\x1b[H\x1b[J' + [...visible, footer].join('\n'));
  }

  function enter() {
    output.write('\x1b[?1049h\x1b[?25l');
    timer = setInterval(() => { frame++; paint(); }, 120);
    timer.unref?.();
    paint();
  }
  function stop() {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    process.removeListener('exit', stop);
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', terminate);
    output.removeListener?.('resize', paint);
    if (!suspended) output.write('\x1b[?25h\x1b[?1049l');
  }
  const interrupt = () => { stop(); process.exit(130); };
  const terminate = () => { stop(); process.exit(143); };

  const ui = {
    step(label) { steps.push({ label, state: 'pending', detail: '' }); paint(); return steps.length - 1; },
    run(id, detail) {
      if (active >= 0 && steps[active]?.state === 'active') steps[active].state = 'pending';
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
    log(line) { const text = strip(line).trim(); if (text) { logs.push(text); if (logs.length > 20) logs.shift(); paint(); } },
    // Interactive children (sign-in) need the real terminal: step out, run, step back in.
    async suspend(task) {
      suspended = true;
      clearInterval(timer);
      output.write('\x1b[?25h\x1b[?1049l');
      try { return await task(); }
      finally { suspended = false; if (!stopped) enter(); }
    },
    stop,
  };
  process.once('exit', stop);
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', terminate);
  output.on?.('resize', paint);
  enter();
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
    const cancel = () => child.kill();
    process.once('exit', cancel);
    const recent = [];
    function log(line) {
      const text = strip(line).trim();
      if (!text) return;
      recent.push(text.slice(-2000));
      if (recent.length > tail) recent.shift();
      ui?.log(text);
    }
    const flushers = [];
    for (const stream of [child.stdout, child.stderr]) {
      let pending = '';
      stream?.setEncoding?.('utf8');
      stream?.on('data', chunk => {
        const lines = (pending + chunk.toString()).split(/[\r\n]/);
        pending = (lines.pop() || '').slice(-2000);
        for (const line of lines) log(line);
      });
      flushers.push(() => log(pending));
    }
    if (input !== undefined) child.stdin.end(input);
    child.on('error', () => { process.removeListener('exit', cancel); reject(new Error('Could not start a required setup command.')); });
    child.on('close', code => {
      process.removeListener('exit', cancel);
      for (const flush of flushers) flush();
      if (code === 0) return resolveRun();
      reject(new Error(`Setup phase failed (exit ${code}).\n${recent.join('\n')}\nFix the error above and rerun the same command.`));
    });
  });
}
