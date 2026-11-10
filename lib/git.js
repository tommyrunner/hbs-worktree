/**
 * Git plumbing for the worktree engine.
 *
 * Every function returns data instead of throwing, so the engine decides which
 * failure becomes which error code. No `@deepseek-ai/*` import lives here: the
 * CLI must run with nothing but node.
 */
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const MAX_BUFFER = 16 * 1024 * 1024;

/**
 * Run one git command in `cwd`.
 * @returns `{ ok, stdout, stderr, code }`; `ok` is false for a non-zero exit.
 */
export async function git(cwd, args) {
  try {
    const result = await execFileAsync('git', args, { cwd, maxBuffer: MAX_BUFFER, env: process.env });
    return { ok: true, code: 0, stdout: String(result.stdout).trimEnd(), stderr: String(result.stderr).trimEnd() };
  } catch (error) {
    return {
      ok: false,
      code: typeof error.code === 'number' ? error.code : -1,
      stdout: String(error.stdout ?? '').trimEnd(),
      stderr: String(error.stderr ?? '').trimEnd(),
    };
  }
}

/** Repository top level for `cwd`, or `undefined` when it is not inside a work tree. */
export async function topLevel(cwd) {
  const result = await git(cwd, ['rev-parse', '--show-toplevel']);
  return result.ok && result.stdout !== '' ? result.stdout : undefined;
}

/** Checked-out branch name; `HEAD` when detached, `undefined` outside a repository. */
export async function currentBranch(cwd) {
  const result = await git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
  return result.ok ? result.stdout : undefined;
}

/** Resolve one ref to a commit sha, or `undefined`. */
export async function resolveRef(cwd, ref) {
  const result = await git(cwd, ['rev-parse', '--verify', '--quiet', ref]);
  return result.ok && result.stdout !== '' ? result.stdout : undefined;
}

/** Whether `refs/heads/<name>` exists locally. */
export async function branchExists(cwd, name) {
  return (await resolveRef(cwd, `refs/heads/${name}`)) !== undefined;
}

/** Whether `refs/remotes/origin/<name>` exists. */
export async function remoteBranchExists(cwd, name) {
  return (await resolveRef(cwd, `refs/remotes/origin/${name}`)) !== undefined;
}

/** Configured remote names. */
export async function remotes(cwd) {
  const result = await git(cwd, ['remote']);
  return result.ok ? result.stdout.split('\n').filter((line) => line !== '') : [];
}

/** Uncommitted, staged, or untracked changes in `cwd`. Ignored files do not count. */
export async function isDirty(cwd) {
  const result = await git(cwd, ['status', '--porcelain']);
  return result.ok && result.stdout !== '';
}

/** Upstream ref of the current branch, or `undefined` without one. */
export async function upstreamOf(cwd, branch) {
  const result = await git(cwd, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', `${branch}@{u}`]);
  return result.ok && result.stdout !== '' ? result.stdout : undefined;
}

/** Number of commits on `to` that are missing from `from`. */
export async function commitsBetween(cwd, from, to) {
  const result = await git(cwd, ['rev-list', '--count', `${from}..${to}`]);
  const count = Number.parseInt(result.ok ? result.stdout : '0', 10);
  return Number.isNaN(count) ? 0 : count;
}

/** Whether `ancestor` is reachable from `descendant`. */
export async function isAncestor(cwd, ancestor, descendant) {
  const result = await git(cwd, ['merge-base', '--is-ancestor', ancestor, descendant]);
  return result.ok;
}

/** Short sha of `ref`, for display. */
export async function shortSha(cwd, ref) {
  const result = await git(cwd, ['rev-parse', '--short', ref]);
  return result.ok ? result.stdout : undefined;
}

/** Files left in a conflicted index. */
export async function conflictedFiles(cwd) {
  const result = await git(cwd, ['diff', '--name-only', '--diff-filter=U']);
  return result.ok ? result.stdout.split('\n').filter((line) => line !== '') : [];
}

/**
 * Parse `git worktree list --porcelain` into rows.
 * @returns one `{ path, head, branch, bare, detached, locked, prunable }` per worktree.
 */
export async function worktrees(cwd) {
  const result = await git(cwd, ['worktree', 'list', '--porcelain']);
  if (!result.ok) return [];
  const rows = [];
  let row;
  for (const line of result.stdout.split('\n')) {
    if (line === '') {
      if (row !== undefined) rows.push(row);
      row = undefined;
      continue;
    }
    if (line.startsWith('worktree ')) {
      if (row !== undefined) rows.push(row);
      row = { path: line.slice('worktree '.length), head: '', branch: undefined, bare: false, detached: false, locked: false, prunable: false };
      continue;
    }
    if (row === undefined) continue;
    if (line.startsWith('HEAD ')) row.head = line.slice('HEAD '.length);
    else if (line.startsWith('branch ')) row.branch = line.slice('branch '.length).replace('refs/heads/', '');
    else if (line === 'bare') row.bare = true;
    else if (line === 'detached') row.detached = true;
    else if (line.startsWith('locked')) row.locked = true;
    else if (line.startsWith('prunable')) row.prunable = true;
  }
  if (row !== undefined) rows.push(row);
  return rows;
}

/**
 * Absolute path of one path inside the git directory, for example `info/exclude`.
 * `--path-format=absolute` needs git 2.31; older git falls back to `<root>/.git`.
 */
export async function gitPath(cwd, name) {
  const result = await git(cwd, ['rev-parse', '--path-format=absolute', '--git-path', name]);
  if (result.ok && result.stdout !== '') return result.stdout;
  return join(cwd, '.git', name);
}
