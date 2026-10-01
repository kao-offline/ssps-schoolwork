import { resolve } from 'node:path';
import { writeFileSync, existsSync, copyFileSync } from 'node:fs';
const root = resolve(import.meta.dirname, '..');
if (!existsSync(resolve(root, '.env'))) copyFileSync(resolve(root, '.env.example'), resolve(root, '.env'));
const config = { mcpServers: { schoolwork: { command: process.execPath, args: [`--env-file-if-exists=${resolve(root, '.env')}`, resolve(root, 'dist/index.js')] } } };
writeFileSync(resolve(root, 'mcp.local.json'), JSON.stringify(config, null, 2) + '\n');
console.log('Created mcp.local.json with absolute paths. Add it to your MCP client, then configure .env and run the login commands. Existing .env was preserved.');
