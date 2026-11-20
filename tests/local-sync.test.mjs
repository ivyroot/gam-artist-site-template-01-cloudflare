import { EventEmitter } from 'node:events';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { localSync } from '../configuration/local-sync.ts';

function setup(t, overrides = {}) {
  const timers = [],
    requests = [],
    warnings = [];
  const server = {
    httpServer: new EventEmitter(),
    config: { logger: { warn: (s) => warnings.push(s) } },
  };
  const responses = [];
  t.mock.method(globalThis, 'setTimeout', (fn, delay) => {
    const timer = { fn, delay };
    timers.push(timer);
    return timer;
  });
  t.mock.method(globalThis, 'clearTimeout', () => {});
  t.mock.method(globalThis, 'fetch', async (url) => {
    requests.push(String(url));
    const next = responses.shift();
    if (next instanceof Error) throw next;
    assert.ok(next, 'Unexpected request');
    return Response.json(next);
  });
  localSync({
    artist: 'artist',
    contract: 'contract',
    chainId: 'chain',
    rpc: 'http://rpc.example',
    origin: 'http://localhost:5173',
    localOrigin: 'http://localhost:5173',
    workerName: 'test',
    storage: 'local',
    catalogSource: 'rpc',
    ...overrides,
  }).configureServer(server);
  server.httpServer.emit('listening');
  return { timers, requests, responses, warnings, server };
}
const scheduled = { success: true, result: { outcome: 'ok' } };
test('local RPC catch-up continues serially, then idles when caught up', async (t) => {
  const s = setup(t);
  assert.equal(s.timers[0].delay, 1500);
  s.responses.push(scheduled, { sync: { complete: false, error: null } });
  await s.timers.shift().fn();
  assert.equal(s.timers[0].delay, 100);
  assert.equal(s.requests.length, 2);
  assert.ok(s.requests[0].includes('/local/scheduled?worker=test'));
  assert.equal(s.requests[1], 'http://localhost:5173/api/catalog');
  s.responses.push(scheduled, { sync: { complete: true, error: null } });
  await s.timers.shift().fn();
  assert.equal(s.timers[0].delay, 10000);
  s.server.httpServer.emit('close');
  await s.timers.shift().fn();
  assert.equal(s.requests.length, 4);
  assert.equal(s.timers.length, 0);
});
test('local RPC errors back off instead of spinning and duplicate warnings are suppressed', async (t) => {
  const s = setup(t);
  for (let n = 0; n < 2; n++) {
    s.responses.push(scheduled, { sync: { complete: false, error: 'RPC unavailable' } });
    await s.timers.shift().fn();
    assert.equal(s.timers[0].delay, 10000);
  }
  assert.deepEqual(s.warnings, ['RPC unavailable']);
});
test('remote bindings retain normal polling', async (t) => {
  const s = setup(t, { storage: 'cloudflare' });
  s.responses.push(scheduled);
  await s.timers.shift().fn();
  assert.equal(s.requests.length, 1);
  assert.equal(s.timers[0].delay, 10000);
});

test('local indexer mode retains normal polling', async (t) => {
  const s = setup(t, { catalogSource: 'tzkt', indexer: 'https://indexer.example' });
  s.responses.push(scheduled);
  await s.timers.shift().fn();
  assert.equal(s.requests.length, 1);
  assert.equal(s.timers[0].delay, 10000);
});
