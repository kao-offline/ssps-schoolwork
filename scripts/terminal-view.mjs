import { stripVTControlCharacters } from 'node:util';
const theme = {
  base: '\x1b[38;2;222;224;232m\x1b[48;2;18;19;26m',
  muted: '\x1b[38;2;119;125;145m\x1b[48;2;18;19;26m',
  cyan: '\x1b[1m\x1b[38;2;167;139;250m\x1b[48;2;18;19;26m',
  green: '\x1b[38;2;134;239;172m\x1b[48;2;18;19;26m',
  red: '\x1b[38;2;251;113;133m\x1b[48;2;18;19;26m',
  selected: '\x1b[1m\x1b[38;2;18;19;26m\x1b[48;2;167;139;250m',
};
export const cleanText = text => stripVTControlCharacters(String(text)).replace(/[\p{Cc}\p{Cf}]/gu, ' ');
const marks = { done: '✓', fail: '✕', warn: '!', pending: '·', active: '›' };
const colors = { done: 'green', fail: 'red', warn: 'muted', pending: 'muted', active: 'cyan' };
export function renderDashboard({ width = 80, height = 24, steps = [], checks = [], logs = [], focused = -1, elapsed = 0, progress, selection, prompt, message, screen = 'prepare', logOffset = 0 }) {
  width = Math.max(1, width - 1); height = Math.max(1, height - 1);
  const rows = Array.from({ length: height }, () => Array.from({ length: width }, () => ({ char: ' ', color: 'base' })));
  const targets = [];
  function put(x, y, text, color = 'base', max = width - x) {
    if (y < 0 || y >= height) return;
    for (const char of Array.from(cleanText(text)).slice(0, Math.max(0, max))) { if (x >= 0 && x < width) rows[y][x] = { char, color }; x++; }
  }
  function button(x, y, label, action, selected = false) {
    const text = `[ ${label} ]`; put(x, y, text, selected ? 'selected' : 'cyan');
    if (x < width && y >= 0 && y < height) targets.push({ x, y, width: Math.min(text.length, width - x), height: 1, action });
  }
  if (width < 28 || height < 9) {
    put(0, 0, 'SSPS MCP', 'cyan'); put(0, 2, 'Resize terminal to 30 x 10', 'muted'); put(0, height - 1, 'Ctrl+C: exit', 'muted');
  } else {
    const pad = width >= 60 ? 4 : 1, span = width - pad * 2;
    put(pad, 1, 'S S P S   /   M C P', 'cyan');
    if (width >= 60) put(width - 25, 1, 'YOUR LOCAL WORKSPACE', 'muted', 22);
    put(pad, 3, '01  Configure     02  Install     03  Ready', 'muted', span);
    put(pad, 4, '─'.repeat(span), 'muted');
    const title = prompt?.title || selection?.title || message?.title || (screen === 'install' ? 'Connecting your school life.' : 'Preparing your workspace.');
    const contentTop = height < 18 ? 4 : 8;
    put(pad, contentTop - 2, title, 'cyan', span);
    const bottom = height - 3;
    if (prompt) {
      put(pad, 8, prompt.description || (prompt.secret ? 'Hidden input. Your password is never saved.' : 'Type below, then press Enter.'), 'muted', span);
      put(pad, 10, '> ' + (prompt.secret ? '•'.repeat(Array.from(prompt.value).length) : prompt.value) + '▌', 'base', span);
      put(pad, bottom - 1, prompt.error || '', 'red', span);
      button(pad, bottom, 'Continue', 'submit', true);
    } else if (selection) {
      const visible = Math.max(1, bottom - contentTop - 2);
      const start = Math.min(Math.max(0, selection.focus - visible + 1), Math.max(0, selection.choices.length - visible));
      selection.choices.slice(start, start + visible).forEach((choice, index) => {
        const position = start + index, y = contentTop + index, checked = selection.selected.has(choice.id);
        put(pad, y, `${checked ? '●' : '○'}  ${choice.name}`, position === selection.focus ? 'selected' : checked ? 'green' : 'base', span);
        targets.push({ x: pad, y, width: span, height: 1, action: 'toggle', index: position });
      });
      put(pad, bottom - 2, selection.error || selection.choices[selection.focus]?.description || '', selection.error ? 'red' : 'muted', span);
      put(pad, bottom - 1, `${selection.selected.size} selected · ${selection.choices.length} options`, 'muted', span);
      button(pad, bottom, selection.button || 'Continue', 'continue', true);
    } else if (message) {
      message.lines.slice(0, Math.max(1, bottom - contentTop - 1)).forEach((line, i) => put(pad, contentTop + i, line, 'base', span));
      button(pad, bottom, message.button || 'Done', 'dismiss', true);
    } else {
      const wide = width >= 90, left = wide ? Math.floor(span * 0.55) : span;
      const visible = Math.max(1, bottom - contentTop - 2);
      const start = Math.max(0, Math.min(focused - visible + 1, steps.length - visible));
      steps.slice(start, start + visible).forEach((step, i) => {
        const y = contentTop + i; put(pad, y, `${marks[step.state] || '·'} ${step.label.replace(/\[\d\/\d\] /g, '')}`, colors[step.state] || 'base', left);
        targets.push({ x: pad, y, width: left, height: 1, action: 'step', index: start + i });
      });
      if (wide) {
        const x = pad + left + 2, w = span - left - 2;
        put(x, contentTop, 'SYSTEM CHECKS', 'muted', w);
        checks.slice(0, Math.max(0, visible - 2)).forEach((check, i) => put(x, contentTop + 2 + i, `${marks[check.state] || '·'} ${check.name}  ${check.detail}`, colors[check.state] || 'muted', w));
      }
      put(pad, bottom - 2, steps[focused]?.detail || 'Getting things ready…', 'muted', span);
      const total = progress?.total || steps.length || 1;
      const done = progress?.completed ?? steps.filter(s => s.state === 'done').length;
      const length = Math.max(4, Math.min(30, span - 18));
      const filled = Math.max(0, Math.min(length, Math.round(done / total * length)));
      put(pad, bottom - 1, '━'.repeat(filled) + '─'.repeat(length - filled) + `  ${done}/${total} · ${elapsed}s`, 'cyan', span);
      put(pad, bottom, progress?.extra || (logOffset ? logs.at(-logOffset) : '') || 'Sign-ins open in Chrome. This installer stays here.', 'muted', span);
    }
    put(pad, height - 1, prompt ? 'Enter Continue · Backspace Edit · Ctrl+C Exit' : selection ? '↑↓ Move · Space Select · Enter Continue · Ctrl+C Exit' : message ? 'Enter Done · Ctrl+C Exit' : '↑↓ Details · Ctrl+C Exit', 'muted', span);
  }
  const lines = rows.map(row => { let color, text = ''; for (const cell of row) { if (color !== cell.color) { color = cell.color; text += '\x1b[0m' + theme[color]; } text += cell.char; } return text + '\x1b[0m'; });
  return { text: '\x1b[H' + lines.join('\r\n'), targets };
}
export function decodeTerminalInput(buffer) {
  const events = [];
  while (buffer) {
    if (buffer[0] !== '\x1b') {
      const char = Array.from(buffer)[0]; buffer = buffer.slice(char.length);
      events.push({ type: 'key', ...(!/[\p{Cc}\p{Cf}]/u.test(char) ? { text: char } : {}), key: char === '\x03' ? 'cancel' : /[\r\n]/.test(char) ? 'enter' : /[\x7f\b]/.test(char) ? 'backspace' : char === ' ' ? 'space' : char === '\t' ? 'down' : char.toLowerCase() }); continue;
    }
    const mouse = buffer.match(/^\x1b\[<(\d+);(\d+);(\d+)([Mm])/);
    if (mouse) { buffer = buffer.slice(mouse[0].length); const code = Number(mouse[1]); if (code >= 64 && code < 66) events.push({ type: 'key', key: code === 64 ? 'up' : 'down' }); else if (mouse[4] === 'M' && code === 0) events.push({ type: 'click', x: Number(mouse[2]) - 1, y: Number(mouse[3]) - 1 }); continue; }
    const key = buffer.match(/^\x1b\[(?:([ABCD])|([56])~|Z)/);
    if (key) { events.push({ type: 'key', key: key[1] ? ({ A: 'up', B: 'down', C: 'right', D: 'left' })[key[1]] : key[2] === '5' ? 'pageup' : key[2] === '6' ? 'pagedown' : 'up' }); buffer = buffer.slice(key[0].length); continue; }
    if (/^\x1b(?:\[(?:<\d*(?:;\d*){0,2}|\d*)?)?$/.test(buffer)) break;
    buffer = buffer.slice(1);
  }
  return { events, remaining: buffer };
}
