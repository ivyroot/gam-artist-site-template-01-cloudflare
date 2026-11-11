import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { api, inventoryApi, uploadOriginal } from './api';
import { login, disconnect, send } from './wallet';
import { purchase, review } from '../chain/parameters';
import { mutez, short, tez, type Catalog, type Work, type Kind, type Tier } from '../shared/model';
import './style.css';
const href = (w: Work) => `/${w.kind}/${w.id}`;
const initial: Catalog = {
  config: {
    name: 'An independent artist',
    tagline: 'Enjoy Displaying Art',
    bio: 'Original digital works, directly from the artist.',
    artist: '',
    contract: '',
    chainId: '',
    rpc: '',
    indexer: '',
    origin: location.origin,
    websiteId: '0',
    ready: false,
    demo: true,
  },
  works: [],
  reviews: [],
  sync: { cursor: 0, level: 0, updated: null },
};
function App() {
  const [data, setData] = useState(initial),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [user, setUser] = useState<{ address: string | null; role: string | null }>({
      address: null,
      role: null,
    });
  const reload = async () => {
    setData(await api('/api/catalog'));
    setUser(await api('/api/session'));
  };
  useEffect(() => {
    reload().catch((e) => setError(e.message));
  }, []);
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };
  const signIn = (role: 'buyer' | 'admin' = 'buyer') =>
    act(async () => {
      setNotice('Open your wallet and sign the site login message.');
      setUser(await login(data.config, role));
      setNotice('Signed in securely.');
    });
  const path = location.pathname;
  const isInventoryPage = Boolean(
    document.querySelector('meta[name="gam-inventory-page"][content="true"]'),
  );
  const m = path.match(/^\/(listing|collection)\/(\d+)$/);
  const dm = path.match(/^\/download\/(?:collection\/(\d+)|(\d+))$/);
  return (
    <>
      <div className="topline">
        INDEPENDENT ART. DIRECT FROM THE ARTIST. <span>POWERED BY GAM ↗</span>
      </div>
      <header>
        <a className="brand" href="/">
          <span className="brand-mark">✳</span>
          {data.config.name}
        </a>
        <nav>
          <a className={path === '/' ? 'selected' : ''} href="/">
            Works
          </a>
          <a href="/#collections">Collections</a>
          <a className={path === '/library' ? 'selected' : ''} href="/library">
            Your library
          </a>
        </nav>
        <button
          className="wallet"
          disabled={busy || !data.config.ready}
          onClick={() =>
            user.address
              ? act(async () => {
                  await disconnect();
                  setUser({ address: null, role: null });
                  setNotice('Signed out.');
                })
              : signIn()
          }
        >
          <span className="dot" />
          {user.address ? short(user.address) + ' · Sign out' : 'Connect wallet'} <span>↗</span>
        </button>
      </header>
      {!data.config.ready && (
        <div className="setup-banner">
          Template preview{' '}
          <span>
            Configure the artist and shared contract to enable wallet purchases and publishing.
          </span>
          <span>
            Configure the selected mode in <code>site.config.json</code>.
          </span>
        </div>
      )}
      {(error || notice) && (
        <div role={error ? 'alert' : 'status'} className={`message ${error ? 'error' : ''}`}>
          {error || notice}
          <button
            aria-label="Dismiss message"
            onClick={() => {
              setError('');
              setNotice('');
            }}
          >
            ×
          </button>
        </div>
      )}
      <main>
        {isInventoryPage ? (
          <Inventory {...{ data, user, busy, act, reload, signIn, setNotice }} />
        ) : path === '/library' ? (
          <Library {...{ data, user, busy, signIn, act }} />
        ) : dm ? (
          <Downloads
            kind={dm[1] ? 'collection' : 'listing'}
            id={dm[1] ?? dm[2]}
            {...{ data, user, signIn }}
          />
        ) : m ? (
          <Detail
            work={data.works.find((w) => w.kind === m[1] && w.id === m[2])}
            {...{ data, user, busy, act, signIn, setNotice }}
          />
        ) : path === '/' ? (
          <Home data={data} />
        ) : (
          <section className="empty">
            <p className="eyebrow">404</p>
            <h1>Nothing here, yet.</h1>
            <a className="button" href="/">
              Back to the shop ↗
            </a>
          </section>
        )}
      </main>
      <footer>
        <div>
          <a href="/" className="brand">
            <span className="brand-mark">✳</span>
            {data.config.name}
          </a>
          <p>Art belongs in your everyday.</p>
        </div>
        <div>
          Owned by the artist. Displayed by you.
          <br />
          <small>Display licenses on Tezos · Downloads delivered here.</small>
        </div>
      </footer>
    </>
  );
}
function Home({ data }: { data: Catalog }) {
  const [filter, setFilter] = useState('All works');
  const listings = data.works.filter((w) => w.kind === 'listing'),
    collections = data.works.filter((w) => w.kind === 'collection');
  const types = ['All works', ...new Set(listings.map((w) => w.item_type ?? 'Art'))];
  const visible = listings.filter((w) => filter === 'All works' || w.item_type === filter);
  return (
    <>
      <section className="hero">
        <div>
          <p className="eyebrow">
            <span className="small-sun">✳</span> FROM THE ARTIST, TO YOUR WORLD
          </p>
          <h1>{data.config.tagline}</h1>
          <p className="hero-copy">{data.config.bio}</p>
          <a className="text-link" href="#works">
            Find something that stays with you <span>↓</span>
          </a>
        </div>
        <div className="hero-note">
          <span className="hand-star">✷</span>
          <p>
            A little less scrolling.
            <br />A little more looking.
          </p>
          <span className="caption">MADE TO BE DISPLAYED, NOT TRADED.</span>
        </div>
      </section>
      <section id="works">
        <div className="section-head">
          <div>
            <p className="eyebrow">THE CATALOG</p>
            <h2>
              Selected works <sup>{String(listings.length).padStart(2, '0')}</sup>
            </h2>
          </div>
        </div>
        <div className="filters" aria-label="Filter works">
          {types.map((type) => (
            <button
              key={type}
              className={filter === type ? 'active' : ''}
              onClick={() => setFilter(type)}
            >
              {type}
            </button>
          ))}
          <span>PERSONAL & COMMERCIAL LICENSES</span>
        </div>
        {visible.length ? (
          <div className="grid">
            {visible.map((w, i) => (
              <Card key={w.id} work={w} index={i} />
            ))}
          </div>
        ) : (
          <div className="empty catalog-empty">
            <div className="empty-art">
              <span>✳</span>
            </div>
            <div>
              <p className="eyebrow">A NEW CHAPTER</p>
              <h2>The shop is taking shape.</h2>
              <p>
                Published works will appear here. Each one is an original file,
                <br className="desktop" /> with a license you can verify and a download you can
                keep.
              </p>
            </div>
          </div>
        )}
      </section>
      <section className="collection-section" id="collections">
        <div>
          <p className="eyebrow">A BODY OF WORK, STILL GROWING</p>
          <h2>
            One collection.
            <br />
            More to discover.
          </h2>
          <p>
            Acquire a collection of works in one purchase. A collection is a set of artworks chosen
            by the artist and covered by one display license. As the artist adds to it, your
            collection grows too.
          </p>
        </div>
        <div className="collection-list">
          {collections.length ? (
            collections.map((w) => (
              <a key={w.id} href={href(w)}>
                <span>
                  <strong>{w.title}</strong>
                  <small>
                    {w.members?.length ?? 0} works · {w.active ? 'Open collection' : 'Sale closed'}
                  </small>
                </span>
                <span>↗</span>
              </a>
            ))
          ) : (
            <div className="collection-placeholder">
              <span>✷</span>
              <p>
                Good things take shape over time.
                <br />
                Collections will appear here.
              </p>
            </div>
          )}
        </div>
      </section>
      <section className="principles">
        <h2 className="how-it-works-title">How it Works</h2>
        <div>
          <span>01 / BUY ONCHAIN</span>
          <h3>Buy a Display License from the artist</h3>
          <p>
            Buy your display license straight from the artist using the Global Art Market (GAM)
            smart contract on Tezos. The Tezos blockchain records your license so it is secure and
            verifiable.
          </p>
        </div>
        <div>
          <span>02 / DOWNLOAD</span>
          <h3>Download the artwork files</h3>
          <p>
            Download your artworks from the artist’s website. It checks your license on Tezos before
            delivering your downloads.
          </p>
        </div>
        <div>
          <span>03 / DISPLAY</span>
          <h3>Display art in your home!</h3>
          <p>Display artworks in your home and add new perspectives to your life.</p>
        </div>
      </section>
    </>
  );
}
function Card({ work: w, index = 0 }: { work: Work; index?: number }) {
  const price = BigInt(w.personal_price) > 0n ? w.personal_price : w.commercial_price;
  return (
    <a className="card" href={href(w)}>
      <div className={`art art-${index % 4}`}>
        {w.preview ? (
          <img src={w.preview} alt={w.title} loading="lazy" />
        ) : (
          <span className="art-placeholder">{w.kind === 'collection' ? '✷' : '✳'}</span>
        )}
        <span className="view-art">View work ↗</span>
      </div>
      <div className="card-meta">
        <span>{w.item_type ?? 'Collection'}</span>
        <span>{w.active ? 'Available' : 'Sale closed'}</span>
      </div>
      <div className="card-title">
        <h3>{w.title}</h3>
        <span>{BigInt(price) > 0n ? `${tez(price)} ꜩ` : 'Not for sale'}</span>
      </div>
      <p>{w.description}</p>
    </a>
  );
}
interface Common {
  data: Catalog;
  user: { address: string | null; role: string | null };
  busy: boolean;
  act: (fn: () => Promise<unknown>) => Promise<void>;
  signIn: (role?: 'buyer' | 'admin') => Promise<void>;
  setNotice: (s: string) => void;
}
function Detail({ work: w, data, user, busy, act, signIn, setNotice }: Common & { work?: Work }) {
  const [tier, setTier] = useState<Tier>('personal'),
    [quantity, setQuantity] = useState('1'),
    [rating, setRating] = useState(''),
    [comment, setComment] = useState('');
  if (!w)
    return (
      <section className="empty">
        <h1>Work not found.</h1>
        <p>The catalog may still be syncing. Return to the shop and try again.</p>
        <a href="/">Back to works</a>
      </section>
    );
  const price = tier === 'personal' ? w.personal_price : w.commercial_price;
  const collections = data.works.filter(
    (c) => c.kind === 'collection' && c.members?.includes(w.id) && c.active,
  );
  const reviews = data.reviews.filter((r) => r.kind === w.kind && r.id === w.id);
  return (
    <>
      <a className="back" href="/">
        ← All works
      </a>
      <section className="detail">
        <div className="detail-art">
          {w.preview ? (
            <img src={w.preview} alt={w.title} />
          ) : (
            <div className="art-placeholder">✳</div>
          )}
        </div>
        <div>
          <p className="eyebrow">
            {w.kind === 'collection'
              ? `${w.members?.length ?? 0} WORKS · GROWING COLLECTION`
              : (w.item_type ?? 'ORIGINAL WORK')}
          </p>
          <h1>{w.title}</h1>
          <p className="description">{w.long_description || w.description}</p>
          <div className="license-tabs">
            <button
              className={tier === 'personal' ? 'active' : ''}
              onClick={() => setTier('personal')}
            >
              Personal display
            </button>
            <button
              className={tier === 'commercial' ? 'active' : ''}
              onClick={() => setTier('commercial')}
            >
              Commercial display
            </button>
          </div>
          <p className="muted" id="license-terms">
            {tier === 'personal'
              ? 'For personal display in your own space.'
              : 'For commercial display. Review the artist’s terms before purchase.'}
          </p>
          {w.terms && <p>{w.terms}</p>}
          <div className="purchase-row">
            <strong>
              {tez(price)} ꜩ <small>per license</small>
            </strong>
            <label>
              Quantity
              <input
                aria-label="License quantity"
                type="number"
                min="1"
                max="1000"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
            </label>
          </div>
          <button
            className="primary full"
            disabled={busy || !data.config.ready || !w.active || BigInt(price) === 0n}
            onClick={() =>
              act(async () => {
                await send(
                  data.config,
                  [purchase(data.config.artist, w.kind, w.id, tier, quantity, price)],
                  setNotice,
                );
                setNotice('Purchase confirmed. Sign in to open your downloads.');
              })
            }
          >
            {!w.active
              ? 'Sale closed'
              : BigInt(price) === 0n
                ? 'This tier is unavailable'
                : 'Purchase this ' + w.kind + ' ↗'}
          </button>
          <p className="fine">
            Wallet fees are additional. A non-transferable display license and download. No edition
            limit. Repeat purchases are charged in full.
          </p>
          {!w.active && collections.length > 0 && (
            <p>
              Available in{' '}
              {collections.map((c) => (
                <a key={c.id} href={href(c)}>
                  {c.title} ↗{' '}
                </a>
              ))}
            </p>
          )}
          <a
            className="button secondary full"
            href={`/download/${w.kind === 'collection' ? 'collection/' : ''}${w.id}`}
          >
            Already purchased? Open downloads ↓
          </a>
          {w.kind === 'collection' && (
            <p className="fine">
              Includes works added later. Contents can change; download access follows current
              membership.
            </p>
          )}
          {w.file_hash && (
            <div className="hash">
              <span>SHA-256 · ORIGINAL FILE</span>
              <code>{w.file_hash}</code>
            </div>
          )}
          {w.replaced_by && (
            <p>
              A newer version is available:{' '}
              <a href={`/listing/${w.replaced_by}`}>view replacement ↗</a>. A replacement is a
              separate listing.
            </p>
          )}
        </div>
      </section>
      {w.kind === 'collection' && (
        <section>
          <div className="section-head">
            <h2>Inside this collection</h2>
          </div>
          <div className="grid">
            {(w.members ?? [])
              .map((id) => data.works.find((x) => x.kind === 'listing' && x.id === id))
              .filter((x): x is Work => !!x)
              .map((x, i) => (
                <Card key={x.id} work={x} index={i} />
              ))}
          </div>
        </section>
      )}
      <section className="reviews">
        <div>
          <p className="eyebrow">FROM REAL BUYERS</p>
          <h2>Notes on the work.</h2>
          <p className="muted">
            Reviews are public on Tezos. You need a direct license for this {w.kind}; reviews open
            in the block after your first purchase.
          </p>
        </div>
        <div>
          {reviews.length ? (
            reviews.map((r) => (
              <article key={r.buyer}>
                <strong>
                  {r.rating ? `${r.rating}/10 · ` : ''}
                  {short(r.buyer)}
                </strong>
                <p>{r.comment}</p>
                <small>
                  {new Date(r.posted_at).toLocaleDateString()}
                  {r.posted_at !== r.updated_at ? ' · Edited' : ''}
                </small>
              </article>
            ))
          ) : (
            <p className="muted">No reviews yet.</p>
          )}
          {user.address ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                act(async () => {
                  await send(
                    data.config,
                    [
                      review(
                        data.config.artist,
                        w.kind,
                        w.id,
                        rating ? Number(rating) : null,
                        comment,
                      ),
                    ],
                    setNotice,
                  );
                });
              }}
            >
              <label>
                Rating (optional)
                <select value={rating} onChange={(e) => setRating(e.target.value)}>
                  <option value="">No rating</option>
                  {Array.from({ length: 10 }, (_, i) => (
                    <option key={i} value={i + 1}>
                      {i + 1} / 10
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Your review
                <textarea
                  value={comment}
                  maxLength={300}
                  onChange={(e) => setComment(e.target.value)}
                />
              </label>
              <button disabled={busy} className="secondary">
                Publish or update review ↗
              </button>
            </form>
          ) : (
            <button onClick={() => signIn()} disabled={!data.config.ready}>
              Sign in to review ↗
            </button>
          )}
        </div>
      </section>
    </>
  );
}
function Library({ data, user, busy, signIn, act }: Omit<Common, 'setNotice'>) {
  const [entries, setEntries] = useState<Work[]>([]),
    [next, setNext] = useState<number | null>(0),
    [loaded, setLoaded] = useState(false);
  const load = async (offset = 0) => {
    const d = await api(`/api/library?offset=${offset}`);
    setEntries((old) => (offset ? [...old, ...d.entries] : d.entries));
    setNext(d.next);
    setLoaded(true);
  };
  useEffect(() => {
    if (user.address) {
      const nextPath = new URLSearchParams(location.search).get('next');
      if (nextPath && /^\/download\/(?:collection\/)?\d+$/.test(nextPath)) {
        location.assign(nextPath);
        return;
      }
      act(() => load());
    }
  }, [user.address]);
  return (
    <section className="page">
      <p className="eyebrow">YOURS TO KEEP</p>
      <h1>Your library.</h1>
      <p>Return to your originals. New works in your collections are included.</p>
      {!user.address ? (
        <div className="empty">
          <h2>A wallet is your library card.</h2>
          <button
            className="primary"
            disabled={!data.config.ready || busy}
            onClick={() => signIn()}
          >
            Sign in with your wallet ↗
          </button>
        </div>
      ) : (
        <>
          {loaded && !entries.length && (
            <p className="empty">
              No licenses found on this page of the catalog. A recent purchase may still be
              confirming.
            </p>
          )}
          <div className="grid">
            {entries.map((w, i) => (
              <div key={`${w.kind}:${w.id}`}>
                <Card work={w} index={i} />
                <a
                  className="button secondary full"
                  href={`/download/${w.kind === 'collection' ? 'collection/' : ''}${w.id}`}
                >
                  Open downloads ↓
                </a>
              </div>
            ))}
          </div>
          {next !== null && (
            <button className="secondary" disabled={busy} onClick={() => act(() => load(next))}>
              Check more works
            </button>
          )}
        </>
      )}
    </section>
  );
}
function Downloads({
  kind,
  id,
  data,
  user,
  signIn,
}: {
  kind: Kind;
  id: string;
  data: Catalog;
  user: Common['user'];
  signIn: Common['signIn'];
}) {
  const [result, setResult] = useState<any>(null),
    [error, setError] = useState(''),
    [progress, setProgress] = useState('');
  const load = () =>
    api(`/api/download/${kind === 'collection' ? 'collection/' : ''}${id}`)
      .then(setResult)
      .catch((e) => setError(e.message));
  useEffect(() => {
    if (user.address) load();
  }, [user.address, kind, id]);
  async function allNew() {
    setError('');
    try {
      for (const w of result.members.filter((w: Work) => !result.downloaded.includes(w.id))) {
        setProgress(`Downloading ${w.title}…`);
        // Native navigation streams to the browser download manager; never buffer originals.
        const a = document.createElement('a');
        a.href = `/download/${w.id}/file`;
        a.download = '';
        document.body.appendChild(a);
        a.click();
        a.remove();
        await new Promise((resolve) => setTimeout(resolve, 400));
      }
      setProgress(
        'Downloads requested. Check your browser’s downloads; it may ask to allow multiple files.',
      );
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <section className="page">
      <a className="back" href="/library">
        ← Your library
      </a>
      <p className="eyebrow">THE ORIGINALS</p>
      <h1>{result?.work.title ?? 'Your downloads.'}</h1>
      {!user.address ? (
        <button className="primary" disabled={!data.config.ready} onClick={() => signIn()}>
          Sign in to access originals ↗
        </button>
      ) : error ? (
        <div role="alert" className="message error">
          {error}
          <button
            onClick={() => {
              setError('');
              load();
            }}
          >
            Retry
          </button>
        </div>
      ) : !result ? (
        <p>Checking your license on Tezos…</p>
      ) : kind === 'collection' ? (
        <>
          <p>Current collection contents. Each work is delivered as its own original file.</p>
          <button
            className="primary"
            disabled={Boolean(progress.startsWith('Downloading'))}
            onClick={allNew}
          >
            Download all new ↓
          </button>
          <p role="status">{progress}</p>
          <div className="download-list">
            {result.members.map((w: Work) => (
              <a key={w.id} href={`/download/${w.id}`}>
                <strong>{w.title}</strong>
                <span>
                  {result.downloaded.includes(w.id)
                    ? 'Previously requested'
                    : 'New to your library'}{' '}
                  ↓
                </span>
              </a>
            ))}
          </div>
        </>
      ) : (
        <>
          <p>
            {result.file.name} · {(result.file.size / 1024 / 1024).toFixed(2)} MB
          </p>
          <a className="button primary" href={`/download/${id}/file`}>
            Download original ↓
          </a>
          <div className="verify">
            <h2>Verify your original.</h2>
            <p>Compare the output below with the hash published on-chain.</p>
            <code className="hash">{result.file.hash}</code>
            <p>
              <a
                target="_blank"
                rel="noreferrer"
                href={`${data.config.explorer || data.config.indexer.replace(/\/api\./, '/')}/${data.config.contract}`}
              >
                Open the contract explorer ↗
              </a>
            </p>
            <label>
              macOS<code>shasum -a 256 -- '{result.file.name.replace(/'/g, "'\\''")}' </code>
            </label>
            <label>
              Linux<code>sha256sum -- '{result.file.name.replace(/'/g, "'\\''")}' </code>
            </label>
            <label>
              Windows PowerShell
              <code>
                Get-FileHash -Algorithm SHA256 -LiteralPath '{result.file.name.replace(/'/g, "''")}'
              </code>
            </label>
            <p className="fine">
              Your browser saves the file. Downloads are byte-for-byte originals; no resizing or
              conversion.
            </p>
          </div>
        </>
      )}
    </section>
  );
}
function Inventory({
  data,
  user,
  busy,
  act,
  reload,
  signIn,
  setNotice,
}: Common & { reload: () => Promise<void> }) {
  const empty = (kind: Kind = 'listing'): Work => ({
    id: '0',
    kind,
    title: '',
    description: '',
    item_type: 'Digital art',
    personal_price: '1000000',
    commercial_price: '5000000',
    website_id: data.config.websiteId,
    active: true,
    members: [],
  });
  const [w, setW] = useState<Work>(empty()),
    [file, setFile] = useState<File | null>(null),
    [progress, setProgress] = useState(0),
    [status, setStatus] = useState<any>(null),
    [name, setName] = useState('');
  const refresh = async () => {
    setStatus(await api(inventoryApi('status')));
    await reload();
  };
  useEffect(() => {
    if (user.role === 'admin') act(refresh);
  }, [user.role]);
  const change = (field: keyof Work, value: unknown) => setW((old) => ({ ...old, [field]: value }));
  return (
    <section className="page admin">
      <p className="eyebrow">BEHIND THE WORK</p>
      <h1>Inventory</h1>
      <p>Publish your originals, shape your collections, and keep your own storefront.</p>
      {!data.config.ready ? (
        <div className="setup-card">
          <h2>Set up your shop.</h2>
          <ol>
            <li>
              Set your name, artist address, network, shared GAM contract, RPC/indexer, canonical
              origin, and website ID in <code>site.config.json</code>.
            </li>
            <li>
              Set a random <code>SESSION_SECRET</code> and apply the D1 migration. Follow the
              repository’s deployment guide.
            </li>
            <li>Deploy, return here, and sign in with the configured artist wallet.</li>
            <li>
              Register your website, upload an original and a public preview, then approve its
              listing in your wallet.
            </li>
          </ol>
          <p>
            No wallet keys are stored on this site. Your account owns the files and infrastructure.
          </p>
        </div>
      ) : user.role !== 'admin' ? (
        <div className="empty">
          <h2>Your wallet opens your inventory.</h2>
          <p>Sign in with {short(data.config.artist)} to manage this deployment.</p>
          <button className="primary" disabled={busy} onClick={() => signIn('admin')}>
            Sign in as artist ↗
          </button>
        </div>
      ) : (
        <>
          <div className="admin-toolbar">
            <span>
              Artist {short(data.config.artist)} · Website {data.config.websiteId}
            </span>
            <button
              disabled={busy}
              onClick={() =>
                act(async () => {
                  const r = await api(inventoryApi('sync'), {});
                  await refresh();
                  setNotice(
                    r.complete ? 'Catalog synced.' : 'Sync page saved. Run sync again to continue.',
                  );
                })
              }
            >
              Sync chain ↻
            </button>
          </div>
          <details className="setup-card">
            <summary>Website registration and display name</summary>
            <label>
              Display name
              <input value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <button
              disabled={busy}
              onClick={() =>
                act(async () => {
                  const r = await api(inventoryApi('prepare/setup'), {
                    websiteId: data.config.websiteId,
                    name,
                  });
                  await send(data.config, r.transactions, setNotice, true);
                  await refresh();
                })
              }
            >
              Register this website in wallet ↗
            </button>
            <p className="fine">
              Canonical origin: {data.config.origin}. Website IDs and file hashes become fixed when
              referenced by a listing.
            </p>
          </details>
          <div className="admin-layout">
            <aside>
              <h3>Your catalog</h3>
              <button
                className="secondary full"
                onClick={() => {
                  setW(empty());
                  setFile(null);
                }}
              >
                + New work
              </button>
              <button
                className="secondary full"
                onClick={() => {
                  setW(empty('collection'));
                  setFile(null);
                }}
              >
                + New collection
              </button>
              {data.works.map((x) => (
                <button
                  className="catalog-item"
                  key={`${x.kind}:${x.id}`}
                  onClick={() => {
                    setW(x);
                    setFile(null);
                    setProgress(0);
                  }}
                >
                  <span>{x.title}</span>
                  <small>
                    {x.kind} #{x.id}
                  </small>
                </button>
              ))}
              {status?.files.length > 0 && (
                <p className="fine">{status.files.length} verified original(s) stored.</p>
              )}
            </aside>
            <form
              className="editor"
              onSubmit={(e) => {
                e.preventDefault();
                act(async () => {
                  const r = await api(inventoryApi('prepare/work'), w);
                  await send(data.config, r.transactions, setNotice, true);
                  await refresh();
                });
              }}
            >
              <div className="section-head">
                <h2>{w.kind === 'listing' ? 'Publish a work' : 'Shape a collection'}</h2>
                <span className="eyebrow">{w.kind}</span>
              </div>
              <label>
                {w.kind === 'listing' ? 'Listing' : 'Collection'} ID
                <input
                  value={w.id}
                  pattern="[0-9]+"
                  required
                  onChange={(e) => change('id', e.target.value)}
                />
                <small>Use a new unused ID for new work. Existing IDs edit that record.</small>
              </label>
              <label>
                Title
                <input required value={w.title} onChange={(e) => change('title', e.target.value)} />
              </label>
              {w.kind === 'listing' && (
                <label>
                  Type
                  <input
                    value={w.item_type}
                    onChange={(e) => change('item_type', e.target.value)}
                  />
                </label>
              )}
              <label>
                Short description (up to 300 UTF-8 bytes)
                <textarea
                  value={w.description}
                  onChange={(e) => change('description', e.target.value)}
                />
              </label>
              <label>
                Extended description
                <textarea
                  value={w.long_description ?? ''}
                  onChange={(e) => change('long_description', e.target.value)}
                />
              </label>
              <div className="two">
                <label>
                  Personal price · tez
                  <input
                    key={`p-${w.kind}-${w.id}`}
                    defaultValue={tez(w.personal_price)}
                    inputMode="decimal"
                    onBlur={(e) => {
                      try {
                        change('personal_price', mutez(e.target.value));
                        e.target.setCustomValidity('');
                      } catch {
                        e.target.setCustomValidity('Enter a valid tez price.');
                        e.target.reportValidity();
                      }
                    }}
                  />
                </label>
                <label>
                  Commercial price · tez
                  <input
                    key={`c-${w.kind}-${w.id}`}
                    defaultValue={tez(w.commercial_price)}
                    inputMode="decimal"
                    onBlur={(e) => {
                      try {
                        change('commercial_price', mutez(e.target.value));
                        e.target.setCustomValidity('');
                      } catch {
                        e.target.setCustomValidity('Enter a valid tez price.');
                        e.target.reportValidity();
                      }
                    }}
                  />
                </label>
              </div>
              <p className="fine">
                Zero disables that tier. Existing purchases retain access when you close the sale.
              </p>
              <label className="check">
                <input
                  type="checkbox"
                  checked={w.active}
                  onChange={(e) => change('active', e.target.checked)}
                />{' '}
                Open for direct purchase
              </label>
              {w.kind === 'listing' ? (
                <div className="upload-box">
                  <h3>Private original</h3>
                  <p>One listing, one immutable file. Upload before approving the listing.</p>
                  <input
                    type="file"
                    aria-label="Original artwork file"
                    onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  />
                  <button
                    type="button"
                    disabled={busy || !file || file.size === 0}
                    onClick={() =>
                      act(async () => {
                        const r = await uploadOriginal(file!, w.id, setProgress);
                        change('file_hash', r.hash);
                        setNotice(`Original verified: ${r.hash}`);
                        await refresh();
                      })
                    }
                  >
                    Upload & verify original ↑
                  </button>
                  {progress > 0 && (
                    <progress max={100} value={progress} aria-label="Upload progress" />
                  )}
                  {w.file_hash && <code className="hash">{w.file_hash}</code>}
                </div>
              ) : (
                <fieldset>
                  <legend>Works in this collection</legend>
                  {data.works
                    .filter((x) => x.kind === 'listing')
                    .map((x) => (
                      <label className="check" key={x.id}>
                        <input
                          type="checkbox"
                          checked={w.members?.includes(x.id) ?? false}
                          onChange={(e) =>
                            change(
                              'members',
                              e.target.checked
                                ? [...(w.members ?? []), x.id]
                                : (w.members ?? []).filter((id) => id !== x.id),
                            )
                          }
                        />
                        {x.title} · {tez(x.personal_price)} ꜩ
                      </label>
                    ))}
                  <p className="fine">
                    Existing collection owners receive additions automatically. Removing a work
                    removes collection-derived access.
                  </p>
                </fieldset>
              )}
              <label>
                Public preview (PNG, JPEG, WebP, AVIF)
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/avif"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f)
                      act(async () => {
                        const r = await fetch(inventoryApi('preview'), {
                          method: 'POST',
                          headers: { 'Content-Type': f.type },
                          body: f,
                        });
                        const d: any = await r.json();
                        if (!r.ok) throw new Error(d.error);
                        change('preview', d.url);
                      });
                  }}
                />
              </label>
              {w.preview && <img className="preview-thumb" src={w.preview} alt="Public preview" />}
              <label>
                License terms / display conditions
                <textarea value={w.terms ?? ''} onChange={(e) => change('terms', e.target.value)} />
              </label>
              <label>
                File summary
                <input
                  value={w.file_summary ?? ''}
                  onChange={(e) => change('file_summary', e.target.value)}
                />
                <small>Describe the original format and dimensions, without private URLs.</small>
              </label>
              <label>
                Tags (comma separated)
                <input
                  defaultValue={(w.tags ?? []).join(', ')}
                  key={`tags-${w.kind}-${w.id}`}
                  onBlur={(e) =>
                    change(
                      'tags',
                      e.target.value
                        .split(',')
                        .map((x) => x.trim())
                        .filter(Boolean),
                    )
                  }
                />
              </label>
              {w.kind === 'listing' && (
                <div className="two">
                  <label>
                    Replaces listing ID
                    <input
                      value={w.replaces ?? ''}
                      onChange={(e) => change('replaces', e.target.value || undefined)}
                    />
                  </label>
                  <label>
                    Replaced by listing ID
                    <input
                      value={w.replaced_by ?? ''}
                      onChange={(e) => change('replaced_by', e.target.value || undefined)}
                    />
                  </label>
                </div>
              )}
              <button className="primary full" disabled={busy} type="submit">
                {busy ? 'Working…' : 'Review & approve in wallet ↗'}
              </button>
              <p className="fine">
                On-chain writes require wallet approval and network fees. Public pages update after
                confirmed events are indexed.
              </p>
            </form>
          </div>
        </>
      )}
    </section>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
