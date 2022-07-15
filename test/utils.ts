import { ethers } from 'hardhat';
import { BigNumber } from 'ethers';

export const deploy = async (
  name: string,
  parameters: Array<unknown> = []
): Promise<any> => {
  const factory = await ethers.getContractFactory(name);
  return await factory.deploy(...parameters);
};

export const makeCalculateAccruedInt =
  (interestPerBlock: BigNumber) =>
  (
    accruedInterest: BigNumber,
    blocksElapsed: BigNumber,
    allocationPoints: BigNumber,
    totalAllocationPoints: BigNumber,
    totalSupply: BigNumber
  ): BigNumber => {
    const rewards = blocksElapsed
      .mul(interestPerBlock)
      .mul(allocationPoints)
      .div(totalAllocationPoints)
      .mul(ethers.utils.parseEther('1'));

    return accruedInterest.add(rewards.div(totalSupply));
  };

export const calculateUserPendingRewards = (
  userAmount: BigNumber,
  poolAccruedIntPerShare: BigNumber,
  userRewardsPaid: BigNumber
): BigNumber =>
  userAmount
    .mul(poolAccruedIntPerShare)
    .div(ethers.utils.parseEther('1'))
    .sub(userRewardsPaid);
