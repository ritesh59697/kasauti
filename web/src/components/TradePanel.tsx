import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount, useChainId, useReadContract, useSwitchChain, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { base } from "wagmi/chains";
import {
  BaseError,
  ContractFunctionRevertedError,
  decodeEventLog,
  erc20Abi,
  formatUnits,
  parseUnits,
  type Address,
  type Hash,
} from "viem";
import { CircleAlert, Clock, ExternalLink, Loader2, ShieldX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Touchstone } from "./Touchstone";
import { Hallmark } from "./Brand";
import { ageLabel, client, quoteOut, type Config, type Row } from "@/lib/touchstone";
import { badForSide, judge, pct, usd, type Policy, type Side, type Verdict } from "@/lib/verdict";
import { kasautiAbi } from "@/lib/kasautiAbi";
import { env } from "@/lib/env";
import { cn } from "@/lib/utils";
import { StockIcon } from "./StockIcon";

const BAND_PRESETS = [25, 50, 100];

function useDebounced<T>(v: T, ms: number) {
  const [d, setD] = useState(v);
  useEffect(() => {
    const t = setTimeout(() => setD(v), ms);
    return () => clearTimeout(t);
  }, [v, ms]);
  return d;
}

export function verdictText(v: Verdict, ageSec: number): string {
  if (v.kind === "fill")
    return `Fills ${pct(v.gapBps)} from the touchstone, inside your ${(v.bandBps / 100).toFixed(2)}% band${v.closed ? " (frozen-price band)" : ""}.`;
  switch (v.reason) {
    case "paused":
      return "Refused: Coinbase has paused this stock's reference, usually for a corporate action.";
    case "stale":
      return `Refused: the touchstone is ${ageLabel(0, ageSec)} old, so markets are likely closed. Allow frozen-price trading to use its own band.`;
    case "above":
      return `Refused: you would pay ${pct(v.gapBps)} above the touchstone. Your band is ${(v.bandBps / 100).toFixed(2)}%.`;
    case "below":
      return `Refused: you would receive ${pct(v.gapBps)} below the touchstone. Your band is ${(v.bandBps / 100).toFixed(2)}%.`;
  }
}

export function TradePanel({
  cfg,
  row,
  now,
  side,
  setSide,
  bandBps,
  setBandBps,
}: {
  cfg: Config;
  row?: Row;
  now: number;
  side: Side;
  setSide: (s: Side) => void;
  bandBps: number;
  setBandBps: (n: number) => void;
}) {
  const { address: account, isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChain, isPending: switching } = useSwitchChain();

  const [amountStr, setAmountStr] = useState("5");
  const [maxAgeMin, setMaxAgeMin] = useState(env.defaults.maxAgeMin);
  const [allowClosed, setAllowClosed] = useState(false);
  const [closedBandBps, setClosedBandBps] = useState(env.defaults.closedBandBps);
  const [eligible, setEligibleState] = useState(() => {
    try {
      return localStorage.getItem("kasauti:eligible") === "yes";
    } catch {
      return false;
    }
  });
  const setEligible = (v: boolean) => {
    setEligibleState(v);
    try {
      localStorage.setItem("kasauti:eligible", v ? "yes" : "no");
    } catch {
      /* storage unavailable: the choice lasts for this visit only */
    }
  };

  const stock = row?.stock;
  const pool = row?.pools[0]?.pool;
  const tokenIn = (side === "buy" ? cfg.quote.address : stock?.address) as Address | undefined;
  const tokenOut = (side === "buy" ? stock?.address : cfg.quote.address) as Address | undefined;
  const inDec = side === "buy" ? cfg.quote.decimals : stock?.decimals ?? 18;
  const outDec = side === "buy" ? stock?.decimals ?? 18 : cfg.quote.decimals;
  const inSym = side === "buy" ? cfg.quote.symbol : stock?.symbol ?? "";
  const outSym = side === "buy" ? stock?.symbol ?? "" : cfg.quote.symbol;

  const amountIn = useMemo(() => {
    try {
      const v = parseUnits(amountStr || "0", inDec);
      return v > 0n ? v : undefined;
    } catch {
      return undefined;
    }
  }, [amountStr, inDec]);
  const debAmount = useDebounced(amountIn, 300);

  const quote = useQuery({
    queryKey: ["quote", pool?.address, tokenIn, debAmount?.toString()],
    enabled: !!pool && !!tokenIn && !!debAmount,
    queryFn: () => quoteOut(cfg, pool!.address, tokenIn!, debAmount!),
    refetchInterval: 15_000,
  });

  const policy: Policy = {
    maxGapBps: bandBps,
    maxAgeSec: Math.round(maxAgeMin * 60),
    allowClosedMarket: allowClosed,
    closedGapBps: closedBandBps,
  };

  const preview = useMemo(() => {
    if (!row || !debAmount || quote.data === undefined || quote.data === 0n) return undefined;
    const inAmt = Number(formatUnits(debAmount, inDec));
    const outAmt = Number(formatUnits(quote.data, outDec));
    const price = side === "buy" ? (inAmt * row.quoteUsd) / outAmt : (outAmt * row.quoteUsd) / inAmt;
    const ageSec = now - row.updatedAt;
    return { price, outAmt, ageSec, verdict: judge({ side, reference: row.reference, price, ageSec, paused: row.paused, policy }) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row, debAmount, quote.data, side, now, bandBps, maxAgeMin, allowClosed, closedBandBps]);

  // ---- wallet state
  const balance = useReadContract({
    address: tokenIn,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: account ? [account] : undefined,
    query: { enabled: !!account && !!tokenIn },
  });
  const allowance = useReadContract({
    address: tokenIn,
    abi: erc20Abi,
    functionName: "allowance",
    args: account && env.kasauti ? [account, env.kasauti] : undefined,
    query: { enabled: !!account && !!tokenIn && !!env.kasauti },
  });

  const { writeContractAsync, isPending: signing } = useWriteContract();
  const [approveHash, setApproveHash] = useState<Hash>();
  const [tradeHash, setTradeHash] = useState<Hash>();
  const [sentArgs, setSentArgs] = useState<readonly unknown[]>();
  const [actionErr, setActionErr] = useState<string>();
  const approveRcpt = useWaitForTransactionReceipt({ hash: approveHash });
  useEffect(() => {
    if (approveRcpt.isSuccess) allowance.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [approveRcpt.isSuccess]);

  const needsApproval = !!amountIn && allowance.data !== undefined && allowance.data < amountIn;
  const insufficient = !!amountIn && balance.data !== undefined && balance.data < amountIn;

  async function approve() {
    if (!tokenIn || !env.kasauti || !amountIn) return;
    setActionErr(undefined);
    try {
      setApproveHash(await writeContractAsync({ address: tokenIn, abi: erc20Abi, functionName: "approve", args: [env.kasauti, amountIn] }));
    } catch (e) {
      setActionErr(shortErr(e));
    }
  }

  async function trade(force: boolean) {
    if (!env.kasauti || !pool || !tokenIn || !tokenOut || !amountIn || !quote.data || !account) return;
    setActionErr(undefined);
    setTradeHash(undefined);
    // A forced send exists to record the touchstone refusal, so it sets no slippage floor: otherwise any
    // tick against the quote reverts with Slippage first and hides the refusal. The touchstone check
    // still bounds the price, so a forced send can only fill inside the band.
    const minOut = force ? 0n : (quote.data * BigInt(10_000 - Math.min(bandBps, 10_000))) / 10_000n;
    const args = [pool.address, tokenIn, tokenOut, amountIn, minOut, policy] as const;
    try {
      let gas: bigint | undefined;
      if (force) {
        // A refused trade can't be gas-estimated (it reverts). Size gas from the same trade under a permissive policy.
        const loose: Policy = { maxGapBps: 10_000, maxAgeSec: 2 ** 32 - 1, allowClosedMarket: true, closedGapBps: 10_000 };
        const est = await client.estimateContractGas({
          address: env.kasauti,
          abi: kasautiAbi,
          functionName: "guardedSwap",
          args: [pool.address, tokenIn, tokenOut, amountIn, 0n, loose],
          account,
        });
        gas = (est * 13n) / 10n;
      }
      setSentArgs(args);
      setTradeHash(await writeContractAsync({ address: env.kasauti, abi: kasautiAbi, functionName: "guardedSwap", args, gas }));
    } catch (e) {
      setActionErr(shortErr(e));
    }
  }

  const refused = preview?.verdict.kind === "refuse";
  const stamp = preview ? stampText(preview.verdict) : undefined;

  return (
    <section aria-labelledby="trade-h" className="rounded-2xl border border-border bg-card shadow-[var(--k-card-shadow)]">
      <div className="flex items-center justify-between gap-3 p-5">
        <div className="flex items-center gap-3">
          {stock && <StockIcon stock={stock} size={36} />}
          <div className="grid">
            <h2 id="trade-h" className="text-lg font-medium">
              {stock ? stock.symbol : "Pick a stock"}
            </h2>
            {stock && <span className="text-xs text-muted-foreground">{stock.name.replace(/ \(.*\)$/, "")}</span>}
          </div>
        </div>
        <Tabs value={side} onValueChange={(v) => setSide(v as Side)}>
          <TabsList>
            <TabsTrigger value="buy">Buy</TabsTrigger>
            <TabsTrigger value="sell">Sell</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="grid gap-5 border-t border-border p-5">
        <div className="grid gap-2">
          <div className="flex items-baseline justify-between">
            <Label htmlFor="amt">You pay</Label>
            {balance.data !== undefined && (
              <button type="button" className="num rounded-sm text-xs text-muted-foreground underline-offset-2 hover:underline" onClick={() => setAmountStr(formatUnits(balance.data!, inDec))}>
                Balance {Number(formatUnits(balance.data, inDec)).toLocaleString("en-US", { maximumFractionDigits: 6 })}
              </button>
            )}
          </div>
          <div className="relative">
            <Input id="amt" inputMode="decimal" value={amountStr} onChange={(e) => setAmountStr(e.target.value.replace(/[^0-9.]/g, ""))} className="num h-12 pr-20 text-lg" />
            <span className="num pointer-events-none absolute top-1/2 right-4 -translate-y-1/2 text-sm text-muted-foreground">{inSym}</span>
          </div>
        </div>

        <fieldset className="grid gap-2">
          <legend className="mb-2 text-sm font-medium">Refuse beyond this gap from the touchstone</legend>
          <div className="flex items-center gap-2">
            {BAND_PRESETS.map((b) => (
              <Button
                key={b}
                type="button"
                variant="ghost"
                onClick={() => setBandBps(b)}
                aria-pressed={bandBps === b}
                className={cn("num h-8 border px-2.5 sm:px-3", bandBps === b ? "border-[var(--k-border-strong)] bg-surface-2 text-foreground" : "border-border text-secondary-text")}
              >
                {(b / 100).toFixed(2)}%
              </Button>
            ))}
            <div className="ml-auto flex items-center gap-2">
              <Input aria-label="Custom band in basis points" inputMode="numeric" value={bandBps} onChange={(e) => setBandBps(Math.min(10_000, Number(e.target.value.replace(/\D/g, "")) || 0))} className="num h-8 w-16 text-right" />
              <span className="text-xs text-muted-foreground">bps</span>
            </div>
          </div>
        </fieldset>
      </div>

      <div className="grid gap-3 border-t border-border p-5">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="age" className="font-normal text-secondary-text">
            Treat the touchstone as frozen after
          </Label>
          <div className="flex items-center gap-2">
            <Input id="age" inputMode="numeric" value={maxAgeMin} onChange={(e) => setMaxAgeMin(Number(e.target.value.replace(/\D/g, "")) || 0)} className="num h-8 w-20 text-right" />
            <span className="w-6 text-xs text-muted-foreground">min</span>
          </div>
        </div>
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="closed" className="font-normal text-secondary-text">
            Allow trading on a frozen touchstone
          </Label>
          <Switch id="closed" checked={allowClosed} onCheckedChange={setAllowClosed} />
        </div>
        {allowClosed && (
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="cband" className="font-normal text-secondary-text">
              Band while frozen
            </Label>
            <div className="flex items-center gap-2">
              <Input id="cband" inputMode="numeric" value={closedBandBps} onChange={(e) => setClosedBandBps(Math.min(10_000, Number(e.target.value.replace(/\D/g, "")) || 0))} className="num h-8 w-20 text-right" />
              <span className="w-6 text-xs text-muted-foreground">bps</span>
            </div>
          </div>
        )}
      </div>

      {/* preview: the moment */}
      <div className="grid gap-4 border-t border-border bg-deep p-5" aria-live="polite">
        {!row || !pool ? (
          <p className="text-sm text-muted-foreground">Pick a stock with a pool from the board</p>
        ) : quote.isError ? (
          <p className="text-sm text-refuse">Aero could not quote this size</p>
        ) : !preview ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="animate-spin" size={16} aria-hidden /> Quoting on Aero…
          </p>
        ) : (
          <>
            <dl className="grid grid-cols-3 gap-4">
              <div className="grid gap-1">
                <dt className="text-xs text-muted-foreground">Touchstone</dt>
                <dd className="num text-base text-gold">{usd(row.reference)}</dd>
                <dd className="num text-xs text-muted-foreground">{ageLabel(row.updatedAt, now)} old</dd>
              </div>
              <div className="grid gap-1">
                <dt className="text-xs text-muted-foreground">Expected fill</dt>
                <dd className="num text-base">{usd(preview.price)}</dd>
                <dd className="num truncate text-xs text-muted-foreground">
                  {preview.outAmt.toLocaleString("en-US", { maximumFractionDigits: 6 })} {outSym}
                </dd>
              </div>
              <div className="grid gap-1 text-right">
                <dt className="text-xs text-muted-foreground">Gap</dt>
                <dd className={cn("num text-base", badForSide(side, preview.verdict.gapBps, preview.verdict.bandBps) ? "text-refuse" : "text-foreground")}>{pct(preview.verdict.gapBps)}</dd>
                <dd className="text-xs text-muted-foreground">Aero quote</dd>
              </div>
            </dl>
            <Touchstone
              variant="trade"
              title={`Expected fill ${pct(preview.verdict.gapBps)} against the touchstone; refused beyond ${pct(side === "buy" ? preview.verdict.bandBps : -preview.verdict.bandBps)}`}
              rows={[{ key: "fill", label: stock?.symbol ?? "", gapBps: preview.verdict.gapBps, bad: badForSide(side, preview.verdict.gapBps, preview.verdict.bandBps) }]}
              bandBps={preview.verdict.bandBps}
              side={side}
              reference={`touchstone ${usd(row.reference)}`}
            />
            <div className="grid gap-3">
              {stamp && <Hallmark kind={refused ? "refuse" : "fill"} className="justify-self-start">{stamp}</Hallmark>}
              <p className="text-sm text-secondary-text">{verdictText(preview.verdict, preview.ageSec)}</p>
            </div>
          </>
        )}
      </div>

      <div className="grid gap-4 border-t border-border p-5">
        {/* eligibility: the contest excludes trading for U.S. users, and Coinbase stock tokens are for non-U.S. persons */}
        <label htmlFor="elig" className="flex cursor-pointer items-start gap-3 text-xs text-muted-foreground">
          <Checkbox id="elig" checked={eligible} onCheckedChange={(v) => setEligible(v === true)} className="mt-0.5" />
          <span>
            I am not a U.S. person, not in a sanctioned region, and allowed to hold tokenized stocks where I live. I understand prices
            can move and Kasauti is a tool, not advice.
          </span>
        </label>

        <div className="grid gap-2">
          {!env.kasauti ? (
            <Button disabled variant="secondary" className="h-11">
              <Clock size={16} aria-hidden /> Contract deploy pending: preview only
            </Button>
          ) : !eligible ? (
            <Button disabled variant="secondary" className="h-11">
              Confirm eligibility to trade
            </Button>
          ) : !isConnected ? (
            <ConnectButton.Custom>
              {({ openConnectModal }) => (
                <Button className="h-11" onClick={openConnectModal}>
                  Connect wallet
                </Button>
              )}
            </ConnectButton.Custom>
          ) : chainId !== base.id ? (
            <Button className="h-11" onClick={() => switchChain({ chainId: base.id })} disabled={switching}>
              {switching ? "Switching…" : "Switch to Base"}
            </Button>
          ) : insufficient ? (
            <Button disabled variant="secondary" className="h-11">
              Not enough {inSym}
            </Button>
          ) : needsApproval ? (
            <Button className="h-11" onClick={approve} disabled={signing || approveRcpt.isLoading}>
              {approveRcpt.isLoading ? "Approving…" : `Approve ${inSym}`}
            </Button>
          ) : refused ? (
            <>
              <Button disabled variant="secondary" className="h-11">
                <ShieldX size={16} aria-hidden /> Kasauti will refuse this trade
              </Button>
              <Button variant="ghost" className="h-9 text-secondary-text" onClick={() => trade(true)} disabled={signing || !preview}>
                Send anyway and record the refusal onchain
              </Button>
            </>
          ) : (
            <Button className="h-11" onClick={() => trade(false)} disabled={signing || !preview}>
              {signing ? "Confirm in wallet…" : `Trade with Kasauti`}
            </Button>
          )}
          {actionErr && (
            <p className="flex items-start gap-2 text-sm text-refuse">
              <CircleAlert size={16} className="mt-0.5 shrink-0" aria-hidden /> {actionErr}
            </p>
          )}
        </div>

        {tradeHash && row && <Receipt hash={tradeHash} args={sentArgs} row={row} side={side} />}
      </div>
    </section>
  );
}

function stampText(v: Verdict): string {
  if (v.kind === "fill") return `Fills ${pct(v.gapBps)}`;
  if (v.reason === "stale") return "Refused · frozen";
  if (v.reason === "paused") return "Refused · paused";
  return `Refused ${pct(v.gapBps)}`;
}

function Receipt({ hash, args, row, side }: { hash: Hash; args?: readonly unknown[]; row: Row; side: Side }) {
  // Not wagmi's useWaitForTransactionReceipt: it throws on a reverted transaction, so a refusal would never
  // render. viem's waitForTransactionReceipt returns the receipt with status "reverted" instead.
  const rcpt = useQuery({
    queryKey: ["receipt", hash],
    queryFn: () => client.waitForTransactionReceipt({ hash }),
    staleTime: Infinity,
    retry: 3,
  });
  const { address: account } = useAccount();

  const reason = useQuery({
    queryKey: ["revert", hash],
    enabled: rcpt.data?.status === "reverted" && !!args && !!env.kasauti,
    queryFn: async () => {
      try {
        await client.simulateContract({
          address: env.kasauti!,
          abi: kasautiAbi,
          functionName: "guardedSwap",
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          args: args as any,
          account,
          blockNumber: rcpt.data!.blockNumber - 1n,
        });
        return "Reverted (no reason could be recovered).";
      } catch (e) {
        if (e instanceof BaseError) {
          const r = e.walk((x) => x instanceof ContractFunctionRevertedError);
          if (r instanceof ContractFunctionRevertedError && r.data) {
            const a = r.data.args ?? [];
            switch (r.data.errorName) {
              case "AboveTouchstone":
                return `AboveTouchstone: you would have paid ${pct(Number(a[0]))} over the touchstone.`;
              case "BelowTouchstone":
                return `BelowTouchstone: you would have received ${pct(-Number(a[0]))} under the touchstone.`;
              case "StaleTouchstone":
                return `StaleTouchstone: the reference was ${ageLabel(0, Number(a[1]))} old.`;
              case "TouchstonePaused":
                return "TouchstonePaused: Coinbase has paused this stock's reference.";
              default:
                return `${r.data.errorName}.`;
            }
          }
        }
        return shortErr(e);
      }
    },
  });

  const fill = useMemo(() => {
    if (rcpt.data?.status !== "success") return undefined;
    for (const log of rcpt.data.logs) {
      try {
        const ev = decodeEventLog({ abi: kasautiAbi, data: log.data, topics: log.topics });
        if (ev.eventName === "GuardedSwap") return ev.args;
      } catch {
        /* other contracts' logs */
      }
    }
  }, [rcpt.data]);

  const link = `${env.explorer}/tx/${hash}`;
  return (
    <div className="grid gap-3 rounded-xl border border-border p-4 text-sm" aria-live="polite">
      {rcpt.isError && <p className="text-muted-foreground">Couldn't read the receipt: {shortErr(rcpt.error)}</p>}
      {rcpt.isLoading && (
        <p className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="animate-spin" size={16} aria-hidden /> Waiting for Base…
        </p>
      )}
      {rcpt.data?.status === "success" && fill && (
        <>
          <Hallmark kind="fill" className="justify-self-start">
            Filled {pct(Number(fill.gapBps))}
          </Hallmark>
          <p className="text-secondary-text">
            {side === "buy" ? "Bought" : "Sold"} {row.stock.symbol} at {usd(Number(fill.realizedE18) / 1e18)} against a touchstone of{" "}
            {usd(Number(fill.referenceE18) / 1e18)}
            {fill.closedMarket ? ", on the frozen-price band" : ""}.
          </p>
        </>
      )}
      {rcpt.data?.status === "reverted" && (
        <>
          <Hallmark kind="refuse" className="justify-self-start">
            Refused onchain
          </Hallmark>
          <p className="text-secondary-text">{reason.data ?? "Reading the reason…"}</p>
        </>
      )}
      <a className="inline-flex items-center gap-1.5 justify-self-start rounded-sm text-muted-foreground underline-offset-2 hover:underline" href={link} target="_blank" rel="noreferrer">
        View on {new URL(env.explorer).hostname} <ExternalLink size={14} aria-hidden />
      </a>
    </div>
  );
}

function shortErr(e: unknown): string {
  if (e instanceof BaseError) return e.shortMessage;
  return e instanceof Error ? e.message : String(e);
}
