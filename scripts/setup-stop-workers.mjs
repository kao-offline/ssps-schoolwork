// Save owned readers before dependency/source updates, then setup restarts them.
import { cacheRequest } from '../dist/teams-cache-client.js';
for (const source of ['teams', 'discord']) {
  let status;
  try { status = await cacheRequest('status', {}, source); } catch { continue; }
  if (status.service !== 'ssps-' + source + '-cache' || !Number.isInteger(status.pid) || status.pid <= 0) throw new Error('Unexpected worker identity; no process was stopped.');
  await cacheRequest('pause', {}, source);
  try { process.kill(status.pid); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  console.log(source + ' reader paused and saved for the setup update.');
}
