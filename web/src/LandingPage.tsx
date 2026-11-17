import { useEffect, useState } from "react";
import { ArrowRight, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Hallmark, Wordmark } from "@/components/Brand";
import { Touchstone } from "@/components/Touchstone";
import { ThemeToggle } from "@/components/ThemeToggle";
import { loadConfig, readBoard, type Config, type Row } from "@/lib/touchstone";
import { env } from "@/lib/env";

const APP = "/app";

function useLiveBoard() {
  const [cfg, setCfg] = useState<Config>();
  const [rows, setRows] = useState<Row[]>();
  const [readAt, setReadAt] = useState<number>();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let alive = true;
    let c: Config | undefined;
    const tick = async () => {
      try {
        c ??= await loadConfig();
        const r = await readBoard(c);
        if (!alive) return;
        setCfg(c);
        setRows(r.filter((x) => x.pools[0]).sort((a, b) => a.pools[0].gapBps - b.pools[0].gapBps));
        setReadAt(Date.now());
      } catch {
        /* keep the last good read; the next tick retries */
      }
    };
    tick();
    const id = setInterval(tick, 30_000);
    const clock = setInterval(() => setNow(Date.now()), 1_000);
    return () => {
      alive = false;
      clearInterval(id);
      clearInterval(clock);
    };
  }, []);
  return { cfg, rows, ago: readAt ? Math.max(0, Math.round((now - readAt) / 1000)) : undefined };
}

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

const H2 = "font-heading text-[2rem] leading-[1.1] font-normal tracking-[-0.02em] sm:text-[2.5rem]";

export function Landing() {
  const { cfg, rows, ago } = useLiveBoard();
  const band = env.defaults.bandBps;

  return (
    <div className="min-h-dvh bg-background">
      <header className="mx-auto flex h-16 max-w-[1280px] items-center justify-between px-4 sm:px-8">
        <Wordmark />
        <nav className="flex items-center gap-6 text-sm">
          <a href="#how" className="text-secondary-text transition-colors duration-150 hover:text-foreground max-sm:hidden">
            How it works
          </a>
          <a href="#contract" className="text-secondary-text transition-colors duration-150 hover:text-foreground max-sm:hidden">
            Contract
          </a>
          <ThemeToggle />
          <Button asChild size="lg" className="px-4">
            <a href={APP}>Open the app</a>
          </Button>
        </nav>
      </header>

      <main>
        {/* hero: split, text left, the live touchstone right */}
        <section className="mx-auto grid min-h-[calc(100dvh-64px)] max-w-[1280px] items-center gap-12 px-4 pt-12 pb-16 sm:px-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-16 lg:pt-0">
          <div className="max-w-[36rem]">
            <h1 className="font-heading text-[2.5rem] leading-[1.06] font-normal tracking-[-0.02em] sm:text-[4rem] sm:leading-[1.03] sm:tracking-[-0.03em]">
              Tokenized stock trades that refuse an unfair price
            </h1>
            <p className="mt-6 text-lg text-secondary-text">
              Kasauti checks every swap of a Coinbase stock token on Base against that stock's Chainlink reference price. If your fill
              lands outside the band you set, or the reference is frozen because markets are shut, the trade reverts onchain and your
              money stays where it was.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Button asChild className="h-11 px-5 text-base">
                <a href={APP}>
                  Open the app <ArrowRight aria-hidden />
                </a>
              </Button>
              <Button asChild variant="secondary" className="h-11 px-5 text-base">
                <a href="#how">How it works</a>
              </Button>
            </div>
          </div>

          <div className="min-w-0">
            <div className="mb-3 flex items-baseline justify-between gap-4 text-sm">
              <span className="text-secondary-text">
                Live on Base: {rows ? `${rows.length} stocks` : "stocks"} against their touchstone
              </span>
              <span className="num shrink-0 text-xs whitespace-nowrap text-muted-foreground">{ago === undefined ? "reading…" : `read ${ago}s ago`}</span>
            </div>
            {rows ? (
              <Touchstone
                title={`Live gaps between each stock's Aero pool price and its Chainlink reference, with a ${band / 100}% band`}
                rows={rows.map((r) => ({ key: r.stock.address, label: r.stock.symbol, gapBps: r.pools[0].gapBps, bad: Math.abs(r.pools[0].gapBps) > band }))}
                bandBps={band}
                reference="touchstone"
              />
            ) : (
              <div className="aspect-[640/384] w-full rounded-2xl bg-surface-2" aria-hidden />
            )}
            <p className="mt-3 text-sm text-muted-foreground">
              The gold streak is each stock's Chainlink reference. A mark is where its Aero pool trades right now. Past the dashed band,
              Kasauti refuses whichever side would lose.
            </p>
          </div>
        </section>

        {/* how it works */}
        <section id="how" className="border-t border-border">
          <div className="mx-auto max-w-[1280px] px-4 py-20 sm:px-8 sm:py-28">
            <h2 className={H2}>How a trade is checked</h2>
            <ol className="mt-12 grid gap-10 md:grid-cols-3 md:gap-8">
              {[
                {
                  n: "01",
                  title: "Read the touchstone",
                  body: "At the moment of the trade, Kasauti reads the stock's Chainlink total-return feed, which already includes the token's multiplier, and Coinbase's pause flag for it.",
                  stamp: <Hallmark kind="neutral">Reference read</Hallmark>,
                },
                {
                  n: "02",
                  title: "Set your band",
                  body: "You choose how far from the reference you will accept a fill, and how old the reference may be. Trading on a frozen price is an opt-in with its own band.",
                  stamp: <Hallmark kind="neutral">Band ±{(band / 100).toFixed(2)}%</Hallmark>,
                },
                {
                  n: "03",
                  title: "Fill or refuse",
                  body: "The swap runs on an Aero pool from the official factory. Kasauti measures the price you actually got and reverts the whole trade if it is outside your band.",
                  stamp: (
                    <span className="flex flex-wrap gap-4">
                      <Hallmark kind="fill">Filled +0.12%</Hallmark>
                      <Hallmark kind="refuse">Refused +0.82%</Hallmark>
                    </span>
                  ),
                },
              ].map((s) => (
                <li key={s.n} className="grid content-start gap-3">
                  <span className="num text-xs text-muted-foreground">{s.n}</span>
                  <h3 className="text-lg font-medium">{s.title}</h3>
                  <p className="text-secondary-text">{s.body}</p>
                  <div className="mt-2">{s.stamp}</div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* why */}
        <section className="border-t border-border bg-deep">
          <div className="mx-auto grid max-w-[1280px] gap-12 px-4 py-20 sm:px-8 sm:py-28 lg:grid-cols-2 lg:gap-16">
            <div>
              <h2 className={`${H2} max-w-[18ch]`}>The weekend is where prices drift</h2>
              <p className="mt-6 max-w-[36rem] text-secondary-text">
                The reference feeds update while U.S. markets are open and freeze when they close. Aero pools keep trading through the
                night and the weekend, so the pool price can wander a long way from the last real one. A seller who doesn't check takes
                that gap as a loss.
              </p>
              <p className="mt-4 max-w-[36rem] text-secondary-text">
                Base's guide to these tokens says to "never settle or liquidate against a frozen feed". Kasauti makes that rule part of
                the trade itself.
              </p>
            </div>
            <div className="grid content-center gap-2 lg:justify-self-end">
              <span className="num text-[4rem] leading-none font-medium text-refuse sm:text-[5rem]">−6.40%</span>
              <span className="text-secondary-text">MSTRc's Aero pool against its frozen reference, Saturday 14 November 2026, 22:20 IST</span>
              <span className="mt-2 max-w-[36ch] text-sm text-muted-foreground">
                At any band tighter than that gap, Kasauti would have refused the sell.
              </span>
            </div>
          </div>
        </section>

        {/* contract facts */}
        <section id="contract" className="border-t border-border">
          <div className="mx-auto max-w-[1280px] px-4 py-20 sm:px-8 sm:py-28">
            <h2 className={H2}>The contract</h2>
            <dl className="mt-10 grid max-w-[880px] border-t border-border">
              {(
                [
                  [
                    "Address",
                    env.kasauti ? (
                      <a className="num inline-flex items-center gap-1.5 underline-offset-4 hover:underline" href={`${env.explorer}/address/${env.kasauti}`} target="_blank" rel="noreferrer">
                        {short(env.kasauti)} on Base <ExternalLink size={14} aria-hidden />
                      </a>
                    ) : (
                      "Not deployed"
                    ),
                  ],
                  [
                    "Source",
                    env.kasauti && cfg ? (
                      <a className="inline-flex items-center gap-1.5 underline-offset-4 hover:underline" href={`https://repo.sourcify.dev/${cfg.chainId}/${env.kasauti}`} target="_blank" rel="noreferrer">
                        Verified on Sourcify, exact match <ExternalLink size={14} aria-hidden />
                      </a>
                    ) : (
                      "Reading…"
                    ),
                  ],
                  ["Tests", "15 tests against a Base mainnet fork, including a fuzzed check that a buy fills inside the band or not at all"],
                  ["Coverage", cfg ? `${cfg.stocks.length} of ${cfg.totalTokensListed} Coinbase stock tokens have a reference feed. Kasauti refuses the rest` : "Reading…"],
                  ["Custody", "It holds your tokens only inside the transaction"],
                  ["Owner powers", "The owner can change which feeds and pool factory count. No fee and no trade limits"],
                ] as const
              ).map(([k, v]) => (
                <div key={k} className="grid gap-1 border-b border-border py-4 sm:grid-cols-[200px_1fr] sm:gap-8">
                  <dt className="text-sm text-muted-foreground">{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto grid max-w-[1280px] gap-6 px-4 py-10 text-sm text-muted-foreground sm:px-8 md:grid-cols-[1fr_auto] md:items-start">
          <div className="grid gap-3">
            <Wordmark />
            <p className="max-w-[60ch]">
              Not for U.S. persons or sanctioned regions. Kasauti is a tool, not investment advice. Not affiliated with Base, Coinbase,
              Chainlink or Aero.
            </p>
          </div>
          <p>Built for Base Stocks Maxxing Season, November 2026</p>
        </div>
      </footer>
    </div>
  );
}
