# dev-clean

Find Node.js / Next.js projects on disk and remove **only** safe, heavy artifacts (`node_modules`, `.next`, `dist`, caches, root `*.log`, etc.). Never touches source or `.env`.

**Repository:** [github.com/CodnanBaig/dev-clean](https://github.com/CodnanBaig/dev-clean)

## Installation

Clone the repo, install dependencies, compile, and link the binary:

```sh
git clone https://github.com/CodnanBaig/dev-clean.git
cd dev-clean
pnpm install
pnpm run build
pnpm link --global
```

Use npm instead of pnpm if you prefer:

```sh
npm install
npm run build
npm link
```

Requires **Node.js 20+**.

## Getting started

Scan default folders under your home directory:

```sh
dev-clean scan
```

Preview a clean (no deletes):

```sh
dev-clean clean --path ~/Projects --all --dry-run
```

## Usage

### Scan

Discover projects (directories with `package.json`) under the scan roots, then print reclaimable size per artifact folder.

Default roots: `~/Documents`, `~/Desktop`, `~/Projects`, `~/Code`, `~/Development`. Override with `-p` / `--path` (repeatable) or `scanRoots` in `~/.devcleanrc`.

```sh
dev-clean scan
dev-clean scan -p ~/Code -p ~/Work
dev-clean scan --json > report.json
dev-clean scan --sort name
dev-clean scan --skip-recent-days 14
```

### One directory only

Point every command at a single tree (or several) with **`-p` / `--path`**. Examples:

```sh
dev-clean list -p ~/Developer
dev-clean scan -p ~/Developer/my-monorepo
dev-clean clean -p ~/Developer/my-app --ids 0 --dry-run
```

`list` / `clean --ids` use the **same** discovery, sort, and recency rules, so ids stay aligned.

### List (PM2-style ids)

`dev-clean list` (alias `dev-clean ls`) prints a **table of projects with numeric ids** (largest reclaimable first by default). Use those ids with `clean --ids`.

**Note:** Unlike `scan`, `list` applies the same **default recency skip as `clean`** (last 7 days on `package.json` unless you pass `--include-recent` or `--skip-recent-days`). That keeps ids in sync with what `clean --ids` will target.

```sh
dev-clean list
dev-clean list -p ~/Projects
dev-clean list -p ~/Code --sort name --include-recent
dev-clean list --json
```

### Clean

1. Pick **projects** (checkbox), unless you pass `--all` or **`--ids`**.
2. Pick **artifact types** (checkbox): e.g. `node_modules`, `.next`, root logs. Skipped if you pass `--yes`, `--targets`, `--node-modules-only`, or `--build-only`.
3. Confirm once, unless `--yes` or `--dry-run`.

```sh
dev-clean clean
dev-clean clean --path ~/Projects --all --dry-run
dev-clean clean -p ~/Projects --ids 0,2 --dry-run
dev-clean clean -p ~/Projects --ids 1 --yes --targets node_modules
dev-clean clean --all --yes --targets node_modules,.next
dev-clean clean --all --yes --node-modules-only
dev-clean clean --include-recent
```

**Flags (clean)**

| Flag | Purpose |
|------|---------|
| `-p, --path <dir>` | Scan root (repeatable) |
| `--all` | Include every matching project (skip project checkbox). Do not combine with `--ids`. |
| `--ids <n,n>` | Pick projects by id from `dev-clean list` using the **same** `-p`, `--sort`, `--skip-recent-days`, `--include-recent`, and measure flags |
| `--yes` | Skip artifact-type prompt and final confirm (still obeys `--dry-run`) |
| `--dry-run` | Print what would be removed; no deletes |
| `--targets <a,b>` | Non-interactive artifact list (e.g. `node_modules,.next,log_files`). Do not combine with `--node-modules-only` or `--build-only` |
| `--node-modules-only` | Only `node_modules` |
| `--build-only` | Build outputs only (`.next`, `dist`, `build`, `.turbo`, caches, …) |
| `--skip-recent-days <n>` | Skip projects whose `package.json` was touched within N days (default **7** when omitted; use `--include-recent` to disable) |
| `--config <file>` | JSON config path (default `~/.devcleanrc`) |
| `--sort size\|name` | Order projects before selection / ids |

**Flags (scan)** — same `--path`, `--config`, `--sort`; plus `--json`, `--skip-recent-days`.

**Flags (list)** — same `--path`, `--config`, `--sort`, `--skip-recent-days`, `--include-recent`, `--node-modules-only`, `--build-only`, `--json` as `list`.

Allowed `--targets` / checkbox ids: `node_modules`, `.next`, `dist`, `build`, `.turbo`, `coverage`, `.nuxt`, `out`, `storybook-static`, `.parcel-cache`, `.vite`, `logs`, `.cache`, `log_files`.

## Configuration

Create `~/.devcleanrc` (JSON). CLI flags override file values.

```json
{
  "scanRoots": ["~/Documents", "~/Desktop", "~/Projects", "~/Code", "~/Development"],
  "skipRecentDays": 7,
  "excludePatterns": ["**/Library/**", "**/.Trash/**"]
}
```

## Safety

Deletes only whitelisted top-level paths under each project root (plus `*.log` files in that root). Does **not** delete `.env*`, `src`, `app`, or unknown paths. Resolves `realpath` and checks prefix before `fs.rm`.

## Contributing

Everyone is encouraged to help improve this project, from the code to the docs. Open an issue or pull request on [GitHub](https://github.com/CodnanBaig/dev-clean).

## License

MIT
