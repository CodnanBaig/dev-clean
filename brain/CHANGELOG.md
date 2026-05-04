# brain / CHANGELOG

## 0.1.1 — 2026-05-04

- **Default scan root** `~/Development` added alongside Documents/Desktop/Projects/Code.
- **`dev-clean clean`**: interactive checkbox to choose **artifact types** (per selected projects); `--targets` comma list for non-interactive filtering; mutually exclusive with `--node-modules-only` / `--build-only`.
- **README** rewritten for GitHub ([CodnanBaig/dev-clean](https://github.com/CodnanBaig/dev-clean)); **package.json** `repository`, `bugs`, `homepage` set.

## 0.1.0 — 2026-05-04

- **Initial `dev-clean` CLI** in repo root: `scan` and `clean` commands, `du`-based sizing, whitelist-only deletes with `realpath` prefix checks, `~/.devcleanrc`, chalk/ora/inquirer UX, workspace package discovery via `package.json` `workspaces`, JSON scan export, default recency skip on `clean`.
