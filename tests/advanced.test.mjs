import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makePlan, inspect, applyPlan, restore, purge, history, recover, fingerprint, savePlan, loadPlan, diffPlans, doctor, parseBytes, nonnegative } from '../advanced/core.mjs';
const exec = promisify(execFile);
const cli = fileURLToPath(new URL('../bin/dev-clean-advanced.js', import.meta.url));
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dev-clean-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const put = async (name, content = 'fixture') => { await fs.mkdir(path.dirname(path.join(root, name)), { recursive: true }); await fs.writeFile(path.join(root, name), content); };
  await put('app/package.json', '{}'); await put('app/.next/cache.bin', 'cache');
  await put('app/node_modules/x/index.js', 'dependency'); await put('app/src/index.ts', 'source'); await put('app/.env', 'never read or delete');
  return { root, put };
}
const missing = async (file) => { await assert.rejects(fs.lstat(file), { code: 'ENOENT' }); };
for (const [s, expected] of [['1KB', 1000], ['1KiB', 1024], ['1.5MB', 1500000], ['0', 0], ['2GiB', 2147483648]]) test(`parse size ${s}`, () => assert.equal(parseBytes(s), expected));
for (const s of ['-1', '1junk', 'Infinity', '1e9', '2GBx', '']) test(`reject invalid size ${s}`, () => assert.throws(() => parseBytes(s)));
for (const s of ['1abc', '-1', 'Infinity']) test(`strict numeric input ${s}`, () => assert.throws(() => nonnegative(s)));
test('read-only inspect finds generated artifacts and never source or secrets', async (t) => {
  const { root } = await fixture(t); const report = await inspect(root);
  assert.deepEqual(report.entries.map((e) => e.target).sort(), ['.next', 'node_modules']);
  await missing(path.join(root, '.dev-clean')); assert.equal(report.totalBytes, 15);
});
test('default profile does not include ambiguous build outputs', async (t) => {
  const { root, put } = await fixture(t); await put('app/dist/source.js', 'could be source');
  assert.ok(!(await inspect(root)).entries.some((e) => e.target === 'dist'));
  assert.ok((await inspect(root, { profile: 'builds' })).entries.some((e) => e.target === 'dist'));
});
test('Python and Rust profiles, monorepo discovery and skip generated nested projects', async (t) => {
  const { root, put } = await fixture(t);
  await put('python/pyproject.toml', '[project]'); await put('python/.venv/lib/f.py'); await put('rust/Cargo.toml', '[package]'); await put('rust/target/debug/test');
  await put('app/packages/sub/package.json', '{}'); await put('app/packages/sub/.next/a'); await put('app/node_modules/vendor/package.json', '{}');
  const report = await inspect(root, { profile: 'all' });
  assert.equal(report.projects.length, 4); assert.ok(report.entries.some((e) => e.ecosystem === 'rust')); assert.ok(report.entries.some((e) => e.ecosystem === 'python'));
});
test('min size, age and stable ID selection', async (t) => {
  const { root } = await fixture(t);
  assert.equal((await inspect(root, { minBytes: 10 })).entries.length, 1);
  assert.equal((await inspect(root, { olderThanDays: 1 })).entries.length, 0);
  const a = await makePlan(root); const b = await makePlan(root, { ids: [a.entries[0].id] });
  assert.equal(b.entries.length, 1); assert.equal(a.entries[0].id, b.entries[0].id);
  await assert.rejects(makePlan(root, { ids: ['invalid'] }), /Unknown target/);
});
test('exclusions, protect markers and depth boundaries', async (t) => {
  const { root, put } = await fixture(t);
  assert.equal((await inspect(root, { maxDepth: 0 })).entries.length, 0);
  await put('.devcleanignore', 'app/node_modules\n');
  assert.equal((await inspect(root)).entries.length, 1);
  await put('app/.devclean-protect', ''); assert.equal((await inspect(root)).entries.length, 0);
});
test('Git-tracked artifact directory is protected', async (t) => {
  const { root } = await fixture(t);
  await exec('git', ['init', '-q', root]); await exec('git', ['-C', root, 'add', 'app/.next/cache.bin']);
  const report = await inspect(root); assert.equal(report.entries.length, 1);
  assert.match(report.warnings[0].reason, /Git-tracked/);
});
test('dry-run apply creates no journal and changes nothing', async (t) => {
  const { root } = await fixture(t); const plan = await makePlan(root);
  const result = await applyPlan(plan, { root }); assert.equal(result.dryRun, true);
  await missing(path.join(root, '.dev-clean')); assert.equal(await fs.readFile(path.join(root, 'app/.next/cache.bin'), 'utf8'), 'cache');
});
test('quarantine, history, idempotent apply and lossless restore', async (t) => {
  const { root } = await fixture(t); const plan = await makePlan(root);
  const result = await applyPlan(plan, { root, dryRun: false }); assert.equal(result.status, 'completed'); assert.equal(result.bytesFreed, 0); assert.equal(result.bytesQuarantined, 15);
  await missing(path.join(root, 'app/.next')); assert.equal((await history(root)).length, 1);
  assert.equal((await applyPlan(plan, { root, dryRun: false })).alreadyApplied, true);
  assert.equal((await restore(root, plan.id)).restorable, 2); await missing(path.join(root, 'app/.next'));
  await restore(root, plan.id, { dryRun: false });
  assert.equal(await fs.readFile(path.join(root, 'app/.next/cache.bin'), 'utf8'), 'cache');
  assert.equal(await fs.readFile(path.join(root, 'app/.env'), 'utf8'), 'never read or delete');
  assert.equal(await fs.readFile(path.join(root, 'app/src/index.ts'), 'utf8'), 'source');
});
test('stale plan aborts before any target is moved', async (t) => {
  const { root, put } = await fixture(t); const plan = await makePlan(root); await put('app/.next/new.bin');
  await assert.rejects(applyPlan(plan, { root, dryRun: false }), /Stale plan/);
  assert.ok(await fs.stat(path.join(root, 'app/node_modules')));
});
test('expired plan and wrong root are rejected', async (t) => {
  const { root } = await fixture(t); const p = await makePlan(root); p.expiresAt = '2000-01-01T00:00:00.000Z';
  await assert.rejects(applyPlan(p, { root }), /expired/);
  await assert.rejects(applyPlan(await makePlan(root), { root: path.join(root, 'app') }), /mismatch/);
});
test('tampered paths, duplicate IDs and disallowed targets fail closed', async (t) => {
  const { root } = await fixture(t);
  for (const mutate of [(p) => { p.entries[0].project = '../elsewhere'; }, (p) => { p.entries[0].target = '.env'; }, (p) => { p.entries.push(p.entries[0]); }, (p) => { p.entries[0].path = '/tmp'; }]) {
    const plan = await makePlan(root); mutate(plan); await assert.rejects(applyPlan(plan, { root }));
  }
});
test('top-level symlink is not followed, and replacement after plan is rejected', async (t) => {
  const { root, put } = await fixture(t); await put('outside/keep', 'keep');
  const plan = await makePlan(root); await fs.rm(path.join(root, 'app/.next'), { recursive: true });
  try { await fs.symlink(path.join(root, 'outside'), path.join(root, 'app/.next'), 'junction'); }
  catch (e) { if (e.code === 'EPERM') { t.skip('Symlink creation unavailable'); return; } throw e; }
  await assert.rejects(applyPlan(plan, { root }), /symlink/);
  assert.ok(!(await inspect(root)).entries.some((e) => e.target === '.next'));
  assert.equal(await fs.readFile(path.join(root, 'outside/keep'), 'utf8'), 'keep');
});
test('internal symlinks survive quarantine and purge does not follow them', async (t) => {
  const { root, put } = await fixture(t); await put('outside/keep', 'safe');
  try { await fs.symlink(path.join(root, 'outside'), path.join(root, 'app/.next/link'), 'junction'); }
  catch (e) { if (e.code === 'EPERM') { t.skip('Symlink creation unavailable'); return; } throw e; }
  const plan = await makePlan(root); await applyPlan(plan, { root, dryRun: false }); await purge(root, plan.id, { dryRun: false, permanent: true });
  assert.equal(await fs.readFile(path.join(root, 'outside/keep'), 'utf8'), 'safe');
});
test('restore refuses existing destination and does not partially restore', async (t) => {
  const { root, put } = await fixture(t); const plan = await makePlan(root); await applyPlan(plan, { root, dryRun: false });
  await put('app/.next/new', 'new build'); await assert.rejects(restore(root, plan.id, { dryRun: false }), /overwrite/);
  await missing(path.join(root, 'app/node_modules')); assert.equal(await fs.readFile(path.join(root, 'app/.next/new'), 'utf8'), 'new build');
});
test('permanent purge needs two deliberate switches and only touches quarantine', async (t) => {
  const { root } = await fixture(t); const plan = await makePlan(root); await applyPlan(plan, { root, dryRun: false });
  await assert.rejects(purge(root, plan.id, { dryRun: false }), /confirmation/);
  const preview = await purge(root, plan.id); assert.equal(preview.dryRun, true);
  const done = await purge(root, plan.id, { dryRun: false, permanent: true }); assert.equal(done.apparentBytesPurged, 15);
  assert.equal(await fs.readFile(path.join(root, 'app/src/index.ts'), 'utf8'), 'source');
  assert.equal((await purge(root, plan.id)).targets, 0);
});
test('active operation lock is not stolen', async (t) => {
  const { root, put } = await fixture(t); const plan = await makePlan(root);
  await put('.dev-clean/operation.lock', JSON.stringify({ pid: process.pid }));
  await assert.rejects(applyPlan(plan, { root, dryRun: false }), /holds the lock/);
  assert.equal((await doctor(root)).operationLock.pid, process.pid);
});
test('journal traversal ID is rejected', async (t) => {
  const { root } = await fixture(t); await assert.rejects(restore(root, '../../outside'), /Invalid operation/);
});
test('interrupted rename is reconciled without deleting data', async (t) => {
  const { root } = await fixture(t); const plan = await makePlan(root); await applyPlan(plan, { root, dryRun: false });
  const file = path.join(root, '.dev-clean/history', `${plan.id}.json`); const journal = JSON.parse(await fs.readFile(file, 'utf8')); journal.entries[0].state = 'moving'; journal.status = 'running'; await fs.writeFile(file, JSON.stringify(journal));
  const reconciled = await recover(root, plan.id); assert.equal(reconciled.entries[0].state, 'quarantined');
  await restore(root, plan.id, { dryRun: false }); assert.ok(await fs.stat(path.join(root, 'app/node_modules')));
});
test('plan save never overwrites and diff detects changes', async (t) => {
  const { root, put } = await fixture(t); const before = await makePlan(root); const file = path.join(root, 'plan.json'); await savePlan(file, before);
  await assert.rejects(savePlan(file, before), { code: 'EEXIST' }); assert.equal((await loadPlan(file)).id, before.id);
  await put('app/.next/extra', 'extra'); const diff = diffPlans(before, await makePlan(root)); assert.equal(diff.changes.length, 1); assert.equal(diff.byteDelta, 5);
});
test('fingerprint does not read file contents and enforces entry bound', async (t) => {
  const { root } = await fixture(t); const file = path.join(root, 'app/.next');
  const a = await fingerprint(file); assert.equal(a.files, 2); await assert.rejects(fingerprint(file, 1), /exceeds/);
});
test('CLI JSON report and preview path need no installed packages', async (t) => {
  const { root } = await fixture(t); const { stdout } = await exec(process.execPath, [cli, 'inspect', '-p', root, '--json']); assert.equal(JSON.parse(stdout).entries.length, 2);
  const file = path.join(root, 'plan.json'); await exec(process.execPath, [cli, 'plan', '-p', root, '--output', file, '--json']);
  const r = await exec(process.execPath, [cli, 'apply', file, '-p', root, '--json']); assert.equal(JSON.parse(r.stdout).dryRun, true);
  await missing(path.join(root, '.dev-clean'));
});
test('CLI errors are nonzero and default restore/apply requires approved root', async (t) => {
  const { root } = await fixture(t); const file = path.join(root, 'plan.json'); await savePlan(file, await makePlan(root));
  await assert.rejects(exec(process.execPath, [cli, 'apply', file, '--yes']), (e) => e.code === 2 && e.stderr.includes('explicit --path'));
  await assert.rejects(exec(process.execPath, [cli, 'inspect', '-p', root, '--depth', '1no']), (e) => e.code === 2);
});

test('plans reject noncanonical and protected project paths before mutation', async (t) => {
  const { root } = await fixture(t);
  for (const project of ['app/./nested', '.git/project', '.dev-clean/project', 'app/node_modules/vendor']) {
    const p = await makePlan(root); p.entries[0].project = project;
    await assert.rejects(applyPlan(p, { root, dryRun: false }));
  }
  await missing(path.join(root, '.dev-clean'));
});
test('plan sizes cannot be forged', async (t) => {
  const { root } = await fixture(t);
  for (const change of [(p) => p.entries[0].bytes = -1, (p) => p.totalBytes = 12345]) {
    const p = await makePlan(root); change(p); await assert.rejects(applyPlan(p, { root }));
  }
});
test('a protection marker added after scanning prevents apply', async (t) => {
  const { root, put } = await fixture(t); const p = await makePlan(root); await put('app/.devclean-protect', '');
  await assert.rejects(applyPlan(p, { root }), /Protected/);
});
test('a tampered journal cannot redirect purge outside quarantine', async (t) => {
  const { root } = await fixture(t); const p = await makePlan(root); await applyPlan(p, { root, dryRun: false });
  const file = path.join(root, '.dev-clean/history', `${p.id}.json`);
  const journal = JSON.parse(await fs.readFile(file, 'utf8')); journal.entries[0].trash = 'app/src'; await fs.writeFile(file, JSON.stringify(journal));
  await assert.rejects(purge(root, p.id, { dryRun: false, permanent: true }), /Tampered/);
  assert.equal(await fs.readFile(path.join(root, 'app/src/index.ts'), 'utf8'), 'source');
});
test('symlinked state directory is refused', async (t) => {
  const { root, put } = await fixture(t); const p = await makePlan(root); await put('outside/keep', 'safe');
  try { await fs.symlink(path.join(root, 'outside'), path.join(root, '.dev-clean'), 'junction'); }
  catch (e) { if (e.code === 'EPERM') { t.skip('Symlink creation unavailable'); return; } throw e; }
  await assert.rejects(applyPlan(p, { root, dryRun: false }), /Unsafe state/);
  assert.equal(await fs.readFile(path.join(root, 'outside/keep'), 'utf8'), 'safe');
});
test('workspace paths with spaces and Unicode round-trip', async (t) => {
  const { root, put } = await fixture(t); await put('space café/package.json', '{}'); await put('space café/.next/file', 'hello');
  const p = await makePlan(root); await applyPlan(p, { root, dryRun: false }); await restore(root, p.id, { dryRun: false });
  assert.equal(await fs.readFile(path.join(root, 'space café/.next/file'), 'utf8'), 'hello');
});
