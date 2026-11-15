import { ArrowDownRight, ArrowUpRight, PauseCircle } from "lucide-react";
import { ageLabel, type Row } from "@/lib/touchstone";
import { badForSide, pct, usd, type Side } from "@/lib/verdict";
import { env } from "@/lib/env";
import { cn } from "@/lib/utils";

export function Board({
  rows,
  now,
  side,
  bandBps,
  selected,
  onSelect,
}: {
  rows: Row[];
  now: number;
  side: Side;
  bandBps: number;
  selected?: string;
  onSelect: (address: string) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">Tokenized stocks with a Chainlink touchstone, and the gap to their Aero pool price</caption>
        <thead>
          <tr className="text-left text-xs text-muted-foreground">
            <th className="py-2 pr-3 font-medium">Stock</th>
            <th className="py-2 px-3 text-right font-medium">Touchstone</th>
            <th className="py-2 px-3 text-right font-medium">Age</th>
            <th className="py-2 px-3 text-right font-medium max-sm:hidden">Pool</th>
            <th className="py-2 pl-3 text-right font-medium">Gap</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const top = r.pools[0];
            const isSel = selected === r.stock.address;
            const bad = top ? badForSide(side, top.gapBps, bandBps) : false;
            return (
              <tr
                key={r.stock.address}
                onClick={() => onSelect(r.stock.address)}
                className={cn(
                  "cursor-pointer border-t border-border transition-colors duration-[var(--k-fast)] hover:bg-surface-2/60",
                  isSel && "bg-surface-2",
                )}
              >
                <td className={cn("py-2.5 pr-3", isSel && "shadow-[inset_3px_0_0_var(--k-accent)]")}>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelect(r.stock.address);
                    }}
                    aria-pressed={isSel}
                    className="rounded-sm pl-3 text-left font-medium"
                  >
                    {r.stock.symbol}
                    <span className="block text-xs font-normal text-muted-foreground">{r.stock.name.replace(/ \(.*\)$/, "")}</span>
                  </button>
                </td>
                <td className="num py-2.5 px-3 text-right">
                  {usd(r.reference)}
                  {r.paused && (
                    <span className="ml-2 inline-flex items-center gap-1 text-xs text-refuse">
                      <PauseCircle size={12} aria-hidden /> paused
                    </span>
                  )}
                </td>
                <td className="num py-2.5 px-3 text-right text-muted-foreground">{ageLabel(r.updatedAt, now)}</td>
                <td className="num py-2.5 px-3 text-right max-sm:hidden">{top ? usd(top.priceUsd) : "no pool"}</td>
                <td className={cn("num py-2.5 pl-3 text-right", bad ? "text-refuse" : "text-foreground")}>
                  {top ? (
                    <span className="inline-flex items-center gap-1">
                      {top.gapBps >= 0 ? <ArrowUpRight size={14} aria-hidden /> : <ArrowDownRight size={14} aria-hidden />}
                      {pct(top.gapBps)}
                    </span>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-3 text-xs text-muted-foreground">
        Gap in <span className="text-refuse">this colour</span> means Kasauti would refuse a {side} at your band. Pools are Aero
        CL pools checked against{" "}
        <a className="underline underline-offset-2" href={`${env.explorer}/address/${rows[0]?.pools[0]?.pool.factory ?? ""}`} target="_blank" rel="noreferrer">
          Aero's factory
        </a>
        .
      </p>
    </div>
  );
}
