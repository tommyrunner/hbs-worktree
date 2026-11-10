/**
 * Host-half tests: the skill provider and the panel route, exercised through a
 * fake cordis context so nothing here needs a running Harness.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { after, before, describe, it } from 'node:test';

const host = await import('../index.js');

const sandboxes = [];

after(() => {
  for (const dir of sandboxes) rmSync(dir, { recursive: true, force: true });
});

/** Minimal cordis-shaped context: records providers and route registrations. */
function makeContext() {
  const providers = [];
  const routes = [];
  const ctx = {
    skills: {
      registerProvider(factory) {
        providers.push(factory);
      },
    },
    inject(deps, callback) {
      assert.deepEqual(deps, ['webServer']);
      callback({
        effect(run) {
          run();
        },
        webServer: {
          register(route) {
            routes.push(route);
            return () => {};
          },
        },
      });
    },
  };
  return { ctx, providers, routes };
}

/** Fake node http request carrying `body`. */
function makeRequest({ method = 'POST', body = '', remoteAddress = '127.0.0.1', headers = {} } = {}) {
  const stream = Readable.from([Buffer.from(body)]);
  stream.method = method;
  stream.headers = headers;
  stream.socket = { remoteAddress };
  return stream;
}

/** Fake node http response that collects the written body. */
function makeResponse() {
  const response = {
    statusCode: 200,
    headers: {},
    body: '',
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    end(chunk) {
      this.body = chunk === undefined ? '' : String(chunk);
      this.finished = true;
    },
  };
  return response;
}

describe('host half', () => {
  before(() => {
    const dir = mkdtempSync(join(tmpdir(), 'hbs-wt-host-'));
    sandboxes.push(dir);
    process.env.HBS_WT_HOME = join(dir, 'home');
  });

  it('declares the name and the required skill service', () => {
    assert.equal(host.name, 'hbs-worktree');
    assert.deepEqual(host.inject, ['skills']);
  });

  it('contributes exactly one skill candidate', async () => {
    const { ctx, providers } = makeContext();
    host.apply(ctx);
    assert.equal(providers.length, 1);
    const provider = providers[0]();
    assert.equal(provider.name, 'hbs-worktree');
    const candidates = await provider.list();
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].name, 'hbs-worktree');
    assert.equal(candidates[0].invocation.modelInvocable, true);
    assert.equal(typeof candidates[0].rank, 'number');

    const skill = await provider.get(candidates[0]);
    assert.match(skill.content, /hbs-worktree 工作树协议/);
    assert.match(skill.content, /hbs-wt bind/);
    assert.equal(skill.resourceBase.kind, 'directory');
  });

  it('registers one exact route', () => {
    const { ctx, routes } = makeContext();
    host.apply(ctx);
    assert.equal(routes.length, 1);
    assert.equal(routes[0].kind, 'exact');
    assert.equal(routes[0].path, '/hbs-worktree/api');
    assert.equal(typeof routes[0].handler, 'function');
  });

  it('answers a command with the shared envelope', async () => {
    const { ctx, routes } = makeContext();
    host.apply(ctx);
    const dir = mkdtempSync(join(tmpdir(), 'hbs-wt-repo-'));
    sandboxes.push(dir);
    const response = makeResponse();
    await routes[0].handler(makeRequest({ body: JSON.stringify({ cmd: 'repo', root: dir }) }), response);
    assert.equal(response.statusCode, 200);
    const envelope = JSON.parse(response.body);
    assert.equal(envelope.ok, true);
    assert.equal(envelope.data.isGit, false);
  });

  it('rejects unknown commands, wrong methods, bad JSON, and foreign peers', async () => {
    const { ctx, routes } = makeContext();
    host.apply(ctx);
    const handler = routes[0].handler;

    const unknown = makeResponse();
    await handler(makeRequest({ body: JSON.stringify({ cmd: 'drop-everything' }) }), unknown);
    assert.equal(JSON.parse(unknown.body).error.code, 'unknown-command');

    const wrongMethod = makeResponse();
    await handler(makeRequest({ method: 'GET' }), wrongMethod);
    assert.equal(wrongMethod.statusCode, 405);

    const badJson = makeResponse();
    await handler(makeRequest({ body: 'not json' }), badJson);
    assert.equal(badJson.statusCode, 400);

    const foreign = makeResponse();
    await handler(makeRequest({ body: JSON.stringify({ cmd: 'repo' }), remoteAddress: '10.0.0.7' }), foreign);
    assert.equal(foreign.statusCode, 403);

    const crossOrigin = makeResponse();
    await handler(makeRequest({
      body: JSON.stringify({ cmd: 'repo' }),
      headers: { origin: 'https://evil.example', host: '127.0.0.1:51013' },
    }), crossOrigin);
    assert.equal(crossOrigin.statusCode, 403);
  });
});
