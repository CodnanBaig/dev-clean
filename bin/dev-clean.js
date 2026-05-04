#!/usr/bin/env node
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const distCli = join(__dirname, "..", "dist", "cli.js");

if (!existsSync(distCli)) {
  console.error(
    "dev-clean: dist/cli.js not found. Run `pnpm run build` from the package root."
  );
  process.exit(1);
}

await import(pathToFileURL(distCli).href);
