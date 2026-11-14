import { useEffect, useState } from "react";
import { ageLabel, loadConfig, readBoard, type Config, type Row } from "./lib/touchstone";

const explorer = import.meta.env.VITE_EXPLORER_URL as string;

export default function App() {
  const [cfg, setCfg] = useState<Config>();
  const [rows, setRows] = useState<Row[]>();
  const [err, setErr] = useState<string>();
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const c = cfg ?? (await loadConfig());
        if (!alive) return;
        setCfg(c);
        const r = await readBoard(c);
        if (alive) {
          setRows(r);
          setNow(Math.floor(Date.now() / 1000));
        }
      } catch (e) {
        if (alive) setErr(String(e));
      }
    };
    tick();
    const id = setInterval(tick, 30_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [cfg]);

  return (
    <main>
      <header>
        <h1>
          Kasauti <span lang="hi">कसौटी</span>
        </h1>
        <p className="lede">
          A jeweller rubs gold on a touchstone before money changes hands. Kasauti does the same for tokenized stocks on
          Base: it refuses a trade that fills too far from the stock's reference price, or while that price is frozen.
        </p>
      </header>

      {err && <p className="error">{err}</p>}
      {!rows && !err && <p className="muted">Reading live feeds and pools on Base…</p>}

      {rows && (
        <table>
          <thead>
            <tr>
              <th>Stock</th>
              <th className="num">Touchstone</th>
              <th className="num">Age</th>
              <th className="num">Multiplier</th>
              <th className="num">Pool price</th>
              <th className="num">Gap</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const top = r.pools[0];
              return (
                <tr key={r.stock.address}>
                  <td>
                    <a href={`${explorer}/token/${r.stock.address}`} target="_blank" rel="noreferrer">
                      {r.stock.symbol}
                    </a>
                    {r.paused && <span className="tag">paused</span>}
                  </td>
                  <td className="num">${r.reference.toFixed(2)}</td>
                  <td className="num">{ageLabel(r.updatedAt, now)}</td>
                  <td className="num">{r.multiplier.toFixed(4)}</td>
                  <td className="num">{top ? `$${top.priceUsd.toFixed(2)}` : "no pool"}</td>
                  <td className={`num ${top ? (top.gapBps >= 0 ? "up" : "down") : ""}`}>
                    {top ? `${top.gapBps >= 0 ? "+" : ""}${(top.gapBps / 100).toFixed(2)}%` : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {cfg && (
        <p className="muted">
          {cfg.unpricedTokens} of {cfg.totalTokensListed} Coinbase stock tokens have no touchstone. Kasauti refuses to
          trade them. Reference: Chainlink total-return feeds. Pools: Aero CL, verified against Aero's factory.
        </p>
      )}
    </main>
  );
}
