// Local, dev-server-only page: deploys Kasauti from the connected browser wallet in one transaction,
// wired from /config.json. Not part of the production build (vite builds index.html only).
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider, useAccount, useDeployContract, useSwitchChain, useWaitForTransactionReceipt } from "wagmi";
import { base } from "wagmi/chains";
import { ConnectButton, RainbowKitProvider, darkTheme } from "@rainbow-me/rainbowkit";
import { CheckCircle2, ExternalLink, Loader2, Rocket } from "lucide-react";
import "@rainbow-me/rainbowkit/styles.css";
import "./index.css";
import { wagmiConfig } from "./wagmi";
import { kasautiAbi } from "@/lib/kasautiAbi";
import { kasautiBytecode } from "@/lib/kasautiBytecode";
import { loadConfig, type Config } from "@/lib/touchstone";
import { env } from "@/lib/env";
import { Button } from "@/components/ui/button";

type Recorded = { kasauti: string; block: number; stocksChecked: number };

function Deploy() {
  const [cfg, setCfg] = useState<Config>();
  const [recorded, setRecorded] = useState<Recorded>();
  const [recordErr, setRecordErr] = useState<string>();
  const { address, chainId, isConnected } = useAccount();
  const { switchChain, isPending: switching } = useSwitchChain();
  const { deployContract, data: hash, isPending, error } = useDeployContract();
  const receipt = useWaitForTransactionReceipt({ hash });

  useEffect(() => {
    loadConfig().then(setCfg);
  }, []);

  useEffect(() => {
    if (!receipt.data || recorded) return;
    fetch("/__kasauti/record", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ hash }) })
      .then(async (r) => (r.ok ? setRecorded(await r.json()) : setRecordErr(await r.text())))
      .catch((e) => setRecordErr(String(e)));
  }, [receipt.data, hash, recorded]);

  if (!cfg) return <p className="text-muted-foreground">Loading config…</p>;

  const deploy = () =>
    deployContract({
      abi: kasautiAbi,
      bytecode: kasautiBytecode,
      args: [
        cfg.oracleRegistry,
        address!,
        {
          factories: cfg.clFactories,
          quote: cfg.quote.address,
          quoteFeed: cfg.quote.feed.address,
          quoteMaxAge: cfg.quote.feed.heartbeat,
          stocks: cfg.stocks.map((s) => s.address),
          feeds: cfg.stocks.map((s) => s.feed.address),
        },
      ],
    });

  const link = (kind: "address" | "tx", v: string) => (
    <a className="inline-flex items-center gap-1 underline underline-offset-2" href={`${env.explorer}/${kind}/${v}`} target="_blank" rel="noreferrer">
      <span className="num break-all">{v}</span> <ExternalLink size={12} aria-hidden />
    </a>
  );

  return (
    <div className="space-y-6">
      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-sm">
        <dt className="text-muted-foreground">Network</dt>
        <dd>Base mainnet</dd>
        <dt className="text-muted-foreground">Owner</dt>
        <dd className="num break-all">{address ?? "your connected wallet"}</dd>
        <dt className="text-muted-foreground">Oracle registry</dt>
        <dd className="num break-all">{cfg.oracleRegistry}</dd>
        <dt className="text-muted-foreground">Aero pool factory</dt>
        <dd className="num break-all">{cfg.clFactories.join(", ")}</dd>
        <dt className="text-muted-foreground">Quote</dt>
        <dd>
          {cfg.quote.symbol} with its Chainlink USD feed
        </dd>
        <dt className="text-muted-foreground">Touchstones</dt>
        <dd>{cfg.stocks.map((s) => s.symbol).join(", ")}</dd>
      </dl>

      {!isConnected ? (
        <ConnectButton />
      ) : chainId !== base.id ? (
        <Button onClick={() => switchChain({ chainId: base.id })} disabled={switching}>
          Switch to Base
        </Button>
      ) : !hash ? (
        <Button onClick={deploy} disabled={isPending}>
          {isPending ? <Loader2 className="animate-spin" aria-hidden /> : <Rocket aria-hidden />}
          {isPending ? "Approve in your wallet…" : "Deploy Kasauti"}
        </Button>
      ) : null}

      {error && <p className="text-sm text-refuse">{error.message.split("\n")[0]}</p>}

      {hash && (
        <div className="space-y-2 text-sm">
          <p>Transaction: {link("tx", hash)}</p>
          {receipt.isLoading && (
            <p className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="animate-spin" size={14} aria-hidden /> Waiting for Base to confirm…
            </p>
          )}
          {receipt.data?.status === "reverted" && <p className="text-refuse">The deploy reverted.</p>}
          {recorded && (
            <p className="flex items-start gap-2 text-fill">
              <CheckCircle2 size={16} className="mt-0.5 shrink-0" aria-hidden />
              <span>
                Kasauti is live at {link("address", recorded.kasauti)}. All {recorded.stocksChecked} touchstones checked onchain and the
                address is saved for the app. You can go back to Claude now.
              </span>
            </p>
          )}
          {recordErr && <p className="text-refuse">Deployed, but recording failed: {recordErr}</p>}
        </div>
      )}
    </div>
  );
}

const css = getComputedStyle(document.documentElement);
const theme = darkTheme({ accentColor: css.getPropertyValue("--k-primary").trim(), accentColorForeground: css.getPropertyValue("--k-primary-fg").trim(), borderRadius: "small" });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={new QueryClient()}>
        <RainbowKitProvider theme={theme} modalSize="compact">
          <main className="mx-auto max-w-[640px] px-4 py-12">
            <h1 className="font-heading text-2xl">Deploy Kasauti</h1>
            <p className="mt-2 mb-8 text-muted-foreground">
              One transaction from your wallet deploys the contract with every touchstone already wired. It costs a few cents of ETH on
              Base, and your wallet becomes the owner.
            </p>
            <Deploy />
          </main>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  </StrictMode>,
);
