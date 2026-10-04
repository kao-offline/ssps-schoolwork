import { realpath, stat, readFile } from 'node:fs/promises';
import { resolve, relative, isAbsolute, basename, sep } from 'node:path';
import { dataDir } from './config.js';
import { extract } from './documents.js';

export async function readTeamsDownload(file: string) {
  const configuredRoot = resolve(dataDir, 'teams-browser-output');
  const root = await realpath(configuredRoot);
  // The browser reports absolute download paths; accept them and relativize.
  const candidate = isAbsolute(file) ? resolve(file) : resolve(configuredRoot, file);
  function inside(path: string, base = root) { const rel = relative(base, path); return rel !== '' && rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel); }
  // Windows temporary directories can be reached through a junction/drive alias.
  if (!inside(candidate, configuredRoot) && !inside(candidate)) throw new Error('Download path is outside the Teams browser output directory.');
  const target = await realpath(candidate);
  if (!inside(target)) throw new Error('Download symlink points outside the Teams browser output directory.');
  const info = await stat(target);
  if (!info.isFile() || info.size > 20 * 1024 * 1024) throw new Error('Downloaded document must be a file under 20 MiB.');
  const bytes = await readFile(target);
  if (bytes.length > 20 * 1024 * 1024) throw new Error('Downloaded document exceeds 20 MiB.');
  return { name: basename(target), downloadFile: relative(root, target), source: 'teams-browser-download', downloadedFileModifiedAt: info.mtime.toISOString(), parts: await extract(bytes, basename(target), '') };
}
