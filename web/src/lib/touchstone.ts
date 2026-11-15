import { createPublicClient, http, parseAbi, type Address } from "viem";
import { base } from "viem/chains";
import { env } from "./env";

export type Pool = { address: Address; factory: Address; tickSpacing: number; fee: number; liquidityUsd: number };
export type StockCfg = {
  symbol: string;
  name: string;
  address: Address;
  decimals: number;
  multiplier: number;
  feed: { address: Address; description: string; decimals: number; heartbeat: number };
  pools: Pool[];
};
export type Config = {
  chainId: number;
  generatedAt: string;
  oracleRegistry: Address;
  clFactories: Address[];
  quoter: Address;
  quote: { symbol: string; address: Address; decimals: number; feed: { address: Address; decimals: number; heartbeat: number } };
  stocks: StockCfg[];
  totalTokensListed: number;
  unpricedTokens: number;
};

export type Row = {
  stock: StockCfg;
  reference: number; // USD per token (total-return, multiplier-adjusted)
  updatedAt: number; // unix seconds
  paused: boolean;
  multiplier: number;
  quoteUsd: number;
  pools: { pool: Pool; priceUsd: number; gapBps: number }[];
};

// All reads in a tick are folded into Multicall3 calls, which keeps public RPC rate limits happy.
export const client = createPublicClient({
  chain: base,
  batch: { multicall: { wait: 16 } },
  transport: http(env.rpc, { retryCount: 3 }),
});

const feedAbi = parseAbi(["function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)"]);
const registryAbi = parseAbi(["function getOracleParams(address) view returns (uint256 multiplier, bool paused)"]);
const poolAbi = parseAbi([
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, bool)",
  "function token0() view returns (address)",
]);
const quoterAbi = parseAbi([
  "function quoteExactInputSingleV3(address pool, address tokenIn, uint256 amountIn, uint160 sqrtPriceLimitX96) view returns (uint256 amountOut, uint160 sqrtPriceAfter, uint32 ticksCrossed)",
]);

export async function loadConfig(): Promise<Config> {
  const r = await fetch("/config.json");
  if (!r.ok) throw new Error("config.json missing; run npm run sync-config");
  return r.json();
}

/** price of 1 whole stock token in quote units, from a CL pool's sqrtPriceX96 */
function poolPrice(sqrtPriceX96: bigint, stockIsToken0: boolean, stockDec: number, quoteDec: number): number {
  const p = (Number(sqrtPriceX96) / 2 ** 96) ** 2; // token1 raw per token0 raw
  const scale = 10 ** (stockDec - quoteDec);
  return stockIsToken0 ? p * scale : scale / p;
}

export async function readBoard(cfg: Config): Promise<Row[]> {
  const [, quoteAnswer] = await client.readContract({ address: cfg.quote.feed.address, abi: feedAbi, functionName: "latestRoundData" });
  const quoteUsd = Number(quoteAnswer) / 10 ** cfg.quote.feed.decimals;

  return Promise.all(
    cfg.stocks.map(async (stock) => {
      const [[, answer, , updatedAt], [multWad, paused]] = await Promise.all([
        client.readContract({ address: stock.feed.address, abi: feedAbi, functionName: "latestRoundData" }),
        client.readContract({ address: cfg.oracleRegistry, abi: registryAbi, functionName: "getOracleParams", args: [stock.address] }),
      ]);
      const reference = Number(answer) / 10 ** stock.feed.decimals;
      const pools = await Promise.all(
        stock.pools.map(async (pool) => {
          const [[sqrt], token0] = await Promise.all([
            client.readContract({ address: pool.address, abi: poolAbi, functionName: "slot0" }),
            client.readContract({ address: pool.address, abi: poolAbi, functionName: "token0" }),
          ]);
          const priceUsd = poolPrice(sqrt, token0.toLowerCase() === stock.address.toLowerCase(), stock.decimals, cfg.quote.decimals) * quoteUsd;
          return { pool, priceUsd, gapBps: ((priceUsd - reference) / reference) * 10_000 };
        }),
      );
      return { stock, reference, updatedAt: Number(updatedAt), paused, multiplier: Number(multWad) / 1e18, quoteUsd, pools };
    }),
  );
}

/** Expected output of an exact-input swap on one pool, from Aero's own quoter. Estimate only. */
export async function quoteOut(cfg: Config, pool: Address, tokenIn: Address, amountIn: bigint): Promise<bigint> {
  const [out] = await client.readContract({
    address: cfg.quoter,
    abi: quoterAbi,
    functionName: "quoteExactInputSingleV3",
    args: [pool, tokenIn, amountIn, 0n],
  });
  return out;
}

export function ageLabel(updatedAt: number, nowSec: number): string {
  const s = Math.max(0, nowSec - updatedAt);
  if (s < 90) return `${s}s`;
  if (s < 5400) return `${Math.round(s / 60)}m`;
  if (s < 172800) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}
