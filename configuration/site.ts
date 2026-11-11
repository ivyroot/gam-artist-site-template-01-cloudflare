// Build/CLI only. Never import configuration dependencies into the Worker.
import { readFileSync } from 'node:fs';
import { inventoryPage } from '../src/shared/inventory.ts';
export const modes = [
  'local-dev',
  'local-testnet',
  'local-mainnet',
  'cloudflare-testnet',
  'cloudflare-mainnet',
] as const;
export type Mode = (typeof modes)[number];
export function selectMode(value = process.env.GAM_SITE_MODE || 'local-dev'): Mode {
  if (!modes.includes(value as Mode))
    throw new Error(`Unknown mode "${value}". Choose ${modes.join(', ')}.`);
  return value as Mode;
}
export function commandMode(command: string, value?: string): Mode {
  if ((command === 'deploy' || command === 'deploy:dry-run') && !value)
    throw new Error('Choose an explicit cloudflare-testnet or cloudflare-mainnet deployment mode.');
  const mode = selectMode(value);
  if (command === 'dev' && !mode.startsWith('local-'))
    throw new Error('dev requires a local-* mode.');
  if (command.startsWith('deploy') && !mode.startsWith('cloudflare-'))
    throw new Error('deploy requires a cloudflare-* mode.');
  return mode;
}
const fields = [
  'name',
  'tagline',
  'bio',
  'artist',
  'contract',
  'chainId',
  'rpc',
  'indexer',
  'explorer',
  'origin',
  'websiteId',
  'workerName',
  'cloudflareAccountId',
  'storage',
  'databaseId',
  'databaseName',
  'originalsBucket',
  'previewsBucket',
  'localOrigin',
] as const;
export function resolveSite(input: any, mode: Mode) {
  selectMode(mode);
  if (!input.modes?.[mode]) throw new Error(`Missing modes.${mode} in site.config.json.`);
  const raw = { name: input.name, tagline: input.tagline, bio: input.bio, ...input.modes[mode] };
  const site = Object.fromEntries(
    fields.map((key) => {
      const value = raw[key] ?? '';
      if (typeof value !== 'string') throw new Error(`${mode}.${key} must be a string or empty.`);
      return [key, value];
    }),
  ) as Record<(typeof fields)[number], string>;
  const source = raw.catalogSource ?? 'tzkt';
  if (!['rpc', 'tzkt'].includes(source))
    throw new Error(`${mode}.catalogSource must be rpc or tzkt.`);
  const startLevel = raw.catalogStartLevel ?? 0;
  if (!Number.isSafeInteger(startLevel) || startLevel < 0)
    throw new Error(`${mode}.catalogStartLevel must be a nonnegative safe integer.`);
  const page = inventoryPage(raw.inventoryPage) ?? '';
  for (const key of ['origin', 'localOrigin'] as const) {
    if (site[key] && new URL(site[key]).origin !== site[key])
      throw new Error(`${mode}.${key} must be an exact URL origin, without a trailing slash.`);
  }
  if (!['local', 'cloudflare'].includes(site.storage))
    throw new Error(`${mode}.storage must be local or cloudflare.`);
  if (mode.startsWith('cloudflare-') && site.storage !== 'cloudflare')
    throw new Error('Cloudflare modes require Cloudflare storage.');
  if (mode.startsWith('local-') && !site.localOrigin) throw new Error(`${mode} needs localOrigin.`);
  return {
    ...site,
    catalogSource: source as 'rpc' | 'tzkt',
    catalogStartLevel: startLevel,
    mode,
    inventoryPage: page,
    requestOrigin: mode.startsWith('local-') ? site.localOrigin : site.origin,
  };
}
export function loadSite(
  mode: Mode = selectMode(),
  file = new URL('../site.config.json', import.meta.url),
) {
  let contents: string;
  try {
    contents = readFileSync(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(
        'Missing site.config.json. Run `cp site.config.json.example site.config.json`, then edit your site settings.',
      );
    }
    throw error;
  }
  return resolveSite(JSON.parse(contents), mode);
}
export function runtimeSite(site: ReturnType<typeof resolveSite>) {
  const {
    name,
    tagline,
    bio,
    artist,
    contract,
    chainId,
    rpc,
    indexer,
    catalogSource,
    catalogStartLevel,
    explorer,
    origin,
    websiteId,
    inventoryPage,
    requestOrigin,
    mode,
  } = site;
  return {
    name,
    tagline,
    bio,
    artist,
    contract,
    chainId,
    rpc,
    indexer,
    catalogSource,
    catalogStartLevel,
    explorer,
    origin,
    websiteId,
    inventoryPage,
    requestOrigin,
    mode,
  };
}
