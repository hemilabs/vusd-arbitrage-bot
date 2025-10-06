// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

// Interface for Uniswap V3 Flashloans
interface IUniswapV3FlashCallback {
    function uniswapV3FlashCallback(
        uint256 fee0,
        uint256 fee1,
        bytes calldata data
    ) external;
}

// Interface for Uniswap V3 Pool
interface IUniswapV3Pool {
    function flash(
        address recipient,
        uint256 amount0,
        uint256 amount1,
        bytes calldata data
    ) external;
}

// Interface for Curve StableSwap Pools
interface ICurveStableSwap {
    // StableSwap pools use int128 for token indices
    function exchange(int128 i, int128 j, uint256 dx, uint256 min_dy) external returns (uint256);
}

// Interface for VUSD Minter
interface IVusdMinter {
    function mintingFee() external view returns (uint256); // in basis points
    function mint(address token, uint256 amount, uint256 minOut, address receiver) external returns (uint256);
}

// Interface for VUSD Redeemer
interface IVusdRedeemer {
    function redeemFee() external view returns (uint256); // in basis points
    function redeem(address token, uint256 amount, uint256 minOut, address receiver) external returns (uint256);
}

/**
 * @title VusdArbitrage
 * @author Based on specification by Akash
 * @notice Executes VUSD/crvUSD arbitrage strategies using a Uniswap V3 flashloan.
 * @dev Relies on off-chain simulation for profitability. Reads fees at runtime.
 */
contract VusdArbitrage is IUniswapV3FlashCallback, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // --- Custom Errors ---
    error InvalidCaller();
    error NotOwner();
    error FlashloanFailed();
    error CurveSwapFailed(uint8 step);
    error MintFailed();
    error RedeemFailed();
    error InvalidPath();

    // --- Constants & Immutable Variables ---

    // Token Addresses
    address public immutable USDC;
    address public immutable CRVUSD;
    address public immutable VUSD;

    // Protocol & Pool Addresses
    address public immutable VUSD_MINTER;
    address public immutable VUSD_REDEEMER;
    address public immutable CURVE_CRVUSD_USDC_POOL;
    address public immutable CURVE_CRVUSD_VUSD_POOL;
    address public immutable UNISWAP_V3_USDC_POOL;

    // Discovered Curve Pool Token Indices (for StableSwap pools)
    int128 public immutable CRVUSD_USDC_POOL_USDC_INDEX;
    int128 public immutable CRVUSD_USDC_POOL_CRVUSD_INDEX;
    int128 public immutable CRVUSD_VUSD_POOL_CRVUSD_INDEX;
    int128 public immutable CRVUSD_VUSD_POOL_VUSD_INDEX;

    // Ownership
    address public immutable owner;

    // --- Constructor ---

    constructor(
        // Addresses from config
        address _usdc,
        address _crvUsd,
        address _vusd,
        address _vusdMinter,
        address _vusdRedeemer,
        address _curveCrvusdUsdcPool,
        address _curveCrvusdVusdPool,
        address _uniswapV3UsdcPool,
        // Discovered indices from deployment script
        int128 _crvUsdUsdcPoolUsdcIndex,
        int128 _crvUsdUsdcPoolCrvUsdIndex,
        int128 _crvUsdVusdPoolCrvUsdIndex,
        int128 _crvUsdVusdPoolVusdIndex
    ) {
        owner = msg.sender;

        // Set token addresses
        USDC = _usdc;
        CRVUSD = _crvUsd;
        VUSD = _vusd;

        // Set protocol/pool addresses
        VUSD_MINTER = _vusdMinter;
        VUSD_REDEEMER = _vusdRedeemer;
        CURVE_CRVUSD_USDC_POOL = _curveCrvusdUsdcPool;
        CURVE_CRVUSD_VUSD_POOL = _curveCrvusdVusdPool;
        UNISWAP_V3_USDC_POOL = _uniswapV3UsdcPool;

        // Set discovered token indices
        CRVUSD_USDC_POOL_USDC_INDEX = _crvUsdUsdcPoolUsdcIndex;
        CRVUSD_USDC_POOL_CRVUSD_INDEX = _crvUsdUsdcPoolCrvUsdIndex;
        CRVUSD_VUSD_POOL_CRVUSD_INDEX = _crvUsdVusdPoolCrvUsdIndex;
        CRVUSD_VUSD_POOL_VUSD_INDEX = _crvUsdVusdPoolVusdIndex;

        // --- Token Approvals ---
        // Approve all necessary contracts to spend tokens held by this contract.
        // This is a one-time setup for gas efficiency.
        _safeApproveWithReset(IERC20(USDC), VUSD_MINTER, type(uint256).max);
        _safeApproveWithReset(IERC20(USDC), CURVE_CRVUSD_USDC_POOL, type(uint256).max);
        _safeApproveWithReset(IERC20(CRVUSD), CURVE_CRVUSD_USDC_POOL, type(uint256).max);
        _safeApproveWithReset(IERC20(CRVUSD), CURVE_CRVUSD_VUSD_POOL, type(uint256).max);
        _safeApproveWithReset(IERC20(VUSD), VUSD_REDEEMER, type(uint256).max);
        _safeApproveWithReset(IERC20(VUSD), CURVE_CRVUSD_VUSD_POOL, type(uint256).max);
    }

    // --- Owner-Only Execution Functions ---

    /**
     * @notice Executes the RICH scenario: USDC -> crvUSD -> VUSD -> USDC (redeem)
     * @param _flashloanAmount The amount of USDC to borrow (e.g., 10000 * 1e6 for 10,000 USDC)
     */
    function executeRich(uint256 _flashloanAmount) external {
        if (msg.sender != owner) revert NotOwner();
        bytes memory data = abi.encode(1, _flashloanAmount); // pathId = 1 for RICH
        IUniswapV3Pool(UNISWAP_V3_USDC_POOL).flash(address(this), _flashloanAmount, 0, data);
    }

    /**
     * @notice Executes the CHEAP scenario: USDC -> VUSD (mint) -> crvUSD -> USDC
     * @param _flashloanAmount The amount of USDC to borrow (e.g., 10000 * 1e6 for 10,000 USDC)
     */
    function executeCheap(uint256 _flashloanAmount) external {
        if (msg.sender != owner) revert NotOwner();
        bytes memory data = abi.encode(2, _flashloanAmount); // pathId = 2 for CHEAP
        IUniswapV3Pool(UNISWAP_V3_USDC_POOL).flash(address(this), _flashloanAmount, 0, data);
    }

    // --- Uniswap V3 Flashloan Callback ---

    /**
     * @notice The callback function executed by the Uniswap V3 pool after providing the flashloan.
     * @param fee0 The fee for token0 (USDC)
     * @param data The encoded data passed from the initial flash() call
     */
    function uniswapV3FlashCallback(
        uint256 fee0,
        uint256, // fee1 is not used as we only borrow token0 (USDC)
        bytes calldata data
    ) external override nonReentrant {
        // Security check: ensure the caller is the legitimate Uniswap V3 pool
        if (msg.sender != UNISWAP_V3_USDC_POOL) revert InvalidCaller();

        (uint8 pathId, uint256 flashloanAmount) = abi.decode(data, (uint8, uint256));

        // Route to the correct execution path based on the pathId
        if (pathId == 1) {
            _executeRichPath();
        } else if (pathId == 2) {
            _executeCheapPath();
        } else {
            revert InvalidPath();
        }

        // Repay the flashloan + fee
        uint256 totalRepayment = flashloanAmount + fee0;
        IERC20(USDC).safeTransfer(msg.sender, totalRepayment);
    }

    // --- Internal Execution Paths ---

    function _executeRichPath() internal {
        // Scenario: USDC -> crvUSD -> VUSD -> USDC (redeem)

        // Step 1: Swap USDC -> crvUSD
        uint256 usdcBalance = IERC20(USDC).balanceOf(address(this));
        uint256 crvUsdReceived = ICurveStableSwap(CURVE_CRVUSD_USDC_POOL).exchange(
            CRVUSD_USDC_POOL_USDC_INDEX,
            CRVUSD_USDC_POOL_CRVUSD_INDEX,
            usdcBalance,
            1 // min_dy = 1 wei, trust off-chain simulation for slippage
        );
        if (crvUsdReceived == 0) revert CurveSwapFailed(1);

        // Step 2: Swap crvUSD -> VUSD
        uint256 vusdReceived = ICurveStableSwap(CURVE_CRVUSD_VUSD_POOL).exchange(
            CRVUSD_VUSD_POOL_CRVUSD_INDEX,
            CRVUSD_VUSD_POOL_VUSD_INDEX,
            crvUsdReceived,
            1 // min_dy = 1 wei
        );
        if (vusdReceived == 0) revert CurveSwapFailed(2);

        // Step 3: Redeem VUSD -> USDC
        uint256 usdcRedeemed = IVusdRedeemer(VUSD_REDEEMER).redeem(USDC, vusdReceived, 1, address(this));
        if (usdcRedeemed == 0) revert RedeemFailed();
    }

    function _executeCheapPath() internal {
        // Scenario: USDC -> VUSD (mint) -> crvUSD -> USDC

        // Step 1: Mint USDC -> VUSD
        uint256 usdcBalance = IERC20(USDC).balanceOf(address(this));
        uint256 vusdMinted = IVusdMinter(VUSD_MINTER).mint(USDC, usdcBalance, 1, address(this));
        if (vusdMinted == 0) revert MintFailed();

        // Step 2: Swap VUSD -> crvUSD
        uint256 crvUsdReceived = ICurveStableSwap(CURVE_CRVUSD_VUSD_POOL).exchange(
            CRVUSD_VUSD_POOL_VUSD_INDEX,
            CRVUSD_VUSD_POOL_CRVUSD_INDEX,
            vusdMinted,
            1 // min_dy = 1 wei
        );
        if (crvUsdReceived == 0) revert CurveSwapFailed(1);

        // Step 3: Swap crvUSD -> USDC
        uint256 usdcReceived = ICurveStableSwap(CURVE_CRVUSD_USDC_POOL).exchange(
            CRVUSD_USDC_POOL_CRVUSD_INDEX,
            CRVUSD_USDC_POOL_USDC_INDEX,
            crvUsdReceived,
            1 // min_dy = 1 wei
        );
        if (usdcReceived == 0) revert CurveSwapFailed(2);
    }

    // --- Emergency Functions ---

    /**
     * @notice Allows owner to withdraw any accidentally sent ERC20 tokens.
     * @param _token The address of the token to withdraw.
     */
    function emergencyWithdraw(address _token) external {
        if (msg.sender != owner) revert NotOwner();
        uint256 balance = IERC20(_token).balanceOf(address(this));
        if (balance > 0) {
            IERC20(_token).safeTransfer(owner, balance);
        }
    }

    /**
     * @notice Resets all token approvals to zero. A safety measure.
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

    // --- Helper Functions ---

    /**
     * @dev Pattern from CurveKeeperTaker.sol. Safely approves spending, resetting to 0 first
     * if a previous allowance exists. This prevents known ERC20 approval race conditions.
     */
    function _safeApproveWithReset(IERC20 token, address spender, uint256 amount) private {
        uint256 currentAllowance = token.allowance(address(this), spender);
        if (currentAllowance != 0) {
            token.safeApprove(spender, 0);
        }
        if (amount != 0) {
            token.safeApprove(spender, amount);
        }
    }

    // Allow contract to receive ETH for gas payments if needed, although not directly used.
    receive() external payable {}
}
