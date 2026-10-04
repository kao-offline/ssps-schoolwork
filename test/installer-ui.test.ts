import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { createTui, runTui, tuiEnabled } from '../scripts/tui.mjs';
import { parseSelection } from '../scripts/setup-choices.mjs';
import { renderDashboard, decodeTerminalInput } from '../scripts/terminal-view.mjs';
import { checkPrerequisites, supportedNode, supportedMouse, chromeCandidates } from '../scripts/setup-prerequisites.mjs';
import { stripVTControlCharacters } from 'node:util';
import { mkdtemp, mkdir, cp, symlink, readFile, rm, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

test('setup choices support defaults, numbers, IDs and validation', () => {
  const choices = [{ id: 'teams' }, { id: 'bakalari' }, { id: 'discord' }];
  assert.deepEqual(parseSelection('', choices, ['teams']), ['teams']);
  assert.deepEqual(parseSelection('1,3,teams', choices, []), ['teams', 'discord']);
  assert.deepEqual(parseSelection('all', choices, []), ['teams', 'bakalari', 'discord']);
  for (const value of ['0', '4', 'unknown', 'all,1']) assert.throws(() => parseSelection(value, choices, []));
});

test('explicit TUI mode overrides terminal color hints while redirected output stays plain', () => {
  const output = { isTTY: true };
  const env = { NO_COLOR: '1', TERM: 'dumb' };
  assert.equal(tuiEnabled({ output, env }), false);
  assert.equal(tuiEnabled({ output, env, force: true }), true);
  assert.equal(tuiEnabled({ output: { isTTY: false }, env, force: true }), false);
});

test('dashboard fits small terminals, keeps completed steps and restores terminal once', async () => {
  const output = Object.assign(new EventEmitter(), { columns: 32, rows: 12, frames: [] as string[], write(text: string) { this.frames.push(text); } });
  const before = process.listenerCount('SIGINT');
  const ui = createTui({ output, enabled: true })!;
  try {
    const first = ui.step('Install dependencies');
    const second = ui.step('Connect accounts');
    ui.run(first); ui.ok(first); ui.run(second, 'A long detail '.repeat(20));
    ui.bar(100, 1, 'progress');
    ui.log('log '.repeat(100));
    const frame = stripVTControlCharacters(output.frames.at(-1)!);
    assert.ok(frame.includes('✓ Install dependencies'));
    assert.ok(frame.split('\r\n').every(line => Array.from(line).length < output.columns));
    assert.ok(frame.split('\n').length <= output.rows);
    assert.equal(output.frames.filter(value => value.includes('\x1b[?1049h')).length, 1);
    ui.stop();
    const length = output.frames.length;
    ui.stop(); output.emit('resize');
    assert.equal(output.frames.length, length);
    assert.ok(output.frames.at(-1)!.endsWith('\x1b[?25h\x1b[?1049l'));
    assert.ok(output.frames.at(-1)!.includes('\x1b[?1006l'));
    assert.equal(process.listenerCount('SIGINT'), before);
  } finally { ui.stop(); }
});

function terminalInput() {
  return Object.assign(new EventEmitter(), { isTTY: true, isRaw: false, paused: true, setRawMode(value: boolean) { this.isRaw = value; }, isPaused() { return this.paused; }, resume() { this.paused = false; }, pause() { this.paused = true; } });
}

test('mouse clicks, wheel scrolling and keyboard selection work with real terminal escape sequences', async () => {
  const input = terminalInput();
  const output = Object.assign(new EventEmitter(), { columns: 110, rows: 28, frames: [] as string[], write(text: string) { this.frames.push(text); } });
  const ui = createTui({ input, output, enabled: true })!;
  const choices = Array.from({ length: 20 }, (_, index) => ({ id: 'app' + index, name: 'App ' + index }));
  try {
    const result = ui.select(choices, ['app0'], 'AGENTS');
    assert.equal(input.isRaw, true);
    const view = renderDashboard({ width: output.columns, height: output.rows, selection: { choices, selected: new Set(['app0']), title: 'AGENTS', focus: 0 } });
    const second = view.targets.find(target => target.action === 'toggle' && target.index === 1)!;
    // A fragmented SGR event must not toggle until the entire event arrives.
    input.emit('data', `\x1b[<0;${second.x + 1};`);
    input.emit('data', `${second.y + 1}M`);
    input.emit('data', '\x1b[<65;4;8M'); // wheel down focuses the next row
    input.emit('data', ' '); // toggle App 2
    input.emit('data', '\x1b[B'.repeat(17)); // scroll the long list
    assert.ok(stripVTControlCharacters(output.frames.at(-1)!).includes('App 19'));
    input.emit('data', '\r');
    assert.deepEqual(await result, ['app0', 'app1', 'app2']);
    assert.ok(output.frames.some(frame => frame.includes('\x1b[?1000h')));
    assert.ok(output.frames.some(frame => frame.includes('\x1b[48;2;167;139;250m')));
    assert.equal(output.frames.filter(value => value.includes('\x1b[?1049h')).length, 1);
    assert.equal(input.isRaw, true);
  } finally { ui.stop(); }
  assert.equal(input.isRaw, false);
  assert.equal(input.paused, true);
  assert.equal(input.listenerCount('data'), 0);
});

test('Continue button enforces required selection and accepts mouse activation', async () => {
  const input = terminalInput();
  const output = Object.assign(new EventEmitter(), { columns: 100, rows: 24, last: '', write(text: string) { this.last = text; } });
  const ui = createTui({ input, output, enabled: true })!;
  try {
    const choices = [{ id: 'teams', name: 'Teams' }];
    const result = ui.select(choices, [], 'SOURCES');
    const view = renderDashboard({ width: 100, height: 24, selection: { choices, selected: new Set(), title: 'SOURCES', focus: 0 } });
    const button = view.targets.find(target => target.action === 'continue')!;
    const click = (target: any) => input.emit('data', `\x1b[<0;${target.x + 1};${target.y + 1}M`);
    click(button);
    assert.ok(stripVTControlCharacters(output.last).includes('Select at least one option'));
    click(view.targets.find(target => target.action === 'toggle'));
    click(button);
    assert.deepEqual(await result, ['teams']);
  } finally { ui.stop(); }
});

test('single-choice class half and language switch directly with keyboard and mouse', async () => {
  const input = terminalInput();
  const output = Object.assign(new EventEmitter(), { columns: 100, rows: 24, write() {} });
  const ui = createTui({ input, output, enabled: true })!;
  try {
    const halves = [{ id: 'SK1', name: 'SK1' }, { id: 'SK2', name: 'SK2' }];
    const half = ui.select(halves, ['SK1'], 'Your class half', { min: 1, max: 1 });
    input.emit('data', '\x1b[B \r');
    assert.deepEqual(await half, ['SK2']);
    const languages = [{ id: 'NJ', name: 'Němčina' }, { id: 'SJ', name: 'Španělština' }];
    const language = ui.select(languages, ['NJ'], 'Your language', { min: 0, max: 1 });
    const view = renderDashboard({ width: 100, height: 24, selection: { choices: languages, selected: new Set(['NJ']), title: 'Your language', focus: 0 } });
    const target = view.targets.find(target => target.action === 'toggle' && target.index === 1)!;
    input.emit('data', `\x1b[<0;${target.x + 1};${target.y + 1}M`);
    input.emit('data', '\r');
    assert.deepEqual(await language, ['SJ']);
  } finally { ui.stop(); }
});

test('responsive layouts bound cells and mouse targets across sizes', () => {
  for (const [width, height] of [[110, 30], [80, 24], [32, 12], [20, 5]]) {
    const view = renderDashboard({ width, height, steps: [{ label: 'Install dependencies', state: 'done' }], checks: [{ name: 'Chrome', state: 'fail', detail: 'Missing' }], logs: ['long output '.repeat(100)] });
    const lines = stripVTControlCharacters(view.text).split('\r\n');
    assert.equal(lines.length, height - 1);
    assert.ok(lines.every(line => Array.from(line).length === width - 1));
    assert.ok(view.targets.every(target => target.x >= 0 && target.y >= 0 && target.x + target.width < width && target.y + target.height < height));
    if (width >= 90) assert.ok(lines.join('\n').includes('SYSTEM CHECKS'));
  }
});

test('decoder ignores mouse release and buffers split arrows', () => {
  const first = decodeTerminalInput('\x1b[');
  assert.equal(first.events.length, 0);
  assert.deepEqual(decodeTerminalInput(first.remaining + 'B').events, [{ type: 'key', key: 'down' }]);
  assert.equal(decodeTerminalInput('\x1b[<0;2;3m').events.length, 0);
  assert.deepEqual(decodeTerminalInput('\x03').events, [{ type: 'key', key: 'cancel' }]);
});

test('cancelling selection restores raw mode, mouse mode and input ownership', async () => {
  const input = terminalInput();
  const output = Object.assign(new EventEmitter(), { columns: 80, rows: 24, last: '', write(text: string) { this.last = text; } });
  let code = 0;
  const ui = createTui({ input, output, enabled: true, exit: (value: number) => { code = value; } })!;
  const pending = ui.select([{ id: 'teams', name: 'Teams' }], ['teams'], 'SOURCES');
  const rejected = assert.rejects(pending, /cancelled/);
  input.emit('data', '\x03');
  await rejected;
  assert.equal(code, 130);
  assert.equal(input.isRaw, false);
  assert.equal(input.listenerCount('data'), 0);
  assert.ok(output.last.includes('\x1b[?1000l\x1b[?1006l'));
});

test('fresh stdin is paused after completion so the installer can exit', () => {
  const input = Object.assign(terminalInput(), { readableFlowing: null, paused: false });
  const output = Object.assign(new EventEmitter(), { columns: 80, rows: 24, write() {} });
  const ui = createTui({ input, output, enabled: true })!;
  ui.stop();
  assert.equal(input.paused, true);
  assert.equal(input.listenerCount('data'), 0);
});

test('real installer checks dependencies and installs an isolated agent profile without school sign-in', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ssps-installer-e2e-'));
  const project = join(directory, 'project');
  const agent = join(directory, 'grok-profile');
  const execute = promisify(execFile);
  try {
    await mkdir(project);
    for (const name of ['scripts', 'dist', 'skills']) await cp(resolve(name), join(project, name), { recursive: true });
    for (const name of ['package-lock.json', '.env.example']) await copyFile(resolve(name), join(project, name));
    // Link dependency packages individually; setup's stamp stays inside the fixture.
    const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
    for (const name of Object.keys({ ...lock.packages[''].dependencies, ...lock.packages[''].devDependencies })) {
      const target = join(project, 'node_modules', name);
      await mkdir(dirname(target), { recursive: true });
      await symlink(resolve('node_modules', name), target, process.platform === 'win32' ? 'junction' : 'dir');
    }
    const result = await execute(process.execPath, [join(project, 'scripts/setup.mjs'), '--agents-only', '--yes', '--apps=grok', '--sources=bakalari'], { env: { ...process.env, GROK_HOME: agent, SCHOOLWORK_DATA_DIR: join(directory, 'data') }, timeout: 30000, windowsHide: true });
    assert.match(result.stdout, /Node.js:/);
    assert.match(result.stdout, /npm:/);
    assert.match(result.stdout, /Git:/);
    assert.match(result.stdout, /ready: 1 apps/);
    assert.ok(!result.stdout.includes('\x1b[?1049h'));
    const installed = await readFile(join(agent, 'config.toml'), 'utf8');
    assert.match(installed, /schoolwork/);
    assert.match(await readFile(join(agent, 'skills/class-schoolwork/SKILL.md'), 'utf8'), /read_context_bundle/);
    const report = JSON.parse(await readFile(join(project, 'setup-report.local.json'), 'utf8'));
    assert.equal(report.failures.length, 0);
    assert.equal(report.workers.length, 0);
    assert.equal(report.installed[0].config, join(agent, 'config.toml'));
    const script = `
      import {EventEmitter} from 'node:events';
      import {createTui} from ${JSON.stringify(new URL('../scripts/tui.mjs', import.meta.url).href)};
      import {runSetup} from ${JSON.stringify(new URL('file:///' + join(project, 'scripts/setup-runner.mjs').replaceAll('\\', '/')).href)};
      globalThis.fetch = async () => new Response('<h1>Tasks View - 2.B SSPŠ</h1><input id="filter_checkbox_group_sk2" value="sk2"><div class="tasks"><div class="task"><div class="task-date">7.10.2026</div><div class="task-name">PDV</div><div class="task-groups">sk2</div><div class="task-description">Presentation</div></div></div>');
      const input=Object.assign(new EventEmitter(),{isTTY:true,setRawMode(){},resume(){},pause(){},isPaused(){return true}});
      const frames=[];const output=Object.assign(new EventEmitter(),{columns:100,rows:28,write(value){frames.push(value)}});
      const ui=createTui({input,output,enabled:true});
      const message=ui.message.bind(ui);ui.message=(...args)=>{const pending=message(...args);setImmediate(()=>input.emit('data','\\r'));return pending};
      await runSetup({ui,flags:['--agents-only','--yes','--apps=grok','--sources=bakalari','--2b','--groups=sk2','--subjects=PDV']});
      ui.stop();
      console.log(JSON.stringify({entered:frames.filter(f=>f.includes('\\x1b[?1049h')).length,left:frames.filter(f=>f.includes('\\x1b[?1049l')).length,ready:frames.some(f=>f.includes('Your workspace is connected.'))}));
    `;
    const fullScreen = await execute(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env, GROK_HOME: agent, SCHOOLWORK_DATA_DIR: join(directory, 'data') }, timeout: 30000, windowsHide: true });
    assert.deepEqual(JSON.parse(fullScreen.stdout), { entered: 1, left: 1, ready: true });
    const moduleReport = JSON.parse(await readFile(join(project, 'setup-report.local.json'), 'utf8'));
    assert.deepEqual(moduleReport.module2B.groups, ['sk2']);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('dependency checks distinguish missing required software and optional browser with actionable fixes', async () => {
  assert.equal(supportedNode('22.12.0'), false);
  assert.equal(supportedNode('22.13.0'), true);
  assert.equal(supportedNode('24.0.0'), true);
  assert.equal(supportedMouse('22.13.0', 'win32'), false);
  assert.equal(supportedMouse('22.18.0', 'win32'), true);
  assert.equal(supportedMouse('24.0.0', 'win32'), false);
  assert.equal(supportedMouse('24.6.0', 'win32'), true);
  assert.equal(supportedMouse('22.13.0', 'linux'), true);
  assert.ok(chromeCandidates('win32', { LOCALAPPDATA: 'C:/fixture' })[0].endsWith('chrome.exe'));
  const run = async (command: string) => { if (command === 'git') throw new Error('missing'); return { stdout: '10.0.0\n' }; };
  const missing = await checkPrerequisites({ npmCli: '/fixture/npm.js', version: '22.13.0', run, exists: () => false, requireChrome: true });
  assert.equal(missing.ready, false);
  assert.equal(missing.checks.find((check: any) => check.name === 'Git').state, 'fail');
  assert.equal(missing.checks.find((check: any) => check.name === 'Chrome').state, 'fail');
  const ready = await checkPrerequisites({ npmCli: '/fixture/npm.js', version: '22.13.0', run: async () => ({ stdout: 'fixture version\n' }), exists: () => false });
  assert.equal(ready.ready, true);
  assert.equal(ready.checks.find((check: any) => check.name === 'Chrome').state, 'warn');
});

test('child capture keeps stderr separate and retains failure output after dashboard closes', async () => {
  const logs: string[] = [];
  await assert.rejects(runTui(spawn, { log: (line: string) => logs.push(line) }, process.execPath, ['-e', "process.stdout.write('partial stdout'); process.stderr.write('specific failure\\n'); process.exitCode=2"]), /specific failure[\s\S]*partial stdout/);
  assert.ok(logs.includes('specific failure'));
  assert.ok(logs.includes('partial stdout'));
  logs.length = 0;
  await runTui(spawn, { log: (line: string) => logs.push(line) }, process.execPath, ['-e', "process.stdout.write('success without newline')"]);
  assert.deepEqual(logs, ['success without newline']);
});

test('installer keeps one screen through hidden input, review, installation and Done', async () => {
  const input = terminalInput();
  const output = Object.assign(new EventEmitter(), { columns: 100, rows: 28, frames: [] as string[], write(value: string) { this.frames.push(value); } });
  const ui = createTui({ input, output, enabled: true })!;
  try {
    const password = ui.input('Password', { secret: true });
    input.emit('data', 'secretQé😀');
    assert.ok(output.frames.every(frame => !frame.includes('secretQ')));
    input.emit('data', '\x7f\r');
    assert.equal(await password, 'secretQé');
    const review = ui.message('Review', ['Teams, Bakalari, 2B'], 'Install');
    input.emit('data', '\r'); await review;
    ui.screen('install'); const step = ui.step('Connect accounts'); ui.run(step); ui.ok(step);
    let done = false;
    const completion = ui.message('Ready', ['Start a new agent session.']).then(() => { done = true; });
    await Promise.resolve(); assert.equal(done, false);
    input.emit('data', '\r'); await completion;
    assert.equal(output.frames.filter(frame => frame.includes('\x1b[?1049h')).length, 1);
    assert.equal(output.frames.filter(frame => frame.includes('\x1b[?1049l')).length, 0);
  } finally { ui.stop(); }
  assert.equal(output.frames.filter(frame => frame.includes('\x1b[?1049l')).length, 1);
});
