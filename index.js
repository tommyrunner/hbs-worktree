/**
 * Host half of the worktree panel.
 *
 * Two jobs only:
 *
 *   1. Contribute the `hbs-worktree` skill, so any session can bind itself to a
 *      workspace instead of the panel having to know which session is which.
 *   2. Expose the engine over one HTTP route, so the browser panel can list,
 *      create, merge, and switch without importing a single Harness package.
 *
 * The engine (`lib/engine.js`) is plain node: the CLI runs it with nothing but
 * git, and this file only carries bytes between the two callers.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { COMMAND_NAMES, runCommand } from './lib/engine.js';

/** Package name, also the Loader row id and the client module id. */
export const name = 'hbs-worktree';

/** The skill catalog and (when present) the web server are the only services used. */
export const inject = ['skills'];

/** Route the panel posts commands to. */
const API_PATH = '/hbs-worktree/api';

/** Largest request body accepted, in bytes. */
const MAX_BODY = 1024 * 1024;

/** Skill provider identity and its body. */
const PROVIDER_NAME = 'hbs-worktree';
const SKILL_BODY_URL = new URL('./assets/hbs-worktree.md', import.meta.url);
const RESOURCE_BASE = {
  kind: 'directory',
  path: fileURLToPath(new URL('./assets/', import.meta.url)),
};

/** Bundled precedence: the same layer as the Harness's own packaged skills. */
const BUNDLED_RANK = 600;

const DESCRIPTION = [
  'Bind a coding session to one git worktree of the current project so parallel requirements never touch the same files.',
  'Use when the user says 绑定/我在 X 上做/hbs-worktree, asks which worktree this session is bound to,',
  'or needs the worktree layout (worktree/<branch>) explained before editing code.',
].join(' ');

const CANDIDATE = {
  name: PROVIDER_NAME,
  description: DESCRIPTION,
  invocation: { modelInvocable: true, userInvocable: true },
  provider: PROVIDER_NAME,
  source: 'bundled',
  resourceBase: RESOURCE_BASE,
  rank: BUNDLED_RANK,
  locator: SKILL_BODY_URL,
};

const provider = {
  name: PROVIDER_NAME,
  list: () => Promise.resolve([CANDIDATE]),
  async get() {
    return {
      name: CANDIDATE.name,
      description: CANDIDATE.description,
      invocation: CANDIDATE.invocation,
      provider: CANDIDATE.provider,
      source: CANDIDATE.source,
      resourceBase: CANDIDATE.resourceBase,
      content: await readFile(SKILL_BODY_URL, 'utf8'),
    };
  },
};

/** Whether the request came from this machine. */
function isLoopback(req) {
  const address = req.socket?.remoteAddress ?? '';
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

/** Reject cross-origin writes: the browser always sends Origin for a POST. */
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (origin === undefined) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

/** Write one JSON response. */
function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(body);
}

/** Read the request body, refusing anything over `MAX_BODY`. */
async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new Error('请求体过大');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** Answer one panel command. */
async function handle(req, res) {
  if (!isLoopback(req)) {
    sendJson(res, 403, { ok: false, error: { code: 'forbidden', message: '只接受本机请求', details: {} } });
    return;
  }
  if (!sameOrigin(req)) {
    sendJson(res, 403, { ok: false, error: { code: 'forbidden', message: '来源与页面不一致', details: {} } });
    return;
  }
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('allow', 'POST');
    res.end();
    return;
  }

  let payload;
  try {
    payload = JSON.parse(await readBody(req));
  } catch (error) {
    sendJson(res, 400, { ok: false, error: { code: 'bad-request', message: error instanceof Error ? error.message : '请求体不是 JSON', details: {} } });
    return;
  }

  const cmd = typeof payload?.cmd === 'string' ? payload.cmd : '';
  const args = typeof payload?.args === 'object' && payload.args !== null ? payload.args : {};
  const root = typeof payload?.root === 'string' && payload.root !== '' ? payload.root : args.root;

  if (!COMMAND_NAMES.includes(cmd)) {
    sendJson(res, 200, { ok: false, error: { code: 'unknown-command', message: `未知命令：${cmd}`, details: { cmd } } });
    return;
  }

  // The route stays within this machine, but a command still runs git: the root
  // the panel showed is the only one it may act on, so `args.root` is ignored.
  sendJson(res, 200, await runCommand(cmd, args, { root }));
}

/** Register the skill and, when the web server exists, the panel route. */
export function apply(ctx) {
  ctx.skills.registerProvider(() => provider);

  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(() => webCtx.webServer.register({
      kind: 'exact',
      path: API_PATH,
      handler: handle,
    }), `hbs-worktree: POST ${API_PATH}`);
  });
}
