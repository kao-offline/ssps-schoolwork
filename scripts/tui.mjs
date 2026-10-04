// Full-screen installer available before npm install: only Node built-ins.
import { renderDashboard, decodeTerminalInput, cleanText } from './terminal-view.mjs';
import { supportedMouse } from './setup-prerequisites.mjs';

const ENTER = '\x1b[?1049h\x1b[?25l\x1b[?1000h\x1b[?1006h';
const LEAVE = '\x1b[?1000l\x1b[?1006l\x1b[0m\x1b[?25h\x1b[?1049l';
export function tuiEnabled({ force = false, output = process.stdout, env = process.env } = {}) {
  return Boolean(output.isTTY) && (force || !env.NO_COLOR && !env.CI && env.TERM !== 'dumb');
}
const strip = cleanText;

export function createTui({ output = process.stdout, input = process.stdin, enabled = tuiEnabled(), exit = code => process.exit(code) } = {}) {
  if (!enabled) return null;
  const steps = [], checks = [], logs = [];
  if (!supportedMouse()) checks.push({ name: 'Mouse', state: 'warn', detail: 'Keyboard only: upgrade Node to 22.18+ / 24.6+' });
  let active = -1, focused = -1, progress = null, selection = null;
  let suspended = false, stopped = false, timer, targets = [], buffer = '', logOffset = 0, lastPaint;
  const startedAt = Date.now();
  const wasRaw = Boolean(input.isRaw);
  // A fresh stdin has readableFlowing=null even though isPaused() is false.
  // Pause it on exit so a completed installer does not keep Node alive.
  const wasPaused = (input.readableFlowing === undefined ? input.isPaused?.() : input.readableFlowing !== true) ?? true;
  const interactive = Boolean(input.isTTY && input.setRawMode);

  function paint() {
    if (suspended || stopped) return;
    const view = renderDashboard({ width: output.columns || 80, height: output.rows || 24, steps, checks, logs, active, focused, progress, selection, logOffset, elapsed: Math.round((Date.now() - startedAt) / 1000) });
    targets = view.targets;
    if (view.text !== lastPaint) { lastPaint = view.text; output.write(view.text); }
  }
  function apply(action, index) {
    if (action === 'quit') { interrupt(); return; }
    if (!selection) { if (action === 'step') focused = index; paint(); return; }
    if (action === 'toggle') {
      selection.focus = index;
      const id = selection.choices[index]?.id;
      if (id) { if (selection.selected.has(id)) selection.selected.delete(id); else selection.selected.add(id); }
      selection.error = '';
    } else if (action === 'all') selection.selected = new Set(selection.choices.map(choice => choice.id));
    else if (action === 'none') selection.selected.clear();
    else if (action === 'continue') {
      if (selection.selected.size < selection.min) selection.error = 'Select at least one connection.';
      else {
        const current = selection;
        selection = null;
        current.resolve(current.choices.filter(choice => current.selected.has(choice.id)).map(choice => choice.id));
      }
    }
    paint();
  }
  function receive(chunk) {
    const decoded = decodeTerminalInput(buffer + chunk.toString());
    buffer = decoded.remaining;
    for (const event of decoded.events) {
      if (event.type === 'click') {
        const target = targets.find(target => event.x >= target.x && event.x < target.x + target.width && event.y >= target.y && event.y < target.y + target.height);
        if (target) apply(target.action, target.index);
      } else if (event.key === 'cancel' || event.key === 'q') interrupt();
      else if (selection) {
        if (['up', 'down', 'pageup', 'pagedown'].includes(event.key)) {
          const delta = event.key === 'up' ? -1 : event.key === 'down' ? 1 : event.key === 'pageup' ? -5 : 5;
          selection.focus = Math.max(0, Math.min(selection.choices.length - 1, selection.focus + delta)); paint();
        } else if (event.key === 'space') apply('toggle', selection.focus);
        else if (event.key === 'enter') apply('continue');
        else if (event.key === 'a') apply('all');
        else if (event.key === 'n') apply('none');
      } else if (event.key === 'up' || event.key === 'pageup') { logOffset = Math.min(logs.length, logOffset + (event.key === 'pageup' ? 5 : 1)); paint(); }
      else if (event.key === 'down' || event.key === 'pagedown') { logOffset = Math.max(0, logOffset - (event.key === 'pagedown' ? 5 : 1)); paint(); }
    }
  }
  function attach() {
    if (!interactive) return;
    input.setRawMode(true);
    input.on('data', receive);
    input.resume();
  }
  function detach() {
    if (!interactive) return;
    input.removeListener('data', receive);
    input.setRawMode(wasRaw);
    if (wasPaused) input.pause();
    buffer = '';
  }
  function enter() {
    lastPaint = undefined;
    output.write(ENTER + '\x1b[2J');
    attach();
    timer = setInterval(paint, 200);
    timer.unref?.();
    paint();
  }
  function stop() {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    detach();
    process.removeListener('exit', stop);
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', terminate);
    output.removeListener?.('resize', paint);
    if (!suspended) output.write(LEAVE);
    if (selection) { selection.reject(new Error('Setup selection cancelled.')); selection = null; }
  }
  const interrupt = () => { stop(); exit(130); };
  const terminate = () => { stop(); exit(143); };
  const ui = {
    step(label) { steps.push({ label, state: 'pending', detail: '' }); paint(); return steps.length - 1; },
    run(id, detail = '') { active = focused = id; steps[id].state = 'active'; steps[id].detail = detail; progress = null; paint(); },
    ok(id, detail = '') { steps[id].state = 'done'; steps[id].detail = detail; progress = null; paint(); },
    bad(id, detail = '') { steps[id].state = 'fail'; steps[id].detail = detail; progress = null; paint(); },
    info(id, detail) { steps[id].detail = detail; paint(); },
    check(name, state, detail) {
      const found = checks.find(check => check.name === name);
      if (found) Object.assign(found, { state, detail }); else checks.push({ name, state, detail });
      paint();
    },
    bar(completed, total, extra) { progress = { completed, total, extra }; paint(); },
    log(line) { const text = cleanText(line).trim(); if (text) { logs.push(text); if (logs.length > 200) logs.shift(); logOffset = 0; paint(); } },
    select(choices, defaults, title, { min = 1 } = {}) {
      if (stopped) return Promise.reject(new Error('Setup interface is closed.'));
      if (!interactive) return Promise.reject(new Error('Interactive selection needs a terminal. Use --yes or explicit --sources/--apps.'));
      if (selection) return Promise.reject(new Error('Another setup selection is active.'));
      return new Promise((resolve, reject) => {
        selection = { choices, selected: new Set(defaults), title, focus: 0, min, error: '', resolve, reject };
        paint();
      });
    },
    async suspend(task) {
      suspended = true;
      clearInterval(timer);
      detach();
      output.write(LEAVE);
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
