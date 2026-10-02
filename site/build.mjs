import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: new URL('..', import.meta.url), encoding: 'utf8' }).trim();
await writeFile(new URL('public/health.json', import.meta.url), JSON.stringify({ service: 'sspsmcp-install', revision, accountDataHosted: false }) + '\n');
console.log('Static install site prepared for revision ' + revision.slice(0, 8));
