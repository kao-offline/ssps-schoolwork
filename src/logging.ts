import { Console } from 'node:console';
// Dependencies (including PDF parsing) may warn through console. Keep stdio JSON-RPC clean.
globalThis.console = new Console({ stdout: process.stderr, stderr: process.stderr });
