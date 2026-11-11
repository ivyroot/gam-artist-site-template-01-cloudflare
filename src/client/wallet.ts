import type { SiteConfig } from '../shared/model';
import type { Transaction } from '../chain/parameters';
import { api } from './api';
import { NetworkType, SigningType, PermissionScope } from '@ecadlabs/beacon-types';
let wallet: import('@taquito/beacon-wallet').BeaconWallet | undefined;
let toolkit: import('@taquito/taquito').TezosToolkit | undefined;
let fingerprint = '';
export async function connect(c: SiteConfig) {
  if (!c.ready) throw new Error('Configure this deployment before connecting a wallet.');
  const key = [c.chainId, c.rpc, c.contract].join(':');
  if (wallet && fingerprint !== key) {
    await wallet.disconnect();
    wallet = undefined;
    toolkit = undefined;
  }
  const [{ BeaconWallet }, { TezosToolkit }] = await Promise.all([
    import('@taquito/beacon-wallet'),
    import('@taquito/taquito'),
  ]);
  const network = { type: NetworkType.CUSTOM, name: c.chainId, rpcUrl: c.rpc };
  if (!wallet) {
    wallet = new BeaconWallet({ name: c.name, network });
    fingerprint = key;
  }
  const account = await wallet.client.getActiveAccount();
  if (!account || account.network.rpcUrl !== c.rpc)
    await wallet.requestPermissions({
      scopes: [PermissionScope.SIGN, PermissionScope.OPERATION_REQUEST],
    });
  toolkit = new TezosToolkit(c.rpc);
  toolkit.setWalletProvider(wallet);
  if ((await toolkit.rpc.getChainId()) !== c.chainId)
    throw new Error('The RPC network differs from the configured chain.');
  return { wallet, toolkit, address: await wallet.getPKH() };
}
export async function login(c: SiteConfig, role: 'buyer' | 'admin' = 'buyer') {
  const { wallet, address } = await connect(c);
  const challenge = await api('/api/auth/challenge', { address, role });
  const result = await wallet.client.requestSignPayload({
    signingType: SigningType.MICHELINE,
    payload: challenge.payload,
    sourceAddress: address,
  });
  return api('/api/auth/verify', {
    id: challenge.id,
    publicKey: await wallet.getPK(),
    signature: result.signature,
  });
}
export async function send(
  c: SiteConfig,
  transactions: Transaction[],
  progress: (s: string) => void,
  artistOnly = false,
) {
  const { toolkit, address } = await connect(c);
  if (artistOnly && address !== c.artist) throw new Error('Choose the configured artist wallet.');
  progress('Approve the transaction in your wallet…');
  const op = await toolkit.wallet
    .batch(
      transactions.map((t) => ({
        kind: 'transaction' as import('@taquito/taquito').OpKind.TRANSACTION,
        to: c.contract,
        amount: Number(t.amount),
        mutez: true,
        parameter: { entrypoint: t.entrypoint, value: t.value },
      })),
    )
    .send();
  // Keep the submitted hash visible and recoverable even if confirmation polling fails.
  progress(`Submitted ${op.opHash}. Waiting for confirmation…`);
  if (artistOnly) await api('/api/admin/operation', { hash: op.opHash }).catch(() => {});
  await op.confirmation(2);
  progress(`Confirmed ${op.opHash}. Catalog updates after indexing.`);
  return op.opHash;
}
export async function disconnect() {
  await api('/api/auth/logout', {});
  if (wallet) await wallet.disconnect();
  wallet = undefined;
  toolkit = undefined;
}
