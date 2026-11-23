# Kasauti

**Tokenized stock trades that refuse an unfair price.**

Kasauti (कसौटी) is the black touchstone a jeweller rubs gold on to test it. This contract does the same for Coinbase's tokenized stocks on Base. It swaps a stock token on an Aero pool, measures the price you actually got, and checks it against that stock's Chainlink reference price. If the fill is outside the band you set, or the reference is frozen, paused or missing, the whole trade reverts and nothing changes hands.

**The check is the trade.** It isn't a warning shown before you sign: the swap contract itself measures the fill against Chainlink's official total-return reference for Coinbase's B20 stocks, and reverts onchain if the price is off, the reference is stale because markets are shut, or Coinbase has paused it. Any app, wallet or agent that calls it gets the same refusal.

Built for **Base Stocks Maxxing Season**, *Programmable Stock Markets* track.

## Judges: start here

| | |
|---|---|
| **Live app** | https://kasauti-base.vercel.app (landing) · https://kasauti-base.vercel.app/app (trade) |
| **Contract** | [`0xDAc4c41BB3dBbCCD7d4b8724316a64DC2B56FcC8`](https://base.blockscout.com/address/0xDAc4c41BB3dBbCCD7d4b8724316a64DC2B56FcC8?tab=contract) on Base mainnet |
| **Source** | Verified, exact match: [Sourcify](https://repo.sourcify.dev/8453/0xDAc4c41BB3dBbCCD7d4b8724316a64DC2B56FcC8) · [Blockscout](https://base.blockscout.com/address/0xDAc4c41BB3dBbCCD7d4b8724316a64DC2B56FcC8?tab=contract) |
| **Deploy tx** | [`0x86ea9208…`](https://base.blockscout.com/tx/0x86ea9208cfa8eaf5f4b426e830934b958db2189300f1a98589cb9a6a6c4cfc84), block 58058089 |
| **Tests** | 15 tests on a Base mainnet fork, against the real stock tokens, feeds and pools ([how to run](#run-the-tests)) |
| **Mainnet-state run** | The deployed contract, run against Base mainnet at block 61303083 with no money moved: the app's default policy refused a buy on a stale reference (`StaleTouchstone`), a buy and a sell filled inside the 0.50% band, and a zero-band buy was refused (`AboveTouchstone`, +0.10%). Saved in [`evidence/dry-run-61303083.json`](evidence/dry-run-61303083.json); rerun with `npm run evidence` |
| **Video** | *link added at submission* |

**What to look at, in two minutes**
1. Open the app. The board reads every priced stock token live: Chainlink reference, its age, Coinbase's pause flag, the Aero pool price and the gap between them.
2. Pick a stock, set a tight band (0.25%), and watch the preview say *Refused*. Switch Buy to Sell and the refusal side moves to the other edge of the stone.
3. On a weekend or overnight, the references freeze. Kasauti refuses by default and fills only if you opt in to a wider closed-market band.
4. Read [`contracts/src/Kasauti.sol`](contracts/src/Kasauti.sol): about 300 lines, one external trade function.

### Claims you can check

| Claim | Code | Test |
|---|---|---|
| A buy that fills above the reference by more than your band reverts | [`Kasauti.sol:249`](contracts/src/Kasauti.sol#L249) `AboveTouchstone` | `test_buy_refusedAboveTouchstone`, fuzzed in `testFuzz_buyNeverWorseThanBand` |
| A sell that fills below the reference by more than your band reverts | [`Kasauti.sol:253`](contracts/src/Kasauti.sol#L253) `BelowTouchstone` | `test_sell_refusedBelowTouchstone` |
| A stale reference (markets shut) refuses unless you opt in, and the opt-in has its own band | [`Kasauti.sol:229`](contracts/src/Kasauti.sol#L229) `StaleTouchstone` | `test_refusedWhenReferenceFrozen`, `test_closedMarketOptIn_usesItsOwnBand` |
| A reference Coinbase has paused refuses | [`Kasauti.sol:224`](contracts/src/Kasauti.sol#L224) `TouchstonePaused` | `test_refusedWhenPaused` |
| A stock with no Chainlink reference refuses | [`Kasauti.sol:223`](contracts/src/Kasauti.sol#L223) `NoTouchstone` | `test_refusedWithoutTouchstone` |
| Only USDC against a stock; no stock-to-stock | [`Kasauti.sol:218`](contracts/src/Kasauti.sol#L218) `UnsupportedPair` | `test_refusedStockToStock` |
| The pool must be the allowlisted Aero factory's real pool for the pair | [`Kasauti.sol:274`](contracts/src/Kasauti.sol#L274), [`:278`](contracts/src/Kasauti.sol#L278) | `test_refusedOnPoolFromUnlistedFactory`, `test_refusedOnWrongPoolForPair` |
| Only the pool being traded can pull your tokens | [`Kasauti.sol:264`](contracts/src/Kasauti.sol#L264) `NotPool` | `test_callbackOnlyFromActivePool` |
| A fill inside the band pays out | [`Kasauti.sol:197`](contracts/src/Kasauti.sol#L197) `guardedSwap` | `test_buy_fillsInsideBand`, `test_sell_roundTripFills` |

Every test runs on a fork of Base mainnet against the real stock tokens, Chainlink feeds and Aero pools, not mocks.

### Mainnet trades

*None yet.* A guarded fill and a recorded onchain refusal will be listed here with their transaction links.

## The problem

Coinbase's stock tokens trade on Aero pools around the clock. Their Chainlink reference prices update only while U.S. markets are open and freeze on nights, weekends and corporate actions. Base's own guide says to *"never settle or liquidate against a frozen feed"*, but a plain swap has no idea what the reference is.

On Saturday 14 November 2026, 22:20 IST, the MSTRc pool traded **6.40% below** its frozen reference. CRCLc was 4.1% below, INTCc 2.5%. A seller using a plain swap would take that gap as a loss.

## How a trade is checked

`guardedSwap(pool, tokenIn, tokenOut, amountIn, minOut, policy)` runs these checks in order:

1. **Pair.** One side must be the priced quote token (USDC); the other is the stock. Anything else: `UnsupportedPair`.
2. **Touchstone.** Reads the stock's Chainlink total-return feed (multiplier already included) and Coinbase's oracle registry pause flag. No feed: `NoTouchstone`. Paused: `TouchstonePaused`.
3. **Freshness.** If the reference is older than `policy.maxAgeSec`, the trade refuses with `StaleTouchstone`, unless the caller set `allowClosedMarket`, which switches to the separate `closedGapBps` band.
4. **Pool.** The pool must come from an allowlisted Aero CL factory and be that factory's real pool for the pair (`PoolNotAllowed`, `PoolMismatch`).
5. **Swap and measure.** Swaps, then measures what actually moved: tokens paid in the callback and tokens received by balance change. `minOut` is enforced (`Slippage`).
6. **Judge.** Realized USD price per whole stock token against the reference. A buy above `reference × (1 + band)` reverts with `AboveTouchstone(gapBps, paid, reference)`. A sell below `reference × (1 − band)` reverts with `BelowTouchstone(...)`. Otherwise it pays out and emits `GuardedSwap` with the realized gap.

The band and freshness limits come from the caller. The contract stores only wiring (which feeds, which factories), never trade limits, and takes no fee.

```ts
// Calling it from an app or agent with viem
await walletClient.writeContract({
  address: KASAUTI,
  abi: kasautiAbi,                       // web/src/lib/kasautiAbi.ts
  functionName: "guardedSwap",
  args: [pool, USDC, stock, amountIn, minOut, {
    maxGapBps: 50,                       // refuse a fill more than 0.50% off the reference
    maxAgeSec: 3600,                     // a reference older than an hour counts as frozen
    allowClosedMarket: false,            // and a frozen reference refuses the trade
    closedGapBps: 150,                   // band used only if allowClosedMarket is true
  }],
});
```

Approve the exact `amountIn` to the Kasauti address first.

## What's in the repo

| Path | What it is |
|---|---|
| `contracts/src/Kasauti.sol` | The guarded swap |
| `contracts/test/Kasauti.fork.t.sol` | Fork tests against Base mainnet |
| `contracts/script/Deploy.s.sol` | One-transaction deploy, wiring read from config |
| `scripts/sync-config.mjs` | Builds `config/base.json` from live sources: Coinbase's tokenized-stocks API, Chainlink's feed directory and Aero's deployment file. Every pool is checked onchain against its factory. No addresses are written by hand. |
| `config/base.json` | The generated wiring: 12 priced stocks of 358 listed, their feeds and pools |
| `deployments/8453.json` | The deployed address, owner, tx and block |
| `contracts/script/Evidence.s.sol`, `evidence/` | Simulated trades against the deployed contract on live mainnet state, and their saved results |
| `web/` | Vite + React app: landing page, touchstone board, guarded trade panel, receipt |

## Run the tests

Needs Node 20+ and **Foundry 1.8.4 or later**. The stock tokens are Base native precompiles, so the fork needs `hardfork = "base:Cobalt"` (set in `contracts/foundry.toml`), which older Foundry versions don't have.

```bash
git clone --recurse-submodules https://github.com/ritesh59697/kasauti.git
cd kasauti
cp .env.example .env
npm run test:contracts
```

`.env.example` holds only public endpoints; the public Base RPC is enough for the fork.

To run the **deployed** contract against today's Base mainnet state, with nothing broadcast:

```bash
npm run evidence    # writes evidence/dry-run-<block>.json and evidence/latest.json
```

It uses the address in `deployments/8453.json`, the app's default policy from `web/.env` (or `web/.env.example`) and the trade size in `EVIDENCE_AMOUNT_USDC`.

```
[PASS] testFuzz_buyNeverWorseThanBand(uint256,uint16)
[PASS] test_buy_fillsInsideBand()
[PASS] test_buy_refusedAboveTouchstone()
[PASS] test_callbackOnlyFromActivePool()
[PASS] test_closedMarketOptIn_usesItsOwnBand()
[PASS] test_onlyOwnerWires()
[PASS] test_refusedOnPoolFromUnlistedFactory()
[PASS] test_refusedOnWrongPoolForPair()
[PASS] test_refusedStockToStock()
[PASS] test_refusedWhenPaused()
[PASS] test_refusedWhenReferenceFrozen()
[PASS] test_refusedWithoutTouchstone()
[PASS] test_sell_refusedBelowTouchstone()
[PASS] test_sell_roundTripFills()
[PASS] test_slippageFloor()
```

## Run the app

```bash
cd web
cp .env.example .env      # set VITE_KASAUTI_ADDRESS to the deployed address above
npm install
npm run dev
```

The landing page is at `/` and the app at `/app`. The trade panel previews the verdict from a live Aero quote, using the same rules in the same order as the contract (`web/src/lib/verdict.ts`). The contract has the final say at execution.

## Trust and limits

- **Not audited.** Hackathon code. Trade small.
- **Owner powers.** One owner key can change which stock feeds, quote feed and pool factories count. Ownership moves in a single step. There is no pause, fee or trade limit.
- **Allowance.** The swap callback pulls whatever the pool asks for, up to your allowance. Pools are limited to the allowlisted Aero factory, and the app approves the exact amount for each trade. If you call the contract directly, do the same.
- **No sequencer-uptime check.** Kasauti doesn't read Chainlink's L2 sequencer feed. A stale reference still refuses on its own age.
- **Coverage.** Only stocks with a Chainlink reference can trade (12 of the 358 listed today), and only against USDC on Aero CL pools.
- **Realized price includes the pool fee and price impact.** That is the point: the band applies to what you actually pay.
- **Not for U.S. persons.** The app asks traders to confirm they are not U.S. persons or in a sanctioned region before trading. Kasauti is a tool, not investment advice, and is not affiliated with or endorsed by Base, Coinbase, Chainlink or Aero.

## Built during the season

Everything here was written during Stocks Maxxing Season, starting 14 November 2026: the contract, fork tests, config generator, deploy, landing page and app. The commit history shows the order.

## License

MIT
