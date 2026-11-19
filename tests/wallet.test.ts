import { beforeEach, expect, it, vi } from 'vitest';
import type { SiteConfig } from '../src/shared/model';

const state = vi.hoisted(() => ({
  active: undefined as any,
  permissionRequests: [] as any[],
  clears: 0,
  disconnects: 0,
  batches: 0,
  constructions: 0,
  network: undefined as any,
}));
vi.mock('@taquito/beacon-wallet', () => ({
  BeaconWallet: class {
    constructor(options: any) {
      state.constructions++;
      state.network = options.network;
    }
    client = {
      getActiveAccount: async () => state.active,
      requestSignPayload: vi.fn(async () => ({ signature: 'buyer-signature' })),
    };
    async clearActiveAccount() {
      state.clears++;
      state.active = undefined;
    }
    async requestPermissions(request: any) {
      state.permissionRequests.push(request);
      state.active = { address: 'buyer', network: state.network };
    }
    async getPKH() {
      return state.active.address;
    }
    async getPK() {
      return 'buyer-public-key';
    }
    async disconnect() {
      state.disconnects++;
      state.active = undefined;
    }
  },
}));
vi.mock('@taquito/taquito', () => ({
  TezosToolkit: class {
    rpc = { getChainId: async () => 'NetTest' };
    setWalletProvider() {}
    wallet = {
      batch: () => {
        state.batches++;
        throw new Error('Unexpected transaction');
      },
    };
  },
}));
vi.mock('../src/client/api', () => ({ api: vi.fn(), inventoryApi: vi.fn() }));
import { api } from '../src/client/api';
import { connect, login, disconnect, send } from '../src/client/wallet';
const config = {
  ready: true,
  name: 'Test shop',
  chainId: 'NetTest',
  rpc: 'http://localhost:8732',
  contract: 'KT1test',
  artist: 'artist',
} as SiteConfig;
beforeEach(() => {
  vi.mocked(api).mockImplementation(async (path: string) => {
    if (path === '/api/auth/challenge') return { id: 'challenge', payload: '0501' } as any;
    if (path === '/api/auth/verify') return { address: 'buyer', role: 'buyer' } as any;
    if (path === '/api/session') return { address: 'artist' } as any;
    return {} as any;
  });
  state.permissionRequests = [];
  state.clears = 0;
  state.batches = 0;
});
it('clears a persisted Beacon account on logout even before the wallet module has connected', async () => {
  state.active = { address: 'artist', network: { rpcUrl: config.rpc } };
  const before = state.disconnects;
  await disconnect();
  expect(state.disconnects).toBe(before + 1);
  expect(state.active).toBeUndefined();
});
it('asks the wallet to choose an account again instead of signing in with the cached artist', async () => {
  state.active = { address: 'artist', network: { rpcUrl: config.rpc } };
  expect((await connect(config)).address).toBe('artist');
  await login(config, 'buyer');
  expect(state.clears).toBe(1);
  expect(state.permissionRequests).toHaveLength(1);
  expect(state.network).toEqual({
    type: 'custom',
    name: config.chainId,
    rpcUrl: config.rpc,
  });
  expect(api).toHaveBeenCalledWith('/api/auth/challenge', { address: 'buyer', role: 'buyer' });
});
it('prevents a transaction from using a different account than the site session', async () => {
  state.active = { address: 'buyer', network: { rpcUrl: config.rpc } };
  await expect(send(config, [], () => {})).rejects.toThrow('differs from your site sign-in');
  expect(state.batches).toBe(0);
});
