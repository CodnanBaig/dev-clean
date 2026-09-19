#!/usr/bin/env node
import { runAdvanced } from '../advanced/cli.mjs';
try { process.exitCode = await runAdvanced(); }
catch (error) {
  const message = String(error?.message ?? error).replace(/[\x00-\x1f\x7f]/g, ' ');
  console.error(JSON.stringify({ error: message }));
  process.exitCode = 2;
}
