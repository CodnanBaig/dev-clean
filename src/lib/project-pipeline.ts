import { discoverProjects } from "./discover.js";
import { measureProjects, type MeasureFilter } from "./measure.js";
import { mergeScanRoots, loadConfigFile } from "./config.js";
import { filterProjectsByRecency } from "./recent.js";
import type { MeasuredProject, SortKey } from "./types.js";

/** Shared options for `list` and `clean` so project **id** indices match. */
export interface ProjectPipelineOpts {
  path: string[];
  config?: string;
  sort: SortKey;
  skipRecentDays?: number;
  includeRecent?: boolean;
  nodeModulesOnly?: boolean;
  buildOnly?: boolean;
  /** If false, do not hide recent projects (interactive clean default). */
  applyRecencyFilter?: boolean;
}

export function sortProjectsByKey(
  projects: MeasuredProject[],
  sort: SortKey
): MeasuredProject[] {
  const copy = [...projects];
  if (sort === "name") {
    copy.sort((a, b) => a.root.localeCompare(b.root));
  } else {
    copy.sort((a, b) => b.totalReclaimableBytes - a.totalReclaimableBytes);
  }
  return copy;
}

export function effectiveSkipRecentDaysForClean(
  opts: Pick<
    ProjectPipelineOpts,
    "includeRecent" | "skipRecentDays"
  >,
  _configSkip?: number
): number {
  if (opts.includeRecent) return 0;
  if (
    typeof opts.skipRecentDays === "number" &&
    !Number.isNaN(opts.skipRecentDays)
  ) {
    return opts.skipRecentDays;
  }
  return 0;
}

export async function getSortedProjectCandidates(
  opts: ProjectPipelineOpts
): Promise<{
  sorted: MeasuredProject[];
  roots: string[];
  skipRecentDays: number;
  recentSkippedCount: number;
  measureFilter: MeasureFilter;
}> {
  const { data: config } = await loadConfigFile(opts.config);
  const roots = mergeScanRoots(opts.path, config);
  const excludePatterns = config.excludePatterns ?? [];

  const measureFilter: MeasureFilter = {
    nodeModulesOnly: opts.nodeModulesOnly,
    buildOnly: opts.buildOnly,
  };

  const discovered = await discoverProjects(roots, excludePatterns);
  const measured = await measureProjects(discovered, measureFilter);

  let candidates = measured.filter((p) => p.totalReclaimableBytes > 0);
  const applyRecencyFilter = opts.applyRecencyFilter ?? true;
  const skipDays = applyRecencyFilter
    ? effectiveSkipRecentDaysForClean(opts, config.skipRecentDays)
    : 0;
  const before = candidates.length;
  if (skipDays > 0) {
    candidates = filterProjectsByRecency(candidates, skipDays);
  }
  const recentSkippedCount = before - candidates.length;

  const sorted = sortProjectsByKey(candidates, opts.sort);

  return {
    sorted,
    roots,
    skipRecentDays: skipDays,
    recentSkippedCount,
    measureFilter,
  };
}
