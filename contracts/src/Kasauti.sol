// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function transfer(address, uint256) external returns (bool);
    function transferFrom(address, address, uint256) external returns (bool);
    function decimals() external view returns (uint8);
}

interface IAggregatorV3 {
    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80);
    function decimals() external view returns (uint8);
}

/// @dev Coinbase onchain oracle registry: the same contract the Chainlink feeds read.
interface IOracleRegistry {
    function getOracleParams(address token) external view returns (uint256 multiplier, bool paused);
}

interface IClPool {
    function factory() external view returns (address);
    function token0() external view returns (address);
    function token1() external view returns (address);
    function tickSpacing() external view returns (int24);
    function swap(
        address recipient,
        bool zeroForOne,
        int256 amountSpecified,
        uint160 sqrtPriceLimitX96,
        bytes calldata data
    ) external returns (int256 amount0, int256 amount1);
}

interface IClFactory {
    function getPool(address tokenA, address tokenB, int24 tickSpacing) external view returns (address);
}

/// @title Kasauti — the touchstone check for tokenized-stock trades
/// @notice Swaps a tokenized stock against a quote token on an allowlisted concentrated-liquidity pool,
///         then refuses (reverts) if the price actually realized strays from the stock's Chainlink
///         total-return reference beyond the caller's band, or if that reference is stale, paused or missing.
///         Base's own docs: "never settle or liquidate against a frozen feed". This contract enforces it.
contract Kasauti {
    /// @param maxGapBps         widest acceptable gap vs the reference while the reference is fresh
    /// @param maxAgeSec         reference older than this counts as frozen (markets closed / corporate action)
    /// @param allowClosedMarket if false, a frozen reference refuses the trade; if true, closedGapBps applies
    /// @param closedGapBps      band used when the caller explicitly accepts a frozen reference
    struct Policy {
        uint16 maxGapBps;
        uint32 maxAgeSec;
        bool allowClosedMarket;
        uint16 closedGapBps;
    }

    struct QuoteFeed {
        address feed;
        uint32 maxAge;
    }

    /// @notice Initial wiring, applied in the constructor so a deploy is a single transaction.
    struct Wiring {
        address[] factories;
        address quote;
        address quoteFeed;
        uint32 quoteMaxAge;
        address[] stocks;
        address[] feeds;
    }

    uint256 private constant BPS = 10_000;
    uint160 private constant MIN_SQRT_RATIO_PLUS_ONE = 4295128740;
    uint160 private constant MAX_SQRT_RATIO_MINUS_ONE = 1461446703485210103287273052203988822378723970341;

    IOracleRegistry public immutable registry;
    address public owner;

    mapping(address stock => address feed) public stockFeed;
    mapping(address quote => QuoteFeed) public quoteFeed;
    mapping(address factory => bool) public allowedFactory;

    address private transient _activePool;
    address private transient _payer;
    address private transient _tokenIn;
    uint256 private transient _paid;
    bool private transient _locked;

    event GuardedSwap(
        address indexed trader,
        address indexed stock,
        bool isBuy,
        uint256 stockAmount,
        uint256 quoteAmount,
        uint256 realizedE18,
        uint256 referenceE18,
        int256 gapBps,
        bool closedMarket
    );
    event StockFeedSet(address indexed stock, address feed);
    event QuoteFeedSet(address indexed quote, address feed, uint32 maxAge);
    event FactorySet(address indexed factory, bool allowed);
    event OwnerChanged(address indexed owner);

    error NoTouchstone(address stock);
    error TouchstonePaused(address stock);
    error StaleTouchstone(address stock, uint256 ageSec);
    error AboveTouchstone(uint256 gapBps, uint256 paidE18, uint256 referenceE18);
    error BelowTouchstone(uint256 gapBps, uint256 receivedE18, uint256 referenceE18);
    error BadReference(address feed);
    error QuoteFeedStale(address quote, uint256 ageSec);
    error UnsupportedPair(address tokenIn, address tokenOut);
    error PoolNotAllowed(address pool);
    error PoolMismatch(address pool);
    error BadPolicy();
    error Slippage(uint256 amountOut, uint256 minOut);
    error NotPool();
    error NotOwner();
    error Reentrant();
    error TransferFailed();

    error WiringLength();

    constructor(IOracleRegistry registry_, address owner_, Wiring memory w) {
        registry = registry_;
        owner = owner_;
        emit OwnerChanged(owner_);
        if (w.stocks.length != w.feeds.length) revert WiringLength();
        for (uint256 i; i < w.factories.length; i++) {
            _setFactory(w.factories[i], true);
        }
        if (w.quote != address(0)) _setQuoteFeed(w.quote, w.quoteFeed, w.quoteMaxAge);
        for (uint256 i; i < w.stocks.length; i++) {
            _setStockFeed(w.stocks[i], w.feeds[i]);
        }
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    // ---------------------------------------------------------------- admin (wiring only, no trade limits)

    function setStockFeed(address stock, address feed) external onlyOwner {
        _setStockFeed(stock, feed);
    }

    function setQuoteFeed(address quote, address feed, uint32 maxAge) external onlyOwner {
        _setQuoteFeed(quote, feed, maxAge);
    }

    function setFactory(address factory, bool allowed) external onlyOwner {
        _setFactory(factory, allowed);
    }

    function setOwner(address owner_) external onlyOwner {
        owner = owner_;
        emit OwnerChanged(owner_);
    }

    function _setStockFeed(address stock, address feed) private {
        stockFeed[stock] = feed;
        emit StockFeedSet(stock, feed);
    }

    function _setQuoteFeed(address quote, address feed, uint32 maxAge) private {
        quoteFeed[quote] = QuoteFeed(feed, maxAge);
        emit QuoteFeedSet(quote, feed, maxAge);
    }

    function _setFactory(address factory, bool allowed) private {
        allowedFactory[factory] = allowed;
        emit FactorySet(factory, allowed);
    }

    // ---------------------------------------------------------------- reads

    /// @notice The reference ("touchstone") for a stock, in USD per whole token, 1e18-scaled.
    function touchstone(address stock)
        public
        view
        returns (uint256 referenceE18, uint256 updatedAt, bool paused, uint256 multiplierWad, bool hasFeed)
    {
        address feed = stockFeed[stock];
        if (feed == address(0)) return (0, 0, false, 0, false);
        (multiplierWad, paused) = registry.getOracleParams(stock);
        (, int256 answer,, uint256 updated,) = IAggregatorV3(feed).latestRoundData();
        if (answer <= 0) revert BadReference(feed);
        referenceE18 = _scale(uint256(answer), IAggregatorV3(feed).decimals());
        return (referenceE18, updated, paused, multiplierWad, true);
    }

    // ---------------------------------------------------------------- trade

    /// @notice Exact-input swap between a priced stock and a priced quote token, refused if unfair.
    /// @return amountOut tokens delivered to the caller
    function guardedSwap(
        address pool,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minOut,
        Policy calldata p
    ) external returns (uint256 amountOut) {
        if (_locked) revert Reentrant();
        _locked = true;
        if (p.maxGapBps > BPS || p.closedGapBps > BPS || amountIn == 0) revert BadPolicy();

        // 1. Which side is the stock? Refuse anything without a touchstone before touching the pool.
        bool isBuy;
        address stock;
        address quote;
        if (quoteFeed[tokenIn].feed != address(0)) {
            (isBuy, stock, quote) = (true, tokenOut, tokenIn);
        } else if (quoteFeed[tokenOut].feed != address(0)) {
            (isBuy, stock, quote) = (false, tokenIn, tokenOut);
        } else {
            revert UnsupportedPair(tokenIn, tokenOut);
        }

        // 2. Read the touchstone and decide the band.
        (uint256 refE18, uint256 updatedAt, bool paused,, bool hasFeed) = touchstone(stock);
        if (!hasFeed) revert NoTouchstone(stock);
        if (paused) revert TouchstonePaused(stock);
        uint256 band = p.maxGapBps;
        bool closed;
        uint256 age = block.timestamp - updatedAt;
        if (age > p.maxAgeSec) {
            if (!p.allowClosedMarket) revert StaleTouchstone(stock, age);
            band = p.closedGapBps;
            closed = true;
        }
        uint256 quoteUsdE18 = _quoteUsd(quote);

        // 3. Swap on a verified pool and measure what actually moved.
        _checkPool(pool, tokenIn, tokenOut);
        uint256 spent;
        (amountOut, spent) = _swap(pool, tokenIn, tokenOut, amountIn);
        if (amountOut < minOut) revert Slippage(amountOut, minOut);

        // 4. Realized price per whole stock token in USD (1e18), compared with the touchstone.
        uint256 stockAmt = isBuy ? amountOut : spent;
        uint256 quoteAmt = isBuy ? spent : amountOut;
        uint256 realizedE18 =
            (quoteAmt * quoteUsdE18 * 10 ** IERC20(stock).decimals()) / (10 ** IERC20(quote).decimals() * stockAmt);
        int256 gapBps = (int256(realizedE18) - int256(refE18)) * int256(BPS) / int256(refE18);
        if (isBuy) {
            if (realizedE18 * BPS > refE18 * (BPS + band)) {
                revert AboveTouchstone(uint256(gapBps), realizedE18, refE18);
            }
        } else {
            if (realizedE18 * BPS < refE18 * (BPS - band)) {
                revert BelowTouchstone(uint256(-gapBps), realizedE18, refE18);
            }
        }

        _safeTransfer(tokenOut, msg.sender, amountOut);
        emit GuardedSwap(msg.sender, stock, isBuy, stockAmt, quoteAmt, realizedE18, refE18, gapBps, closed);
        _locked = false;
    }

    /// @dev Concentrated-liquidity swap callback (Aero CL keeps the Uniswap V3 name).
    function uniswapV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata) external {
        if (msg.sender != _activePool) revert NotPool();
        uint256 owed = amount0Delta > 0 ? uint256(amount0Delta) : uint256(amount1Delta);
        _paid = owed;
        _safeTransferFrom(_tokenIn, _payer, msg.sender, owed);
    }

    // ---------------------------------------------------------------- internals

    function _checkPool(address pool, address tokenIn, address tokenOut) internal view {
        address factory = IClPool(pool).factory();
        if (!allowedFactory[factory]) revert PoolNotAllowed(pool);
        address t0 = IClPool(pool).token0();
        address t1 = IClPool(pool).token1();
        if (!((t0 == tokenIn && t1 == tokenOut) || (t0 == tokenOut && t1 == tokenIn))) revert PoolMismatch(pool);
        if (IClFactory(factory).getPool(t0, t1, IClPool(pool).tickSpacing()) != pool) revert PoolMismatch(pool);
    }

    function _swap(address pool, address tokenIn, address tokenOut, uint256 amountIn)
        internal
        returns (uint256 amountOut, uint256 spent)
    {
        bool zeroForOne = tokenIn == IClPool(pool).token0();
        uint256 before = IERC20(tokenOut).balanceOf(address(this));
        _activePool = pool;
        _payer = msg.sender;
        _tokenIn = tokenIn;
        IClPool(pool)
            .swap(
                address(this),
                zeroForOne,
                int256(amountIn),
                zeroForOne ? MIN_SQRT_RATIO_PLUS_ONE : MAX_SQRT_RATIO_MINUS_ONE,
                ""
            );
        _activePool = address(0);
        amountOut = IERC20(tokenOut).balanceOf(address(this)) - before;
        spent = _paid;
    }

    function _quoteUsd(address quote) internal view returns (uint256) {
        QuoteFeed memory q = quoteFeed[quote];
        (, int256 answer,, uint256 updatedAt,) = IAggregatorV3(q.feed).latestRoundData();
        if (answer <= 0) revert BadReference(q.feed);
        uint256 age = block.timestamp - updatedAt;
        if (age > q.maxAge) revert QuoteFeedStale(quote, age);
        return _scale(uint256(answer), IAggregatorV3(q.feed).decimals());
    }

    function _scale(uint256 v, uint8 dec) internal pure returns (uint256) {
        return dec <= 18 ? v * 10 ** (18 - dec) : v / 10 ** (dec - 18);
    }

    function _safeTransfer(address token, address to, uint256 amount) internal {
        (bool ok, bytes memory ret) = token.call(abi.encodeCall(IERC20.transfer, (to, amount)));
        if (!ok || (ret.length != 0 && !abi.decode(ret, (bool)))) revert TransferFailed();
    }

    function _safeTransferFrom(address token, address from, address to, uint256 amount) internal {
        (bool ok, bytes memory ret) = token.call(abi.encodeCall(IERC20.transferFrom, (from, to, amount)));
        if (!ok || (ret.length != 0 && !abi.decode(ret, (bool)))) revert TransferFailed();
    }
}
