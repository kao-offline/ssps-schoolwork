import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { createTui, runTui } from '../scripts/tui.mjs';
import { parseSelection } from '../scripts/setup-choices.mjs';

test('setup choices support defaults, numbers, IDs and validation', () => {
  const choices = [{ id: 'teams' }, { id: 'bakalari' }, { id: 'discord' }];
  assert.deepEqual(parseSelection('', choices, ['teams']), ['teams']);
  assert.deepEqual(parseSelection('1,3,teams', choices, []), ['teams', 'discord']);
  assert.deepEqual(parseSelection('all', choices, []), ['teams', 'bakalari', 'discord']);
  for (const value of ['0', '4', 'unknown', 'all,1']) assert.throws(() => parseSelection(value, choices, []));
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
    // eslint-disable-next-line no-control-regex -- strip terminal formatting for layout assertions
    const frame = output.frames.at(-1)!.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '');
    assert.ok(frame.includes('✓ Install dependencies'));
    assert.ok(frame.split('\n').every(line => Array.from(line).length < output.columns));
    assert.ok(frame.split('\n').length <= output.rows);
    await assert.rejects(ui.suspend(async () => { throw new Error('sign-in failed'); }), /sign-in failed/);
    ui.stop();
    const length = output.frames.length;
    ui.stop(); output.emit('resize');
    assert.equal(output.frames.length, length);
    assert.equal(output.frames.at(-1), '\x1b[?25h\x1b[?1049l');
    assert.equal(process.listenerCount('SIGINT'), before);
  } finally { ui.stop(); }
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
