import { loadFixture, mine } from '@nomicfoundation/hardhat-network-helpers';
import { anyUint } from '@nomicfoundation/hardhat-chai-matchers/withArgs';
import { expect } from 'chai';
import { ethers, network } from 'hardhat';
import { CasaDePapel, MintableERC20 } from '../typechain-types';
import { BigNumber } from 'ethers';
import {
  deploy,
  makeCalculateAccruedInt,
  calculateUserPendingRewards,
} from './utils';

const { parseEther } = ethers.utils;

const START_BLOCK = 10;

const INTEREST_PER_BLOCK = parseEther('15');

const calculateAccruedInt = makeCalculateAccruedInt(INTEREST_PER_BLOCK);

async function deployFixture() {
  // Contracts are deployed using the first signer/account by default
  const [owner, alice, bob, treasury] = await ethers.getSigners();

  const [btc, ether, interestToken] = await Promise.all([
    deploy('MintableERC20', ['Bitcoin', 'BTC']) as Promise<MintableERC20>,
    deploy('MintableERC20', ['Ether', 'ETH']) as Promise<MintableERC20>,
    deploy('MintableERC20', [
      'Interest Token',
      'IPX',
    ]) as Promise<MintableERC20>,
  ]);

  const casaDePapel: CasaDePapel = await deploy('CasaDePapel', [
    interestToken.address,
    treasury.address,
    INTEREST_PER_BLOCK,
    START_BLOCK,
  ]);

  await Promise.all([
    btc.mint(alice.address, parseEther('1500')),
    btc
      .connect(alice)
      .approve(casaDePapel.address, ethers.constants.MaxUint256),
    ether.mint(alice.address, parseEther('1500')),
    ether
      .connect(alice)
      .approve(casaDePapel.address, ethers.constants.MaxUint256),
    interestToken.mint(alice.address, parseEther('1500')),
    interestToken
      .connect(alice)
      .approve(casaDePapel.address, ethers.constants.MaxUint256),
    btc.mint(bob.address, parseEther('1500')),
    btc.connect(bob).approve(casaDePapel.address, ethers.constants.MaxUint256),
    ether.mint(bob.address, parseEther('1500')),
    ether
      .connect(bob)
      .approve(casaDePapel.address, ethers.constants.MaxUint256),
    interestToken.mint(bob.address, parseEther('1500')),
    interestToken
      .connect(bob)
      .approve(casaDePapel.address, ethers.constants.MaxUint256),
  ]);

  return {
    btc,
    interestToken,
    ether,
    casaDePapel,
    owner,
    alice,
    bob,
    treasury,
  };
}

describe('Casa De Papel', function () {
  it('initializes the contract properly', async () => {
    const { casaDePapel, interestToken, treasury } = await loadFixture(
      deployFixture
    );

    const data = await Promise.all([
      casaDePapel.START_BLOCK(),
      casaDePapel.interestTokenPerBlock(),
      casaDePapel.treasury(),
      casaDePapel.hasPool(interestToken.address),
      casaDePapel.getPoolId(interestToken.address),
      casaDePapel.pools(0),
      casaDePapel.totalAllocationPoints(),
    ]);

    expect(data[0]).to.be.equal(START_BLOCK);
    expect(data[1]).to.be.equal(INTEREST_PER_BLOCK);
    expect(data[2]).to.be.equal(treasury.address);
    expect(data[3]).to.be.equal(true);
    expect(data[4]).to.be.equal(0);
    expect(data[5].stakingToken).to.be.equal(interestToken.address);
    expect(data[5].allocationPoints).to.be.equal(1000);
    expect(data[5].lastRewardBlock).to.be.equal(START_BLOCK);
    expect(data[5].accruedIntPerShare).to.be.equal(0);
    expect(data[5].totalSupply).to.be.equal(0);
    expect(data[6]).to.be.equal(1000);
  });

  it('returns the total pool lengths', async () => {
    const { casaDePapel, btc } = await loadFixture(deployFixture);

    expect(await casaDePapel.getPoolsLength()).to.be.equal(1);

    await casaDePapel.addPool(1000, btc.address, false);

    expect(await casaDePapel.getPoolsLength()).to.be.equal(2);
  });

  describe('function: setAllocationPoints', () => {
    it('reverts if the caller is not the owner', async () => {
      const { casaDePapel, alice } = await loadFixture(deployFixture);
      await expect(
        casaDePapel.connect(alice).setAllocationPoints(1, 500, false)
      ).to.revertedWith('Ownable: caller is not the owner');
    });
    it("does not update the pool allocation if the points don't change", async () => {
      const { casaDePapel, owner, btc } = await loadFixture(deployFixture);

      await casaDePapel.connect(owner).addPool(1500, btc.address, false);
      await expect(
        casaDePapel.connect(owner).setAllocationPoints(1, 3000, false)
      )
        .to.emit(casaDePapel, 'UpdatePoolAllocationPoint')
        .withArgs(1, 3000);

      await expect(
        casaDePapel.connect(owner).setAllocationPoints(1, 3000, false)
      ).to.not.emit(casaDePapel, 'UpdatePoolAllocationPoint');
    });
    it('updates a pool allocation points without updating all pools', async () => {
      const { casaDePapel, owner, btc } = await loadFixture(deployFixture);

      await casaDePapel.connect(owner).addPool(1500, btc.address, false);
      const [interesTokenPool, btcPool, totalAllocationPoints] =
        await Promise.all([
          casaDePapel.pools(0),
          casaDePapel.pools(1),
          casaDePapel.totalAllocationPoints(),
        ]);
      // Interest Pool gets 1/3 of 1500 (500) and adds it becoming it's allocation. So the total becomes 1500 + 2000
      expect(interesTokenPool.allocationPoints).to.be.equal(500);
      expect(btcPool.allocationPoints).to.be.equal(1500);
      expect(totalAllocationPoints).to.be.equal(2000);

      await casaDePapel.connect(owner).setAllocationPoints(1, 3000, false);

      const [interesTokenPool1, btcPool1, TotalAllocationPoints1] =
        await Promise.all([
          casaDePapel.pools(0),
          casaDePapel.pools(1),
          casaDePapel.totalAllocationPoints(),
        ]);

      // Interest Pool gets 1/3 of 1500 (500) and adds it becoming it's allocation. So the total becomes 1500 + 2000
      expect(interesTokenPool1.allocationPoints).to.be.equal(1000);
      expect(btcPool1.allocationPoints).to.be.equal(3000);
      expect(TotalAllocationPoints1).to.be.equal(4000);
      // Tests if the we call updateAllPools
      expect(btcPool.lastRewardBlock).to.be.equal(btcPool1.lastRewardBlock);
    });
    it('updates a pool allocation points and updates all pools data', async () => {
      const { casaDePapel, owner, btc, ether, alice, bob } = await loadFixture(
        deployFixture
      );

      // Adds two pools
      await casaDePapel.connect(owner).addPool(1500, btc.address, false);
      await casaDePapel.connect(owner).addPool(1500, ether.address, false);

      const [interestPool, btcPool, etherPool, totalAllocationPoints] =
        await Promise.all([
          casaDePapel.pools(0),
          casaDePapel.pools(1),
          casaDePapel.pools(2),
          casaDePapel.totalAllocationPoints(),
          casaDePapel.connect(alice).deposit(1, parseEther('100')),
          casaDePapel.connect(bob).deposit(1, parseEther('50')),
          casaDePapel.connect(alice).deposit(2, parseEther('100')),
          casaDePapel.connect(bob).deposit(2, parseEther('200')),
        ]);
      // Interest Pool gets 1/3 of 1500 (500) and adds it becoming it's allocation. So the total becomes 1500 + 2000
      expect(interestPool.allocationPoints).to.be.equal(1000);
      expect(btcPool.allocationPoints).to.be.equal(1500);
      expect(etherPool.allocationPoints).to.be.equal(1500);
      expect(totalAllocationPoints).to.be.equal(4000);
      expect(btcPool.accruedIntPerShare).to.be.equal(0); // Fetched before the deposit update
      expect(etherPool.accruedIntPerShare).to.be.equal(0); // Fetched before the deposit update

      // This is before the updateAllPools are called
      const [btcPool1, etherPool1, totalAllocationPoints1] = await Promise.all([
        casaDePapel.pools(1),
        casaDePapel.pools(2),
        casaDePapel.totalAllocationPoints(),
      ]);

      await casaDePapel.connect(owner).setAllocationPoints(1, 3000, true);

      const [interestPool2, btcPool2, etherPool2, totalAllocationPoints2] =
        await Promise.all([
          casaDePapel.pools(0),
          casaDePapel.pools(1),
          casaDePapel.pools(2),
          casaDePapel.totalAllocationPoints(),
        ]);

      // Interest Pool gets 1/3 of 1500 (500) and adds it becoming it's allocation. So the total becomes 1500 + 2000
      expect(interestPool2.allocationPoints).to.be.equal(1500);
      expect(btcPool2.allocationPoints).to.be.equal(3000);
      expect(etherPool2.allocationPoints).to.be.equal(1500);
      expect(totalAllocationPoints2).to.be.equal(6000);
      // Tests below here test the updateAllPools logic
      expect(btcPool2.lastRewardBlock.toNumber()).to.be.greaterThan(
        btcPool1.lastRewardBlock.toNumber()
      );
      expect(etherPool2.lastRewardBlock.toNumber()).to.be.greaterThan(
        etherPool1.lastRewardBlock.toNumber()
      );
      expect(btcPool2.accruedIntPerShare).to.be.equal(
        calculateAccruedInt(
          btcPool1.accruedIntPerShare,
          btcPool2.lastRewardBlock.sub(btcPool1.lastRewardBlock),
          btcPool1.allocationPoints,
          totalAllocationPoints1,
          btcPool1.totalSupply
        )
      );
      expect(etherPool2.accruedIntPerShare).to.be.equal(
        calculateAccruedInt(
          etherPool1.accruedIntPerShare,
          etherPool2.lastRewardBlock.sub(etherPool1.lastRewardBlock),
          etherPool1.allocationPoints,
          totalAllocationPoints1,
          etherPool1.totalSupply
        )
      );
    });
  });

  describe('function: addPool', () => {
    it('reverts if the caller is not the owner', async () => {
      const { casaDePapel, btc, alice } = await loadFixture(deployFixture);

      await expect(
        casaDePapel.connect(alice).addPool(1000, btc.address, false)
      ).to.revertedWith('Ownable: caller is not the owner');
    });
    it('updates all other pools if requested', async () => {
      const { casaDePapel, btc, ether, owner } = await loadFixture(
        deployFixture
      );

      // Adding a pool to test
      await casaDePapel.connect(owner).addPool(1500, btc.address, false);

      const btcPool = await casaDePapel.pools(1);

      // Add a second pool to test if the first was updated
      await casaDePapel.connect(owner).addPool(2000, ether.address, true);

      // Since we asked for an update the lastRewardBlock must have been updated
      const btcPool1 = await casaDePapel.pools(1);

      expect(btcPool.lastRewardBlock.toNumber()).to.be.lessThan(
        btcPool1.lastRewardBlock.toNumber()
      );
    });
    it('reverts if you add the same pool twice', async () => {
      const { casaDePapel, btc, owner } = await loadFixture(deployFixture);

      await casaDePapel.connect(owner).addPool(1500, btc.address, false);
      await expect(
        casaDePapel.connect(owner).addPool(1500, btc.address, false)
      ).to.be.rejectedWith('CasaDePapel__PoolAlreadyAdded()');
    });
    it('sets the start block as the last reward block if the pool is added before the start block', async () => {
      const { btc, owner, interestToken, treasury } = await loadFixture(
        deployFixture
      );

      // Need to redeploy casa de papel with longer start_block
      const casaDePapel2: CasaDePapel = await deploy('CasaDePapel', [
        interestToken.address,
        treasury.address,
        INTEREST_PER_BLOCK,
        START_BLOCK * 3,
      ]);

      // Adding a pool to test
      await casaDePapel2.connect(owner).addPool(1500, btc.address, false);

      const xFarm = await casaDePapel2.pools(1);

      expect(xFarm.lastRewardBlock).to.be.equal(START_BLOCK * 3);
    });
    it('adds a new pool', async () => {
      const { casaDePapel, owner, btc } = await loadFixture(deployFixture);

      const [totalPools, totalAllocationPoints, interestPool] =
        await Promise.all([
          casaDePapel.getPoolsLength(),
          casaDePapel.totalAllocationPoints(),
          casaDePapel.pools(0),
        ]);

      expect(totalPools).to.be.equal(1);
      expect(totalAllocationPoints).to.be.equal(1000);
      expect(interestPool.allocationPoints).to.be.equal(1000);

      await casaDePapel.connect(owner).addPool(1500, btc.address, false);

      // Refresh the relevant state to ensure it was properly updated
      const [
        blockNumber,
        totalPools1,
        totalAllocationPoints1,
        interestPool1,
        xFarm,
      ] = await Promise.all([
        ethers.provider.getBlockNumber(),
        casaDePapel.getPoolsLength(),
        casaDePapel.totalAllocationPoints(),
        casaDePapel.pools(0),
        casaDePapel.pools(1),
      ]);

      expect(totalPools1).to.be.equal(2);
      expect(totalAllocationPoints1).to.be.equal(2000);
      expect(interestPool1.allocationPoints).to.be.equal(500);
      expect(xFarm.allocationPoints).to.be.equal(1500);
      expect(xFarm.lastRewardBlock).to.be.equal(blockNumber);
      expect(xFarm.stakingToken).to.be.equal(btc.address);
      expect(xFarm.accruedIntPerShare).to.be.equal(0);
      expect(xFarm.totalSupply).to.be.equal(0);
    });
  });

  describe('function: setIPXPerBlock', () => {
    it('reverts if the caller is not the owner', async () => {
      const { casaDePapel, alice } = await loadFixture(deployFixture);

      await expect(
        casaDePapel.connect(alice).setIPXPerBlock(parseEther('1'))
      ).to.revertedWith('Ownable: caller is not the owner');
    });
    it('updates all other pools if requested', async () => {
      const { casaDePapel, owner } = await loadFixture(deployFixture);

      const [interestPool, interestTokenPerBlock] = await Promise.all([
        casaDePapel.pools(0),
        casaDePapel.interestTokenPerBlock(),
      ]);

      await mine(START_BLOCK + 1);

      await expect(casaDePapel.connect(owner).setIPXPerBlock(parseEther('1')))
        .to.emit(casaDePapel, 'NewInterestTokenRatePerBlock')
        .withArgs(parseEther('1'));

      // last reward BEFORE update
      expect(interestPool.lastRewardBlock).to.be.equal(START_BLOCK);
      // last reward AFTER UPDATE
      expect(
        (await casaDePapel.pools(0)).lastRewardBlock.toNumber()
      ).to.be.greaterThan(START_BLOCK);

      // interest token per block BEFORE update
      expect(interestTokenPerBlock).to.be.equal(INTEREST_PER_BLOCK);
      // interest token per block AFTER update
      expect(await casaDePapel.interestTokenPerBlock()).to.be.equal(
        parseEther('1')
      );
    });
  });

  describe('function: setNewTreasury', () => {
    it('reverts if it is not called by the owner', async () => {
      const { casaDePapel, alice } = await loadFixture(deployFixture);

      expect(
        casaDePapel.connect(alice).setNewTreasury(alice.address)
      ).to.be.rejectedWith('Ownable: caller is not the owner');
    });

    it('sets a new treasury', async () => {
      const { casaDePapel, owner } = await loadFixture(deployFixture);

      expect(casaDePapel.connect(owner).setNewTreasury(owner.address))
        .to.emit(casaDePapel, 'NewTreasury')
        .withArgs(owner.address);
    });
  });

  describe('function: deposit', () => {
    it('reverts if the aliceAccount tries to deposit to the pool 0', async () => {
      const { casaDePapel, alice } = await loadFixture(deployFixture);

      await expect(casaDePapel.connect(alice).deposit(0, 1)).to.be.rejectedWith(
        'CasaDePapel__NoInterestTokenDeposit()'
      );
    });

    it('allows the aliceAccount to only get the rewards', async () => {
      const { casaDePapel, alice, owner, btc, bob, interestToken } =
        await loadFixture(deployFixture);

      await casaDePapel.connect(owner).addPool(1500, btc.address, false);
      await mine(START_BLOCK);
      await Promise.all([
        casaDePapel.connect(bob).deposit(1, parseEther('10')),
        casaDePapel.connect(alice).deposit(1, parseEther('7')),
      ]);

      const [pool, aliceAccount, balance, aliceBTCBalance] = await Promise.all([
        casaDePapel.pools(1),
        casaDePapel.userInfo(1, alice.address),
        interestToken.balanceOf(alice.address),
        btc.balanceOf(alice.address),
      ]);

      // Accrue rewards
      await mine(2);

      expect(pool.totalSupply).to.be.equal(parseEther('17'));
      expect(aliceAccount.amount).to.be.equal(parseEther('7'));
      expect(aliceAccount.rewardsPaid).to.be.equal(
        pool.accruedIntPerShare.mul(aliceAccount.amount).div(parseEther('1'))
      );

      await expect(casaDePapel.connect(alice).deposit(1, 0))
        .to.emit(casaDePapel, 'Deposit')
        .withArgs(alice.address, 1, 0);

      const [pool1, aliceAccount1, interestTokenBalance1, aliceBTCBalance1] =
        await Promise.all([
          casaDePapel.pools(1),
          casaDePapel.userInfo(1, alice.address),
          interestToken.balanceOf(alice.address),
          btc.balanceOf(alice.address),
        ]);

      expect(aliceBTCBalance).to.be.equal(aliceBTCBalance1);
      expect(aliceAccount.amount).to.be.equal(aliceAccount1.amount);
      expect(pool1.totalSupply).to.be.equal(pool.totalSupply);
      // Rewards paid in INT
      expect(interestTokenBalance1).to.be.equal(
        balance
          .add(
            aliceAccount.amount
              .mul(pool1.accruedIntPerShare)
              .div(parseEther('1'))
          )
          .sub(aliceAccount.rewardsPaid)
      );
    });

    it('allows for multiple deposits', async () => {
      const { casaDePapel, alice, owner, btc, interestToken } =
        await loadFixture(deployFixture);

      await casaDePapel.connect(owner).addPool(1500, btc.address, false);

      await expect(casaDePapel.connect(alice).deposit(1, parseEther('6')))
        .to.emit(casaDePapel, 'Deposit')
        .withArgs(alice.address, 1, parseEther('6'));

      const [pool, user, balance, lpBalance] = await Promise.all([
        casaDePapel.pools(1),
        casaDePapel.userInfo(1, alice.address),
        interestToken.balanceOf(alice.address),
        btc.balanceOf(alice.address),
      ]);

      expect(pool.totalSupply).to.be.equal(parseEther('6'));
      expect(user.amount).to.be.equal(parseEther('6'));

      // Accrue rewards
      await mine(2);

      await expect(casaDePapel.connect(alice).deposit(1, parseEther('7')))
        .to.emit(casaDePapel, 'Deposit')
        .withArgs(alice.address, 1, parseEther('7'));

      const [pool1, user1, balance1, lpBalance1] = await Promise.all([
        casaDePapel.pools(1),
        casaDePapel.userInfo(1, alice.address),
        interestToken.balanceOf(alice.address),
        btc.balanceOf(alice.address),
      ]);

      expect(pool1.totalSupply).to.be.equal(parseEther('13'));
      expect(user1.amount).to.be.equal(parseEther('13'));
      expect(user1.rewardsPaid).to.be.equal(
        user1.amount.mul(pool1.accruedIntPerShare).div(parseEther('1'))
      );
      // Rewards r paid when depositing
      expect(balance1).to.be.equal(
        balance.add(
          user.amount
            .mul(pool1.accruedIntPerShare)
            .div(parseEther('1'))
            .sub(user.rewardsPaid)
        )
      );
      expect(lpBalance1).to.be.equal(lpBalance.sub(parseEther('7')));
    });
  });

  it('updates all pools', async () => {
    const { casaDePapel, alice, owner, btc, ether } = await loadFixture(
      deployFixture
    );

    await Promise.all([
      casaDePapel.connect(owner).addPool(1500, btc.address, false),
      casaDePapel.connect(owner).addPool(1000, ether.address, false),
    ]);

    const [pool, btcPool, etherPool] = await Promise.all([
      casaDePapel.pools(0),
      casaDePapel.pools(1),
      casaDePapel.pools(2),
    ]);

    expect(pool.lastRewardBlock).to.be.equal(START_BLOCK);

    expect(pool.accruedIntPerShare).to.be.equal(0);
    expect(btcPool.accruedIntPerShare).to.be.equal(0);
    expect(etherPool.accruedIntPerShare).to.be.equal(0);

    await Promise.all([
      casaDePapel.connect(alice).stake(parseEther('11')),
      casaDePapel.connect(alice).deposit(1, parseEther('6.5')),
      casaDePapel.connect(alice).deposit(2, parseEther('23')),
    ]);

    const [pool1, btcPool1, etherPool1] = await Promise.all([
      casaDePapel.pools(0),
      casaDePapel.pools(1),
      casaDePapel.pools(2),
    ]);

    await casaDePapel.updateAllPools();

    expect(pool1.lastRewardBlock.gt(pool.lastRewardBlock)).to.be.equal(true);
    expect(btcPool1.lastRewardBlock.gt(btcPool.lastRewardBlock)).to.be.equal(
      true
    );
    expect(
      etherPool1.lastRewardBlock.gt(etherPool.lastRewardBlock)
    ).to.be.equal(true);

    const [pool2, btcPool2, etherPool2] = await Promise.all([
      casaDePapel.pools(0),
      casaDePapel.pools(1),
      casaDePapel.pools(2),
    ]);

    expect(pool2.lastRewardBlock.gt(pool1.lastRewardBlock)).to.be.equal(true);
    expect(btcPool2.lastRewardBlock.gt(btcPool1.lastRewardBlock)).to.be.equal(
      true
    );
    expect(
      etherPool2.lastRewardBlock.gt(etherPool1.lastRewardBlock)
    ).to.be.equal(true);

    expect(pool2.accruedIntPerShare).to.be.equal(
      calculateAccruedInt(
        pool1.accruedIntPerShare,
        pool2.lastRewardBlock.sub(pool1.lastRewardBlock),
        pool2.allocationPoints,
        pool2.allocationPoints.add(2500),
        pool2.totalSupply
      )
    );
    expect(btcPool2.accruedIntPerShare).to.be.equal(
      calculateAccruedInt(
        btcPool1.accruedIntPerShare,
        btcPool2.lastRewardBlock.sub(btcPool1.lastRewardBlock),
        btcPool2.allocationPoints,
        pool2.allocationPoints.add(2500),
        btcPool2.totalSupply
      )
    );
    expect(etherPool2.accruedIntPerShare).to.be.equal(
      calculateAccruedInt(
        etherPool1.accruedIntPerShare,
        etherPool2.lastRewardBlock.sub(etherPool1.lastRewardBlock),
        etherPool2.allocationPoints,
        pool2.allocationPoints.add(2500),
        etherPool2.totalSupply
      )
    );
  });

  describe('function: withdraw', () => {
    it('reverts if  you try to withdraw from pool 0', async () => {
      const { casaDePapel, alice } = await loadFixture(deployFixture);

      await expect(
        casaDePapel.connect(alice).withdraw(0, 1)
      ).to.be.rejectedWith('CasaDePapel__NoInterestTokenWithdraw()');
    });
    it('reverts if the user tries to withdraw more than what he has deposited', async () => {
      const { casaDePapel, alice, owner, btc } = await loadFixture(
        deployFixture
      );

      await casaDePapel.connect(owner).addPool(1500, btc.address, false);
      await casaDePapel.connect(alice).deposit(1, parseEther('2'));

      await expect(
        casaDePapel.connect(alice).withdraw(1, parseEther('2.1'))
      ).to.rejectedWith('CasaDePapel__WithdrawAmountTooHigh()');
    });
    it('allows to only get the pending rewards', async () => {
      const { casaDePapel, alice, owner, btc, interestToken } =
        await loadFixture(deployFixture);

      await casaDePapel.connect(owner).addPool(1500, btc.address, false);
      await casaDePapel.connect(alice).deposit(1, parseEther('7'));

      const [pool, user, balance] = await Promise.all([
        casaDePapel.pools(1),
        casaDePapel.userInfo(1, alice.address),
        interestToken.balanceOf(alice.address),
      ]);

      // Accrue rewards
      await mine(2);

      await expect(casaDePapel.connect(alice).withdraw(1, 0))
        .to.emit(casaDePapel, 'Withdraw')
        .withArgs(alice.address, alice.address, 1, 0);

      const [pool1, user1, balance1] = await Promise.all([
        casaDePapel.pools(1),
        casaDePapel.userInfo(1, alice.address),
        interestToken.balanceOf(alice.address),
      ]);

      expect(user1.amount).to.be.equal(user.amount);
      expect(balance1).to.be.equal(
        balance.add(
          user.amount.mul(pool1.accruedIntPerShare).div(parseEther('1'))
        )
      );
      expect(pool1.totalSupply).to.be.equal(pool.totalSupply);
      expect(user1.rewardsPaid).to.be.equal(
        user1.amount.mul(pool1.accruedIntPerShare).div(parseEther('1'))
      );
    });
    it('allows to withdraw deposited tokens', async () => {
      const { casaDePapel, alice, owner, bob, btc, interestToken } =
        await loadFixture(deployFixture);

      await casaDePapel.connect(owner).addPool(1500, btc.address, false);
      await Promise.all([
        casaDePapel.connect(alice).deposit(1, parseEther('7')),
        casaDePapel.connect(bob).deposit(1, parseEther('8')),
      ]);

      const [pool, user, balance, lpBalance] = await Promise.all([
        casaDePapel.pools(1),
        casaDePapel.userInfo(1, alice.address),
        interestToken.balanceOf(alice.address),
        btc.balanceOf(alice.address),
      ]);

      // Accrue rewards
      await mine(2);

      expect(user.amount).to.be.equal(parseEther('7'));
      expect(user.rewardsPaid).to.be.equal(0);
      expect(pool.totalSupply).to.be.equal(parseEther('15'));

      await expect(casaDePapel.connect(alice).withdraw(1, parseEther('3')))
        .to.emit(casaDePapel, 'Withdraw')
        .withArgs(alice.address, alice.address, 1, parseEther('3'));

      const [pool1, user1, balance1, lpBalance1] = await Promise.all([
        casaDePapel.pools(1),
        casaDePapel.userInfo(1, alice.address),
        interestToken.balanceOf(alice.address),
        btc.balanceOf(alice.address),
      ]);

      expect(user1.amount).to.be.equal(parseEther('4'));
      expect(user1.rewardsPaid).to.be.equal(
        user1.amount.mul(pool1.accruedIntPerShare).div(parseEther('1'))
      );
      expect(pool1.totalSupply).to.be.equal(parseEther('12'));
      // Rewards are in Int Token
      expect(balance1).to.be.equal(
        balance.add(
          user.amount.mul(pool1.accruedIntPerShare).div(parseEther('1'))
        )
      );
      // Withdraw is on the pool token
      expect(lpBalance1).to.be.equal(lpBalance.add(parseEther('3')));
    });
    it('does not give pending rewards if interest block production is set to 0', async () => {
      const { casaDePapel, alice, owner, btc, interestToken } =
        await loadFixture(deployFixture);

      const [aliceIntBalance] = await Promise.all([
        interestToken.balanceOf(alice.address),
        casaDePapel.connect(owner).addPool(1500, btc.address, false),
        casaDePapel.connect(owner).setIPXPerBlock(0),
      ]);
      await casaDePapel.connect(alice).deposit(1, parseEther('7'));

      // Accrue rewards
      await mine(2);

      await casaDePapel.connect(alice).withdraw(1, parseEther('3'));

      expect(await interestToken.balanceOf(alice.address)).to.be.equal(
        aliceIntBalance
      );
    });
  });

  describe('function: stake', () => {
    it('allows the user to only get the rewards by staking 0', async () => {
      const { casaDePapel, alice, bob, interestToken } = await loadFixture(
        deployFixture
      );

      await Promise.all([
        casaDePapel.connect(bob).stake(parseEther('20')),
        casaDePapel.connect(alice).stake(parseEther('5')),
      ]);

      const [pool, user, balance] = await Promise.all([
        casaDePapel.pools(0),
        casaDePapel.userInfo(0, alice.address),
        interestToken.balanceOf(alice.address),
      ]);

      expect(pool.totalSupply).to.be.equal(parseEther('25'));
      expect(user.amount).to.be.equal(parseEther('5'));
      expect(user.rewardsPaid).to.be.equal(
        parseEther('5').mul(pool.accruedIntPerShare).div(parseEther('1'))
      );

      // Accrue rewards
      await mine(2);

      await expect(casaDePapel.connect(alice).stake(0))
        .to.emit(casaDePapel, 'Deposit')
        .withArgs(alice.address, 0, 0);

      const [pool1, user1, balance1] = await Promise.all([
        casaDePapel.pools(0),
        casaDePapel.userInfo(0, alice.address),
        interestToken.balanceOf(alice.address),
      ]);

      // Balance changed because she asked for rewards only
      expect(balance1).to.be.equal(
        balance.add(
          user.amount
            .mul(pool1.accruedIntPerShare)
            .div(parseEther('1'))
            .sub(user.rewardsPaid)
        )
      );
      // Amount has not changed
      expect(user1.amount).to.be.equal(user.amount);
      expect(pool1.totalSupply).to.be.equal(parseEther('25'));
    });
    it('allows to stake', async () => {
      const { casaDePapel, alice, interestToken } = await loadFixture(
        deployFixture
      );

      await casaDePapel.connect(alice).stake(parseEther('5'));

      const [pool, user, balance] = await Promise.all([
        casaDePapel.pools(0),
        casaDePapel.userInfo(0, alice.address),
        interestToken.balanceOf(alice.address),
      ]);

      expect(pool.totalSupply).to.be.equal(parseEther('5'));
      expect(user.amount).to.be.equal(parseEther('5'));
      expect(user.rewardsPaid).to.be.equal(0);

      // Accrue rewards
      await mine(2);

      await expect(casaDePapel.connect(alice).stake(parseEther('15')))
        .to.emit(casaDePapel, 'Deposit')
        .withArgs(alice.address, 0, parseEther('15'));

      const [pool1, user1, balance1] = await Promise.all([
        casaDePapel.pools(0),
        casaDePapel.userInfo(0, alice.address),
        interestToken.balanceOf(alice.address),
      ]);

      expect(pool1.totalSupply).to.be.equal(parseEther('20'));
      expect(user1.amount).to.be.equal(parseEther('20'));
      expect(user1.rewardsPaid).to.be.equal(
        parseEther('20').mul(pool1.accruedIntPerShare).div(parseEther('1'))
      );
      expect(balance1).to.be.equal(
        balance
          // + Rewards
          .add(user.amount.mul(pool1.accruedIntPerShare).div(parseEther('1')))
          // - Deposit
          .sub(parseEther('15'))
      );
    });
  });

  describe('function: unstake', () => {
    it('reverts if the user tries to withdraw more than he deposited', async () => {
      const { casaDePapel, alice } = await loadFixture(deployFixture);

      await casaDePapel.connect(alice).stake(parseEther('1'));
      await expect(
        casaDePapel.connect(alice).unstake(parseEther('1.1'))
      ).to.rejectedWith('CasaDePapel__WithdrawAmountTooHigh()');
    });
    it('returns only the rewards if the user chooses to', async () => {
      const { casaDePapel, alice, interestToken } = await loadFixture(
        deployFixture
      );
      await mine(START_BLOCK);
      await casaDePapel.connect(alice).stake(parseEther('10'));

      // Spend some blocks to accrue rewards
      await mine(2);

      const [user, pool] = await Promise.all([
        casaDePapel.userInfo(0, alice.address),
        casaDePapel.pools(0),
      ]);

      await expect(casaDePapel.connect(alice).unstake(0))
        .to.emit(casaDePapel, 'Withdraw')
        .withArgs(alice.address, alice.address, 0, 0);

      const [user1, pool1] = await Promise.all([
        casaDePapel.userInfo(0, alice.address),
        casaDePapel.pools(0),
      ]);

      expect(user.rewardsPaid).to.be.equal(0);
      expect(user1.amount).to.be.equal(parseEther('10'));
      expect(pool.totalSupply).to.be.equal(pool1.totalSupply);
      // Only one user so he was paid all rewards
      expect(user1.rewardsPaid).to.be.equal(
        // accruedIntPerShare has more decimal houses for precision
        pool1.accruedIntPerShare.mul(pool1.totalSupply).div(parseEther('1'))
      );

      expect(await interestToken.balanceOf(alice.address)).to.be.equal(
        calculateUserPendingRewards(
          parseEther('10'),
          pool1.accruedIntPerShare,
          BigNumber.from(0)
          // Need to add her initial balance of 500 minus the 10 deposited
        ).add(parseEther('1490'))
      );
    });
    it('returns the rewards and the amounts', async () => {
      const { casaDePapel, alice, interestToken } = await loadFixture(
        deployFixture
      );

      await casaDePapel.connect(alice).stake(parseEther('10'));
      // Spend some blocks to accrue rewards
      await mine(2);

      const user = await casaDePapel.userInfo(0, alice.address);

      await expect(casaDePapel.connect(alice).unstake(parseEther('4')))
        .to.emit(casaDePapel, 'Withdraw')
        .withArgs(alice.address, alice.address, 0, parseEther('4'));

      const [user1, pool] = await Promise.all([
        casaDePapel.userInfo(0, alice.address),
        casaDePapel.pools(0),
      ]);

      expect(user.rewardsPaid).to.be.equal(0);

      expect(user1.amount).to.be.equal(parseEther('6'));
      expect(pool.totalSupply).to.be.equal(parseEther('6'));
      // Only one user so he was paid all rewards
      expect(user1.rewardsPaid).to.be.equal(
        // accruedIntPerShare has more decimal houses for precision
        pool.accruedIntPerShare.mul(pool.totalSupply).div(parseEther('1'))
      );
      expect(await interestToken.balanceOf(alice.address)).to.be.equal(
        calculateUserPendingRewards(
          parseEther('10'),
          pool.accruedIntPerShare,
          BigNumber.from(0)
          // Need to add her initial balance of 1500 minus the 10 deposited
        ).add(parseEther('1494'))
      );
    });
    it('does not mint rewards if the interest token block production is set to 0', async () => {
      const { casaDePapel, alice, interestToken, owner } = await loadFixture(
        deployFixture
      );

      const aliceIntBalance = await interestToken.balanceOf(alice.address);
      await casaDePapel.connect(owner).setIPXPerBlock(0);
      await casaDePapel.connect(alice).stake(parseEther('10'));
      // Spend some blocks to accrue rewards
      await mine(2);

      await casaDePapel.connect(alice).unstake(parseEther('10'));

      expect(await interestToken.balanceOf(alice.address)).to.be.equal(
        aliceIntBalance
      );
    });
  });

  it('mints the rewards for the treasury', async () => {
    const { casaDePapel, alice, owner, btc, interestToken, treasury } =
      await loadFixture(deployFixture);

    await casaDePapel.connect(owner).addPool(1500, btc.address, false);

    await casaDePapel.connect(alice).deposit(1, parseEther('7'));

    await mine(START_BLOCK * 10);

    const [pool, treasuryBalance] = await Promise.all([
      casaDePapel.pools(1),
      casaDePapel.treasuryBalance(),
    ]);

    expect(treasuryBalance).to.be.equal(0);

    await casaDePapel.connect(alice).deposit(1, parseEther('7'));

    const [pool1, treasuryBalance1] = await Promise.all([
      casaDePapel.pools(1),
      casaDePapel.treasuryBalance(),
    ]);

    expect(
      pool1.accruedIntPerShare
        .mul(parseEther('7'))
        .div(parseEther('1'))
        .mul(parseEther('0.1'))
        .div(parseEther('1'))
    ).to.be.closeTo(treasuryBalance1, parseEther('1'));

    await expect(casaDePapel.mintTreasuryRewards())
      .to.emit(interestToken, 'Transfer')
      .withArgs(ethers.constants.AddressZero, treasury.address, anyUint);

    expect(await interestToken.balanceOf(treasury.address)).to.be.closeTo(
      treasuryBalance1,
      parseEther('1')
    );
  });

  describe('function: emergencyWithdraw', () => {
    it('allows a user to withdraw tokens from a pool without getting any rewards', async () => {
      const { casaDePapel, alice, owner, btc } = await loadFixture(
        deployFixture
      );

      await casaDePapel.connect(owner).addPool(1500, btc.address, false);
      const initialBalance = await btc.balanceOf(alice.address);
      await casaDePapel.connect(alice).deposit(1, parseEther('5'));

      const [userInfo, pool] = await Promise.all([
        casaDePapel.userInfo(1, alice.address),
        casaDePapel.pools(1),
        casaDePapel.updateAllPools(),
      ]);

      expect(userInfo.amount).to.be.equal(parseEther('5'));
      expect(userInfo.rewardsPaid).to.be.equal(0);
      expect(pool.totalSupply).to.be.equal(parseEther('5'));
      // Pool has rewards to be given but since this is an urgent withdraw they will not be given out
      expect(pool.accruedIntPerShare.gt(0)).to.equal(true);

      await expect(casaDePapel.connect(alice).emergencyWithdraw(1))
        .to.emit(casaDePapel, 'EmergencyWithdraw')
        .withArgs(alice.address, 1, parseEther('5'));

      const [userInfo1, pool1] = await Promise.all([
        casaDePapel.userInfo(1, alice.address),
        casaDePapel.pools(1),
      ]);

      expect(await btc.balanceOf(alice.address)).to.be.equal(initialBalance);
      expect(userInfo1.amount).to.be.equal(0);
      expect(userInfo1.rewardsPaid).to.be.equal(0);
      expect(pool1.totalSupply).to.be.equal(0);
    });
    it('allows a user to withdraw interest tokens from a pool without getting any rewards', async () => {
      const { casaDePapel, alice, interestToken } = await loadFixture(
        deployFixture
      );

      const initialBalance = await interestToken.balanceOf(alice.address);
      await casaDePapel.connect(alice).stake(parseEther('5'));

      const [userInfo, pool] = await Promise.all([
        casaDePapel.userInfo(0, alice.address),
        casaDePapel.pools(0),
        casaDePapel.updateAllPools(),
      ]);

      expect(userInfo.amount).to.be.equal(parseEther('5'));
      expect(userInfo.rewardsPaid).to.be.equal(0);
      expect(pool.totalSupply).to.be.equal(parseEther('5'));
      // Pool has rewards to be given but since this is an urgent withdraw they will not be given out
      expect(pool.accruedIntPerShare.gt(0)).to.equal(true);

      await expect(casaDePapel.connect(alice).emergencyWithdraw(0))
        .to.emit(casaDePapel, 'EmergencyWithdraw')
        .withArgs(alice.address, 0, parseEther('5'));

      const [userInfo1, pool1] = await Promise.all([
        casaDePapel.userInfo(0, alice.address),
        casaDePapel.pools(0),
      ]);

      expect(await interestToken.balanceOf(alice.address)).to.be.equal(
        initialBalance
      );
      expect(userInfo1.amount).to.be.equal(0);
      expect(userInfo1.rewardsPaid).to.be.equal(0);
      expect(pool1.totalSupply).to.be.equal(0);
    });
  });
  it('allows to check how many pending rewards a user has in a specific pool', async () => {
    const { casaDePapel, alice } = await loadFixture(deployFixture);

    expect(
      await casaDePapel.getUserPendingRewards(0, alice.address)
    ).to.be.equal(0);

    await casaDePapel.connect(alice).stake(parseEther('5'));

    expect(
      await casaDePapel.getUserPendingRewards(0, alice.address)
    ).to.be.equal(0);

    await mine(2);

    const [block, pool, user, totalAllocationPoints] = await Promise.all([
      ethers.provider.getBlockNumber(),
      casaDePapel.pools(0),
      casaDePapel.userInfo(0, alice.address),
      casaDePapel.totalAllocationPoints(),
    ]);

    expect(
      await casaDePapel.getUserPendingRewards(0, alice.address)
    ).to.be.equal(
      calculateUserPendingRewards(
        user.amount,
        calculateAccruedInt(
          BigNumber.from(0),
          BigNumber.from(block).sub(pool.lastRewardBlock),
          pool.allocationPoints,
          totalAllocationPoints,
          pool.totalSupply
        ),
        user.rewardsPaid
      )
    );
  });

  describe('function: updatePool', () => {
    it('does update the treasury balance if there are no rewards', async () => {
      const { casaDePapel, alice } = await loadFixture(deployFixture);

      // remove rewards
      await casaDePapel.setIPXPerBlock(0);

      await casaDePapel.connect(alice).stake(parseEther('5'));

      await mine(START_BLOCK + 10);

      await casaDePapel.connect(alice).stake(parseEther('5'));

      await casaDePapel.pools(0);

      await casaDePapel.updatePool(0);

      expect(await casaDePapel.treasuryBalance()).to.be.equal(0);
    });

    it('updates the treasury balance', async () => {
      const { casaDePapel, alice } = await loadFixture(deployFixture);

      await casaDePapel.connect(alice).stake(parseEther('5'));

      await mine(START_BLOCK + 10);

      expect(await casaDePapel.treasuryBalance()).to.be.equal(0);

      await expect(casaDePapel.updatePool(0)).to.emit(
        casaDePapel,
        'UpdatePool'
      );

      const pool = await casaDePapel.pools(0);

      // divide by 10 ether to get 10%
      expect(await casaDePapel.treasuryBalance()).to.be.equal(
        pool.accruedIntPerShare.mul(parseEther('5')).div(parseEther('10'))
      );
    });

    it('does not update a pool if it has already been updated on the same block', async () => {
      const { casaDePapel, alice } = await loadFixture(deployFixture);

      await expect(
        casaDePapel.connect(alice).stake(parseEther('50'))
      ).to.not.emit(casaDePapel, 'UpdatePool');

      await mine(2);
      await network.provider.send('evm_setAutomine', [false]);

      const secondDepositTX = await casaDePapel
        .connect(alice)
        .stake(parseEther('50'));

      const thirdDepositTX = await casaDePapel
        .connect(alice)
        .stake(parseEther('50'));

      await mine(1);
      await network.provider.send('evm_setAutomine', [true]);

      await secondDepositTX.wait(1);
      await thirdDepositTX.wait(1);
      // No event is emitted on first deposit
      // Only the second TX emitted an updatePool
      // Third deposit on the same block as the second one. So no event was emitted.
      expect(
        (await casaDePapel.queryFilter(casaDePapel.filters.UpdatePool(0)))
          .length
      ).to.be.equal(1);
    });
  });
});
