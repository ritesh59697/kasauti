import { StrictMode, useMemo } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { RainbowKitProvider, darkTheme, lightTheme } from "@rainbow-me/rainbowkit";
import "@rainbow-me/rainbowkit/styles.css";
import "./index.css";
import App from "./App.tsx";
import { wagmiConfig } from "./wagmi";
import { useTheme } from "./lib/theme";

const queryClient = new QueryClient();

// RainbowKit is themed from the same CSS tokens as the app, and re-themed when the viewer switches theme.
function Providers({ children }: { children: React.ReactNode }) {
  const { resolved } = useTheme();
  const rkTheme = useMemo(() => {
    const css = getComputedStyle(document.documentElement);
    const tok = (n: string) => css.getPropertyValue(n).trim();
    const t = (resolved === "light" ? lightTheme : darkTheme)({
      accentColor: tok("--k-primary"),
      accentColorForeground: tok("--k-primary-fg"),
      borderRadius: "small",
      fontStack: "system",
    });
    t.colors.modalBackground = tok("--k-surface");
    t.colors.connectButtonBackground = tok("--k-surface");
    t.colors.connectButtonText = tok("--k-text");
    t.fonts.body = '"IBM Plex Sans", ui-sans-serif, system-ui, sans-serif';
    return t;
  }, [resolved]);
  return (
    <RainbowKitProvider theme={rkTheme} modalSize="compact">
      {children}
    </RainbowKitProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <Providers>
          <App />
        </Providers>
      </QueryClientProvider>
    </WagmiProvider>
  </StrictMode>,
);
