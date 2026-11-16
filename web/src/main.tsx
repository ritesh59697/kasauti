import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { RainbowKitProvider, darkTheme, lightTheme } from "@rainbow-me/rainbowkit";
import "@rainbow-me/rainbowkit/styles.css";
import "./index.css";
import App from "./App.tsx";
import { wagmiConfig } from "./wagmi";

const queryClient = new QueryClient();

// RainbowKit themed from the same tokens as the app (read at startup from CSS custom properties).
const css = getComputedStyle(document.documentElement);
const tok = (n: string) => css.getPropertyValue(n).trim();
const prefersLight = window.matchMedia("(prefers-color-scheme: light)").matches;
const base = prefersLight ? lightTheme : darkTheme;
const rkTheme = base({ accentColor: tok("--k-primary"), accentColorForeground: tok("--k-primary-fg"), borderRadius: "small", fontStack: "system" });
rkTheme.colors.modalBackground = tok("--k-surface");
rkTheme.colors.connectButtonBackground = tok("--k-surface");
rkTheme.colors.connectButtonText = tok("--k-text");
rkTheme.fonts.body = '"IBM Plex Sans", ui-sans-serif, system-ui, sans-serif';

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider theme={rkTheme} modalSize="compact">
          <App />
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  </StrictMode>,
);
