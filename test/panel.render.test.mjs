/**
 * Panel render test — v2 panel.
 *
 * Mounts the real `client.js` in a jsdom document with React, a stubbed `fetch`,
 * and fake `workspaces` / `sessions` services, then drives the page through its
 * states: reachable Host, table rows, add/merge/delete dialogs, error envelopes,
 * and a workspace switch.
 *
 * React and jsdom are not dependencies of this plugin — the panel gets React
 * from the Harness module table at runtime. When they cannot be resolved the
 * whole file is skipped, so `node --test` stays dependency-free:
 *
 *   NODE_PATH=<dir with react + react-dom + jsdom> node --test test/
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { afterEach, describe, it } from 'node:test';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);

let React;
let ReactDOM;
let JSDOM;
let available = true;
try {
  React = require('react');
  ReactDOM = require('react-dom/client');
  ({ JSDOM } = require('jsdom'));
} catch {
  available = false;
}

const CLIENT = new URL('../client.js', import.meta.url);

/** Two workspaces, one worktree in the first, one archived session to filter out. */
const WORKSPACES = {
  phase: 'ready',
  items: [
    { workspaceId: 'w1', title: '项目一', path: '/repo-one', sessionIds: ['s1', 's2', 's3'] },
    { workspaceId: 'w2', title: '项目二', path: '/repo-two', sessionIds: ['s4'] },
  ],
  archivedSessionIds: ['s3'],
};

const SESSIONS = {
  phase: 'ready',
  ids: ['s1', 's2', 's3', 's4'],
  byId: {
    s1: { id: 's1', title: '修解析器', running: true, cwd: '/repo-one' },
    s2: { id: 's2', title: '写文档', running: false, cwd: '/repo-one' },
    s3: { id: 's3', title: '已归档的会话', running: false, cwd: '/repo-one' },
    s4: { id: 's4', title: '另一个项目', running: true, cwd: '/repo-two' },
  },
};

const REPO = {
  root: '/repo-one',
  isGit: true,
  base: 'A',
  preview: null,
  currentBranch: 'A',
  detached: false,
  dirty: false,
};

const LIST = {
  ...REPO,
  worktrees: [
    {
      branch: 'A-a',
      path: '/repo-one/worktree/A-a',
      exists: true,
      dirty: false,
      ahead: 2,
      session: 's1',
      note: '解析器重写',
      createdAt: '2026-11-10T02:00:00.000Z',
    },
    {
      branch: 'A-b',
      path: '/repo-one/worktree/A-b',
      exists: true,
      dirty: false,
      ahead: 0,
      session: 's2',
      note: '',
      createdAt: '2026-11-10T03:00:00.000Z',
    },
    {
      branch: 'A-c',
      path: '/repo-one/worktree/A-c',
      exists: true,
      dirty: false,
      ahead: 0,
      session: '',
      note: '',
      createdAt: '2026-11-10T04:00:00.000Z',
    },
  ],
};

/** Default responder: healthy project with two worktrees. */
function healthy(body) {
  if (body.cmd === 'repo') return { ok: true, data: REPO };
  if (body.cmd === 'list') return { ok: true, data: LIST };
  return { ok: true, data: {} };
}

/** Mount the panel and return the window plus helpers. */
async function mount(responder = healthy, services = { workspaces: WORKSPACES, sessions: SESSIONS }, hooks = {}) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://127.0.0.1:51013/' });
  const { window } = dom;
  // Node 24 exposes `navigator` as a getter-only global, so every DOM global is
  // installed through defineProperty.
  for (const [key, value] of [['window', window], ['document', window.document], ['navigator', window.navigator], ['location', window.location]]) {
    Object.defineProperty(globalThis, key, { value: value, configurable: true, writable: true });
  }
  window.__ModuleLoader__ = { load: (entry) => { window.__entry = entry; } };

  const url = `${pathToFileURL(CLIENT.pathname).href}?mount=${Math.random().toString(36).slice(2)}`;
  await import(url);
  const entry = window.__entry;
  assert.equal(entry.id, 'hbs-worktree');

  const factory = entry.factory((specifier) => {
    if (specifier === 'react') return React;
    throw new Error(`unexpected client import: ${specifier}`);
  });

  const store = (snapshot) => ({
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
  });

  const ctx = {
    locale: { bind: () => (key) => key, register: () => {} },
    effect: (run) => {
      run();
    },
    sessions: services.sessions === undefined
      ? undefined
      : Object.assign({ list: store(services.sessions) }, hooks.sessions === undefined ? {} : hooks.sessions),
    workspaces: services.workspaces === undefined ? undefined : { list: store(services.workspaces) },
    slots: {
      inject: (_name, run) => run(),
      register: (_spec, render) => {
        window.__render = render;
        return () => {};
      },
    },
  };
  factory.apply(ctx, undefined);
  assert.equal(typeof window.__render, 'function', 'the panel registered a settings section');
  // The registered renderer is `() => h(Panel, { t, store, actions })`, so calling
  // it exposes the same action surface the UI gets — the only way to drive the
  // session-creation flow without typing into a React-controlled input.
  const element = window.__render();
  const panelActions = element.props.actions;

  const calls = [];
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body);
    const answer = responder(body, calls.length);
    if (answer === undefined) throw new Error('network down');
    return { ok: true, status: 200, json: async () => answer };
  };

  const root = ReactDOM.createRoot(window.document.getElementById('root'));
  root.render(React.createElement(window.__render));

  const settle = async () => {
    for (let turn = 0; turn < 8; turn += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  };
  await settle();

  const text = () => window.document.body.textContent ?? '';
  return { window, text, calls, settle, actions: panelActions };
}

/** The open dialog, if any. */
function dialogOf(window) {
  return window.document.querySelector('[role="dialog"]');
}

/** Click one button by label, optionally scoped to a container. */
function clickButton(window, label, scope = window.document) {
  const button = [...scope.querySelectorAll('button')].find((node) => {
    const text = (node.textContent ?? '').trim().replace(/^\+\s*/, '');
    return text === label;
  });
  assert.ok(button !== undefined, `no button labelled ${label}`);
  button.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
}

describe('panel', { skip: available ? false : 'react/jsdom not resolvable' }, () => {
  afterEach(() => {
    delete globalThis.fetch;
  });

  it('says the Host is unreachable instead of rendering nothing', async () => {
    const { text } = await mount(() => undefined);
    assert.match(text(), /hostMissing/);
  });

  it('renders the selectors and one row per worktree', async () => {
    const { text, calls } = await mount();
    assert.ok(calls.some((call) => call.cmd === 'repo' && call.root === '/repo-one'), 'repo is asked for the selected workspace');
    assert.ok(calls.some((call) => call.cmd === 'list' && call.root === '/repo-one'));
    const body = text();
    assert.match(body, /workspace/);
    assert.match(body, /branch/);
    assert.match(body, /mainLine/);
    assert.match(body, /A-a/);
    assert.match(body, /A-b/);
    assert.match(body, /修解析器/, 'the bound session title is rendered');
    assert.match(body, /解析器重写/, 'the note is rendered');
    assert.match(body, /running/, 'a running session shows its state');
    assert.match(body, /done/, 'an idle session shows its state');
    assert.match(body, /unbound/, 'a worktree without a session says so');
    assert.match(body, /写文档/, 'the idle session title is rendered');
  });

  it('reports a project that is not a git repository', async () => {
    const { text } = await mount((body) => (body.cmd === 'repo'
      ? { ok: true, data: { root: '/plain', isGit: false, base: null, preview: null, currentBranch: null, detached: false, dirty: false } }
      : { ok: true, data: {} }));
    assert.match(text(), /notGit/);
    assert.ok(!text().includes('A-a'), 'no table for a non-git project');
  });

  it('complains when the session or workspace service is missing', async () => {
    const { text } = await mount(healthy, { workspaces: undefined, sessions: undefined });
    assert.match(text(), /servicesMissing/);
  });

  it('shows the empty state and opens the add dialog with branch, session name and note', async () => {
    const { window, text, settle } = await mount((body) => (body.cmd === 'list'
      ? { ok: true, data: { ...REPO, worktrees: [] } }
      : healthy(body)));
    assert.match(text(), /emptyList/);

    clickButton(window, 'add');
    await settle();
    const dialog = dialogOf(window);
    assert.ok(dialog !== null, 'the add dialog opens');
    const dialogText = dialog.textContent ?? '';
    assert.match(dialogText, /addTitle/);
    assert.match(dialogText, /branchName/);
    assert.match(dialogText, /sessionName/);
    assert.match(dialogText, /sessionNameHint/);
    assert.match(dialogText, /note/);

    // The dialog names a session instead of picking one: three text fields, no select.
    assert.equal(dialog.querySelectorAll('input').length, 3);
    assert.equal(dialog.querySelectorAll('select').length, 0);
  });

  it('validates the branch name before it ever reaches the engine', async () => {
    const calls = [];
    const { window, settle } = await mount((body) => {
      calls.push(body);
      if (body.cmd === 'list') return { ok: true, data: { ...REPO, worktrees: [] } };
      return healthy(body);
    });
    clickButton(window, 'add');
    await settle();

    const dialog = dialogOf(window);
    assert.ok(dialog !== null, 'the add dialog opens');
    // Typing into a React-controlled input cannot be simulated here (React 18 and
    // jsdom disagree about the value tracker), so the empty-name path is what we
    // can drive: it must stop before any request is sent.
    clickButton(window, 'create', dialog);
    await settle();
    assert.match(dialog.textContent ?? '', /invalidName/);
    assert.equal(calls.some((call) => call.cmd === 'add'), false, 'no request for an invalid name');
  });

  it('creates a session in the workspace, locks it to the worktree, and sends the first instruction', async () => {
    const prompts = [];
    const created = [];
    const renamed = [];
    const calls = [];
    const sessionId = 'session-new';

    const { actions } = await mount(
      (body) => {
        calls.push(body);
        if (body.cmd === 'add') {
          return { ok: true, data: { worktree: { branch: 'A-a', path: '/repo-one/worktree/A-a' } } };
        }
        if (body.cmd === 'bind') return { ok: true, data: { branch: 'A-a', session: sessionId } };
        return healthy(body);
      },
      undefined,
      {
        sessions: {
          create: async (request) => {
            created.push(request);
            return sessionId;
          },
          rename: async (id, title) => {
            renamed.push([id, title]);
            return { title };
          },
          using: async (id, options, operation) => {
            await operation({ binding: { session: { prompt: async (parts, mode) => { prompts.push({ id, parts, mode }); } } } });
          },
        },
      },
    );

    const result = await actions.startSession({
      workspaceId: 'w1',
      name: '解析器重写',
      branch: 'A-a',
      path: '/repo-one/worktree/A-a',
    });

    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.sessionId, sessionId);
    assert.deepEqual(created, [{ workspaceId: 'w1' }], 'the session belongs to the selected workspace');
    assert.deepEqual(renamed, [[sessionId, '解析器重写']], 'the typed name becomes the title');

    const bind = calls.find((call) => call.cmd === 'bind');
    assert.ok(bind !== undefined, 'the worktree is bound to the new session');
    assert.equal(bind.args.branch, 'A-a');
    assert.equal(bind.args.session, sessionId);

    assert.equal(prompts.length, 1, 'one first instruction is queued');
    assert.equal(prompts[0].mode, 'queue');
    const text = prompts[0].parts.map((part) => part.text).join('');
    assert.match(text, /hbs-worktree skill/);
    assert.match(text, /\/repo-one\/worktree\/A-a/);
    assert.match(text, /git -C/);
  });

  it('reports a session creation failure without hiding the new worktree', async () => {
    const { actions } = await mount(
      (body) => {
        if (body.cmd === 'add') return { ok: true, data: { worktree: { branch: 'A-a', path: '/repo-one/worktree/A-a' } } };
        return healthy(body);
      },
      undefined,
      { sessions: { create: async () => { throw new Error('host said no'); } } },
    );
    const result = await actions.startSession({ workspaceId: 'w1', name: 'x', branch: 'A-a', path: '/repo-one/worktree/A-a' });
    assert.equal(result.ok, false);
    assert.match(result.message, /host said no/);
  });

  it('shows the auto-commit switch and saves it from the actions column', async () => {
    const calls = [];
    const { window, settle } = await mount((body) => {
      calls.push(body);
      if (body.cmd === 'update') return { ok: true, data: { branch: body.args.branch, autoCommit: body.args.autoCommit } };
      return healthy(body);
    });

    const row = window.document.querySelector('tbody tr');
    assert.ok(row !== null, 'a worktree row is rendered');
    const picker = row.querySelector('select');
    assert.ok(picker !== null, 'the actions column carries the auto-commit picker');
    assert.deepEqual([...picker.options].map((option) => option.value), ['on', 'off']);
    assert.deepEqual([...picker.options].map((option) => option.textContent), ['autoCommitOn', 'autoCommitOff']);
    assert.equal(picker.value, 'on', 'auto-commit is on by default');

    picker.value = 'off';
    picker.dispatchEvent(new window.Event('change', { bubbles: true }));
    await settle();
    const sent = calls.find((call) => call.cmd === 'update');
    assert.ok(sent !== undefined, 'update was sent');
    assert.deepEqual(sent.args, { branch: 'A-a', autoCommit: false });
    assert.equal(sent.root, '/repo-one');
  });

  it('opens the merge dialog with the main line as the default target', async () => {
    const { window, settle } = await mount();
    clickButton(window, 'merge');
    await settle();
    const dialog = dialogOf(window);
    assert.ok(dialog !== null, 'the merge dialog opens');
    const body = dialog.textContent ?? '';
    assert.match(body, /mergeTitle/);
    assert.match(body, /A-a/);
    assert.match(body, /mainLine/);
  });

  it('lists conflict files when a merge is refused', async () => {
    const { window, text, settle } = await mount((body) => {
      if (body.cmd === 'merge') {
        return { ok: false, error: { code: 'conflict', message: '合并有冲突', details: { files: ['shared.txt', 'b.txt'] } } };
      }
      return healthy(body);
    });
    clickButton(window, 'merge');
    await settle();
    const dialog = dialogOf(window);
    assert.ok(dialog !== null, 'the merge dialog opens');
    clickButton(window, 'merge', dialog);
    await settle();
    const body = text();
    assert.match(body, /shared\.txt/);
    assert.match(body, /b\.txt/);
  });

  it('asks before deleting and offers a forced retry when the engine refuses', async () => {
    const calls = [];
    const { window, text, settle } = await mount((body) => {
      calls.push(body);
      if (body.cmd === 'remove') {
        return calls.filter((call) => call.cmd === 'remove').length === 1
          ? { ok: false, error: { code: 'unmerged-commits', message: '还有 2 个提交没并回 A', details: { pending: 2 } } }
          : { ok: true, data: { branch: 'A-a', removed: true } };
      }
      return healthy(body);
    });

    clickButton(window, 'remove');
    await settle();
    const dialog = dialogOf(window);
    assert.ok(dialog !== null, 'the delete dialog opens');
    assert.match(dialog.textContent ?? '', /removeTitle/);
    assert.match(dialog.textContent ?? '', /removeWarn/);
    assert.equal(calls.some((call) => call.cmd === 'remove'), false, 'nothing is deleted before confirmation');

    clickButton(window, 'remove', dialog);
    await settle();
    const refused = (dialogOf(window) ?? window.document).textContent ?? '';
    assert.match(refused, /还有 2 个提交没并回 A/);
    assert.match(refused, /forceRemove/);

    clickButton(window, 'forceRemove', dialogOf(window) ?? window.document);
    await settle();
    const removes = calls.filter((call) => call.cmd === 'remove');
    assert.equal(removes.length, 2);
    assert.equal(removes[1].args.force, true);
  });

  it('switches the main checkout when the branch picker changes', async () => {
    const calls = [];
    const { window, settle } = await mount((body) => {
      calls.push(body);
      if (body.cmd === 'switch') return { ok: true, data: { branch: 'A-a', base: 'A', preview: 'A-a', changed: true, detached: true } };
      return healthy(body);
    });
    const selects = [...window.document.querySelectorAll('select')];
    assert.ok(selects.length >= 2, 'workspace and branch pickers exist');
    const branchPicker = selects[1];
    branchPicker.value = 'A-a';
    branchPicker.dispatchEvent(new window.Event('change', { bubbles: true }));
    await settle();
    const sent = calls.find((call) => call.cmd === 'switch');
    assert.ok(sent !== undefined, 'switch was sent');
    assert.equal(sent.args.branch, 'A-a');
  });

  it('keeps the branch picker on the previewing branch and says so', async () => {
    const { window, text, settle } = await mount((body) => {
      if (body.cmd === 'repo') return { ok: true, data: { ...REPO, preview: 'A-a', currentBranch: null, detached: true } };
      if (body.cmd === 'list') return { ok: true, data: { ...LIST, preview: 'A-a', currentBranch: null, detached: true } };
      return healthy(body);
    });
    await settle();
    const selects = [...window.document.querySelectorAll('select')];
    assert.equal(selects[1].value, 'A-a');
    // Detached HEAD is invisible in git status, so the page has to explain it.
    const body = text();
    assert.match(body, /previewing/);
    assert.match(body, /previewHint/);
    assert.match(body, /backToBase/);
  });

  it('re-reads everything when another workspace is picked', async () => {
    const calls = [];
    const { window, settle } = await mount((body) => {
      calls.push(body);
      return healthy(body);
    });
    const selects = [...window.document.querySelectorAll('select')];
    selects[0].value = 'w2';
    selects[0].dispatchEvent(new window.Event('change', { bubbles: true }));
    await settle();
    assert.ok(calls.some((call) => call.root === '/repo-two'), 'the second workspace root is used');
  });
});
