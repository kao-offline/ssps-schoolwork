import { cacheAuth, cacheRequest } from './teams-cache-client.js';
const command = process.argv[2] || 'status';
const source = process.argv.includes('--source=discord') ? 'discord' : process.argv.includes('--source=outlook') ? 'outlook' : 'teams';
try {
  if (command === 'setup') { await cacheAuth(true, source); console.log('Protected local worker authentication configured.'); }
  else if (['status', 'pause', 'resume', 'refresh', 'routes'].includes(command)) console.log(JSON.stringify(await cacheRequest(command, {}, source), null, 2));
  else throw new Error('Use setup, status, pause, resume, refresh or routes.');
} catch (error) { console.error(error instanceof Error ? error.message : 'Teams worker command failed.'); process.exitCode = 1; }
