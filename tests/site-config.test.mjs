import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  modes,
  resolveSite,
  runtimeSite,
  commandMode,
  selectMode,
  loadSite,
} from '../configuration/site.ts';
const template = JSON.parse(
  readFileSync(new URL('../site.config.json.example', import.meta.url), 'utf8'),
);
test('one template explicitly enumerates exactly the five supported modes', () => {
  assert.deepEqual(Object.keys(template.modes), [...modes]);
  for (const mode of modes) {
    assert.equal(template.modes[mode].inventoryPage, '');
    assert.equal(resolveSite(template, mode).mode, mode);
  }
  for (const invalid of ['cloudflare-dev', 'staging', 'mainnet', 'dev'])
    assert.throws(() => selectMode(invalid));
});
test('missing, null and empty fields normalize identically, including Inventory', () => {
  for (const mode of modes) {
    const results = [undefined, null, ''].map((value) => {
      const copy = structuredClone(template);
      copy.modes[mode].inventoryPage = value;
      copy.modes[mode].explorer = value;
      return resolveSite(copy, mode);
    });
    assert.deepEqual(results[0], results[1]);
    assert.deepEqual(results[1], results[2]);
  }
});
test('local Inventory keeps canonical public origin and remote shop resources', () => {
  const copy = structuredClone(template);
  Object.assign(copy.modes['local-mainnet'], {
    origin: 'https://art.example',
    inventoryPage: '/private-stockroom',
  });
  const site = resolveSite(copy, 'local-mainnet');
  assert.equal(site.origin, 'https://art.example');
  assert.equal(site.requestOrigin, 'http://localhost:5173');
  assert.equal(site.storage, 'cloudflare');
  assert.equal(site.databaseName, copy.modes['cloudflare-mainnet'].databaseName);
  const runtime = runtimeSite(site);
  for (const key of [
    'modes',
    'cloudflareAccountId',
    'databaseId',
    'originalsBucket',
    'previewsBucket',
    'localOrigin',
  ])
    assert.equal(key in runtime, false);
});
test('commands distinguish local execution from explicit cloud deployment', () => {
  assert.equal(commandMode('dev'), 'local-dev');
  assert.equal(commandMode('dev', 'local-mainnet'), 'local-mainnet');
  assert.equal(commandMode('deploy', 'cloudflare-testnet'), 'cloudflare-testnet');
  assert.throws(() => commandMode('deploy'));
  assert.throws(() => commandMode('deploy', 'local-mainnet'));
  assert.throws(() => commandMode('dev', 'cloudflare-mainnet'));
});

test('a missing working configuration explains setup without creating or overwriting files', () => {
  const directory = mkdtempSync(join(tmpdir(), 'gam-site-config-'));
  const file = join(directory, 'site.config.json');
  try {
    assert.throws(
      () => loadSite('local-dev', pathToFileURL(file)),
      /cp site\.config\.json\.example site\.config\.json/,
    );
    assert.equal(existsSync(file), false);
  } finally {
    rmSync(directory, { recursive: true });
  }
});

test('catalog sources have explicit per-mode defaults and local chain identity is developer supplied', () => {
  for (const mode of modes) {
    const site = resolveSite(template, mode);
    assert.equal(site.catalogSource, mode === 'local-dev' ? 'rpc' : 'tzkt');
    assert.equal(site.catalogStartLevel, 0);
    assert.equal(runtimeSite(site).catalogSource, site.catalogSource);
  }
  assert.equal(template.modes['local-dev'].contract, '');
  assert.equal(template.modes['local-dev'].chainId, '');
  const legacy = structuredClone(template);
  delete legacy.modes['local-dev'].catalogSource;
  delete legacy.modes['local-dev'].catalogStartLevel;
  assert.equal(resolveSite(legacy, 'local-dev').catalogSource, 'tzkt');
  assert.equal(resolveSite(legacy, 'local-dev').catalogStartLevel, 0);
});
test('source and starting level are validated without coupling them to a mode', () => {
  for (const mode of modes) {
    const copy = structuredClone(template);
    copy.modes[mode].catalogSource = 'rpc';
    assert.equal(resolveSite(copy, mode).catalogSource, 'rpc');
    for (const bad of ['auto', '', 7]) {
      copy.modes[mode].catalogSource = bad;
      assert.throws(() => resolveSite(copy, mode), /catalogSource/);
    }
    copy.modes[mode].catalogSource = 'rpc';
    for (const bad of [-1, 1.5, '0', Number.MAX_SAFE_INTEGER + 1]) {
      copy.modes[mode].catalogStartLevel = bad;
      assert.throws(() => resolveSite(copy, mode), /catalogStartLevel/);
    }
  }
});
