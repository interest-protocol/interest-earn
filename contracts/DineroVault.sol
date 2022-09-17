// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "@interest-protocol/tokens/interfaces/IDinero.sol";
import "@interest-protocol/library/MathLib.sol";
import "@interest-protocol/library/SafeTransferErrors.sol";
import "@interest-protocol/library/SafeTransferLib.sol";
import "@interest-protocol/library/SafeCastLib.sol";

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/interfaces/IERC20Metadata.sol";

contract DineroVault is Ownable, SafeTransferErrors {
    /*///////////////////////////////////////////////////////////////
                            LIBRARIES
    //////////////////////////////////////////////////////////////*/

    using SafeTransferLib for address;
    using MathLib for uint256;
    using SafeCastLib for uint256;

    /*///////////////////////////////////////////////////////////////
                              EVENTS
    //////////////////////////////////////////////////////////////*/

    event Deposit(
        address indexed user,
        uint256 underlyingAmount,
        uint256 dineroAmount
    );

    event Withdraw(
        address indexed user,
        uint256 underlyingAmount,
        uint256 dineroAmount
    );

    event MaxDineroAmount(uint256 oldValue, uint256 newValue);

    /*///////////////////////////////////////////////////////////////
                              ERRORS
    //////////////////////////////////////////////////////////////*/

    error DineroVault__MaxDineroAmountReached();

    /*///////////////////////////////////////////////////////////////
                              STATE
    //////////////////////////////////////////////////////////////*/

    IDinero private immutable DINERO;

    address private immutable UNDERLYING;

    uint8 private immutable DECIMALS;

    /*///////////////////////////////////////////////////////////////
                              STATE
    //////////////////////////////////////////////////////////////*/

    /*//////////////////////////////////////////////////////////////
                       STORAGE  SLOT 0                            */

    // USER -> Underlying Amount
    mapping(address => uint256) public balanceOf;

    //////////////////////////////////////////////////////////////

    /*//////////////////////////////////////////////////////////////
                       STORAGE  SLOT 1                           */

    // This vault has a maximum amount of Dinero it can create to limit Dinero's collateral risk.
    uint128 public maxDineroAmount;

    // The total amount of Dinero created by this contract.
    uint128 public mintedDineroAmount;

    /*///////////////////////////////////////////////////////////////
                              CONSTRUCTOR
    //////////////////////////////////////////////////////////////*/

    constructor(
        IDinero dinero,
        address underlying,
        uint256 _maxDineroAmount
    ) {
        DINERO = dinero;
        UNDERLYING = underlying;
        DECIMALS = IERC20Metadata(underlying).decimals();

        maxDineroAmount = _maxDineroAmount.toUint128();
    }

    /**
     * @notice It allows a user to deposit a stablecoin and receive the same amount in Dinero.
     * @param amount The number of underlying tokens the caller wishes to deposit.
     */
    function deposit(uint256 amount) external {
        // Get the underlying from the caller
        UNDERLYING.safeTransferFrom(msg.sender, address(this), amount);

        // Adjust the amount to 18 decimals. Some ERC20 tokens do not have 18 decimals.
        uint256 dnrAmount = amount.adjust(DECIMALS);

        // Update the total minted amount
        mintedDineroAmount += dnrAmount.toUint128();

        // Make sure that we are minting less than the maximum amount allowed
        if (mintedDineroAmount > maxDineroAmount)
            revert DineroVault__MaxDineroAmountReached();

        unchecked {
            // Save how much underlying the user has deposited
            balanceOf[msg.sender] += amount;
        }

        // Mint Dinero to the user
        DINERO.mint(msg.sender, dnrAmount);

        emit Deposit(msg.sender, amount, dnrAmount);
    }

    /**
     * @notice It allows users to withdraw their deposited stablecoin.
     * @param amount The number of underlying tokens the caller wishes to withdraw.
     */
    function withdraw(uint256 amount) external {
        // User must have enough underlying to withdraw.
        balanceOf[msg.sender] -= amount;

        // Adjust the amount to 18 decimals. Some ERC20 tokens do not have 18 decimals.
        uint256 dnrAmount = amount.adjust(DECIMALS);

        unchecked {
            // Update the total minted amount
            mintedDineroAmount -= dnrAmount.toUint128();
        }

        DINERO.burn(msg.sender, dnrAmount);

        UNDERLYING.safeTransfer(msg.sender, amount);

        emit Withdraw(msg.sender, amount, dnrAmount);
    }

    /*///////////////////////////////////////////////////////////////
                             OWNER ONLY
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice It updates the maximum amount of Dinero this contract can create.
     * @param _maxDineroAmount The new maximum amount of Dinero this contract can create.
     */
    function setMaxDineroAmount(uint256 _maxDineroAmount) external onlyOwner {
        emit MaxDineroAmount(maxDineroAmount, _maxDineroAmount);

        maxDineroAmount = _maxDineroAmount.toUint128();
    }
}
