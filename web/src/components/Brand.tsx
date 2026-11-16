import { cn } from "@/lib/utils";

/** Flat mark: a black touchstone with one gold streak. */
export function Mark({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden className={className}>
      <rect x="1.5" y="3" width="17" height="14" rx="4" fill="#0b0b0c" stroke="currentColor" strokeOpacity="0.18" />
      <path d="M10 6.2v7.6" stroke="#d4ae4f" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

export function Wordmark({ href = "/", className }: { href?: string; className?: string }) {
  return (
    <a href={href} className={cn("inline-flex items-center gap-2 rounded-sm text-base font-semibold text-foreground", className)}>
      <Mark />
      Kasauti
    </a>
  );
}

export type Stamp = "fill" | "refuse" | "neutral";

/** The signature detail: every verdict is stamped like a hallmark. */
export function Hallmark({ kind, children, className }: { kind: Stamp; children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("hallmark", kind === "fill" ? "text-fill" : kind === "refuse" ? "text-refuse" : "text-muted-foreground", className)}>
      {children}
    </span>
  );
}
