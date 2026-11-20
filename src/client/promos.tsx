import React, { useEffect, useState } from 'react';
import { api, inventoryApi } from './api';
import type { Work } from '../shared/model';
type Image = { id: string; url: string; name: string; alt: string };
type Page = { files: Image[]; next: string | null };

export function PromoGallery({ work }: { work: Work }) {
  const [page, setPage] = useState<Page>({ files: [], next: null });
  const [selected, setSelected] = useState<Image | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const load = async (after?: string) => {
    setLoading(true);
    try {
      const p = await api<Page>(
        `/api/promos/${work.kind}/${work.id}${after ? `?after=${encodeURIComponent(after)}` : ''}`,
      );
      setPage((old) => ({ files: after ? [...old.files, ...p.files] : p.files, next: p.next }));
      setError('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    setSelected(null);
    setPage({ files: [], next: null });
    void load();
  }, [work.kind, work.id, work.preview]);
  return (
    <div className="promo-gallery">
      {selected?.url || work.preview ? (
        <img
          className="promo-main"
          src={selected?.url || work.preview}
          alt={selected?.alt || work.title}
        />
      ) : (
        <div className="art-placeholder">✳</div>
      )}
      {selected?.alt && <p className="fine">{selected.alt}</p>}
      <div className="promo-thumbnails">
        {page.files.map((f) => (
          <button
            type="button"
            key={f.id}
            aria-label={`View ${f.alt || f.name}`}
            aria-pressed={(selected?.url || work.preview) === f.url}
            onClick={() => setSelected(f)}
          >
            <img src={f.url} alt={f.alt || f.name} loading="lazy" />
          </button>
        ))}
      </div>
      {error && (
        <p role="alert">
          {error}{' '}
          <button type="button" onClick={() => void load()}>
            Retry images
          </button>
        </p>
      )}
      {page.next && (
        <button type="button" disabled={loading} onClick={() => void load(page.next!)}>
          More images
        </button>
      )}
    </div>
  );
}

export function PromoLibrary({ work, onChange }: { work?: Work; onChange: () => Promise<void> }) {
  const [library, setLibrary] = useState<Page>({ files: [], next: null });
  const [linked, setLinked] = useState<Page>({ files: [], next: null });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const target = { kind: work?.kind, work_id: work?.id };
  const load = async (section: 'list' | 'work', after?: string) => {
    const p = await api<Page>(inventoryApi(`promo/${section}`), { ...target, after });
    const setter = section === 'list' ? setLibrary : setLinked;
    setter((old) => ({ files: after ? [...old.files, ...p.files] : p.files, next: p.next }));
  };
  const refresh = async () => {
    await load('list');
    if (work?.id) await load('work');
    await onChange();
  };
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    setLinked({ files: [], next: null });
    void run(async () => {
      await load('list');
      if (work?.id) await load('work');
    });
  }, [work?.kind, work?.id]);
  const action = async (action: string, id: string) => {
    await api(inventoryApi(`promo/${action}`), { ...target, id });
    await refresh();
  };
  return (
    <fieldset
      className="promo-library"
      disabled={busy}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && e.target instanceof HTMLInputElement && e.target.type !== 'file')
          e.preventDefault();
      }}
    >
      <legend>{work ? 'Promotional images for this work' : 'Promotional image library'}</legend>
      <p className="fine">
        Public images for your storefront and publicity. No per-work limit. PNG, JPEG, WebP, AVIF;
        up to 5 MiB each. Changes save immediately without wallet approval. Captions apply wherever
        an image is reused.
      </p>
      <label>
        Upload promotional images
        <input
          type="file"
          multiple
          accept="image/png,image/jpeg,image/webp,image/avif"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = '';
            void run(async () => {
              let count = 0;
              try {
                for (const f of files) {
                  setNotice(`Uploading ${++count} of ${files.length}: ${f.name}`);
                  const response = await fetch(
                    inventoryApi(`promo/upload?name=${encodeURIComponent(f.name)}`),
                    { method: 'POST', headers: { 'Content-Type': f.type }, body: f },
                  );
                  const result = (await response.json()) as any;
                  if (!response.ok) throw new Error(result.error);
                  if (work?.id) await api(inventoryApi('promo/link'), { ...target, id: result.id });
                }
              } finally {
                await refresh();
              }
              setNotice(`${files.length} image(s) uploaded.`);
            });
          }}
        />
      </label>
      {notice && <p role="status">{notice}</p>}
      {error && (
        <p className="message error" role="alert">
          {error}
        </p>
      )}
      {work?.id && (
        <>
          <h3>Work gallery · first image is the cover</h3>
          <div className="promo-grid">
            {linked.files.map((f) => (
              <div key={f.id}>
                <img src={f.url} alt={f.alt || f.name} loading="lazy" />
                <p>{f.alt || f.name}</p>
                <button type="button" onClick={() => void run(() => action('cover', f.id))}>
                  Move to front / cover
                </button>{' '}
                <button type="button" onClick={() => void run(() => action('unlink', f.id))}>
                  Remove from work
                </button>
              </div>
            ))}
          </div>
          {linked.next && (
            <button type="button" onClick={() => void run(() => load('work', linked.next!))}>
              More linked images
            </button>
          )}
        </>
      )}
      <h3>Reusable image library</h3>
      <button type="button" onClick={() => void run(refresh)}>
        Refresh images
      </button>
      <div className="promo-grid">
        {library.files.map((f) => (
          <div key={f.id}>
            <img src={f.url} alt={f.alt || f.name} loading="lazy" />
            <p>{f.name}</p>
            <PromoCaption
              key={`${f.id}:${f.alt}`}
              image={f}
              save={(alt) =>
                run(async () => {
                  await api(inventoryApi('promo/caption'), { id: f.id, alt });
                  await refresh();
                })
              }
            />
            {work?.id && (
              <button type="button" onClick={() => void run(() => action('link', f.id))}>
                Add to this work
              </button>
            )}
          </div>
        ))}
      </div>
      {library.next && (
        <button type="button" onClick={() => void run(() => load('list', library.next!))}>
          More library images
        </button>
      )}
    </fieldset>
  );
}

function PromoCaption({ image, save }: { image: Image; save: (alt: string) => Promise<void> }) {
  const [alt, setAlt] = useState(image.alt);
  return (
    <>
      <label>
        Caption / image description
        <input value={alt} onChange={(e) => setAlt(e.target.value)} />
      </label>
      <button type="button" disabled={alt === image.alt} onClick={() => void save(alt)}>
        Save caption
      </button>
    </>
  );
}
