import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);
export const VERSION = '0.2.0';
export const STATE = '.dev-clean';
const DAY = 86400000;
const UUID = /^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/;
const TARGETS = {
  node_modules: ['javascript', 'dependencies'], '.next': ['javascript', 'cache'],
  '.nuxt': ['javascript', 'cache'], '.turbo': ['javascript', 'cache'],
  '.parcel-cache': ['javascript', 'cache'], '.vite': ['javascript', 'cache'],
  coverage: ['javascript', 'builds'], dist: ['javascript', 'builds'],
  build: ['javascript', 'builds'], out: ['javascript', 'builds'],
  'storybook-static': ['javascript', 'builds'],
  '.venv': ['python', 'dependencies'], '__pycache__': ['python', 'cache'],
  '.pytest_cache': ['python', 'cache'], '.mypy_cache': ['python', 'cache'],
  '.ruff_cache': ['python', 'cache'], target: ['rust', 'builds'],
};
export const PROFILES = Object.freeze(['safe', 'caches', 'dependencies', 'builds', 'all']);
const SKIP = new Set(['.git', '.svn', '.hg', STATE, ...Object.keys(TARGETS)]);
const hash = (value) => createHash('sha256').update(value).digest('hex');
const slash = (s) => s.split(path.sep).join('/');
const fail = (message) => { throw new Error(message); };
const exists = async (file) => { try { return await fs.lstat(file); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } };
const identity = (s) => `${s.dev}:${s.ino}`;
export function nonnegative(value, label = 'number') {
  if (!/^\d+(?:\.\d+)?$/.test(String(value)) || !Number.isFinite(Number(value))) fail(`Invalid ${label}: ${value}`);
  return Number(value);
}
export function parseBytes(value) {
  const m = /^(\d+(?:\.\d+)?)\s*(B|KB|MB|GB|TB|KiB|MiB|GiB|TiB)?$/i.exec(String(value));
  if (!m) fail(`Invalid size: ${value}`);
  const unit = (m[2] ?? 'B').toUpperCase();
  const power = { B: 0, KB: 1, KIB: 1, MB: 2, MIB: 2, GB: 3, GIB: 3, TB: 4, TIB: 4 }[unit];
  const n = Number(m[1]) * (unit.includes('I') ? 1024 : 1000) ** power;
  if (!Number.isSafeInteger(Math.round(n))) fail('Size exceeds safe integer range');
  return Math.round(n);
}
export const formatBytes = (n) => { let i = 0; while (n >= 1024 && i < 4) { n /= 1024; i++; } return `${n.toFixed(i ? 1 : 0)} ${['B', 'KiB', 'MiB', 'GiB', 'TiB'][i]}`; };
function safeRelative(value, allowDot = false) {
  if (typeof value !== 'string' || value.includes('\0') || value.includes('\\') || path.isAbsolute(value) || value.split('/').some((p) => p === '..' || !p || (p === '.' && value !== '.'))) fail('Unsafe relative path');
  if (!allowDot && value === '.') fail('Refusing the root directory');
  return value;
}
function safeProject(value) {
  safeRelative(value, true);
  if (value !== '.' && value.split('/').some((part) => SKIP.has(part))) fail('Project is inside a protected or generated directory');
}
async function rootInfo(root) {
  const canonical = await fs.realpath(path.resolve(root));
  if (canonical === path.parse(canonical).root) fail('Refusing a filesystem root');
  const stat = await fs.lstat(canonical);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail('Root must be a real directory');
  return { root: canonical, rootIdentity: identity(stat) };
}
async function contained(root, relative, allowMissing = false) {
  safeRelative(relative, true);
  if (relative === '.') return root;
  let current = root;
  const parts = relative.split('/');
  for (let i = 0; i < parts.length; i++) {
    current = path.join(current, parts[i]);
    const s = await exists(current);
    if (!s && allowMissing && i === parts.length - 1) return current;
    if (!s) fail(`Path disappeared: ${relative}`);
    if (s.isSymbolicLink()) fail(`Refusing symlink path: ${relative}`);
    if (i < parts.length - 1 && !s.isDirectory()) fail(`Non-directory parent: ${relative}`);
  }
  return current;
}
async function privateDir(root, relative) {
  let current = root;
  for (const part of relative.split('/')) {
    current = path.join(current, part);
    try { await fs.mkdir(current, { mode: 0o700 }); } catch (e) { if (e.code !== 'EEXIST') throw e; }
    const s = await fs.lstat(current);
    if (!s.isDirectory() || s.isSymbolicLink()) fail('Unsafe state directory');
    if (process.getuid && s.uid !== process.getuid()) fail('State directory is owned by another user');
  }
  return current;
}
async function atomicJSON(file, data) {
  const tmp = `${file}.${randomUUID()}.tmp`;
  const handle = await fs.open(tmp, 'wx', 0o600);
  try { await handle.writeFile(JSON.stringify(data, null, 2) + '\n'); await handle.sync(); }
  finally { await handle.close(); }
  try { await fs.rename(tmp, file); } catch (e) { await fs.unlink(tmp).catch(() => {}); throw e; }
}
async function readJSON(file) {
  const s = await fs.lstat(file);
  if (!s.isFile() || s.isSymbolicLink() || s.size > 10000000) fail('Expected a regular JSON file below 10 MB');
  return JSON.parse(await fs.readFile(file, 'utf8'));
}
export async function fingerprint(target, maxFiles = 250000) {
  const digest = createHash('sha256');
  let files = 0, bytes = 0, latest = 0;
  const seen = new Set();
  async function walk(file, rel) {
    const s = await fs.lstat(file, { bigint: true });
    if (++files > maxFiles) fail(`Target exceeds ${maxFiles} filesystem entries`);
    digest.update(`${rel}\0${s.dev}:${s.ino}:${s.mode}:${s.size}:${s.mtimeNs}:${s.ctimeNs}\n`);
    latest = Math.max(latest, Number(s.mtimeMs));
    if (s.isDirectory()) for (const name of (await fs.readdir(file)).sort()) await walk(path.join(file, name), `${rel}/${name}`);
    else if (s.isFile() && !seen.has(identity(s))) { seen.add(identity(s)); bytes += Number(s.size); }
    // Symlinks inside a generated directory are recorded but never followed.
  }
  await walk(target, '.');
  if (!Number.isSafeInteger(bytes)) fail('Target size exceeds safe integer range');
  return { fingerprint: digest.digest('hex'), files, bytes, latestModifiedAt: latest };
}
function glob(pattern) {
  if (typeof pattern !== 'string' || pattern.length > 200 || pattern.includes('..') || pattern.includes('\\')) fail('Invalid exclusion pattern');
  let out = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*' && pattern[i + 1] === '*') { out += '.*'; i++; }
    else if (c === '*') out += '[^/]*';
    else if (c === '?') out += '[^/]';
    else out += c.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
  }
  return new RegExp(`^(?:${out})(?:/.*)?$`);
}
async function projectKind(dir) {
  const candidates = [['package.json', 'javascript'], ['pyproject.toml', 'python'], ['requirements.txt', 'python'], ['Cargo.toml', 'rust']];
  for (const [marker, ecosystem] of candidates) {
    const s = await exists(path.join(dir, marker));
    if (s?.isFile() && !s.isSymbolicLink()) return { ecosystem, marker, markerIdentity: identity(s) };
  }
  return null;
}
async function protect(root, project, target) {
  let cursor = project;
  while (true) {
    if (await exists(path.join(cursor, '.devclean-protect'))) fail('Protected by .devclean-protect');
    if (cursor === root) break;
    const parent = path.dirname(cursor);
    if (parent === cursor) fail('Project is outside approved root');
    cursor = parent;
  }
  // Tracked generated-looking directories are still source: never move or remove them.
  try {
    const { stdout } = await exec('git', ['-C', project, 'rev-parse', '--show-toplevel'], { timeout: 5000, maxBuffer: 1000000 });
    if (stdout.trim()) {
      const tracked = await exec('git', ['-C', project, 'ls-files', '-z', '--', target], { timeout: 5000, maxBuffer: 4000000 });
      if (tracked.stdout.length) fail('Target contains Git-tracked files');
    }
  } catch (e) {
    if (e.message === 'Target contains Git-tracked files') throw e;
    if (e.code === 'ENOENT') fail('Git is required for tracked-file protection');
    if (!String(e.stderr ?? '').includes('not a git repository')) throw e;
  }
}
export async function inspect(root, options = {}) {
  const info = await rootInfo(root);
  const profile = options.profile ?? 'safe';
  if (!PROFILES.includes(profile)) fail('Unknown profile');
  const excluded = (options.exclude ?? []).map(glob);
  const ignore = path.join(info.root, '.devcleanignore');
  if (await exists(ignore)) {
    const s = await fs.lstat(ignore);
    if (s.isSymbolicLink() || s.size > 65536) fail('Unsafe .devcleanignore');
    excluded.push(...(await fs.readFile(ignore, 'utf8')).split(/\r?\n/).map((v) => v.trim()).filter((v) => v && !v.startsWith('#')).map(glob));
  }
  const minBytes = options.minBytes ?? 0, olderThan = options.olderThanDays ?? 0;
  nonnegative(minBytes, 'minimum bytes'); nonnegative(olderThan, 'age');
  const maxDepth = options.maxDepth ?? 8;
  if (!Number.isInteger(maxDepth) || maxDepth < 0 || maxDepth > 30) fail('Depth must be an integer from 0 to 30');
  const projects = [], entries = [], warnings = [];
  let directories = 0;
  async function visit(dir, depth) {
    if (++directories > 50000) fail('Scan exceeds 50,000 directories; narrow --path or --depth');
    const relative = slash(path.relative(info.root, dir)) || '.';
    if (excluded.some((p) => p.test(relative))) return;
    if (await exists(path.join(dir, '.devclean-protect'))) { warnings.push({ path: relative, reason: 'Protected project/subtree' }); return; }
    const project = await projectKind(dir);
    if (project) {
      projects.push({ path: relative, ...project });
      for (const [target, [ecosystem, category]] of Object.entries(TARGETS)) {
        if (ecosystem !== project.ecosystem) continue;
        if (profile === 'safe' && category === 'builds') continue;
        if (profile !== 'safe' && profile !== 'all' && category !== (profile === 'caches' ? 'cache' : profile)) continue;
        const targetRelative = relative === '.' ? target : `${relative}/${target}`;
        if (excluded.some((p) => p.test(targetRelative))) continue;
        const stat = await exists(path.join(dir, target));
        if (!stat) continue;
        if (!stat.isDirectory() || stat.isSymbolicLink()) { warnings.push({ path: targetRelative, reason: 'Not a real generated directory' }); continue; }
        try {
          await protect(info.root, dir, target);
          const measured = await fingerprint(path.join(dir, target));
          if (measured.bytes < minBytes || Date.now() - measured.latestModifiedAt < olderThan * DAY) continue;
          entries.push({ id: hash(targetRelative).slice(0, 12), project: relative, target, path: targetRelative, ecosystem, category, ...measured });
        } catch (e) { warnings.push({ path: targetRelative, reason: e.message }); }
      }
    }
    if (depth >= maxDepth) return;
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      if (entry.isDirectory() && !entry.isSymbolicLink() && !SKIP.has(entry.name)) {
        try { await visit(path.join(dir, entry.name), depth + 1); }
        catch (e) { if (e.code === 'EACCES' || e.code === 'EPERM') warnings.push({ path: slash(path.relative(info.root, path.join(dir, entry.name))), reason: 'Permission denied' }); else throw e; }
      }
    }
  }
  await visit(info.root, 0);
  entries.sort((a, b) => b.bytes - a.bytes || a.path.localeCompare(b.path));
  return { schemaVersion: 1, toolVersion: VERSION, ...info, generatedAt: new Date().toISOString(), profile, projects, entries, totalBytes: entries.reduce((n, e) => n + e.bytes, 0), warnings };
}
export async function makePlan(root, options = {}) {
  const report = await inspect(root, options);
  const selected = options.ids ? new Set(options.ids) : null;
  if (selected && [...selected].some((id) => !report.entries.some((e) => e.id === id))) fail('Unknown target ID; inspect again with the same filters');
  const entries = report.entries.filter((e) => !selected || selected.has(e.id));
  const ttl = nonnegative(options.ttlHours ?? 24, 'plan lifetime');
  if (!ttl || ttl > 168) fail('Plan lifetime must be greater than 0 and at most 168 hours');
  return { ...report, id: randomUUID(), expiresAt: new Date(Date.now() + ttl * 3600000).toISOString(), entries, totalBytes: entries.reduce((n, e) => n + e.bytes, 0) };
}
export async function savePlan(file, plan) {
  const handle = await fs.open(file, 'wx', 0o600);
  try { await handle.writeFile(JSON.stringify(plan, null, 2) + '\n'); await handle.sync(); } finally { await handle.close(); }
}
export const loadPlan = readJSON;
function validatePlan(plan, info) {
  if (!plan || typeof plan !== 'object' || plan.schemaVersion !== 1 || !UUID.test(plan.id) || plan.root !== info.root || plan.rootIdentity !== info.rootIdentity) fail('Plan root/identity mismatch');
  const made = Date.parse(plan.generatedAt), expiry = Date.parse(plan.expiresAt);
  if (!Number.isFinite(made) || !Number.isFinite(expiry) || made > Date.now() + 60000 || expiry <= Date.now() || expiry - made > 169 * 3600000) fail('Plan expired or timestamps invalid');
  if (!Array.isArray(plan.entries) || plan.entries.length > 10000) fail('Invalid plan entries');
  const seen = new Set();
  for (const e of plan.entries) {
    safeProject(e.project);
    if (!Object.hasOwn(TARGETS, e.target) || !/^[a-f\d]{64}$/.test(e.fingerprint) || !Number.isSafeInteger(e.bytes) || e.bytes < 0 || !Number.isSafeInteger(e.files) || e.files < 1) fail('Invalid or disallowed target');
    const expected = e.project === '.' ? e.target : `${e.project}/${e.target}`;
    if (e.path !== expected || seen.has(expected) || e.id !== hash(expected).slice(0, 12)) fail('Tampered or duplicate plan path');
    seen.add(expected);
  }
  if (plan.totalBytes !== plan.entries.reduce((n, e) => n + e.bytes, 0) || !Number.isSafeInteger(plan.totalBytes)) fail('Invalid plan total');
  // A plan must not move an ancestor and its descendant in one operation.
  for (const a of seen) for (const b of seen) if (a !== b && b.startsWith(`${a}/`)) fail('Overlapping cleanup targets');
}
async function withLock(info, action) {
  const state = await privateDir(info.root, STATE);
  await privateDir(info.root, `${STATE}/history`);
  await privateDir(info.root, `${STATE}/trash`);
  const file = path.join(state, 'operation.lock');
  let handle;
  try { handle = await fs.open(file, 'wx', 0o600); }
  catch (e) { if (e.code === 'EEXIST') fail('Another operation or an interrupted operation holds the lock. Inspect with doctor; do not delete an active lock.'); throw e; }
  const lockIdentity = identity(await handle.stat());
  try {
    await handle.writeFile(JSON.stringify({ pid: process.pid, host: os.hostname(), startedAt: new Date().toISOString() }));
    await handle.sync();
    return await action(state);
  } finally {
    await handle.close();
    const current = await exists(file);
    if (current && identity(current) === lockIdentity) await fs.unlink(file);
  }
}
async function preflight(info, e) {
  const project = await contained(info.root, e.project);
  const kind = await projectKind(project);
  if (!kind || kind.ecosystem !== e.ecosystem || TARGETS[e.target][0] !== kind.ecosystem) fail(`Project marker changed: ${e.project}`);
  const file = await contained(info.root, e.path);
  if (!(await fs.lstat(file)).isDirectory()) fail('Target is no longer a directory');
  await protect(info.root, project, e.target);
  const fresh = await fingerprint(file);
  if (fresh.fingerprint !== e.fingerprint) fail(`Stale plan: ${e.path} changed; create a new plan`);
  return file;
}
export async function applyPlan(plan, { root, dryRun = true } = {}) {
  if (!root) fail('An explicit approved root is required');
  const info = await rootInfo(root);
  validatePlan(plan, info);
  if (dryRun) { for (const e of plan.entries) await preflight(info, e); return { dryRun: true, operationId: plan.id, selected: plan.entries.length, bytesToQuarantine: plan.totalBytes, bytesFreed: 0 }; }
  return withLock(info, async (state) => {
    const journalPath = path.join(state, 'history', `${plan.id}.json`);
    const planHash = hash(JSON.stringify(plan));
    if (await exists(journalPath)) {
      const prior = await readJSON(journalPath);
      if (prior.planHash !== planHash) fail('Operation ID was already used with a different plan');
      if (prior.status !== 'completed') fail('Operation was interrupted or failed; use history and recover before retrying');
      return { ...prior, alreadyApplied: true };
    }
    for (const e of plan.entries) await preflight(info, e);
    const journal = { schemaVersion: 1, id: plan.id, planHash, ...info, startedAt: new Date().toISOString(), status: 'running', bytesFreed: 0, entries: plan.entries.map((e) => ({ ...e, state: 'pending', trash: `${STATE}/trash/${plan.id}/${e.id}` })) };
    await privateDir(info.root, `${STATE}/trash/${plan.id}`);
    await atomicJSON(journalPath, journal);
    try {
      for (const e of journal.entries) {
        const source = await preflight(info, e);
        const destination = await contained(info.root, e.trash, true);
        if (await exists(destination)) fail('Quarantine destination already exists');
        // Journal intent before rename. EXDEV fails closed; no unsafe copy-and-delete fallback.
        e.state = 'moving'; await atomicJSON(journalPath, journal);
        await fs.rename(source, destination);
        e.state = 'quarantined'; await atomicJSON(journalPath, journal);
      }
      journal.status = 'completed';
    } catch (e) { journal.status = 'failed'; journal.error = e.code === 'EXDEV' ? 'Cross-device quarantine refused; select a root on the same filesystem' : e.message; }
    journal.finishedAt = new Date().toISOString();
    journal.bytesQuarantined = journal.entries.filter((e) => e.state === 'quarantined').reduce((n, e) => n + e.bytes, 0);
    await atomicJSON(journalPath, journal);
    return journal;
  });
}
async function loadJournal(info, id) {
  if (!UUID.test(id)) fail('Invalid operation ID');
  const file = await contained(info.root, `${STATE}/history/${id}.json`);
  const journal = await readJSON(file);
  if (!journal || typeof journal !== 'object' || journal.schemaVersion !== 1 || journal.id !== id || journal.root !== info.root || journal.rootIdentity !== info.rootIdentity || !Array.isArray(journal.entries) || journal.entries.length > 10000) fail('Invalid journal');
  const seen = new Set();
  for (const e of journal.entries) {
    safeProject(e.project);
    const expected = e.project === '.' ? e.target : `${e.project}/${e.target}`;
    if (!['pending', 'moving', 'quarantined', 'restoring', 'restored', 'purging', 'purged'].includes(e.state) || !Number.isSafeInteger(e.bytes) || e.bytes < 0 || !Object.hasOwn(TARGETS, e.target) || e.path !== expected || e.id !== hash(expected).slice(0, 12) || e.trash !== `${STATE}/trash/${id}/${e.id}` || seen.has(e.path)) fail('Tampered journal path');
    seen.add(e.path);
  }
  return { journal, file };
}
export async function history(root) {
  const info = await rootInfo(root);
  if (!await exists(path.join(info.root, STATE))) return [];
  const dir = await contained(info.root, `${STATE}/history`);
  const rows = [];
  for (const name of (await fs.readdir(dir)).filter((n) => n.endsWith('.json')).sort()) {
    const { journal } = await loadJournal(info, name.slice(0, -5));
    rows.push(journal);
  }
  return rows.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}
export async function recover(root, id) {
  const info = await rootInfo(root);
  return withLock(info, async () => {
    const { journal, file } = await loadJournal(info, id);
    for (const e of journal.entries) {
      if (e.state !== 'moving' && e.state !== 'restoring' && e.state !== 'purging') continue;
      const source = await contained(info.root, e.path, true);
      const trash = await contained(info.root, e.trash, true);
      const s = await exists(source), t = await exists(trash);
      if (e.state === 'moving' && s && !t) e.state = 'pending';
      else if (e.state === 'moving' && !s && t) e.state = 'quarantined';
      else if (e.state === 'restoring' && s && !t) e.state = 'restored';
      else if (e.state === 'restoring' && !s && t) e.state = 'quarantined';
      else if (e.state === 'purging' && !t) e.state = 'purged';
      else if (e.state === 'purging' && t) fail('Interrupted permanent purge: inspect quarantine manually before continuing');
      else fail(`Ambiguous interrupted operation: ${e.path}; no files changed`);
    }
    journal.recoveredAt = new Date().toISOString();
    journal.status = journal.entries.every((e) => e.state === 'quarantined') ? 'completed' : 'recovered';
    await atomicJSON(file, journal);
    return journal;
  });
}
export async function restore(root, id, { dryRun = true } = {}) {
  const info = await rootInfo(root);
  const run = async () => {
    const { journal, file } = await loadJournal(info, id);
    const selected = journal.entries.filter((e) => e.state === 'quarantined');
    for (const e of selected) {
      const project = await contained(info.root, e.project);
      if (!await projectKind(project)) fail('Project marker missing during restore');
      await contained(info.root, e.trash);
      const destination = await contained(info.root, e.path, true);
      if (await exists(destination)) fail(`Restore would overwrite ${e.path}; nothing restored`);
    }
    if (dryRun) return { dryRun: true, operationId: id, restorable: selected.length, bytesFreed: 0 };
    for (const e of selected) {
      const source = await contained(info.root, e.trash);
      const destination = await contained(info.root, e.path, true);
      if (await exists(destination)) fail(`Destination appeared during restore: ${e.path}`);
      e.state = 'restoring'; await atomicJSON(file, journal);
      await fs.rename(source, destination);
      e.state = 'restored'; await atomicJSON(file, journal);
    }
    journal.restoredAt = new Date().toISOString();
    await atomicJSON(file, journal);
    return journal;
  };
  return dryRun ? run() : withLock(info, run);
}
export async function purge(root, id, { dryRun = true, permanent = false } = {}) {
  const info = await rootInfo(root);
  if (!dryRun && !permanent) fail('Permanent deletion requires explicit permanent confirmation');
  const run = async () => {
    const { journal, file } = await loadJournal(info, id);
    const selected = journal.entries.filter((e) => e.state === 'quarantined');
    for (const e of selected) await contained(info.root, e.trash);
    if (dryRun) return { dryRun: true, operationId: id, targets: selected.length, apparentBytes: selected.reduce((n, e) => n + e.bytes, 0) };
    for (const e of selected) {
      const target = await contained(info.root, e.trash);
      // Only generated, validated quarantine paths are eligible for permanent deletion.
      e.state = 'purging'; await atomicJSON(file, journal);
      await fs.rm(target, { recursive: true, force: false });
      e.state = 'purged'; await atomicJSON(file, journal);
    }
    journal.purgedAt = new Date().toISOString();
    journal.apparentBytesPurged = journal.entries.filter((e) => e.state === 'purged').reduce((n, e) => n + e.bytes, 0);
    await atomicJSON(file, journal);
    return journal;
  };
  return dryRun ? run() : withLock(info, run);
}
export function diffPlans(before, after) {
  if (before.root !== after.root) fail('Cannot compare different roots');
  const a = new Map(before.entries.map((e) => [e.path, e])), b = new Map(after.entries.map((e) => [e.path, e]));
  const changes = [...new Set([...a.keys(), ...b.keys()])].sort().map((p) => ({ path: p, change: !a.has(p) ? 'added' : !b.has(p) ? 'removed' : a.get(p).fingerprint !== b.get(p).fingerprint ? 'changed' : 'unchanged', beforeBytes: a.get(p)?.bytes ?? 0, afterBytes: b.get(p)?.bytes ?? 0 })).filter((e) => e.change !== 'unchanged');
  return { root: before.root, changes, byteDelta: changes.reduce((n, e) => n + e.afterBytes - e.beforeBytes, 0) };
}
export async function doctor(root) {
  const info = await rootInfo(root);
  let git = false;
  try { await exec('git', ['--version'], { timeout: 3000 }); git = true; } catch { /* reported, not hidden */ }
  const s = await exists(path.join(info.root, STATE));
  let lock = null;
  if (s) { await contained(info.root, STATE); if (await exists(path.join(info.root, STATE, 'operation.lock'))) lock = await readJSON(await contained(info.root, `${STATE}/operation.lock`)); }
  return { ...info, toolVersion: VERSION, node: process.version, gitAvailable: git, operationLock: lock, profiles: PROFILES, safety: { symlinksFollowed: false, trackedFilesProtected: git, defaultApplyIsDryRun: true, quarantineFreesSpace: false, concurrentOperationsSerialized: true }, caveats: ['Stop dev servers before applying; process detection is not guaranteed.', 'Metadata fingerprints are not cryptographic file-content backups.', 'Filesystem checks cannot defeat a malicious process racing file mutations under the same account.', 'A stale lock is not automatically removed. Confirm the recorded process has exited before manually removing it.'] };
}
