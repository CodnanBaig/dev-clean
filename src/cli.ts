#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { runScan } from "./commands/scan.js";
import { runClean } from "./commands/clean.js";
import { runList } from "./commands/list.js";
import type { SortKey } from "./lib/types.js";
import { CLEAN_TARGET_IDS, isCleanTargetId } from "./lib/constants.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
  readFileSync(join(__dirname, "..", "package.json"), "utf8")
) as { version: string; description: string };

function parseSort(value: string): SortKey {
  if (value === "name" || value === "size") return value;
  throw new Error(`Invalid --sort "${value}" (use size or name)`);
}

function parseDays(value: string): number {
  const n = parseInt(value, 10);
  if (Number.isNaN(n) || n < 0) {
    throw new Error(`Invalid day count: ${value}`);
  }
  return n;
}

function parseIds(value: string): number[] {
  const parts = value.split(",").map((s) => s.trim()).filter(Boolean);
  const out: number[] = [];
  for (const p of parts) {
    if (!/^\d+$/.test(p)) {
      throw new Error(
        `Invalid --ids entry "${p}". Use comma-separated non-negative integers, e.g. 0,2,5.`
      );
    }
    out.push(parseInt(p, 10));
  }
  return [...new Set(out)].sort((a, b) => a - b);
}

function parseTargets(value: string): string[] {
  const parts = value.split(",").map((s) => s.trim()).filter(Boolean);
  for (const p of parts) {
    if (!isCleanTargetId(p)) {
      throw new Error(
        `Invalid --targets entry "${p}". Allowed: ${CLEAN_TARGET_IDS.join(", ")}`
      );
    }
  }
  return parts;
}

const program = new Command();

program
  .name("dev-clean")
  .description(pkg.description)
  .version(pkg.version);

program
  .command("scan")
  .description("Find JS/Node projects and estimate reclaimable space")
  .option("-p, --path <dir>", "scan root (repeatable)", (v, prev: string[]) => {
    prev.push(v);
    return prev;
  }, [] as string[])
  .option("--config <file>", "path to JSON config (~/.devcleanrc by default)")
  .option("--json", "print JSON report to stdout")
  .option("--sort <by>", "size or name", parseSort, "size" as SortKey)
  .option(
    "--skip-recent-days <n>",
    "hide projects whose package.json was modified within the last N days",
    parseDays
  )
  .action(async (cmdOpts: {
    path: string[];
    config?: string;
    json?: boolean;
    sort: SortKey;
    skipRecentDays?: number;
  }) => {
    await runScan({
      path: cmdOpts.path,
      config: cmdOpts.config,
      json: cmdOpts.json,
      sort: cmdOpts.sort,
      skipRecentDays: cmdOpts.skipRecentDays,
    });
  });

program
  .command("list")
  .alias("ls")
  .description("List projects with numeric ids (same ordering as clean --ids)")
  .option("-p, --path <dir>", "scan root (repeatable)", (v, prev: string[]) => {
    prev.push(v);
    return prev;
  }, [] as string[])
  .option("--config <file>", "path to JSON config (~/.devcleanrc by default)")
  .option("--json", "machine-readable output with ids")
  .option("--sort <by>", "size or name", parseSort, "size" as SortKey)
  .option(
    "--skip-recent-days <n>",
    "same meaning as clean: hide recently touched projects only when explicitly set",
    parseDays
  )
  .option(
    "--include-recent",
    "include recently modified projects (same as clean)"
  )
  .option("--node-modules-only", "measure only node_modules (same as clean)")
  .option("--build-only", "measure only build outputs (same as clean)")
  .action(async (cmdOpts: {
    path: string[];
    config?: string;
    json?: boolean;
    sort: SortKey;
    skipRecentDays?: number;
    includeRecent?: boolean;
    nodeModulesOnly?: boolean;
    buildOnly?: boolean;
  }) => {
    if (cmdOpts.nodeModulesOnly && cmdOpts.buildOnly) {
      program.error("Use only one of --node-modules-only or --build-only");
    }
    await runList({
      path: cmdOpts.path,
      config: cmdOpts.config,
      json: cmdOpts.json,
      sort: cmdOpts.sort,
      skipRecentDays: cmdOpts.skipRecentDays,
      includeRecent: cmdOpts.includeRecent,
      nodeModulesOnly: cmdOpts.nodeModulesOnly,
      buildOnly: cmdOpts.buildOnly,
    });
  });

program
  .command("clean")
  .description("Interactively or automatically remove safe artifact folders")
  .option("-p, --path <dir>", "scan root (repeatable)", (v, prev: string[]) => {
    prev.push(v);
    return prev;
  }, [] as string[])
  .option("--config <file>", "path to JSON config (~/.devcleanrc by default)")
  .option("--yes", "skip confirmation prompts (still respects dry-run)")
  .option("--dry-run", "print actions without deleting")
  .option("--all", "select all matching projects (skip project checkbox)")
  .option(
    "--ids <list>",
    "comma-separated project ids from `dev-clean list` (same -p/--sort/--skip-recent-days/--include-recent). Incompatible with --all",
    parseIds
  )
  .option("--node-modules-only", "only target node_modules")
  .option("--build-only", "only target build outputs (.next, dist, build, caches, …)")
  .option(
    "--targets <list>",
    `comma-separated artifact types (non-interactive); e.g. node_modules,.next,log_files. Allowed: ${CLEAN_TARGET_IDS.join(", ")}`,
    parseTargets
  )
  .option(
    "--skip-recent-days <n>",
    "skip projects modified within N days (no default filter unless set)",
    parseDays
  )
  .option(
    "--include-recent",
    "include recently modified projects (overrides --skip-recent-days)"
  )
  .option("--sort <by>", "size or name", parseSort, "size" as SortKey)
  .action(async (cmdOpts: {
    path: string[];
    config?: string;
    yes?: boolean;
    dryRun?: boolean;
    all?: boolean;
    nodeModulesOnly?: boolean;
    buildOnly?: boolean;
    skipRecentDays?: number;
    includeRecent?: boolean;
    sort: SortKey;
    targets?: string[];
    ids?: number[];
  }) => {
    if (cmdOpts.nodeModulesOnly && cmdOpts.buildOnly) {
      program.error("Use only one of --node-modules-only or --build-only");
    }
    if (
      cmdOpts.targets &&
      cmdOpts.targets.length > 0 &&
      (cmdOpts.nodeModulesOnly || cmdOpts.buildOnly)
    ) {
      program.error("Do not combine --targets with --node-modules-only or --build-only");
    }
    if (cmdOpts.ids && cmdOpts.ids.length > 0 && cmdOpts.all) {
      program.error("Do not combine --ids with --all");
    }
    await runClean({
      path: cmdOpts.path,
      config: cmdOpts.config,
      yes: cmdOpts.yes,
      dryRun: cmdOpts.dryRun,
      all: cmdOpts.all,
      projectIds: cmdOpts.ids,
      nodeModulesOnly: cmdOpts.nodeModulesOnly,
      buildOnly: cmdOpts.buildOnly,
      targetTypes: cmdOpts.targets,
      skipRecentDays: cmdOpts.skipRecentDays,
      includeRecent: cmdOpts.includeRecent,
      sort: cmdOpts.sort,
    });
  });

await program.parseAsync(process.argv);
