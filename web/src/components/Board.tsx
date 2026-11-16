import { PauseCircle } from "lucide-react";
import { ageLabel, type Row } from "@/lib/touchstone";
import { badForSide, pct, usd, type Side } from "@/lib/verdict";
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
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">Tokenized stocks with a Chainlink touchstone, and the gap to their Aero pool price</caption>
        <thead>
          <tr className="text-left text-xs text-muted-foreground">
            <th className="h-10 pl-4 font-normal">Stock</th>
            <th className="h-10 px-3 text-right font-normal">Touchstone</th>
            <th className="h-10 px-3 text-right font-normal max-sm:hidden">Age</th>
            <th className="h-10 px-3 text-right font-normal max-md:hidden">Pool</th>
            <th className="h-10 pr-4 pl-3 text-right font-normal">Gap</th>
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
                  "h-14 cursor-pointer border-t border-border transition-colors duration-150",
                  isSel ? "bg-surface-2 shadow-[inset_0_1px_0_rgb(255_255_255/0.04)]" : "hover:bg-surface-2/50",
                )}
              >
                <td className="pl-4">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelect(r.stock.address);
                    }}
                    aria-pressed={isSel}
                    className="grid rounded-sm text-left"
                  >
                    <span className="font-medium">{r.stock.symbol}</span>
                    <span className="text-xs text-muted-foreground">{r.stock.name.replace(/ \(.*\)$/, "")}</span>
                  </button>
                </td>
                <td className="num px-3 text-right">
                  {r.paused && (
                    <span className="mr-2 inline-flex items-center gap-1 text-xs text-refuse">
                      <PauseCircle size={14} aria-hidden /> paused
                    </span>
                  )}
                  {usd(r.reference)}
                </td>
                <td className="num px-3 text-right text-muted-foreground max-sm:hidden">{ageLabel(r.updatedAt, now)}</td>
                <td className="num px-3 text-right text-secondary-text max-md:hidden">{top ? usd(top.priceUsd) : "no pool"}</td>
                <td className={cn("num pr-4 pl-3 text-right", bad ? "text-refuse" : "text-foreground")}>{top ? pct(top.gapBps) : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="border-t border-border px-4 py-3 text-xs text-muted-foreground">
        A gap in <span className="text-refuse">red</span> is one Kasauti would refuse for a {side} at your {(bandBps / 100).toFixed(2)}% band
      </p>
    </div>
  );
}
