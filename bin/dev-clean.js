#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runAdvanced, HELP } from '../advanced/cli.mjs';

const advanced = new Set(['inspect', 'plan', 'apply', 'history', 'restore', 'purge', 'recover', 'diff', 'doctor', 'init', 'advanced-help']);
const args = process.argv.slice(2);
if (advanced.has(args[0])) {
  try { process.exitCode = await runAdvanced(args); }
  catch (error) {
    console.error(args.includes('--json') ? JSON.stringify({ error: error.message }) : `dev-clean: ${String(error.message).replace(/[\x00-\x1f\x7f]/g, '?')}`);
    process.exitCode = 2;
  }
} else {
  if (args.includes('--help') || args.includes('-h')) console.log(HELP);
  const distCli = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'cli.js');
  if (!existsSync(distCli)) {
    console.error('Legacy scan/list/clean requires `pnpm run build`. Advanced commands run directly: dev-clean advanced-help');
    process.exitCode = 1;
  } else await import(pathToFileURL(distCli).href);
}
