/**
 * Engine tests against real git repositories — the v2 model, where the project
 * directory itself is the main business checkout.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

const { runCommand } = await import('../lib/engine.js');

const sandboxes = [];

after(() => {
  for (const dir of sandboxes) rmSync(dir, { recursive: true, force: true });
});

/** Run git, returning trimmed stdout. */
function git(cwd, args) {
  return execFileSync('git', args, { cwd, stdio: 'pipe' }).toString().trim();
}

/** Create a repository with one commit on `main`. */
function makeRepo() {
  const sandbox = mkdtempSync(join(tmpdir(), 'hbs-wt-engine-'));
  sandboxes.push(sandbox);
  const repo = join(sandbox, 'repo');
  execFileSync('mkdir', ['-p', repo]);
  git(repo, ['init', '-q', '-b', 'main']);
  git(repo, ['config', 'user.email', 'test@example.com']);
  git(repo, ['config', 'user.name', 'test']);
  writeFileSync(join(repo, 'README.md'), '# repo\n');
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-qm', 'init']);
  const run = (cmd, args = {}) => runCommand(cmd, args, { root: repo });
  return { repo, run };
}

/** Commit one file inside a worktree. */
function commitFile(worktree, file, content, message) {
  writeFileSync(join(worktree, file), content);
  git(worktree, ['add', '-A']);
  git(worktree, ['commit', '-qm', message]);
}

/** Assert the envelope failed with one code. */
function expectCode(envelope, code) {
  assert.equal(envelope.ok, false, `expected failure ${code}, got ${JSON.stringify(envelope)}`);
  assert.equal(envelope.error.code, code, `expected ${code}, got ${envelope.error.code}: ${envelope.error.message}`);
}

describe('engine', () => {
  it('reports a plain directory as "not a git repository"', async () => {
    const sandbox = mkdtempSync(join(tmpdir(), 'hbs-wt-plain-'));
    sandboxes.push(sandbox);
    const envelope = await runCommand('repo', {}, { root: sandbox });
    assert.equal(envelope.ok, true);
    assert.equal(envelope.data.isGit, false);
    expectCode(await runCommand('list', {}, { root: sandbox }), 'not-a-repo');
  });

  it('adopts the checked-out branch as the main business branch', async () => {
    const { repo, run } = makeRepo();
    const envelope = await run('repo');
    assert.equal(envelope.ok, true);
    assert.equal(envelope.data.isGit, true);
    assert.equal(envelope.data.base, 'main');
    assert.equal(envelope.data.currentBranch, 'main');
    assert.equal(envelope.data.detached, false);
    assert.equal(realpathSync(envelope.data.root), realpathSync(repo));
  });

  it('creates a worktree under worktree/ and keeps it out of git status', async () => {
    const { repo, run } = makeRepo();
    const created = await run('add', { branch: 'A-a', note: '解析器重写' });
    assert.equal(created.ok, true, JSON.stringify(created));
    assert.equal(created.data.worktree.branch, 'A-a');
    assert.equal(realpathSync(created.data.worktree.path), realpathSync(join(repo, '.worktree', 'A-a')));
    assert.ok(existsSync(join(repo, '.worktree', 'A-a', 'README.md')));
    assert.equal(git(repo, ['rev-parse', '--abbrev-ref', 'A-a']), 'A-a');
    assert.equal(git(repo, ['status', '--porcelain']), '', 'worktree directory must be ignored');
    assert.match(readFileSync(join(repo, '.git', 'info', 'exclude'), 'utf8'), /worktree\//);

    const state = JSON.parse(readFileSync(join(repo, '.worktree', '.hbs-state.json'), 'utf8'));
    assert.equal(state.base, 'main');
    assert.equal(state.entries['A-a'].note, '解析器重写');
  });

  it('rejects duplicate, case-colliding, base, and malformed branch names', async () => {
    const { run } = makeRepo();
    await run('add', { branch: 'A-a' });
    expectCode(await run('add', { branch: 'A-a' }), 'branch-exists');
    expectCode(await run('add', { branch: 'A-A' }), 'case-collision');
    expectCode(await run('add', { branch: 'main' }), 'branch-exists');
    expectCode(await run('add', { branch: 'bad name' }), 'invalid-name');
    expectCode(await run('add', { branch: '../x' }), 'invalid-name');
    expectCode(await run('add', { branch: '.hbs-state.json' }), 'invalid-name');
  });

  it('accepts legal git branch names with slashes everywhere', async () => {
    const { repo, run } = makeRepo();
    git(repo, ['branch', 'feature/tm/v-3.58.0']);

    const switched = await run('switch', { branch: 'feature/tm/v-3.58.0' });
    assert.equal(switched.ok, true, JSON.stringify(switched));
    assert.equal(git(repo, ['rev-parse', '--abbrev-ref', 'HEAD']), 'feature/tm/v-3.58.0');
    assert.equal((await run('repo')).data.base, 'feature/tm/v-3.58.0');

    const added = await run('add', { branch: 'feat/parser' });
    assert.equal(added.ok, true, JSON.stringify(added));
    assert.ok(existsSync(join(repo, '.worktree', 'feat', 'parser', 'README.md')), 'slash branch becomes a nested directory');
    assert.ok((await run('list')).data.worktrees.some((row) => row.branch === 'feat/parser'));

    // `feat` would nest a worktree inside the existing `feat/parser` one.
    expectCode(await run('add', { branch: 'feat' }), 'branch-exists');

    const removed = await run('remove', { branch: 'feat/parser', force: true });
    assert.equal(removed.ok, true, JSON.stringify(removed));
    assert.equal(git(repo, ['branch', '--list', 'feat/parser']), '');
  });

  it('migrates a 0.4.x worktree/ layout to .worktree/', async () => {
    const { repo, run } = makeRepo();
    // Build the old layout by hand: a worktree under worktree/ and its metadata.
    mkdirSync(join(repo, 'worktree'), { recursive: true });
    git(repo, ['worktree', 'add', join(repo, 'worktree', 'old-br'), '-b', 'old-br', 'main']);
    writeFileSync(
      join(repo, 'worktree', '.hbs-state.json'),
      JSON.stringify({ version: 2, base: 'main', entries: { 'old-br': { session: 's-old', note: '旧备注', createdAt: '2026-11-10T00:00:00.000Z' } } }),
    );

    const listed = await run('list');
    assert.equal(listed.ok, true, JSON.stringify(listed));
    const row = listed.data.worktrees[0];
    assert.equal(row.branch, 'old-br');
    assert.equal(realpathSync(row.path), realpathSync(join(repo, '.worktree', 'old-br')));
    assert.equal(row.session, 's-old', 'the binding survives the move');
    assert.equal(row.note, '旧备注', 'the note survives the move');
    assert.equal(existsSync(join(repo, 'worktree')), false, 'the legacy directory is gone');
    assert.ok(existsSync(join(repo, '.worktree', '.hbs-state.json')));
  });

  it('lists worktrees with git-derived facts and stored metadata', async () => {
    const { repo, run } = makeRepo();
    await run('add', { branch: 'A-a', session: 'session-1', note: '重写解析器' });
    commitFile(join(repo, '.worktree', 'A-a'), 'a.txt', 'x\n', 'feat: a');

    const listed = await run('list');
    assert.equal(listed.ok, true);
    assert.equal(listed.data.base, 'main');
    assert.equal(listed.data.worktrees.length, 1);
    const row = listed.data.worktrees[0];
    assert.equal(row.branch, 'A-a');
    assert.equal(row.exists, true);
    assert.equal(row.dirty, false);
    assert.equal(row.ahead, 1);
    assert.equal(row.session, 'session-1');
    assert.equal(row.note, '重写解析器');
  });

  it('turns auto-commit on by default and lets one worktree opt out', async () => {
    const { run } = makeRepo();
    const added = await run('add', { branch: 'A-a' });
    assert.equal(added.data.worktree.autoCommit, true, 'auto-commit is the default');
    assert.equal((await run('list')).data.worktrees[0].autoCommit, true);

    const off = await run('update', { branch: 'A-a', autoCommit: false });
    assert.equal(off.ok, true, JSON.stringify(off));
    assert.equal(off.data.autoCommit, false);
    assert.equal((await run('list')).data.worktrees[0].autoCommit, false);

    const bound = await run('bind', { branch: 'A-a', session: 'session-auto' });
    assert.equal(bound.ok, true);
    const context = await run('env', { session: 'session-auto' });
    assert.equal(context.data.autoCommit, false, 'the session reads the setting through env');

    assert.equal((await run('update', { branch: 'A-a', autoCommit: true })).data.autoCommit, true);
    expectCode(await run('update', { branch: 'missing', autoCommit: false }), 'unknown-worktree');
  });

  it('refuses to preview a worktree that has uncommitted changes', async () => {
    const { repo, run } = makeRepo();
    await run('add', { branch: 'A-a' });
    writeFileSync(join(repo, '.worktree', 'A-a', 'wip.txt'), 'wip\n');
    expectCode(await run('switch', { branch: 'A-a' }), 'worktree-dirty');
    // Once it is committed the preview works again.
    git(join(repo, '.worktree', 'A-a'), ['add', '-A']);
    git(join(repo, '.worktree', 'A-a'), ['commit', '-qm', 'feat: wip']);
    assert.equal((await run('switch', { branch: 'A-a' })).ok, true);
  });

  it('binds a session, moves the binding, and resolves it through env', async () => {
    const { run } = makeRepo();
    await run('add', { branch: 'A-a' });
    await run('add', { branch: 'A-b' });

    const bound = await run('bind', { branch: 'A-a', session: 'session-1' });
    assert.equal(bound.ok, true, JSON.stringify(bound));
    assert.equal((await run('env', { session: 'session-1' })).data.branch, 'A-a');
    assert.equal((await run('env', { session: 'session-2' })).data, null);

    const moved = await run('bind', { branch: 'A-b', session: 'session-1' });
    assert.equal(moved.data.movedFrom, 'A-a');
    assert.equal((await run('env', { session: 'session-1' })).data.branch, 'A-b');

    await run('unbind', { branch: 'A-b' });
    assert.equal((await run('env', { session: 'session-1' })).data, null);
    expectCode(await run('bind', { branch: 'missing', session: 's' }), 'unknown-worktree');
  });

  it('refuses to delete the main business branch', async () => {
    const { run } = makeRepo();
    expectCode(await run('remove', { branch: 'main' }), 'main-busy');
  });

  it('guards remove against dirty and unmerged worktrees, force overrides', async () => {
    const { repo, run } = makeRepo();
    await run('add', { branch: 'A-a' });
    commitFile(join(repo, '.worktree', 'A-a'), 'a.txt', 'x\n', 'feat: a');
    expectCode(await run('remove', { branch: 'A-a' }), 'unmerged-commits');

    writeFileSync(join(repo, '.worktree', 'A-a', 'dirty.txt'), 'wip\n');
    const forced = await run('remove', { branch: 'A-a', force: true });
    assert.equal(forced.ok, true, JSON.stringify(forced));
    assert.equal(existsSync(join(repo, '.worktree', 'A-a')), false);
    assert.equal(git(repo, ['branch', '--list', 'A-a']), '');
    assert.equal((await run('list')).data.worktrees.length, 0);
  });

  it('previews a worktree branch detached and keeps the base steady', async () => {
    const { repo, run } = makeRepo();
    await run('add', { branch: 'A-a' });
    const switched = await run('switch', { branch: 'A-a' });
    assert.equal(switched.ok, true, JSON.stringify(switched));
    assert.equal(switched.data.detached, true);
    // The branch stays checked out in its worktree; the main checkout only shows it.
    assert.equal(git(repo, ['rev-parse', '--abbrev-ref', 'HEAD']), 'HEAD');

    const during = await run('list');
    assert.equal(during.data.preview, 'A-a');
    assert.equal(during.data.currentBranch, null);
    assert.equal(during.data.base, 'main', 'previewing a worktree must not move the base');

    const back = await run('switch', { branch: 'main' });
    assert.equal(back.ok, true, JSON.stringify(back));
    assert.equal(git(repo, ['rev-parse', '--abbrev-ref', 'HEAD']), 'main');
    assert.equal((await run('repo')).data.preview, null);
  });

  it('forgets a preview that ended outside the tool', async () => {
    const { repo, run } = makeRepo();
    await run('add', { branch: 'A-a' });
    await run('switch', { branch: 'A-a' });
    assert.equal((await run('repo')).data.preview, 'A-a');

    // Someone checks a branch out in an editor or a terminal: the stored preview
    // is now a lie, and a stale preview is what made the picker ignore a click.
    git(repo, ['checkout', 'main']);
    const after = await run('repo');
    assert.equal(after.data.preview, null);
    assert.equal(after.data.currentBranch, 'main');
    assert.equal((await run('list')).data.preview, null);
  });

  it('reports honestly when the checkout is already there', async () => {
    const { run } = makeRepo();
    await run('add', { branch: 'A-a' });
    await run('switch', { branch: 'A-a' });
    const again = await run('switch', { branch: 'A-a' });
    assert.equal(again.ok, true);
    assert.equal(again.data.changed, false);
  });

  it('refuses to switch over an uncommitted main checkout', async () => {
    const { repo, run } = makeRepo();
    await run('add', { branch: 'A-a' });
    writeFileSync(join(repo, 'README.md'), '# dirty\n');
    expectCode(await run('switch', { branch: 'A-a' }), 'main-dirty');
  });

  it('merges a worktree branch into the base branch', async () => {
    const { repo, run } = makeRepo();
    await run('add', { branch: 'A-a' });
    commitFile(join(repo, '.worktree', 'A-a'), 'a.txt', 'done\n', 'feat: a');

    const merged = await run('merge', { from: 'A-a' });
    assert.equal(merged.ok, true, JSON.stringify(merged));
    assert.equal(merged.data.into, 'main');
    assert.equal(git(repo, ['rev-parse', 'main:a.txt']), git(repo, ['rev-parse', 'A-a:a.txt']));
    assert.equal(git(repo, ['rev-parse', '--abbrev-ref', 'HEAD']), 'main');
  });

  it('merges into an explicitly chosen branch', async () => {
    const { repo, run } = makeRepo();
    git(repo, ['branch', 'F']);
    await run('add', { branch: 'A-a' });
    commitFile(join(repo, '.worktree', 'A-a'), 'a.txt', 'done\n', 'feat: a');
    const merged = await run('merge', { from: 'A-a', into: 'F' });
    assert.equal(merged.ok, true, JSON.stringify(merged));
    assert.equal(git(repo, ['rev-parse', 'F:a.txt']), git(repo, ['rev-parse', 'A-a:a.txt']));
    assert.equal(git(repo, ['rev-parse', '--abbrev-ref', 'HEAD']), 'F');
  });

  it('refuses to merge into a branch that lives in its own worktree', async () => {
    const { repo, run } = makeRepo();
    await run('add', { branch: 'F' });
    await run('add', { branch: 'A-a' });
    commitFile(join(repo, '.worktree', 'A-a'), 'a.txt', 'done\n', 'feat: a');
    expectCode(await run('merge', { from: 'A-a', into: 'F' }), 'main-busy');
  });

  it('rolls back and reports files when a merge conflicts', async () => {
    const { repo, run } = makeRepo();
    await run('add', { branch: 'A-a' });
    commitFile(join(repo, '.worktree', 'A-a'), 'shared.txt', 'from worktree\n', 'feat: worktree');
    commitFile(repo, 'shared.txt', 'from main\n', 'feat: main');
    assert.equal(git(repo, ['rev-parse', '--abbrev-ref', 'HEAD']), 'main');

    const envelope = await run('merge', { from: 'A-a' });
    expectCode(envelope, 'conflict');
    assert.deepEqual(envelope.error.details.files, ['shared.txt']);
    assert.equal(git(repo, ['status', '--porcelain']), '', 'merge aborted cleanly');
  });

  it('keeps the row when the worktree directory disappears', async () => {
    const { repo, run } = makeRepo();
    await run('add', { branch: 'A-a', session: 'session-1' });
    rmSync(join(repo, '.worktree', 'A-a'), { recursive: true, force: true });

    const listed = await run('list');
    assert.equal(listed.data.worktrees.length, 1);
    assert.equal(listed.data.worktrees[0].exists, false);
    assert.equal(listed.data.worktrees[0].session, 'session-1');

    assert.equal((await run('prune')).ok, true);
    assert.equal((await run('remove', { branch: 'A-a', force: true })).ok, true);
    assert.equal((await run('list')).data.worktrees.length, 0);
  });

  it('reports the base branch as unknown when the checkout is detached', async () => {
    const { repo, run } = makeRepo();
    git(repo, ['checkout', '-q', '--detach', 'HEAD']);
    const envelope = await run('repo');
    assert.equal(envelope.ok, true);
    assert.equal(envelope.data.detached, true);
    assert.equal(envelope.data.currentBranch, null);
  });
});
