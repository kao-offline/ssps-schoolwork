import { stripVTControlCharacters } from 'node:util';

const theme = {
  base: '\x1b[38;2;203;213;225m\x1b[48;2;15;23;42m',
  muted: '\x1b[38;2;148;163;184m\x1b[48;2;15;23;42m',
  cyan: '\x1b[1m\x1b[38;2;34;211;238m\x1b[48;2;15;23;42m',
  green: '\x1b[38;2;74;222;128m\x1b[48;2;15;23;42m',
  red: '\x1b[38;2;251;113;133m\x1b[48;2;15;23;42m',
  amber: '\x1b[38;2;251;191;36m\x1b[48;2;15;23;42m',
  purple: '\x1b[38;2;192;132;252m\x1b[48;2;15;23;42m',
  selected: '\x1b[1m\x1b[38;2;15;23;42m\x1b[48;2;34;211;238m',
};
export const cleanText = text => stripVTControlCharacters(String(text)).replace(/[\p{Cc}\p{Cf}]/gu, ' ');
const marks = { done: '✓', fail: '✕', warn: '!', pending: '○', active: '◉' };
const colors = { done: 'green', fail: 'red', warn: 'amber', pending: 'muted', active: 'cyan' };

// A bounded cell canvas keeps layouts and mouse hit areas in the same coordinates.
export function renderDashboard({ width = 80, height = 24, steps = [], checks = [], logs = [], active = -1, focused = active, elapsed = 0, progress, selection, logOffset = 0 }) {
  width = Math.max(1, width - 1);
  height = Math.max(1, height - 1);
  const rows = Array.from({ length: height }, () => Array.from({ length: width }, () => ({ char: ' ', color: 'base' })));
  const targets = [];
  function put(x, y, text, color = 'base', max = width - x) {
    if (y < 0 || y >= height) return;
    for (const char of Array.from(cleanText(text)).slice(0, Math.max(0, max))) {
      if (x >= 0 && x < width) rows[y][x] = { char, color };
      x++;
    }
  }
  function panel(x, y, w, h, title, color = 'muted') {
    if (w < 4 || h < 3) return;
    put(x, y, '╭' + '─'.repeat(w - 2) + '╮', color, w);
    put(x, y + h - 1, '╰' + '─'.repeat(w - 2) + '╯', color, w);
    for (let row = y + 1; row < y + h - 1; row++) { put(x, row, '│', color); put(x + w - 1, row, '│', color); }
    put(x + 2, y, ' ' + title + ' ', color, w - 4);
  }
  function button(x, y, label, action, selected = false) {
    const text = `[ ${label} ]`;
    put(x, y, text, selected ? 'selected' : 'cyan');
    targets.push({ x, y, width: Math.min(text.length, width - x), height: 1, action });
  }
  if (width < 28 || height < 9) {
    put(0, 0, 'SSPS / MCP', 'cyan');
    put(0, 2, 'Resize terminal to 30 x 10', 'amber');
    put(0, height - 1, 'Ctrl+C: exit', 'muted');
  } else {
    const wide = width >= 90;
    put(1, 0, 'SSPS / MCP', 'cyan');
    put(15, 0, selection ? 'CONFIGURE YOUR WORKSPACE' : 'LOCAL INSTALLER', 'purple');
    if (width >= 60) button(width - 10, 0, 'Exit', 'quit');
    put(1, 1, 'School context, connected. Accounts and cache stay on your computer.', 'muted');
    const done = steps.filter(step => step.state === 'done').length;
    put(1, 2, selection ? `${selection.selected.size} selected  •  Click a row to toggle` : `${done}/${steps.length} steps complete  •  ${elapsed}s elapsed`, 'green');
    const top = 4;
    const bodyHeight = height - top - 2;
    const leftWidth = wide ? Math.max(34, Math.floor(width * 0.38)) : width;
    if (selection) {
      panel(0, top, leftWidth, bodyHeight, selection.title, 'cyan');
      const visible = Math.max(1, bodyHeight - 5);
      const start = Math.min(Math.max(0, selection.focus - visible + 1), Math.max(0, selection.choices.length - visible));
      selection.choices.slice(start, start + visible).forEach((choice, index) => {
        const position = start + index;
        const y = top + 1 + index;
        const checked = selection.selected.has(choice.id);
        put(2, y, `${checked ? '[✓]' : '[ ]'} ${choice.name}`, position === selection.focus ? 'selected' : checked ? 'green' : 'base', leftWidth - 4);
        targets.push({ x: 1, y, width: leftWidth - 2, height: 1, action: 'toggle', index: position });
      });
      put(2, top + bodyHeight - 3, selection.error || `${start + 1}–${Math.min(start + visible, selection.choices.length)} of ${selection.choices.length}`, selection.error ? 'red' : 'muted', leftWidth - 4);
      button(2, top + bodyHeight - 2, 'Continue', 'continue', true);
      if (leftWidth >= 38) { button(17, top + bodyHeight - 2, 'All', 'all'); button(27, top + bodyHeight - 2, 'None', 'none'); }
      if (wide) {
        const x = leftWidth + 2, w = width - x;
        panel(x, top, w, bodyHeight, ' CONNECTION DETAILS ', 'purple');
        const choice = selection.choices[selection.focus];
        put(x + 2, top + 2, choice?.name || 'Choose connections', 'cyan', w - 4);
        const description = choice?.description || 'Configure the selected app with MCP tools and skills.';
        const words = cleanText(description).split(' ');
        let line = '', y = top + 4;
        for (const word of words) {
          if (line.length + word.length + 1 > w - 4) { put(x + 2, y++, line, 'base', w - 4); line = ''; }
          line += (line ? ' ' : '') + word;
        }
        if (y < top + bodyHeight - 3) put(x + 2, y, line, 'base', w - 4);
        put(x + 2, top + bodyHeight - 3, 'Existing settings and sign-ins are preserved.', 'green', w - 4);
      } else {
        const choice = selection.choices[selection.focus];
        const y = top + Math.min(visible, selection.choices.length) + 2;
        if (y < top + bodyHeight - 3) put(2, y, choice?.description || 'Existing app settings are preserved.', 'muted', leftWidth - 4);
      }
    } else {
      const checklistHeight = wide ? bodyHeight : Math.min(bodyHeight, Math.max(4, steps.length + 3));
      panel(0, top, leftWidth, checklistHeight, ' INSTALLATION ', 'cyan');
      const visible = Math.max(1, checklistHeight - 2);
      const start = Math.max(0, Math.min(focused - visible + 1, steps.length - visible));
      steps.slice(start, start + visible).forEach((step, index) => {
        const position = start + index, y = top + 1 + index;
        put(2, y, `${marks[step.state] || '○'} ${step.label.replace(/\[\d\/\d\] /g, '')}`, colors[step.state], leftWidth - 4);
        targets.push({ x: 1, y, width: leftWidth - 2, height: 1, action: 'step', index: position });
      });
      if (wide) {
        const x = leftWidth + 2, w = width - x;
        const checkHeight = Math.min(bodyHeight - 4, Math.max(4, checks.length + 2));
        panel(x, top, w, checkHeight, ' SYSTEM CHECKS ', 'purple');
        checks.slice(0, checkHeight - 2).forEach((check, index) => put(x + 2, top + 1 + index, `${marks[check.state] || '○'} ${check.name.padEnd(10)} ${check.detail || 'Checking…'}`, colors[check.state], w - 4));
        const logTop = top + checkHeight;
        panel(x, logTop, w, bodyHeight - checkHeight, ' LIVE OUTPUT ', 'muted');
        const step = steps[focused];
        put(x + 2, logTop + 1, step?.detail || 'Preparing your local workspace…', 'cyan', w - 4);
        if (progress) put(x + 2, logTop + 2, `${progress.completed}/${progress.total}  ${progress.extra || ''}`, 'green', w - 4);
        const count = Math.max(0, bodyHeight - checkHeight - 4);
        const end = Math.max(0, logs.length - logOffset);
        logs.slice(Math.max(0, end - count), end).forEach((line, index) => put(x + 2, logTop + 3 + index, line, 'muted', w - 4));
      } else if (bodyHeight > checklistHeight + 2) {
        const y = top + checklistHeight;
        const room = bodyHeight - checklistHeight - 2;
        panel(0, y, width, bodyHeight - checklistHeight, ' SYSTEM / LIVE OUTPUT ', 'purple');
        put(2, y + 1, progress ? `${progress.completed}/${progress.total}  ${progress.extra || ''}` : steps[focused]?.detail || 'Checking local requirements…', 'cyan', width - 4);
        const checkCount = Math.min(checks.length, Math.max(0, room - 2));
        checks.slice(0, checkCount).forEach((check, index) => put(2, y + 2 + index, `${marks[check.state]} ${check.name.padEnd(10)} ${check.detail}`, colors[check.state], width - 4));
        const logCount = Math.max(0, room - checkCount - 1);
        const end = Math.max(0, logs.length - logOffset);
        logs.slice(Math.max(0, end - logCount), end).forEach((line, index) => put(2, y + 2 + checkCount + index, line, 'muted', width - 4));
      }
    }
    put(1, height - 1, selection ? '↑↓ Move  Space Toggle  Enter Continue  A All  N None  Ctrl+C Exit' : 'Click a step: details  •  Mouse wheel: logs  •  Ctrl+C Exit', 'muted');
  }
  const lines = rows.map(row => {
    let color, text = '';
    for (const cell of row) { if (color !== cell.color) { color = cell.color; text += '\x1b[0m' + theme[color]; } text += cell.char; }
    return text + '\x1b[0m';
  });
  return { text: '\x1b[H' + lines.join('\r\n'), targets };
}

// SGR mouse events and split keyboard escape sequences share a buffered decoder.
export function decodeTerminalInput(buffer) {
  const events = [];
  while (buffer) {
    if (buffer[0] !== '\x1b') {
      const char = buffer[0]; buffer = buffer.slice(1);
      events.push({ type: 'key', key: char === '\x03' ? 'cancel' : /[\r\n]/.test(char) ? 'enter' : char === ' ' ? 'space' : char === '\t' ? 'down' : char.toLowerCase() });
      continue;
    }
    const mouse = buffer.match(/^\x1b\[<(\d+);(\d+);(\d+)([Mm])/);
    if (mouse) {
      buffer = buffer.slice(mouse[0].length);
      const code = Number(mouse[1]);
      if (code >= 64 && code < 66) events.push({ type: 'key', key: code === 64 ? 'up' : 'down' });
      else if (mouse[4] === 'M' && code === 0) events.push({ type: 'click', x: Number(mouse[2]) - 1, y: Number(mouse[3]) - 1 });
      continue;
    }
    const key = buffer.match(/^\x1b\[(?:([ABCD])|([56])~|Z)/);
    if (key) { events.push({ type: 'key', key: key[1] ? ({ A: 'up', B: 'down', C: 'right', D: 'left' })[key[1]] : key[2] === '5' ? 'pageup' : key[2] === '6' ? 'pagedown' : 'up' }); buffer = buffer.slice(key[0].length); continue; }
    if (/^\x1b(?:\[(?:<\d*(?:;\d*){0,2}|\d*)?)?$/.test(buffer)) break;
    buffer = buffer.slice(1);
  }
  return { events, remaining: buffer };
}
