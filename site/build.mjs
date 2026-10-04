import { execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: new URL('..', import.meta.url), encoding: 'utf8' }).trim();
const output = new URL('build/', import.meta.url);
await mkdir(output, { recursive: true });
await cp(new URL('public/', import.meta.url), output, { recursive: true });
for (const name of ['install.ps1', 'install.sh']) {
  const target = new URL(name, output);
  const source = await readFile(target, 'utf8');
  const marker = name === 'install.ps1' ? "$SspsRevision = 'main'" : "ssps_revision='main'";
  if (!source.includes(marker)) throw new Error('Installer release marker missing.');
  await writeFile(target, source.replace(marker, marker.replace('main', revision)));
}
await writeFile(new URL('health.json', output), JSON.stringify({ service: 'sspsmcp-install', revision, accountDataHosted: false }) + '\n');
console.log('Static install site prepared for revision ' + revision.slice(0, 8));
