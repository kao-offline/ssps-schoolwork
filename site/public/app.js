const commands = { windows: 'irm https://sspsmcp.kaooffline.top/install.ps1 | iex', unix: 'curl -fsSL https://sspsmcp.kaooffline.top/install.sh | bash' };
const code = document.querySelector('#install-command');
const status = document.querySelector('#copy-status');
for (const button of document.querySelectorAll('[data-os]')) button.addEventListener('click', () => {
  for (const item of document.querySelectorAll('[data-os]')) item.setAttribute('aria-pressed', String(item === button));
  code.textContent = commands[button.dataset.os];
  document.querySelector('#terminal-name').textContent = button.dataset.os === 'windows' ? 'PowerShell' : 'Terminal';
  document.querySelector('#inspect-script').href = button.dataset.os === 'windows' ? '/install.ps1' : '/install.sh';
  status.textContent = '';
});
document.querySelector('#copy-command').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(code.textContent); status.textContent = 'Copied. Paste into your terminal to begin.'; }
  catch { const range = document.createRange(); range.selectNodeContents(code); const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); status.textContent = 'Select and copy the command, then paste into your terminal.'; }
});
