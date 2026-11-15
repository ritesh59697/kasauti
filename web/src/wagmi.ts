import { connectorsForWallets } from "@rainbow-me/rainbowkit";
import {
  coinbaseWallet,
  injectedWallet,
  metaMaskWallet,
  rabbyWallet,
  walletConnectWallet,
} from "@rainbow-me/rainbowkit/wallets";
import { createConfig, http } from "wagmi";
import { base } from "wagmi/chains";
import { env } from "./lib/env";

// Without a WalletConnect project id only browser-injected wallets and Coinbase Wallet are offered.
const wallets = env.wcProjectId
  ? [coinbaseWallet, metaMaskWallet, rabbyWallet, walletConnectWallet]
  : [coinbaseWallet, rabbyWallet, injectedWallet];

const connectors = connectorsForWallets([{ groupName: "Wallets", wallets }], {
  appName: "Kasauti",
  projectId: env.wcProjectId ?? "",
});

export const wagmiConfig = createConfig({
  connectors,
  chains: [base],
  transports: { [base.id]: http(env.rpc) },
  batch: { multicall: true },
});
