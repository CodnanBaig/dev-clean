# dev-clean

**Workspace maintenance you can review and undo.**

Find generated development artifacts across JavaScript, Python and Rust projects. Save an expiring cleanup plan, validate that nothing changed, quarantine deliberately, and restore without overwriting. Permanently purge only after a separate explicit confirmation.

Version **0.2.0**, source release candidate. This revision is **not published to npm**. GitHub Actions verifies Node 20/22 on Linux, macOS and Windows; consult the exact commit's run for the current result.

## Start from source

```sh
git clone https://github.com/CodnanBaig/dev-clean.git
cd dev-clean
git switch feat/advanced-safe-cleanup
# Advanced commands use only Node built-ins; no installation needed:
node bin/dev-clean.js inspect --path "$HOME/Code" --min-size 10MB
node bin/dev-clean.js plan --path "$HOME/Code" --profile caches --output cleanup-plan.json
node bin/dev-clean.js apply cleanup-plan.json --path "$HOME/Code"
# Review the plan, stop builds/dev servers, then explicitly quarantine:
node bin/dev-clean.js apply cleanup-plan.json --path "$HOME/Code" --yes
node bin/dev-clean.js history --path "$HOME/Code" --json
```

Requires **Node 20+ and Git**. Use your actual workspace path; PowerShell users can supply `--path "$HOME\Code"`. To compile and install the legacy commands too: `pnpm install --frozen-lockfile && pnpm build && pnpm link --global`.

## Capabilities

| Area | Implemented behavior |
|---|---|
| Discovery | Marker-based JS/Python/Rust projects and monorepos; generated/vendor/VCS directories are not traversed |
| Selection | Safe/cache/dependency/build/all profiles, size/age/depth filters, stable target IDs, exclusions and protected subtrees |
| Review | JSON plans, 24-hour expiry, approved-root identity, per-target metadata fingerprints and before/after diffs |
| Safety | Dry-run default, Git-tracked-file protection, symlink refusal, allowlisted targets, no source-content scanning or telemetry |
| Recovery | Same-volume quarantine, intent journals, operation locking, non-overwriting restore and interrupted-operation reconciliation |
| Automation | Machine-readable output, strict options and nonzero failure exits; no automatic or scheduled deletion |
| Verification | 42 disposable-fixture tests, TypeScript legacy build, package checks and production dependency audit in CI |

**Quarantine does not free disk space.** It moves generated files into `<root>/.dev-clean/trash` for recovery. Only `purge --yes --permanent` deletes quarantined data. Reported sizes are apparent bytes, not guaranteed disk space recovered.

```sh
# Copy the operation ID from the saved plan/history:
node bin/dev-clean.js restore OPERATION_ID --path "$HOME/Code"       # preview
node bin/dev-clean.js restore OPERATION_ID --path "$HOME/Code" --yes
node bin/dev-clean.js purge OPERATION_ID --path "$HOME/Code"         # preview
node bin/dev-clean.js purge OPERATION_ID --path "$HOME/Code" --yes --permanent
node bin/dev-clean.js doctor --path "$HOME/Code"
node bin/dev-clean.js advanced-help
```

## Documentation and limits

[Advanced workflow, configuration, recovery and threat model](docs/ADVANCED.md) · [Legacy scan/list/clean reference](docs/LEGACY.md)

Legacy `clean` remains **permanently destructive** after confirmation; it is not the new quarantine workflow. The `safe` profile deliberately excludes ambiguous build-output directories. Review every plan. Stop active builds first: filesystem metadata checks cannot prevent every race with another process. Journals are recoverable, but a multi-target operation is not an all-or-nothing filesystem transaction. Add `.dev-clean/` to the workspace's `.gitignore`.

## Verify

```sh
node --test tests/advanced.test.mjs
# Including the legacy TypeScript build:
pnpm install --frozen-lockfile
pnpm build
pnpm test
```

Tests use temporary synthetic workspaces, never your development folders. No hosted cleanup endpoint, background agent or npm publication is installed.

## License

MIT. Contributions welcome through GitHub issues and pull requests.
