import { readFile, writeFile, rename } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { loadSecret } from './store.js';
import { protectedBackup } from './setup-agents.js';
async function main() {
  const name = process.argv[2];
  if (!/^setup-backup-[a-f0-9]{16}-\d+-[a-f0-9]{8}$/.test(name || '')) throw new Error('Supply a setup-backup name from the local setup report.');
  const backup = await loadSecret<{ path: string; contentBase64: string }>(name);
  if (!backup || !isAbsolute(backup.path) || typeof backup.contentBase64 !== 'string') throw new Error('Backup is missing or invalid.');
  const previous = await readFile(backup.path);
  const recovery = await protectedBackup(backup.path, previous);
  const bytes = Buffer.from(backup.contentBase64, 'base64');
  const temporary = backup.path + '.' + randomUUID();
  await writeFile(temporary, bytes, { mode: 0o600 });
  await rename(temporary, backup.path);
  if (!(await readFile(backup.path)).equals(bytes)) throw new Error('Restore read-back failed.');
  console.log(JSON.stringify({ restored: backup.path, previousStateBackup: recovery }));
}
main().catch(() => { console.error('Restore failed. Check the backup name and local file permissions. Credential/configuration content was not printed.'); process.exitCode = 1; });
