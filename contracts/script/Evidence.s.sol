// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script} from "forge-std/Script.sol";
import {StdCheats} from "forge-std/StdCheats.sol";
import {Vm} from "forge-std/Vm.sol";
import {Kasauti, IERC20} from "../src/Kasauti.sol";

interface IApprove {
    function approve(address, uint256) external returns (bool);
}

/// Runs guarded trades against the DEPLOYED Kasauti on today's Base mainnet state, in a local
/// simulation: nothing is broadcast and no money moves. Saves what happened to ../evidence/.
///
/// Every address comes from ../deployments/8453.json and ../config/base.json. The policy comes from
/// the same VITE_DEFAULT_* values the web app uses, and the trade size from EVIDENCE_AMOUNT_USDC.
contract Evidence is Script, StdCheats {
    Kasauti k;
    address usdc;
    address stock;
    string symbol;
    address pool;
    address trader;
    uint256 amountIn;
    uint256 refAge;

    uint256 caseCount;

    function run() external {
        vm.createSelectFork(vm.rpcUrl("base"));
        string memory dep = vm.readFile(string.concat(vm.projectRoot(), "/../deployments/8453.json"));
        string memory cfg = vm.readFile(string.concat(vm.projectRoot(), "/../config/base.json"));
        k = Kasauti(vm.parseJsonAddress(dep, ".kasauti"));
        usdc = vm.parseJsonAddress(cfg, ".quote.address");
        _pickStock(cfg);

        trader = makeAddr("evidence-trader");
        amountIn = vm.envUint("EVIDENCE_AMOUNT_USDC") * 10 ** IERC20(usdc).decimals();
        deal(usdc, trader, amountIn * 4);
        vm.prank(trader);
        IApprove(usdc).approve(address(k), type(uint256).max);
        vm.prank(trader);
        IApprove(stock).approve(address(k), type(uint256).max);

        (uint256 refE18, uint256 updatedAt, bool paused,,) = k.touchstone(stock);
        refAge = block.timestamp - updatedAt;

        uint16 band = uint16(vm.envUint("VITE_DEFAULT_BAND_BPS"));
        uint32 maxAge = uint32(vm.envUint("VITE_DEFAULT_MAX_AGE_MIN") * 60);
        uint16 closedBand = uint16(vm.envUint("VITE_DEFAULT_CLOSED_BAND_BPS"));
        // the app's default policy, and the same with the current reference counted as fresh whatever the hour
        Kasauti.Policy memory appDefault = Kasauti.Policy(band, maxAge, false, closedBand);
        Kasauti.Policy memory fresh = Kasauti.Policy(band, uint32(refAge + 1 hours), false, closedBand);
        Kasauti.Policy memory zero = Kasauti.Policy(0, uint32(refAge + 1 hours), false, closedBand);

        // The cases run one after another on the same simulated chain (state snapshots would also roll
        // back the record of each case). Each trade is small next to the pool, so later cases see
        // practically the same price.
        // 1. what the app's default policy does right now (with markets shut: StaleTouchstone)
        _case("buy with the app's default policy", true, amountIn, appDefault);
        // 2-3. reference counted as fresh, app band: a buy, then selling half of it
        uint256 bought = _case("buy, reference counted as fresh, app band", true, amountIn, fresh);
        if (bought > 0) _case("sell half of it, app band", false, bought / 2, fresh);
        // 4-5. a zero band: the pool fee alone puts at least one side outside it, so one must refuse
        _case("buy, zero band", true, amountIn, zero);
        if (bought > 0) _case("sell the other half, zero band", false, bought - bought / 2, zero);

        string memory meta = "meta";
        vm.serializeUint(meta, "chainId", block.chainid);
        vm.serializeUint(meta, "block", block.number);
        vm.serializeUint(meta, "timestamp", block.timestamp);
        vm.serializeAddress(meta, "kasauti", address(k));
        vm.serializeString(meta, "stock", symbol);
        vm.serializeAddress(meta, "stockAddress", stock);
        vm.serializeAddress(meta, "pool", pool);
        vm.serializeUint(meta, "referenceUsdE18", refE18);
        vm.serializeUint(meta, "referenceAgeSec", refAge);
        vm.serializeBool(meta, "referencePaused", paused);
        vm.serializeUint(meta, "amountInUsdc", amountIn);
        string memory head = vm.serializeString(meta, "note", "Simulated with forge script against the deployed contract on a fork of Base mainnet at this block. Nothing was broadcast.");
        // splice the cases in as a JSON array (serializeString would store it as a quoted string)
        bytes memory h = bytes(head);
        bytes memory trimmed = new bytes(h.length - 1);
        for (uint256 i; i < trimmed.length; i++) trimmed[i] = h[i];
        string memory json = string.concat(string(trimmed), ',"cases":', _casesJson(), "}");

        string memory out = string.concat(vm.projectRoot(), "/../evidence/dry-run-", vm.toString(block.number), ".json");
        vm.writeJson(json, out);
        vm.writeJson(json, string.concat(vm.projectRoot(), "/../evidence/latest.json"));
    }

    // ------------------------------------------------------------------ cases

    string[] cases;

    function _case(string memory label, bool isBuy, uint256 amt, Kasauti.Policy memory p) internal returns (uint256 out) {
        string memory id = string.concat("case", vm.toString(caseCount++));
        vm.serializeString(id, "label", label);
        vm.serializeString(id, "side", isBuy ? "buy" : "sell");
        vm.serializeUint(id, "amountIn", amt);
        vm.serializeUint(id, "maxGapBps", p.maxGapBps);
        vm.serializeUint(id, "maxAgeSec", p.maxAgeSec);
        vm.serializeBool(id, "allowClosedMarket", p.allowClosedMarket);

        (address tin, address tout) = isBuy ? (usdc, stock) : (stock, usdc);
        vm.recordLogs();
        vm.prank(trader);
        string memory obj;
        try k.guardedSwap(pool, tin, tout, amt, 0, p) returns (uint256 o) {
            out = o;
            vm.serializeString(id, "result", "filled");
            vm.serializeUint(id, "amountOut", o);
            Vm.Log[] memory logs = vm.getRecordedLogs();
            for (uint256 i; i < logs.length; i++) {
                if (logs[i].emitter != address(k) || logs[i].topics[0] != Kasauti.GuardedSwap.selector) continue;
                (,,, uint256 realizedE18,, int256 gapBps,) =
                    abi.decode(logs[i].data, (bool, uint256, uint256, uint256, uint256, int256, bool));
                vm.serializeUint(id, "realizedUsdE18", realizedE18);
                vm.serializeInt(id, "gapBps", gapBps);
            }
            obj = vm.serializeString(id, "error", "");
        } catch (bytes memory err) {
            vm.serializeString(id, "result", "refused");
            obj = _decode(id, err);
        }
        cases.push(obj);
    }

    function _decode(string memory id, bytes memory err) internal returns (string memory) {
        bytes4 sel = bytes4(err);
        bytes memory a = _tail(err);
        if (sel == Kasauti.AboveTouchstone.selector || sel == Kasauti.BelowTouchstone.selector) {
            (uint256 gap, uint256 realized, uint256 ref) = abi.decode(a, (uint256, uint256, uint256));
            vm.serializeUint(id, "gapBps", gap);
            vm.serializeUint(id, "realizedUsdE18", realized);
            vm.serializeUint(id, "referenceUsdE18", ref);
            return vm.serializeString(id, "error", sel == Kasauti.AboveTouchstone.selector ? "AboveTouchstone" : "BelowTouchstone");
        }
        if (sel == Kasauti.StaleTouchstone.selector) {
            (, uint256 age) = abi.decode(a, (address, uint256));
            vm.serializeUint(id, "referenceAgeSec", age);
            return vm.serializeString(id, "error", "StaleTouchstone");
        }
        if (sel == Kasauti.TouchstonePaused.selector) return vm.serializeString(id, "error", "TouchstonePaused");
        return vm.serializeBytes(id, "error", err);
    }

    function _tail(bytes memory err) internal pure returns (bytes memory t) {
        if (err.length < 4) return t;
        t = new bytes(err.length - 4);
        for (uint256 i; i < t.length; i++) t[i] = err[i + 4];
    }

    function _casesJson() internal view returns (string memory s) {
        s = "[";
        for (uint256 i; i < cases.length; i++) s = string.concat(s, i == 0 ? "" : ",", cases[i]);
        s = string.concat(s, "]");
    }

    /// the most liquid priced stock with a pool, as in the fork tests
    function _pickStock(string memory cfg) internal {
        uint256 bestLiq;
        for (uint256 i; vm.keyExistsJson(cfg, string.concat(".stocks[", vm.toString(i), "]")); i++) {
            string memory p = string.concat(".stocks[", vm.toString(i), "]");
            if (!vm.keyExistsJson(cfg, string.concat(p, ".pools[0]"))) continue;
            uint256 liq = vm.parseJsonUint(cfg, string.concat(p, ".pools[0].liquidityUsd"));
            if (liq <= bestLiq) continue;
            bestLiq = liq;
            stock = vm.parseJsonAddress(cfg, string.concat(p, ".address"));
            symbol = vm.parseJsonString(cfg, string.concat(p, ".symbol"));
            pool = vm.parseJsonAddress(cfg, string.concat(p, ".pools[0].address"));
        }
        require(stock != address(0), "no priced stock with a pool in config");
    }
}
