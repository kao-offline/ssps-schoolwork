import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { dataDir } from './config.js';

async function protect(input: string, decrypt = false): Promise<string> {
  if (process.platform !== 'win32') return input;
  const operation = decrypt ? 'Unprotect' : 'Protect';
  const script = `Add-Type -AssemblyName System.Security; $inputText=[Console]::In.ReadToEnd(); $bytes=[Convert]::FromBase64String($inputText); $result=[Security.Cryptography.ProtectedData]::${operation}($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($result))`;
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.resume();
    child.on('error', () => reject(new Error('Windows credential protection could not start.')));
    child.on('close', code => code === 0 ? resolve(output.trim()) : reject(new Error('Windows credential protection failed.')));
    child.stdin.end(input);
  });
}
export async function loadSecret<T>(name: string): Promise<T | undefined> {
  try {
    const text = await readFile(join(dataDir, name + '.json'), 'utf8');
    const decoded = process.platform === 'win32' ? Buffer.from(await protect(text, true), 'base64').toString('utf8') : text;
    return JSON.parse(decoded) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw new Error('Cannot read saved credentials. Log out and reconnect locally.', { cause: error });
  }
}
export async function saveSecret(name: string, value: unknown) {
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const json = JSON.stringify(value);
  const encoded = process.platform === 'win32' ? await protect(Buffer.from(json).toString('base64')) : json;
  const target = join(dataDir, name + '.json');
  const temporary = target + '.' + randomUUID();
  await writeFile(temporary, encoded, { mode: 0o600 });
  await rename(temporary, target);
}
export async function clearSecrets() {
  for (const name of ['microsoft', 'bakalari']) await rm(join(dataDir, name + '.json'), { force: true });
}
