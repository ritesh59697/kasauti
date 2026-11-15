// Builds config/base.json from live sources. Nothing here is a hand-typed address:
// - stock tokens, decimals, multipliers: Coinbase Tokenized Stocks API
// - price feeds + heartbeats: Chainlink's public feed directory for Base
// - pool factory allowlist: Aero's own deployment file (dromos-labs)
// - candidate pools: DexScreener, then every pool is verified onchain against the allowlisted factory
import { createPublicClient, http, getAddress, parseAbi } from "viem";
import { base } from "viem/chains";
import { mkdirSync, writeFileSync } from "node:fs";

const env = (k) => {
  const v = process.env[k];
  if (!v) throw new Error(`Missing env ${k} (see .env.example)`);
  return v;
};

const client = createPublicClient({ chain: base, transport: http(env("BASE_RPC_URL")) });
const getJson = async (url) => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.json();
};

const erc20 = parseAbi(["function decimals() view returns (uint8)", "function symbol() view returns (string)"]);
const feedAbi = parseAbi([
  "function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)",
  "function description() view returns (string)",
  "function decimals() view returns (uint8)",
]);
const poolAbi = parseAbi([
  "function factory() view returns (address)",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function tickSpacing() view returns (int24)",
  "function fee() view returns (uint24)",
]);
const factoryAbi = parseAbi(["function getPool(address,address,int24) view returns (address)"]);
const registryAbi = parseAbi(["function getOracleParams(address) view returns (uint256 multiplier, bool paused)"]);

async function main() {
  const chainId = await client.getChainId();

  // 1. Tokens
  const api = env("TOKENIZED_STOCKS_API");
  const tokens = [];
  let pageToken;
  do {
    const page = await getJson(`${api}?page_size=500${pageToken ? `&page_token=${pageToken}` : ""}`);
    tokens.push(...page.tokens);
    pageToken = page.next_page_token;
  } while (pageToken);

  // 2. Feeds: Coinbase primary tokenized-price feeds, keyed by underlying ticker
  const dir = await getJson(env("CHAINLINK_DIRECTORY_URL"));
  const stockFeeds = new Map();
  for (const f of dir) {
    if (f.docs?.productTypeCode === "primaryTokenizedPrice" && !f.docs?.hidden && f.docs?.baseAsset) {
      stockFeeds.set(f.docs.baseAsset, f);
    }
  }

  // 3. Factory allowlist from Aero's deployment file
  const aero = await getJson(env("AERO_CL_DEPLOYMENT_URL"));
  const clFactories = [getAddress(aero.clFactory)];
  const quoter = getAddress(aero.metaquoter); // Aero's own quoter, used for previews only

  // 4. Quote token: resolved from pools (symbol from env), its USD feed from the directory
  const quoteSymbol = env("QUOTE_SYMBOL");
  const registry = getAddress(env("ORACLE_REGISTRY"));

  const stocks = [];
  let quote;
  for (const t of tokens) {
    const ticker = t.symbol.replace(/c$/, "");
    const feed = stockFeeds.get(ticker);
    if (!feed) continue;
    const address = getAddress(t.contract_address);
    const feedAddr = getAddress(feed.proxyAddress);

    const [decimals, feedDesc, feedDecimals, [multiplierWad, paused]] = await Promise.all([
      client.readContract({ address, abi: erc20, functionName: "decimals" }),
      client.readContract({ address: feedAddr, abi: feedAbi, functionName: "description" }),
      client.readContract({ address: feedAddr, abi: feedAbi, functionName: "decimals" }),
      client.readContract({ address: registry, abi: registryAbi, functionName: "getOracleParams", args: [address] }),
    ]);

    // Candidate pools, each verified onchain
    const ds = await getJson(`${env("DEXSCREENER_TOKEN_URL")}/${address}`);
    const pools = [];
    for (const p of ds.pairs ?? []) {
      if (!/^0x[0-9a-fA-F]{40}$/.test(p.pairAddress)) continue; // v4 pool ids are not contracts
      const other = getAddress(p.baseToken.address) === address ? p.quoteToken : p.baseToken;
      if (other.symbol !== quoteSymbol) continue;
      const pool = getAddress(p.pairAddress);
      try {
        const [factory, token0, token1, tickSpacing, fee] = await Promise.all(
          ["factory", "token0", "token1", "tickSpacing", "fee"].map((fn) =>
            client.readContract({ address: pool, abi: poolAbi, functionName: fn }),
          ),
        );
        if (!clFactories.includes(getAddress(factory))) continue;
        const canonical = await client.readContract({
          address: factory, abi: factoryAbi, functionName: "getPool", args: [token0, token1, tickSpacing],
        });
        if (getAddress(canonical) !== pool) continue;
        const quoteAddr = getAddress(token0) === address ? getAddress(token1) : getAddress(token0);
        if (!quote) quote = { symbol: quoteSymbol, address: quoteAddr };
        if (quoteAddr !== quote.address) continue;
        pools.push({
          address: pool, factory: getAddress(factory), tickSpacing: Number(tickSpacing), fee: Number(fee),
          liquidityUsd: Math.round(p.liquidity?.usd ?? 0),
        });
      } catch {
        // not a CL pool with this interface; skip
      }
    }
    pools.sort((a, b) => b.liquidityUsd - a.liquidityUsd);

    stocks.push({
      symbol: t.symbol, name: t.name, address, decimals: Number(decimals),
      multiplier: Number(multiplierWad) / 1e18, paused,
      feed: { address: feedAddr, description: feedDesc, decimals: Number(feedDecimals), heartbeat: feed.heartbeat },
      pools,
    });
  }
  if (!quote) throw new Error("No verified pools found; cannot resolve quote token");

  // Quote USD feed: non-hidden "<SYM> / USD" feeds; pick the one updated most recently onchain
  const candidates = dir.filter((f) => f.name === `${quoteSymbol} / USD` && !f.docs?.hidden);
  let best;
  for (const f of candidates) {
    const addr = getAddress(f.proxyAddress);
    const [, , , updatedAt] = await client.readContract({ address: addr, abi: feedAbi, functionName: "latestRoundData" });
    const dec = await client.readContract({ address: addr, abi: feedAbi, functionName: "decimals" });
    if (!best || updatedAt > best.updatedAt) best = { address: addr, decimals: Number(dec), heartbeat: f.heartbeat, updatedAt };
  }
  quote.decimals = Number(await client.readContract({ address: quote.address, abi: erc20, functionName: "decimals" }));
  quote.feed = { address: best.address, decimals: best.decimals, heartbeat: best.heartbeat };

  const out = {
    chainId,
    generatedAt: new Date().toISOString(),
    oracleRegistry: registry,
    clFactories,
    quoter,
    quote,
    stocks,
    totalTokensListed: tokens.length,
    unpricedTokens: tokens.length - stocks.length,
    unpricedExample: getAddress(tokens.find((t) => !stockFeeds.has(t.symbol.replace(/c$/, ""))).contract_address),
  };
  mkdirSync(new URL("../config", import.meta.url), { recursive: true });
  const json = JSON.stringify(out, null, 2) + "\n";
  writeFileSync(new URL("../config/base.json", import.meta.url), json);
  mkdirSync(new URL("../web/public", import.meta.url), { recursive: true });
  writeFileSync(new URL("../web/public/config.json", import.meta.url), json); // served to the frontend
  console.log(`config/base.json: ${stocks.length} priced stocks, ${out.unpricedTokens} unpriced, quote ${quote.symbol} ${quote.address}`);
  for (const s of stocks) console.log(`  ${s.symbol.padEnd(7)} pools=${s.pools.length} top=${s.pools[0]?.address ?? "-"} mult=${s.multiplier}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
