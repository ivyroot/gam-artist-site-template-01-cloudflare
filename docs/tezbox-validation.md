# Live TezBox validation

Validated November 10, 2026 (America/Chicago) against the already running local TezBox, without originating another contract.

- RPC: `http://localhost:8732`
- Chain ID: `NetXtJqPyJGB6Pc`
- Protocol: Ushuaia
- Contract tested: `KT19MWS86sukgSsRaMsgpN6EawvGkx6WNbtV`
- Discovery found six existing deployments with the current parameter type and exact full compiled code. This address had the newest big-map allocations among them.
- Result: **5 live integration tests passed**, alongside **24 fast runtime/ABI tests**.

## Reproduce

```sh
npm run inspect:tezbox
npm run test:tezbox
```

Override `TEZBOX_RPC` and `TEZBOX_GAM_ADDRESS` if the sandbox is restarted or a different deployment should be tested. Mutating tests require a loopback RPC host and use the sibling `tezbox/configuration/accounts.hjson` public sandbox Alice account to fund fresh temporary artist and buyer wallets. Private keys stay in test-process memory; they are not written into the template or logs. Each run creates separate artist records and consumes sandbox tez.

## What ran on the actual contract

1. Register an artist display name and website using the template's transaction builders.
2. Authenticate the artist with a genuine signed challenge, upload an original through Worker multipart endpoints into local R2, compute its SHA-256 on the server, and publish a listing with that exact hash. Check its actual emitted event in the catalog.
3. Buy two personal licenses, buy another at full price, verify the count is three, check the artist received the exact 3,000 mutez, and download the original through the Worker. Recompute the downloaded SHA-256 and compare it with the published hash.
4. Buy an independent commercial license, post a review after the block gate, close the listing, and verify the existing buyer can still download.
5. Create a collection-only work, buy a collection license, verify delivery through current membership, remove the member on-chain, and verify the Worker now denies that collection-derived download.

## Test transport and limits

The real Workers test runtime initially dropped a localhost RPC request during Taquito's concurrent estimation calls. The integration configuration uses a test-only Node service binding to relay HTTP requests unchanged to TezBox. It does not synthesize RPC responses. Chain views, balances, operations, signatures, confirmations, and block receipts all come from the running node.

There is no assumed local TzKT service. For this test, the catalog receives actual events decoded from the confirmed operation's block receipt. This validates event interpretation and the storefront/download pipeline, but does not independently validate the TzKT polling implementation against a running indexer.

Transactions are signed programmatically with the same raw Micheline builders used by the browser. Interactive Beacon pairing, mobile-wallet behavior, and actual Cloudflare resource provisioning remain separate acceptance checks.
