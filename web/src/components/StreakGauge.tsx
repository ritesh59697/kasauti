import { pct, type Side } from "@/lib/verdict";

/**
 * The touchstone streak: the gold line is the stock's reference price, the shaded side is where
 * Kasauti refuses for this side of the trade, and the marker is where this trade is expected to fill.
 */
export function StreakGauge({ side, gapBps, bandBps, refused }: { side: Side; gapBps: number; bandBps: number; refused: boolean }) {
  const range = Math.max(Math.abs(gapBps) * 1.3, bandBps * 2.2, 40);
  const W = 400;
  const mid = W / 2;
  const x = (bps: number) => mid + (Math.max(-range, Math.min(range, bps)) / range) * (mid - 12);
  const edge = side === "buy" ? x(bandBps) : x(-bandBps);
  const zone = side === "buy" ? { x: edge, w: W - edge } : { x: 0, w: edge };
  const mx = x(gapBps);

  return (
    <figure className="m-0" aria-label={`Expected fill ${pct(gapBps)} versus the touchstone; refusal beyond ${pct(side === "buy" ? bandBps : -bandBps)}`}>
      <svg viewBox={`0 0 ${W} 64`} className="block w-full" role="img" aria-hidden>
        <rect x={0} y={18} width={W} height={10} rx={3} className="fill-surface-2" />
        <rect x={zone.x} y={18} width={zone.w} height={10} className="fill-refuse/25" />
        <line x1={edge} x2={edge} y1={12} y2={34} className="stroke-refuse" strokeDasharray="3 3" strokeWidth={1.5} />
        <line x1={mid} x2={mid} y1={8} y2={38} className="stroke-gold" strokeWidth={3} />
        <g transform={`translate(${mx} 23)`}>
          <circle r={7} className={refused ? "fill-refuse" : "fill-fill"} />
          <circle r={3} className="fill-background" />
        </g>
        <text x={mid} y={54} textAnchor="middle" className="fill-gold num text-[11px]">
          touchstone
        </text>
        <text x={edge} y={8} textAnchor={side === "buy" ? "start" : "end"} dx={side === "buy" ? 4 : -4} className="fill-refuse num text-[11px]">
          {pct(side === "buy" ? bandBps : -bandBps)}
        </text>
      </svg>
    </figure>
  );
}
