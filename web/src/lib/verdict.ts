// Mirrors Kasauti.guardedSwap's rules, in the same order, so the preview says what the contract will do.
export type Side = "buy" | "sell";

export type Policy = {
  maxGapBps: number;
  maxAgeSec: number;
  allowClosedMarket: boolean;
  closedGapBps: number;
};

export type Verdict =
  | { kind: "fill"; gapBps: number; bandBps: number; closed: boolean }
  | { kind: "refuse"; reason: "paused" | "stale" | "above" | "below"; gapBps: number; bandBps: number; closed: boolean };

export function gapBps(price: number, reference: number): number {
  return ((price - reference) / reference) * 10_000;
}

export function judge(args: { side: Side; reference: number; price: number; ageSec: number; paused: boolean; policy: Policy }): Verdict {
  const { side, reference, price, ageSec, paused, policy } = args;
  const gap = gapBps(price, reference);
  if (paused) return { kind: "refuse", reason: "paused", gapBps: gap, bandBps: policy.maxGapBps, closed: false };
  let band = policy.maxGapBps;
  let closed = false;
  if (ageSec > policy.maxAgeSec) {
    if (!policy.allowClosedMarket) return { kind: "refuse", reason: "stale", gapBps: gap, bandBps: band, closed: false };
    band = policy.closedGapBps;
    closed = true;
  }
  if (side === "buy" && gap > band) return { kind: "refuse", reason: "above", gapBps: gap, bandBps: band, closed };
  if (side === "sell" && -gap > band) return { kind: "refuse", reason: "below", gapBps: gap, bandBps: band, closed };
  return { kind: "fill", gapBps: gap, bandBps: band, closed };
}

/** Is this gap one Kasauti would refuse for this side, ignoring freshness? Used to colour the board. */
export function badForSide(side: Side, gap: number, bandBps: number): boolean {
  return side === "buy" ? gap > bandBps : -gap > bandBps;
}

export const pct = (bps: number, digits = 2) => `${bps >= 0 ? "+" : "−"}${Math.abs(bps / 100).toFixed(digits)}%`;
export const usd = (n: number) =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: n < 10 ? 4 : 2 })}`;
