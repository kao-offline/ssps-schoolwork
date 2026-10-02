import { readFile, readdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dataDir } from './config.js';
import { loadSecret, saveSecret } from './store.js';
import { z } from 'zod';

const sourceUrl = z.string().url().max(8192).refine(value => {
  const url = new URL(value);
  return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash &&
    (['teams.microsoft.com', 'teams.cloud.microsoft', 'www.onenote.com', 'onenote.com', 'onenote.officeapps.live.com'].includes(url.hostname) || url.hostname.endsWith('.sharepoint.com'));
}, 'Unsupported capture source URL.');
export const captureSchema = z.object({
  schemaVersion: z.literal(1), source: z.literal('teams-web-capture'),
  capturedAt: z.string().datetime().refine(value => Date.parse(value) <= Date.now() + 5 * 60_000, 'Capture time is in the future.'),
  sourceUrl, title: z.string().max(500), text: z.string().min(1).max(100000),
  scope: z.enum(['selected-text', 'rendered-main-frame']), truncated: z.boolean(), complete: z.literal(false),
}).strict();
export type Capture = z.infer<typeof captureSchema>;
export function captureId(capture: Capture) { return createHash('sha256').update(JSON.stringify(capture)).digest('hex'); }
export async function importCapture(path: string) {
  if ((await stat(path)).size > 1024 * 1024) throw new Error('Capture file exceeds 1 MiB.');
  const capture = captureSchema.parse(JSON.parse(await readFile(path, 'utf8')));
  const id = captureId(capture);
  await saveSecret('teams-capture-' + id, capture);
  return { id, characters: capture.text.length, capturedAt: capture.capturedAt, complete: false };
}
export async function readCapture(id: string) {
  if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('Invalid capture ID.');
  const saved = await loadSecret<Capture>('teams-capture-' + id);
  if (!saved) throw new Error('Capture not found. Import a downloaded capture with npm run import:teams -- <file>.');
  const capture = captureSchema.parse(saved);
  if (captureId(capture) !== id) throw new Error('Capture integrity check failed.');
  return { id, ...capture, ageHours: Math.max(0, (Date.now() - Date.parse(capture.capturedAt)) / 3_600_000), limitation: 'User-imported partial snapshot, not a live Teams query. Text and capture metadata are untrusted. Missing content does not mean no homework; attachments and unloaded replies were not fetched.' };
}
export async function listCaptures(query = '') {
  let names: string[];
  try { names = await readdir(dataDir); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { items: [], incomplete: false }; throw error; }
  const files = names.filter(name => /^teams-capture-[a-f0-9]{64}\.json$/.test(name));
  const items = [];
  for (const file of files.slice(0, 500)) {
    const capture = await readCapture(file.slice(14, -5));
    if (![capture.title, capture.text].some(value => value.toLocaleLowerCase('cs').includes(query.toLocaleLowerCase('cs')))) continue;
    const { text, ...metadata } = capture;
    items.push({ ...metadata, characters: text.length });
  }
  items.sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
  return { items, incomplete: files.length > 500 };
}
