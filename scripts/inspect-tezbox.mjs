import { loadSite } from '../configuration/site.ts';
import { readFileSync } from 'node:fs';
import { Parser } from '@taquito/michel-codec';
const rpc = process.env.TEZBOX_RPC ?? loadSite('local-dev').rpc;
const get = async (path) => {
  const r = await fetch(rpc + path);
  if (!r.ok) throw new Error(`RPC ${r.status}: ${path}`);
  return r.json();
};
const parameter = JSON.parse(
  readFileSync(new URL('../src/chain/parameter-schema.json', import.meta.url), 'utf8'),
);
const contracts = await get('/chains/main/blocks/head/context/contracts');
let compiled;
try {
  compiled = new Parser().parseScript(
    readFileSync(new URL('../../contracts/gam/out/gam.tz', import.meta.url), 'utf8'),
  );
} catch {}
const stable = (v) =>
  JSON.stringify(v, (_k, x) =>
    x && typeof x === 'object' && !Array.isArray(x)
      ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b)))
      : x,
  );
const matches = [];
for (const address of contracts.filter((a) => a.startsWith('KT1'))) {
  const script = await get(`/chains/main/blocks/head/context/contracts/${address}/script`);
  if (stable(script.code.find((v) => v.prim === 'parameter')?.args[0]) === stable(parameter)) {
    matches.push({
      address,
      exactCode: compiled ? stable(compiled) === stable(script.code) : null,
      storage: script.storage,
    });
  }
}
console.log(JSON.stringify({ rpc, chainId: await get('/chains/main/chain_id'), matches }, null, 2));
