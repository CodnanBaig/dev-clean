import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { expandTilde } from "./paths.js";
import { DEFAULT_SCAN_ROOT_TILDE } from "./constants.js";

export interface DevCleanRc {
  scanRoots?: string[];
  skipRecentDays?: number;
  excludePatterns?: string[];
}

const DEFAULT_CONFIG_PATH = () =>
  path.join(homedir(), ".devcleanrc");

export async function loadConfigFile(
  explicitPath?: string
): Promise<{ path: string | null; data: DevCleanRc }> {
  const configPath = explicitPath
    ? expandTilde(explicitPath)
    : DEFAULT_CONFIG_PATH();
  try {
    const raw = await readFile(configPath, "utf8");
    const data = JSON.parse(raw) as DevCleanRc;
    return { path: configPath, data };
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      return { path: null, data: {} };
    }
    throw new Error(`Failed to read config ${configPath}: ${String(e)}`);
  }
}

export function defaultScanRootsFromEnv(): string[] {
  return DEFAULT_SCAN_ROOT_TILDE.map((p) => expandTilde(p));
}

export function mergeScanRoots(
  cliPaths: string[] | undefined,
  config: DevCleanRc
): string[] {
  if (cliPaths && cliPaths.length > 0) {
    return cliPaths.map((p) => expandTilde(p));
  }
  if (config.scanRoots && config.scanRoots.length > 0) {
    return config.scanRoots.map((p) => expandTilde(p));
  }
  return defaultScanRootsFromEnv();
}
