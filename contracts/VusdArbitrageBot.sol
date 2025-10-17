// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

// ============================================================================
// PRODUCTION VERSION - NO CONSOLE.LOG
// Ready for Tenderly and Mainnet deployment
// ============================================================================

// ============================================================================
// UNISWAP V3 INTERFACES
// ============================================================================

interface IUniswapV3FlashCallback {
    function uniswapV3FlashCallback(uint256 fee0, uint256 fee1, bytes calldata data) external;
}

interface IUniswapV3Pool {
    function flash(address recipient, uint256 amount0, uint256 amount1, bytes calldata data) external;
}

// ============================================================================
// CURVE INTERFACES
// ============================================================================

interface ICurveStableSwap {
    function exchange(int128 i, int128 j, uint256 dx, uint256 min_dy) external returns (uint256);
}

// ============================================================================
// VUSD PROTOCOL INTERFACES
// ============================================================================

interface IVusdMinter {
    function mintingFee() external view returns (uint256);
    function mint(address token, uint256 amount, uint256 minOut, address receiver) external;
}

interface IVusdRedeemer {
    function redeemFee() external view returns (uint256);
    function redeem(address token, uint256 amount, uint256 minOut, address receiver) external;
}

// ============================================================================
// VUSD ARBITRAGE CONTRACT
// ============================================================================

/**
 * @title VusdArbitrage
 * @notice Arbitrage contract for VUSD/crvUSD/USDC using Uniswap V3 flashloans and Curve swaps
 * @dev PRODUCTION VERSION: Supports dynamic Uniswap V3 pool selection for optimal fees and liquidity
 * 
 * Key improvements:
 * - Accepts pool address as parameter (no longer hardcoded)
 * - Default pool: USDC/DAI 0.01% (lowest fees, sufficient liquidity)
 * - Configurable USDC position: Knows if USDC is token0 or token1 in the pool
 * - Security: Validates callback comes from requested pool
 * - Flexibility: Can use different pools for different trade sizes
 * 
 * Arbitrage strategies:
 * 1. RICH: USDC → crvUSD → VUSD → USDC (when crvUSD expensive vs VUSD)
 * 2. CHEAP: USDC → VUSD → crvUSD → USDC (when crvUSD cheap vs VUSD)
 */
contract VusdArbitrage is IUniswapV3FlashCallback, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ========================================================================
    // EVENTS
    // ========================================================================

    event FlashloanReceived(
        uint256 amount,
        uint256 fee,
        address pool,
        string scenario
    );
    
    event SwapExecuted(
        string step,
        uint256 amountIn,
        uint256 amountOut,
        string tokenIn,
        string tokenOut
    );
    
    event MintExecuted(uint256 usdcIn, uint256 vusdOut);
    event RedeemExecuted(uint256 vusdIn, uint256 usdcOut);
    
    event BeforeRepayment(
        uint256 usdcBalance,
        uint256 repaymentRequired,
        address pool
    );
    
    event RepaymentExecuted(uint256 repaymentAmount, address pool);
    
    event ArbitrageComplete(
        string scenario,
        address pool,
        uint256 finalBalance,
        int256 profitLoss
    );

    // ========================================================================
    // ERRORS
    // ========================================================================

    error InvalidCaller();
    error NotOwner();
    error FlashloanFailed();
    error CurveSwapFailed(uint8 step);
    error MintFailed();
    error RedeemFailed();
    error InvalidPath();
    error InvalidPool();

    // ========================================================================
    // IMMUTABLE STATE VARIABLES
    // ========================================================================

    // Token addresses
    address public immutable USDC;
    address public immutable CRVUSD;
    address public immutable VUSD;

    // VUSD protocol contracts
    address public immutable VUSD_MINTER;
    address public immutable VUSD_REDEEMER;

    // Curve pool addresses
    address public immutable CURVE_CRVUSD_USDC_POOL;
    address public immutable CURVE_CRVUSD_VUSD_POOL;

    // Curve pool indices for tokens
    int128 public immutable CRVUSD_USDC_POOL_USDC_INDEX;
    int128 public immutable CRVUSD_USDC_POOL_CRVUSD_INDEX;
    int128 public immutable CRVUSD_VUSD_POOL_CRVUSD_INDEX;
    int128 public immutable CRVUSD_VUSD_POOL_VUSD_INDEX;

    // Default Uniswap V3 pool for flashloans
    address public immutable DEFAULT_UNISWAP_V3_POOL;
    
    // Is USDC token1 in the default pool?
    bool public immutable USDC_IS_TOKEN1_IN_DEFAULT_POOL;

    // Contract owner
    address public immutable owner;

    // ========================================================================
    // TRANSIENT STATE VARIABLES
    // ========================================================================

    // Tracks initial balance before arbitrage
    uint256 private initialBalance;

    // ========================================================================
    // CONSTRUCTOR
    // ========================================================================

    constructor(
        address _usdc,
        address _crvUsd,
        address _vusd,
        address _vusdMinter,
        address _vusdRedeemer,
        address _curveCrvusdUsdcPool,
        address _curveCrvusdVusdPool,
        address _defaultUniswapV3Pool,
        bool _usdcIsToken1,
        int128 _crvUsdUsdcPoolUsdcIndex,
        int128 _crvUsdUsdcPoolCrvUsdIndex,
        int128 _crvUsdVusdPoolCrvUsdIndex,
        int128 _crvUsdVusdPoolVusdIndex
    ) {
        owner = msg.sender;
        
        USDC = _usdc;
        CRVUSD = _crvUsd;
        VUSD = _vusd;
        
        VUSD_MINTER = _vusdMinter;
        VUSD_REDEEMER = _vusdRedeemer;
        
        CURVE_CRVUSD_USDC_POOL = _curveCrvusdUsdcPool;
        CURVE_CRVUSD_VUSD_POOL = _curveCrvusdVusdPool;
        
        DEFAULT_UNISWAP_V3_POOL = _defaultUniswapV3Pool;
        USDC_IS_TOKEN1_IN_DEFAULT_POOL = _usdcIsToken1;
        
        CRVUSD_USDC_POOL_USDC_INDEX = _crvUsdUsdcPoolUsdcIndex;
        CRVUSD_USDC_POOL_CRVUSD_INDEX = _crvUsdUsdcPoolCrvUsdIndex;
        CRVUSD_VUSD_POOL_CRVUSD_INDEX = _crvUsdVusdPoolCrvUsdIndex;
        CRVUSD_VUSD_POOL_VUSD_INDEX = _crvUsdVusdPoolVusdIndex;

        // Approve tokens for all contracts
        _safeApproveWithReset(IERC20(USDC), VUSD_MINTER, type(uint256).max);
        _safeApproveWithReset(IERC20(USDC), CURVE_CRVUSD_USDC_POOL, type(uint256).max);
        _safeApproveWithReset(IERC20(CRVUSD), CURVE_CRVUSD_USDC_POOL, type(uint256).max);
        _safeApproveWithReset(IERC20(CRVUSD), CURVE_CRVUSD_VUSD_POOL, type(uint256).max);
        _safeApproveWithReset(IERC20(VUSD), VUSD_REDEEMER, type(uint256).max);
        _safeApproveWithReset(IERC20(VUSD), CURVE_CRVUSD_VUSD_POOL, type(uint256).max);
    }

    // ========================================================================
    // MAIN EXECUTION FUNCTIONS
    // ========================================================================

    /**
     * @notice Execute RICH arbitrage scenario using custom pool
     * @param _uniswapV3Pool Uniswap V3 pool to use for flashloan
     * @param _flashloanAmount Amount of USDC to flashloan
     */
    function executeRich(address _uniswapV3Pool, uint256 _flashloanAmount) external {
        if (msg.sender != owner) revert NotOwner();
        if (_uniswapV3Pool == address(0)) revert InvalidPool();
        
        initialBalance = IERC20(USDC).balanceOf(address(this));
        
        bytes memory data = abi.encode(1, _flashloanAmount, _uniswapV3Pool, true);
        IUniswapV3Pool(_uniswapV3Pool).flash(address(this), 0, _flashloanAmount, data);
    }

    /**
     * @notice Execute RICH arbitrage scenario using default pool
     * @param _flashloanAmount Amount of USDC to flashloan
     */
    function executeRichWithDefaultPool(uint256 _flashloanAmount) external {
        if (msg.sender != owner) revert NotOwner();
        
        initialBalance = IERC20(USDC).balanceOf(address(this));
        
        bytes memory data = abi.encode(1, _flashloanAmount, DEFAULT_UNISWAP_V3_POOL, USDC_IS_TOKEN1_IN_DEFAULT_POOL);
        
        if (USDC_IS_TOKEN1_IN_DEFAULT_POOL) {
            IUniswapV3Pool(DEFAULT_UNISWAP_V3_POOL).flash(address(this), 0, _flashloanAmount, data);
        } else {
            IUniswapV3Pool(DEFAULT_UNISWAP_V3_POOL).flash(address(this), _flashloanAmount, 0, data);
        }
    }

    /**
     * @notice Execute CHEAP arbitrage scenario using custom pool
     * @param _uniswapV3Pool Uniswap V3 pool to use for flashloan
     * @param _flashloanAmount Amount of USDC to flashloan
     */
    function executeCheap(address _uniswapV3Pool, uint256 _flashloanAmount) external {
        if (msg.sender != owner) revert NotOwner();
        if (_uniswapV3Pool == address(0)) revert InvalidPool();
        
        initialBalance = IERC20(USDC).balanceOf(address(this));
        
        bytes memory data = abi.encode(2, _flashloanAmount, _uniswapV3Pool, true);
        IUniswapV3Pool(_uniswapV3Pool).flash(address(this), 0, _flashloanAmount, data);
    }

    /**
     * @notice Execute CHEAP arbitrage scenario using default pool
     * @param _flashloanAmount Amount of USDC to flashloan
     */
    function executeCheapWithDefaultPool(uint256 _flashloanAmount) external {
        if (msg.sender != owner) revert NotOwner();
        
        initialBalance = IERC20(USDC).balanceOf(address(this));
        
        bytes memory data = abi.encode(2, _flashloanAmount, DEFAULT_UNISWAP_V3_POOL, USDC_IS_TOKEN1_IN_DEFAULT_POOL);
        
        if (USDC_IS_TOKEN1_IN_DEFAULT_POOL) {
            IUniswapV3Pool(DEFAULT_UNISWAP_V3_POOL).flash(address(this), 0, _flashloanAmount, data);
        } else {
            IUniswapV3Pool(DEFAULT_UNISWAP_V3_POOL).flash(address(this), _flashloanAmount, 0, data);
        }
    }

    // ========================================================================
    // UNISWAP V3 FLASHLOAN CALLBACK
    // ========================================================================

    function uniswapV3FlashCallback(
        uint256 fee0,
        uint256 fee1,
        bytes calldata data
    ) external override nonReentrant {
        (uint8 pathId, uint256 flashloanAmount, address expectedPool, bool usdcIsToken1) = abi.decode(
            data,
            (uint8, uint256, address, bool)
        );

        if (msg.sender != expectedPool) revert InvalidCaller();

        uint256 usdcFee = usdcIsToken1 ? fee1 : fee0;

        string memory scenario = pathId == 1 ? "RICH" : "CHEAP";
        emit FlashloanReceived(flashloanAmount, usdcFee, msg.sender, scenario);

        if (pathId == 1) {
            _executeRichPath(flashloanAmount);
        } else if (pathId == 2) {
            _executeCheapPath(flashloanAmount);
        } else {
            revert InvalidPath();
        }

        uint256 totalRepayment = flashloanAmount + usdcFee;
        uint256 balanceBeforeRepayment = IERC20(USDC).balanceOf(address(this));
        
        emit BeforeRepayment(balanceBeforeRepayment, totalRepayment, msg.sender);
        
        IERC20(USDC).safeTransfer(msg.sender, totalRepayment);
        emit RepaymentExecuted(totalRepayment, msg.sender);

        uint256 finalBalance = IERC20(USDC).balanceOf(address(this));
        int256 profitLoss = int256(finalBalance) - int256(initialBalance);
        
        emit ArbitrageComplete(scenario, msg.sender, finalBalance, profitLoss);
    }

    // ========================================================================
    // ARBITRAGE PATH IMPLEMENTATIONS
    // ========================================================================

    function _executeRichPath(uint256 flashloanAmount) internal {
        // Step 1: Swap USDC for crvUSD on Curve
        uint256 crvUsdReceived = ICurveStableSwap(CURVE_CRVUSD_USDC_POOL).exchange(
            CRVUSD_USDC_POOL_USDC_INDEX,
            CRVUSD_USDC_POOL_CRVUSD_INDEX,
            flashloanAmount,
            1
        );
        if (crvUsdReceived == 0) revert CurveSwapFailed(1);
        emit SwapExecuted("USDC->crvUSD", flashloanAmount, crvUsdReceived, "USDC", "crvUSD");

        // Step 2: Swap crvUSD for VUSD on Curve
        uint256 vusdReceived = ICurveStableSwap(CURVE_CRVUSD_VUSD_POOL).exchange(
            CRVUSD_VUSD_POOL_CRVUSD_INDEX,
            CRVUSD_VUSD_POOL_VUSD_INDEX,
            crvUsdReceived,
            1
        );
        if (vusdReceived == 0) revert CurveSwapFailed(2);
        emit SwapExecuted("crvUSD->VUSD", crvUsdReceived, vusdReceived, "crvUSD", "VUSD");

        // Step 3: Redeem VUSD for USDC
        uint256 usdcBefore = IERC20(USDC).balanceOf(address(this));
        IVusdRedeemer(VUSD_REDEEMER).redeem(USDC, vusdReceived, 1, address(this));
        uint256 usdcRedeemed = IERC20(USDC).balanceOf(address(this)) - usdcBefore;
        if (usdcRedeemed == 0) revert RedeemFailed();
        emit RedeemExecuted(vusdReceived, usdcRedeemed);
    }

    function _executeCheapPath(uint256 flashloanAmount) internal {
        // Step 1: Mint VUSD with USDC
        uint256 vusdBefore = IERC20(VUSD).balanceOf(address(this));
        IVusdMinter(VUSD_MINTER).mint(USDC, flashloanAmount, 1, address(this));
        uint256 vusdMinted = IERC20(VUSD).balanceOf(address(this)) - vusdBefore;
        if (vusdMinted == 0) revert MintFailed();
        emit MintExecuted(flashloanAmount, vusdMinted);

        // Step 2: Swap VUSD for crvUSD on Curve
        uint256 crvUsdReceived = ICurveStableSwap(CURVE_CRVUSD_VUSD_POOL).exchange(
            CRVUSD_VUSD_POOL_VUSD_INDEX,
            CRVUSD_VUSD_POOL_CRVUSD_INDEX,
            vusdMinted,
            1
        );
        if (crvUsdReceived == 0) revert CurveSwapFailed(1);
        emit SwapExecuted("VUSD->crvUSD", vusdMinted, crvUsdReceived, "VUSD", "crvUSD");

        // Step 3: Swap crvUSD for USDC on Curve
        uint256 usdcReceived = ICurveStableSwap(CURVE_CRVUSD_USDC_POOL).exchange(
            CRVUSD_USDC_POOL_CRVUSD_INDEX,
            CRVUSD_USDC_POOL_USDC_INDEX,
            crvUsdReceived,
            1
        );
        if (usdcReceived == 0) revert CurveSwapFailed(2);
        emit SwapExecuted("crvUSD->USDC", crvUsdReceived, usdcReceived, "crvUSD", "USDC");
    }

    // ========================================================================
    // ADMIN FUNCTIONS
    // ========================================================================

    function emergencyWithdraw(address _token) external {
        if (msg.sender != owner) revert NotOwner();
        uint256 balance = IERC20(_token).balanceOf(address(this));
        if (balance > 0) IERC20(_token).safeTransfer(owner, balance);
    }

    function resetApprovals() external {
        if (msg.sender != owner) revert NotOwner();
        _safeApproveWithReset(IERC20(USDC), VUSD_MINTER, 0);
        _safeApproveWithReset(IERC20(USDC), CURVE_CRVUSD_USDC_POOL, 0);
        _safeApproveWithReset(IERC20(CRVUSD), CURVE_CRVUSD_USDC_POOL, 0);
        _safeApproveWithReset(IERC20(CRVUSD), CURVE_CRVUSD_VUSD_POOL, 0);
        _safeApproveWithReset(IERC20(VUSD), VUSD_REDEEMER, 0);
        _safeApproveWithReset(IERC20(VUSD), CURVE_CRVUSD_VUSD_POOL, 0);
    }

    // ========================================================================
    // INTERNAL HELPER FUNCTIONS
    // ========================================================================

    function _safeApproveWithReset(IERC20 token, address spender, uint256 amount) private {
        uint256 currentAllowance = token.allowance(address(this), spender);
        if (currentAllowance != 0) token.safeApprove(spender, 0);
        if (amount != 0) token.safeApprove(spender, amount);
    }

    receive() external payable {}
}
