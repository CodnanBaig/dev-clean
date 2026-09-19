# dev-clean 0.2 — review, quarantine, recover

The advanced workflow is additive. Existing `scan`, `list`, and `clean` remain available. **Legacy `clean` removes files permanently. Use `plan`/`apply` for the reversible workflow.** Nothing is published to npm by this change.

## A normal cleanup

```sh
# From the source checkout; no installation needed for advanced commands:
node bin/dev-clean.js inspect --path "$HOME/Code" --profile safe --min-size 10MB
node bin/dev-clean.js plan --path "$HOME/Code" --profile caches --output ./cleanup-plan.json
node bin/dev-clean.js apply ./cleanup-plan.json --path "$HOME/Code"       # read-only preflight
node bin/dev-clean.js apply ./cleanup-plan.json --path "$HOME/Code" --yes # quarantine
node bin/dev-clean.js history --path "$HOME/Code" --json
# Copy operationId/id from the plan or history:
node bin/dev-clean.js restore OPERATION_ID --path "$HOME/Code"            # preview
node bin/dev-clean.js restore OPERATION_ID --path "$HOME/Code" --yes      # no overwrite
# Only when the quarantined artifacts are no longer needed:
node bin/dev-clean.js purge OPERATION_ID --path "$HOME/Code" --yes --permanent
```

Installed package commands are identical without `node bin/`. `dev-clean-advanced` exposes the same advanced commands separately. `advanced-help` documents every flag. Quarantine uses a same-filesystem rename: **it does not free disk space**. Only purge removes quarantined entries. Reported sizes are apparent bytes, not physical allocation or guaranteed freed space.

## Profiles and discovery

`safe` selects recognized dependency and cache directories. `caches`, `dependencies`, `builds`, and `all` allow narrower or broader review. Ambiguous `dist`, `build`, `out`, `coverage`, Rust `target`, and Storybook outputs are excluded from `safe`. Builds can contain valuable output: inspect the plan yourself. Git-tracked candidates are refused under every profile.

Markers: `package.json` for JavaScript; `pyproject.toml` or `requirements.txt` for Python; `Cargo.toml` for Rust. Generated directories, VCS metadata, symlinked directories and the tool's state directory are not traversed. Monorepo subprojects are discovered independently. Polyglot directories currently use the first matching marker, in the order above. Nested Python caches not directly beneath a discovered project are not automatically selected.

Filters: `--min-size 500MB`, `--older-than 14`, `--depth 6`, repeatable `--exclude 'client-*'`, and stable `--ids <id,id>` for plan creation. Target IDs are derived from root-relative paths, not unstable result indexes. One root is approved per advanced operation; run separate plans for separate disks/workspaces. A `.devclean-protect` file protects its entire subtree. `.devcleanignore` accepts root-relative `*`, `**`, `?` patterns and `#` comments; it is deliberately not full gitignore syntax.

`init --output ./devclean.json` writes an example JSON config without overwriting. Config paths resolve relative to the config file. Mutations always require a separate explicit `--path`, even when a plan or config has a path.

## Safety and recoverability

Plans expire after 24 hours. Every selected target is validated before the first move, and again immediately before its own move. The approved root identity, ecosystem marker, path allowlist, protection markers, Git tracked-file list and complete target metadata fingerprint are checked. Symlinks are not followed. `--dry-run` overrides `--yes`. Unknown arguments and invalid numbers fail with a nonzero exit.

Quarantine and journals are stored beneath `<approved-root>/.dev-clean/` (add that directory to `.gitignore`). Private modes are requested on POSIX. An exclusive operation lock serializes mutations from this tool. Intent is flushed to the journal before each move. Restore refuses to overwrite a newly generated replacement. Cross-filesystem moves fail closed rather than copying then deleting. Failed multi-target operations retain their journal and any already-quarantined data; they are not an all-or-nothing filesystem transaction.

`doctor --path ...` reports the Git prerequisite, environment, safety caveats and any operation lock. `recover OPERATION_ID --path ... --yes` reconciles interrupted move/restore intents from actual source/trash existence without deleting files. Ambiguity requires manual inspection. A stale lock is never stolen: confirm the recorded process is no longer running before removing it. `diff before.json after.json` reports added, removed and changed targets and apparent byte deltas.

## Limits and threat model

Stop dev servers/builds before applying. The tool cannot reliably discover every process or defeat a malicious process racing filesystem changes under the same account. Fingerprints describe names/inodes/size/timestamps; they are not cryptographic content backups. Hardlinks are counted once per target but may still be shared across targets, disks may be compressed, and quarantine on another volume is refused. Git must be installed; failures inspecting tracked files fail closed. Secrets, source contents and telemetry are not read or sent anywhere. No daemon, scheduled deletion, global package-cache purge, arbitrary plugin deletion, or automatic permanently destructive cleanup is installed.

## Verification

Run `node --test tests/advanced.test.mjs` or `pnpm test`. Fixtures live only in disposable temporary directories. Tests cover quarantine/restore, dry runs, expired/stale/tampered plans, protected paths, Git-tracked files, symlinks, journal tampering, lock contention, recovery, CLI errors, profiles, filters and Unicode paths. GitHub Actions runs Node 20/22 on Linux, macOS and Windows, builds the legacy CLI and checks the package. Consult the exact commit's Actions run for observed results; configuration alone does not establish a passing matrix.
