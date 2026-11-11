/**
 * The worktree engine: one command table, no UI.
 *
 * Model: the selected project directory IS the main business checkout. Its
 * checked-out branch is the base ("主业务"). Every worktree is one extra branch
 * of that same repository, checked out under `<project>/worktree/<branch>`, so
 * an agent writing in one branch never touches the files a human is running.
 *
 *     <project>/.git              base branch checked out here
 *     <project>/worktree/A-a      branch A-a
 *     <project>/worktree/A-b      branch A-b
 *
 * git owns the worktree list; `worktree/.hbs-state.json` only remembers the
 * base branch plus each branch's session binding and note.
 */
import { existsSync } from 'node:fs';
import { mkdir, rename, rmdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import { EngineError, failure, ok } from './errors.js';
import * as git from './git.js';
import {
  DIR_NAME,
  LEGACY_DIR_NAME,
  dropExcludeLine,
  ensureExclude,
  loadState,
  paths,
  saveState,
} from './state.js';

/**
 * A worktree directory name: one flat segment, so `worktree/<name>` stays one
 * level deep. Only used when this tool creates the branch.
 */
const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** Plain-path branch names this tool has to reject before git does. */
const BRANCH_FORBIDDEN = /[\s~^:?*[\\\x00-\x1f\x7f]/;

/** Names that would collide with the metadata file or the git directory. */
const RESERVED = new Set(['.hbs-state.json', 'HEAD', '.git']);

/** The directory the command runs in: an explicit root, or the process cwd. */
async function rootOf(options) {
  return typeof options.root === 'string' && options.root !== '' ? resolve(options.root) : process.cwd();
}

/** Resolve the repository root, refusing anything that is not a git work tree. */
async function requireGitRoot(options) {
  const root = await rootOf(options);
  const top = await git.topLevel(root);
  if (top === undefined) {
    throw new EngineError('not-a-repo', `当前主业务代码不是 git 仓库：${root}`, { root });
  }
  return top;
}

/**
 * Claim the worktree directory: create it and make git ignore it.
 *
 * This runs before anything is written, because the metadata file lives inside
 * that directory — creating it first would leave the project looking dirty.
 */
async function claimDirectory(root) {
  const p = paths(root);
  await mkdir(p.dir, { recursive: true });
  await ensureExclude(await git.gitPath(root, 'info/exclude'));
  return p;
}

/** Remove a directory only when it is empty; anything else is left in place. */
async function removeDirectory(dir) {
  try {
    await rmdir(dir);
  } catch {
    // not empty, or already gone
  }
}

/**
 * Move worktrees created by 0.4.x from `worktree/` to `.worktree/`.
 *
 * git owns the worktree location, so each one is relocated with `git worktree
 * move`; the metadata file moves with them and the old exclude line is dropped
 * once the legacy directory is empty. Best effort: a worktree git refuses to
 * move stays where it is and keeps working, because the row comes from
 * `git worktree list`, not from this tool's bookkeeping.
 * @returns whether anything moved.
 */
async function migrateLayout(root) {
  const p = paths(root);
  if (!existsSync(p.legacyState) || existsSync(p.state)) return false;

  const listed = await git.worktrees(root);
  for (const worktree of listed) {
    if (worktree.branch === undefined) continue;
    if (!worktree.path.startsWith(p.legacyDir + '/')) continue;
    const target = join(p.dir, ...worktree.branch.split('/'));
    if (existsSync(target)) continue;
    await mkdir(dirname(target), { recursive: true });
    // Never block the panel on a relocation: a worktree git refuses to move keeps
    // working where it is, and the row comes from `git worktree list` anyway.
    await git.git(root, ['worktree', 'move', worktree.path, target]);
  }

  await mkdir(p.dir, { recursive: true });
  await rename(p.legacyState, p.state);
  const excludeFile = await git.gitPath(root, 'info/exclude');
  await dropExcludeLine(excludeFile, `${LEGACY_DIR_NAME}/`);
  await ensureExclude(excludeFile);
  // Remove the now-empty legacy directory; a leftover file in it means the user
  // kept something there, and that is theirs to decide.
  await removeDirectory(p.legacyDir);
  return true;
}

/** Open one project: root, file paths, and the loaded metadata. */
async function openRepo(options) {
  const root = await requireGitRoot(options);
  await migrateLayout(root);
  const p = await claimDirectory(root);
  const state = await loadState(root);
  return { root, paths: p, state, save: () => saveState(root, state) };
}

/**
 * Validate a branch name the way git does, for branches that already exist.
 *
 * Switching, merging, deleting and binding only name a ref, so every legal git
 * branch must pass — `feature/tm/v-3.58.0` included. `git check-ref-format` is
 * the authority; the local checks below only produce a better message.
 */
async function branchName(value, label) {
  const name = typeof value === 'string' ? value.trim() : '';
  if (name === '') throw new EngineError('invalid-name', `${label}不能为空。`);
  if (BRANCH_FORBIDDEN.test(name) || name.startsWith('-') || name.startsWith('/') || name.endsWith('/') || name.includes('//') || name.includes('..')) {
    throw new EngineError('invalid-name', `${label}不符合 git 分支命名规范：${name}`, { value: name });
  }
  const check = await git.git(process.cwd(), ['check-ref-format', `refs/heads/${name}`]);
  if (!check.ok) {
    throw new EngineError('invalid-name', `${label}不符合 git 分支命名规范：${name}`, { value: name });
  }
  return name;
}

/** Validate a name this tool is about to use as both a branch and a directory. */
function normalizeName(value, label) {
  const name = typeof value === 'string' ? value.trim() : '';
  if (name === '') throw new EngineError('invalid-name', `${label}不能为空。`);
  if (!NAME_PATTERN.test(name)) {
    throw new EngineError('invalid-name', `${label}只能用字母、数字、点、下划线、连字符，且不能以连字符开头。`, { value: name });
  }
  if (name === '.' || name === '..' || RESERVED.has(name)) {
    throw new EngineError('invalid-name', `${name} 是保留名字，换一个。`, { value: name });
  }
  return name;
}

/**
 * Adopt the checked-out branch as the base branch.
 *
 * A worktree branch is never the base: previewing one must not move the
 * "主业务" label away from the branch the project actually develops on.
 */
async function resolveBase(root, state, currentBranch) {
  const detached = currentBranch === 'HEAD' || currentBranch === undefined;
  const isWorktree = !detached && state.entries[currentBranch] !== undefined;
  let base = state.base;
  if (!detached && !isWorktree) base = currentBranch;
  if (base !== state.base) {
    state.base = base;
    await saveState(root, state);
  }
  return base ?? null;
}

/**
 * Drop a stored preview that no longer describes the main checkout.
 *
 * The branch picker is a view of git, but `state.preview` is a memory: switching
 * branches in an editor or a terminal leaves it behind, and then the panel both
 * claims a preview that is gone and refuses to act ("already on that branch").
 * Whenever the main checkout is on a real branch again, the preview is over.
 */
async function reconcilePreview(root, state, currentBranch) {
  if (typeof state.preview !== 'string' || state.preview === '') return false;
  const detached = currentBranch === 'HEAD' || currentBranch === undefined;
  let stale = !detached;
  if (!stale && !(await git.branchExists(root, state.preview))) stale = true;
  // Still detached: the checkout moved with a commit made inside the worktree, so
  // keep reporting the branch it belongs to.
  if (!stale) return false;
  state.preview = null;
  await saveState(root, state);
  return true;
}

/** One worktree row: git facts plus the stored metadata. */
async function rowOf(root, base, branch, path, exists, entry) {
  return {
    branch,
    path,
    exists,
    dirty: exists ? await git.isDirty(path) : false,
    ahead: base === null ? 0 : await git.commitsBetween(root, base, branch),
    session: typeof entry?.session === 'string' ? entry.session : '',
    note: typeof entry?.note === 'string' ? entry.note : '',
    // Auto-commit is the default the skill relies on: finish a requirement, commit
    // it, push it. Opting out is per worktree so one branch can stay hands-on.
    autoCommit: entry?.autoCommit !== false,
    createdAt: typeof entry?.createdAt === 'string' ? entry.createdAt : '',
  };
}

/** Every worktree row, newest first: git's list merged with the metadata file. */
async function worktreeRows(repo, base) {
  const rows = [];
  const listed = await git.worktrees(repo.root);
  const seen = new Set();
  for (const worktree of listed) {
    if (worktree.path === repo.root || worktree.bare) continue;
    if (worktree.branch === undefined) continue;
    const entry = repo.state.entries[worktree.branch];
    // git keeps a prunable row for a directory deleted by hand; report the truth.
    rows.push(await rowOf(repo.root, base, worktree.branch, worktree.path, existsSync(worktree.path), entry));
    seen.add(worktree.branch);
  }
  // Metadata without a directory: the worktree was deleted by hand, or a switch
  // reclaimed it. Keep the row so the binding and note are not silently lost.
  for (const [branch, entry] of Object.entries(repo.state.entries)) {
    if (seen.has(branch)) continue;
    rows.push(await rowOf(repo.root, base, branch, join(repo.paths.dir, branch), false, entry));
  }
  return rows.sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt)));
}

/** Bind one session to one branch, dropping any other binding it had. */
function setBinding(state, branch, session) {
  for (const [key, entry] of Object.entries(state.entries)) {
    if (key !== branch && entry.session === session) entry.session = '';
  }
  const entry = state.entries[branch];
  if (entry !== undefined) entry.session = session;
}

/** `repo` — the facts the panel's header needs, including "not a git repo yet". */
async function repoInfo(_args, options) {
  const root = await rootOf(options);
  const top = await git.topLevel(root);
  if (top === undefined) {
    return { root, isGit: false, base: null, currentBranch: null, detached: false, dirty: false };
  }
  const currentBranch = await git.currentBranch(top);
  const detached = currentBranch === 'HEAD' || currentBranch === undefined;
  await migrateLayout(top);
  await claimDirectory(top);
  const state = await loadState(top);
  const base = await resolveBase(top, state, currentBranch);
  await reconcilePreview(top, state, currentBranch);
  return {
    root: top,
    isGit: true,
    base,
    preview: state.preview ?? null,
    currentBranch: detached ? null : currentBranch,
    // The commit the main checkout actually sits on: a previewed worktree branch is
    // detached, so its name alone does not say which commit you are looking at.
    head: await git.shortSha(top, 'HEAD'),
    detached,
    dirty: await git.isDirty(top),
  };
}

/** `list` — the header facts plus every worktree of this project. */
async function list(_args, options) {
  const repo = await openRepo(options);
  const currentBranch = await git.currentBranch(repo.root);
  const detached = currentBranch === 'HEAD' || currentBranch === undefined;
  const base = await resolveBase(repo.root, repo.state, currentBranch);
  await reconcilePreview(repo.root, repo.state, currentBranch);
  return {
    root: repo.root,
    isGit: true,
    base,
    preview: repo.state.preview ?? null,
    currentBranch: detached ? null : currentBranch,
    detached,
    dirty: await git.isDirty(repo.root),
    worktrees: await worktreeRows(repo, base),
  };
}

/** `add` — create one branch plus its worktree from the base branch. */
async function add(args, options) {
  const repo = await openRepo(options);
  const branch = await branchName(args.branch, '分支名');
  const currentBranch = await git.currentBranch(repo.root);
  const base = await resolveBase(repo.root, repo.state, currentBranch);
  if (base === null) {
    throw new EngineError('unknown-base', '找不到主业务分支：请先在主仓库切到一个分支。', { root: repo.root });
  }
  if (branch === base) {
    throw new EngineError('branch-exists', `${branch} 是主业务分支，不能作为工作树。`, { branch });
  }
  const known = new Set(Object.keys(repo.state.entries));
  for (const worktree of await git.worktrees(repo.root)) {
    if (worktree.branch !== undefined) known.add(worktree.branch);
  }
  known.delete(branch);
  // The metadata file lives inside the worktree directory, so a branch named
  // after it would make `git worktree add` fail on an existing directory.
  if (branch.split('/').some((segment) => segment === '.hbs-state.json')) {
    throw new EngineError('invalid-name', `.hbs-state.json 是保留名字，换一个。`, { value: branch });
  }
  if (known.has(branch)) {
    throw new EngineError('branch-exists', `分支 ${branch} 已经有工作树了。`, { branch });
  }
  const folded = [...known].map((name) => name.toLowerCase());
  if (folded.includes(branch.toLowerCase())) {
    throw new EngineError('case-collision', `分支 ${branch} 与已有的工作树只差大小写，磁盘上会撞同一个目录。`, { branch });
  }
  // `feat` and `feat/x` would nest one worktree inside another, which confuses
  // git and every later switch; one or the other, not both.
  const nested = [...known].find((other) => other.startsWith(`${branch}/`) || branch.startsWith(`${other}/`));
  if (nested !== undefined) {
    throw new EngineError('branch-exists', `分支 ${branch} 与已有的工作树 ${nested} 有目录层级冲突。`, { branch, other: nested });
  }
  if (await git.branchExists(repo.root, branch)) {
    throw new EngineError('branch-exists', `分支 ${branch} 已存在。`, { branch });
  }

  const path = join(repo.paths.dir, ...branch.split('/'));
  if (existsSync(path)) throw new EngineError('worktree-missing', `目录 ${path} 已存在。`, { path });
  await mkdir(dirname(path), { recursive: true });
  const created = await git.git(repo.root, ['worktree', 'add', path, '-b', branch, base]);
  if (!created.ok) throw new EngineError('internal', `创建工作树失败：${created.stderr}`, { branch });

  const session = typeof args.session === 'string' ? args.session : '';
  const note = typeof args.note === 'string' ? args.note.trim() : '';
  const autoCommit = args.autoCommit !== false;
  repo.state.entries[branch] = { session: '', note, autoCommit, createdAt: new Date().toISOString() };
  if (session !== '') setBinding(repo.state, branch, session);
  await repo.save();
  return { worktree: await rowOf(repo.root, base, branch, path, true, repo.state.entries[branch]) };
}

/** `remove` — delete one worktree directory and its branch. */
async function remove(args, options) {
  const repo = await openRepo(options);
  const branch = await branchName(args.branch, '分支名');
  const currentBranch = await git.currentBranch(repo.root);
  const base = await resolveBase(repo.root, repo.state, currentBranch);
  if (branch === base) {
    throw new EngineError('main-busy', `${branch} 是主业务分支，不能删除。`, { branch });
  }
  const force = args.force === true;
  const listed = (await git.worktrees(repo.root)).find((worktree) => worktree.branch === branch);
  const path = listed === undefined ? join(repo.paths.dir, ...branch.split('/')) : listed.path;
  const exists = listed !== undefined && existsSync(listed.path);
  if (!exists && !(await git.branchExists(repo.root, branch))) {
    throw new EngineError('unknown-worktree', `没有 ${branch} 这个工作树。`, { branch });
  }
  if (currentBranch === branch || repo.state.preview === branch) {
    throw new EngineError('main-busy', `主业务目录当前正显示 ${branch}，先切回 ${base ?? '主业务分支'}。`, { branch });
  }
  if (exists) {
    if (!force && (await git.isDirty(path))) {
      throw new EngineError('worktree-dirty', `${branch} 还有未提交改动，确认丢弃请勾选强制删除。`, { path });
    }
    if (!force && base !== null) {
      const pending = await git.commitsBetween(repo.root, base, branch);
      if (pending > 0) {
        throw new EngineError('unmerged-commits', `${branch} 还有 ${pending} 个提交没并回 ${base}，确认丢弃请勾选强制删除。`, { branch, pending });
      }
    }
    const removed = await git.git(repo.root, ['worktree', 'remove', ...(force ? ['--force'] : []), path]);
    if (!removed.ok) throw new EngineError('worktree-dirty', `无法移除工作树：${removed.stderr}`, { path });
  } else {
    await git.git(repo.root, ['worktree', 'prune']);
  }
  if (await git.branchExists(repo.root, branch)) {
    await git.git(repo.root, ['branch', force ? '-D' : '-d', branch]);
  }
  delete repo.state.entries[branch];
  await repo.save();
  return { branch, removed: true };
}

/** `switch` — check the main project out on one branch (main code follows). */
async function switchTo(args, options) {
  const repo = await openRepo(options);
  const branch = await branchName(args.branch, '分支名');
  if (!(await git.branchExists(repo.root, branch))) {
    throw new EngineError('unknown-branch', `分支 ${branch} 不存在。`, { branch });
  }
  const currentBranch = await git.currentBranch(repo.root);
  const base = await resolveBase(repo.root, repo.state, currentBranch);
  await reconcilePreview(repo.root, repo.state, currentBranch);
  if (currentBranch === branch) {
    return { branch, base, preview: repo.state.preview ?? null, currentBranch, changed: false };
  }
  // Already previewing that branch: only a commit made inside the worktree is a
  // reason to move the detached HEAD, otherwise re-checking it out is a no-op.
  if (repo.state.preview === branch && (currentBranch === 'HEAD' || currentBranch === undefined)) {
    const head = await git.resolveRef(repo.root, 'HEAD');
    const tip = await git.resolveRef(repo.root, `refs/heads/${branch}`);
    if (head !== undefined && head === tip) {
      return { branch, base, preview: branch, currentBranch, changed: false, detached: true };
    }
  }
  // A worktree branch previewed with uncommitted edits would show the branch tip,
  // not the work in progress — say so instead of silently hiding it.
  const entry = repo.state.entries[branch];
  const listed = (await git.worktrees(repo.root)).find((worktree) => worktree.branch === branch);
  const worktreePath = entry === undefined
    ? undefined
    : (listed === undefined ? join(repo.paths.dir, ...branch.split('/')) : listed.path);
  if (worktreePath !== undefined && existsSync(worktreePath) && (await git.isDirty(worktreePath))) {
    throw new EngineError(
      'worktree-dirty',
      `工作树 ${branch} 还有未提交的改动：切过去也看不到这些内容。先让它提交（或手动提交）再切换。`,
      { path: worktreePath, branch },
    );
  }
  if (await git.isDirty(repo.root)) {
    throw new EngineError('main-dirty', '主业务代码有未提交改动，先提交或 stash 再切换。', { root: repo.root });
  }
  const isWorktree = repo.state.entries[branch] !== undefined;
  // Asked for explicitly: when the main checkout sits on some other branch, go
  // back to the main line first so the preview starts from a known place.
  if (isWorktree && base !== null && currentBranch !== base && currentBranch !== 'HEAD' && currentBranch !== undefined) {
    const back = await git.git(repo.root, ['checkout', base]);
    if (!back.ok) throw new EngineError('internal', `先切回 ${base} 失败：${back.stderr}`, { into: base });
  }
  // A worktree branch is already checked out in its own directory, and git
  // refuses a second checkout of the same branch — so previewing it means a
  // detached HEAD. The worktree itself stays untouched, and the base does not
  // move: this is a look, not a change of business branch.
  const checkout = await git.git(repo.root, isWorktree ? ['checkout', '--detach', branch] : ['checkout', branch]);
  if (!checkout.ok) throw new EngineError('internal', `切换失败：${checkout.stderr}`, { branch });
  repo.state.preview = isWorktree ? branch : null;
  if (!isWorktree) repo.state.base = branch;
  await repo.save();
  return { branch, base: repo.state.base ?? base, preview: repo.state.preview, currentBranch: await git.currentBranch(repo.root), changed: true, detached: isWorktree };
}

/** `merge` — merge one branch into another, rolling back on conflict. */
async function merge(args, options) {
  const repo = await openRepo(options);
  const from = await branchName(args.from, '源分支');
  const currentBranch = await git.currentBranch(repo.root);
  const base = await resolveBase(repo.root, repo.state, currentBranch);
  const into = typeof args.into === 'string' && args.into !== '' ? await branchName(args.into, '目标分支') : base;
  if (into === null) throw new EngineError('unknown-base', '没有目标分支：请指定 into。');
  if (from === into) throw new EngineError('invalid-merge', `不能把 ${from} 合到它自己。`, { from, into });
  for (const branch of [from, into]) {
    if (!(await git.branchExists(repo.root, branch))) {
      throw new EngineError('unknown-branch', `分支 ${branch} 不存在。`, { branch });
    }
  }
  if (await git.isDirty(repo.root)) {
    throw new EngineError('main-dirty', '主业务代码有未提交改动，先提交或 stash 再合并。', { root: repo.root });
  }
  if (repo.state.entries[into] !== undefined) {
    throw new EngineError('main-busy', `${into} 正在自己的工作树里，不能被检出为合并目标；请换成主业务分支或普通分支。`, { into });
  }
  if (currentBranch !== into) {
    const checkout = await git.git(repo.root, ['checkout', into]);
    if (!checkout.ok) throw new EngineError('internal', `切到 ${into} 失败：${checkout.stderr}`, { into });
  }
  const result = await git.git(repo.root, ['merge', '--no-ff', '--no-edit', from]);
  if (!result.ok) {
    const files = await git.conflictedFiles(repo.root);
    await git.git(repo.root, ['merge', '--abort']);
    throw new EngineError('conflict', `合并 ${from} 到 ${into} 有冲突，已回滚。请手动解决后再合并。`, {
      files,
      from,
      into,
      worktree: repo.root,
    });
  }
  return { from, into, merged: true };
}

/** `update` — change one worktree's settings (currently the auto-commit switch). */
async function update(args, options) {
  const repo = await openRepo(options);
  const branch = await branchName(args.branch, '分支名');
  const entry = repo.state.entries[branch];
  if (entry === undefined) throw new EngineError('unknown-worktree', `没有 ${branch} 这个工作树。`, { branch });
  if (typeof args.autoCommit === 'boolean') entry.autoCommit = args.autoCommit;
  await repo.save();
  return { branch, autoCommit: entry.autoCommit !== false };
}

/** `bind` — pin one session to one worktree branch. */
async function bind(args, options) {
  const repo = await openRepo(options);
  const branch = await branchName(args.branch, '分支名');
  const session = typeof args.session === 'string' && args.session !== '' ? args.session : process.env.DSH_SESSION_ID;
  if (session === undefined || session === '') {
    throw new EngineError('no-sessions', '没有会话上下文：请在会话里运行，或显式传 --session。');
  }
  if (repo.state.entries[branch] === undefined) {
    throw new EngineError('unknown-worktree', `没有 ${branch} 这个工作树。`, { branch });
  }
  const occupied = Object.entries(repo.state.entries).find(([key, entry]) => key !== branch && entry.session === session);
  setBinding(repo.state, branch, session);
  await repo.save();
  return { branch, session, movedFrom: occupied === undefined ? null : occupied[0] };
}

/** `unbind` — drop the session binding of one branch. */
async function unbind(args, options) {
  const repo = await openRepo(options);
  const branch = await branchName(args.branch, '分支名');
  const entry = repo.state.entries[branch];
  if (entry === undefined) throw new EngineError('unknown-worktree', `没有 ${branch} 这个工作树。`, { branch });
  entry.session = '';
  await repo.save();
  return { branch, session: '' };
}

/** `env` — the worktree one session is bound to, or `null`. */
async function env(args, options) {
  const repo = await openRepo(options);
  const session = typeof args.session === 'string' && args.session !== '' ? args.session : process.env.DSH_SESSION_ID;
  for (const [branch, entry] of Object.entries(repo.state.entries)) {
    if (entry.session !== session || session === undefined || session === '') continue;
    const path = join(repo.paths.dir, branch);
    return {
      root: path,
      repo: repo.root,
      branch,
      base: repo.state.base,
      session,
      note: typeof entry.note === 'string' ? entry.note : '',
      autoCommit: entry.autoCommit !== false,
    };
  }
  return null;
}

/** `prune` — drop git metadata for worktrees whose directory is gone. */
async function prune(_args, options) {
  const repo = await openRepo(options);
  const result = await git.git(repo.root, ['worktree', 'prune', '-v']);
  if (!result.ok) throw new EngineError('internal', `清理失败：${result.stderr}`);
  return { pruned: true, output: result.stdout };
}

/** The command table; `runCommand` is the only public entry. */
const COMMANDS = {
  repo: repoInfo,
  list,
  add,
  update,
  remove,
  switch: switchTo,
  merge,
  bind,
  unbind,
  env,
  prune,
};

/** Every command name, for the host route's allow-list. */
export const COMMAND_NAMES = Object.keys(COMMANDS);

/**
 * Run one command and return the shared envelope. Never throws.
 * @param cmd - one of `COMMAND_NAMES`.
 * @param args - command arguments; the request body's `root` selects the project.
 */
export async function runCommand(cmd, args = {}, options = {}) {
  const handler = COMMANDS[cmd];
  if (handler === undefined) {
    return failure(new EngineError('unknown-command', `未知命令：${String(cmd)}`, { cmd }));
  }
  try {
    // `env` answers `null` for "not bound", which the panel must be able to see.
    const data = await handler(args ?? {}, options);
    return ok(data === undefined ? {} : data);
  } catch (error) {
    return failure(error);
  }
}
