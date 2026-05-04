import { rm, unlink } from "node:fs/promises";
import path from "node:path";
import { CLEANABLE_DIR_NAMES } from "./constants.js";
import type { ProjectTarget } from "./types.js";
import { assertUnderProjectRoot } from "./paths.js";

const ALLOWED_TOP = new Set<string>([...CLEANABLE_DIR_NAMES]);

export interface DeleteOutcome {
  path: string;
  bytesBefore: number;
  dryRun: boolean;
  deleted: boolean;
  error?: string;
}

function relativeOrThrow(projectRoot: string, targetPath: string): string {
  const rel = path.relative(projectRoot, targetPath);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`Path outside project: ${targetPath}`);
  }
  return rel;
}

/**
 * Remove a single measured target with realpath prefix checks.
 */
export async function deleteProjectTarget(
  projectRoot: string,
  target: ProjectTarget,
  options: { dryRun: boolean }
): Promise<DeleteOutcome> {
  const bytesBefore = target.bytes;

  if (target.name === "log_files") {
    const files = target.logFilePaths ?? [];
    if (files.length === 0) {
      return {
        path: target.absolutePath,
        bytesBefore,
        dryRun: options.dryRun,
        deleted: false,
      };
    }
    for (const file of files) {
      const check = await assertUnderProjectRoot(projectRoot, file);
      if (!check.ok) {
        return {
          path: file,
          bytesBefore,
          dryRun: options.dryRun,
          deleted: false,
          error: check.reason,
        };
      }
      const rel = relativeOrThrow(check.root, check.candidate);
      if (path.dirname(rel) !== "." || !rel.endsWith(".log")) {
        return {
          path: file,
          bytesBefore,
          dryRun: options.dryRun,
          deleted: false,
          error: "Refusing non-root log file path",
        };
      }
      if (options.dryRun) {
        continue;
      }
      try {
        await unlink(check.candidate);
      } catch (e) {
        return {
          path: file,
          bytesBefore,
          dryRun: false,
          deleted: false,
          error: String(e),
        };
      }
    }
    return {
      path: target.absolutePath,
      bytesBefore,
      dryRun: options.dryRun,
      deleted: !options.dryRun,
    };
  }

  const check = await assertUnderProjectRoot(projectRoot, target.absolutePath);
  if (!check.ok) {
    return {
      path: target.absolutePath,
      bytesBefore,
      dryRun: options.dryRun,
      deleted: false,
      error: check.reason,
    };
  }

  const rel = relativeOrThrow(check.root, check.candidate);
  const top = rel.split(path.sep)[0] ?? "";
  if (!ALLOWED_TOP.has(top)) {
    return {
      path: target.absolutePath,
      bytesBefore,
      dryRun: options.dryRun,
      deleted: false,
      error: `Not a cleanable top-level path: ${rel}`,
    };
  }
  if (rel !== top) {
    return {
      path: target.absolutePath,
      bytesBefore,
      dryRun: options.dryRun,
      deleted: false,
      error: `Refusing nested delete; expected top-level folder, got: ${rel}`,
    };
  }

  if (options.dryRun) {
    return {
      path: target.absolutePath,
      bytesBefore,
      dryRun: true,
      deleted: false,
    };
  }

  try {
    await rm(check.candidate, { recursive: true, force: true });
    return {
      path: target.absolutePath,
      bytesBefore,
      dryRun: false,
      deleted: true,
    };
  } catch (e) {
    return {
      path: target.absolutePath,
      bytesBefore,
      dryRun: false,
      deleted: false,
      error: String(e),
    };
  }
}
