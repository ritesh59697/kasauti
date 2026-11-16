// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {Kasauti, IOracleRegistry} from "../src/Kasauti.sol";

/// Deploys Kasauti, wired from ../config/base.json (built by `npm run sync-config`), in one transaction.
/// Owner is the signing account unless KASAUTI_OWNER is set. The browser-wallet path is web/deploy.html.
contract Deploy is Script {
    function run() external returns (Kasauti k) {
        string memory cfg = vm.readFile(string.concat(vm.projectRoot(), "/../config/base.json"));
        require(vm.parseJsonUint(cfg, ".chainId") == block.chainid, "config is for another chain");

        uint256 n;
        while (vm.keyExistsJson(cfg, string.concat(".stocks[", vm.toString(n), "]"))) n++;
        Kasauti.Wiring memory w = Kasauti.Wiring({
            factories: vm.parseJsonAddressArray(cfg, ".clFactories"),
            quote: vm.parseJsonAddress(cfg, ".quote.address"),
            quoteFeed: vm.parseJsonAddress(cfg, ".quote.feed.address"),
            quoteMaxAge: uint32(vm.parseJsonUint(cfg, ".quote.feed.heartbeat")),
            stocks: new address[](n),
            feeds: new address[](n)
        });
        for (uint256 i; i < n; i++) {
            string memory p = string.concat(".stocks[", vm.toString(i), "]");
            w.stocks[i] = vm.parseJsonAddress(cfg, string.concat(p, ".address"));
            w.feeds[i] = vm.parseJsonAddress(cfg, string.concat(p, ".feed.address"));
        }

        address owner = vm.envOr("KASAUTI_OWNER", msg.sender);
        vm.startBroadcast();
        k = new Kasauti(IOracleRegistry(vm.parseJsonAddress(cfg, ".oracleRegistry")), owner, w);
        vm.stopBroadcast();

        console.log("Kasauti", address(k));
        console.log("owner", owner);
        console.log("stocks wired", n);
    }
}
