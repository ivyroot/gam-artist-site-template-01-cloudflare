import { spawn } from 'node:child_process';
import { commandMode, loadSite } from '../configuration/site.ts';
const [command, selected, ...extra] = process.argv.slice(2);
try {
  const mode = commandMode(command, selected);
  loadSite(mode);
  const commands = {
    dev: ['dev'],
    build: ['build'],
    types: ['workers', 'types'],
    deploy: ['deploy'],
    'deploy:dry-run': ['deploy', '--dry-run'],
  };
  if (!commands[command]) throw new Error('Unknown site command.');
  console.log(`Site mode: ${mode}`);
  const child = spawn(
    process.execPath,
    ['node_modules/cf/bin/cf', ...commands[command], '--mode', mode, ...extra],
    {
      stdio: 'inherit',
      env: { ...process.env, GAM_SITE_MODE: mode },
    },
  );
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
  child.on('error', (error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
  child.on('exit', (code, signal) => {
    process.exitCode = code ?? (signal ? 1 : 0);
  });
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
