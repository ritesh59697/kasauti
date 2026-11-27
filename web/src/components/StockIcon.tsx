import { useState } from "react";
import type { StockCfg } from "@/lib/touchstone";
import { cn } from "@/lib/utils";

/** Company logo from the config (Coinbase's own icon); falls back to the ticker's first letter. */
export function StockIcon({ stock, size = 28, className }: { stock: Pick<StockCfg, "symbol" | "iconUrl">; size?: number; className?: string }) {
  const [failed, setFailed] = useState(false);
  const box = cn("shrink-0 rounded-full ring-1 ring-border", className);
  if (stock.iconUrl && !failed) {
    return (
      <img
        src={stock.iconUrl}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
        className={cn(box, "bg-white object-cover")}
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      aria-hidden
      className={cn(box, "grid place-items-center bg-surface-2 font-medium text-muted-foreground")}
      style={{ width: size, height: size, fontSize: size * 0.42 }}
    >
      {stock.symbol.charAt(0)}
    </span>
  );
}
