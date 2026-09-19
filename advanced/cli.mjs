import { parseArgs } from 'node:util';
import path from 'node:path';
import { inspect, makePlan, applyPlan, savePlan, loadPlan, history, restore, purge, recover, doctor, diffPlans, parseBytes, nonnegative, formatBytes, VERSION } from './core.mjs';

export const HELP = `dev-clean ${VERSION} — advanced workspace maintenance

  inspect                  Scan JS, Python and Rust project artifacts
  plan --output plan.json  Save a bounded, reviewable cleanup plan
  apply plan.json          Validate a plan; --yes moves targets to quarantine
  history                  Show per-root durable operation journals
  restore <operation-id>   Preview recovery; --yes restores without overwrite
  purge <operation-id>     Preview removal; --yes --permanent deletes quarantine
  recover <operation-id>   --yes reconciles an interrupted journal (no deletion)
  diff before.json after.json  Compare two saved plans from the same root
  doctor                   Report safety capabilities and operation lock
  init --output config.json   Write an example configuration; never overwrites

Options:
  -p, --path <directory>    Workspace root (required explicitly for apply/restore/purge/recover)
  --profile <name>         safe (default), caches, dependencies, builds, all
  --exclude <pattern>      Repeatable root-relative exclusion; also .devcleanignore
  --min-size <size>        e.g. 10MB, 1GiB; apparent bytes, not disk allocation
  --older-than <days>      Include only targets with no recent metadata changes
  --depth <number>         Project discovery depth, 0–30; default 8
  --ids <id,id>            Select stable target IDs when creating a plan
  --config <file>          Optional JSON configuration
  --output <file>          Save plan/config to a NEW file with mode 0600
  --yes                    Explicitly allow the requested mutation
  --dry-run                Always preview, even when --yes is supplied
  --json                   Structured output; errors go to stderr
  --help                   Show this help

No files are moved by inspect, plan (except its requested output), doctor, diff,
apply/restore/purge without --yes. Quarantine is reversible but does NOT free
space. Only an explicitly confirmed purge permanently removes those files.
Legacy scan/list/clean commands remain available; prefer plan/apply for recovery.
`;
const cleanText = (s) => String(s).replace(/[\x00-\x1f\x7f]/g, (c) => `\\x${c.charCodeAt(0).toString(16).padStart(2, '0')}`);
export async function runAdvanced(args = process.argv.slice(2)) {
  const { values: v, positionals } = parseArgs({ args, allowPositionals: true, strict: true, options: {
    path: { type: 'string', short: 'p' }, profile: { type: 'string' }, exclude: { type: 'string', multiple: true },
    'min-size': { type: 'string' }, 'older-than': { type: 'string' }, depth: { type: 'string' }, ids: { type: 'string' },
    config: { type: 'string' }, output: { type: 'string' }, yes: { type: 'boolean' }, 'dry-run': { type: 'boolean' },
    permanent: { type: 'boolean' }, json: { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
  } });
  if (v.help || positionals[0] === 'advanced-help') { console.log(HELP); return 0; }
  const [command, first, second, ...rest] = positionals;
  if (rest.length || (command !== 'diff' && second)) throw new Error('Unexpected positional arguments');
  const config = v.config ? await loadPlan(v.config) : {};
  if (!config || Array.isArray(config) || typeof config !== 'object') throw new Error('Config must be an object');
  if (config.exclude && (!Array.isArray(config.exclude) || config.exclude.some((s) => typeof s !== 'string'))) throw new Error('Config exclude must be an array of patterns');
  const root = v.path ?? (config.path ? path.resolve(v.config ? path.dirname(v.config) : '.', config.path) : process.cwd());
  const mutating = ['apply', 'restore', 'purge', 'recover'];
  if (mutating.includes(command) && !v.path) throw new Error('Use an explicit --path for this operation; paths from a downloaded plan are not trusted');
  const options = {
    profile: v.profile ?? config.profile ?? 'safe', exclude: [...(config.exclude ?? []), ...(v.exclude ?? [])],
    minBytes: parseBytes(v['min-size'] ?? config.minSize ?? '0'),
    olderThanDays: nonnegative(v['older-than'] ?? config.olderThanDays ?? 0, 'days'),
    maxDepth: nonnegative(v.depth ?? config.depth ?? 8, 'depth'),
    ...(v.ids ? { ids: v.ids.split(',').filter(Boolean) } : {}),
  };
  const dryRun = !v.yes || Boolean(v['dry-run']);
  let result;
  switch (command) {
    case 'inspect': result = await inspect(root, options); break;
    case 'plan':
      if (!v.output) throw new Error('plan requires --output <new-file.json>');
      result = await makePlan(root, options); await savePlan(v.output, result); break;
    case 'apply':
      if (!first) throw new Error('apply requires a saved plan filename');
      result = await applyPlan(await loadPlan(first), { root, dryRun }); break;
    case 'history': result = await history(root); break;
    case 'restore':
      if (!first) throw new Error('restore requires an operation ID');
      result = await restore(root, first, { dryRun }); break;
    case 'purge':
      if (!first) throw new Error('purge requires an operation ID');
      result = await purge(root, first, { dryRun, permanent: Boolean(v.permanent) }); break;
    case 'recover':
      if (!first || dryRun) throw new Error('recover requires an operation ID and --yes; it only reconciles journal state');
      result = await recover(root, first); break;
    case 'doctor': result = await doctor(root); break;
    case 'diff':
      if (!first || !second) throw new Error('diff requires two saved plan filenames');
      result = diffPlans(await loadPlan(first), await loadPlan(second)); break;
    case 'init':
      if (!v.output) throw new Error('init requires --output <new-file.json>');
      result = { path: '.', profile: 'safe', minSize: '1MiB', olderThanDays: 0, depth: 8, exclude: ['important-project', '**/fixtures'] };
      await savePlan(v.output, result); break;
    default: throw new Error(`Unknown advanced command: ${command ?? '(missing)'}`);
  }
  if (v.json || !result?.entries || !['inspect', 'plan'].includes(command)) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`Workspace: ${cleanText(result.root)}\nProfile: ${result.profile}\n`);
    for (const e of result.entries) console.log(`${e.id}  ${formatBytes(e.bytes).padStart(12)}  ${e.ecosystem.padEnd(10)}  ${cleanText(e.path)}`);
    console.log(`\n${result.entries.length} targets • ${formatBytes(result.totalBytes)} apparent bytes • ${result.warnings.length} warnings`);
    if (command === 'plan') console.log(`Saved ${cleanText(v.output)}\nOperation ${result.id}\nExpires ${result.expiresAt}\nNext: apply this plan with an explicit --path; add --yes only after reviewing it.`);
    for (const warning of result.warnings) console.error(`Skipped ${cleanText(warning.path)}: ${cleanText(warning.reason)}`);
  }
  return result?.status === 'failed' ? 1 : 0;
}
