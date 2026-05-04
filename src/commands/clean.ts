import chalk from "chalk";
import inquirer from "inquirer";
import ora from "ora";
import { discoverProjects } from "../lib/discover.js";
import { measureProjects, type MeasureFilter } from "../lib/measure.js";
import { formatBytes } from "../lib/format.js";
import { mergeScanRoots, loadConfigFile } from "../lib/config.js";
import { filterProjectsByRecency } from "../lib/recent.js";
import { deleteProjectTarget } from "../lib/delete-targets.js";
import type { MeasuredProject, ProjectTarget, SortKey } from "../lib/types.js";
import { isCleanTargetId } from "../lib/constants.js";
import { labelForTargetName } from "../lib/target-labels.js";

export interface CleanOptions {
  path: string[];
  config?: string;
  yes?: boolean;
  dryRun?: boolean;
  all?: boolean;
  nodeModulesOnly?: boolean;
  buildOnly?: boolean;
  /** Comma-parsed from CLI; skips interactive artifact prompt */
  targetTypes?: string[];
  skipRecentDays?: number;
  includeRecent?: boolean;
  sort?: SortKey;
}

function sortProjects(
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

function aggregateTargetStats(
  projects: MeasuredProject[]
): { id: ProjectTarget["name"]; bytes: number; count: number }[] {
  const map = new Map<
    ProjectTarget["name"],
    { bytes: number; count: number }
  >();
  for (const p of projects) {
    for (const t of p.targets) {
      const cur = map.get(t.name) ?? { bytes: 0, count: 0 };
      cur.bytes += t.bytes;
      cur.count += 1;
      map.set(t.name, cur);
    }
  }
  return [...map.entries()]
    .map(([id, v]) => ({ id, ...v }))
    .sort((a, b) => b.bytes - a.bytes);
}

function filterProjectsByTargetNames(
  projects: MeasuredProject[],
  allowed: Set<string>
): MeasuredProject[] {
  return projects
    .map((p) => {
      const targets = p.targets.filter((t) => allowed.has(t.name));
      const totalReclaimableBytes = targets.reduce((s, t) => s + t.bytes, 0);
      return { ...p, targets, totalReclaimableBytes };
    })
    .filter((p) => p.targets.length > 0);
}

function effectiveSkipRecentDays(opts: CleanOptions, configSkip?: number): number {
  if (opts.includeRecent) return 0;
  if (typeof opts.skipRecentDays === "number" && !Number.isNaN(opts.skipRecentDays)) {
    return opts.skipRecentDays;
  }
  if (typeof configSkip === "number" && !Number.isNaN(configSkip)) {
    return configSkip;
  }
  return 7;
}

export async function runClean(opts: CleanOptions): Promise<void> {
  const { path: cliPaths } = opts;
  const { data: config } = await loadConfigFile(opts.config);
  const roots = mergeScanRoots(cliPaths, config);
  const excludePatterns = config.excludePatterns ?? [];

  const measureFilter: MeasureFilter = {
    nodeModulesOnly: opts.nodeModulesOnly,
    buildOnly: opts.buildOnly,
  };

  const spinner = ora({
    text: "Scanning for projects…",
    stream: process.stderr,
  }).start();
  const discovered = await discoverProjects(roots, excludePatterns);
  spinner.text = "Measuring disk usage…";
  let measured = await measureProjects(discovered, measureFilter);
  spinner.succeed("Scan complete");

  let candidates = measured.filter((p) => p.totalReclaimableBytes > 0);
  const skipDays = effectiveSkipRecentDays(opts, config.skipRecentDays);
  if (skipDays > 0) {
    const before = candidates.length;
    candidates = filterProjectsByRecency(candidates, skipDays);
    if (!opts.yes && before !== candidates.length) {
      console.log(
        chalk.dim(
          `Skipped ${before - candidates.length} recently modified project(s) (package.json mtime within ${skipDays}d). Use --include-recent to include them.`
        )
      );
    }
  }

  const sorted = sortProjects(candidates, opts.sort ?? "size");

  if (sorted.length === 0) {
    console.log(chalk.yellow("Nothing to clean for the current filters."));
    return;
  }

  let selected: MeasuredProject[];

  if (opts.all) {
    selected = sorted;
  } else {
    const { picks } = await inquirer.prompt<{ picks: string[] }>([
      {
        type: "checkbox",
        name: "picks",
        message: "Select projects to clean",
        choices: sorted.map((p) => ({
          name: `${p.root} (${formatBytes(p.totalReclaimableBytes)})`,
          value: p.root,
          checked: false,
        })),
        validate: (ans: string[]) =>
          ans.length > 0 || "Pick at least one project (or use --all)",
      },
    ]);
    selected = sorted.filter((p) => picks.includes(p.root));
  }

  let toClean = selected;
  const narrowedByMeasure = opts.nodeModulesOnly || opts.buildOnly;

  if (narrowedByMeasure) {
    /* measure step already narrowed targets; no extra type prompt */
  } else if (opts.targetTypes && opts.targetTypes.length > 0) {
    const invalid = opts.targetTypes.filter((t) => !isCleanTargetId(t));
    if (invalid.length > 0) {
      console.log(
        chalk.red(
          `Unknown --targets value(s): ${invalid.join(", ")}. Run with a comma list of allowed names.`
        )
      );
      process.exitCode = 1;
      return;
    }
    toClean = filterProjectsByTargetNames(
      selected,
      new Set(opts.targetTypes)
    );
  } else if (!opts.yes) {
    const stats = aggregateTargetStats(selected);
    if (stats.length === 0) {
      console.log(chalk.yellow("Nothing to clean for the selected projects."));
      return;
    }
    const { typePicks } = await inquirer.prompt<{ typePicks: ProjectTarget["name"][] }>([
      {
        type: "checkbox",
        name: "typePicks",
        message: "Which artifact types should be removed?",
        choices: stats.map((s) => ({
          name: `${labelForTargetName(s.id)} — ${formatBytes(s.bytes)} (${s.count} in selection)`,
          value: s.id,
          checked: true,
        })),
        validate: (ans: string[]) =>
          ans.length > 0 || "Pick at least one artifact type",
      },
    ]);
    toClean = filterProjectsByTargetNames(selected, new Set(typePicks));
  }

  if (toClean.length === 0) {
    console.log(
      chalk.yellow(
        narrowedByMeasure || (opts.targetTypes && opts.targetTypes.length > 0)
          ? "No projects left after --targets / filters. Aborted."
          : "No matching artifacts for your selection. Aborted."
      )
    );
    return;
  }

  if (!opts.yes && !opts.dryRun) {
    const { confirm } = await inquirer.prompt<{ confirm: boolean }>([
      {
        type: "confirm",
        name: "confirm",
        default: false,
        message: chalk.red(
          `Delete selected artifacts in ${toClean.length} project(s)? This cannot be undone.`
        ),
      },
    ]);
    if (!confirm) {
      console.log(chalk.yellow("Aborted."));
      return;
    }
  }

  const dryRun = Boolean(opts.dryRun);
  if (dryRun) {
    console.log(chalk.bold.yellow("\nDry run — no files will be deleted\n"));
  }

  let freedBytes = 0;
  let cleanedProjects = 0;

  for (const project of toClean) {
    let projectTouched = false;
    for (const target of project.targets) {
      const label =
        target.name === "log_files"
          ? `${project.root} (root *.log)`
          : target.absolutePath;
      if (dryRun) {
        console.log(chalk.dim(`[dry-run] would remove: ${label}`));
        freedBytes += target.bytes;
        projectTouched = true;
        continue;
      }
      const outcome = await deleteProjectTarget(project.root, target, {
        dryRun: false,
      });
      if (outcome.error) {
        console.log(chalk.red(`✖ ${label}: ${outcome.error}`));
      } else if (outcome.deleted) {
        freedBytes += outcome.bytesBefore;
        projectTouched = true;
        console.log(chalk.green(`✔ Removed: ${label}`));
      }
    }
    if (projectTouched) cleanedProjects += 1;
  }

  console.log();
  if (dryRun) {
    console.log(
      chalk.bold.green(
        `✔ Would clean ${toClean.length} project(s), ~${formatBytes(freedBytes)}`
      )
    );
  } else {
    console.log(
      chalk.bold.green(
        `✔ Cleaned ${cleanedProjects} project(s)\n✔ Freed ~${formatBytes(freedBytes)}`
      )
    );
  }
}
