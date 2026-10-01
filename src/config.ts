import { homedir } from 'node:os';
import { join } from 'node:path';
export const dataDir = process.env.SCHOOLWORK_DATA_DIR || join(homedir(), '.ssps-schoolwork');
export const scopes = ['User.Read', 'Team.ReadBasic.All', 'Channel.ReadBasic.All', 'EduRoster.ReadBasic', 'EduAssignments.Read', 'ChannelMessage.Read.All', 'Files.Read.All'];
export function bakBase() {
  const url = new URL(process.env.BAKALARI_URL || 'https://bakalari.ssps.cz');
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('BAKALARI_URL must be a clean HTTPS school URL.');
  return url.href.replace(/\/$/, '');
}
export function segment(value: string) { return encodeURIComponent(value); }
export function bakHeaders(accessToken?: string): Record<string, string> {
  // SSPS's API returns HTTP 500 if the requested culture is unspecified.
  return { 'Accept-Language': 'cs', ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) };
}
