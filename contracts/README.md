# Kasauti contracts

- `src/Kasauti.sol`: the guarded swap
- `test/Kasauti.fork.t.sol`: fork tests against Base mainnet
- `script/Deploy.s.sol`: one-transaction deploy, wiring read from `../config/base.json`

Run the tests from the repo root with `npm run test:contracts`. Needs Foundry 1.8.4 or later for `hardfork = "base:Cobalt"`. See the [root README](../README.md).
