import { loadSite, selectMode } from '../configuration/site.ts';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const c = loadSite(selectMode(process.argv[2]));
if (!c.mode.startsWith('local-') || c.storage !== 'local')
  throw new Error('This command only changes local simulated storage.');
// Local only: cf and Vite 2 share .cloudflare/state. Never infer a remote target.
const sql = readFileSync(new URL('../migrations/0001_initial.sql', import.meta.url), 'utf8');
const result = spawnSync(
  process.execPath,
  ['node_modules/cf/bin/cf', 'd1', 'raw', `DB-${c.workerName}`, '--local', '--sql', sql],
  { stdio: 'inherit' },
);
process.exit(result.status ?? 1);
