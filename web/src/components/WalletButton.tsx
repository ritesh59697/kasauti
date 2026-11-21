import { ConnectButton } from "@rainbow-me/rainbowkit";
import { CircleAlert, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";

// The header wallet control, drawn with the app's own button so it matches the rest of the chrome.
export function WalletButton() {
  return (
    <ConnectButton.Custom>
      {({ account, chain, mounted, openAccountModal, openChainModal, openConnectModal }) => {
        const ready = mounted;
        const connected = ready && account && chain;
        return (
          <div aria-hidden={!ready} className={ready ? undefined : "pointer-events-none opacity-0"}>
            {!connected ? (
              <Button variant="secondary" size="lg" className="px-3" onClick={openConnectModal}>
                <Wallet aria-hidden /> Connect wallet
              </Button>
            ) : chain.unsupported ? (
              <Button variant="destructive" size="lg" className="px-3" onClick={openChainModal}>
                <CircleAlert aria-hidden /> Wrong network
              </Button>
            ) : (
              <Button variant="secondary" size="lg" className="num px-3" onClick={openAccountModal}>
                {chain.hasIcon && chain.iconUrl && <img src={chain.iconUrl} alt="" className="size-4 rounded-full" />}
                {account.displayName}
              </Button>
            )}
          </div>
        );
      }}
    </ConnectButton.Custom>
  );
}
