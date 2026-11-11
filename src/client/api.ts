export async function api<T = any>(path: string, body?: unknown, method?: string): Promise<T> {
  const r = await fetch(path, {
    method: method ?? (body === undefined ? 'GET' : 'POST'),
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data: any = await r.json();
  if (!r.ok) throw new Error(data.error ?? `Request failed (${r.status})`);
  return data;
}
export function inventoryApi(action: string): string {
  if (!document.querySelector('meta[name="gam-inventory-page"][content="true"]')) {
    throw new Error('Open your configured Inventory page to manage your shop.');
  }
  return `${location.pathname}/api/${action}`;
}
export async function uploadOriginal(file: File, id: string, onProgress: (n: number) => void) {
  const start = await api(inventoryApi('upload/start'), { id, name: file.name, type: file.type });
  const parts = [];
  try {
    for (let offset = 0, n = 1; offset < file.size; offset += start.partSize, n++) {
      const r = await fetch(inventoryApi(`upload/${start.token}/part?number=${n}`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: file.slice(offset, offset + start.partSize),
      });
      const part: any = await r.json();
      if (!r.ok) throw new Error(part.error ?? 'Upload part failed.');
      parts.push(part);
      onProgress(Math.min(95, Math.round((100 * (offset + start.partSize)) / file.size)));
    }
    const result = await api(inventoryApi(`upload/${start.token}/complete`), { parts });
    onProgress(100);
    return result;
  } catch (e) {
    await api(inventoryApi(`upload/${start.token}/abort`), {}).catch(() => {});
    throw e;
  }
}
