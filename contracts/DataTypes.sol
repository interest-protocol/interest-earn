// SPDX-License-Identifier: CC-BY-4.0
pragma solidity >=0.8.9;

struct User {
    uint256 amount; // How many {StakingToken} the user has in a specific pool.
    uint256 rewardsPaid; // How many rewards the user has been paid so far.
}

struct Pool {
    address stakingToken; // The underlying token that is "farming" {InterestToken} rewards.
    uint256 allocationPoints; // These points determine how many {InterestToken} tokens the pool will get per block.
    uint256 lastRewardBlock; // The last block the pool has distributed rewards to properly calculate new rewards.
    uint256 accruedIntPerShare; // Total of accrued {InterestToken} tokens per share.
    uint256 totalSupply; // Total number of {StakingToken} the pool has in it.
}
