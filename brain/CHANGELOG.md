# brain / CHANGELOG

## 0.1.2 — 2026-05-04

- **`dev-clean list`** (alias **`ls`**): PM2-style table with numeric **project ids**, `--json` with ids, same filters as `clean` so ids match **`clean --ids`**.
- **`clean --ids`**: clean chosen projects by id; scoped with **`-p` / `--path`** for a single directory tree. Shared pipeline in [`src/lib/project-pipeline.ts`](src/lib/project-pipeline.ts).

## 0.1.1 — 2026-05-04

- **Default scan root** `~/Development` added alongside Documents/Desktop/Projects/Code.
- **`dev-clean clean`**: interactive checkbox to choose **artifact types** (per selected projects); `--targets` comma list for non-interactive filtering; mutually exclusive with `--node-modules-only` / `--build-only`.
- **README** rewritten for GitHub ([CodnanBaig/dev-clean](https://github.com/CodnanBaig/dev-clean)); **package.json** `repository`, `bugs`, `homepage` set.

## 0.1.0 — 2026-05-04

- **Initial `dev-clean` CLI** in repo root: `scan` and `clean` commands, `du`-based sizing, whitelist-only deletes with `realpath` prefix checks, `~/.devcleanrc`, chalk/ora/inquirer UX, workspace package discovery via `package.json` `workspaces`, JSON scan export, default recency skip on `clean`.
