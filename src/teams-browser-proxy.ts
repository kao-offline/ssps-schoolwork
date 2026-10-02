import './logging.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { cacheRequest } from './teams-cache-client.js';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
const source = process.argv.includes('--source=discord') ? 'discord' : 'teams';

async function ensureWorker() {
  try { await cacheRequest('status', {}, source); return; } catch { /* Auto-start an already configured private worker. */ }
  const root = join(import.meta.dirname, '..');
  const child = spawn(process.execPath, [`--env-file-if-exists=${join(root, '.env')}`, join(import.meta.dirname, 'teams-cache-worker.js'), '--source=' + source], { detached: true, windowsHide: true, stdio: 'ignore' });
  child.unref();
  for (let attempt = 0; attempt < 40; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 250));
    try { await cacheRequest('status', {}, source); return; } catch { /* Startup includes protected cache loading. */ }
  }
  throw new Error('Teams background worker could not start. Run npm run setup:teams-cache.');
}
await ensureWorker();
const server = new Server({ name: 'ssps-teams-shared-browser', version: '1' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: await cacheRequest('tools', {}, source) as any }));
server.setRequestHandler(CallToolRequestSchema, async request => {
  try { return await cacheRequest('browser', { name: request.params.name, arguments: request.params.arguments || {} }, source) as any; }
  catch (error) { return { isError: true, content: [{ type: 'text', text: error instanceof Error ? error.message : 'Shared Teams browser request failed.' }] }; }
});
await server.connect(new StdioServerTransport());
