// SPDX-License-Identifier: MIT
pragma solidity >=0.8.9;

interface IDineroVault {
    function balanceOf(address user) external view returns (uint256);

    function maxDineroAmount() external view returns (uint128);

    function mintedDineroAmount() external view returns (uint128);

    function deposit(uint256 amount) external;

    function withdraw(uint256 amount) external;
}
