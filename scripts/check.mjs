#!/usr/bin/env node
/**
 * Dependency-free repository check.
 *
 * Verifies the bundle manifest, the Loader patch, the locale metadata, the shape
 * of the browser module, and one live engine round-trip against a throwaway git
 * repository — the things a broken commit would break before anyone installs the
 * plugin. Runs locally (`npm run check`) and in CI.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const failures = [];

function pass(message) {
  console.log(`ok   ${message}`);
}

function fail(message) {
  failures.push(message);
  console.error(`FAIL ${message}`);
}

function step(message, run) {
  try {
    const value = run();
    if (value === false) fail(message);
    else pass(message);
  } catch (error) {
    fail(`${message} — ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function asyncStep(message, run) {
  try {
    const value = await run();
    if (value === false) fail(message);
    else pass(message);
  } catch (error) {
    fail(`${message} — ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Run git in `cwd`, throwing on failure. */
function gitIn(cwd, args) {
  return execFileSync('git', args, { cwd, stdio: 'pipe' }).toString();
}

// ── layout ────────────────────────────────────────────────────────────────────
const requiredFiles = [
  'index.js',
  'client.js',
  'cordis.patch.yml',
  'icon.svg',
  'package.json',
  'bin/hbs-wt.js',
  'lib/engine.js',
  'lib/git.js',
  'lib/state.js',
  'lib/errors.js',
  'assets/hbs-worktree.md',
  'docs/CONTRACT.md',
  'locale/en.json',
  'locale/zh.json',
  'README.md',
  'README.zh.md',
  'CHANGELOG.md',
  'LICENSE',
  'CONTRIBUTING.md',
  'promo/home.png',
  '.github/workflows/ci.yml',
];
step('every shipped file exists', () => requiredFiles.every((file) => existsSync(join(root, file))));

// ── manifest ──────────────────────────────────────────────────────────────────
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
step('package name is hbs-worktree', () => manifest.name === 'hbs-worktree');
step('version is semver', () => /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/.test(manifest.version));
step('type is module', () => manifest.type === 'module');
step('exports the host and client entries', () => manifest.exports?.['.'] === './index.js' && manifest.exports?.['./client'] === './client.js');
step('exposes the hbs-wt binary', () => manifest.bin?.['hbs-wt'] === 'bin/hbs-wt.js');
step('declares a bundle patch', () => manifest.dsh?.bundle?.patch === './cordis.patch.yml');
step('declares a web client', () => manifest.dsh?.client?.platform === 'web' && Array.isArray(manifest.dsh.client.inject));
step('ships every runtime file', () => {
  const shipped = new Set(manifest.files ?? []);
  return ['index.js', 'client.js', 'cordis.patch.yml', 'bin/hbs-wt.js', 'lib/*.js', 'assets/*.md', 'locale/*.json', 'icon.svg', 'docs/CONTRACT.md', 'CONTRIBUTING.md']
    .every((file) => shipped.has(file));
});

// ── syntax ────────────────────────────────────────────────────────────────────
const sources = ['index.js', 'client.js', 'bin/hbs-wt.js', 'lib/engine.js', 'lib/git.js', 'lib/state.js', 'lib/errors.js'];
for (const file of sources) {
  step(`${file} parses`, () => execFileSync(process.execPath, ['--check', join(root, file)], { stdio: 'pipe' }) && true);
}

// ── loader patch ──────────────────────────────────────────────────────────────
const patch = readFileSync(join(root, 'cordis.patch.yml'), 'utf8');
step('patch inserts the row under the package name', () => {
  return patch.includes('insert:')
    && patch.includes('id: hbs-worktree')
    && patch.includes(`name: '${manifest.name}'`);
});

// ── locale metadata ───────────────────────────────────────────────────────────
for (const locale of ['en', 'zh']) {
  step(`locale/${locale}.json carries display metadata`, () => {
    const data = JSON.parse(readFileSync(join(root, 'locale', `${locale}.json`), 'utf8'));
    return typeof data.meta?.title === 'string' && data.meta.title.length > 0
      && typeof data.meta?.description === 'string' && data.meta.description.length > 0;
  });
}

// ── dictionaries ──────────────────────────────────────────────────────────────
const clientSource = readFileSync(join(root, 'client.js'), 'utf8');
const dictionary = (name) => {
  const block = new RegExp(`const ${name} = \\{([\\s\\S]*?)\\n    \\};`).exec(clientSource);
  if (block === null) throw new Error(`no ${name} dictionary`);
  return [...block[1].matchAll(/^ {6}([A-Za-z][\w]*):/gm)].map((match) => match[1]);
};

step('both dictionaries carry the same keys', () => {
  const en = dictionary('en').sort().join(',');
  const zh = dictionary('zh').sort().join(',');
  return en.length > 0 && en === zh;
});

step('every dictionary key is used by the page', () => {
  return dictionary('en').every((key) => clientSource.includes(`t('${key}')`));
});

// ── browser module shape ──────────────────────────────────────────────────────
let registered;
globalThis.window = {
  __ModuleLoader__: {
    load: (entry) => {
      registered = entry;
    },
  },
};

await asyncStep('client module registers under the package name', async () => {
  await import(pathToFileURL(join(root, 'client.js')).href);
  return registered !== undefined && registered.id === manifest.name;
});

await asyncStep('client module exports inject + apply', async () => {
  const reactStub = {
    createElement: () => null,
    useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
    useEffect: () => {},
    useRef: (init) => ({ current: init }),
    useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
    useCallback: (fn) => fn,
    useMemo: (fn) => fn(),
  };
  const requireStub = (specifier) => {
    if (specifier === 'react') return reactStub;
    throw new Error(`unexpected client import: ${specifier}`);
  };
  const exported = registered.factory(requireStub);
  const services = ['slots', 'locale', 'sessions', 'workspaces'];
  return typeof exported.apply === 'function'
    && Array.isArray(exported.inject)
    && services.every((service) => exported.inject.includes(service));
});

// ── engine round-trip ─────────────────────────────────────────────────────────
await asyncStep('engine runs one live round-trip', async () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'hbs-wt-check-'));
  try {
    const repo = join(sandbox, 'repo');
    execFileSync('mkdir', ['-p', repo]);
    gitIn(repo, ['init', '-q', '-b', 'main']);
    gitIn(repo, ['config', 'user.email', 'check@example.com']);
    gitIn(repo, ['config', 'user.name', 'check']);
    writeFileSync(join(repo, 'README.md'), '# sandbox\n');
    gitIn(repo, ['add', '-A']);
    gitIn(repo, ['commit', '-qm', 'init']);

    const { runCommand } = await import(pathToFileURL(join(root, 'lib/engine.js')).href);
    const envelope = async (cmd, args = {}) => runCommand(cmd, args, { root: repo });

    const plain = await runCommand('repo', {}, { root: sandbox });
    if (!plain.ok || plain.data.isGit !== false) throw new Error('a plain directory must report isGit:false');

    const facts = await envelope('repo');
    if (!facts.ok || facts.data.base !== 'main') throw new Error(`repo: ${JSON.stringify(facts)}`);

    const added = await envelope('add', { branch: 'A-a', note: '检查用' });
    if (!added.ok) throw new Error(`add: ${JSON.stringify(added.error)}`);
    if (!existsSync(join(repo, '.worktree', 'A-a', 'README.md'))) throw new Error('worktree directory missing');
    if (!readFileSync(join(repo, '.git', 'info', 'exclude'), 'utf8').includes('.worktree/')) throw new Error('info/exclude not updated');
    if (gitIn(repo, ['status', '--porcelain']) !== '') throw new Error('worktree directory is not ignored');

    const bound = await envelope('bind', { branch: 'A-a', session: 'session-check' });
    if (!bound.ok) throw new Error(`bind: ${JSON.stringify(bound.error)}`);
    const context = await envelope('env', { session: 'session-check' });
    if (!context.ok || context.data?.branch !== 'A-a') throw new Error('env did not resolve the binding');

    const listed = await envelope('list');
    if (!listed.ok || listed.data.worktrees.length !== 1) throw new Error('list lost the worktree');
    if (listed.data.worktrees[0].note !== '检查用') throw new Error('list lost the note');

    const duplicate = await envelope('add', { branch: 'A-A' });
    if (duplicate.ok || duplicate.error.code !== 'case-collision') throw new Error('case collision not rejected');

    const back = await envelope('switch', { branch: 'A-a' });
    if (!back.ok || back.data.detached !== true) throw new Error(`switch preview: ${JSON.stringify(back)}`);
    const backToBase = await envelope('switch', { branch: 'main' });
    if (!backToBase.ok) throw new Error(`switch back: ${JSON.stringify(backToBase.error)}`);

    const merged = await envelope('merge', { from: 'A-a' });
    if (!merged.ok) throw new Error(`merge: ${JSON.stringify(merged.error)}`);

    const removed = await envelope('remove', { branch: 'A-a', force: true });
    if (!removed.ok) throw new Error(`remove: ${JSON.stringify(removed.error)}`);
    if ((await envelope('list')).data.worktrees.length !== 0) throw new Error('remove left a worktree behind');
    return true;
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

// ── summary ───────────────────────────────────────────────────────────────────
if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log('\nall checks passed');
