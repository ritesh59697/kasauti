import { useEffect, useState } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { ExternalLink, Loader2 } from "lucide-react";
import { Board } from "@/components/Board";
import { TradePanel } from "@/components/TradePanel";
import { Wordmark } from "@/components/Brand";
import { ThemeToggle } from "@/components/ThemeToggle";
import { loadConfig, readBoard, type Config, type Row } from "@/lib/touchstone";
import type { Side } from "@/lib/verdict";
import { env } from "@/lib/env";

export default function App() {
  const [cfg, setCfg] = useState<Config>();
  const [rows, setRows] = useState<Row[]>();
  const [err, setErr] = useState<string>();
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const [readAt, setReadAt] = useState<number>();
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
        const t = Math.floor(Date.now() / 1000);
        setNow(t);
        setReadAt(t);
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
    <div className="min-h-dvh bg-background">
      <header className="sticky top-0 z-10 border-b border-border bg-background">
        <div className="mx-auto flex h-14 max-w-[1440px] items-center justify-between gap-4 px-4 sm:px-8">
          <div className="flex items-center gap-6">
            <Wordmark />
            <nav className="flex items-center gap-5 text-sm max-sm:hidden">
              <a href="/#how" className="text-secondary-text transition-colors duration-150 hover:text-foreground">
                How it works
              </a>
              {env.kasauti && (
                <a
                  href={`${env.explorer}/address/${env.kasauti}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-secondary-text transition-colors duration-150 hover:text-foreground"
                >
                  Contract <ExternalLink size={14} aria-hidden />
                </a>
              )}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <ThemeToggle className="max-sm:hidden" />
            <ConnectButton showBalance={false} chainStatus="icon" accountStatus="address" />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1440px] px-4 py-6 sm:px-8 sm:py-8">
        {err && <p className="mb-4 text-sm text-refuse">{err}</p>}

        {!rows || !cfg ? (
          <p className="flex items-center gap-2 text-secondary-text">
            <Loader2 className="animate-spin" size={16} aria-hidden /> Reading live feeds and pools on Base…
          </p>
        ) : (
          <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_440px]">
            <section aria-labelledby="board-h" className="min-w-0">
              <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
                <h1 id="board-h" className="text-xl font-medium tracking-[-0.01em]">
                  Touchstone board
                </h1>
                <span className="num text-xs text-muted-foreground">
                  Base mainnet · read {readAt ? Math.max(0, now - readAt) : 0}s ago
                </span>
              </div>
              <Board rows={rows} now={now} side={side} bandBps={bandBps} selected={selected} onSelect={setSelected} />
              <p className="mt-4 max-w-[72ch] text-sm text-muted-foreground">
                Touchstone is the stock's Chainlink total-return price, multiplier included. Gap is the Aero pool price against it.{" "}
                {cfg.unpricedTokens} of {cfg.totalTokensListed} Coinbase stock tokens have no touchstone, so Kasauti refuses to trade them.
              </p>
            </section>
            <div className="lg:sticky lg:top-20">
              <TradePanel cfg={cfg} row={row} now={now} side={side} setSide={setSide} bandBps={bandBps} setBandBps={setBandBps} />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
