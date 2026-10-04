import { realpath, stat, readFile, unlink } from 'node:fs/promises';
import { resolve, relative, isAbsolute, basename, sep } from 'node:path';
import { dataDir } from './config.js';
import { extract } from './documents.js';

export async function readTeamsDownload(file: string) { return readBrowserDownload(file, 'teams'); }
async function downloadPath(file: string, source: 'teams' | 'outlook') {
  const configuredRoot = resolve(dataDir, source + '-browser-output');
  const root = await realpath(configuredRoot);
  // The browser reports absolute download paths; accept them and relativize.
  const candidate = isAbsolute(file) ? resolve(file) : resolve(configuredRoot, file);
  function inside(path: string, base = root) { const rel = relative(base, path); return rel !== '' && rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel); }
  // Windows temporary directories can be reached through a junction/drive alias.
  if (!inside(candidate, configuredRoot) && !inside(candidate)) throw new Error('Download path is outside the ' + source + ' browser output directory.');
  const target = await realpath(candidate);
  if (!inside(target)) throw new Error('Download symlink points outside the ' + source + ' browser output directory.');
  return { root, target };
}
export async function removeBrowserDownload(file: string, source: 'teams' | 'outlook') {
  const { target } = await downloadPath(file, source);
  await unlink(target);
}
export async function readBrowserDownload(file: string, source: 'teams' | 'outlook', allowUnsupported = false) {
  const { root, target } = await downloadPath(file, source);
  const info = await stat(target);
  if (!info.isFile() || info.size > 20 * 1024 * 1024) throw new Error('Downloaded document must be a file under 20 MiB.');
  const bytes = await readFile(target);
  if (bytes.length > 20 * 1024 * 1024) throw new Error('Downloaded document exceeds 20 MiB.');
  let parts: Awaited<ReturnType<typeof extract>> | undefined; let extractionError: string | undefined;
  try { parts = await extract(bytes, basename(target), ''); }
  catch (error) {
    if (!allowUnsupported || !(error instanceof Error) || !error.message.startsWith('Unsupported document type.')) throw error;
    parts = []; extractionError = error.message;
  }
  return { name: basename(target), downloadFile: relative(root, target), ...(source === 'outlook' ? { localPath: target } : {}), source: source + '-browser-download', downloadedFileModifiedAt: info.mtime.toISOString(), parts, ...(extractionError ? { extractionError } : {}) };
}
