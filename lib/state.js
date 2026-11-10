/**
 * Disk layout and JSON persistence for one project.
 *
 * Everything this tool owns lives under `<project>/worktree`: the worktrees
 * themselves and one small metadata file. The worktree list is never stored —
 * git owns it — so a directory deleted by hand or created outside the panel
 * still reads correctly.
 */
import { readFile, rename, writeFile, mkdir, appendFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/** Directory name inside the project that holds every worktree. */
export const DIR_NAME = '.worktree';

/** Directory name used before 0.5.0; migrated on first use. */
export const LEGACY_DIR_NAME = 'worktree';

/** Metadata file inside that directory. */
export const STATE_NAME = '.hbs-state.json';

/** Absolute paths this tool owns for one project. */
export function paths(root) {
  const dir = join(root, DIR_NAME);
  return {
    root,
    dir,
    relDir: DIR_NAME,
    state: join(dir, STATE_NAME),
    legacyDir: join(root, LEGACY_DIR_NAME),
    legacyState: join(root, LEGACY_DIR_NAME, STATE_NAME),
  };
}

/** Read one JSON file; a missing file yields `fallback`, a malformed one throws. */
export async function readJson(file, fallback = undefined) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

/**
 * Write JSON through a temporary file and a rename, so a crashed write never
 * leaves a half-parsed state file behind.
 */
export async function writeJson(file, value) {
  await mkdir(dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temp, file);
}

/** Empty metadata: no base branch chosen yet, no bindings, no preview. */
export function emptyState() {
  return { version: 2, base: null, preview: null, entries: {} };
}

/** Load the metadata, falling back to an empty one for a fresh project. */
export async function loadState(root) {
  const data = await readJson(paths(root).state, undefined);
  if (data === undefined || typeof data !== 'object' || data === null) return emptyState();
  return {
    version: 2,
    base: typeof data.base === 'string' && data.base !== '' ? data.base : null,
    preview: typeof data.preview === 'string' && data.preview !== '' ? data.preview : null,
    entries: typeof data.entries === 'object' && data.entries !== null ? data.entries : {},
  };
}

/** Persist the metadata. */
export async function saveState(root, state) {
  await writeJson(paths(root).state, state);
}

/**
 * Drop one exact line from the local exclude file, if present.
 * Used when the worktree directory itself is renamed.
 * @param file - absolute path of the repository's `info/exclude`.
 * @param line - exact trimmed line to remove.
 */
export async function dropExcludeLine(file, line) {
  let text = '';
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return false;
  }
  const kept = text.split('\n').filter((row) => row.trim() !== line);
  if (kept.length === text.split('\n').length) return false;
  await writeFile(file, kept.join('\n'), 'utf8');
  return true;
}

/**
 * Make git ignore the worktree directory through `.git/info/exclude`.
 *
 * The worktrees live inside the project, so without an ignore rule `git status`
 * lists every one of them as untracked. The local exclude file is the right
 * home: it needs no commit, leaves `.gitignore` — a tracked file the project
 * owns — untouched, and never makes the main worktree dirty, which every switch
 * and merge depends on.
 * @param file - absolute path of the repository's `info/exclude`.
 * @returns whether a rule was appended.
 */
export async function ensureExclude(file) {
  let text = '';
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const lines = text.split('\n').map((line) => line.trim());
  if (lines.includes(`${DIR_NAME}/`) || lines.includes(DIR_NAME)) return false;
  const prefix = text === '' || text.endsWith('\n') ? '' : '\n';
  await mkdir(dirname(file), { recursive: true });
  await appendFile(file, `${prefix}\n# hbs-worktree workspaces\n${DIR_NAME}/\n`, 'utf8');
  return true;
}
