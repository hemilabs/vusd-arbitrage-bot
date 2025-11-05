// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

// ============================================================================
// GAS-OPTIMIZED & REFACTORED VERSION (v2.1.1)
// Implements 4 specific gas optimizations:
// 1. Removes `initialBalance` state var (saves 1 SSTORE + 1 SLOAD)
// 2. Removes redundant `if/else` on immutable `USDC_IS_TOKEN1_IN_DEFAULT_POOL`
// 3. Removes redundant `== 0` checks after external calls
// 4. Optimizes constructor approvals (saves deployment gas)
//
// Implements 1 code quality refactor:
// 1. Consolidates `execute...` logic into a private `_executeFlashloan` function
//
// Maintains all critical security features from v2.0:
// 1. Critical callback vulnerability fix (s_activePool check)
// 2. Slippage protection (min-out parameters)
// ============================================================================

// ============================================================================
// INTERFACES
// ============================================================================

interface IUniswapV3FlashCallback {
    function uniswapV3FlashCallback(uint256 fee0, uint256 fee1, bytes calldata data) external;
}

interface IUniswapV3Pool {
    function flash(address recipient, uint256 amount0, uint256 amount1, bytes calldata data) external;
}

interface ICurveStableSwap {
    function exchange(int128 i, int128 j, uint256 dx, uint256 min_dy) external returns (uint256);
}

interface IVusdMinter {
    function mint(address token, uint256 amount, uint256 minOut, address receiver) external;
}

interface IVusdRedeemer {
    function redeem(address token, uint256 amount, uint256 minOut, address receiver) external;
}

// ============================================================================
// VUSD ARBITRAGE CONTRACT
// ============================================================================

contract VusdArbitrage is IUniswapV3FlashCallback, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ========================================================================
    // STRUCTS
    // ========================================================================
    struct RichParams {
        uint256 minCrvUsdOut; // Min crvUSD from USDC
        uint256 minVusdOut; // Min VUSD from crvUSD
        uint256 minUsdcOut; // Min USDC from VUSD
    }

    struct CheapParams {
        uint256 minVusdOut; // Min VUSD from USDC
        uint256 minCrvUsdOut; // Min crvUSD from VUSD
        uint256 minUsdcOut; // Min USDC from crvUSD
    }

    // ========================================================================
    // EVENTS
    // ========================================================================
    event FlashloanReceived(uint256 amount, uint256 fee, address pool, string scenario);
    event SwapExecuted(string step, uint256 amountIn, uint256 amountOut, string tokenIn, string tokenOut);
    event MintExecuted(uint256 usdcIn, uint256 vusdOut);
    event RedeemExecuted(uint256 vusdIn, uint256 usdcOut);
    event BeforeRepayment(uint256 usdcBalance, uint256 repaymentRequired, address pool);
    event RepaymentExecuted(uint256 repaymentAmount, address pool);
    event ArbitrageComplete(string scenario, address pool, uint256 finalBalance, int256 profitLoss);

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
    error InvalidPoolData();

    // ========================================================================
    // IMMUTABLE STATE VARIABLES
    // ========================================================================
    address public immutable USDC;
    address public immutable CRVUSD;
    address public immutable VUSD;
    address public immutable VUSD_MINTER;
    address public immutable VUSD_REDEEMER;
    address public immutable CURVE_CRVUSD_USDC_POOL;
    address public immutable CURVE_CRVUSD_VUSD_POOL;
    int128 public immutable CRVUSD_USDC_POOL_USDC_INDEX;
    int128 public immutable CRVUSD_USDC_POOL_CRVUSD_INDEX;
    int128 public immutable CRVUSD_VUSD_POOL_CRVUSD_INDEX;
    int128 public immutable CRVUSD_VUSD_POOL_VUSD_INDEX;
    address public immutable DEFAULT_UNISWAP_V3_POOL;
    bool public immutable USDC_IS_TOKEN1_IN_DEFAULT_POOL;
    address public immutable owner;

    // ========================================================================
    // STATE VARIABLES
    // ========================================================================
    // `initialBalance` state var removed and passed via calldata to save gas
    address private s_activePool; // SECURITY FIX: Tracks the pool expecting a callback

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

        // GAS OPTIMIZATION: Use direct safeApprove
        IERC20(USDC).safeApprove(VUSD_MINTER, type(uint256).max);
        IERC20(USDC).safeApprove(CURVE_CRVUSD_USDC_POOL, type(uint256).max);
        IERC20(CRVUSD).safeApprove(CURVE_CRVUSD_USDC_POOL, type(uint256).max);
        IERC20(CRVUSD).safeApprove(CURVE_CRVUSD_VUSD_POOL, type(uint256).max);
        IERC20(VUSD).safeApprove(VUSD_REDEEMER, type(uint256).max);
        IERC20(VUSD).safeApprove(CURVE_CRVUSD_VUSD_POOL, type(uint256).max);
    }

    // ========================================================================
    // MAIN EXECUTION FUNCTIONS
    // ========================================================================
    function executeRichWithDefaultPool(uint256 _flashloanAmount, RichParams calldata _params) external {
        if (msg.sender != owner) revert NotOwner();
        if (_flashloanAmount == 0) revert InvalidPath();
        
        // GAS OPTIMIZATION: Get balance as local var, pass via calldata. (Saves SSTORE)
        uint256 initialUsdcBalance = IERC20(USDC).balanceOf(address(this));
        
        // GAS OPTIMIZATION: Pass initialUsdcBalance in calldata
        bytes memory data = abi.encode(1, _flashloanAmount, DEFAULT_UNISWAP_V3_POOL, USDC_IS_TOKEN1_IN_DEFAULT_POOL, initialUsdcBalance, _params);
        
        // Call the internal flashloan executor
        _executeFlashloan(_flashloanAmount, data);
    }

    function executeCheapWithDefaultPool(uint256 _flashloanAmount, CheapParams calldata _params) external {
        if (msg.sender != owner) revert NotOwner();
        if (_flashloanAmount == 0) revert InvalidPath();

        // GAS OPTIMIZATION: Get balance as local var, pass via calldata. (Saves SSTORE)
        uint256 initialUsdcBalance = IERC20(USDC).balanceOf(address(this));
        
        // GAS OPTIMIZATION: Pass initialUsdcBalance in calldata
        bytes memory data = abi.encode(2, _flashloanAmount, DEFAULT_UNISWAP_V3_POOL, USDC_IS_TOKEN1_IN_DEFAULT_POOL, initialUsdcBalance, _params);

        // Call the internal flashloan executor
        _executeFlashloan(_flashloanAmount, data);
    }
    
    // ========================================================================
    // UNISWAP V3 FLASHLOAN CALLBACK
    // ========================================================================
    function uniswapV3FlashCallback(uint256 fee0, uint256 fee1, bytes calldata data) external override nonReentrant {
        // CRITICAL SECURITY CHECK
        if (msg.sender != s_activePool) revert InvalidCaller();
        if (s_activePool == address(0)) revert InvalidCaller();
        
        address pool = s_activePool;
        s_activePool = address(0);
        
        uint256 usdcFee;
        uint256 totalRepayment;
        string memory scenario;
        uint256 initialUsdcBalance; // GAS OPTIMIZATION: local var for profit calculation
        
        uint8 pathId = abi.decode(data, (uint8));

        if (pathId == 1) {
            // GAS OPTIMIZATION: Decode initialUsdcBalance from calldata
            ( , uint256 flashloanAmount, address expectedPool, bool usdcIsToken1, uint256 _initialBalance, RichParams memory params) = abi.decode(data, (uint8, uint256, address, bool, uint256, RichParams));
            if (pool != expectedPool) revert InvalidPoolData();
            usdcFee = usdcIsToken1 ? fee1 : fee0;
            totalRepayment = flashloanAmount + usdcFee;
            initialUsdcBalance = _initialBalance;
            scenario = "RICH";
            emit FlashloanReceived(flashloanAmount, usdcFee, pool, scenario);
            _executeRichPath(flashloanAmount, params);
        } else if (pathId == 2) {
            // GAS OPTIMIZATION: Decode initialUsdcBalance from calldata
            ( , uint256 flashloanAmount, address expectedPool, bool usdcIsToken1, uint256 _initialBalance, CheapParams memory params) = abi.decode(data, (uint8, uint256, address, bool, uint256, CheapParams));
            if (pool != expectedPool) revert InvalidPoolData();
            usdcFee = usdcIsToken1 ? fee1 : fee0;
            totalRepayment = flashloanAmount + usdcFee;
            initialUsdcBalance = _initialBalance;
            scenario = "CHEAP";
            emit FlashloanReceived(flashloanAmount, usdcFee, pool, scenario);
            _executeCheapPath(flashloanAmount, params);
        } else {
            revert InvalidPath();
        }

        uint256 balanceBeforeRepayment = IERC20(USDC).balanceOf(address(this));
        emit BeforeRepayment(balanceBeforeRepayment, totalRepayment, pool);
        
        IERC20(USDC).safeTransfer(pool, totalRepayment);
        emit RepaymentExecuted(totalRepayment, pool);

        uint256 finalBalance = IERC20(USDC).balanceOf(address(this));
        // GAS OPTIMIZATION: Use local var instead of SLOAD
        int256 profitLoss = int256(finalBalance) - int256(initialUsdcBalance);
        emit ArbitrageComplete(scenario, pool, finalBalance, profitLoss);
    }
    
    // ========================================================================
    // ARBITRAGE PATH IMPLEMENTATIONS
    // ========================================================================
    function _executeRichPath(uint256 flashloanAmount, RichParams memory params) internal {
        uint256 crvUsdReceived = ICurveStableSwap(CURVE_CRVUSD_USDC_POOL).exchange(CRVUSD_USDC_POOL_USDC_INDEX, CRVUSD_USDC_POOL_CRVUSD_INDEX, flashloanAmount, params.minCrvUsdOut);
        // GAS OPTIMIZATION: Removed redundant `crvUsdReceived == 0` check
        emit SwapExecuted("USDC->crvUSD", flashloanAmount, crvUsdReceived, "USDC", "crvUSD");

        uint256 vusdReceived = ICurveStableSwap(CURVE_CRVUSD_VUSD_POOL).exchange(CRVUSD_VUSD_POOL_CRVUSD_INDEX, CRVUSD_VUSD_POOL_VUSD_INDEX, crvUsdReceived, params.minVusdOut);
        // GAS OPTIMIZATION: Removed redundant `vusdReceived == 0` check
        emit SwapExecuted("crvUSD->VUSD", crvUsdReceived, vusdReceived, "crvUSD", "VUSD");
        
        uint256 usdcBefore = IERC20(USDC).balanceOf(address(this));
        IVusdRedeemer(VUSD_REDEEMER).redeem(USDC, vusdReceived, params.minUsdcOut, address(this));
        uint256 usdcRedeemed = IERC20(USDC).balanceOf(address(this)) - usdcBefore;
        // GAS OPTIMIZATION: Removed redundant `usdcRedeemed == 0` check
        emit RedeemExecuted(vusdReceived, usdcRedeemed);
    }

    function _executeCheapPath(uint256 flashloanAmount, CheapParams memory params) internal {
        uint256 vusdBefore = IERC20(VUSD).balanceOf(address(this));
        IVusdMinter(VUSD_MINTER).mint(USDC, flashloanAmount, params.minVusdOut, address(this));
        uint256 vusdMinted = IERC20(VUSD).balanceOf(address(this)) - vusdBefore;
        // GAS OPTIMIZATION: Removed redundant `vusdMinted == 0` check
        emit MintExecuted(flashloanAmount, vusdMinted);
        
        uint256 crvUsdReceived = ICurveStableSwap(CURVE_CRVUSD_VUSD_POOL).exchange(CRVUSD_VUSD_POOL_VUSD_INDEX, CRVUSD_VUSD_POOL_CRVUSD_INDEX, vusdMinted, params.minCrvUsdOut);
        // GAS OPTIMIZATION: Removed redundant `crvUsdReceived == 0` check
        emit SwapExecuted("VUSD->crvUSD", vusdMinted, crvUsdReceived, "VUSD", "crvUSD");
        
        uint256 usdcReceived = ICurveStableSwap(CURVE_CRVUSD_USDC_POOL).exchange(CRVUSD_USDC_POOL_CRVUSD_INDEX, CRVUSD_USDC_POOL_USDC_INDEX, crvUsdReceived, params.minUsdcOut);
        // GAS OPTIMIZATION: Removed redundant `usdcReceived == 0` check
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
    
    /**
     * @dev Internal function to execute the Uniswap V3 flashloan.
     * REFACTORED to consolidate logic from executeRich/Cheap.
     */
    function _executeFlashloan(uint256 _flashloanAmount, bytes memory _data) private {
        s_activePool = DEFAULT_UNISWAP_V3_POOL;

        // GAS OPTIMIZATION: Removed if/else check on immutable var
        uint256 amount0 = USDC_IS_TOKEN1_IN_DEFAULT_POOL ? 0 : _flashloanAmount;
        uint256 amount1 = USDC_IS_TOKEN1_IN_DEFAULT_POOL ? _flashloanAmount : 0;
        
        IUniswapV3Pool(DEFAULT_UNISWAP_V3_POOL).flash(address(this), amount0, amount1, _data);
        
        s_activePool = address(0);
    }

    function _safeApproveWithReset(IERC20 token, address spender, uint256 amount) private {
        uint256 currentAllowance = token.allowance(address(this), spender);
        if (currentAllowance != 0) token.safeApprove(spender, 0);
        if (amount != 0) token.safeApprove(spender, amount);
    }

    receive() external payable {}
}
