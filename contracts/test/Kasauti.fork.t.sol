// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test, Vm} from "forge-std/Test.sol";
import {Kasauti, IOracleRegistry, IAggregatorV3, IERC20} from "../src/Kasauti.sol";

interface IApprove {
    function approve(address, uint256) external returns (bool);
}

/// Runs against a Base mainnet fork: real Coinbase stock tokens, real Chainlink feeds, real Aero pools.
/// Addresses come from ../config/base.json (built by `npm run sync-config`), never from this file.
contract KasautiForkTest is Test {
    Kasauti k;
    string cfg;

    address registry;
    address factory;
    address usdc;
    address stock; // the most liquid priced stock in config (by top pool liquidity)
    address pool;
    address feed;
    address unpriced;
    address otherStock;

    address trader = makeAddr("trader");
    uint256 usdcUnit; // cached so helpers make no external calls between prank/expectRevert and the trade

    function setUp() public {
        vm.createSelectFork(vm.rpcUrl("base"));
        cfg = vm.readFile(string.concat(vm.projectRoot(), "/../config/base.json"));

        registry = vm.parseJsonAddress(cfg, ".oracleRegistry");
        factory = vm.parseJsonAddress(cfg, ".clFactories[0]");
        usdc = vm.parseJsonAddress(cfg, ".quote.address");
        unpriced = vm.parseJsonAddress(cfg, ".unpricedExample");

        uint256 n;
        while (vm.keyExistsJson(cfg, string.concat(".stocks[", vm.toString(n), "]"))) n++;
        Kasauti.Wiring memory w = Kasauti.Wiring({
            factories: vm.parseJsonAddressArray(cfg, ".clFactories"),
            quote: usdc,
            quoteFeed: vm.parseJsonAddress(cfg, ".quote.feed.address"),
            quoteMaxAge: uint32(vm.parseJsonUint(cfg, ".quote.feed.heartbeat")),
            stocks: new address[](n),
            feeds: new address[](n)
        });

        uint256 bestLiq;
        for (uint256 i; i < n; i++) {
            string memory p = string.concat(".stocks[", vm.toString(i), "]");
            address s = vm.parseJsonAddress(cfg, string.concat(p, ".address"));
            address f = vm.parseJsonAddress(cfg, string.concat(p, ".feed.address"));
            w.stocks[i] = s;
            w.feeds[i] = f;
            if (!vm.keyExistsJson(cfg, string.concat(p, ".pools[0]"))) continue;
            uint256 liq = vm.parseJsonUint(cfg, string.concat(p, ".pools[0].liquidityUsd"));
            if (liq > bestLiq) {
                if (stock != address(0)) otherStock = stock;
                bestLiq = liq;
                stock = s;
                feed = f;
                pool = vm.parseJsonAddress(cfg, string.concat(p, ".pools[0].address"));
            } else if (otherStock == address(0)) {
                otherStock = s;
            }
        }
        k = new Kasauti(IOracleRegistry(registry), address(this), w);
        require(stock != address(0), "no priced stock with a pool in config");

        usdcUnit = 10 ** IERC20(usdc).decimals();
        deal(usdc, trader, 10_000 * usdcUnit);
        vm.prank(trader);
        IApprove(usdc).approve(address(k), type(uint256).max);
    }

    // ------------------------------------------------------------------ helpers

    function _usd(uint256 whole) internal view returns (uint256) {
        return whole * usdcUnit;
    }

    function _age() internal view returns (uint256) {
        (, uint256 updatedAt,,,) = k.touchstone(stock);
        return block.timestamp - updatedAt;
    }

    /// policy that treats the current reference as fresh, whatever the weekday
    function _fresh(uint16 bandBps) internal view returns (Kasauti.Policy memory) {
        return Kasauti.Policy({
            maxGapBps: bandBps, maxAgeSec: uint32(_age() + 1 hours), allowClosedMarket: false, closedGapBps: 0
        });
    }

    /// move the reference by `num/den` while keeping its timestamp
    function _mockReference(uint256 num, uint256 den) internal {
        (uint80 r, int256 a, uint256 s, uint256 u, uint80 ar) = IAggregatorV3(feed).latestRoundData();
        vm.mockCall(
            feed,
            abi.encodeWithSelector(IAggregatorV3.latestRoundData.selector),
            abi.encode(r, a * int256(num) / int256(den), s, u, ar)
        );
    }

    function _buy(uint256 usdAmount, Kasauti.Policy memory p) internal returns (uint256) {
        vm.prank(trader);
        return k.guardedSwap(pool, usdc, stock, _usd(usdAmount), 0, p);
    }

    // ------------------------------------------------------------------ fills

    function test_buy_fillsInsideBand() public {
        (uint256 ref,,,,) = k.touchstone(stock);
        uint256 out = _buy(5, _fresh(500));
        assertGt(out, 0);
        assertEq(IERC20(stock).balanceOf(trader), out);
        uint256 paidE18 = _usd(5) * 1e18 * 10 ** IERC20(stock).decimals() / (10 ** IERC20(usdc).decimals() * out);
        assertLe(paidE18 * 10_000, ref * 10_500, "filled outside the 5% band");
    }

    function test_sell_roundTripFills() public {
        uint256 got = _buy(20, _fresh(500));
        Kasauti.Policy memory pol = _fresh(500);
        vm.startPrank(trader);
        IApprove(stock).approve(address(k), got);
        uint256 back = k.guardedSwap(pool, stock, usdc, got, 0, pol);
        vm.stopPrank();
        assertGt(back, 0);
        assertEq(IERC20(stock).balanceOf(trader), 0);
    }

    // ------------------------------------------------------------------ refusals (the money shots)

    function test_buy_refusedAboveTouchstone() public {
        _mockReference(95, 100); // market now ~5% above the reference
        Kasauti.Policy memory pol = _fresh(50);
        vm.prank(trader);
        vm.expectPartialRevert(Kasauti.AboveTouchstone.selector);
        k.guardedSwap(pool, usdc, stock, _usd(5), 0, pol);
        assertEq(IERC20(stock).balanceOf(trader), 0, "refused trade must leave nothing behind");
    }

    function test_sell_refusedBelowTouchstone() public {
        uint256 got = _buy(20, _fresh(500));
        _mockReference(105, 100); // market now ~5% below the reference
        Kasauti.Policy memory pol = _fresh(50);
        vm.startPrank(trader);
        IApprove(stock).approve(address(k), got);
        vm.expectPartialRevert(Kasauti.BelowTouchstone.selector);
        k.guardedSwap(pool, stock, usdc, got, 0, pol);
        vm.stopPrank();
        assertEq(IERC20(stock).balanceOf(trader), got);
    }

    function test_refusedWhenReferenceFrozen() public {
        if (_age() < 2) vm.warp(block.timestamp + 10);
        uint256 age = _age();
        Kasauti.Policy memory p =
            Kasauti.Policy({maxGapBps: 500, maxAgeSec: uint32(age - 1), allowClosedMarket: false, closedGapBps: 0});
        vm.prank(trader);
        vm.expectRevert(abi.encodeWithSelector(Kasauti.StaleTouchstone.selector, stock, age));
        k.guardedSwap(pool, usdc, stock, _usd(5), 0, p);
    }

    function test_closedMarketOptIn_usesItsOwnBand() public {
        if (_age() < 2) vm.warp(block.timestamp + 10);
        uint256 age = _age();
        // opted in with a wide band: fills, and the event says it was a closed-market fill
        Kasauti.Policy memory wide =
            Kasauti.Policy({maxGapBps: 0, maxAgeSec: uint32(age - 1), allowClosedMarket: true, closedGapBps: 500});
        vm.recordLogs();
        _buy(5, wide);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bool sawClosed;
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].topics[0] == Kasauti.GuardedSwap.selector) {
                (,,,,,, bool closed) =
                    abi.decode(logs[i].data, (bool, uint256, uint256, uint256, uint256, int256, bool));
                sawClosed = closed;
            }
        }
        assertTrue(sawClosed, "fill must be flagged as closed-market");

        // opted in, but the closed band is tighter than the gap: refused
        _mockReference(95, 100);
        Kasauti.Policy memory tight =
            Kasauti.Policy({maxGapBps: 500, maxAgeSec: uint32(age - 1), allowClosedMarket: true, closedGapBps: 50});
        vm.prank(trader);
        vm.expectPartialRevert(Kasauti.AboveTouchstone.selector);
        k.guardedSwap(pool, usdc, stock, _usd(5), 0, tight);
    }

    function test_refusedWhenPaused() public {
        (uint256 mult,) = IOracleRegistry(registry).getOracleParams(stock);
        vm.mockCall(registry, abi.encodeCall(IOracleRegistry.getOracleParams, (stock)), abi.encode(mult, true));
        Kasauti.Policy memory pol = _fresh(500);
        vm.prank(trader);
        vm.expectRevert(abi.encodeWithSelector(Kasauti.TouchstonePaused.selector, stock));
        k.guardedSwap(pool, usdc, stock, _usd(5), 0, pol);
    }

    function test_refusedWithoutTouchstone() public {
        Kasauti.Policy memory pol = _fresh(500);
        vm.prank(trader);
        vm.expectRevert(abi.encodeWithSelector(Kasauti.NoTouchstone.selector, unpriced));
        k.guardedSwap(pool, usdc, unpriced, _usd(5), 0, pol);
    }

    // ------------------------------------------------------------------ plumbing safety

    function test_refusedOnPoolFromUnlistedFactory() public {
        k.setFactory(factory, false);
        Kasauti.Policy memory pol = _fresh(500);
        vm.prank(trader);
        vm.expectRevert(abi.encodeWithSelector(Kasauti.PoolNotAllowed.selector, pool));
        k.guardedSwap(pool, usdc, stock, _usd(5), 0, pol);
    }

    function test_refusedOnWrongPoolForPair() public {
        Kasauti.Policy memory pol = _fresh(500);
        vm.prank(trader);
        vm.expectRevert(abi.encodeWithSelector(Kasauti.PoolMismatch.selector, pool));
        k.guardedSwap(pool, usdc, otherStock, _usd(5), 0, pol);
    }

    function test_refusedStockToStock() public {
        Kasauti.Policy memory pol = _fresh(500);
        vm.prank(trader);
        vm.expectRevert(abi.encodeWithSelector(Kasauti.UnsupportedPair.selector, stock, otherStock));
        k.guardedSwap(pool, stock, otherStock, 1, 0, pol);
    }

    function test_callbackOnlyFromActivePool() public {
        vm.expectRevert(Kasauti.NotPool.selector);
        k.uniswapV3SwapCallback(1, 0, "");
    }

    function test_slippageFloor() public {
        Kasauti.Policy memory pol = _fresh(500);
        vm.prank(trader);
        vm.expectPartialRevert(Kasauti.Slippage.selector);
        k.guardedSwap(pool, usdc, stock, _usd(5), type(uint256).max, pol);
    }

    function test_onlyOwnerWires() public {
        vm.prank(trader);
        vm.expectRevert(Kasauti.NotOwner.selector);
        k.setFactory(address(1), true);
    }

    // ------------------------------------------------------------------ the invariant

    /// Whatever the size and band, a buy either is refused or realizes a price no worse than reference × (1 + band).
    /// forge-config: default.fuzz.runs = 24
    function testFuzz_buyNeverWorseThanBand(uint256 usdAmount, uint16 bandBps) public {
        usdAmount = bound(usdAmount, 1, 2_000);
        bandBps = uint16(bound(bandBps, 0, 300));
        (uint256 ref,,,,) = k.touchstone(stock);
        Kasauti.Policy memory pol = _fresh(bandBps);
        vm.prank(trader);
        try k.guardedSwap(pool, usdc, stock, _usd(usdAmount), 0, pol) returns (uint256 out) {
            uint256 paidE18 =
                _usd(usdAmount) * 1e18 * 10 ** IERC20(stock).decimals() / (10 ** IERC20(usdc).decimals() * out);
            assertLe(paidE18 * 10_000, ref * (10_000 + bandBps) + 10_000, "filled outside the band");
        } catch (bytes memory err) {
            assertEq(bytes4(err), Kasauti.AboveTouchstone.selector, "only a band refusal is acceptable here");
        }
    }
}
