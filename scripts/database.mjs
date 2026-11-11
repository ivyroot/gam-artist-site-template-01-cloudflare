import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
// Local only: cf and Vite 2 share .cloudflare/state. Never infer a remote target.
const sql = readFileSync(new URL('../migrations/0001_initial.sql', import.meta.url), 'utf8');
const result = spawnSync(
  process.execPath,
  [
    'node_modules/cf/bin/cf',
    'd1',
    'raw',
    `DB-${JSON.parse(readFileSync(new URL('../site.config.json', import.meta.url), 'utf8')).workerName}`,
    '--local',
    '--sql',
    sql,
  ],
  { stdio: 'inherit' },
);
process.exit(result.status ?? 1);
