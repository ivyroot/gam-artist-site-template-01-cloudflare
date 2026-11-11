import { verifySignature, getPkhfromPk, validateAddress, ValidationResult } from '@taquito/utils';
import { utf8Hex } from '../shared/model';
import { body, config, ensure, HttpError, json, rateLimit, sameOrigin, type Env } from './env';
export interface Session {
  id: string;
  address: string;
  role: 'buyer' | 'admin';
  expires: number;
}
const now = () => Math.floor(Date.now() / 1000);
const digest = async (s: string) =>
  Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))).toString('hex');
const key = (secret: string) =>
  crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
const sign = async (id: string, env: Env) =>
  Buffer.from(
    await crypto.subtle.sign('HMAC', await key(env.SESSION_SECRET!), new TextEncoder().encode(id)),
  ).toString('hex');
const cookie = (value: string, age: number) =>
  `gam_session=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${age}`;
export async function session(req: Request, env: Env, admin = false): Promise<Session> {
  ensure(
    env.SESSION_SECRET && env.SESSION_SECRET.length >= 32,
    'Session secret is not configured.',
    503,
  );
  const token = req.headers
    .get('Cookie')
    ?.match(/(?:^|;\s*)gam_session=([a-f0-9]{64})\.([a-f0-9]{64})(?:;|$)/);
  ensure(token, 'Connect and sign in with your wallet.', 401);
  const valid = await crypto.subtle.verify(
    'HMAC',
    await key(env.SESSION_SECRET!),
    Buffer.from(token![2], 'hex'),
    new TextEncoder().encode(token![1]),
  );
  ensure(valid, 'Session is invalid. Please sign in again.', 401);
  const row = await env.DB.prepare('SELECT * FROM sessions WHERE id=? AND expires>?')
    .bind(await digest(token![1]), now())
    .first<Session>();
  ensure(row, 'Session expired. Please sign in again.', 401);
  if (admin)
    ensure(
      row!.role === 'admin' && row!.address === config(env).artist,
      'Only the configured artist can access this action.',
      403,
    );
  return row!;
}
export async function auth(req: Request, env: Env, path: string) {
  if (path === '/api/session' && req.method === 'GET') {
    try {
      const s = await session(req, env);
      return json({ address: s.address, role: s.role });
    } catch (e) {
      if (e instanceof HttpError && (e.status === 401 || e.status === 503))
        return json({ address: null, role: null });
      throw e;
    }
  }
  sameOrigin(req, env);
  if (path === '/api/auth/logout') {
    try {
      const s = await session(req, env);
      await env.DB.prepare('DELETE FROM sessions WHERE id=?').bind(s.id).run();
    } catch {}
    return json({ ok: true }, 200, { 'Set-Cookie': cookie('', 0) });
  }
  const c = config(env);
  ensure(
    c.ready,
    'Configure the artist, network, contract, and site origin before signing in.',
    503,
  );
  ensure(
    env.SESSION_SECRET && env.SESSION_SECRET.length >= 32,
    'Set a strong SESSION_SECRET before signing in.',
    503,
  );
  await rateLimit(env, `auth:${req.headers.get('CF-Connecting-IP') ?? 'local'}`, 15);
  if (path === '/api/auth/challenge') {
    const { address, role } = await body<{ address: string; role: string }>(req);
    ensure(
      validateAddress(address) === ValidationResult.VALID && /^tz[1-4]/.test(address),
      'Use an implicit Tezos wallet address.',
    );
    ensure(role === 'buyer' || role === 'admin', 'Invalid sign-in role.');
    if (role === 'admin')
      ensure(address === c.artist, 'This wallet is not the configured artist.', 403);
    const id = crypto.randomUUID(),
      expires = now() + 300;
    const message = `Tezos Signed Message: GAM sign-in\nOrigin: ${c.origin}\nChain: ${c.chainId}\nContract: ${c.contract}\nAddress: ${address}\nRole: ${role}\nNonce: ${id}\nExpires: ${expires}`;
    const bytes = utf8Hex(message);
    const payload = '050100' + (bytes.length / 2).toString(16).padStart(6, '0') + bytes;
    await env.DB.prepare(
      'INSERT INTO challenges(id,address,role,payload,expires) VALUES(?,?,?,?,?)',
    )
      .bind(id, address, role, payload, expires)
      .run();
    return json({ id, payload, message });
  }
  if (path === '/api/auth/verify') {
    const { id, publicKey, signature } = await body<{
      id: string;
      publicKey: string;
      signature: string;
    }>(req);
    const challenge = await env.DB.prepare('SELECT * FROM challenges WHERE id=? AND expires>?')
      .bind(id, now())
      .first<{ address: string; role: string; payload: string }>();
    ensure(challenge, 'Sign-in challenge expired or already used.', 401);
    let valid = false;
    try {
      valid =
        getPkhfromPk(publicKey) === challenge!.address &&
        verifySignature(challenge!.payload, publicKey, signature);
    } catch {}
    ensure(valid, 'Wallet signature could not be verified.', 401);
    const consumed = await env.DB.prepare(
      'DELETE FROM challenges WHERE id=? AND expires>? RETURNING id',
    )
      .bind(id, now())
      .first();
    ensure(consumed, 'This sign-in challenge has already been used.', 401);
    const token = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex');
    await env.DB.prepare('INSERT INTO sessions(id,address,role,expires) VALUES(?,?,?,?)')
      .bind(await digest(token), challenge!.address, challenge!.role, now() + 3600)
      .run();
    return json({ address: challenge!.address, role: challenge!.role }, 200, {
      'Set-Cookie': cookie(`${token}.${await sign(token, env)}`, 3600),
    });
  }
  throw new HttpError(404, 'Authentication route not found.');
}
