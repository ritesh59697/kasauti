import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme, type ThemePref } from "@/lib/theme";
import { cn } from "@/lib/utils";

const OPTIONS: { value: ThemePref; label: string; Icon: typeof Sun }[] = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "system", label: "Match system", Icon: Monitor },
];

export function ThemeToggle({ className }: { className?: string }) {
  const { pref, setPref } = useTheme();
  return (
    <div role="radiogroup" aria-label="Theme" className={cn("inline-flex h-8 items-center gap-0.5 rounded-lg border border-border p-0.5", className)}>
      {OPTIONS.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={pref === value}
          aria-label={label}
          title={label}
          onClick={() => setPref(value)}
          className={cn(
            "grid size-7 place-items-center rounded-md transition-colors duration-150",
            pref === value ? "bg-surface-2 text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Icon size={16} strokeWidth={1.5} aria-hidden />
        </button>
      ))}
    </div>
  );
}
