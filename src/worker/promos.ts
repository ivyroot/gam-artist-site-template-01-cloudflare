import { nat } from '../shared/model';
import { body, ensure, json, type Env } from './env';
const publicFile = (r: any) => ({
  id: r.id,
  url: `/previews/${r.id}`,
  name: r.name,
  alt: r.alt,
  content_type: r.content_type,
  size: r.size,
  created: r.created,
  ...(r.position === undefined ? {} : { position: r.position }),
});
function target(v: any) {
  ensure(v.kind === 'listing' || v.kind === 'collection', 'Invalid record type.');
  nat(v.work_id);
}
export async function promoPage(env: Env, kind: string, id: string, after?: string | null) {
  target({ kind, work_id: id });
  ensure(after == null || /^-?\d+$/.test(after), 'Invalid page cursor.');
  const rows = await env.DB.prepare(
    `SELECT f.*,l.position FROM work_promo_files l
 JOIN promo_files f ON f.id=l.promo_id WHERE l.kind=? AND l.work_id=?
 AND (? IS NULL OR l.position>?) ORDER BY l.position LIMIT 25`,
  )
    .bind(kind, id, after ?? null, after ?? null)
    .all();
  return {
    files: rows.results.map(publicFile),
    next: rows.results.length === 25 ? String(rows.results.at(-1)!.position) : null,
  };
}
export async function promoAdmin(req: Request, env: Env, path: string) {
  if (path === '/api/admin/promo/upload') {
    const type = req.headers.get('Content-Type') ?? '';
    ensure(/^image\/(png|jpeg|webp|avif)$/.test(type), 'Use PNG, JPEG, WebP, or AVIF.');
    const name = new URL(req.url).searchParams.get('name') ?? 'Promotional image';
    ensure(
      new TextEncoder().encode(name).length <= 255 && !/[\r\n\0]/.test(name),
      'Invalid filename.',
    );
    ensure(req.body, 'Choose an image.');
    const reader = req.body.getReader(),
      parts: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const r = await reader.read();
      if (r.done) break;
      size += r.value.length;
      if (size > 5 * 1024 * 1024) {
        await reader.cancel();
        ensure(false, 'Images must be at most 5 MiB.', 413);
      }
      parts.push(r.value);
    }
    ensure(size > 0, 'Image is empty.');
    const id = crypto.randomUUID();
    await env.PREVIEWS.put(id, Buffer.concat(parts), { httpMetadata: { contentType: type } });
    try {
      await env.DB.prepare(
        'INSERT INTO promo_files(id,object_key,name,content_type,size,created) VALUES(?,?,?,?,?,?)',
      )
        .bind(id, id, name, type, size, Date.now())
        .run();
    } catch (e) {
      await env.PREVIEWS.delete(id);
      throw e;
    }
    return json({ id, url: `/previews/${id}` });
  }
  const v = await body<any>(req);
  if (path === '/api/admin/promo/list') {
    ensure(v.after == null || typeof v.after === 'string', 'Invalid page cursor.');
    const rows = await env.DB.prepare('SELECT * FROM promo_files WHERE id>? ORDER BY id LIMIT 25')
      .bind(v.after ?? '')
      .all();
    return json({
      files: rows.results.map(publicFile),
      next: rows.results.length === 25 ? rows.results.at(-1)!.id : null,
    });
  }
  if (path === '/api/admin/promo/work') {
    target(v);
    return json(await promoPage(env, v.kind, v.work_id, v.after));
  }
  ensure(typeof v.id === 'string', 'Choose a promotional file.');
  const file = await env.DB.prepare('SELECT * FROM promo_files WHERE id=?').bind(v.id).first();
  ensure(file, 'Promotional file not found.', 404);
  if (path === '/api/admin/promo/caption') {
    ensure(
      typeof v.alt === 'string' && new TextEncoder().encode(v.alt).length <= 1000,
      'Caption must fit 1000 UTF-8 bytes.',
    );
    await env.DB.prepare('UPDATE promo_files SET alt=? WHERE id=?').bind(v.alt, v.id).run();
    return json({ ok: true });
  }
  if (path === '/api/admin/promo/delete') {
    const links = await env.DB.prepare('SELECT 1 FROM work_promo_files WHERE promo_id=?')
      .bind(v.id)
      .first();
    ensure(!links, 'Remove this image from all works before deleting it.', 409);
    await env.DB.prepare('DELETE FROM promo_files WHERE id=?').bind(v.id).run();
    await env.PREVIEWS.delete(String(file.object_key));
    return json({ ok: true });
  }
  target(v);
  if (path === '/api/admin/promo/link') {
    await env.DB.prepare(
      'INSERT OR IGNORE INTO work_promo_files(kind,work_id,promo_id) VALUES(?,?,?)',
    )
      .bind(v.kind, v.work_id, v.id)
      .run();
  } else if (path === '/api/admin/promo/unlink') {
    await env.DB.prepare('DELETE FROM work_promo_files WHERE kind=? AND work_id=? AND promo_id=?')
      .bind(v.kind, v.work_id, v.id)
      .run();
  } else if (path === '/api/admin/promo/cover') {
    await env.DB.prepare(
      `UPDATE work_promo_files SET position=(SELECT MIN(0,COALESCE(MIN(position),0))-1 FROM work_promo_files)
   WHERE kind=? AND work_id=? AND promo_id=?`,
    )
      .bind(v.kind, v.work_id, v.id)
      .run();
  } else ensure(false, 'Promotional route not found.', 404);
  return json({ ok: true });
}
