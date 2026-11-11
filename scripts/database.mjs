import { loadSite, selectMode } from '../configuration/site.ts';
import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const c = loadSite(selectMode(process.argv[2]));
if (!c.mode.startsWith('local-') || c.storage !== 'local')
  throw new Error('This command only changes local simulated storage.');
// Local only: cf and Vite 2 share .cloudflare/state. Never infer a remote target.
const directory = new URL('../migrations/', import.meta.url);
const sql = readdirSync(directory)
  .filter((name) => name.endsWith('.sql'))
  .sort()
  .map((name) => readFileSync(new URL(name, directory), 'utf8'))
  .join('\n');
const result = spawnSync(
  process.execPath,
  ['node_modules/cf/bin/cf', 'd1', 'raw', `DB-${c.workerName}`, '--local', '--sql', sql],
  { stdio: 'inherit' },
);
process.exit(result.status ?? 1);
