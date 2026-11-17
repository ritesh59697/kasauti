import { useEffect, useState } from "react";

// The viewer's theme choice. "system" follows prefers-color-scheme; the others set data-theme on <html>,
// which index.css reads. An inline script in each page's <head> applies the stored choice before paint.
export type ThemePref = "system" | "light" | "dark";
const KEY = "kasauti:theme";
const EVENT = "kasauti:theme";
const media = () => window.matchMedia("(prefers-color-scheme: light)");

export function readPref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

export function setPref(p: ThemePref) {
  const root = document.documentElement;
  if (p === "system") delete root.dataset.theme;
  else root.dataset.theme = p;
  try {
    if (p === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, p);
  } catch {
    /* storage unavailable: the choice lasts for this visit */
  }
  window.dispatchEvent(new Event(EVENT));
}

export function resolve(p: ThemePref): "light" | "dark" {
  return p === "system" ? (media().matches ? "light" : "dark") : p;
}

export function useTheme() {
  const [pref, setState] = useState<ThemePref>(readPref);
  const [resolved, setResolved] = useState(() => resolve(readPref()));
  useEffect(() => {
    const sync = () => {
      const p = readPref();
      setState(p);
      setResolved(resolve(p));
    };
    const mq = media();
    mq.addEventListener("change", sync);
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      mq.removeEventListener("change", sync);
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return { pref, resolved, setPref };
}
