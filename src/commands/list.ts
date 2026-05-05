import chalk from "chalk";
import ora from "ora";
import { formatBytes } from "../lib/format.js";
import { getSortedProjectCandidates } from "../lib/project-pipeline.js";
import type { SortKey } from "../lib/types.js";

export interface ListOptions {
  path: string[];
  config?: string;
  sort: SortKey;
  skipRecentDays?: number;
  includeRecent?: boolean;
  nodeModulesOnly?: boolean;
  buildOnly?: boolean;
  json?: boolean;
}

function truncateMiddle(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  const keep = maxLen - 1;
  const head = Math.ceil(keep / 2);
  const tail = Math.floor(keep / 2);
  return `${s.slice(0, head)}…${s.slice(s.length - tail)}`;
}

function printTable(rows: { id: number; path: string; size: string }[]): void {
  const idW = 4;
  const pathW = 62;
  const sizeW = 14;
  const top = `┌${"─".repeat(idW)}┬${"─".repeat(pathW)}┬${"─".repeat(sizeW)}┐`;
  const mid = `├${"─".repeat(idW)}┼${"─".repeat(pathW)}┼${"─".repeat(sizeW)}┤`;
  const bot = `└${"─".repeat(idW)}┴${"─".repeat(pathW)}┴${"─".repeat(sizeW)}┘`;

  console.log(chalk.bold(top));
  console.log(
    chalk.bold(
      `│${"id".padEnd(idW)}│${"project".padEnd(pathW)}│${"reclaimable".padEnd(sizeW)}│`
    )
  );
  console.log(chalk.bold(mid));
  for (const r of rows) {
    const idCell = String(r.id).padEnd(idW);
    const pathCell = truncateMiddle(r.path, pathW).padEnd(pathW);
    const sizeCell = r.size.padStart(sizeW);
    console.log(`│${idCell}│${pathCell}│${sizeCell}│`);
  }
  console.log(chalk.bold(bot));
}

export async function runList(opts: ListOptions): Promise<void> {
  const spinner = ora({
    text: "Scanning for projects…",
    stream: process.stderr,
  }).start();

  let sorted;
  let roots: string[];
  let skipRecentDays: number;
  let recentSkippedCount: number;
  try {
    const r = await getSortedProjectCandidates({
      path: opts.path,
      config: opts.config,
      sort: opts.sort,
      skipRecentDays: opts.skipRecentDays,
      includeRecent: opts.includeRecent,
      nodeModulesOnly: opts.nodeModulesOnly,
      buildOnly: opts.buildOnly,
    });
    sorted = r.sorted;
    roots = r.roots;
    skipRecentDays = r.skipRecentDays;
    recentSkippedCount = r.recentSkippedCount;
  } catch (e) {
    spinner.fail("Scan failed");
    throw e;
  }

  if (opts.json) {
    spinner.stop();
    console.log(
      JSON.stringify(
        {
          scanRoots: roots,
          sort: opts.sort,
          skipRecentDays,
          recentSkippedCount,
          projects: sorted.map((p, id) => ({
            id,
            root: p.root,
            totalReclaimableBytes: p.totalReclaimableBytes,
            targets: p.targets.map((t) => ({
              name: t.name,
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

  spinner.stop();

  if (sorted.length === 0) {
    console.log(chalk.yellow("No projects with reclaimable artifacts."));
    if (recentSkippedCount > 0) {
      console.log(
        chalk.dim(
          `${recentSkippedCount} project(s) hidden by recency filter (${skipRecentDays}d). Use --include-recent to list them.`
        )
      );
    }
    return;
  }

  const rows = sorted.map((p, id) => ({
    id,
    path: p.root,
    size: formatBytes(p.totalReclaimableBytes),
  }));

  printTable(rows);

  const total = sorted.reduce((s, p) => s + p.totalReclaimableBytes, 0);
  console.log();
  console.log(
    chalk.dim(
      `Scan roots: ${roots.join(", ")}  ·  sort: ${opts.sort}  ·  total: ${formatBytes(total)}`
    )
  );
  if (skipRecentDays > 0 && recentSkippedCount > 0) {
    console.log(
      chalk.dim(
        `Not listed (package.json newer than ${skipRecentDays}d): ${recentSkippedCount} project(s). Use --include-recent to include.`
      )
    );
  }
  console.log();
  console.log(
    chalk.cyan(
      "Clean by id (same --path / --sort / --skip-recent-days / --include-recent / filters):"
    )
  );
  console.log(
    chalk.dim("  dev-clean clean -p . --ids 0,2 --dry-run")
  );
}
