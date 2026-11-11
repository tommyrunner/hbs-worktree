#!/usr/bin/env node
/**
 * Render the panel outside the Harness and take screenshots with Chrome.
 *
 * The panel gets React from the Harness module table at runtime, so this script
 * borrows react / react-dom / jsdom from `NODE_PATH`, mounts the real `client.js`
 * against fixture data, serialises the DOM (inline styles survive the round trip)
 * and lets headless Chrome lay it out:
 *
 *   NODE_PATH=<react + react-dom + jsdom> node scripts/screenshot.mjs
 *
 * Outputs `<tmp>/hbs-worktree-panel.html` plus `-wide.png` / `-narrow.png` when a
 * Chrome binary is found. Layout problems that the DOM assertions cannot see —
 * overflowing text, collapsed columns — show up here.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);

let React;
let ReactDOM;
let JSDOM;
try {
  React = require('react');
  ReactDOM = require('react-dom/client');
  ({ JSDOM } = require('jsdom'));
} catch {
  console.error('需要 react / react-dom / jsdom：把它们放进 NODE_PATH 再运行。');
  process.exit(1);
}

const CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
];

const WORKSPACES = {
  phase: 'ready',
  items: [{ workspaceId: 'w1', title: 'hbs-worktree-pro', path: '/repo', sessionIds: ['s1', 's2'] }],
  archivedSessionIds: [],
};

const SESSIONS = {
  phase: 'ready',
  ids: ['s1', 's2'],
  byId: {
    s1: { id: 's1', title: '按 hbs-worktree 在 dev-tm-test 工作树执行任务：把新增弹窗里的会话下拉改成会话名称输入框并自动创建会话', running: true },
    s2: { id: 's2', title: '修复解析器回归', running: false },
  },
};

/** `--preview` renders the detached-preview state instead of the normal one. */
const PREVIEW = process.argv.includes('--preview');
/** `--header` renders the conversation-header switch with its popover open. */
const HEADER = process.argv.includes('--header');
/** The page is the only page-shaped surface now; the flag stays harmless for old commands. */
const PAGE = !HEADER;

const REPO = PREVIEW
  ? { root: '/repo', isGit: true, base: 'feature/tm/v-3.58.0', preview: 'dev-tm-test', currentBranch: null, detached: true, dirty: false, head: '49ab12c' }
  : { root: '/repo', isGit: true, base: 'A', preview: null, currentBranch: 'A', detached: false, dirty: false, head: '49ab12c' };

const LIST_NORMAL = [
  { branch: 'dev-tm-test', path: '/repo/.worktree/dev-tm-test', exists: true, dirty: false, ahead: 2, session: 's1', note: '把工作树的会话创建流程改成自动新建，同时保留手动 bind 的 CLI 入口', createdAt: '2026-11-10T02:00:00.000Z' },
  { branch: 'A-b', path: '/repo/.worktree/A-b', exists: true, dirty: true, ahead: 0, session: 's2', note: '', createdAt: '2026-11-10T03:00:00.000Z' },
  { branch: 'A-c', path: '/repo/.worktree/A-c', exists: true, dirty: false, ahead: 0, session: '', note: '', createdAt: '2026-11-10T04:00:00.000Z' },
];

const LIST_PREVIEW = [
  { branch: 'dev-tm-test', path: '/repo/.worktree/dev-tm-test', exists: true, dirty: false, ahead: 1, session: 's1', note: '新增 test-hbs 页面', createdAt: '2026-11-10T02:00:00.000Z' },
];

const LIST = { ...REPO, worktrees: PREVIEW ? LIST_PREVIEW : LIST_NORMAL };

/**
 * Mount the real client module against fixtures and return the serialised DOM.
 *
 * The panel's preview poller is a live `setInterval`, so the window is closed right
 * after serialising; otherwise the timer keeps Node alive and the script never exits.
 */
async function render() {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://127.0.0.1:51013/' });
  const { window } = dom;
  for (const [key, value] of [['window', window], ['document', window.document], ['navigator', window.navigator], ['location', window.location]]) {
    Object.defineProperty(globalThis, key, { value: value, configurable: true, writable: true });
  }
  window.__ModuleLoader__ = { load: (entry) => { window.__entry = entry; } };

  await import(`${pathToFileURL(new URL('../client.js', import.meta.url).pathname).href}?shot=${Math.random().toString(36).slice(2)}`);
  const factory = window.__entry.factory((specifier) => {
    if (specifier === 'react') return React;
    throw new Error(`unexpected client import: ${specifier}`);
  });

  const store = (snapshot) => ({ getSnapshot: () => snapshot, subscribe: () => () => {} });
  let pageRenderer;
  let headerRegistration;
  // The page registers its own dictionaries; bind to the real English one so the
  // screenshot shows labels instead of dictionary keys.
  let dictionaries = { en: {} };
  const boundT = (key) => (dictionaries.en && dictionaries.en[key] !== undefined ? dictionaries.en[key] : key);
  factory.apply({
    locale: {
      bind: () => boundT,
      register: (_namespace, dicts) => {
        dictionaries = dicts;
      },
    },
    effect: (run) => { run(); },
    sessions: { list: store(SESSIONS) },
    workspaces: { list: store(WORKSPACES) },
    slots: {
      inject: (_name, run) => run(),
      register: (spec, page) => {
        if (spec.name === 'main') pageRenderer = page;
        if (spec.name === 'conversation.session.header.utilities') headerRegistration = { spec, render: page };
        return () => {};
      },
    },
  }, undefined);

  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    const answers = { repo: { ok: true, data: REPO }, list: { ok: true, data: LIST } };
    return { ok: true, status: 200, json: async () => answers[body.cmd] ?? { ok: true, data: {} } };
  };

  const root = ReactDOM.createRoot(window.document.getElementById('root'));
  if (HEADER) {
    const injected = typeof headerRegistration.spec.inject === 'function' ? headerRegistration.spec.inject('session-shot') : {};
    root.render(React.createElement(headerRegistration.render, Object.assign({ t: boundT }, injected)));
    // Open the popover: the point of the screenshot is the two pickers.
    await new Promise((resolve) => setTimeout(resolve, 20));
    const trigger = window.document.querySelector('[aria-haspopup="dialog"]');
    if (trigger !== null) trigger.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  } else {
    root.render(React.createElement(pageRenderer));
  }
  for (let turn = 0; turn < 10; turn += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  // React writes a control's current value as a DOM *property*, and serialising to
  // HTML keeps only attributes — a static <select> would then show its first option
  // and an <input> would look empty. Mirror both back into attributes first.
  for (const select of window.document.querySelectorAll('select')) {
    [...select.options].forEach((option, index) => {
      if (index === select.selectedIndex) option.setAttribute('selected', '');
      else option.removeAttribute('selected');
    });
  }
  for (const input of window.document.querySelectorAll('input, textarea')) {
    if (typeof input.value === 'string' && input.value !== '') input.setAttribute('value', input.value);
  }
  const html = window.document.body.innerHTML;
  // Free the poller before serialising is not possible, but closing after is: any
  // `setInterval` the page installed would otherwise keep this process alive.
  window.close();
  return html;
}

const STYLE = `
  html, body, #root { height: ${PAGE ? '100%' : 'auto'}; }
  ${HEADER ? '#root { display: flex; justify-content: flex-end; align-items: flex-start; padding: 10px 120px 10px 16px; }' : ''}
  body { margin: 0; padding: ${PAGE ? '0' : '24px'}; background: ${PAGE ? 'var(--dsw-alias-bg-base, #fff)' : '#fff'}; color: #1b1b1f;
         font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif; }
  :root { --dsw-alias-label-primary: #1b1b1f; --dsw-alias-label-secondary: #5c5c66;
          --dsw-alias-label-tertiary: #8b8b94; --dsw-alias-bg-base: #ffffff; }
  * { box-sizing: border-box; }
`;

const dir = mkdtempSync(join(tmpdir(), 'hbs-worktree-shot-'));
const html = join(dir, 'panel.html');
writeFileSync(html, `<!doctype html><html><head><meta charset="utf-8"><style>${STYLE}</style></head><body>${await render()}</body></html>`);
console.log(`html  ${html}`);

const chrome = CHROME_CANDIDATES.find((candidate) => existsSync(candidate));
if (chrome === undefined) {
  console.log('没找到 Chrome，跳过截图；可以手动打开上面的 html。');
  process.exit(0);
}

for (const [name, width, height] of HEADER
  ? [['header', 520, 400]]
  : PAGE
  ? [['wide', 1180, 560], ['mid', 986, 520], ['narrow', 760, 480]]
  : [['wide', 1180, 420], ['mid', 900, 380], ['narrow', 700, 360]]) {
  const out = join(dir, `${name}.png`);
  execFileSync(chrome, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    `--user-data-dir=${join(dir, 'chrome-profile')}`,
    '--force-device-scale-factor=2',
    `--window-size=${width},${height}`,
    `--screenshot=${out}`,
    `file://${html}`,
  ], { stdio: 'ignore' });
  console.log(`${name}  ${out}`);
}

// The panel keeps a preview poller alive; close the jsdom window so Node can exit.
process.exit(0);
