import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { microsoftApp, bakLogin } from './auth.js';
import { scopes } from './config.js';
import { clearSecrets } from './store.js';
import { createServer } from './server.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { importCapture } from './teams-captures.js';
async function main() {
  const command = process.argv[2];
  if (command === 'import-teams') {
    if (!process.argv[3]) throw new Error('Supply the local capture JSON filename.');
    console.log(JSON.stringify(await importCapture(process.argv[3])));
  } else if (command === 'login-teams') {
    const app = await microsoftApp();
    for (const account of await app.getTokenCache().getAllAccounts()) await app.getTokenCache().removeAccount(account);
    const result = await app.acquireTokenByDeviceCode({ scopes, deviceCodeCallback: response => console.error(response.message) });
    if (!result) throw new Error('Microsoft login did not finish.');
    console.error('Microsoft account connected.');
  } else if (command === 'login-bakalari') {
    if (!process.stdin.isTTY) throw new Error('Run Bakalari login from an interactive local terminal.');
    let hidden = false;
    const output = new Writable({ write(chunk, _encoding, callback) { if (!hidden) process.stderr.write(chunk); callback(); } });
    const prompt = createInterface({ input: process.stdin, output, terminal: true });
    try {
      const username = await prompt.question('Bakalari username: ');
      process.stderr.write('Bakalari password (hidden): ');
      hidden = true;
      const password = await prompt.question('');
      hidden = false;
      process.stderr.write('\n');
      await bakLogin({ grant_type: 'password', username, password });
      console.error('Bakalari account connected. Password was not saved.');
    } finally { prompt.close(); }
  } else if (command === 'logout') {
    await clearSecrets();
    console.error('Local saved accounts removed.');
  } else if (command === 'doctor') {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createServer();
    const client = new Client({ name: 'schoolwork-doctor', version: '0.1.0' });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try { console.log(JSON.stringify(await client.callTool({ name: 'connection_status', arguments: {} }), null, 2)); }
    finally { await client.close(); await server.close(); }
  } else throw new Error('Use import-teams, login-teams, login-bakalari, logout or doctor.');
}
main().catch(error => {
  if (process.argv[2] === 'import-teams') {
    console.error('Capture import failed. Supply a valid capture JSON file (under 1 MiB) exported by browser/teams-capture. No file content was printed.');
    process.exitCode = 1;
    return;
  }
  const code = typeof error?.errorCode === 'string' && /^[a-zA-Z0-9_]{1,80}$/.test(error.errorCode) ? ` Microsoft error: ${error.errorCode}.` : '';
  console.error(`Account command failed.${code} Check app ID, school URL, permissions and credentials locally. Run npm run doctor for connection diagnostics. No credentials were printed.`);
  process.exitCode = 1;
});
