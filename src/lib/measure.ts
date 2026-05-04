import { access, stat } from "node:fs/promises";
import path from "node:path";
import { execa } from "execa";
import pLimit from "p-limit";
import fg from "fast-glob";
import type { CleanableDirName } from "./constants.js";
import { CLEANABLE_DIR_NAMES } from "./constants.js";
import type { DiscoveredProject, MeasuredProject, ProjectTarget } from "./types.js";

const limit = pLimit(16);

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Disk usage in bytes via `du -sk` (macOS / GNU coreutils).
 */
export async function duBytes(targetPath: string): Promise<number> {
  try {
    const { stdout } = await execa("du", ["-sk", targetPath], {
      stripFinalNewline: true,
      reject: false,
    });
    if (typeof stdout !== "string" || !stdout.trim()) return 0;
    const kb = parseInt(stdout.split(/\s+/)[0] ?? "0", 10);
    if (Number.isNaN(kb)) return 0;
    return kb * 1024;
  } catch {
    return 0;
  }
}

function cleanableDirsForProject(
  projectRoot: string,
  filter?: Set<CleanableDirName>
): { name: CleanableDirName; absolutePath: string }[] {
  const dirs: { name: CleanableDirName; absolutePath: string }[] = [];
  for (const name of CLEANABLE_DIR_NAMES) {
    if (filter && !filter.has(name)) continue;
    dirs.push({
      name,
      absolutePath: path.join(projectRoot, name),
    });
  }
  return dirs;
}

export type MeasureFilter = {
  nodeModulesOnly?: boolean;
  buildOnly?: boolean;
};

function resolveCleanableFilter(
  opts: MeasureFilter
): Set<CleanableDirName> | undefined {
  if (opts.nodeModulesOnly) {
    return new Set<CleanableDirName>(["node_modules"]);
  }
  if (opts.buildOnly) {
    return new Set<CleanableDirName>([
      ".next",
      "dist",
      "build",
      ".turbo",
      "out",
      ".cache",
      ".vite",
      ".parcel-cache",
      "coverage",
      ".nuxt",
      "storybook-static",
    ]);
  }
  return undefined;
}

export async function measureProject(
  project: DiscoveredProject,
  measureOpts: MeasureFilter = {}
): Promise<MeasuredProject> {
  const filter = resolveCleanableFilter(measureOpts);
  const dirs = cleanableDirsForProject(project.root, filter);

  const targetResults = await Promise.all(
    dirs.map((d) =>
      limit(async () => {
        if (!(await pathExists(d.absolutePath))) {
          return null;
        }
        const bytes = await duBytes(d.absolutePath);
        if (bytes === 0) return null;
        const t: ProjectTarget = {
          name: d.name,
          absolutePath: d.absolutePath,
          bytes,
        };
        return t;
      })
    )
  );

  const targets: ProjectTarget[] = targetResults.filter(
    (x): x is ProjectTarget => x !== null
  );

  const includeLogs = !measureOpts.nodeModulesOnly && !measureOpts.buildOnly;
  if (includeLogs) {
    const logFiles = await fg(["*.log"], {
      cwd: project.root,
      onlyFiles: true,
      absolute: true,
      followSymbolicLinks: false,
      deep: 1,
    });
    let logBytes = 0;
    for (const f of logFiles) {
      try {
        logBytes += (await stat(f)).size;
      } catch {
        /* ignore */
      }
    }
    if (logBytes > 0 && logFiles.length > 0) {
      targets.push({
        name: "log_files",
        absolutePath: path.join(project.root, "(root *.log)"),
        bytes: logBytes,
        logFilePaths: logFiles,
      });
    }
  }

  const totalReclaimableBytes = targets.reduce((s, t) => s + t.bytes, 0);

  return {
    ...project,
    targets,
    totalReclaimableBytes,
  };
}

export async function measureProjects(
  projects: DiscoveredProject[],
  measureOpts: MeasureFilter = {}
): Promise<MeasuredProject[]> {
  return Promise.all(projects.map((p) => measureProject(p, measureOpts)));
}
