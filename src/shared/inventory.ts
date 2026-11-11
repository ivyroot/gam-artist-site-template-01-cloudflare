// Configuration-time validation. Do not import this module into the Worker:
// the Cloudflare dev plugin blocks configuration dependencies in its dev runner.
// Unset, null, and empty string all disable Inventory in any mode.
const reserved = new Set([
  'admin',
  'inventory',
  'studio',
  'dashboard',
  'manage',
  'settings',
  'api',
  'auth',
  'login',
  'wp-admin',
  'wp-login',
  'library',
  'listing',
  'collection',
  'download',
  'previews',
  'samples',
  'assets',
]);
export function inventoryPage(value: unknown): string | undefined {
  if (value == null || value === '') return undefined;
  if (
    typeof value !== 'string' ||
    !/^\/[a-zA-Z0-9][a-zA-Z0-9_-]{2,79}$/.test(value) ||
    reserved.has(value.slice(1).toLowerCase())
  ) {
    throw new Error(
      'inventoryPage must be a custom path beginning with /, followed by 3–80 letters, numbers, hyphens or underscores. Standard page names such as /admin and /inventory are reserved.',
    );
  }
  return value;
}
