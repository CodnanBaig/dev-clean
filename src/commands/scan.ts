import chalk from "chalk";
import ora from "ora";
import { discoverProjects } from "../lib/discover.js";
import { measureProjects } from "../lib/measure.js";
import { formatBytes } from "../lib/format.js";
import { mergeScanRoots, loadConfigFile } from "../lib/config.js";
import { filterProjectsByRecency } from "../lib/recent.js";
import type { MeasuredProject, SortKey } from "../lib/types.js";

export interface ScanOptions {
  path: string[];
  config?: string;
  json?: boolean;
  sort?: SortKey;
  skipRecentDays?: number;
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

export async function runScan(opts: ScanOptions): Promise<void> {
  const { path: cliPaths, json, sort = "size", skipRecentDays } = opts;
  const { data: config } = await loadConfigFile(opts.config);
  const roots = mergeScanRoots(cliPaths, config);
  const excludePatterns = config.excludePatterns ?? [];

  const spinner = ora({
    text: "Scanning for projects…",
    stream: process.stderr,
  }).start();
  let discovered;
  try {
    discovered = await discoverProjects(roots, excludePatterns);
  } catch (e) {
    spinner.fail("Discovery failed");
    throw e;
  }
  spinner.text = "Measuring disk usage…";
  let measured: MeasuredProject[];
  try {
    measured = await measureProjects(discovered);
  } catch (e) {
    spinner.fail("Measure failed");
    throw e;
  }
  if (json) {
    spinner.stop();
  } else {
    spinner.succeed("Scan complete");
  }

  let filtered = measured.filter((p) => p.totalReclaimableBytes > 0);
  if (typeof skipRecentDays === "number" && skipRecentDays > 0) {
    filtered = filterProjectsByRecency(filtered, skipRecentDays);
  }
  const sorted = sortProjects(filtered, sort);

  if (json) {
    console.log(
      JSON.stringify(
        {
          scanRoots: roots,
          projects: sorted.map((p) => ({
            root: p.root,
            lastModifiedMs: p.lastModifiedMs,
            totalReclaimableBytes: p.totalReclaimableBytes,
            signals: p.signals,
            targets: p.targets.map((t) => ({
              name: t.name,
              path:
                t.name === "log_files"
                  ? t.logFilePaths ?? []
                  : t.absolutePath,
              bytes: t.bytes,
            })),
          })),
        },
        null,
        2
      )
    );
    return;
  }

  if (sorted.length === 0) {
    console.log(
      chalk.yellow("No projects with reclaimable artifacts found in scan roots.")
    );
    return;
  }

  const grandTotal = sorted.reduce((s, p) => s + p.totalReclaimableBytes, 0);
  console.log(
    chalk.bold(`\nReclaimable (estimate): ${formatBytes(grandTotal)}\n`)
  );

  for (const p of sorted) {
    console.log(chalk.cyan.bold(`Project: ${p.root}`));
    for (const t of p.targets) {
      const label =
        t.name === "log_files" ? "root *.log" : t.name;
      console.log(`  ${label}: ${formatBytes(t.bytes)}`);
    }
    console.log(
      chalk.green(`  Total reclaimable: ${formatBytes(p.totalReclaimableBytes)}\n`)
    );
  }
}
