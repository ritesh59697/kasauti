#!/usr/bin/env bash
# Deploys Kasauti to Base with one of your Foundry keystore accounts, verifies it on Sourcify,
# and records the address for the frontend. Your password goes to forge only.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a

accounts=($(cast wallet list 2>/dev/null | awk '{print $1}'))
[ ${#accounts[@]} -gt 0 ] || { echo "No Foundry keystore accounts found (cast wallet import <name> --interactive)."; exit 1; }
echo "Which account signs the deploy?"
select ACCOUNT in "${accounts[@]}"; do [ -n "${ACCOUNT:-}" ] && break; done

cd contracts
forge script script/Deploy.s.sol --rpc-url base --account "$ACCOUNT" --broadcast \
  --verify --verifier sourcify
cd ..
node scripts/record-deploy.mjs
