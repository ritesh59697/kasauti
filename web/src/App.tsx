import { useEffect, useState } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { Loader2 } from "lucide-react";
import { Board } from "@/components/Board";
import { TradePanel } from "@/components/TradePanel";
import { loadConfig, readBoard, type Config, type Row } from "@/lib/touchstone";
import type { Side } from "@/lib/verdict";
import { env } from "@/lib/env";

export default function App() {
  const [cfg, setCfg] = useState<Config>();
  const [rows, setRows] = useState<Row[]>();
  const [err, setErr] = useState<string>();
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const [selected, setSelected] = useState<string>();
  const [side, setSide] = useState<Side>("buy");
  const [bandBps, setBandBps] = useState(env.defaults.bandBps);

  useEffect(() => {
    let alive = true;
    let c: Config | undefined;
    const tick = async () => {
      try {
        c ??= await loadConfig();
        if (!alive) return;
        setCfg(c);
        const r = await readBoard(c);
        if (!alive) return;
        setRows(r);
        setNow(Math.floor(Date.now() / 1000));
        setSelected((s) => s ?? r.slice().sort((a, b) => (b.pools[0]?.pool.liquidityUsd ?? 0) - (a.pools[0]?.pool.liquidityUsd ?? 0))[0]?.stock.address);
        setErr(undefined);
      } catch (e) {
        if (alive) setErr(String(e));
      }
    };
    tick();
    const id = setInterval(tick, 30_000);
    const clock = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1_000);
    return () => {
      alive = false;
      clearInterval(id);
      clearInterval(clock);
    };
  }, []);

  const row = rows?.find((r) => r.stock.address === selected);

  return (
    <div className="mx-auto max-w-[1120px] px-4 py-8 sm:py-12">
      <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-[60ch]">
          <h1 className="font-heading text-2xl leading-tight">
            Kasauti <span lang="hi" className="ml-1 text-gold">कसौटी</span>
          </h1>
          <p className="mt-2 text-muted-foreground">
            A jeweller rubs gold on a touchstone before money changes hands. Kasauti does the same for tokenized stocks on Base: the
            trade is refused onchain if it fills too far from the stock's reference price, or while that price is frozen.
          </p>
        </div>
        <ConnectButton showBalance={false} chainStatus="icon" accountStatus="address" />
      </header>

      {err && <p className="mb-4 text-sm text-refuse">{err}</p>}

      {!rows || !cfg ? (
        <p className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="animate-spin" size={16} aria-hidden /> Reading live feeds and pools on Base…
        </p>
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
          <section aria-label="Touchstone board">
            <Board rows={rows} now={now} side={side} bandBps={bandBps} selected={selected} onSelect={setSelected} />
            <p className="mt-4 text-xs text-muted-foreground">
              {cfg.unpricedTokens} of {cfg.totalTokensListed} Coinbase stock tokens have no touchstone, so Kasauti refuses to trade
              them. Touchstone: Chainlink total-return feeds (multiplier included). Mainnet, live data.
            </p>
          </section>
          <div className="lg:sticky lg:top-6">
            <TradePanel cfg={cfg} row={row} now={now} side={side} setSide={setSide} bandBps={bandBps} setBandBps={setBandBps} />
          </div>
        </div>
      )}
    </div>
  );
}
