import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import micromatch from "micromatch";
import fg from "fast-glob";
import type { DiscoveredProject } from "./types.js";
import { PACKAGE_JSON } from "./constants.js";

function isExcluded(absPath: string, excludePatterns: string[]): boolean {
  if (!excludePatterns.length) return false;
  return excludePatterns.some((pattern) => micromatch.isMatch(absPath, pattern));
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function readPackageJson(dir: string): Promise<Record<string, unknown> | null> {
  try {
    const raw = await readFile(path.join(dir, PACKAGE_JSON), "utf8");
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Resolve npm/yarn/pnpm workspace package directories (additional project roots).
 */
async function workspacePackageRoots(
  projectRoot: string,
  pkg: Record<string, unknown>
): Promise<string[]> {
  const roots: string[] = [];
  let patterns: string[] = [];

  const ws = pkg.workspaces;
  if (Array.isArray(ws)) {
    patterns = ws.filter((x): x is string => typeof x === "string");
  } else if (ws && typeof ws === "object" && "packages" in ws) {
    const p = (ws as { packages?: unknown }).packages;
    if (Array.isArray(p)) {
      patterns = p.filter((x): x is string => typeof x === "string");
    }
  }

  for (const pattern of patterns) {
    const matches = await fg(pattern, {
      cwd: projectRoot,
      onlyDirectories: true,
      absolute: true,
      followSymbolicLinks: false,
      ignore: ["**/node_modules/**"],
    });
    for (const dir of matches) {
      if (await pathExists(path.join(dir, PACKAGE_JSON))) {
        roots.push(dir);
      }
    }
  }

  return roots;
}

const SKIP_DESCENT_NAMES = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "build",
  ".turbo",
]);

async function statPackageJsonMtime(dir: string): Promise<number> {
  try {
    const s = await stat(path.join(dir, PACKAGE_JSON));
    return s.mtimeMs;
  } catch {
    return 0;
  }
}

async function projectSignals(dir: string): Promise<DiscoveredProject["signals"]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [] as import("node:fs").Dirent[]);
  const names = new Set(entries.filter((e) => e.isFile() || e.isDirectory()).map((e) => e.name));
  const hasNextConfig =
    names.has("next.config.js") ||
    names.has("next.config.mjs") ||
    names.has("next.config.ts") ||
    names.has("next.config.cjs");
  const hasNodeModules = names.has("node_modules");
  return { hasNextConfig, hasNodeModules };
}

/**
 * Breadth-first discovery of directories containing package.json.
 * Skips descending into node_modules / .git and heavy artifact dirs.
 */
export async function discoverProjects(
  scanRoots: string[],
  excludePatterns: string[]
): Promise<DiscoveredProject[]> {
  const byRoot = new Map<string, DiscoveredProject>();
  const queue: string[] = [];
  const seenDirs = new Set<string>();

  for (const root of scanRoots) {
    const resolved = path.resolve(root);
    if (!(await pathExists(resolved))) continue;
    if (isExcluded(resolved, excludePatterns)) continue;
    queue.push(resolved);
  }

  while (queue.length > 0) {
    const dir = queue.shift()!;
    if (seenDirs.has(dir)) continue;
    seenDirs.add(dir);
    if (isExcluded(dir, excludePatterns)) continue;

    let entries: import("node:fs").Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    const hasPackageJson = entries.some((e) => e.isFile() && e.name === PACKAGE_JSON);

    if (hasPackageJson) {
      const pkg = await readPackageJson(dir);
      const lastModifiedMs = await statPackageJsonMtime(dir);
      const signals = await projectSignals(dir);
      const project: DiscoveredProject = {
        root: dir,
        packageJsonPath: path.join(dir, PACKAGE_JSON),
        lastModifiedMs,
        signals,
      };
      if (!byRoot.has(dir)) {
        byRoot.set(dir, project);
      }

      if (pkg) {
        const extra = await workspacePackageRoots(dir, pkg);
        for (const r of extra) {
          if (isExcluded(r, excludePatterns)) continue;
          if (!byRoot.has(r)) {
            const pPkg = await readPackageJson(r);
            if (pPkg) {
              byRoot.set(r, {
                root: r,
                packageJsonPath: path.join(r, PACKAGE_JSON),
                lastModifiedMs: await statPackageJsonMtime(r),
                signals: await projectSignals(r),
              });
            }
          }
        }
      }
    }

    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const name = e.name;
      if (SKIP_DESCENT_NAMES.has(name)) continue;
      const child = path.join(dir, name);
      if (isExcluded(child, excludePatterns)) continue;
      queue.push(child);
    }
  }

  return [...byRoot.values()];
}
