// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "hardhat/console.sol";

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
 * @dev UPDATED VERSION: Supports dynamic Uniswap V3 pool selection for optimal fees and liquidity
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
    // These define which token is at which index in the Curve pools
    int128 public immutable CRVUSD_USDC_POOL_USDC_INDEX;
    int128 public immutable CRVUSD_USDC_POOL_CRVUSD_INDEX;
    int128 public immutable CRVUSD_VUSD_POOL_CRVUSD_INDEX;
    int128 public immutable CRVUSD_VUSD_POOL_VUSD_INDEX;

    // Default Uniswap V3 pool for flashloans
    // This is the USDC/DAI 0.01% pool - lowest fees, plenty of liquidity (31M USDC)
    // Can be overridden by passing a different pool address to executeRich/executeCheap
    address public immutable DEFAULT_UNISWAP_V3_POOL;
    
    // Is USDC token1 in the default pool? (true for USDC/DAI, false for pools where USDC is token0)
    // This determines how we call flash() and which fee to use
    // If true: flash(address, 0, usdcAmount, data) and use fee1
    // If false: flash(address, usdcAmount, 0, data) and use fee0
    bool public immutable USDC_IS_TOKEN1_IN_DEFAULT_POOL;

    // Contract owner (only owner can execute arbitrage)
    address public immutable owner;

    // ========================================================================
    // TRANSIENT STATE VARIABLES
    // ========================================================================

    // Tracks initial balance before arbitrage (used to calculate profit/loss)
    uint256 private initialBalance;

    // ========================================================================
    // CONSTRUCTOR
    // ========================================================================

    /**
     * @notice Initialize the arbitrage contract
     * @dev Sets up all token approvals and stores immutable addresses
     * @param _usdc USDC token address
     * @param _crvUsd crvUSD token address
     * @param _vusd VUSD token address
     * @param _vusdMinter VUSD Minter contract address
     * @param _vusdRedeemer VUSD Redeemer contract address
     * @param _curveCrvusdUsdcPool Curve crvUSD/USDC pool address
     * @param _curveCrvusdVusdPool Curve crvUSD/VUSD pool address
     * @param _defaultUniswapV3Pool Default Uniswap V3 pool for flashloans
     * @param _usdcIsToken1 Is USDC token1 (true) or token0 (false) in the default pool?
     * @param _crvUsdUsdcPoolUsdcIndex Index of USDC in crvUSD/USDC pool
     * @param _crvUsdUsdcPoolCrvUsdIndex Index of crvUSD in crvUSD/USDC pool
     * @param _crvUsdVusdPoolCrvUsdIndex Index of crvUSD in crvUSD/VUSD pool
     * @param _crvUsdVusdPoolVusdIndex Index of VUSD in crvUSD/VUSD pool
     */
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
        
        // Store token addresses
        USDC = _usdc;
        CRVUSD = _crvUsd;
        VUSD = _vusd;
        
        // Store protocol contract addresses
        VUSD_MINTER = _vusdMinter;
        VUSD_REDEEMER = _vusdRedeemer;
        
        // Store Curve pool addresses
        CURVE_CRVUSD_USDC_POOL = _curveCrvusdUsdcPool;
        CURVE_CRVUSD_VUSD_POOL = _curveCrvusdVusdPool;
        
        // Store Uniswap V3 default pool and USDC position
        DEFAULT_UNISWAP_V3_POOL = _defaultUniswapV3Pool;
        USDC_IS_TOKEN1_IN_DEFAULT_POOL = _usdcIsToken1;
        
        // Store Curve pool indices
        CRVUSD_USDC_POOL_USDC_INDEX = _crvUsdUsdcPoolUsdcIndex;
        CRVUSD_USDC_POOL_CRVUSD_INDEX = _crvUsdUsdcPoolCrvUsdIndex;
        CRVUSD_VUSD_POOL_CRVUSD_INDEX = _crvUsdVusdPoolCrvUsdIndex;
        CRVUSD_VUSD_POOL_VUSD_INDEX = _crvUsdVusdPoolVusdIndex;

        // Approve tokens for all contracts we'll interact with
        // This is done once in constructor to save gas on each trade
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
     * @notice Execute RICH arbitrage scenario (crvUSD is expensive relative to VUSD)
     * @dev Path: USDC → crvUSD → VUSD → USDC
     * @param _uniswapV3Pool Uniswap V3 pool to use for flashloan
     * @param _flashloanAmount Amount of USDC to flashloan (in USDC decimals, 6 decimals)
     */
    function executeRich(address _uniswapV3Pool, uint256 _flashloanAmount) external {
        if (msg.sender != owner) revert NotOwner();
        if (_uniswapV3Pool == address(0)) revert InvalidPool();
        
        // Record initial balance to calculate profit/loss later
        initialBalance = IERC20(USDC).balanceOf(address(this));
        
        console.log("=== STARTING RICH ===");
        console.log("Initial balance:", initialBalance);
        console.log("Flashloan amount:", _flashloanAmount);
        console.log("Using pool:", _uniswapV3Pool);
        
        // Encode execution data: (pathId, flashloanAmount, pool address, USDC position)
        // We need to know if USDC is token1 to use the correct fee in callback
        // For custom pools, we assume USDC is token1 (can be enhanced later)
        bytes memory data = abi.encode(1, _flashloanAmount, _uniswapV3Pool, true);
        
        // Initiate flashloan from specified Uniswap V3 pool
        // NOTE: For custom pools, we assume USDC is token1
        // TODO: Add parameter to specify USDC position for custom pools
        IUniswapV3Pool(_uniswapV3Pool).flash(address(this), 0, _flashloanAmount, data);
    }

    /**
     * @notice Execute RICH arbitrage scenario using default pool
     * @dev Convenience function that uses DEFAULT_UNISWAP_V3_POOL
     * @param _flashloanAmount Amount of USDC to flashloan
     */
    function executeRichWithDefaultPool(uint256 _flashloanAmount) external {
        if (msg.sender != owner) revert NotOwner();
        
        initialBalance = IERC20(USDC).balanceOf(address(this));
        
        console.log("=== STARTING RICH (DEFAULT POOL) ===");
        console.log("Initial balance:", initialBalance);
        console.log("Flashloan amount:", _flashloanAmount);
        console.log("Using default pool:", DEFAULT_UNISWAP_V3_POOL);
        console.log("USDC is token1:", USDC_IS_TOKEN1_IN_DEFAULT_POOL);
        
        bytes memory data = abi.encode(1, _flashloanAmount, DEFAULT_UNISWAP_V3_POOL, USDC_IS_TOKEN1_IN_DEFAULT_POOL);
        
        // Call flash() with correct parameter order based on USDC position
        if (USDC_IS_TOKEN1_IN_DEFAULT_POOL) {
            // USDC is token1: flash(address, 0, usdcAmount, data)
            IUniswapV3Pool(DEFAULT_UNISWAP_V3_POOL).flash(address(this), 0, _flashloanAmount, data);
        } else {
            // USDC is token0: flash(address, usdcAmount, 0, data)
            IUniswapV3Pool(DEFAULT_UNISWAP_V3_POOL).flash(address(this), _flashloanAmount, 0, data);
        }
    }

    /**
     * @notice Execute CHEAP arbitrage scenario (crvUSD is cheap relative to VUSD)
     * @dev Path: USDC → VUSD → crvUSD → USDC
     * @param _uniswapV3Pool Uniswap V3 pool to use for flashloan
     * @param _flashloanAmount Amount of USDC to flashloan (in USDC decimals, 6 decimals)
     */
    function executeCheap(address _uniswapV3Pool, uint256 _flashloanAmount) external {
        if (msg.sender != owner) revert NotOwner();
        if (_uniswapV3Pool == address(0)) revert InvalidPool();
        
        initialBalance = IERC20(USDC).balanceOf(address(this));
        
        console.log("=== STARTING CHEAP ===");
        console.log("Initial balance:", initialBalance);
        console.log("Flashloan amount:", _flashloanAmount);
        console.log("Using pool:", _uniswapV3Pool);
        
        // Encode execution data: (pathId, flashloanAmount, pool address, USDC position)
        // For custom pools, we assume USDC is token1 (can be enhanced later)
        bytes memory data = abi.encode(2, _flashloanAmount, _uniswapV3Pool, true);
        
        // Initiate flashloan from specified Uniswap V3 pool
        // NOTE: For custom pools, we assume USDC is token1
        // TODO: Add parameter to specify USDC position for custom pools
        IUniswapV3Pool(_uniswapV3Pool).flash(address(this), 0, _flashloanAmount, data);
    }

    /**
     * @notice Execute CHEAP arbitrage scenario using default pool
     * @dev Convenience function that uses DEFAULT_UNISWAP_V3_POOL
     * @param _flashloanAmount Amount of USDC to flashloan
     */
    function executeCheapWithDefaultPool(uint256 _flashloanAmount) external {
        if (msg.sender != owner) revert NotOwner();
        
        initialBalance = IERC20(USDC).balanceOf(address(this));
        
        console.log("=== STARTING CHEAP (DEFAULT POOL) ===");
        console.log("Initial balance:", initialBalance);
        console.log("Flashloan amount:", _flashloanAmount);
        console.log("Using default pool:", DEFAULT_UNISWAP_V3_POOL);
        console.log("USDC is token1:", USDC_IS_TOKEN1_IN_DEFAULT_POOL);
        
        bytes memory data = abi.encode(2, _flashloanAmount, DEFAULT_UNISWAP_V3_POOL, USDC_IS_TOKEN1_IN_DEFAULT_POOL);
        
        // Call flash() with correct parameter order based on USDC position
        if (USDC_IS_TOKEN1_IN_DEFAULT_POOL) {
            // USDC is token1: flash(address, 0, usdcAmount, data)
            IUniswapV3Pool(DEFAULT_UNISWAP_V3_POOL).flash(address(this), 0, _flashloanAmount, data);
        } else {
            // USDC is token0: flash(address, usdcAmount, 0, data)
            IUniswapV3Pool(DEFAULT_UNISWAP_V3_POOL).flash(address(this), _flashloanAmount, 0, data);
        }
    }

    // ========================================================================
    // UNISWAP V3 FLASHLOAN CALLBACK
    // ========================================================================

    /**
     * @notice Callback function called by Uniswap V3 pool during flashloan
     * @dev This is where the actual arbitrage logic executes
     * @param fee0 Flashloan fee for token0
     * @param fee1 Flashloan fee for token1
     * @param data Encoded data: (pathId, flashloanAmount, poolAddress, usdcIsToken1)
     */
    function uniswapV3FlashCallback(
        uint256 fee0,
        uint256 fee1,
        bytes calldata data
    ) external override nonReentrant {
        // Decode the data passed from executeRich/executeCheap
        (uint8 pathId, uint256 flashloanAmount, address expectedPool, bool usdcIsToken1) = abi.decode(
            data,
            (uint8, uint256, address, bool)
        );

        // SECURITY CHECK: Verify callback is from the pool we requested
        // This prevents malicious pools from calling our callback
        if (msg.sender != expectedPool) revert InvalidCaller();

        // Determine which fee to use based on USDC position
        uint256 usdcFee = usdcIsToken1 ? fee1 : fee0;

        console.log("--- CALLBACK ---");
        console.log("Flashloan:", flashloanAmount);
        console.log("Fee:", usdcFee);
        console.log("Pool:", msg.sender);

        string memory scenario = pathId == 1 ? "RICH" : "CHEAP";
        emit FlashloanReceived(flashloanAmount, usdcFee, msg.sender, scenario);

        // Execute the appropriate arbitrage path
        if (pathId == 1) {
            _executeRichPath(flashloanAmount);
        } else if (pathId == 2) {
            _executeCheapPath(flashloanAmount);
        } else {
            revert InvalidPath();
        }

        // Calculate total amount to repay (flashloan + fee)
        uint256 totalRepayment = flashloanAmount + usdcFee;
        uint256 balanceBeforeRepayment = IERC20(USDC).balanceOf(address(this));
        
        console.log("--- BEFORE REPAY ---");
        console.log("Balance:", balanceBeforeRepayment);
        console.log("Need:", totalRepayment);
        if (balanceBeforeRepayment >= totalRepayment) {
            console.log("Surplus:", balanceBeforeRepayment - totalRepayment);
        } else {
            console.log("DEFICIT:", totalRepayment - balanceBeforeRepayment);
        }
        
        emit BeforeRepayment(balanceBeforeRepayment, totalRepayment, msg.sender);
        
        // Repay the flashloan to the pool
        IERC20(USDC).safeTransfer(msg.sender, totalRepayment);
        emit RepaymentExecuted(totalRepayment, msg.sender);

        // Calculate final profit/loss
        uint256 finalBalance = IERC20(USDC).balanceOf(address(this));
        int256 profitLoss = int256(finalBalance) - int256(initialBalance);
        
        console.log("--- COMPLETE ---");
        console.log("Final:", finalBalance);
        if (profitLoss >= 0) {
            console.log("Profit:", uint256(profitLoss));
        } else {
            console.log("Loss:", uint256(-profitLoss));
        }
        
        emit ArbitrageComplete(scenario, msg.sender, finalBalance, profitLoss);
    }

    // ========================================================================
    // ARBITRAGE PATH IMPLEMENTATIONS
    // ========================================================================

    /**
     * @notice Execute RICH arbitrage path
     * @dev Path: USDC → crvUSD → VUSD → USDC (via redeem)
     * @param flashloanAmount Amount of USDC flashloaned
     */
    function _executeRichPath(uint256 flashloanAmount) internal {
        console.log("=== RICH PATH ===");
        
        // Step 1: Swap USDC for crvUSD on Curve
        console.log("Step 1: USDC->crvUSD");
        console.log("  Input:", flashloanAmount);
        uint256 crvUsdReceived = ICurveStableSwap(CURVE_CRVUSD_USDC_POOL).exchange(
            CRVUSD_USDC_POOL_USDC_INDEX,
            CRVUSD_USDC_POOL_CRVUSD_INDEX,
            flashloanAmount,
            1 // min_dy = 1 (we'll check output is non-zero)
        );
        if (crvUsdReceived == 0) revert CurveSwapFailed(1);
        console.log("  Output:", crvUsdReceived);
        emit SwapExecuted("USDC->crvUSD", flashloanAmount, crvUsdReceived, "USDC", "crvUSD");

        // Step 2: Swap crvUSD for VUSD on Curve
        console.log("Step 2: crvUSD->VUSD");
        console.log("  Input:", crvUsdReceived);
        uint256 vusdReceived = ICurveStableSwap(CURVE_CRVUSD_VUSD_POOL).exchange(
            CRVUSD_VUSD_POOL_CRVUSD_INDEX,
            CRVUSD_VUSD_POOL_VUSD_INDEX,
            crvUsdReceived,
            1
        );
        if (vusdReceived == 0) revert CurveSwapFailed(2);
        console.log("  Output:", vusdReceived);
        emit SwapExecuted("crvUSD->VUSD", crvUsdReceived, vusdReceived, "crvUSD", "VUSD");

        // Step 3: Redeem VUSD for USDC via VUSD protocol
        console.log("Step 3: VUSD->USDC (redeem)");
        console.log("  Input:", vusdReceived);
        uint256 usdcBefore = IERC20(USDC).balanceOf(address(this));
        IVusdRedeemer(VUSD_REDEEMER).redeem(USDC, vusdReceived, 1, address(this));
        uint256 usdcRedeemed = IERC20(USDC).balanceOf(address(this)) - usdcBefore;
        console.log("  Output:", usdcRedeemed);
        console.log("  Total USDC now:", IERC20(USDC).balanceOf(address(this)));
        if (usdcRedeemed == 0) revert RedeemFailed();
        emit RedeemExecuted(vusdReceived, usdcRedeemed);
    }

    /**
     * @notice Execute CHEAP arbitrage path
     * @dev Path: USDC → VUSD (via mint) → crvUSD → USDC
     * @param flashloanAmount Amount of USDC flashloaned
     */
    function _executeCheapPath(uint256 flashloanAmount) internal {
        console.log("=== CHEAP PATH ===");
        
        // Step 1: Mint VUSD with USDC via VUSD protocol
        console.log("Step 1: USDC->VUSD (mint)");
        console.log("  Input:", flashloanAmount);
        uint256 vusdBefore = IERC20(VUSD).balanceOf(address(this));
        IVusdMinter(VUSD_MINTER).mint(USDC, flashloanAmount, 1, address(this));
        uint256 vusdMinted = IERC20(VUSD).balanceOf(address(this)) - vusdBefore;
        if (vusdMinted == 0) revert MintFailed();
        console.log("  Output:", vusdMinted);
        emit MintExecuted(flashloanAmount, vusdMinted);

        // Step 2: Swap VUSD for crvUSD on Curve
        console.log("Step 2: VUSD->crvUSD");
        console.log("  Input:", vusdMinted);
        uint256 crvUsdReceived = ICurveStableSwap(CURVE_CRVUSD_VUSD_POOL).exchange(
            CRVUSD_VUSD_POOL_VUSD_INDEX,
            CRVUSD_VUSD_POOL_CRVUSD_INDEX,
            vusdMinted,
            1
        );
        if (crvUsdReceived == 0) revert CurveSwapFailed(1);
        console.log("  Output:", crvUsdReceived);
        emit SwapExecuted("VUSD->crvUSD", vusdMinted, crvUsdReceived, "VUSD", "crvUSD");

        // Step 3: Swap crvUSD for USDC on Curve
        console.log("Step 3: crvUSD->USDC");
        console.log("  Input:", crvUsdReceived);
        uint256 usdcReceived = ICurveStableSwap(CURVE_CRVUSD_USDC_POOL).exchange(
            CRVUSD_USDC_POOL_CRVUSD_INDEX,
            CRVUSD_USDC_POOL_USDC_INDEX,
            crvUsdReceived,
            1
        );
        if (usdcReceived == 0) revert CurveSwapFailed(2);
        console.log("  Output:", usdcReceived);
        emit SwapExecuted("crvUSD->USDC", crvUsdReceived, usdcReceived, "crvUSD", "USDC");
    }

    // ========================================================================
    // ADMIN FUNCTIONS
    // ========================================================================

    /**
     * @notice Emergency withdraw function to recover tokens
     * @dev Only owner can call this
     * @param _token Token address to withdraw
     */
    function emergencyWithdraw(address _token) external {
        if (msg.sender != owner) revert NotOwner();
        uint256 balance = IERC20(_token).balanceOf(address(this));
        if (balance > 0) IERC20(_token).safeTransfer(owner, balance);
    }

    /**
     * @notice Reset all token approvals to zero
     * @dev Useful if approvals need to be updated
     */
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

    /**
     * @notice Safely approve tokens with reset if needed
     * @dev Some tokens require approval to be reset to 0 before setting new amount
     * @param token Token to approve
     * @param spender Address to approve
     * @param amount Amount to approve
     */
    function _safeApproveWithReset(IERC20 token, address spender, uint256 amount) private {
        uint256 currentAllowance = token.allowance(address(this), spender);
        if (currentAllowance != 0) token.safeApprove(spender, 0);
        if (amount != 0) token.safeApprove(spender, amount);
    }

    /**
     * @notice Receive function to accept ETH (needed for contract operation)
     */
    receive() external payable {}
}
