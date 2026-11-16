import { useEffect, useId, useRef, useState } from "react";
import { pct, type Side } from "@/lib/verdict";

/*
  The moment: a black touchstone with the gold reference streak down its middle. Each row is a
  rub mark at its live gap to the reference; the band sits either side of the streak, and the side
  where Kasauti refuses is hatched. The stone is a physical object, so its colours stay fixed in
  both themes.
*/

const STONE = { text: "#ededed", text2: "#a1a1a6", muted: "#85858b", gold: "#d4ae4f", fill: "#4cc38a", refuse: "#e5484d" };

export type Rub = { key: string; label: string; gapBps: number; bad: boolean };

export function Touchstone({
  rows,
  bandBps,
  side,
  reference,
  variant = "board",
  title,
}: {
  rows: Rub[];
  bandBps: number;
  side?: Side;
  reference?: string;
  variant?: "board" | "trade";
  title: string;
}) {
  const id = useId().replace(/:/g, "");
  const trade = variant === "trade";
  // viewBox width follows the rendered width, so 12px labels stay 12px on a phone
  const ref = useRef<HTMLElement>(null);
  const [W, setW] = useState(640);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(300, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const rowH = trade ? 88 : 26;
  const top = trade ? 40 : 44;
  const bottom = 24;
  const H = top + rows.length * rowH + bottom;
  const labelW = trade ? 24 : W < 420 ? 64 : 76;
  const left = labelW;
  const right = W - labelW;
  const cx = (left + right) / 2;
  const half = (right - left) / 2 - 12;
  const maxGap = Math.max(0, ...rows.map((r) => Math.abs(r.gapBps)));
  const range = Math.max(maxGap * 1.25, bandBps * 2.5, 60);
  const clamp = (v: number) => Math.max(-range, Math.min(range, v));
  const x = (bps: number) => cx + (clamp(bps) / range) * half;
  const bl = x(-bandBps);
  const br = x(bandBps);
  // an irregular slab, not a rectangle: rounded corners of uneven size and slightly bowed edges
  const stone = [
    `M30 9`,
    `C ${W * 0.35} 3 ${W * 0.65} 8 ${W - 34} 6`,
    `Q ${W - 7} 7 ${W - 8} 34`,
    `C ${W - 3} ${H * 0.4} ${W - 9} ${H * 0.7} ${W - 11} ${H - 30}`,
    `Q ${W - 12} ${H - 6} ${W - 42} ${H - 8}`,
    `C ${W * 0.62} ${H - 3} ${W * 0.3} ${H - 9} 38 ${H - 6}`,
    `Q 7 ${H - 7} 9 ${H - 38}`,
    `C 4 ${H * 0.62} 8 ${H * 0.3} 6 36`,
    `Q 6 9 30 9 Z`,
  ].join(" ");
  const hatchLeft = side === "sell";
  const hatchRight = side === "buy";
  const y0 = top - 10;
  // band labels clear the centred reference label (mono 12px ≈ 7.2px per character)
  const refHalf = reference ? (reference.length * 7.2) / 2 + 14 : 0;
  const y1 = H - bottom + 10;

  return (
    <figure ref={ref} className="m-0">
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full drop-shadow-[0_12px_24px_rgb(0_0_0/0.18)]" role="img" aria-labelledby={`${id}-t`}>
        <title id={`${id}-t`}>{title}</title>
        <defs>
          <linearGradient id={`${id}-g`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#2a2a2d" />
            <stop offset="0.55" stopColor="#161618" />
            <stop offset="1" stopColor="#0b0b0c" />
          </linearGradient>
          <radialGradient id={`${id}-s`} cx="0.25" cy="0.15" r="0.7">
            <stop offset="0" stopColor="#ffffff" stopOpacity="0.07" />
            <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
          </radialGradient>
          <pattern id={`${id}-h`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="6" stroke={STONE.refuse} strokeOpacity="0.35" strokeWidth="1.5" />
          </pattern>
          <clipPath id={`${id}-c`}>
            <path d={stone} />
          </clipPath>
        </defs>

        <path d={stone} fill={`url(#${id}-g)`} stroke="#ffffff" strokeOpacity="0.1" />
        <path d={stone} fill={`url(#${id}-s)`} />

        <g clipPath={`url(#${id}-c)`}>
          {/* the band you accept, and the refusal zone beyond it */}
          <rect x={bl} y={y0} width={br - bl} height={y1 - y0} fill="#ffffff" fillOpacity="0.035" />
          {hatchLeft && <rect x={0} y={y0} width={bl} height={y1 - y0} fill={`url(#${id}-h)`} />}
          {hatchRight && <rect x={br} y={y0} width={W - br} height={y1 - y0} fill={`url(#${id}-h)`} />}
          {[bl, br].map((bx) => (
            <line key={bx} x1={bx} x2={bx} y1={y0} y2={y1} stroke="#ffffff" strokeOpacity="0.32" strokeDasharray="3 4" />
          ))}

          {/* row guides */}
          {!trade &&
            rows.map((r, i) => (
              <line key={r.key} x1={left} x2={right} y1={top + i * rowH + rowH / 2} y2={top + i * rowH + rowH / 2} stroke="#ffffff" strokeOpacity="0.05" />
            ))}

          {/* the gold streak: the reference price */}
          <path d={`M${cx} ${y0 + 4} Q ${cx + 1.5} ${(y0 + y1) / 2} ${cx - 0.5} ${y1 - 4}`} stroke={STONE.gold} strokeWidth="5" strokeLinecap="round" fill="none" />
          <path d={`M${cx - 2.5} ${y0 + 10} L ${cx - 2} ${y1 - 12}`} stroke={STONE.gold} strokeOpacity="0.45" strokeWidth="1.2" strokeLinecap="round" />
          <path d={`M${cx + 2.8} ${y0 + 16} L ${cx + 2.4} ${y1 - 8}`} stroke={STONE.gold} strokeOpacity="0.35" strokeWidth="1" strokeLinecap="round" />
        </g>

        {/* band labels */}
        <text x={Math.min(bl - 6, cx - refHalf)} y={top - 18} textAnchor="end" fill={STONE.text2} className="num" fontSize="12">
          {pct(-bandBps)}
        </text>
        <text x={Math.max(br + 6, cx + refHalf)} y={top - 18} fill={STONE.text2} className="num" fontSize="12">
          {pct(bandBps)}
        </text>

        {rows.map((r, i) => {
          const cy = top + i * rowH + rowH / 2;
          const mx = x(r.gapBps);
          const color = r.bad ? STONE.refuse : STONE.text;
          const clipped = Math.abs(r.gapBps) > range;
          const markH = trade ? 36 : 14;
          return (
            <g key={r.key}>
              {!trade && (
                <>
                  <text x={22} y={cy + 4} fill={STONE.text2} className="num" fontSize="12">
                    {r.label}
                  </text>
                  <text x={W - 22} y={cy + 4} textAnchor="end" fill={r.bad ? STONE.refuse : STONE.muted} className="num" fontSize="12">
                    {pct(r.gapBps)}
                  </text>
                </>
              )}
              <line x1={mx} x2={mx} y1={cy - markH / 2} y2={cy + markH / 2} stroke={color} strokeWidth={trade ? 6 : 4} strokeLinecap="round" opacity={clipped ? 0.6 : 1} />
            </g>
          );
        })}

        {reference && (
          <text x={cx} y={top - 18} textAnchor="middle" fill={STONE.gold} className="num" fontSize="12">
            {reference}
          </text>
        )}
      </svg>
    </figure>
  );
}
