import { getAddress, type Address } from "viem";

function req(name: string): string {
  const v = import.meta.env[name] as string | undefined;
  if (!v) throw new Error(`${name} is not set (see web/.env.example)`);
  return v;
}
function num(name: string): number {
  const n = Number(req(name));
  if (!Number.isFinite(n)) throw new Error(`${name} must be a number`);
  return n;
}

const kasauti = (import.meta.env.VITE_KASAUTI_ADDRESS as string | undefined) || "";

export const env = {
  rpc: req("VITE_BASE_RPC_URL"),
  explorer: req("VITE_EXPLORER_URL"),
  kasauti: (kasauti ? getAddress(kasauti) : undefined) as Address | undefined,
  wcProjectId: (import.meta.env.VITE_WALLETCONNECT_PROJECT_ID as string | undefined) || undefined,
  defaults: {
    bandBps: num("VITE_DEFAULT_BAND_BPS"),
    maxAgeMin: num("VITE_DEFAULT_MAX_AGE_MIN"),
    closedBandBps: num("VITE_DEFAULT_CLOSED_BAND_BPS"),
  },
};
