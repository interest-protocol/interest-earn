// SPDX-License-Identifier: MIT
pragma solidity 0.8.15;

import "@interest-protocol/tokens/interfaces/InterestTokenInterface.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "./errors/CasaDePapelErrors.sol";
import "./interfaces/ICasaDePapel.sol";
import "./lib/DataTypes.sol";
import "./lib/Math.sol";

contract CasaDePapel is ICasaDePapel, Ownable {
    /*///////////////////////////////////////////////////////////////
                            LIBRARIES
    //////////////////////////////////////////////////////////////*/

    using SafeERC20 for IERC20;
    using Math for uint256;

    /*///////////////////////////////////////////////////////////////
                                STATE
    //////////////////////////////////////////////////////////////*/

    // Time when the minting of INT starts
    uint256 public immutable START_BLOCK;

    InterestTokenInterface private immutable INTEREST_TOKEN;

    // How many {InterestToken} to be minted per block.
    uint256 public interestTokenPerBlock;

    // Devs will receive 10% of all minted {InterestToken}.
    address public treasury;

    uint256 public treasuryBalance;

    Pool[] public pools;

    // PoolId -> User -> UserInfo.
    mapping(uint256 => mapping(address => User)) public userInfo;

    // Check if the token has a pool.
    mapping(address => bool) public hasPool;

    // Token => Id
    mapping(address => uint256) public getPoolId;

    // Total allocation points to know how much to allocate to a new pool.
    uint256 public totalAllocationPoints;

    /*///////////////////////////////////////////////////////////////
                            CONSTRUCTOR
    //////////////////////////////////////////////////////////////*/

    constructor(
        address _interestToken,
        address _treasury,
        uint256 _interestTokenPerBlock,
        uint256 _startBlock
    ) {
        INTEREST_TOKEN = InterestTokenInterface(_interestToken);
        START_BLOCK = _startBlock;
        interestTokenPerBlock = _interestTokenPerBlock;
        treasury = _treasury;

        hasPool[_interestToken] = true;
        getPoolId[_interestToken] = 0;

        // Setup the first pool. Stake {InterestToken} to get {InterestToken}.
        pools.push(
            Pool({
                stakingToken: _interestToken,
                allocationPoints: 1000,
                lastRewardBlock: _startBlock,
                accruedIntPerShare: 0,
                totalSupply: 0
            })
        );

        // Update the total points allocated
        totalAllocationPoints = 1000;
    }

    /*///////////////////////////////////////////////////////////////
                            MODIFIERS
    //////////////////////////////////////////////////////////////*/

    /**
     * @dev It updates the current rewards accrued in all pools. It is an optional feature in many functions. If the caller wishes to do.
     *
     * @notice This is a O(n) operation, which can cost a lot of gas.
     *
     * @param update bool value representing if the `msg.sender` wishes to update all pools.
     */
    modifier updatePools(bool update) {
        if (update) {
            updateAllPools();
        }
        _;
    }

    /*///////////////////////////////////////////////////////////////
                            VIEW FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    /**
     * @dev It returns the total number of pools in this contract.
     *
     * @return uint256 The total number of pools
     */
    function getPoolsLength() external view returns (uint256) {
        return pools.length;
    }

    /**
     * @dev This function will help the front-end know how many rewards the user has in the pool at any given block.
     *
     * @param poolId The id of the pool we wish to find the rewards for `_user`
     * @param _user The address of the user we wish to find his/her rewards
     */
    function getUserPendingRewards(uint256 poolId, address _user)
        external
        view
        returns (uint256)
    {
        // Save global state in memory.
        Pool memory pool = pools[poolId];
        User memory user = userInfo[poolId][_user];

        uint256 accruedIntPerShare = pool.accruedIntPerShare;
        uint256 totalSupply = pool.totalSupply;

        // If there are no tokens in the pool or if the user does not have any staked tokens. We return 0.
        // Remember that rewards are always paid in withdraws.
        if (totalSupply == 0 || user.amount == 0) return 0;

        // Need to run the same logic inside the {updatePool} function to be up to date to the last block.
        // This is a view function so we cannot actually update the pool.
        if (block.number > pool.lastRewardBlock) {
            uint256 blocksElaped = block.number - pool.lastRewardBlock;
            uint256 intReward = (blocksElaped * interestTokenPerBlock).mulDiv(
                pool.allocationPoints,
                totalAllocationPoints
            );
            accruedIntPerShare =
                accruedIntPerShare +
                intReward.wadDiv(totalSupply);
        }
        return user.amount.wadMul(accruedIntPerShare) - user.rewardsPaid;
    }

    /*///////////////////////////////////////////////////////////////
                            MUTATIVE FUNCTION
    //////////////////////////////////////////////////////////////*/

    function mintTreasuryRewards() external {
        uint256 amount = treasuryBalance;

        treasuryBalance = 0;

        INTEREST_TOKEN.mint(treasury, amount);
    }

    /**
     * @dev This function updates the rewards for the pool with id `poolId` and mints tokens for the {devAccount}.
     *
     * @param poolId The id of the pool to be updated.
     */
    function updatePool(uint256 poolId) external {
        uint256 intReward = _updatePool(poolId);

        // There is no point to mint 0 tokens.
        if (intReward > 0) {
            // We mint an additional 10% to the devAccount.

            unchecked {
                treasuryBalance += intReward.wadMul(0.1e18);
            }
        }
    }

    /**
     * @dev It updates the current rewards accrued in all pools. It is an optional feature in many functions. If the caller wishes to do.
     *
     * @notice This is a O(n) operation, which can cost a lot of gas.
     */
    function updateAllPools() public {
        uint256 length = pools.length;
        uint256 totalRewards;

        unchecked {
            for (uint256 i; i < length; i++) {
                totalRewards += _updatePool(i);
            }

            treasuryBalance += totalRewards;
        }
    }

    /**
     * @dev This function is used for all tokens other than {INTEREST_TOKEN}.
     *
     * @notice It assumes the user has given {approval} to this contract.
     * @notice It can be called to simply harvest the rewards if the `amount` is 0.
     *
     * @param poolId The id of the pool that the user wishes to make a deposit and/or harvest rewards.
     * @param amount the number of tokens the user wishes to deposit. It can be 0 to simply harvest the rewards.
     */
    function deposit(uint256 poolId, uint256 amount) external {
        // {INTEREST_TOKEN} has to be staked via the {staking} function.
        if (poolId == 0) revert CasaDePapel__NoInterestTokenDeposit();

        // Update all rewards before any operation for proper distribution of rewards.
        uint256 intReward = _updatePool(poolId);

        // Get global state in memory to save gas.
        Pool memory pool = pools[poolId];
        User memory user = userInfo[poolId][_msgSender()];

        // Variable to store how many rewards the user has accrued up to this block.
        uint256 pendingRewards;

        unchecked {
            // If the user does not have any tokens deposited in this pool. He also does not have rewards.
            // As we send all pending rewards on withdrawl and deposits.
            if (user.amount > 0) {
                // Calculate the user pending rewards by checking his % of the acruedIntPerShare minus what he got paid already.
                pendingRewards =
                    user.amount.wadMul(pool.accruedIntPerShare) -
                    user.rewardsPaid;
            }
        }

        // If he is making a deposit, we get the token and update the relevant state.
        if (amount > 0) {
            // Get the tokens from the user first
            IERC20(pool.stakingToken).safeTransferFrom(
                _msgSender(),
                address(this),
                amount
            );

            unchecked {
                // Update user deposited amount
                user.amount += amount;
            }

            // Update pool total supply
            pool.totalSupply += amount;
        }

        // He has been paid all rewards up to this point.
        user.rewardsPaid = user.amount.wadMul(pool.accruedIntPerShare);

        // Update global state
        pools[poolId] = pool;
        userInfo[poolId][_msgSender()] = user;

        // If the user has any pending rewards we send to him.
        if (pendingRewards > 0) {
            // Pay the user the rewards
            INTEREST_TOKEN.mint(_msgSender(), pendingRewards);
        }

        // There is no point to mint 0 tokens.
        if (intReward > 0) {
            unchecked {
                // We mint an additional 10% to the devAccount.
                treasuryBalance += intReward.wadMul(0.1e18);
            }
        }

        emit Deposit(_msgSender(), poolId, amount);
    }

    /**
     * @dev This function allows the user to withdraw his staked tokens from a pool at `poolId`.
     *
     * @notice It assumes the user has given {approval} to this contract.
     * @notice It can be called to simply harvest the rewards if the `amount` is 0.
     *
     * @param poolId the pool that `msg.sender` wishes to withdraw his funds from.
     * @param amount Number of tokens the `msg.sender` wishes to withdraw.
     */
    function withdraw(uint256 poolId, uint256 amount) external {
        // {INTEREST_TOKEN} has to be staked via the `staking` function.
        if (poolId == 0) revert CasaDePapel__NoInterestTokenWithdraw();

        User memory user = userInfo[poolId][_msgSender()];

        if (amount > user.amount) revert CasaDePapel__WithdrawAmountTooHigh();

        // Update the rewards to properly pay the user.
        uint256 intReward = _updatePool(poolId);

        // Get global state in memory to save gas.
        Pool memory pool = pools[poolId];

        // User always has rewards if he has staked tokens. Unless he deposits and withdraws in the same block.
        // Save user rewards before any state manipulation.
        uint256 pendingRewards = user
            .amount
            .wadMul(pool.accruedIntPerShare)
            .uncheckedSub(user.rewardsPaid);

        // User can wish to simply get his pending rewards.
        if (amount > 0) {
            // Update the relevant state and send tokens to the user.
            user.amount -= amount;
            unchecked {
                pool.totalSupply -= amount;
            }
        }

        // Update the amount of reward paid to the user.
        user.rewardsPaid = user.amount.wadMul(pool.accruedIntPerShare);

        // Update global state
        pools[poolId] = pool;
        userInfo[poolId][_msgSender()] = user;

        if (amount > 0) {
            IERC20(pool.stakingToken).safeTransfer(_msgSender(), amount);
        }

        // Send the rewards if the user has any pending rewards.
        if (pendingRewards > 0) {
            INTEREST_TOKEN.mint(_msgSender(), pendingRewards);
        }

        // There is no point to mint 0 tokens.
        if (intReward > 0) {
            unchecked {
                // We mint an additional 10% to the devAccount.
                treasuryBalance += intReward.wadMul(0.1e18);
            }
        }

        emit Withdraw(_msgSender(), _msgSender(), poolId, amount);
    }

    /**
     * @dev This function allows the `msg.sender` to deposit {INTEREST_TOKEN} and start earning more {INTEREST_TOKENS}.
     * We have a different function for this tokens because it gives a receipt token.
     *
     * @notice It also gives a receipt token {STAKED_INTEREST_TOKEN}. The receipt token will be needed to withdraw the tokens!
     *
     * @param amount The number of {INTEREST_TOKEN} the `msg.sender` wishes to stake
     */
    function stake(uint256 amount) external {
        // Update the pool to correctly calculate the rewards in this pool.
        uint256 intReward = _updatePool(0);

        // Save relevant state in memory.
        Pool memory pool = pools[0];
        User memory user = userInfo[0][_msgSender()];

        // Variable to store the rewards the user is entitled to get.
        uint256 pendingRewards;

        unchecked {
            // If the user does not have any staked tokens in the pool. We do not need to calculate the pending rewards.
            if (user.amount > 0) {
                // Note the base unit of {pool.accruedIntPerShare}.
                pendingRewards =
                    user.amount.wadMul(pool.accruedIntPerShare) -
                    user.rewardsPaid;
            }
        }

        // Similarly to the {deposit} function, the user can simply harvest the rewards.
        if (amount > 0) {
            // Get {INTEREST_TOKEN} from the `msg.sender`.
            IERC20(pool.stakingToken).safeTransferFrom(
                _msgSender(),
                address(this),
                amount
            );
            pool.totalSupply += amount;
            unchecked {
                // Update the relevant state if he is depositing tokens.
                user.amount += amount;
            }
        }

        // Update the state to indicate that the user has been paid all the rewards up to this block.
        user.rewardsPaid = user.amount.wadMul(pool.accruedIntPerShare);

        // Update the global state.
        pools[0] = pool;
        userInfo[0][_msgSender()] = user;

        // If the user has any pending rewards. We send it to him.
        if (pendingRewards > 0) {
            InterestTokenInterface(address(pool.stakingToken)).mint(
                _msgSender(),
                pendingRewards
            );
        }

        // There is no point to mint 0 tokens.
        if (intReward > 0) {
            unchecked {
                // We mint an additional 10% to the devAccount.
                treasuryBalance += intReward.wadMul(0.1e18);
            }
        }

        emit Deposit(_msgSender(), 0, amount);
    }

    /**
     * @dev This function is to withdraw the {INTEREST_TOKEN} from the pool.
     *
     * @notice The user must have an equivalent `amount` of {STAKED_INTEREST_TOKEN} to withdraw.
     * @notice A different user with maxed allowance and enough {STAKED_INTEREST_TOKEN} can withdraw in behalf of the `account`.
     * @notice We use Open Zeppelin version 4.5.0-rc.0 that has a {transferFrom} function that does not decrease the allowance if is the maximum uint256.
     *
     * @param account The address that will receive the tokens and rewards.
     * @param amount The number of {INTEREST_TOKEN} to withdraw to the `msg.sender`
     */
    function unstake(address account, uint256 amount) external {
        User memory user = userInfo[0][account];

        if (amount > user.amount) revert CasaDePapel__WithdrawAmountTooHigh();

        // Update the pool first to properly calculate the rewards.
        uint256 intReward = _updatePool(0);

        // Save relevant state in memory.
        Pool memory pool = pools[0];

        // Calculate the pending rewards.
        uint256 pendingRewards = user.amount.wadMul(pool.accruedIntPerShare) -
            user.rewardsPaid;

        // The user can opt to simply get the rewards, if he passes an `amount` of 0.
        if (amount > 0) {
            // `recipient` must have enough receipt tokens. As {STAKED_INTEREST_TOKEN}
            // totalSupply must always be equal to the `pool.totalSupply` of {INTEREST_TOKEN}.
            user.amount -= amount;
            unchecked {
                pool.totalSupply -= amount;
            }
        }

        // Update `account` rewardsPaid. `Account` has been  paid in full amount up to this block.
        user.rewardsPaid = user.amount.wadMul(pool.accruedIntPerShare);
        // Update the global state.
        pools[0] = pool;
        userInfo[0][account] = user;

        if (amount > 0) {
            IERC20(pool.stakingToken).safeTransfer(account, amount);
        }

        // If there are any pending rewards we {mint} for the `recipient`.
        if (pendingRewards > 0) {
            InterestTokenInterface(address(pool.stakingToken)).mint(
                account,
                pendingRewards
            );
        }

        // There is no point to mint 0 tokens.
        if (intReward > 0) {
            unchecked {
                // We mint an additional 10% to the devAccount.
                treasuryBalance += intReward.wadMul(0.1e18);
            }
        }
        emit Withdraw(_msgSender(), account, 0, amount);
    }

    /**
     * @dev It allows the user to withdraw his tokens from a pool without calculating the rewards.
     *
     * @notice  This function should only be called during urgent situations. The user will lose all pending rewards.
     * @notice To withdraw {INTEREST_TOKEN}, the user still needs the equivalent `amount` in {STAKTED_INTEREST_TOKEN}.
     * @notice One single function for all tokens and {INTEREST_TOKEN}.
     *
     * @param poolId the pool that the user wishes to completely exit.
     */
    function emergencyWithdraw(uint256 poolId) external {
        // No need to save gas on an urgent function
        Pool storage pool = pools[poolId];
        User storage user = userInfo[poolId][_msgSender()];

        uint256 amount = user.amount;

        // Clean user history
        user.amount = 0;
        user.rewardsPaid = 0;

        // Update the pool total supply
        pool.totalSupply -= amount;

        IERC20(pool.stakingToken).safeTransfer(_msgSender(), amount);

        emit EmergencyWithdraw(_msgSender(), poolId, amount);
    }

    /*///////////////////////////////////////////////////////////////
                            PRIVATE FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    /**
     * @dev This function updates the rewards for the pool with id `poolId`.
     *
     * @param poolId The id of the pool to be updated.
     */
    function _updatePool(uint256 poolId) private returns (uint256) {
        // Save storage in memory to save gas.
        Pool memory pool = pools[poolId];

        // If the rewards have been updated up to this block. We do not need to do anything.
        if (block.number == pool.lastRewardBlock) return 0;

        // Total amount of tokens in the pool.
        uint256 amountOfStakedTokens = pool.totalSupply;

        // If the pool is empty. We simply  need to update the last block the pool was updated.
        if (amountOfStakedTokens == 0) {
            pools[poolId].lastRewardBlock = block.number;
            return 0;
        }

        // Calculate how many blocks has passed since the last block.
        uint256 blocksElapsed = block.number.uncheckedSub(pool.lastRewardBlock);

        // We calculate how many {InterestToken} this pool is rewarded up to this block.
        uint256 intReward = (blocksElapsed * interestTokenPerBlock).mulDiv(
            pool.allocationPoints,
            totalAllocationPoints
        );

        // This value stores all rewards the pool ever got.
        // Note: this variable i already per share as we divide by the `amountOfStakedTokens`.
        pool.accruedIntPerShare += intReward.wadDiv(amountOfStakedTokens);

        pool.lastRewardBlock = block.number;

        // Update global state
        pools[poolId] = pool;

        emit UpdatePool(poolId, block.number, pool.accruedIntPerShare);

        return intReward;
    }

    /**
     * @dev This function updates the allocation points of the {INTEREST_TOKEN} pool rewards based on the allocation of all other pools
     */
    function _updateStakingPool() private {
        // Save global state in memory.
        uint256 _totalAllocationPoints = totalAllocationPoints;

        // Get the allocation of all pools - the {INTEREST_TOKEN} pool.
        uint256 allOtherPoolsPoints = _totalAllocationPoints -
            pools[0].allocationPoints;

        // {INTEREST_TOKEN} pool allocation points is always equal to 1/3 of all the other pools.
        // We reuse the same variable to save memory. Even though, it says allOtherPoolsPoints. At this point is the pool 0 points.
        allOtherPoolsPoints = allOtherPoolsPoints / 3;

        // Update the total allocation pools.
        _totalAllocationPoints -= pools[0].allocationPoints;
        _totalAllocationPoints += allOtherPoolsPoints;

        // Update the global state
        totalAllocationPoints = _totalAllocationPoints;
        pools[0].allocationPoints = allOtherPoolsPoints;
    }

    /*///////////////////////////////////////////////////////////////
                        ONLY OWNER FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    /**
     * @dev This function allows the {owner} to update the global minting of {INTEREST_TOKEN} per block.
     *
     * @param _interestTokenPerBlock how many {INTEREST_TOKEN} tokens to be minted per block.
     *
     * Requirements:
     *
     * - The `msg.sender` must be the {owner}. As we will have a documented scheduling for {INTEREST_TOKEN} emission.
     *
     */
    function setIPXPerBlock(uint256 _interestTokenPerBlock)
        external
        onlyOwner
        updatePools(true)
    {
        interestTokenPerBlock = _interestTokenPerBlock;
        emit NewInterestTokenRatePerBlock(_interestTokenPerBlock);
    }

    /**
     * @dev It allows the {owner} to update the {treasury} address
     *
     * @param _treasury the new treasury address
     */
    function setNewTreasury(address _treasury) external onlyOwner {
        treasury = _treasury;
        emit NewTreasury(treasury);
    }

    /**
     * @dev This function adds a new pool. At the end of this function, we update the pool 0 allocation.
     *
     * @param allocationPoints How many {INTEREST_TOKEN} rewards should be allocated to this pool in relation to others.
     * @param token The address of the staking token the pool will accept.
     * @param update If the caller wishes to update all pools. Care for gas cost.
     *
     * Requirements:
     *
     * - Only supported tokens by the protocol should be allowed for the health of the ecosystem.
     *
     */
    function addPool(
        uint256 allocationPoints,
        address token,
        bool update
    ) external onlyOwner updatePools(update) {
        // Prevent the owner from adding the same token twice, which will cause a rewards problems.
        if (hasPool[token]) revert CasaDePapel__PoolAlreadyAdded();

        // If the pool is added before the start block. The last rewardBlock is the startBlock
        uint256 lastRewardBlock = block.number > START_BLOCK
            ? block.number
            : START_BLOCK;

        // Register the `token` to prevent registering the same `token` twice.
        hasPool[token] = true;

        // Update the global total allocation points
        totalAllocationPoints += allocationPoints;

        // Add the pool
        pools.push(
            Pool({
                stakingToken: token,
                allocationPoints: allocationPoints,
                lastRewardBlock: lastRewardBlock,
                accruedIntPerShare: 0,
                totalSupply: 0
            })
        );

        // Update the pool 0.
        _updateStakingPool();

        uint256 id = pools.length.uncheckedSub(1);

        getPoolId[token] = id;

        emit AddPool(token, id, allocationPoints);
    }

    /**
     * @dev This function updates the allocation points of a pool. At the end this function updates the pool 0 allocation points.
     *
     * @param poolId The index of the pool to be updated.
     * @param allocationPoints The new value for the allocation points for the pool with `poolId`.
     * @param update Option to update all pools. Care for gas cost.
     *
     * Requirements:
     *
     * - This can be used to discontinue or incentivize different pools. We need to restrict this for the health of the ecosystem.
     *
     */
    function setAllocationPoints(
        uint256 poolId,
        uint256 allocationPoints,
        bool update
    ) external onlyOwner updatePools(update) {
        uint256 prevAllocationPoints = pools[poolId].allocationPoints;

        // No need to update if the new allocation point is the same as the previous one.
        if (prevAllocationPoints == allocationPoints) return;

        // Update the allocation points
        pools[poolId].allocationPoints = allocationPoints;

        uint256 _totalAllocationPoints = totalAllocationPoints;

        // Update the state
        _totalAllocationPoints -= prevAllocationPoints;
        _totalAllocationPoints += allocationPoints;

        // Update the global state.
        totalAllocationPoints = _totalAllocationPoints;

        // update the pool 0.
        _updateStakingPool();

        emit UpdatePoolAllocationPoint(poolId, allocationPoints);
    }
}
